const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const finnhub = require("../lib/sources/finnhub");

const router = express.Router();

function settledValue(result) {
  return result.status === "fulfilled" ? result.value : null;
}

router.get("/research/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();

  const [chart, quoteSummary, peers, facts, news] = await Promise.allSettled([
    yahoo.getChart(symbol),
    yahoo.getQuoteSummary(symbol),
    yahoo.getPeers(symbol),
    sec.getCompanyFacts(symbol),
    finnhub.getCompanyNews(symbol),
  ]);

  const qs = settledValue(quoteSummary);
  const note = db.prepare("SELECT * FROM research_notes WHERE symbol = ?").get(symbol);

  res.json({
    symbol,
    profile: qs?.assetProfile || null,
    stats: {
      summaryDetail: qs?.summaryDetail || null,
      defaultKeyStatistics: qs?.defaultKeyStatistics || null,
      financialData: qs?.financialData || null,
      recommendationTrend: qs?.recommendationTrend || null,
    },
    financials: settledValue(facts),
    chart: settledValue(chart) || [],
    news: settledValue(news) || [],
    peers: settledValue(peers) || [],
    thesis: note || null,
    errors: {
      chart: chart.status === "rejected" ? String(chart.reason?.message || chart.reason) : null,
      quoteSummary: quoteSummary.status === "rejected" ? String(quoteSummary.reason?.message || quoteSummary.reason) : null,
      peers: peers.status === "rejected" ? String(peers.reason?.message || peers.reason) : null,
      financials: facts.status === "rejected" ? String(facts.reason?.message || facts.reason) : null,
      news: news.status === "rejected" ? String(news.reason?.message || news.reason) : null,
    },
  });
});

router.put("/research/:symbol/thesis", requireAuth, (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const { author, thesis } = req.body || {};
  db.prepare(`
    INSERT INTO research_notes (symbol, author, thesis, createdAt, updatedAt)
    VALUES (@symbol, @author, @thesis, datetime('now'), datetime('now'))
    ON CONFLICT(symbol) DO UPDATE SET
      author = excluded.author, thesis = excluded.thesis, updatedAt = datetime('now')
  `).run({ symbol, author: author || "", thesis: thesis || "" });
  res.json(db.prepare("SELECT * FROM research_notes WHERE symbol = ?").get(symbol));
});

module.exports = router;
