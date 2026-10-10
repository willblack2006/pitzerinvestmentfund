const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const {
  EDIT_PASSWORD, safeEqual, sha256, hashSecret, verifySecret, setSessionCookie, clearSessionCookie,
  createSession, endSession, publicMember, optionalMember, requireSignedIn, requireAdmin, logActivity,
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
  const cleanName = String(name).trim().slice(0, 80);
  // Members from the old PIN system have no password; if the name or email matches one, that
  // row becomes the admin (keeping their votes and pitches) instead of clashing with it.
  const existing = db.prepare("SELECT * FROM members WHERE lower(name) = lower(?) OR lower(email) = ?").all(cleanName, e);
  if (existing.some((m) => m.passwordHash)) return res.status(409).json({ error: "An account with that name or email already exists. Sign in instead." });
  if (existing.length > 1) return res.status(409).json({ error: "That name and that email belong to two different old members. Use a different name or email." });
  let id;
  try {
    if (existing.length === 1) {
      id = existing[0].id;
      db.prepare("UPDATE members SET name = ?, role = 'Admin', email = ?, passwordHash = ?, isAdmin = 1, canTrade = 1, active = 1 WHERE id = ?").run(cleanName, e, hashSecret(password), id);
    } else {
      id = db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, isAdmin, canTrade) VALUES (?, ?, '', ?, ?, 1, 1)")
        .run(cleanName, "Admin", e, hashSecret(password)).lastInsertRowid;
    }
  } catch (err) {
    console.error("[auth] first-admin setup failed:", err.message);
    if (String(err).includes("UNIQUE")) return res.status(409).json({ error: "A member with that name or email already exists." });
    return res.status(500).json({ error: `Couldn't create the account: ${err.message}` });
  }
  try {
    setSessionCookie(res, createSession(Number(id)));
  } catch (err) {
    console.error("[auth] first-admin session failed:", err.message);
    return res.status(500).json({ error: `Your admin account was created, but signing you in failed (${err.message}). Try Sign in.` });
  }
  res.status(201).json({ member: publicMember(db.prepare("SELECT * FROM members WHERE id = ?").get(id)) });
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

// ---- Club sign-up link ----

const JOIN_DAYS = [7, 30, 90];
const liveJoinLink = () => db.prepare("SELECT * FROM join_links WHERE revokedAt IS NULL AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1").get(new Date().toISOString());
const joinView = (l) => (l ? { token: l.token, expiresAt: l.expiresAt, uses: l.uses, createdAt: l.createdAt } : null);

router.get("/auth/join-link", requireAdmin, (req, res) => res.json({ link: joinView(liveJoinLink()) }));

// Make a new link (the old one stops working).
router.post("/auth/join-link", requireAdmin, (req, res) => {
  const days = JOIN_DAYS.includes(Number(req.body?.days)) ? Number(req.body.days) : 30;
  db.prepare("UPDATE join_links SET revokedAt = datetime('now') WHERE revokedAt IS NULL").run();
  const token = crypto.randomBytes(18).toString("base64url");
  db.prepare("INSERT INTO join_links (token, createdBy, expiresAt) VALUES (?, ?, ?)").run(token, req.member.id, new Date(Date.now() + days * 864e5).toISOString());
  logActivity(req, "joinLink.create", { days });
  res.status(201).json({ link: joinView(liveJoinLink()) });
});

router.delete("/auth/join-link", requireAdmin, (req, res) => {
  db.prepare("UPDATE join_links SET revokedAt = datetime('now') WHERE revokedAt IS NULL").run();
  logActivity(req, "joinLink.revoke", {});
  res.status(204).end();
});

const openJoin = (token) => {
  const l = liveJoinLink();
  return l && typeof token === "string" && safeEqual(token, l.token) ? l : null;
};
const JOIN_DEAD = "This sign-up link has expired or been turned off. Ask an admin for the new one.";

router.get("/auth/join/:token", (req, res) => {
  if (!openJoin(req.params.token)) return res.status(404).json({ error: JOIN_DEAD });
  res.json({ ok: true });
});

// Anyone with the link creates their own account. Everyone starts as an Analyst (no trading,
// no admin); admins give out other roles in Settings.
router.post("/auth/join/:token", loginLimiter("join"), (req, res) => {
  const link = openJoin(req.params.token);
  if (!link) { req.loginFailed(); return res.status(404).json({ error: JOIN_DEAD }); }
  const { name, email, password } = req.body || {};
  const cleanName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const e = normEmail(email);
  if (cleanName.length < 2) return res.status(400).json({ error: "Enter your name as you'd like the club to see it." });
  if (!validEmail(e)) return res.status(400).json({ error: "Enter a valid email." });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  const byEmail = db.prepare("SELECT * FROM members WHERE lower(email) = ?").get(e);
  if (byEmail) return res.status(409).json({ error: byEmail.passwordHash ? "That email already has an account. Use Sign in (or ask an admin for a password reset link)." : "An admin already added that email. Use the personal link they sent you, or ask them for a new one." });
  const byName = db.prepare("SELECT * FROM members WHERE lower(name) = lower(?)").get(cleanName);
  // An old PIN-era member with no email or password is taken over; anyone else keeps their name.
  if (byName && (byName.passwordHash || byName.email)) return res.status(409).json({ error: `Someone in the club already goes by "${cleanName}". Add your last initial or full last name.` });
  req.loginSucceeded();
  let id;
  if (byName) {
    id = byName.id;
    db.prepare("UPDATE members SET name = ?, email = ?, passwordHash = ?, role = 'Analyst', active = 1 WHERE id = ?").run(cleanName, e, hashSecret(password), id);
  } else {
    id = Number(db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, isAdmin, canTrade) VALUES (?, 'Analyst', '', ?, ?, 0, 0)").run(cleanName, e, hashSecret(password)).lastInsertRowid);
  }
  db.prepare("UPDATE join_links SET uses = uses + 1 WHERE token = ?").run(link.token);
  const m = db.prepare("SELECT * FROM members WHERE id = ?").get(id);
  logActivity({ member: m }, "member.join", { id, name: cleanName });
  const admins = db.prepare("SELECT id FROM members WHERE isAdmin = 1 AND active = 1").all().map((a) => a.id);
  require("../lib/notify").notify(admins, { type: "memberJoined", title: `${cleanName} joined with the sign-up link`, body: "They start as an Analyst. Change their title or access in Settings.", link: "#/settings" });
  setSessionCookie(res, createSession(id));
  res.status(201).json({ member: publicMember(m) });
});

module.exports = router;
module.exports.createInvite = createInvite;
module.exports.MIN_PASSWORD = MIN_PASSWORD;
