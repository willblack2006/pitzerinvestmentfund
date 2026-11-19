// Team feed, minimal version (plan 3.4; WS7 extends it under lib/feed/). Everything members and
// agents do that others should see becomes one feed_items row, pushed live to open tabs as the
// SSE event 'feed' (members only) and emitted on the bus as 'feed'.
const db = require("../../db");

// Append-only: add new kinds at the end.
const KINDS = [
  "agent_brief", "agent_alert", "thesis_change", "memory_added", "handoff", "ask_shared",
  "pitch_opened", "vote_closed", "trade_executed", "tripwire_tripped", "note_shared",
  "agent_created", "agent_edited", "digest",
];
const ACTOR_TYPES = ["member", "agent", "system"];
const IMPORTANCE = ["high", "normal", "low"];

const parse = (row) => {
  if (!row) return row;
  let body = row.body;
  try { body = JSON.parse(row.body || "{}"); } catch { /* keep text */ }
  return { ...row, body };
};

function post({ kind, actorType = "system", actorId = null, agentId = null, runId = null, symbol = null, pitchId = null, title = "", body = {}, importance = "normal", visibility = "team" }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown feed kind "${kind}" (add it to KINDS in lib/platform/feed.js)`);
  if (!ACTOR_TYPES.includes(actorType)) throw new Error(`actorType must be one of ${ACTOR_TYPES.join(", ")}`);
  if (!IMPORTANCE.includes(importance)) importance = "normal";
  const info = db.prepare(`INSERT INTO feed_items (kind, actorType, actorId, agentId, runId, symbol, pitchId, title, body, visibility, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(kind, actorType, actorId, agentId, runId, symbol ? String(symbol).toUpperCase() : null, pitchId,
    String(title || "").slice(0, 300), typeof body === "string" ? body : JSON.stringify(body ?? {}), visibility, importance);
  const id = Number(info.lastInsertRowid);
  const item = get(id);
  if (visibility === "team") {
    try { require("../events").publish("feed", item, { membersOnly: true }); } catch (err) { console.error("[feed] publish failed:", err.message); }
  }
  try { require("./bus").emit("feed", item); } catch { /* bus is optional here */ }
  return id;
}

function get(id) {
  return parse(db.prepare("SELECT * FROM feed_items WHERE id = ?").get(id));
}

// Newest first. `before` is an item id for paging. `memberId` lets a member see their own
// private items too.
function list({ limit = 50, before = null, symbol = null, agentId = null, kind = null, memberId = null } = {}) {
  const where = ["(visibility = 'team'" + (memberId ? " OR (actorType = 'member' AND actorId = @memberId)" : "") + ")"];
  if (before) where.push("id < @before");
  if (symbol) where.push("symbol = @symbol");
  if (agentId) where.push("agentId = @agentId");
  if (kind) where.push("kind = @kind");
  return db.prepare(`SELECT * FROM feed_items WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT @limit`)
    .all({ limit: Math.min(Math.max(Number(limit) || 50, 1), 200), before, symbol: symbol && String(symbol).toUpperCase(), agentId, kind, memberId })
    .map(parse);
}

module.exports = { post, get, list, KINDS, ACTOR_TYPES };
