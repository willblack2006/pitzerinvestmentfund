// Ask PIF conversations (WS11): a thread is one member's conversation with Ask PIF or with one
// team agent (@agent). Each turn is an agent_runs row; ask_messages keeps the order and the
// question as typed. A thread is private until its owner shares it with the team.
// Idempotent: runs on require, and again if the schema loader calls it.
const db = require("../../db");

function apply(d = db) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS ask_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memberId INTEGER REFERENCES members(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      agentSlug TEXT,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team')),
      feedItemId INTEGER,
      forkedFrom INTEGER REFERENCES ask_threads(id) ON DELETE SET NULL,
      sharedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      archivedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS ask_threads_member ON ask_threads (memberId, updatedAt);
    CREATE INDEX IF NOT EXISTS ask_threads_team ON ask_threads (visibility, updatedAt);
    CREATE TABLE IF NOT EXISTS ask_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      threadId INTEGER NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
      memberId INTEGER REFERENCES members(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      agentSlug TEXT,
      runId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ask_messages_thread ON ask_messages (threadId, id);
  `);
}

apply();
module.exports = apply;
module.exports.apply = apply;
