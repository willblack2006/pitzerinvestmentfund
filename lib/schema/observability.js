// WS8 tables: feedback reasons, health-alert dedupe and saved agent eval results.
// Idempotent. WS1's schema loader can call it (export `apply(db)`); lib/agents/metrics.js also
// calls ensure() on first use so the feature works before or without the loader.
let done = false;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function apply(db) {
  db.exec(`
    -- One row per health problem per day, so the same failure streak alerts once a day, not every check.
    CREATE TABLE IF NOT EXISTS agent_health_alerts (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Golden-case eval results (scripts/eval-agents.js and the nightly job).
    CREATE TABLE IF NOT EXISTS agent_eval_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      caseId TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'live',
      pass INTEGER NOT NULL DEFAULT 0,
      checks TEXT NOT NULL DEFAULT '{}',
      costUsd REAL NOT NULL DEFAULT 0,
      runId INTEGER,
      error TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS agent_eval_results_agent ON agent_eval_results (agent, createdAt);
    CREATE INDEX IF NOT EXISTS agent_runs_workflow_created ON agent_runs (workflow, createdAt);
  `);
  // Reason chips on feedback ("wrong number", "not relevant", ...), stored comma-separated.
  if (!hasColumn(db, "agent_feedback", "reasons")) db.exec("ALTER TABLE agent_feedback ADD COLUMN reasons TEXT NOT NULL DEFAULT ''");
}

function ensure(db = require("../../db")) {
  if (done) return;
  apply(db);
  done = true;
}

module.exports = { apply, ensure };
module.exports.default = apply;
