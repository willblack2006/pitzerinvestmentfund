const express = require("express");
const today = require("../lib/today");
const { SLOTS } = require("../lib/marketNews");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const { getPrefs } = require("../lib/prefs");
const yahoo = require("../lib/sources/yahoo");
const finnhub = require("../lib/sources/finnhub");
const { replayLedger, valuePortfolio } = require("../lib/paperTrading");

const router = express.Router();

// Which editions exist for the last 4 weekdays, plus the requested one (or the latest).
// Read-only: never triggers a capture or an AI call.
router.get("/today/editions", async (req, res) => {
  const editions = today.listEditions();
  const { date, slot } = req.query;
  let edition = null;
  if (date || slot) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !SLOTS.some((s) => s.key === slot)) return res.status(400).json({ error: "Pass ?date=YYYY-MM-DD&slot=premarket|midday|postmarket" });
    if (!editions.some((d) => d.date === date)) return res.status(400).json({ error: "Editions are kept for today and the previous 3 weekdays." });
    edition = today.getEdition(date, slot);
  } else {
    edition = today.latestEdition();
  }
  res.json({
    editions,
    edition,
    liveHeadlines: edition || date ? null : await today.liveHeadlines(),
    aiEnabled: today.recapEnabled(),
  });
});

// Live market numbers, sectors, movers, Fed and this week's events (not stored).
router.get("/today/live", async (req, res) => {
  try {
    res.json(await today.liveSide());
  } catch (err) {
    res.status(502).json({ error: `Live market data unavailable: ${err.message}` });
  }
});

// "For you" (signed in): your followed tickers, your notes, chat that needs you, pitches
// waiting for your vote and your paper portfolio's day. Each part fails soft on its own.
router.get("/today/foryou", requireSignedIn, async (req, res) => {
  const me = req.member;
  const tickers = (getPrefs(me.id).myTickers || []).slice(0, 12);

  const season = db.prepare("SELECT * FROM paper_seasons WHERE endedAt IS NULL ORDER BY id DESC LIMIT 1").get();
  const paperState = season ? replayLedger(db.prepare("SELECT * FROM paper_trades WHERE seasonId = ? AND memberId = ? AND status = 'filled' ORDER BY COALESCE(filledAt, createdAt), id").all(season.id, me.id), season.startingCash) : null;
  const paperSymbols = paperState?.positions.map((p) => p.symbol) || [];

  let quotes = {};
  try { if (tickers.length || paperSymbols.length) quotes = await yahoo.getQuotes([...tickers, ...paperSymbols]); } catch { /* prices unavailable */ }

  // Latest headline per followed ticker (Finnhub, cached 30 minutes per ticker).
  const news = {};
  await Promise.all(tickers.slice(0, 8).map(async (t) => {
    try { const n = (await finnhub.getCompanyNews(t, 3))[0]; if (n) news[t] = { headline: n.headline, url: n.url, source: n.source, datetime: n.datetime }; } catch { /* no key or no news */ }
  }));

  const notes = db.prepare("SELECT id, symbol, pageRef, pageTitle, body, quote, updatedAt FROM notes WHERE memberId = ? ORDER BY pinned DESC, updatedAt DESC LIMIT 3").all(me.id)
    .map((n) => ({ ...n, body: n.body.slice(0, 160), quote: n.quote.slice(0, 120) }));

  const lastRead = db.prepare("SELECT lastReadId FROM chat_reads WHERE memberId = ?").get(me.id)?.lastReadId || 0;
  const unread = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE id > ? AND memberId != ? AND deletedAt IS NULL").get(lastRead, me.id).c;
  const mentions = db.prepare(`SELECT c.id, c.body, c.createdAt, m.name AS by FROM chat_messages c JOIN members m ON m.id = c.memberId
    WHERE c.id > ? AND c.deletedAt IS NULL AND (',' || trim(c.mentions, '[]') || ',') LIKE ? ORDER BY c.id DESC LIMIT 3`).all(lastRead, `%,${me.id},%`)
    .map((x) => ({ ...x, body: x.body.slice(0, 140) }));

  const toVote = db.prepare(`SELECT p.id, p.symbol, p.direction, p.title, p.author FROM pitches p
    WHERE p.status = 'voting' AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.pitchId = p.id AND v.memberId = ?) ORDER BY p.id DESC LIMIT 5`).all(me.id);

  let paper = null;
  if (paperState && (paperState.positions.length || paperState.cash !== season.startingCash)) {
    const prices = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, q.price]));
    const v = valuePortfolio(paperState, prices, season.startingCash);
    const dayChange = paperState.positions.reduce((sum, p) => sum + (Number.isFinite(quotes[p.symbol]?.change) ? p.shares * quotes[p.symbol].change : 0), 0);
    paper = { season: season.name, totalValue: v.totalValue, returnPct: v.returnPct, dayChange: Math.round(dayChange * 100) / 100, positions: v.positions.length };
  }

  res.json({
    tickers: tickers.map((t) => ({ symbol: t, name: quotes[t]?.name || null, price: quotes[t]?.price ?? null, changePct: quotes[t]?.changePct ?? null, news: news[t] || null })),
    notes, chat: { unread, mentions }, toVote, paper,
  });
});

module.exports = router;
