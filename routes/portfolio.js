const express = require("express");
const db = require("../db");
const { requireAuth, memberFromRequest } = require("../middleware/auth");
const portfolio = require("../lib/portfolio");
const analytics = require("../lib/analytics");
const finnhub = require("../lib/sources/finnhub");
const { storedSignals, refreshSignals } = require("../lib/signals");
const claude = require("../lib/sources/claude");
const { latestPrices, histories } = require("../lib/prices");
const { basesFor, PERIODS } = require("../lib/periods");
const { getSettings } = require("../lib/settings");
const benchmarks = require("../lib/benchmarks");

const router = express.Router();

// ---- Live quotes (holdings page polls this during market hours) ----

const yahooSrc = require("../lib/sources/yahoo");
router.get("/quotes", async (req, res) => {
  const symbols = String(req.query.symbols || "").toUpperCase().split(",").map((x) => x.trim())
    .filter((x) => /^[A-Z0-9.\-^=]{1,12}$/.test(x)).slice(0, 150);
  if (!symbols.length) return res.status(400).json({ error: "Pass ?symbols=AAPL,MSFT" });
  try {
    const quotes = await yahooSrc.getQuotes([...symbols, "SPY"]);
    const spy = quotes.SPY;
    if (!symbols.includes("SPY")) delete quotes.SPY;
    res.json({ quotes, marketState: spy?.marketState || null, asOf: spy?.time || null, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: `Live prices unavailable: ${e.message}` });
  }
});

// ---- Transactions ----

router.get("/transactions", (req, res) => {
  res.json(db.prepare("SELECT * FROM transactions ORDER BY date DESC, id DESC").all());
});

