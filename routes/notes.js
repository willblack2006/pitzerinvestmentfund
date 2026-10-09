const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const { cleanNote } = require("../lib/notes");

const router = express.Router();

const shape = (n, me) => ({
  ...n, tags: (() => { try { return JSON.parse(n.tags); } catch { return []; } })(),
  pinned: !!n.pinned, mine: n.memberId === me.id,
});
const SELECT = "SELECT n.*, m.name AS authorName FROM notes n JOIN members m ON m.id = n.memberId";

// Notes you can see: your own plus ones others shared with the club. Filters: symbol, scope
// (mine | club | all), q (searches body, quote, ticker, page title), tag.
router.get("/notes", requireSignedIn, (req, res) => {
  const me = req.member;
  const where = [], args = [];
  const scope = ["mine", "club"].includes(req.query.scope) ? req.query.scope : "all";
  if (scope === "mine") { where.push("n.memberId = ?"); args.push(me.id); }
  else if (scope === "club") { where.push("n.visibility = 'club'"); }
  else { where.push("(n.memberId = ? OR n.visibility = 'club')"); args.push(me.id); }
  if (req.query.symbol) { where.push("n.symbol = ?"); args.push(String(req.query.symbol).toUpperCase()); }
  if (req.query.q) {
    const like = `%${String(req.query.q).slice(0, 100).replace(/[%_]/g, "\\$&")}%`;
    where.push("(n.body LIKE ? ESCAPE '\\' OR n.quote LIKE ? ESCAPE '\\' OR n.symbol LIKE ? ESCAPE '\\' OR n.pageTitle LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  if (req.query.tag) { where.push("n.tags LIKE ?"); args.push(`%"${String(req.query.tag).toLowerCase().replace(/[^a-z0-9\-]/g, "")}"%`); }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const rows = db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY (n.memberId = ? AND n.pinned) DESC, n.updatedAt DESC LIMIT ?`).all(...args, me.id, limit);
  res.json(rows.map((n) => shape(n, me)));
});

// How many notes you can see per ticker (for the little note markers next to tickers).
router.get("/notes/symbols", requireSignedIn, (req, res) => {
  const rows = db.prepare(`SELECT symbol, SUM(memberId = ?) AS mine, COUNT(*) AS total FROM notes
    WHERE symbol IS NOT NULL AND (memberId = ? OR visibility = 'club') GROUP BY symbol`).all(req.member.id, req.member.id);
  res.json(Object.fromEntries(rows.map((r) => [r.symbol, { mine: r.mine, total: r.total }])));
});

router.post("/notes", requireSignedIn, (req, res) => {
  let n;
  try { n = cleanNote(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const info = db.prepare(`INSERT INTO notes (memberId, symbol, pageRef, pageTitle, quote, body, tags, visibility, pinned)
    VALUES (@memberId, @symbol, @pageRef, @pageTitle, @quote, @body, @tags, @visibility, @pinned)`).run({ memberId: req.member.id, ...n });
  res.status(201).json(shape(db.prepare(`${SELECT} WHERE n.id = ?`).get(info.lastInsertRowid), req.member));
});

const own = (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
  if (!n || (n.memberId !== req.member.id && n.visibility !== "club")) { res.status(404).json({ error: "Note not found." }); return null; }
  return n;
};

// Only the author edits a note.
router.put("/notes/:id", requireSignedIn, (req, res) => {
  const n = own(req, res);
  if (!n) return;
  if (n.memberId !== req.member.id) return res.status(403).json({ error: "Only the author can edit this note." });
  let patch;
  try { patch = cleanNote(req.body || {}, { partial: true }); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const merged = { ...n, ...patch };
  if (!String(merged.body).trim() && !merged.quote) return res.status(400).json({ error: "A note can't be empty." });
  db.prepare(`UPDATE notes SET symbol=@symbol, pageRef=@pageRef, pageTitle=@pageTitle, quote=@quote, body=@body, tags=@tags,
    visibility=@visibility, pinned=@pinned, updatedAt=datetime('now') WHERE id=@id`).run(merged);
  res.json(shape(db.prepare(`${SELECT} WHERE n.id = ?`).get(n.id), req.member));
});

// The author deletes; admins can also remove a note shared with the club (moderation).
router.delete("/notes/:id", requireSignedIn, (req, res) => {
  const n = own(req, res);
  if (!n) return;
  if (n.memberId !== req.member.id && !req.member.isAdmin) return res.status(403).json({ error: "Only the author can delete this note." });
  db.prepare("DELETE FROM notes WHERE id = ?").run(n.id);
  res.status(204).end();
});

module.exports = router;
