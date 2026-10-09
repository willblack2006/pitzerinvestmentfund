const express = require("express");
const db = require("../db");
const { requireSignedIn, requireAdmin, optionalMember } = require("../middleware/auth");
const { benchmarkFor } = require("../lib/prefs");
const { getSettings } = require("../lib/settings");
const { HORIZONS, DEFAULT_RULES } = require("../lib/paperTrading");
const S = require("../lib/paperSeason");

const router = express.Router();
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

router.get("/paper/seasons", (req, res) => {
  S.currentSeason();
  res.json(db.prepare("SELECT * FROM paper_seasons ORDER BY id DESC").all());
});

// Leaderboard for a season (default: the open one), plus the signed-in member's portfolio.
router.get("/paper", optionalMember, async (req, res) => {
  const open = S.currentSeason();
  const season = req.query.season ? db.prepare("SELECT * FROM paper_seasons WHERE id = ?").get(req.query.season) : open;
  if (!season) return res.status(404).json({ error: "Season not found." });
  try { await S.fillPending(); } catch { /* fills retry on the next visit or scheduler tick */ }
  let bench;
  try { bench = benchmarkFor(req); } catch { bench = getSettings().benchmark; }
  const st = await S.standings(season, { viewerId: req.member?.id || null, bench });
  res.json({ season, isOpen: season.id === open.id, horizons: HORIZONS, ...st, mine: st.mine && { member: req.member.name, ...st.mine } });
});

// Market order. While the market is open it fills at the live price; otherwise it waits for the
// next session's opening price. Every order needs a reason.
router.post("/paper/trades", requireSignedIn, async (req, res) => {
  try {
    const t = await S.placeOrder(S.currentSeason(), req.member, req.body || {});
    res.status(201).json(t);
  } catch (e) { fail(res, e); }
});

// Cancel one of your orders that's still waiting for the open.
router.delete("/paper/trades/:id", requireSignedIn, (req, res) => {
  try { S.cancelOrder(req.member.id, req.params.id); res.status(204).end(); } catch (e) { fail(res, e); }
});

// End the open season and start a new one (each semester). Past seasons stay viewable.
// Admins can set this season's rules; anything left out uses the defaults.
router.post("/paper/seasons", requireAdmin, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim() || S.semesterName();
  const num = (k, { min = 0, max = Infinity } = {}) => {
    if (b[k] === undefined || b[k] === "" || b[k] === null) return DEFAULT_RULES[k];
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`${k} must be between ${min} and ${max}.`), { status: 400 });
    return v;
  };
  let rules, startingCash;
  try {
    startingCash = b.startingCash === undefined || b.startingCash === "" ? 100000 : Number(b.startingCash);
    if (!(startingCash > 0)) throw Object.assign(new Error("Starting cash must be a positive number."), { status: 400 });
    rules = { feeBps: num("feeBps", { max: 500 }), minHoldings: num("minHoldings", { max: 30 }), maxPositionPct: num("maxPositionPct", { min: 1, max: 100 }), minPrice: num("minPrice", { max: 1000 }), minMarketCap: num("minMarketCap") };
  } catch (e) { return fail(res, e); }
  if (name.length > 60) return res.status(400).json({ error: "Season name is too long." });
  db.prepare("UPDATE paper_trades SET status = 'cancelled', cancelReason = 'The season ended.' WHERE status = 'pending'").run();
  db.prepare("UPDATE paper_seasons SET endedAt = datetime('now') WHERE endedAt IS NULL").run();
  const info = db.prepare("INSERT INTO paper_seasons (name, startingCash, feeBps, minHoldings, maxPositionPct, minPrice, minMarketCap) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(name, startingCash, rules.feeBps, rules.minHoldings, rules.maxPositionPct, rules.minPrice, rules.minMarketCap);
  res.status(201).json(db.prepare("SELECT * FROM paper_seasons WHERE id = ?").get(info.lastInsertRowid));
});

module.exports = router;
