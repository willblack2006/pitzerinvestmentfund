// Agent engine tables (WS2). Run by lib/schema/index.js after platform.js; must not require db.js.
//   agent_trigger_log: one row per (agent, dedupe key) an event or schedule fired, so the same
//   filing, price move or schedule slot never runs an agent twice (also across restarts), and
//   the builder can show "fired N times this week".
//   agent_metric_state: baseline values for comparisons with the previous check.
module.exports = function applyEngine(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_trigger_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agentId INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      dedupeKey TEXT NOT NULL,
      trigger TEXT NOT NULL,
      symbol TEXT,
      outcome TEXT NOT NULL DEFAULT 'queued',
      runId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      detail TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (agentId, dedupeKey)
    );
    CREATE INDEX IF NOT EXISTS agent_trigger_log_agent ON agent_trigger_log (agentId, createdAt);
    -- Last value of each metric an agent's conditions read, per symbol, saved on every check
    -- (passing or not) so "changed", "crosses_above" and "pct_change_gt" have a baseline even
    -- when the condition kept the agent from running.
    CREATE TABLE IF NOT EXISTS agent_metric_state (
      agentId INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL DEFAULT '',
      metrics TEXT NOT NULL DEFAULT '{}',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agentId, symbol)
    );
  `);
};
