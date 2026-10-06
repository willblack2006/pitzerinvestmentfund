const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const finra = require("../lib/sources/finra");
const { scoreShortPressure } = require("../lib/shortPressure");

const router = express.Router();

// Yahoo wraps numbers as { raw, fmt } and sends {} when a value is missing.
const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);

async function shortPressureFor(symbol) {
  const qs = await yahoo.getQuoteSummary(symbol);
  const ks = qs.defaultKeyStatistics || {};
  const daysToCover = raw(ks.shortRatio);
  const shortPctFloat = raw(ks.shortPercentOfFloat);
  const shortShares = raw(ks.sharesShort);
  const priorShortShares = raw(ks.sharesShortPriorMonth);
  const shortChangePct = shortShares && priorShortShares ? shortShares / priorShortShares - 1 : null;

  let finraSeries = [];
  try { finraSeries = await finra.getShortVolumeHistory(symbol, 20); } catch { /* best effort */ }

  const scored = scoreShortPressure({ daysToCover, shortPctFloat, shortChangePct, finraSeries });
  return {
    symbol, daysToCover, shortPctFloat, shortChangePct, shortShares, priorShortShares,
    asOf: ks.dateShortInterest?.fmt || null, finra: finraSeries, ...scored,
  };
}

// Short-pressure detail for one ticker (Research → Risk tab panel).
router.get("/short-pressure/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json(await shortPressureFor(symbol));
  } catch (err) {
    res.json({ symbol, error: err.message });
  }
});

// Short-pressure ranked across holdings and/or the watchlist (Market tab).
router.get("/short-pressure", async (req, res) => {
  const scope = ["holdings", "watchlist", "all"].includes(req.query.scope) ? req.query.scope : "all";
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...(scope !== "watchlist" ? owned : []), ...(scope !== "holdings" ? watched : [])])];
  const results = await Promise.allSettled(symbols.map(shortPressureFor));
  const rows = results.map((r, i) => (r.status === "fulfilled"
    ? (({ symbol, score, label, daysToCover, shortPctFloat, shortChangePct, reasons }) => ({ symbol, score, label, daysToCover, shortPctFloat, shortChangePct, topReason: reasons[0], owned: owned.includes(symbol) }))(r.value)
    : { symbol: symbols[i], error: r.reason?.message || String(r.reason), owned: owned.includes(symbols[i]) }));
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  res.json({ scope, rows });
});

module.exports = router;
module.exports.shortPressureFor = shortPressureFor;
