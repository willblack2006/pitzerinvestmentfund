const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth, optionalMember, hashPin, verifyPin } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");
const { getSettings, setSettings, OPTIONAL } = require("../lib/settings");
const benchmarks = require("../lib/benchmarks");

const router = express.Router();
const ROLES = ["analyst", "portfolio manager", "risk officer", "officer", "advisor"];

// ---- Settings (investment policy, voting rules, cash, benchmark) ----

router.get("/settings", (req, res) => {
  const s = getSettings();
  res.json({ ...s, benchmarkLabel: benchmarks.label(s.benchmark) });
});

// Catalogue of benchmark presets for pickers.
router.get("/benchmarks", (req, res) => {
  res.json({ presets: benchmarks.PRESETS.map((g) => ({ group: g.group, items: g.items.map(([value, name]) => ({ value, name })) })) });
});

router.put("/settings", requireAuth, (req, res) => {
  const patch = req.body || {};
  for (const [k, v] of Object.entries(patch)) {
    if (OPTIONAL.has(k) && (v === null || v === "")) { patch[k] = null; continue; } // "not set"
    if (k !== "benchmark" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      return res.status(400).json({ error: `${k} must be a non-negative number.` });
    }
  }
  if (patch.benchmark !== undefined) {
    try { patch.benchmark = benchmarks.normalize(patch.benchmark); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  res.json(setSettings(patch));
});

// ---- Members ----

router.get("/members", (req, res) => {
  res.json(db.prepare("SELECT id, name, role, active, createdAt FROM members ORDER BY active DESC, name").all());
});

router.post("/members", requireAuth, (req, res) => {
  const { name, role = "analyst", pin } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required." });
  if (!/^\d{4,8}$/.test(String(pin || ""))) return res.status(400).json({ error: "PIN must be 4–8 digits." });
  if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}.` });
  try {
    const info = db.prepare("INSERT INTO members (name, role, pinHash) VALUES (?, ?, ?)").run(String(name).trim(), role, hashPin(pin));
    res.status(201).json(db.prepare("SELECT id, name, role, active, createdAt FROM members WHERE id = ?").get(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: `A member named ${name} already exists.` });
    throw e;
  }
});

router.put("/members/:id", requireAuth, (req, res) => {
  const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.params.id);
  if (!m) return res.status(404).json({ error: "Member not found." });
  const { role, active, pin } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: "Unknown role." });
  if (pin !== undefined && !/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4–8 digits." });
  db.prepare("UPDATE members SET role = ?, active = ?, pinHash = ? WHERE id = ?").run(
    role ?? m.role, active === undefined ? m.active : active ? 1 : 0, pin !== undefined ? hashPin(pin) : m.pinHash, m.id
  );
  // Deactivating (e.g. a graduating member) signs them out everywhere.
  if (active === false || pin !== undefined) db.prepare("DELETE FROM member_sessions WHERE memberId = ?").run(m.id);
  res.json(db.prepare("SELECT id, name, role, active, createdAt FROM members WHERE id = ?").get(m.id));
});

// Limited per IP and per member, so one account's PIN can't be guessed from many IPs either.
router.post("/members/login", loginLimiter("pin", (req) => String(req.body?.memberId || "")), (req, res) => {
  const { memberId, pin } = req.body || {};
  const m = db.prepare("SELECT * FROM members WHERE id = ? AND active = 1").get(memberId);
  if (!m || !verifyPin(pin, m.pinHash)) {
    req.loginFailed();
    return res.status(401).json({ error: "Wrong member or PIN." });
  }
  req.loginSucceeded();
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO member_sessions (token, memberId) VALUES (?, ?)").run(token, m.id);
  res.json({ token, member: { id: m.id, name: m.name, role: m.role } });
});

router.get("/members/me", optionalMember, (req, res) => {
  res.json({ member: req.member });
});

router.post("/members/logout", (req, res) => {
  const token = req.get("x-member-token");
  if (token) db.prepare("DELETE FROM member_sessions WHERE token = ?").run(token);
  res.status(204).end();
});

module.exports = router;
