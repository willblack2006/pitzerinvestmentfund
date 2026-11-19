// Reading the team feed (WS7): who may see which item, the filters, unread markers, and the
// shape the client gets. Writes go through lib/platform/feed.js post() (WS1); comments and
// reactions are in comments.js.
//
// Privacy (plan WS7): visitors never see the feed (routes require sign-in); an item from a
// private agent, or posted with visibility 'private', shows only to the agent's owner and the
// member who acted; Ask runs only appear once shared (they are never posted otherwise); admins
// see everything.
const { db, ensure } = require("./store");

const FILTERS = ["all", "holdings", "mine", "followed", "high", "members", "agents"];
const MAX_LIMIT = 100;

// SQL fragment (with params) that keeps only items `member` may see. Aliases: f = feed_items,
// a = agents (LEFT JOIN on f.agentId).
function visibleWhere(member) {
  if (member.isAdmin) return { sql: "1 = 1", args: [] };
  return {
    sql: `(NOT (COALESCE(f.visibility, 'team') = 'private' OR COALESCE(a.visibility, 'team') = 'private')
      OR a.ownerId = ? OR (f.actorType = 'member' AND f.actorId = ?))`,
    args: [member.id, member.id],
  };
}

const upper = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "").slice(0, 12);

// Builds the WHERE clause for a feed request. q: { filter, symbol, memberId, agentId, kind,
// importance, before, after }.
function whereFor(member, q = {}) {
  const v = visibleWhere(member);
  const where = [v.sql];
  const args = [...v.args];
  const filter = FILTERS.includes(q.filter) ? q.filter : "all";
  if (filter === "holdings") where.push("f.symbol IN (SELECT symbol FROM positions WHERE shares > 0)");
  if (filter === "mine") { where.push("(a.ownerId = ? OR (f.actorType = 'member' AND f.actorId = ?))"); args.push(member.id, member.id); }
  if (filter === "followed") { where.push("f.agentId IN (SELECT agentId FROM agent_follows WHERE memberId = ?)"); args.push(member.id); }
  if (filter === "high") where.push("f.importance = 'high'");
  if (filter === "members") where.push("f.actorType = 'member'");
  if (filter === "agents") where.push("f.agentId IS NOT NULL");
  if (q.symbol) { where.push("f.symbol = ?"); args.push(upper(q.symbol)); }
  if (q.memberId) { where.push("((f.actorType = 'member' AND f.actorId = ?) OR a.ownerId = ?)"); args.push(Number(q.memberId), Number(q.memberId)); }
  if (q.agentId) { where.push("f.agentId = ?"); args.push(Number(q.agentId)); }
  if (q.kind) { where.push("f.kind = ?"); args.push(String(q.kind).slice(0, 40)); }
  if (q.importance && ["high", "normal", "low"].includes(q.importance)) { where.push("f.importance = ?"); args.push(q.importance); }
  if (q.before) { where.push("f.id < ?"); args.push(Number(q.before)); }
  if (q.after) { where.push("f.id > ?"); args.push(Number(q.after)); }
  return { sql: where.join(" AND "), args, filter };
}

const parse = (s) => { if (s == null || s === "") return null; try { return JSON.parse(s); } catch { return { text: String(s) }; } };

const memberNames = (ids) => {
  const list = [...new Set(ids.filter((x) => x != null))];
  if (!list.length) return {};
  return Object.fromEntries(db.prepare(`SELECT id, name FROM members WHERE id IN (${list.map(() => "?").join(",")})`).all(...list).map((r) => [r.id, r.name]));
};

function lastRead(memberId) {
  return db.prepare("SELECT lastReadId FROM feed_reads WHERE memberId = ?").get(memberId)?.lastReadId || 0;
}

// Adds actor/agent names, comment counts, reactions (with "mine"), pinned and unread flags.
function decorate(rows, member) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const q = ids.map(() => "?").join(",");
  const counts = Object.fromEntries(db.prepare(`SELECT itemId, COUNT(*) AS c FROM feed_comments WHERE itemId IN (${q}) AND deletedAt IS NULL GROUP BY itemId`).all(...ids).map((r) => [r.itemId, r.c]));
  const reacts = {};
  for (const r of db.prepare(`SELECT itemId, emoji, COUNT(*) AS count, SUM(memberId = ?) AS mine FROM feed_reactions WHERE itemId IN (${q}) GROUP BY itemId, emoji`).all(member.id, ...ids)) {
    (reacts[r.itemId] ||= []).push({ emoji: r.emoji, count: r.count, mine: !!r.mine });
  }
  const pins = new Set(db.prepare(`SELECT itemId FROM feed_pins WHERE itemId IN (${q})`).all(...ids).map((r) => r.itemId));
  const names = memberNames(rows.flatMap((r) => [r.actorType === "member" ? r.actorId : null, r.agentOwnerId]));
  const read = lastRead(member.id);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title || "", body: parse(r.body), symbol: r.symbol || null, pitchId: r.pitchId || null,
    runId: r.runId || null, importance: r.importance || "normal", visibility: r.visibility || "team", createdAt: r.createdAt,
    actor: { type: r.actorType, id: r.actorId ?? null, name: r.actorType === "member" ? names[r.actorId] || "Former member" : r.actorType === "agent" ? r.agentName || "Agent" : "PIF" },
    agent: r.agentId ? { id: r.agentId, slug: r.agentSlug, name: r.agentName || "Agent", icon: r.agentIcon || "bot", status: r.agentStatus, ownerId: r.agentOwnerId ?? null, ownerName: names[r.agentOwnerId] || null, visibility: r.agentVisibility || "team" } : null,
    commentCount: counts[r.id] || 0,
    reactions: reacts[r.id] || [],
    pinned: pins.has(r.id),
    mine: (r.actorType === "member" && r.actorId === member.id) || (r.agentOwnerId != null && r.agentOwnerId === member.id),
    unread: r.id > read && !(r.actorType === "member" && r.actorId === member.id),
  }));
}

