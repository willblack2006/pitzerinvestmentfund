const crypto = require("crypto");

const EDIT_PASSWORD = process.env.EDIT_PASSWORD || "pitzerfund";
if (!process.env.EDIT_PASSWORD) {
  console.warn("[security] EDIT_PASSWORD is not set — using the default. Set it before sharing the app.");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Shared fund edit password (holdings, theses, watchlist, settings, member admin).
function requireAuth(req, res, next) {
  const supplied = req.get("x-edit-password") || "";
  if (!safeEqual(supplied, EDIT_PASSWORD)) {
    return res.status(401).json({ error: "Invalid or missing edit password." });
  }
  next();
}

// Individual member identity (voting, authorship). Resolved lazily to avoid a db import cycle.
function memberFromRequest(req) {
  const token = req.get("x-member-token");
  if (!token) return null;
  const db = require("../db");
  return db.prepare(`
    SELECT m.id, m.name, m.role FROM member_sessions s JOIN members m ON m.id = s.memberId
    WHERE s.token = ? AND m.active = 1
  `).get(token) || null;
}

function optionalMember(req, res, next) {
  req.member = memberFromRequest(req);
  next();
}

function requireMember(req, res, next) {
  req.member = memberFromRequest(req);
  if (!req.member) return res.status(401).json({ error: "Sign in as a fund member to do this.", code: "member_required" });
  next();
}

// PINs are hashed with scrypt + per-member salt.
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString("hex")}`;
}
function verifyPin(pin, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  return safeEqual(crypto.scryptSync(String(pin), salt, 32).toString("hex"), hash);
}

module.exports = { requireAuth, requireMember, optionalMember, memberFromRequest, hashPin, verifyPin, EDIT_PASSWORD, safeEqual };
