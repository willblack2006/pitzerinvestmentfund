// Heavy per-symbol alert signals (insider, short pressure, 8-K red flags, estimate revisions,
// 10-K rewrites, crowding, activist filings), computed in the background and stored in the
// `signals` table. Computing them inside /api/alerts meant hundreds of external calls per page
// load, past Vercel's 60s limit, while blocking every other request on the same instance.
const db = require("../db");
const finnhub = require("./sources/finnhub");
const sec = require("./sources/sec");
const { scoreInsiders } = require("./insiderSignals");
const { scanRedFlags } = require("./redFlags");
const { histories } = require("./prices");
const benchmarks = require("./benchmarks");
const { getSettings } = require("./settings");

// Route modules are required lazily: they import things that import this file's callers.
const routes = () => ({
  shortPressureFor: require("../routes/shortPressure").shortPressureFor,
  revisionScoreFor: require("../routes/estimateRevisions").revisionScoreFor,
  filingDiffFor: require("../routes/research").filingDiffFor,
  activistFilingsFor: require("../routes/research").activistFilingsFor,
  crowdingFor: require("../routes/crowding").crowdingFor,
});

async function settle(fn) {
  try { return await fn(); } catch { return null; }
}

// Alerts for one symbol. Holdings get every check; watchlist names only get the filing-based
// ones (red flags, activist), matching what /api/alerts used to compute. Crowding is stored
// for both because the Holdings and Watchlist pages each show it.
async function computeSignalsFor(symbol, { owned }) {
  const r = routes();
  const alerts = [];
  const none = async () => null;
  const [sig, sp, rv, diff, crowding, filings, activist] = await Promise.all([
    settle(owned && finnhub.apiKey() ? async () => scoreInsiders(await finnhub.getInsiderHistory(symbol)) : none),
    settle(owned ? () => r.shortPressureFor(symbol) : none),
    settle(owned ? () => r.revisionScoreFor(symbol) : none),
    settle(owned ? () => r.filingDiffFor(symbol, "10-K") : none),
    settle(() => r.crowdingFor(symbol)), // stored for watchlist names too (Watchlist page panel)
    settle(() => sec.getRecentFilings(symbol, ["8-K", "NT 10-K", "NT 10-Q"])),
    settle(() => r.activistFilingsFor(symbol, { withCoverPages: false, sinceDays: 14 })),
  ]);

  if (owned) {
    if (sig && sig.score >= 25) {
      alerts.push({ type: "insider", level: "watch", symbol, title: `${sig.label}: ${symbol} (${sig.score > 0 ? "+" : ""}${sig.score})`, detail: sig.reasons[0] });
    } else if (sig && sig.score <= -50) { // selling is a weak signal; only flag broad non-routine selling
      alerts.push({ type: "insider", level: "watch", symbol, title: `Insider ${sig.label.toLowerCase()}: ${symbol} (${sig.score})`, detail: sig.reasons.find((x) => /sold/.test(x)) || sig.reasons[0] });
    }

    if (sp && sp.score >= 45) {
      alerts.push({ type: "short", level: "watch", symbol: sp.symbol, title: `${sp.label}: ${sp.symbol} (${sp.score})`, detail: sp.reasons[0] });
    }

    if (rv && Math.abs(rv.score) >= 40) {
      alerts.push({ type: "revision", level: "watch", symbol: rv.symbol, title: `${rv.label}: ${rv.symbol} (${rv.score > 0 ? "+" : ""}${rv.score})`, detail: rv.reasons[0] });
    }

    if (diff?.available) {
      const changed = diff.sections.filter((s) => s.hasPrior && Number.isFinite(s.similarity) && s.similarity < 0.75);
      for (const s of changed) {
        alerts.push({ type: "filingchange", level: "watch", symbol, title: `${symbol}: ${s.label} rewritten`, detail: `Similarity to the prior 10-K is ${Math.round(s.similarity * 100)}% (${s.addedCount ?? s.added.length} paragraphs added, ${s.removedCount ?? s.removed.length} removed). Filed ${diff.latest.filingDate}.`, url: diff.latest.url });
      }
    }

    if (crowding && crowding.score >= 60) {
      alerts.push({ type: "crowding", level: "watch", symbol: crowding.symbol, title: `${crowding.label}: ${crowding.symbol}`, detail: crowding.reasons[0] });
    }
  }

  if (filings) {
    const flags = scanRedFlags(filings).filter((f) => new Date(f.date) >= new Date(Date.now() - 30 * 864e5));
    for (const f of flags) {
      alerts.push({ type: "redflag", level: f.severity === "high" ? "action" : "watch", symbol, title: `${symbol}: ${f.detail}`, detail: `Filed ${f.date}.`, url: f.url });
    }
  }

  for (const f of activist || []) {
    alerts.push({ type: "activist", level: "watch", symbol, title: `${symbol}: new ${f.form} filed`, detail: `Filed ${f.filingDate}.${f.isAmendment ? " Amendment to a prior filing." : ""}`, url: f.url });
  }

  return { alerts, crowding };
}

