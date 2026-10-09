const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const events = require("../lib/events");
const chat = require("../lib/chat");
const { notify } = require("../lib/notify");

const router = express.Router();

// ---- Shaping messages for the client ----

const nameOf = (id) => db.prepare("SELECT name FROM members WHERE id = ?").get(id)?.name || "Former member";

function shape(m, me) {
  const reactions = db.prepare("SELECT emoji, COUNT(*) AS count, SUM(memberId = ?) AS mine FROM chat_reactions WHERE messageId = ? GROUP BY emoji").all(me.id, m.id)
    .map((r) => ({ emoji: r.emoji, count: r.count, mine: !!r.mine }));
  let reply = null;
  if (m.replyTo) {
    const p = db.prepare("SELECT id, memberId, body, deletedAt FROM chat_messages WHERE id = ?").get(m.replyTo);
    if (p) reply = { id: p.id, authorName: nameOf(p.memberId), snippet: p.deletedAt ? "(deleted)" : p.body.slice(0, 120) };
  }
  const deleted = !!m.deletedAt;
  return {
    id: m.id, memberId: m.memberId, authorName: nameOf(m.memberId),
    body: deleted ? "" : m.body,
    attachment: deleted || !m.attachment ? null : JSON.parse(m.attachment),
    image: deleted || !m.imageId ? null : `/api/chat/images/${m.imageId}`,
    reply, mentions: JSON.parse(m.mentions || "[]"),
    createdAt: m.createdAt, editedAt: m.editedAt, deleted,
    reactions: deleted ? [] : reactions,
    canEdit: chat.canEdit(m, me), canDelete: chat.canDelete(m, me),
  };
}
const byId = (id) => db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id);

// Everyone online gets the same event; each client asks for its own view (canEdit etc.) only
// when it needs it, so the broadcast carries the public parts and the author's id.
function broadcast(type, m) {
  const view = shape(m, { id: -1, isAdmin: false });
  delete view.canEdit; delete view.canDelete;
  events.publish(type, view, { membersOnly: true });
}

// ---- Reading ----

// Newest page of messages (before=id loads older ones). Oldest first in the response.
router.get("/chat/messages", requireSignedIn, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const before = Number(req.query.before) || null;
  const rows = before
    ? db.prepare("SELECT * FROM chat_messages WHERE id < ? ORDER BY id DESC LIMIT ?").all(before, limit)
    : db.prepare("SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?").all(limit);
  res.json({ messages: rows.reverse().map((m) => shape(m, req.member)), hasMore: rows.length === limit });
});

router.get("/chat/messages/:id", requireSignedIn, (req, res) => {
  const m = byId(req.params.id);
  if (!m) return res.status(404).json({ error: "Message not found." });
  res.json(shape(m, req.member));
});

router.get("/chat/unread", requireSignedIn, (req, res) => {
  const last = db.prepare("SELECT lastReadId FROM chat_reads WHERE memberId = ?").get(req.member.id)?.lastReadId || 0;
  const unread = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE id > ? AND memberId != ? AND deletedAt IS NULL").get(last, req.member.id).c;
  // mentions is a JSON list like [3,12]; match the exact id (so 1 doesn't match 11).
  const mentions = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE id > ? AND deletedAt IS NULL AND (',' || trim(mentions, '[]') || ',') LIKE ?").get(last, `%,${req.member.id},%`).c;
  res.json({ unread, mentions, lastReadId: last, online: events.onlineMemberIds() });
});

router.post("/chat/read", requireSignedIn, (req, res) => {
  const id = Number(req.body?.lastReadId) || 0;
  db.prepare(`INSERT INTO chat_reads (memberId, lastReadId) VALUES (?, ?)
    ON CONFLICT(memberId) DO UPDATE SET lastReadId = MAX(lastReadId, excluded.lastReadId)`).run(req.member.id, id);
  res.status(204).end();
});

// ---- Writing ----

// At most 10 messages a minute per member (in memory; resets on restart, which is fine).
const recent = new Map();
function rateLimited(memberId) {
  const now = Date.now();
  const list = (recent.get(memberId) || []).filter((t) => now - t < 60e3);
  if (list.length >= 10) return true;
  list.push(now);
  recent.set(memberId, list);
  return false;
}

