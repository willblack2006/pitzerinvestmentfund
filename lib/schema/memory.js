// WS5 shared memory: columns and tables on top of WS1's agent_memory / agent_messages
// (lib/schema/platform.js). Idempotent. Exported as a function of the db so it works whether the
// schema loader calls it with the db or lib/agents/memory.js calls it lazily on first use (the
// loader may run this file before platform.js has created agent_memory, so every step is guarded).
function ensure(db) {
  const has = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const addColumn = (table, column, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  db.exec(`CREATE TABLE IF NOT EXISTS memory_dossiers (
    symbol TEXT PRIMARY KEY,
    summary TEXT NOT NULL DEFAULT '',
    points TEXT NOT NULL DEFAULT '[]',
    runId INTEGER,
    memoryCount INTEGER NOT NULL DEFAULT 0,
    maxMemoryId INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  if (!has("agent_memory")) return false;
  addColumn("agent_memory", "pinned", "INTEGER NOT NULL DEFAULT 0");
  addColumn("agent_memory", "pinnedBy", "INTEGER");
  addColumn("agent_memory", "seenCount", "INTEGER NOT NULL DEFAULT 1");
  addColumn("agent_memory", "lastSeenAt", "TEXT");
  addColumn("agent_memory", "retractedBy", "INTEGER");
  addColumn("agent_memory", "retractedAt", "TEXT");
  addColumn("agent_memory", "retractReason", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_memory_supersedes ON agent_memory (supersedesId)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_memory_kind ON agent_memory (kind, status)");
  if (has("agent_messages")) {
    addColumn("agent_messages", "answer", "TEXT");
    addColumn("agent_messages", "answeredAt", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_agent_messages_symbol ON agent_messages (symbol, createdAt)");
  }
  return true;
}

module.exports = ensure;
module.exports.ensure = ensure;
