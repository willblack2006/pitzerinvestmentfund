// Per-member preferences. Each key has a validator that returns the cleaned value or throws;
// unknown keys are rejected so the table only ever holds things the app understands.
const db = require("../db");
const benchmarks = require("./benchmarks");
const { getSettings } = require("./settings");
const { memberFromRequest } = require("../middleware/auth");

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const oneOf = (allowed) => (v) => { if (!allowed.includes(v)) throw bad(`Must be one of: ${allowed.join(", ")}.`); return v; };
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;

const SCHEMA = {
  // The fund/index to compare against on Performance, Allocation, Risk, Backtester, Paper.
  benchmark: (v) => (v === null || v === "" ? null : benchmarks.normalize(String(v))),
  startPage: oneOf(["today", "holdings"]),
  theme: oneOf(["system", "light", "dark"]),
  holdingsPeriod: oneOf(["1d", "5d", "1m", "3m", "ytd", "1y", "all"]),
  // Personal follow list (separate from the fund's watchlist).
  myTickers: (v) => {
    if (!Array.isArray(v)) throw bad("myTickers must be a list.");
    const out = [...new Set(v.map((s) => String(s).toUpperCase().trim()).filter((s) => TICKER.test(s)))];
    if (out.length > 50) throw bad("Follow up to 50 tickers.");
    return out;
  },
  // Today page sections someone has hidden.
  todayHidden: (v) => {
    const allowed = ["read", "markets", "foryou", "recap", "stories", "holdingsNews", "portfolio", "deck", "sectors", "movers"];
    if (!Array.isArray(v)) throw bad("todayHidden must be a list.");
    return [...new Set(v.filter((k) => allowed.includes(k)))];
  },
  // Inbox notification types someone has turned off (keys of TYPES in lib/notify.js).
  notifyOff: (v) => {
    const allowed = ["mention", "pitchVoting", "pitchResult", "fundTrade", "priceAlert", "paperOrder", "memberJoined"];
    if (!Array.isArray(v)) throw bad("notifyOff must be a list.");
    return [...new Set(v.filter((k) => allowed.includes(k)))];
  },
};

function getPrefs(memberId) {
  const out = {};
  for (const r of db.prepare("SELECT key, value FROM member_prefs WHERE memberId = ?").all(memberId)) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore a corrupt row */ }
  }
  return out;
}

function setPrefs(memberId, patch = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!SCHEMA[k]) throw bad(`Unknown preference "${k}".`);
    clean[k] = SCHEMA[k](v);
  }
  const up = db.prepare(`INSERT INTO member_prefs (memberId, key, value, updatedAt) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(memberId, key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`);
  const del = db.prepare("DELETE FROM member_prefs WHERE memberId = ? AND key = ?");
  for (const [k, v] of Object.entries(clean)) {
    if (v === null) del.run(memberId, k);
    else up.run(memberId, k, JSON.stringify(v));
  }
  return getPrefs(memberId);
}

// The benchmark this request should compare against: an explicit ?benchmark=, else the signed-in
// member's own choice, else the fund's official benchmark. Throws a 400 on a malformed override.
function benchmarkFor(req) {
  if (req.query?.benchmark) return benchmarks.normalize(String(req.query.benchmark));
  const m = memberFromRequest(req);
  if (m) {
    const row = db.prepare("SELECT value FROM member_prefs WHERE memberId = ? AND key = 'benchmark'").get(m.id);
    if (row) { try { return benchmarks.normalize(JSON.parse(row.value)); } catch { /* fall through */ } }
  }
  return getSettings().benchmark;
}

module.exports = { getPrefs, setPrefs, benchmarkFor, SCHEMA };
