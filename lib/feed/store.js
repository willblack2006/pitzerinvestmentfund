// Shared plumbing for the team feed (WS7): makes sure the feed's own tables and columns exist,
// and reaches WS1's platform modules through guarded requires so the feed degrades instead of
// crashing if one of them is missing.
const db = require("../../db");

let ready = false;
const hasTable = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

// True when the platform tables (WS1) and the feed's own (lib/schema/feed.js) are there.
function ensure() {
  if (ready) return true;
  ready = hasTable("feed_items") && hasTable("feed_reads") && hasColumn("feed_comments", "deletedAt");
  return ready;
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
