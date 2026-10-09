const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const {
  EDIT_PASSWORD, safeEqual, sha256, hashSecret, verifySecret, setSessionCookie, clearSessionCookie,
  createSession, endSession, publicMember, optionalMember, requireSignedIn,
} = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const MIN_PASSWORD = 10;
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const passwordProblem = (p) => (typeof p !== "string" || p.length < MIN_PASSWORD ? `Password must be at least ${MIN_PASSWORD} characters.` : p.length > 200 ? "Password is too long." : null);
const adminCount = () => db.prepare("SELECT COUNT(*) AS c FROM members WHERE isAdmin = 1 AND active = 1").get().c;

// Who am I? Also tells a fresh install that the first admin still needs creating.
router.get("/auth/session", optionalMember, (req, res) => {
  res.json({ member: req.member, prefs: req.member ? require("../lib/prefs").getPrefs(req.member.id) : {}, setupNeeded: adminCount() === 0 });
});

// One-time bootstrap: create the first admin, proven by the server's EDIT_PASSWORD. Refused
// once any admin exists.
router.post("/auth/setup", loginLimiter("setup"), (req, res) => {
  if (adminCount() > 0) return res.status(409).json({ error: "The first admin already exists. Ask an admin for an invite." });
  const { setupPassword, name, email, password } = req.body || {};
  if (typeof setupPassword !== "string" || !safeEqual(setupPassword, EDIT_PASSWORD)) {
    req.loginFailed();
    return res.status(401).json({ error: "Setup password is incorrect." });
  }
  const e = normEmail(email);
  if (!String(name || "").trim()) return res.status(400).json({ error: "Name is required." });
  if (!validEmail(e)) return res.status(400).json({ error: "Enter a valid email." });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  req.loginSucceeded();
  const info = db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, isAdmin, canTrade) VALUES (?, ?, '', ?, ?, 1, 1)")
    .run(String(name).trim().slice(0, 80), "Admin", e, hashSecret(password));
  setSessionCookie(res, createSession(info.lastInsertRowid));
  res.status(201).json({ member: publicMember(db.prepare("SELECT * FROM members WHERE id = ?").get(info.lastInsertRowid)) });
});

// Limited per IP and per email, so one account can't be guessed from many IPs either.
router.post("/auth/login", loginLimiter("login", (req) => normEmail(req.body?.email)), (req, res) => {
  const e = normEmail(req.body?.email);
  const m = db.prepare("SELECT * FROM members WHERE email = ? AND active = 1").get(e);
  if (!m || !m.passwordHash || !verifySecret(req.body?.password, m.passwordHash)) {
    req.loginFailed();
    return res.status(401).json({ error: "Wrong email or password." });
  }
  req.loginSucceeded();
  setSessionCookie(res, createSession(m.id));
  res.json({ member: publicMember(m) });
});

router.post("/auth/logout", (req, res) => {
  endSession(req);
  clearSessionCookie(res);
  res.status(204).end();
});

router.post("/auth/logout-all", requireSignedIn, (req, res) => {
  db.prepare("DELETE FROM member_sessions WHERE memberId = ?").run(req.member.id);
  clearSessionCookie(res);
  res.status(204).end();
});

router.post("/auth/password", requireSignedIn, loginLimiter("password", (req) => String(req.member?.id || "")), (req, res) => {
  const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.member.id);
  if (!verifySecret(req.body?.currentPassword, m.passwordHash)) {
    req.loginFailed();
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  const problem = passwordProblem(req.body?.newPassword);
  if (problem) return res.status(400).json({ error: problem });
  req.loginSucceeded();
  db.prepare("UPDATE members SET passwordHash = ? WHERE id = ?").run(hashSecret(req.body.newPassword), m.id);
  // Changing a password signs out every other device.
  db.prepare("DELETE FROM member_sessions WHERE memberId = ?").run(m.id);
  setSessionCookie(res, createSession(m.id));
  res.status(204).end();
});

// ---- Invite links (new accounts and password resets) ----

const INVITE_DAYS = 7;

// Creates a one-time link for a member; returns the raw token (only its hash is stored).
function createInvite(memberId, createdBy) {
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("DELETE FROM invites WHERE memberId = ? AND usedAt IS NULL").run(memberId); // newest link wins
  db.prepare("INSERT INTO invites (tokenHash, memberId, createdBy, expiresAt) VALUES (?, ?, ?, ?)")
    .run(sha256(token), memberId, createdBy ?? null, new Date(Date.now() + INVITE_DAYS * 864e5).toISOString());
  return token;
}

function openInvite(token) {
  const inv = db.prepare("SELECT * FROM invites WHERE tokenHash = ?").get(sha256(token || ""));
  if (!inv || inv.usedAt || inv.expiresAt < new Date().toISOString()) return null;
  const m = db.prepare("SELECT * FROM members WHERE id = ? AND active = 1").get(inv.memberId);
  return m ? { inv, m } : null;
}

router.get("/auth/invite/:token", (req, res) => {
  const found = openInvite(req.params.token);
  if (!found) return res.status(404).json({ error: "This link has expired or was already used. Ask an admin for a new one." });
  res.json({ name: found.m.name, email: found.m.email, hasPassword: !!found.m.passwordHash });
});

router.post("/auth/invite/:token", loginLimiter("invite"), (req, res) => {
  const found = openInvite(req.params.token);
  if (!found) { req.loginFailed(); return res.status(404).json({ error: "This link has expired or was already used. Ask an admin for a new one." }); }
  const problem = passwordProblem(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });
  req.loginSucceeded();
  db.prepare("UPDATE members SET passwordHash = ? WHERE id = ?").run(hashSecret(req.body.password), found.m.id);
  db.prepare("UPDATE invites SET usedAt = datetime('now') WHERE tokenHash = ?").run(found.inv.tokenHash);
  db.prepare("DELETE FROM member_sessions WHERE memberId = ?").run(found.m.id); // a reset signs out old devices
  setSessionCookie(res, createSession(found.m.id));
  res.json({ member: publicMember(found.m) });
});

module.exports = router;
module.exports.createInvite = createInvite;
module.exports.MIN_PASSWORD = MIN_PASSWORD;
