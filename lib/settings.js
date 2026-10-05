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
  const tx = db.transaction((entries) => entries.forEach(([k, v]) => stmt.run(k, v === null ? "" : String(v))));
  tx(Object.entries(patch).filter(([k]) => NUMERIC.has(k) || k === "benchmark"));
  return getSettings();
}

module.exports = { getSettings, setSettings, OPTIONAL };
