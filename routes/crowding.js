const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const finnhub = require("../lib/sources/finnhub");
const { volumeZScore, latestGapPct, newsAttentionRatio, scoreCrowding } = require("../lib/crowding");

const router = express.Router();

async function crowdingFor(symbol) {
  const [chartR, newsR] = await Promise.allSettled([
    yahoo.getChart(symbol, "6mo", "1d"),
    finnhub.apiKey() ? finnhub.getCompanyNews(symbol, 14) : Promise.resolve([]),
  ]);
  const chart = chartR.status === "fulfilled" ? chartR.value : [];
  const news = newsR.status === "fulfilled" ? newsR.value : [];

  const volumeZ = volumeZScore(chart);
  const gapPct = latestGapPct(chart);
  const cutoff = Date.now() - 3 * 864e5;
  const recentCount = news.filter((n) => n.datetime && new Date(n.datetime).getTime() >= cutoff).length;
  const newsRatio = newsAttentionRatio(recentCount, 3, news.length - recentCount, 11);

  return { symbol, volumeZ, gapPct, newsCount14d: news.length, ...scoreCrowding({ volumeZ, gapPct, newsRatio }) };
}

router.get("/crowding/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json(await crowdingFor(symbol));
  } catch (err) {
    res.json({ symbol, error: err.message });
  }
});

router.get("/crowding", async (req, res) => {
  const scope = ["holdings", "watchlist", "all"].includes(req.query.scope) ? req.query.scope : "all";
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  // An explicit ?symbols= list (e.g. the Discovery page's peer-suggested candidates, which
  // aren't on the watchlist yet) overrides the holdings/watchlist scope.
  const explicit = String(req.query.symbols || "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9.\-]{1,10}$/.test(s)).slice(0, 40);
  const symbols = explicit.length ? [...new Set(explicit)] : [...new Set([...(scope !== "watchlist" ? owned : []), ...(scope !== "holdings" ? watched : [])])];
  const results = await Promise.allSettled(symbols.map(crowdingFor));
  const rows = results.map((r, i) => (r.status === "fulfilled"
    ? { ...r.value, owned: owned.includes(r.value.symbol) }
    : { symbol: symbols[i], error: r.reason?.message || String(r.reason), owned: owned.includes(symbols[i]) }));
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  res.json({ scope, rows });
});

module.exports = router;
module.exports.crowdingFor = crowdingFor;
