const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const { KINDS, check } = require("../lib/tripwires");

const router = express.Router();
const bad = (res, msg) => res.status(400).json({ error: msg });

router.get("/tripwires", async (req, res) => {
  const sym = String(req.query.symbol || "").toUpperCase();
  await check().catch(() => {});
  const rows = sym
    ? db.prepare("SELECT * FROM tripwires WHERE symbol = ? AND status != 'resolved' ORDER BY id").all(sym)
    : db.prepare("SELECT * FROM tripwires WHERE status != 'resolved' ORDER BY symbol, id").all();
  res.json(rows);
});

router.post("/tripwires", requireSignedIn, (req, res) => {
  const b = req.body || {};
  const symbol = String(b.symbol || "").toUpperCase().trim();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) return bad(res, "Enter a valid ticker.");
  if (!KINDS.includes(b.kind)) return bad(res, "Pick a tripwire type.");
  const note = String(b.note || "").slice(0, 300);
  let value = null, dueDate = null;
  if (b.kind.startsWith("price_")) {
    value = Number(b.value);
    if (!(value > 0)) return bad(res, "Enter a price above zero.");
  } else if (b.kind === "review_by") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || "")) return bad(res, "Pick a review date.");
    dueDate = b.dueDate;
  } else if (!note.trim()) return bad(res, "Describe the condition.");
  const info = db.prepare("INSERT INTO tripwires (symbol, kind, value, dueDate, note, authorId, author) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(symbol, b.kind, value, dueDate, note, req.member.id, req.member.name);
  res.status(201).json(db.prepare("SELECT * FROM tripwires WHERE id = ?").get(info.lastInsertRowid));
});

// action: "trip" (a custom condition has happened), "reset" (re-arm after a decision), "resolve" (remove).
router.post("/tripwires/:id/:action", requireSignedIn, (req, res) => {
  const t = db.prepare("SELECT * FROM tripwires WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Tripwire not found." });
  const { action } = req.params;
  if (action === "trip") {
    if (t.status !== "active") return bad(res, "Already tripped.");
    db.prepare("UPDATE tripwires SET status = 'tripped', trippedAt = datetime('now'), trippedDetail = ? WHERE id = ?").run(`Marked tripped by ${req.member.name}.`, t.id);
  } else if (action === "reset") {
    db.prepare("UPDATE tripwires SET status = 'active', trippedAt = NULL, trippedDetail = '' WHERE id = ?").run(t.id);
  } else if (action === "resolve") {
    db.prepare("UPDATE tripwires SET status = 'resolved' WHERE id = ?").run(t.id);
  } else return bad(res, "Unknown action.");
  res.json(db.prepare("SELECT * FROM tripwires WHERE id = ?").get(t.id));
});

module.exports = router;
