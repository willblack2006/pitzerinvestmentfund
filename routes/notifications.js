const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const { TYPES } = require("../lib/notify");

const router = express.Router();

router.get("/notifications", requireSignedIn, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const before = Number(req.query.before) || null;
  const rows = before
    ? db.prepare("SELECT * FROM notifications WHERE memberId = ? AND id < ? ORDER BY id DESC LIMIT ?").all(req.member.id, before, limit)
    : db.prepare("SELECT * FROM notifications WHERE memberId = ? ORDER BY id DESC LIMIT ?").all(req.member.id, limit);
  const unread = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE memberId = ? AND readAt IS NULL").get(req.member.id).c;
  res.json({ items: rows, unread, hasMore: rows.length === limit, types: TYPES });
});

// Mark read: one id, or everything (all: true).
router.post("/notifications/read", requireSignedIn, (req, res) => {
  if (req.body?.all) db.prepare("UPDATE notifications SET readAt = datetime('now') WHERE memberId = ? AND readAt IS NULL").run(req.member.id);
  else {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Pass an id or all: true." });
    db.prepare("UPDATE notifications SET readAt = datetime('now') WHERE id = ? AND memberId = ? AND readAt IS NULL").run(id, req.member.id);
  }
  res.json({ unread: db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE memberId = ? AND readAt IS NULL").get(req.member.id).c });
});

router.delete("/notifications/:id", requireSignedIn, (req, res) => {
  const info = db.prepare("DELETE FROM notifications WHERE id = ? AND memberId = ?").run(req.params.id, req.member.id);
  if (!info.changes) return res.status(404).json({ error: "Notification not found." });
  res.status(204).end();
});

module.exports = router;
