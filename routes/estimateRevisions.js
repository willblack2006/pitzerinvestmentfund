const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const { scoreEstimateRevisions } = require("../lib/estimateRevision");

const router = express.Router();

const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);

function estimatesFromQuoteSummary(qs) {
  return (qs.earningsTrend?.trend || []).map((t) => ({
    period: t.period,
    epsTrend: t.epsTrend ? { current: raw(t.epsTrend.current), d7: raw(t.epsTrend["7daysAgo"]), d30: raw(t.epsTrend["30daysAgo"]), d60: raw(t.epsTrend["60daysAgo"]), d90: raw(t.epsTrend["90daysAgo"]) } : null,
    revisions: t.epsRevisions ? { up7: raw(t.epsRevisions.upLast7days), up30: raw(t.epsRevisions.upLast30days), down7: raw(t.epsRevisions.downLast7Days), down30: raw(t.epsRevisions.downLast30days) } : null,
  }));
}

async function revisionScoreFor(symbol) {
  const qs = await yahoo.getQuoteSummary(symbol);
  const scored = scoreEstimateRevisions(estimatesFromQuoteSummary(qs));
  return { symbol, ...scored };
}

router.get("/estimate-revisions/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json(await revisionScoreFor(symbol));
  } catch (err) {
    res.json({ symbol, error: err.message });
  }
});

router.get("/estimate-revisions", async (req, res) => {
  const scope = ["holdings", "watchlist", "all"].includes(req.query.scope) ? req.query.scope : "all";
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...(scope !== "watchlist" ? owned : []), ...(scope !== "holdings" ? watched : [])])];
  const results = await Promise.allSettled(symbols.map(revisionScoreFor));
  const rows = results.map((r, i) => (r.status === "fulfilled"
    ? (({ symbol, score, label, reasons }) => ({ symbol, score, label, topReason: reasons[0], owned: owned.includes(symbol) }))(r.value)
    : { symbol: symbols[i], error: r.reason?.message || String(r.reason), owned: owned.includes(symbols[i]) }));
  rows.sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  res.json({ scope, rows });
});

module.exports = router;
module.exports.revisionScoreFor = revisionScoreFor;
