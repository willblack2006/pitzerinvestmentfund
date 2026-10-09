// Accounts and permissions. Each member signs in with email + password; the session is an
// HttpOnly cookie (the token is never readable by page scripts, and it rides along on the live
// update stream). What someone may do comes from their account:
//   signed in  → personal notes, chat, pitches, theses, watchlist, votes, paper trading, AI tools
//   canTrade   → the real fund: positions, transactions, cash, dividends
//   isAdmin    → members, fund settings, paper seasons
// EDIT_PASSWORD only unlocks creating the very first admin account (see routes/auth.js).
const crypto = require("crypto");

const EDIT_PASSWORD = process.env.EDIT_PASSWORD || "pitzerfund";
if (!process.env.EDIT_PASSWORD) {
  console.warn("[security] EDIT_PASSWORD is not set — using the default. Set it before sharing the app.");
}

const SESSION_COOKIE = "pif_session";
const SESSION_DAYS = 30;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// Passwords (and the retired PINs) are hashed with scrypt + a per-member salt.
function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(String(secret), salt, 32).toString("hex")}`;
}
function verifySecret(secret, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  return safeEqual(crypto.scryptSync(String(secret), salt, 32).toString("hex"), hash);
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const isProd = () => process.env.NODE_ENV === "production" || !!process.env.RENDER;

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isProd() ? "; Secure" : ""}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd() ? "; Secure" : ""}`);
}

// New session for a member: returns the raw token (only its hash is stored).
function createSession(memberId) {
  const db = require("../db");
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO member_sessions (token, memberId, expiresAt, lastUsedAt) VALUES (?, ?, ?, ?)").run(sha256(token), memberId, expires, new Date().toISOString());
  return token;
}

function endSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) require("../db").prepare("DELETE FROM member_sessions WHERE token = ?").run(sha256(token));
}

const publicMember = (m) => (m ? { id: m.id, name: m.name, email: m.email || null, title: m.role || "", isAdmin: !!m.isAdmin, canTrade: !!m.canTrade } : null);

// The signed-in member for this request (or null). Sessions slide: each use (at most once a
// minute) pushes expiry out another 30 days.
function memberFromRequest(req) {
  if (req._member !== undefined) return req._member;
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return (req._member = null);
  const db = require("../db");
  const row = db.prepare(`
    SELECT m.*, s.token AS sessionHash, s.expiresAt, s.lastUsedAt FROM member_sessions s JOIN members m ON m.id = s.memberId
    WHERE s.token = ? AND m.active = 1
  `).get(sha256(token));
  if (!row || (row.expiresAt && row.expiresAt < new Date().toISOString())) return (req._member = null);
  if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > 60e3) {
    const now = new Date().toISOString();
    db.prepare("UPDATE member_sessions SET lastUsedAt = ?, expiresAt = ? WHERE token = ?").run(now, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), row.sessionHash);
    db.prepare("UPDATE members SET lastSeenAt = ? WHERE id = ?").run(now, row.id);
  }
  return (req._member = publicMember(row));
}

function attach(req) {
  req.member = memberFromRequest(req);
  return req.member;
}

function optionalMember(req, res, next) { attach(req); next(); }

function requireSignedIn(req, res, next) {
  if (!attach(req)) return res.status(401).json({ error: "Sign in to do this.", code: "signin_required" });
  next();
}

function requireTrader(req, res, next) {
  if (!attach(req)) return res.status(401).json({ error: "Sign in to do this.", code: "signin_required" });
  if (!req.member.canTrade) return res.status(403).json({ error: "Only portfolio managers can change the fund's holdings, trades and cash.", code: "trader_required" });
  next();
}

function requireAdmin(req, res, next) {
  if (!attach(req)) return res.status(401).json({ error: "Sign in to do this.", code: "signin_required" });
  if (!req.member.isAdmin) return res.status(403).json({ error: "Only admins can do this.", code: "admin_required" });
  next();
}

// Cookies ride along on cross-site requests too, so state-changing API calls must carry a
// header that a plain cross-site form or image can't send. The app's api() always adds it.
function requireAppHeader(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.get("x-pif-app") === "1") return next();
  res.status(403).json({ error: "Missing app header.", code: "csrf" });
}

// Record who changed what (real-fund changes, member administration).
function logActivity(req, action, detail = {}) {
  const db = require("../db");
  db.prepare("INSERT INTO activity_log (memberId, memberName, action, detail) VALUES (?, ?, ?, ?)")
    .run(req.member?.id ?? null, req.member?.name || "", action, JSON.stringify(detail));
}

module.exports = {
  EDIT_PASSWORD, SESSION_COOKIE, safeEqual, sha256, hashSecret, verifySecret, readCookie,
  setSessionCookie, clearSessionCookie, createSession, endSession, publicMember,
  memberFromRequest, optionalMember, requireSignedIn, requireTrader, requireAdmin, requireAppHeader, logActivity,
};
