const db = require("../db");

const NUMERIC = new Set(["maxPositionPct", "maxSectorPct", "minPositions", "maxPositions", "minCashPct", "cash", "voteThresholdPct", "voteQuorum"]);
// Investment-policy limits are optional: stored as "" when not set, returned as null, and
// skipped by the compliance checks.
const OPTIONAL = new Set(["maxPositionPct", "maxSectorPct", "minPositions", "maxPositions", "minCashPct"]);

function getSettings() {
  const out = {};
  for (const { key, value } of db.prepare("SELECT key, value FROM settings").all()) {
    if (OPTIONAL.has(key) && value === "") out[key] = null;
    else out[key] = NUMERIC.has(key) ? Number(value) : value;
  }
  return out;
}

function setSettings(patch) {
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const write = (entries) => entries.forEach(([k, v]) => stmt.run(k, v === null ? "" : String(v)));
  const entries = Object.entries(patch).filter(([k]) => NUMERIC.has(k) || k === "benchmark");
  // The ledger updates cash from inside its own transaction; libsql doesn't nest them.
  if (db.inTransaction) write(entries);
  else db.transaction(write)(entries);
  return getSettings();
}

module.exports = { getSettings, setSettings, OPTIONAL };
