const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { getCached, setCached } = require("../lib/cache");
const finnhub = require("../lib/sources/finnhub");
const claude = require("../lib/sources/claude");
const { parseTriageResponse, topItems, headlineKey } = require("../lib/newsTriage");

const router = express.Router();
const TTL = 7 * 24 * 60 * 60; // a headline's score never changes; keep it a week to bound cache growth

// Scores whichever of `news` aren't already cached (one batched Claude call per symbol),
// caches each result by headline key, and returns every headline with its score attached.
async function triageSymbol(symbol, news) {
  const results = news.map((n) => ({ ...n, key: headlineKey(n.url || n.headline) }));
  const uncached = results.filter((n) => !getCached(`news_triage_${n.key}`));
  if (uncached.length) {
    const text = await claude.triageHeadlines(symbol, uncached.map((n) => n.headline));
    const parsed = parseTriageResponse(text, uncached.length);
    if (parsed) uncached.forEach((n, i) => setCached(`news_triage_${n.key}`, parsed[i], TTL, "news_triage"));
  }
  return results.map((n) => ({ ...n, ...(getCached(`news_triage_${n.key}`) || { materiality: null, direction: null, reason: null }) }));
}

// Read-only: whatever's already cached for this symbol (never triggers a Claude call).
router.get("/research/:symbol/news-triage", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const news = finnhub.apiKey() ? await finnhub.getCompanyNews(symbol) : [];
    const scored = news.map((n) => ({ ...n, ...(getCached(`news_triage_${headlineKey(n.url || n.headline)}`) || { materiality: null, direction: null, reason: null }) }));
    res.json({ symbol, items: scored, top: topItems(scored.filter((n) => n.materiality !== null), 5), aiEnabled: claude.configured() });
  } catch (err) {
    res.json({ symbol, items: [], top: [], error: err.message, aiEnabled: claude.configured() });
  }
});

// Triggers scoring for this symbol (costs API credit; edit-unlocked only).
router.post("/research/:symbol/news-triage", requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  if (!claude.configured()) return res.status(503).json({ error: "News triage needs ANTHROPIC_API_KEY set on the server." });
  try {
    const news = finnhub.apiKey() ? await finnhub.getCompanyNews(symbol) : [];
    if (!news.length) return res.json({ symbol, items: [], top: [] });
    const scored = await triageSymbol(symbol, news);
    res.json({ symbol, items: scored, top: topItems(scored, 5) });
  } catch (err) {
    res.status(502).json({ error: `Triage failed: ${err.message}` });
  }
});

// Daily bulk trigger across every holding (edit-unlocked only; one batched call per symbol).
router.post("/news-triage/run", requireAuth, async (req, res) => {
  if (!claude.configured()) return res.status(503).json({ error: "News triage needs ANTHROPIC_API_KEY set on the server." });
  if (!finnhub.apiKey()) return res.status(503).json({ error: "News triage needs FINNHUB_API_KEY set on the server." });
  const positions = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const results = await Promise.allSettled(positions.map(async (sym) => {
    const news = await finnhub.getCompanyNews(sym);
    const scored = news.length ? await triageSymbol(sym, news) : [];
    return { symbol: sym, top: topItems(scored, 3) };
  }));
  const bySymbol = results.map((r, i) => (r.status === "fulfilled" ? r.value : { symbol: positions[i], error: r.reason?.message || String(r.reason) }));
  res.json({ bySymbol, generatedAt: new Date().toISOString() });
});

module.exports = router;
