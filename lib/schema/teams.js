// WS6 agent teams: one team_runs row per team run (the parent agent_runs row) and one
// team_children row per worker run it spawned, so a run tree can be shown without depending on
// agent_runs.parentRunId (which WS1 adds; it is also set when present). Idempotent: safe to
// apply more than once (the schema loader and lib/agents/orchestrator.js both call it).
function apply(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_runs (
      runId INTEGER PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
      team TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      symbol TEXT,
      pitchId INTEGER REFERENCES pitches(id) ON DELETE SET NULL,
      startedBy INTEGER REFERENCES members(id) ON DELETE SET NULL,
      trigger TEXT NOT NULL DEFAULT 'manual',
      budgetUsd REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS team_runs_team ON team_runs (team, createdAt);
    CREATE INDEX IF NOT EXISTS team_runs_pitch ON team_runs (pitchId, createdAt);
    CREATE INDEX IF NOT EXISTS team_runs_symbol ON team_runs (symbol, createdAt);
    CREATE INDEX IF NOT EXISTS team_runs_starter ON team_runs (startedBy, createdAt);
    CREATE TABLE IF NOT EXISTS team_children (
      parentRunId INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      childRunId INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      round INTEGER NOT NULL DEFAULT 1,
      ord INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (parentRunId, childRunId)
    );
    CREATE INDEX IF NOT EXISTS team_children_child ON team_children (childRunId);
  `);
}

module.exports = apply;
module.exports.apply = apply;