router.post("/transactions", requireAuth, async (req, res) => {
  const b = req.body || {};
  const type = b.type;
  const t = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : new Date().toISOString().slice(0, 10),
    type,
    symbol: String(b.symbol || "").toUpperCase().trim(),
    shares: Number(b.shares) || 0,
    price: Number(b.price) || 0,
    amount: Number(b.amount) || 0,
    note: String(b.note || "").slice(0, 500),
    pitchId: b.pitchId ? Number(b.pitchId) : null,
    createdBy: memberFromRequest(req)?.name || String(b.createdBy || "").slice(0, 80),
  };
  if (!["buy", "sell", "dividend", "deposit", "withdrawal", "fee"].includes(type)) return res.status(400).json({ error: "Unknown transaction type." });
  if ((type === "buy" || type === "sell") && (!t.symbol || !(t.shares > 0) || !(t.price > 0))) {
    return res.status(400).json({ error: "Buys and sells need a ticker, a positive share count and a price." });
  }
  if (type === "dividend" && (!t.symbol || !(t.amount > 0))) return res.status(400).json({ error: "Dividends need a ticker and an amount." });
  if (["deposit", "withdrawal", "fee"].includes(type) && !(t.amount > 0)) return res.status(400).json({ error: "Enter a positive amount." });
  try {
    const saved = portfolio.recordTransaction(t);
    portfolio.snapshot().catch(() => {}); // keep today's valuation current
    res.status(201).json(saved);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete("/transactions/:id", requireAuth, (req, res) => {
  try {
    const t = portfolio.deleteTransaction(Number(req.params.id));
    if (!t) return res.status(404).json({ error: "Transaction not found." });
    res.status(204).end();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Allocation & investment policy ----

router.get("/portfolio/allocation", async (req, res) => {
  res.json(await portfolio.allocation());
});

// ---- Performance & risk ----

router.get("/portfolio/performance", async (req, res) => {
  const s = getSettings();
  // ?benchmark= lets a viewer compare against something else without changing the fund setting.
  let benchmark;
  try { benchmark = benchmarks.normalize(req.query.benchmark || s.benchmark); } catch (e) { return res.status(400).json({ error: e.message }); }
  const positions = db.prepare("SELECT symbol, shares, totalCost, marketValue FROM positions").all();
  const [hist, bench2y] = await Promise.all([
    histories(positions.map((p) => p.symbol)),
    benchmarks.series(benchmark, "2y").catch(() => []),
  ]);
  const yearAgo = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
  const bench = bench2y.filter((p) => p.date >= yearAgo);

  // "Current holdings over the past year": what today's share counts would have been worth
  // each day. Answers "how has what we own behaved" before the fund has a long ledger.
  const byDate = new Map();
  const covered = positions.filter((p) => hist[p.symbol]?.length);
  for (const p of covered) {
    for (const pt of hist[p.symbol]) byDate.set(pt.date, (byDate.get(pt.date) || 0) + pt.close * p.shares);
  }
  // Only keep dates where every covered holding has a price (avoids holiday/listing gaps).
  const counts = new Map();
  for (const p of covered) for (const pt of hist[p.symbol]) counts.set(pt.date, (counts.get(pt.date) || 0) + 1);
  const portfolioSeries = [...byDate.entries()]
    .filter(([d]) => counts.get(d) === covered.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ date, close }));
  const risk = bench.length ? analytics.riskProfile(portfolioSeries, bench) : null;

  // Contribution: each holding's 1Y return weighted by its start-of-period weight.
  const startDate = risk?.start;
  const startValue = portfolioSeries.find((p) => p.date === startDate)?.close;
  const contributions = covered.map((p) => {
    const h = hist[p.symbol];
    const first = h.find((x) => x.date >= startDate) || h[0], last = h.at(-1);
    const ret = last.close / first.close - 1;
    const w = startValue ? (first.close * p.shares) / startValue : 0;
    return { symbol: p.symbol, return1Y: ret, startWeight: w, contribution: ret * w };
  }).sort((a, b) => b.contribution - a.contribution);

  // Correlation of the largest holdings (top 12 by value) — concentration of risk.
  const top = [...positions].sort((a, b) => b.marketValue - a.marketValue).slice(0, 12).map((p) => p.symbol).filter((sym) => hist[sym]);
  const corr = analytics.correlationMatrix(Object.fromEntries(top.map((sym) => [sym, hist[sym]])));

  // Hosts that sleep when idle (e.g. Render's free plan) may miss scheduled snapshots, so
  // viewing performance also records today's valuation.
  await portfolio.snapshot().catch(() => {});
  const navHistory = db.prepare("SELECT date, totalValue, cash, netFlow, benchmarkClose FROM nav_history ORDER BY date").all();
  const realized = db.prepare("SELECT COALESCE(SUM(realizedGain), 0) AS g FROM transactions WHERE type = 'sell'").get().g;
  const dividends = db.prepare("SELECT COALESCE(SUM(amount), 0) AS d FROM transactions WHERE type = 'dividend'").get().d;

  res.json({
    benchmark: benchmarks.shortName(benchmark),
    benchmarkValue: benchmark,
    benchmarkLabel: benchmarks.label(benchmark),
    fundBenchmark: s.benchmark,
    holdingsCovered: covered.length,
    holdingsTotal: positions.length,
    backtest: risk,
    contributions,
    correlation: corr,
    ledger: { twr: portfolio.twr(navHistory, bench2y), snapshots: navHistory.filter((h) => h.totalValue > 0).length, realizedGains: realized, dividends },
  });
});

// ---- Time-frame starting prices for the Holdings table ----

// Every frame's base close for every holding in one response, from the 1-year daily
// histories the Performance page also uses (cached 6h), so switching frames on the page
// costs nothing after the first load.
router.get("/portfolio/period-bases", async (req, res) => {
  const symbols = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const hist = await histories(symbols, "2y");
  const bySymbol = {};
  for (const s of symbols) bySymbol[s] = basesFor(hist[s]);
  const latest = Object.values(hist).map((h) => h?.at(-1)?.date).filter(Boolean).sort().at(-1) || null;
  // The close each frame is measured from (most holdings share it; a stock that didn't trade
  // that day falls back to its own earlier close).
  const starts = {};
  for (const p of PERIODS) {
    const counts = {};
    for (const b of Object.values(bySymbol)) if (b[p]) counts[b[p].date] = (counts[b[p].date] || 0) + 1;
    starts[p] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  res.json({ latest, starts, bySymbol, missing: symbols.filter((s) => !hist[s]?.length) });
});

// ---- Earnings calendar for holdings + watchlist ----

router.get("/portfolio/earnings", async (req, res) => {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  try {
    if (!finnhub.apiKey()) throw new Error("FINNHUB_API_KEY not configured");
    const cal = await finnhub.getEarningsCalendar([...new Set([...owned, ...watched])], from, to);
    const rows = cal
      .map((e) => ({ ...e, owned: owned.includes(e.symbol) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json({ from, to, events: rows });
  } catch (e) {
    res.json({ from, to, events: [], error: e.message });
  }
});

// ---- Price alerts ----

router.get("/price-alerts", (req, res) => res.json(db.prepare("SELECT * FROM price_alerts ORDER BY symbol").all()));

router.post("/price-alerts", requireAuth, (req, res) => {
  const { symbol, direction, price, note = "" } = req.body || {};
  const sym = String(symbol || "").toUpperCase().trim();
  if (!sym || !["above", "below"].includes(direction) || !(Number(price) > 0)) {
    return res.status(400).json({ error: "Alerts need a ticker, above/below and a positive price." });
  }
  const info = db.prepare("INSERT INTO price_alerts (symbol, direction, price, note) VALUES (?, ?, ?, ?)").run(sym, direction, Number(price), String(note).slice(0, 200));
  res.status(201).json(db.prepare("SELECT * FROM price_alerts WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/price-alerts/:id", requireAuth, (req, res) => {
  const info = db.prepare("DELETE FROM price_alerts WHERE id = ?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Alert not found." });
  res.status(204).end();
});

// ---- Alerts feed: everything that needs the fund's attention, in one place ----

// Meeting brief: what moved since the last meeting, what's waiting on a decision, what's next.
router.get("/meeting-brief", async (req, res) => {
  const { movesSince } = require("../lib/meetingBrief");
  const since = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since || "") ? req.query.since : new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const positions = db.prepare("SELECT symbol, shares FROM positions").all();
  const symbols = positions.map((p) => p.symbol);
  const [hist, quotes] = await Promise.all([histories(symbols, "1y"), latestPrices(symbols)]);
  const prices = Object.fromEntries(Object.entries(quotes).map(([s, q]) => [s, q.price]));
  const moves = movesSince(hist, positions, since, prices);
  const startTotal = moves.reduce((s, r) => s + (r.startValue || 0), 0);
  const endTotal = moves.reduce((s, r) => s + (r.value || 0), 0);
  let earnings = [];
  try {
    const to = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    earnings = finnhub.apiKey() ? await finnhub.getEarningsCalendar(symbols, new Date().toISOString().slice(0, 10), to) : [];
  } catch { /* needs Finnhub */ }
  res.json({
    since,
    holdingsChangePct: startTotal ? endTotal / startTotal - 1 : null,
    moves,
    voting: db.prepare("SELECT id, symbol, direction, author FROM pitches WHERE status = 'voting'").all(),
    awaitingExecution: db.prepare("SELECT id, symbol, direction, author, decidedAt FROM pitches WHERE status = 'approved'").all(),
    decidedSince: db.prepare("SELECT id, symbol, direction, status, decidedAt FROM pitches WHERE decidedAt >= ? ORDER BY decidedAt").all(since),
    earnings: earnings.sort((a, b) => a.date.localeCompare(b.date)),
  });
});

// Compact per-symbol signal badges for the Holdings table (reuses the background-computed
// signals cache, so this is cheap even for 30+ positions).
router.get("/signals", (req, res) => {
  const stored = storedSignals();
  const bySymbol = {};
  for (const s of stored) {
    bySymbol[s.symbol] = {
      badges: s.alerts.map((a) => ({ type: a.type, level: a.level, title: a.title })),
      crowdingScore: s.crowding && !s.crowding.error ? s.crowding.score : null,
    };
  }
  res.json({ bySymbol, computedAt: stored.length ? stored.map((s) => s.computedAt).sort().at(-1) : null });
});

router.get("/alerts", async (req, res) => {
  const alerts = [];
  const positions = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const priceAlerts = db.prepare("SELECT * FROM price_alerts").all();
  const notes = db.prepare("SELECT symbol, targetPrice, author FROM research_notes WHERE targetPrice IS NOT NULL").all();
  const prices = await latestPrices([...new Set([...priceAlerts.map((a) => a.symbol), ...notes.map((n) => n.symbol)])]);

  for (const a of priceAlerts) {
    const p = prices[a.symbol]?.price;
    if (p && ((a.direction === "above" && p >= a.price) || (a.direction === "below" && p <= a.price))) {
      alerts.push({ type: "price", level: "action", symbol: a.symbol, title: `${a.symbol} is ${a.direction} $${a.price}`, detail: `Now $${p.toFixed(2)}.${a.note ? ` ${a.note}` : ""}`, alertId: a.id });
    }
  }
  for (const n of notes) {
    const p = prices[n.symbol]?.price;
    if (!p) continue;
    const gap = n.targetPrice / p - 1;
    if (gap <= 0.05) {
      alerts.push({
        type: "target", level: gap <= 0 ? "action" : "watch", symbol: n.symbol,
        title: gap <= 0 ? `${n.symbol} reached the team's price target` : `${n.symbol} is within 5% of target`,
        detail: `Target $${n.targetPrice.toFixed(2)} vs price $${p.toFixed(2)} — revisit the thesis: trim, hold, or raise the target?`,
      });
    }
  }

  try {
    const alloc = await portfolio.allocation();
    for (const c of alloc.checks.filter((x) => x.level === "breach")) alerts.push({ type: "policy", level: "action", symbol: c.symbol, title: c.rule, detail: c.detail });
  } catch { /* allocation is best-effort */ }

  try {
    const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const cal = finnhub.apiKey() ? await finnhub.getEarningsCalendar(positions, from, to) : [];
    for (const e of cal) {
      alerts.push({ type: "earnings", level: "watch", symbol: e.symbol, date: e.date, title: `${e.symbol} reports ${e.date}${e.hour === "bmo" ? " before the open" : e.hour === "amc" ? " after the close" : ""}`, detail: e.epsEstimate != null ? `Consensus EPS $${e.epsEstimate.toFixed(2)}. Assign someone to cover the call.` : "Assign someone to cover the call." });
    }
  } catch { /* needs Finnhub key */ }

  // Heavy per-holding signals (insider, short pressure, red flags, revisions, 10-K rewrites,
  // crowding, activist filings) are computed in the background by lib/signals.js; read the
  // stored results so this endpoint stays fast and never blocks other requests.
  const stored = storedSignals();
  for (const s of stored) alerts.push(...s.alerts);
  const signalsAsOf = stored.length ? `${stored.map((s) => s.computedAt).sort()[0]}Z` : null;

  const voting = db.prepare("SELECT id, symbol, direction FROM pitches WHERE status = 'voting'").all();
  for (const p of voting) alerts.push({ type: "vote", level: "action", symbol: p.symbol, pitchId: p.id, title: `Vote open: ${p.direction} ${p.symbol}`, detail: "Members can cast their vote on the pitch page." });

  const order = { action: 0, watch: 1 };
  // Action first, then holdings before watchlist names, then grouped by ticker.
  const ownedSet = new Set(positions);
  alerts.sort((a, b) => order[a.level] - order[b.level]
    || (ownedSet.has(b.symbol) ? 1 : 0) - (ownedSet.has(a.symbol) ? 1 : 0)
    || (a.symbol || "").localeCompare(b.symbol || ""));
  res.json({ alerts, generatedAt: new Date().toISOString(), signalsAsOf, aiEnabled: claude.configured() });
});

// Manual "Refresh signals" (Alerts page). Short budget per call; the page calls it in a loop
// with the same `since` (when the click happened) until nothing remains.
router.post("/signals/refresh", requireAuth, async (req, res) => {
  const since = Number(req.body?.since);
  res.json(await refreshSignals({ budgetMs: 20000, since: Number.isFinite(since) && since > 0 ? Math.min(since, Date.now()) : null }));
});

module.exports = router;