function trackedSymbols() {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((x) => x.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((x) => x.symbol);
  const ownedSet = new Set(owned);
  return [...new Set([...owned, ...watched])].map((symbol) => ({ symbol, owned: ownedSet.has(symbol) }));
}

const getAllStmt = () => db.prepare("SELECT symbol, payload, computed_at FROM signals");
const upsertStmt = () => db.prepare(`
  INSERT INTO signals (symbol, payload, computed_at) VALUES (?, ?, ?)
  ON CONFLICT(symbol) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at
`);

// Stored signals for the symbols the fund currently tracks (sold/unwatched names drop out).
function storedSignals() {
  const tracked = new Map(trackedSymbols().map((t) => [t.symbol, t]));
  const rows = getAllStmt().all().filter((row) => tracked.has(row.symbol));
  return rows.map((row) => ({ symbol: row.symbol, computedAt: row.computed_at, ...JSON.parse(row.payload) }));
}

// Recompute the stalest symbols first until the time budget is spent. Resumable: each call
// picks up where the last one stopped, so no single run hits the 60s function limit.
// `since` (ms timestamp) instead recomputes everything computed before that moment, for a
// manual full refresh that runs across several calls.
async function refreshSignals({ budgetMs = 45000, maxAgeMs = 12 * 3600e3, since = null, compute = computeSignalsFor, now = Date.now } = {}) {
  const started = now();
  // Nothing else ever deletes from api_cache, and every new Vercel instance downloads the
  // whole database: drop expired rows plus the old oversized FINRA day files and uncapped
  // 10-K diffs (both replaced by smaller cache entries).
  db.prepare(`
    DELETE FROM api_cache
    WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%f', 'now')
       OR source = 'finra_shvol'
       OR (cache_key LIKE 'filing_diff_%' AND cache_key NOT LIKE 'filing_diff_v2_%')
  `).run();
  const computedAt = new Map(getAllStmt().all().map((row) => [row.symbol, new Date(row.computed_at + "Z").getTime()]));
  const ageOf = (sym) => (computedAt.has(sym) ? started - computedAt.get(sym) : Infinity);
  const isDue = Number.isFinite(since)
    ? (sym) => !computedAt.has(sym) || computedAt.get(sym) < since
    : (sym) => ageOf(sym) >= maxAgeMs;
  const tracked = trackedSymbols();
  const due = tracked.filter((t) => isDue(t.symbol)).sort((a, b) => ageOf(b.symbol) - ageOf(a.symbol));

  const upsert = upsertStmt();
  let done = 0;
  for (const t of due) {
    if (now() - started >= budgetMs) break;
    const result = await compute(t.symbol, { owned: t.owned });
    upsert.run(t.symbol, JSON.stringify(result), new Date(now()).toISOString().replace("Z", ""));
    done++;
  }

  // Keep the Performance page's price-history cache warm (it's 40s+ when cold).
  if (compute === computeSignalsFor && done === due.length && now() - started < budgetMs) {
    const owned = tracked.filter((t) => t.owned).map((t) => t.symbol);
    await settle(() => histories(owned));
    await settle(() => benchmarks.series(getSettings().benchmark, "2y"));
  }

  return { refreshed: done, remaining: due.length - done, total: tracked.length };
}

module.exports = { computeSignalsFor, refreshSignals, storedSignals };
