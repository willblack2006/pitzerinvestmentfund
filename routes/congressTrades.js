const express = require("express");
const db = require("../db");
const house = require("../lib/sources/houseDisclosures");
const { matchTracked } = require("../lib/congressTrades");

const router = express.Router();
const DAYS = 60;

function trackedSymbols() {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  return { owned, tracked: [...new Set([...owned, ...watched])] };
}

// House members' reported trades (last 60 days of filings) in holdings and watchlist names,
// plus the most-traded tickers overall for context.
router.get("/congress-trades", async (req, res) => {
  try {
    const { filings, paperCount } = await house.getRecentPtrs(DAYS);
    const { owned, tracked } = trackedSymbols();
    const matched = matchTracked(filings, tracked).map((t) => ({ ...t, owned: owned.includes(t.ticker) }));
    const counts = new Map();
    for (const t of filings.flatMap((f) => f.trades)) counts.set(t.ticker, (counts.get(t.ticker) || 0) + 1);
    const mostTraded = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ticker, n]) => ({ ticker, n }));
    res.json({
      days: DAYS, matched, mostTraded,
      filingCount: filings.length,
      tradeCount: filings.reduce((s, f) => s + f.trades.length, 0),
      unreadable: filings.filter((f) => f.error).length,
      paperCount,
    });
  } catch (err) {
    res.json({ days: DAYS, matched: [], mostTraded: [], error: err.message });
  }
});

router.get("/research/:symbol/congress-trades", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const { filings } = await house.getRecentPtrs(DAYS);
    res.json({ symbol, days: DAYS, trades: matchTracked(filings, [symbol]) });
  } catch (err) {
    res.json({ symbol, days: DAYS, trades: [], error: err.message });
  }
});

module.exports = router;
