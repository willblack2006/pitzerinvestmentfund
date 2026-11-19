// Shared plumbing for the team feed (WS7): makes sure the feed's own tables and columns exist,
// and reaches WS1's platform modules through guarded requires so the feed degrades instead of
// crashing if one of them is missing.
const db = require("../../db");

let ready = false;
const hasTable = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

// Runs once per process, the first time any feed code touches the database.
function ensure() {
  if (ready) return true;
  require("../schema/feed")(db);
  if (!hasTable("feed_items")) return false; // WS1's platform schema not loaded (yet)
  if (hasTable("feed_comments")) {
    if (!hasColumn("feed_comments", "mentions")) db.exec("ALTER TABLE feed_comments ADD COLUMN mentions TEXT");
    if (!hasColumn("feed_comments", "deletedAt")) db.exec("ALTER TABLE feed_comments ADD COLUMN deletedAt TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS feed_comments_item ON feed_comments (itemId, id)");
  }
  db.exec("CREATE INDEX IF NOT EXISTS feed_items_agent ON feed_items (agentId, id)");
  db.exec("CREATE INDEX IF NOT EXISTS feed_items_actor ON feed_items (actorType, actorId, id)");
  ready = true;
  return true;
}

// Optional modules from other workstreams (WS1 platform, WS2 engine). null when not present;
// a module that exists but throws while loading still throws.
function optional(rel) {
  let resolved;
  try { resolved = require.resolve(rel); } catch { return null; }
  return require(resolved);
}
const platform = (name) => optional(`../platform/${name}`);

const runsHas = (col) => { try { return hasColumn("agent_runs", col); } catch { return false; } };

module.exports = { db, ensure, platform, optional, hasTable, hasColumn, runsHas };
