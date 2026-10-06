const express = require("express");
const db = require("../db");
const { requireAuth, memberFromRequest } = require("../middleware/auth");
const portfolio = require("../lib/portfolio");
const analytics = require("../lib/analytics");
const finnhub = require("../lib/sources/finnhub");
const { scoreInsiders } = require("../lib/insiderSignals");
const { shortPressureFor } = require("./shortPressure");
const sec = require("../lib/sources/sec");
const { scanRedFlags } = require("../lib/redFlags");
const { revisionScoreFor } = require("./estimateRevisions");
const { filingDiffFor } = require("./research");
const { crowdingFor } = require("./crowding");
const { activistFilingsFor } = require("./research");
const { latestPrices, histories } = require("../lib/prices");
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

  // Insider signal (routine traders filtered out, clusters weighted up) for each holding.
  try {
    if (finnhub.apiKey()) {
      const results = await Promise.allSettled(positions.map(async (sym) => ({ sym, sig: scoreInsiders(await finnhub.getInsiderHistory(sym)) })));
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { sym, sig } = r.value;
        if (sig.score >= 25) {
          alerts.push({ type: "insider", level: "watch", symbol: sym, title: `${sig.label}: ${sym} (${sig.score > 0 ? "+" : ""}${sig.score})`, detail: sig.reasons[0] });
        } else if (sig.score <= -50) { // selling is a weak signal; only flag broad non-routine selling
          alerts.push({ type: "insider", level: "watch", symbol: sym, title: `Insider ${sig.label.toLowerCase()}: ${sym} (${sig.score})`, detail: sig.reasons.find((x) => /sold/.test(x)) || sig.reasons[0] });
        }
      }
    }
  } catch { /* needs Finnhub key */ }

  // Short-pressure "avoid" flag for each holding: high days-to-cover plus rising short
  // interest has historically predicted underperformance, so flag it even though we're not
  // shorting anything ourselves.
  try {
    const results = await Promise.allSettled(positions.map((sym) => shortPressureFor(sym)));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const sp = r.value;
      if (sp.score >= 45) {
        alerts.push({ type: "short", level: "watch", symbol: sp.symbol, title: `${sp.label}: ${sp.symbol} (${sp.score})`, detail: sp.reasons[0] });
      }
    }
  } catch { /* best effort */ }

  // Red flags: 8-K items (auditor change, restatement, exec departure) and late-filing
  // notices, across holdings and the watchlist. Cheap (item codes only, no full-text search)
  // so it's safe in the alerts hot path; the Filings tab endpoint does the deeper scan.
  try {
    const symbols = [...new Set([...positions, ...watched])];
    const results = await Promise.allSettled(symbols.map(async (sym) => ({ sym, filings: await sec.getRecentFilings(sym, ["8-K", "NT 10-K", "NT 10-Q"]) })));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { sym, filings } = r.value;
      const flags = scanRedFlags(filings).filter((f) => new Date(f.date) >= new Date(Date.now() - 30 * 864e5));
      for (const f of flags) {
        alerts.push({ type: "redflag", level: f.severity === "high" ? "action" : "watch", symbol: sym, title: `${sym}: ${f.detail}`, detail: `Filed ${f.date}.`, url: f.url });
      }
    }
  } catch { /* best effort */ }

  // Estimate-revision score: flag holdings where analysts are meaningfully raising or
  // cutting estimates (breadth + EPS drift), in either direction.
  try {
    const results = await Promise.allSettled(positions.map((sym) => revisionScoreFor(sym)));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const rv = r.value;
      if (Math.abs(rv.score) >= 40) {
        alerts.push({ type: "revision", level: "watch", symbol: rv.symbol, title: `${rv.label}: ${rv.symbol} (${rv.score > 0 ? "+" : ""}${rv.score})`, detail: rv.reasons[0] });
      }
    }
  } catch { /* best effort */ }

  // Filing-change detector: flag holdings whose most recent 10-K rewrote Risk Factors, MD&A
  // or Legal Proceedings substantially vs the prior year's filing ("Lazy Prices").
  try {
    const results = await Promise.allSettled(positions.map(async (sym) => ({ sym, diff: await filingDiffFor(sym, "10-K") })));
    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.diff.available) continue;
      const { sym, diff } = r.value;
      const changed = diff.sections.filter((s) => s.hasPrior && Number.isFinite(s.similarity) && s.similarity < 0.75);
      for (const s of changed) {
        alerts.push({ type: "filingchange", level: "watch", symbol: sym, title: `${sym}: ${s.label} rewritten`, detail: `Similarity to the prior 10-K is ${Math.round(s.similarity * 100)}% (${s.added.length} paragraphs added, ${s.removed.length} removed). Filed ${diff.latest.filingDate}.`, url: diff.latest.url });
      }
    }
  } catch { /* best effort */ }

  // Crowding / hype monitor: unusual volume, a big opening gap, or a news spike on a holding.
  try {
    const results = await Promise.allSettled(positions.map((sym) => crowdingFor(sym)));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const c = r.value;
      if (c.score >= 60) alerts.push({ type: "crowding", level: "watch", symbol: c.symbol, title: `${c.label}: ${c.symbol}`, detail: c.reasons[0] });
    }
  } catch { /* best effort */ }

  // Activist / 5%-owner alerts: new 13D/13G filings on holdings and watchlist names in the
  // last 14 days.
  try {
    const symbols = [...new Set([...positions, ...watched])];
    const results = await Promise.allSettled(symbols.map(async (sym) => ({ sym, filings: await activistFilingsFor(sym, { withCoverPages: false, sinceDays: 14 }) })));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { sym, filings } = r.value;
      for (const f of filings) {
        alerts.push({ type: "activist", level: "watch", symbol: sym, title: `${sym}: new ${f.form} filed`, detail: `Filed ${f.filingDate}.${f.isAmendment ? " Amendment to a prior filing." : ""}`, url: f.url });
      }
    }
  } catch { /* best effort */ }

  const voting = db.prepare("SELECT id, symbol, direction FROM pitches WHERE status = 'voting'").all();
  for (const p of voting) alerts.push({ type: "vote", level: "action", symbol: p.symbol, pitchId: p.id, title: `Vote open: ${p.direction} ${p.symbol}`, detail: "Members can cast their vote on the pitch page." });

  const order = { action: 0, watch: 1 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  res.json({ alerts, generatedAt: new Date().toISOString() });
});

module.exports = router;
