const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const { sizeBucket, valuationBucket, matchesBucket, oneYearForwardReturns, distributionStats } = require("../lib/baseRate");

const router = express.Router();
const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);

async function profileFor(symbol) {
  const qs = await yahoo.getQuoteSummary(symbol);
  const marketCap = raw(qs.summaryDetail?.marketCap) ?? raw(qs.price?.marketCap);
  const pe = raw(qs.summaryDetail?.trailingPE);
  const earningsYield = pe > 0 ? 1 / pe : null;
  return {
    symbol,
    sector: qs.assetProfile?.sector || null,
    marketCap,
    earningsYield,
    sizeBucket: sizeBucket(marketCap),
    valuationBucket: valuationBucket(earningsYield),
  };
}

router.get("/research/:symbol/base-rate", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const [target, peers] = await Promise.all([profileFor(symbol), yahoo.getPeers(symbol).catch(() => [])]);
    if (!target.sector || !target.sizeBucket) return res.json({ symbol, target, available: false, reason: "Not enough profile data (sector/market cap) for this ticker." });

    const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
    const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
    const universe = [...new Set([...owned, ...watched, ...peers.slice(0, 10)])].filter((s) => s !== symbol).slice(0, 30);

    const profiles = await Promise.allSettled(universe.map(profileFor));
    const matches = profiles.filter((r) => r.status === "fulfilled" && matchesBucket(r.value, target)).map((r) => r.value);

    const histories = await Promise.allSettled(matches.map((m) => yahoo.getChart(m.symbol, "5y", "1d")));
    const pooled = histories.flatMap((r) => (r.status === "fulfilled" ? oneYearForwardReturns(r.value) : []));
    const stats = distributionStats(pooled);

    res.json({
      symbol, target, available: true,
      matchedSymbols: matches.map((m) => m.symbol),
      universeSize: universe.length,
      stats,
    });
  } catch (err) {
    res.json({ symbol, available: false, error: err.message });
  }
});

module.exports = router;
