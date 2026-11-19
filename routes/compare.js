// Compare view (WS10): GET /api/compare?symbols=NVDA,AMD,INTC&frame=1Y. Normalised prices
// (each line starts at 100) and a set of key metrics per ticker for small multiples and a
// growth-vs-margin scatter. 2 to 5 tickers. Yahoo only, all cached.
const express = require("express");
const yahoo = require("../lib/sources/yahoo");
const { compareSeries, compareMetrics } = require("../lib/compare");

const router = express.Router();
const FRAMES = { "6M": ["6mo", "1d"], "1Y": ["1y", "1d"], "2Y": ["2y", "1d"], "5Y": ["5y", "1wk"] };
const val = (r) => (r.status === "fulfilled" ? r.value : null);

router.get("/compare", async (req, res) => {
  const symbols = [...new Set(String(req.query.symbols || "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9.\-^=]{1,12}$/.test(s)))].slice(0, 5);
  if (symbols.length < 2) return res.status(400).json({ error: "Pick at least two tickers to compare (up to five)." });
  const frame = FRAMES[String(req.query.frame || "1Y").toUpperCase()] ? String(req.query.frame || "1Y").toUpperCase() : "1Y";
  const [range, interval] = FRAMES[frame];
  const [bars, summaries, quotes] = await Promise.all([
    Promise.allSettled(symbols.map((s) => yahoo.getChart(s, range, interval))),
    Promise.allSettled(symbols.map((s) => yahoo.getQuoteSummary(s))),
    yahoo.getQuotes(symbols).catch(() => ({})),
  ]);
  const series = compareSeries(symbols.map((s, i) => ({ symbol: s, bars: val(bars[i]) || [] })));
  const metrics = symbols.map((s, i) => compareMetrics(s, val(summaries[i]), quotes?.[s] || null, series.find((x) => x.symbol === s)));
  res.json({
    symbols, frame, series, metrics,
    errors: Object.fromEntries(symbols.map((s, i) => [s, bars[i].status === "rejected" ? String(bars[i].reason?.message || bars[i].reason) : val(bars[i])?.length ? null : "No prices"])),
  });
});

module.exports = router;
module.exports.autoMount = true; // WS1 auto-mount (server.js mounts routes/*.js with this flag)
