const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const { cleanAlert, MAX_PER_MEMBER } = require("../lib/memberAlerts");

const router = express.Router();
const mine = (req, id) => db.prepare("SELECT * FROM member_alerts WHERE id = ? AND memberId = ?").get(id, req.member.id);

router.get("/my-alerts", requireSignedIn, (req, res) => {
  const sym = String(req.query.symbol || "").toUpperCase();
  const rows = sym
    ? db.prepare("SELECT * FROM member_alerts WHERE memberId = ? AND symbol = ? ORDER BY active DESC, id DESC").all(req.member.id, sym)
    : db.prepare("SELECT * FROM member_alerts WHERE memberId = ? ORDER BY active DESC, symbol, id DESC").all(req.member.id);
  res.json(rows);
});

router.post("/my-alerts", requireSignedIn, (req, res) => {
  let a;
  try { a = cleanAlert(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (db.prepare("SELECT COUNT(*) AS c FROM member_alerts WHERE memberId = ?").get(req.member.id).c >= MAX_PER_MEMBER) {
    return res.status(400).json({ error: `You can have up to ${MAX_PER_MEMBER} alerts; delete some first.` });
  }
  const info = db.prepare("INSERT INTO member_alerts (memberId, symbol, kind, value, note) VALUES (?, ?, ?, ?, ?)").run(req.member.id, a.symbol, a.kind, a.value, a.note || "");
  res.status(201).json(mine(req, info.lastInsertRowid));
});

// Edit, pause or re-arm (active: true turns a fired alert back on).
router.put("/my-alerts/:id", requireSignedIn, (req, res) => {
  const cur = mine(req, req.params.id);
  if (!cur) return res.status(404).json({ error: "Alert not found." });
  let a;
  try { a = cleanAlert({ kind: cur.kind, ...req.body }, { partial: true }); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const next = { ...cur, ...a };
  if (req.body?.active !== undefined) next.active = req.body.active ? 1 : 0;
  db.prepare("UPDATE member_alerts SET symbol = ?, kind = ?, value = ?, note = ?, active = ? WHERE id = ?").run(next.symbol, next.kind, next.value, next.note, next.active, cur.id);
  res.json(mine(req, cur.id));
});

router.delete("/my-alerts/:id", requireSignedIn, (req, res) => {
  const info = db.prepare("DELETE FROM member_alerts WHERE id = ? AND memberId = ?").run(req.params.id, req.member.id);
  if (!info.changes) return res.status(404).json({ error: "Alert not found." });
  res.status(204).end();
});

module.exports = router;
