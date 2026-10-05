const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const finnhub = require("../lib/sources/finnhub");

const router = express.Router();

router.get("/screener", async (req, res) => {
  const holdings = db.prepare("SELECT symbol FROM positions ORDER BY symbol ASC").all().map((r) => r.symbol);
  const watchlisted = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const owned = new Set(holdings);
  const watched = new Set(watchlisted);

  const peerResults = await Promise.allSettled(holdings.map((s) => yahoo.getPeers(s)));

  const candidateSources = {}; // candidate symbol -> set of holdings that suggested it
  peerResults.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const peer of r.value) {
      if (owned.has(peer)) continue;
      if (!candidateSources[peer]) candidateSources[peer] = new Set();
      candidateSources[peer].add(holdings[i]);
    }
  });

  // Rank by how many holdings suggested each candidate BEFORE capping, so the cap drops
  // the weakest candidates rather than arbitrary ones.
  const candidates = Object.keys(candidateSources)
    .sort((a, b) => candidateSources[b].size - candidateSources[a].size)
    .slice(0, 40);
  const metricResults = await Promise.allSettled(candidates.map((s) => finnhub.getMetrics(s)));

  const ranked = candidates.map((symbol, i) => {
    const metrics = metricResults[i].status === "fulfilled" ? metricResults[i].value : null;
    return {
      symbol,
      sourcedFrom: [...candidateSources[symbol]],
      watched: watched.has(symbol),
      peTTM: metrics?.peTTM ?? null,
      marketCap: metrics?.marketCap ?? null,
      revenueGrowthTTM: metrics?.revenueGrowthTTM ?? null,
      priceChange1Y: metrics?.priceChange1Y ?? null,
    };
  });

  ranked.sort((a, b) => b.sourcedFrom.length - a.sourcedFrom.length);

  res.json({ holdingsCount: holdings.length, candidates: ranked });
});

module.exports = router;
