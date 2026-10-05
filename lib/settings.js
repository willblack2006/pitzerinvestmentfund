const db = require("../db");

const NUMERIC = new Set(["maxPositionPct", "maxSectorPct", "minPositions", "maxPositions", "minCashPct", "cash", "voteThresholdPct", "voteQuorum"]);

function getSettings() {
  const out = {};
  for (const { key, value } of db.prepare("SELECT key, value FROM settings").all()) {
    out[key] = NUMERIC.has(key) ? Number(value) : value;
  }
  return out;
}

function setSettings(patch) {
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const tx = db.transaction((entries) => entries.forEach(([k, v]) => stmt.run(k, String(v))));
  tx(Object.entries(patch).filter(([k]) => NUMERIC.has(k) || k === "benchmark"));
  return getSettings();
}

module.exports = { getSettings, setSettings };
