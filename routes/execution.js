const express = require("express");
const yahoo = require("./../lib/sources/yahoo");
const { assessExecution } = require("../lib/execution");

const router = express.Router();

function etMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false, weekday: "short" })
    .formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  if (["Sat", "Sun"].includes(map.weekday)) return null; // weekend: no session-timing warning
  return Number(map.hour) * 60 + Number(map.minute);
}

router.get("/execution/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const direction = ["buy", "add", "trim", "sell"].includes(req.query.direction) ? req.query.direction : "buy";
  const orderShares = req.query.shares ? Number(req.query.shares) : null;
  try {
    const quotes = await yahoo.getQuotes([symbol]);
    const q = quotes[symbol];
    if (!q) return res.json({ symbol, error: "No live quote available." });
    const result = assessExecution({
      direction, bid: q.bid, ask: q.ask, avgDailyVolume: q.avgDailyVolume,
      orderShares: Number.isFinite(orderShares) && orderShares > 0 ? orderShares : null,
      etMinutes: etMinutesNow(),
    });
    res.json({ symbol, price: q.price, bid: q.bid, ask: q.ask, avgDailyVolume: q.avgDailyVolume, ...result });
  } catch (err) {
    res.json({ symbol, error: err.message });
  }
});

module.exports = router;
