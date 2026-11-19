const express = require("express");
const db = require("../db");
const { histories } = require("../lib/prices");
const benchmarks = require("../lib/benchmarks");
const { benchmarkFor } = require("../lib/prefs");
const { backtestMomentum } = require("../lib/backtest");

const router = express.Router();

// Only momentum has real point-in-time historical values (daily closes); insider score,
// estimate-revision score and short-pressure are all computed from TODAY's snapshot (Form 4
// history, consensus estimates, short interest as of now), which we don't have historical
// copies of. Backtesting those would mean reusing today's value at every past date — not a
// real backtest — so the endpoint says so instead of faking one.
const SUPPORTED = new Set(["momentum"]);
const yahooRange = (years) => (years <= 1 ? "1y" : years <= 2 ? "2y" : years <= 5 ? "5y" : "10y");

router.get("/backtest", async (req, res) => {
  const signal = String(req.query.signal || "momentum");
  if (!SUPPORTED.has(signal)) {
    return res.status(400).json({
      error: `"${signal}" can't be backtested yet: we only store its CURRENT value, not history, so there's no real past data to test against.`,
      supported: [...SUPPORTED],
    });
  }
  const years = Math.min(10, Math.max(1, Number(req.query.years) || 7));
  const costBps = Math.min(200, Math.max(0, Number(req.query.costBps) || 20));

  let bench;
  try { bench = benchmarkFor(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...owned, ...watched])];
  if (symbols.length < 6) return res.json({ error: "Need at least 6 holdings + watchlist names to form meaningful terciles.", universeSize: symbols.length });

  // Yahoo only accepts 1y, 2y, 5y and 10y ranges (a "7y" request fails, which broke the default),
  // so fetch the next range up and trim to the years asked for.
  const range = yahooRange(years);
  const cutoff = new Date(Date.now() - years * 365.25 * 864e5).toISOString().slice(0, 10);
  const trim = (series) => (series || []).filter((p) => p.date >= cutoff);
  let universeSeries, benchSeries;
  try {
    [universeSeries, benchSeries] = await Promise.all([histories(symbols, range), benchmarks.series(bench, range)]);
  } catch (err) {
    return res.status(502).json({ error: `Price history unavailable: ${err.message}` });
  }
  benchSeries = trim(benchSeries);
  const usable = Object.fromEntries(Object.entries(universeSeries).map(([k, s]) => [k, trim(s)]).filter(([, s]) => s.length >= 300));
  if (Object.keys(usable).length < 6 || benchSeries.length < 300) {
    return res.json({ signal, years, error: "Not enough price history for a backtest (need 6+ names with over a year of daily closes).", universeSize: Object.keys(usable).length });
  }
  const { rows, summary } = backtestMomentum(usable, benchSeries, { costBps });

  res.json({
    signal, years, costBps, benchmark: benchmarks.shortName(bench), benchmarkValue: bench,
    universeSize: Object.keys(usable).length,
    excludedForHistory: symbols.length - Object.keys(usable).length,
    rows, summary,
  });
});

module.exports = router;
module.exports.yahooRange = yahooRange;
