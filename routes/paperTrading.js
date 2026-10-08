const express = require("express");
const db = require("../db");
const { requireAuth, requireMember, optionalMember } = require("../middleware/auth");
const { latestPrices } = require("../lib/prices");
const benchmarks = require("../lib/benchmarks");
const { getSettings } = require("../lib/settings");
const { replayLedger, validateTrade, valuePortfolio, rankLeaderboard } = require("../lib/paperTrading");

const router = express.Router();

function semesterName(d = new Date()) {
  const m = d.getMonth() + 1;
  return `${m >= 8 ? "Fall" : m >= 6 ? "Summer" : "Spring"} ${d.getFullYear()}`;
}

// The open season; the first visit ever starts one named for the current semester.
function currentSeason() {
  let s = db.prepare("SELECT * FROM paper_seasons WHERE endedAt IS NULL ORDER BY id DESC LIMIT 1").get();
  if (!s) {
    const info = db.prepare("INSERT INTO paper_seasons (name) VALUES (?)").run(semesterName());
    s = db.prepare("SELECT * FROM paper_seasons WHERE id = ?").get(info.lastInsertRowid);
  }
  return s;
}

function tradesFor(seasonId, memberId) {
  return db.prepare("SELECT * FROM paper_trades WHERE seasonId = ? AND memberId = ? ORDER BY id").all(seasonId, memberId);
}

async function benchmarkReturnSince(startedAt) {
  try {
    const bench = getSettings().benchmark;
    const series = await benchmarks.series(bench, "5y");
    // A season that started today has no later bar yet; measure from the latest close (0%).
    const start = series.find((p) => p.date >= startedAt.slice(0, 10)) || series.at(-1);
    const last = series.at(-1);
    return start && last ? { label: benchmarks.shortName(bench), returnPct: last.close / start.close - 1 } : null;
  } catch {
    return null;
  }
}

router.get("/paper/seasons", (req, res) => {
  currentSeason();
  res.json(db.prepare("SELECT * FROM paper_seasons ORDER BY id DESC").all());
});

// Leaderboard for a season (default: the open one), plus the signed-in member's portfolio.
router.get("/paper", optionalMember, async (req, res) => {
  const open = currentSeason();
  const season = req.query.season ? db.prepare("SELECT * FROM paper_seasons WHERE id = ?").get(req.query.season) : open;
  if (!season) return res.status(404).json({ error: "Season not found." });

  const traders = db.prepare(`
    SELECT m.id, m.name, COUNT(t.id) AS tradeCount FROM paper_trades t JOIN members m ON m.id = t.memberId
    WHERE t.seasonId = ? GROUP BY m.id
  `).all(season.id);
  const states = new Map(traders.map((m) => [m.id, replayLedger(tradesFor(season.id, m.id), season.startingCash)]));
  if (req.member && !states.has(req.member.id)) states.set(req.member.id, replayLedger([], season.startingCash));

  const symbols = [...new Set([...states.values()].flatMap((s) => s.positions.map((p) => p.symbol)))];
  const quotes = symbols.length ? await latestPrices(symbols) : {};
  const prices = Object.fromEntries(Object.entries(quotes).map(([s, q]) => [s, q.price]));

  const leaderboard = rankLeaderboard(traders.map((m) => {
    const v = valuePortfolio(states.get(m.id), prices, season.startingCash);
    return { memberId: m.id, name: m.name, tradeCount: m.tradeCount, totalValue: v.totalValue, returnPct: v.returnPct, positions: v.positions.length };
  }));

  let mine = null;
  if (req.member) {
    mine = {
      member: req.member.name,
      ...valuePortfolio(states.get(req.member.id), prices, season.startingCash),
      trades: tradesFor(season.id, req.member.id).slice(-20).reverse(),
    };
  }

  res.json({ season, isOpen: season.id === open.id, leaderboard, mine, benchmark: await benchmarkReturnSince(season.startedAt) });
});

// Market order at the latest price (members can't type their own fill price).
router.post("/paper/trades", requireMember, async (req, res) => {
  const season = currentSeason();
  const symbol = String(req.body?.symbol || "").toUpperCase().trim();
  const type = String(req.body?.type || "");
  const shares = Number(req.body?.shares);
  const price = /^[A-Z0-9.\-^]{1,10}$/.test(symbol) ? (await latestPrices([symbol]))[symbol]?.price ?? null : null;
  const state = replayLedger(tradesFor(season.id, req.member.id), season.startingCash);
  const error = validateTrade(state, { type, symbol, shares, price });
  if (error) return res.status(400).json({ error });
  const info = db.prepare("INSERT INTO paper_trades (seasonId, memberId, type, symbol, shares, price) VALUES (?, ?, ?, ?, ?, ?)")
    .run(season.id, req.member.id, type, symbol, shares, price);
  res.status(201).json(db.prepare("SELECT * FROM paper_trades WHERE id = ?").get(info.lastInsertRowid));
});

// End the open season and start a new one (each semester). Past seasons stay viewable.
router.post("/paper/seasons", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim() || semesterName();
  const startingCash = req.body?.startingCash === undefined || req.body.startingCash === "" ? 100000 : Number(req.body.startingCash);
  if (!(startingCash > 0)) return res.status(400).json({ error: "Starting cash must be a positive number." });
  if (name.length > 60) return res.status(400).json({ error: "Season name is too long." });
  db.prepare("UPDATE paper_seasons SET endedAt = datetime('now') WHERE endedAt IS NULL").run();
  const info = db.prepare("INSERT INTO paper_seasons (name, startingCash) VALUES (?, ?)").run(name, startingCash);
  res.status(201).json(db.prepare("SELECT * FROM paper_seasons WHERE id = ?").get(info.lastInsertRowid));
});

module.exports = router;
