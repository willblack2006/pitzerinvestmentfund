const express = require("express");
const db = require("../db");
const { histories } = require("../lib/prices");
const benchmarks = require("../lib/benchmarks");
const { getSettings } = require("../lib/settings");
const yahoo = require("../lib/sources/yahoo");
const { didHitTarget, brierScore, hitRate, calibrationBuckets, groupStats } = require("../lib/calibration");

const router = express.Router();

// Decided calls with a confidence level, a base-case target, and a horizon — everything the
// journal needs to grade. Pending ones (horizon not reached) are reported separately.
router.get("/track-record", async (req, res) => {
  const pitches = db.prepare(`
    SELECT * FROM pitches WHERE confidencePct IS NOT NULL AND horizonMonths IS NOT NULL AND basePrice IS NOT NULL
      AND status IN ('approved', 'rejected', 'executed')
    ORDER BY createdAt
  `).all();
  if (!pitches.length) return res.json({ rows: [], pending: [], brier: null, hitRate: null, buckets: [], byAnalyst: {}, bySector: {}, byDirection: {} });

  const symbols = [...new Set(pitches.map((p) => p.symbol))];
  const [priceHistories, benchSeries] = await Promise.all([
    histories(symbols, "5y"),
    benchmarks.series(getSettings().benchmark, "5y").catch(() => []),
  ]);
  const benchByDate = new Map(benchSeries.map((p) => [p.date, p.close]));
  // Sector lookup is best-effort and cached long-term; a miss just drops that pitch from the
  // by-sector breakdown rather than failing the whole page.
  const sectors = {};
  await Promise.all(symbols.map(async (s) => {
    try { sectors[s] = (await yahoo.getSector(s)).sector || "Unknown"; } catch { sectors[s] = "Unknown"; }
  }));

  const rows = [], pending = [];
  for (const p of pitches) {
    const series = priceHistories[p.symbol] || [];
    const horizonDate = new Date(new Date(p.createdAt).getTime() + p.horizonMonths * 30 * 864e5).toISOString().slice(0, 10);
    const outcome = didHitTarget({ direction: p.direction, basePrice: p.basePrice, series, horizonDate });
    const pitchDate = p.createdAt.slice(0, 10);
    const atHorizon = series.filter((pt) => pt.date <= horizonDate).at(-1);
    const atPitch = series.find((pt) => pt.date >= pitchDate) || series[0];
    const ret = atHorizon && atPitch ? atHorizon.close / atPitch.close - 1 : null;
    const benchStart = [...benchByDate.keys()].find((d) => d >= pitchDate);
    const benchEnd = [...benchByDate.keys()].filter((d) => d <= horizonDate).at(-1);
    const benchReturn = benchStart && benchEnd && benchByDate.has(benchStart) && benchByDate.has(benchEnd)
      ? benchByDate.get(benchEnd) / benchByDate.get(benchStart) - 1 : null;
    const row = {
      id: p.id, symbol: p.symbol, direction: p.direction, author: p.author, sector: sectors[p.symbol] || "Unknown",
      confidencePct: p.confidencePct, horizonMonths: p.horizonMonths, horizonDate, basePrice: p.basePrice,
      outcome, return: ret, benchReturn, excessReturn: ret !== null && benchReturn !== null ? ret - benchReturn : null,
    };
    if (outcome === null) pending.push(row);
    else rows.push(row);
  }

  const items = rows.map((r) => ({ p: r.confidencePct / 100, outcome: r.outcome ? 1 : 0, analyst: r.author, sector: r.sector, direction: r.direction }));
  res.json({
    rows, pending,
    brier: brierScore(items),
    hitRate: hitRate(items),
    buckets: calibrationBuckets(items),
    byAnalyst: groupStats(items, (x) => x.analyst || "Unknown"),
    bySector: groupStats(items, (x) => x.sector || "Unknown"),
    byDirection: groupStats(items, (x) => x.direction || "Unknown"),
  });
});

module.exports = router;
