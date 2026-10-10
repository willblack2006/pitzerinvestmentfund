const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireSignedIn, requireAdmin, logActivity, publicMember } = require("../middleware/auth");
const { createInvite } = require("./auth");
const { getSettings, setSettings, OPTIONAL } = require("../lib/settings");
const benchmarks = require("../lib/benchmarks");

const router = express.Router();

// ---- Settings (investment policy, voting rules, cash, benchmark) ----

router.get("/settings", (req, res) => {
  const s = getSettings();
  res.json({ ...s, benchmarkLabel: benchmarks.label(s.benchmark) });
});

// Catalogue of benchmark presets for pickers.
router.get("/benchmarks", (req, res) => {
  res.json({ presets: benchmarks.PRESETS.map((g) => ({ group: g.group, items: g.items.map(([value, name]) => ({ value, name })) })) });
});

// Cash is part of the real fund (portfolio managers); everything else here is fund policy (admins).
router.put("/settings", requireSignedIn, (req, res) => {
  const patch = req.body || {};
  const keys = Object.keys(patch);
  if (keys.includes("cash") && !req.member.canTrade) return res.status(403).json({ error: "Only portfolio managers can change cash.", code: "trader_required" });
  if (keys.some((k) => k !== "cash") && !req.member.isAdmin) return res.status(403).json({ error: "Only admins can change fund settings.", code: "admin_required" });
  for (const [k, v] of Object.entries(patch)) {
    if (OPTIONAL.has(k) && (v === null || v === "")) { patch[k] = null; continue; } // "not set"
    if (k !== "benchmark" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      return res.status(400).json({ error: `${k} must be a non-negative number.` });
    }
  }
  if (patch.benchmark !== undefined) {
    try { patch.benchmark = benchmarks.normalize(patch.benchmark); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const out = setSettings(patch);
  logActivity(req, "settings.update", patch);
  res.json(out);
});

// ---- Members (admin) ----

const memberRow = (id) => db.prepare("SELECT * FROM members WHERE id = ?").get(id);
const adminView = (m) => ({ ...publicMember(m), active: !!m.active, createdAt: m.createdAt, lastSeenAt: m.lastSeenAt || null, hasPassword: !!m.passwordHash });
const normEmail = (e) => String(e || "").trim().toLowerCase();

// Signed-in members see who's in the club (names, titles); admins also see emails and access.
router.get("/members", requireSignedIn, (req, res) => {
  const rows = db.prepare("SELECT * FROM members ORDER BY active DESC, name").all();
  res.json(rows.map((m) => (req.member.isAdmin ? adminView(m) : { id: m.id, name: m.name, title: m.role || "", active: !!m.active })));
});

// Permanently delete an account (e.g. a test account, or a duplicate) so the person can sign up
// fresh. Their notes, chat messages, votes, paper trades, lists and alerts go with it; pitches
// they wrote stay (under their name) since the club voted on them. For someone leaving the
// club, "Mark alumni" is the right choice instead: it keeps their record.
router.delete("/members/:id", requireAdmin, (req, res) => {
  const m = memberRow(req.params.id);
  if (!m) return res.status(404).json({ error: "Member not found." });
  if (m.id === req.member.id) return res.status(400).json({ error: "You can't delete your own account." });
  const otherAdmins = db.prepare("SELECT COUNT(*) AS c FROM members WHERE isAdmin = 1 AND active = 1 AND id != ?").get(m.id).c;
  if (m.isAdmin && m.active && otherAdmins === 0) return res.status(400).json({ error: "The club needs at least one active admin." });
  db.transaction(() => {
    const msgIds = db.prepare("SELECT id FROM chat_messages WHERE memberId = ?").all(m.id).map((r) => r.id);
    for (const id of msgIds) db.prepare("DELETE FROM chat_reactions WHERE messageId = ?").run(id);
    db.prepare("DELETE FROM chat_messages WHERE memberId = ?").run(m.id);
    db.prepare("DELETE FROM chat_images WHERE memberId = ?").run(m.id);
    db.prepare("DELETE FROM paper_trades WHERE memberId = ?").run(m.id);
    db.prepare("UPDATE watchlist_items SET addedBy = NULL WHERE addedBy = ?").run(m.id);
    db.prepare("UPDATE pitches SET authorId = NULL WHERE authorId = ?").run(m.id);
    db.prepare("DELETE FROM members WHERE id = ?").run(m.id); // sessions, notes, votes, prefs, lists, alerts cascade
  })();
  logActivity(req, "member.delete", { id: m.id, name: m.name, email: m.email });
  res.status(204).end();
});

// Add a member and get their one-time invite link (the admin sends it to them).
router.post("/members", requireAdmin, (req, res) => {
  const { name, email, title = "Analyst", isAdmin = false, canTrade = false } = req.body || {};
  const e = normEmail(email);
  if (!String(name || "").trim()) return res.status(400).json({ error: "Name is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: "Enter a valid email." });
  try {
    const info = db.prepare("INSERT INTO members (name, role, pinHash, email, isAdmin, canTrade) VALUES (?, ?, '', ?, ?, ?)")
      .run(String(name).trim().slice(0, 80), String(title).trim().slice(0, 60), e, isAdmin ? 1 : 0, canTrade ? 1 : 0);
    const id = info.lastInsertRowid;
    logActivity(req, "member.add", { id, name: String(name).trim(), isAdmin: !!isAdmin, canTrade: !!canTrade });
    res.status(201).json({ member: adminView(memberRow(id)), inviteToken: createInvite(id, req.member.id) });
  } catch (err) {
    if (String(err).includes("UNIQUE")) return res.status(409).json({ error: "A member with that name or email already exists." });
    throw err;
  }
});

router.put("/members/:id", requireAdmin, (req, res) => {
  const m = memberRow(req.params.id);
  if (!m) return res.status(404).json({ error: "Member not found." });
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? String(b.name).trim().slice(0, 80) : m.name,
    title: b.title !== undefined ? String(b.title).trim().slice(0, 60) : m.role,
    email: b.email !== undefined ? normEmail(b.email) : m.email,
    isAdmin: b.isAdmin !== undefined ? (b.isAdmin ? 1 : 0) : m.isAdmin,
    canTrade: b.canTrade !== undefined ? (b.canTrade ? 1 : 0) : m.canTrade,
    active: b.active !== undefined ? (b.active ? 1 : 0) : m.active,
  };
  if (!next.name) return res.status(400).json({ error: "Name is required." });
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) return res.status(400).json({ error: "Enter a valid email." });
  // Never leave the club without an active admin, and don't lock yourself out by accident.
  const otherAdmins = db.prepare("SELECT COUNT(*) AS c FROM members WHERE isAdmin = 1 AND active = 1 AND id != ?").get(m.id).c;
  if ((!next.isAdmin || !next.active) && m.isAdmin && m.active && otherAdmins === 0) return res.status(400).json({ error: "The club needs at least one active admin. Make someone else an admin first." });
  if (m.id === req.member.id && !next.active) return res.status(400).json({ error: "You can't deactivate your own account." });
  try {
    db.prepare("UPDATE members SET name = ?, role = ?, email = ?, isAdmin = ?, canTrade = ?, active = ? WHERE id = ?")
      .run(next.name, next.title, next.email, next.isAdmin, next.canTrade, next.active, m.id);
  } catch (err) {
    if (String(err).includes("UNIQUE")) return res.status(409).json({ error: "A member with that name or email already exists." });
    throw err;
  }
  // Deactivating (e.g. a graduating member) signs them out everywhere.
  if (!next.active) db.prepare("DELETE FROM member_sessions WHERE memberId = ?").run(m.id);
  logActivity(req, "member.update", { id: m.id, name: next.name, changes: Object.keys(b) });
  res.json(adminView(memberRow(m.id)));
});

// A fresh one-time link: for someone who never set a password, or who forgot it.
router.post("/members/:id/invite", requireAdmin, (req, res) => {
  const m = memberRow(req.params.id);
  if (!m || !m.active) return res.status(404).json({ error: "Active member not found." });
  logActivity(req, "member.invite", { id: m.id, name: m.name });
  res.json({ inviteToken: createInvite(m.id, req.member.id) });
});

// ---- Activity log (who changed the fund, members and settings) ----

router.get("/activity", requireSignedIn, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(db.prepare("SELECT id, memberName, action, detail, at FROM activity_log ORDER BY id DESC LIMIT ?").all(limit)
    .map((r) => ({ ...r, detail: (() => { try { return JSON.parse(r.detail); } catch { return {}; } })() })));
});

module.exports = router;
