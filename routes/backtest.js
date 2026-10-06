const express = require("express");
const db = require("../db");
const { histories } = require("../lib/prices");
const benchmarks = require("../lib/benchmarks");
const { getSettings } = require("../lib/settings");
const { backtestMomentum } = require("../lib/backtest");

const router = express.Router();

// Only momentum has real point-in-time historical values (daily closes); insider score,
// estimate-revision score and short-pressure are all computed from TODAY's snapshot (Form 4
// history, consensus estimates, short interest as of now), which we don't have historical
// copies of. Backtesting those would mean reusing today's value at every past date — not a
// real backtest — so the endpoint says so instead of faking one.
const SUPPORTED = new Set(["momentum"]);

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

  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...owned, ...watched])];
  if (symbols.length < 6) return res.json({ error: "Need at least 6 holdings + watchlist names to form meaningful terciles.", universeSize: symbols.length });

  const [universeSeries, benchSeries] = await Promise.all([
    histories(symbols, `${years}y`),
    benchmarks.series(getSettings().benchmark, `${years}y`),
  ]);
  const usable = Object.fromEntries(Object.entries(universeSeries).filter(([, s]) => s.length >= 300));
  const { rows, summary } = backtestMomentum(usable, benchSeries, { costBps });

  res.json({
    signal, years, costBps,
    universeSize: Object.keys(usable).length,
    excludedForHistory: symbols.length - Object.keys(usable).length,
    rows, summary,
  });
});

module.exports = router;