const SELECT = `SELECT f.*, a.slug AS agentSlug, a.name AS agentName, a.icon AS agentIcon, a.status AS agentStatus,
  a.ownerId AS agentOwnerId, a.visibility AS agentVisibility
  FROM feed_items f LEFT JOIN agents a ON a.id = f.agentId`;

// A page of the feed, newest first. Returns { items, hasMore, lastReadId, pinned }.
function list(member, q = {}) {
  if (!ensure()) return { items: [], hasMore: false, lastReadId: 0, pinned: [], unavailable: true };
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || 30));
  const w = whereFor(member, q);
  const rows = db.prepare(`${SELECT} WHERE ${w.sql} ORDER BY f.id DESC LIMIT ?`).all(...w.args, limit + 1);
  const hasMore = rows.length > limit;
  const items = decorate(rows.slice(0, limit), member);
  // Pinned items show above the stream on the first page (only those that match the filter).
  let pinned = [];
  if (!q.before && !q.after) {
    const pw = whereFor(member, { ...q, before: null });
    pinned = decorate(db.prepare(`${SELECT} JOIN feed_pins p ON p.itemId = f.id WHERE ${pw.sql} ORDER BY p.createdAt DESC LIMIT 5`).all(...pw.args), member);
  }
  return { items, hasMore, lastReadId: lastRead(member.id), pinned, filter: w.filter };
}

// One item, or null when it doesn't exist or `member` may not see it.
function get(member, id) {
  if (!ensure()) return null;
  const v = visibleWhere(member);
  const row = db.prepare(`${SELECT} WHERE f.id = ? AND ${v.sql}`).get(Number(id), ...v.args);
  return row ? decorate([row], member)[0] : null;
}

// Raw row plus the agent's privacy, for permission checks before broadcasting.
function rawItem(id) {
  if (!ensure()) return null;
  return db.prepare(`${SELECT} WHERE f.id = ?`).get(Number(id)) || null;
}

// Who may see a raw item: null = every signed-in member, otherwise a list of member ids
// (owner + acting member + admins). Used to target live events.
function audience(row) {
  if (!row) return [];
  const priv = (row.visibility || "team") === "private" || (row.agentVisibility || "team") === "private";
  if (!priv) return null;
  const admins = db.prepare("SELECT id FROM members WHERE active = 1 AND isAdmin = 1").all().map((r) => r.id);
  return [...new Set([row.agentOwnerId, row.actorType === "member" ? row.actorId : null, ...admins].filter((x) => x != null))];
}

function unreadCount(member) {
  if (!ensure()) return { unread: 0, high: 0, lastReadId: 0 };
  const read = lastRead(member.id);
  const w = whereFor(member, { after: read });
  const r = db.prepare(`SELECT COUNT(*) AS c, SUM(f.importance = 'high') AS high FROM feed_items f LEFT JOIN agents a ON a.id = f.agentId
    WHERE ${w.sql} AND NOT (f.actorType = 'member' AND f.actorId = ?)`).get(...w.args, member.id);
  return { unread: r.c || 0, high: r.high || 0, lastReadId: read };
}

function markRead(member, id) {
  ensure();
  const n = Number(id) || 0;
  db.prepare(`INSERT INTO feed_reads (memberId, lastReadId) VALUES (?, ?)
    ON CONFLICT(memberId) DO UPDATE SET lastReadId = MAX(lastReadId, excluded.lastReadId), updatedAt = datetime('now')`).run(member.id, n);
  return lastRead(member.id);
}

// Small facets for the filter bar: tickers and members that appear in the recent feed.
function facets(member) {
  if (!ensure()) return { symbols: [], members: [], agents: [] };
  const v = visibleWhere(member);
  const recent = `SELECT f.* FROM feed_items f LEFT JOIN agents a ON a.id = f.agentId WHERE ${v.sql} ORDER BY f.id DESC LIMIT 500`;
  const symbols = db.prepare(`SELECT symbol, COUNT(*) AS n FROM (${recent}) WHERE symbol IS NOT NULL GROUP BY symbol ORDER BY n DESC LIMIT 30`).all(...v.args);
  const members = db.prepare("SELECT id, name FROM members WHERE active = 1 ORDER BY name").all();
  const agents = db.prepare(`SELECT a.id, a.slug, a.name FROM agents a WHERE a.status != 'archived' AND (a.visibility = 'team' OR a.ownerId = ? OR ? = 1) ORDER BY a.name`).all(member.id, member.isAdmin ? 1 : 0);
  return { symbols, members, agents };
}

module.exports = { list, get, rawItem, audience, unreadCount, markRead, facets, visibleWhere, whereFor, decorate, FILTERS };