router.post("/chat/messages", requireSignedIn, (req, res) => {
  let msg;
  try { msg = chat.cleanMessage(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (msg.imageId && !db.prepare("SELECT 1 FROM chat_images WHERE id = ? AND memberId = ?").get(msg.imageId, req.member.id)) return res.status(400).json({ error: "That image wasn't found." });
  if (msg.replyTo && !byId(msg.replyTo)) return res.status(400).json({ error: "The message you're replying to is gone." });
  if (rateLimited(req.member.id)) return res.status(429).json({ error: "Slow down a little: at most 10 messages a minute." });
  const members = db.prepare("SELECT id, name FROM members WHERE active = 1").all();
  const mentions = chat.parseMentions(msg.body, members).filter((id) => id !== req.member.id);
  const info = db.prepare("INSERT INTO chat_messages (memberId, body, attachment, imageId, replyTo, mentions) VALUES (?, ?, ?, ?, ?, ?)")
    .run(req.member.id, msg.body, msg.attachment ? JSON.stringify(msg.attachment) : null, msg.imageId, msg.replyTo, JSON.stringify(mentions));
  const m = byId(info.lastInsertRowid);
  broadcast("chat.message", m);
  if (mentions.length) events.publish("chat.mention", { id: m.id, by: req.member.name, snippet: msg.body.slice(0, 140) }, { membersOnly: true, to: mentions });
  if (mentions.length) notify(mentions, { type: "mention", title: `${req.member.name} mentioned you in the club chat`, body: msg.body.slice(0, 200), link: "#/chat" });
  res.status(201).json(shape(m, req.member));
});

router.put("/chat/messages/:id", requireSignedIn, (req, res) => {
  const m = byId(req.params.id);
  if (!m) return res.status(404).json({ error: "Message not found." });
  if (!chat.canEdit(m, req.member)) return res.status(403).json({ error: "You can only edit your own messages, within 15 minutes." });
  const body = String(req.body?.body ?? "").trim();
  if (body.length > chat.MAX_BODY) return res.status(400).json({ error: `Messages are limited to ${chat.MAX_BODY} characters.` });
  if (!body && !m.attachment && !m.imageId) return res.status(400).json({ error: "A message can't be empty; delete it instead." });
  const members = db.prepare("SELECT id, name FROM members WHERE active = 1").all();
  db.prepare("UPDATE chat_messages SET body = ?, mentions = ?, editedAt = datetime('now') WHERE id = ?")
    .run(body, JSON.stringify(chat.parseMentions(body, members).filter((id) => id !== req.member.id)), m.id);
  const updated = byId(m.id);
  broadcast("chat.edited", updated);
  res.json(shape(updated, req.member));
});

// The author or an admin removes a message; it stays as "(deleted)" so replies still make sense.
router.delete("/chat/messages/:id", requireSignedIn, (req, res) => {
  const m = byId(req.params.id);
  if (!m) return res.status(404).json({ error: "Message not found." });
  if (!chat.canDelete(m, req.member)) return res.status(403).json({ error: "You can only delete your own messages." });
  db.prepare("UPDATE chat_messages SET deletedAt = datetime('now') WHERE id = ?").run(m.id);
  db.prepare("DELETE FROM chat_reactions WHERE messageId = ?").run(m.id);
  if (m.imageId) db.prepare("DELETE FROM chat_images WHERE id = ?").run(m.imageId);
  broadcast("chat.deleted", byId(m.id));
  res.status(204).end();
});

// Toggle one of the fixed reactions.
router.post("/chat/messages/:id/react", requireSignedIn, (req, res) => {
  const m = byId(req.params.id);
  if (!m || m.deletedAt) return res.status(404).json({ error: "Message not found." });
  const emoji = req.body?.emoji;
  if (!chat.REACTIONS.includes(emoji)) return res.status(400).json({ error: "Unknown reaction." });
  const had = db.prepare("SELECT 1 FROM chat_reactions WHERE messageId = ? AND memberId = ? AND emoji = ?").get(m.id, req.member.id, emoji);
  if (had) db.prepare("DELETE FROM chat_reactions WHERE messageId = ? AND memberId = ? AND emoji = ?").run(m.id, req.member.id, emoji);
  else db.prepare("INSERT INTO chat_reactions (messageId, memberId, emoji) VALUES (?, ?, ?)").run(m.id, req.member.id, emoji);
  broadcast("chat.reaction", m);
  res.json(shape(m, req.member));
});

// ---- Snapshot images ----

router.post("/chat/images", requireSignedIn, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: chat.MAX_IMAGE_BYTES }), (req, res) => {
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  const mime = chat.sniffImage(buf);
  if (!mime) return res.status(400).json({ error: "Upload a JPEG, PNG or WebP image." });
  const info = db.prepare("INSERT INTO chat_images (memberId, mime, data, bytes) VALUES (?, ?, ?, ?)").run(req.member.id, mime, buf, buf.length);
  res.status(201).json({ id: info.lastInsertRowid, url: `/api/chat/images/${info.lastInsertRowid}` });
});

// Members only, like the chat itself.
router.get("/chat/images/:id", requireSignedIn, (req, res) => {
  const img = db.prepare("SELECT mime, data FROM chat_images WHERE id = ?").get(req.params.id);
  if (!img) return res.status(404).json({ error: "Image not found." });
  res.set({ "Content-Type": img.mime, "Cache-Control": "private, max-age=86400" });
  res.send(Buffer.from(img.data));
});

router.get("/chat/reactions", requireSignedIn, (req, res) => res.json(chat.REACTIONS));

module.exports = router;
