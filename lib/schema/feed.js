// WS7 team feed: tables the feed needs on top of WS1's platform tables (feed_items,
// feed_comments, feed_reactions, agent_follows). Safe to run more than once.
//   feed_reads: each member's "read up to" marker, for unread dots and the badge.
//   feed_cursors: watermarks for background jobs (follow notifications, digest).
//   feed_pins:  items an admin or the author pinned to the top of the feed.
// Extra columns on feed_comments (mentions, deletedAt) are added lazily by lib/feed/store.js
// because that table belongs to WS1's schema and may be created after this file runs.
function apply(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_reads (
      memberId INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      lastReadId INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feed_cursors (
      name TEXT PRIMARY KEY,
      lastId INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feed_pins (
      itemId INTEGER PRIMARY KEY,
      pinnedBy INTEGER REFERENCES members(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = apply;
module.exports.apply = apply;
