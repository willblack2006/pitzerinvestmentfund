const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const { isTaxLossCandidate, looksLikeSpinoff } = require("../lib/forcedSellers");

const router = express.Router();

router.get("/forced-sellers", async (req, res) => {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...owned, ...watched])];
  const now = new Date();
  const jan1 = `${now.getUTCFullYear()}-01-01`;

  const results = await Promise.allSettled(symbols.map(async (s) => {
    const [chart, filings] = await Promise.all([
      yahoo.getChart(s, "1y", "1d"),
      sec.getRecentFilings(s, ["8-K"]),
    ]);
    const ytd = chart.filter((p) => p.date >= jan1);
    const ytdReturnPct = ytd.length >= 2 ? ((ytd.at(-1).close / ytd[0].close - 1) * 100) : null;
    const spinoffs = filings.filter(looksLikeSpinoff).slice(0, 3);
    return { symbol: s, ytdReturnPct, spinoffs };
  }));

  const taxLoss = [], spinoffs = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const { symbol, ytdReturnPct, spinoffs: sp } = r.value;
    if (isTaxLossCandidate({ ytdReturnPct, asOfMonth: now.getUTCMonth() + 1 })) {
      taxLoss.push({ symbol, ytdReturnPct, owned: owned.includes(symbol) });
    }
    for (const f of sp) spinoffs.push({ symbol, ...f, owned: owned.includes(symbol) });
  });
  taxLoss.sort((a, b) => a.ytdReturnPct - b.ytdReturnPct);

  res.json({
    taxLoss, spinoffs,
    inSeason: [11, 12].includes(now.getUTCMonth() + 1),
    indexDeletions: { available: false, reason: "No free, reliable API for upcoming S&P/Russell index deletions in this stack." },
  });
});

module.exports = router;
