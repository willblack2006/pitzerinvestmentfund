// Thesis tracking (WS4): extra columns on the platform's thesis tables (lib/schema/platform.js
// creates thesis_pillars, thesis_checks, thesis_versions, scenario_marks) and three tables of
// its own: dated catalysts, a daily health snapshot per holding, and management promises.
// Additive only; safe to run on every boot.
function migrate(db) {
  const has = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const addColumn = (table, column, ddl) => {
    if (!has(table)) return;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  // Pillars: weight in the health score, how often it must be reviewed (state and date), where it
  // came from, the consensus view it disagrees with, and who set the current status.
  addColumn("thesis_pillars", "weight", "REAL NOT NULL DEFAULT 1");
  addColumn("thesis_pillars", "reviewDays", "INTEGER");
  addColumn("thesis_pillars", "origin", "TEXT NOT NULL DEFAULT 'member'"); // thesis | catalyst | kill | variant | member | ai
  addColumn("thesis_pillars", "consensus", "TEXT NOT NULL DEFAULT ''");
  addColumn("thesis_pillars", "statusBy", "TEXT");       // 'rule', 'ai' (approved), or a member's name
  addColumn("thesis_pillars", "statusAt", "TEXT");
  addColumn("thesis_pillars", "lastCheckAt", "TEXT");
  addColumn("thesis_pillars", "lastValue", "REAL");
  // Checks: the metric value a rule saw, a one-line reading, who (for member overrides), and the
  // status before, so a timeline can show moves.
  addColumn("thesis_checks", "value", "REAL");
  addColumn("thesis_checks", "detail", "TEXT NOT NULL DEFAULT ''");
  addColumn("thesis_checks", "memberId", "INTEGER");
  addColumn("thesis_checks", "prevStatus", "TEXT");
  addColumn("thesis_versions", "note", "TEXT NOT NULL DEFAULT ''");
  addColumn("scenario_marks", "memberId", "INTEGER");
  addColumn("scenario_marks", "source", "TEXT NOT NULL DEFAULT 'member'"); // member | agent

  db.exec(`
    CREATE TABLE IF NOT EXISTS thesis_catalysts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      pitchId INTEGER,
      pillarId INTEGER,
      text TEXT NOT NULL,
      dueDate TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','hit','miss','dropped')),
      resolvedAt TEXT,
      resolvedBy TEXT,
      note TEXT NOT NULL DEFAULT '',
      priceAtDue REAL,
      createdBy TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS thesis_catalysts_symbol ON thesis_catalysts (symbol, dueDate);

    CREATE TABLE IF NOT EXISTS thesis_health (
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      score REAL,
      status TEXT,
      parts TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (symbol, date)
    );

    CREATE TABLE IF NOT EXISTS thesis_promises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      text TEXT NOT NULL,
      quote TEXT NOT NULL DEFAULT '',
      sourceUrl TEXT,
      saidOn TEXT,
      dueDate TEXT,
      tone TEXT NOT NULL DEFAULT 'neutral' CHECK (tone IN ('optimistic','neutral','pessimistic')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept','broken','dropped')),
      runId INTEGER,
      resolvedAt TEXT,
      resolvedBy TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS thesis_promises_symbol ON thesis_promises (symbol, dueDate);
  `);
  if (has("thesis_checks")) db.exec("CREATE INDEX IF NOT EXISTS thesis_checks_pillar ON thesis_checks (pillarId, createdAt)");
}

module.exports = migrate;
module.exports.migrate = migrate;
