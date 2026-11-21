// Following agents (WS7). A member follows an agent to hear about what it posts, at one of
// four levels (stored in agent_follows.notify):
//   all     every feed post by the agent goes to the inbox
//   inbox   (default) high-importance posts go to the inbox; the rest wait for the evening digest
//   digest  everything waits for the evening digest
//   off     nothing (the agent still shows under "Followed" on the feed)
// Will's rule still holds: don't overload alerts. A burst from one agent in one pass is folded
// into one notification, and the digest is one notification a weekday, only when there's news.
const { db, ensure } = require("./store");
const query = require("./query");

const LEVELS = ["all", "inbox", "digest", "off"];
const LEVEL_ALIASES = { push: "all", none: "off" }; // WS2's /api/platform/agents/:id/follow uses push/none
const DIGEST_HOUR_UTC = 22; // same time as the research digest (lib/agents/digest.js)
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status, expose: true });

const normLevel = (l) => {
  const v = LEVEL_ALIASES[l] || l || "inbox";
  if (!LEVELS.includes(v)) throw bad(`Notify level must be one of ${LEVELS.join(", ")}.`);
  return v;
};

// An agent the member may see (team, own, or admin), by id or slug.
function visibleAgent(member, idOrSlug) {
  const byId = /^\d+$/.test(String(idOrSlug));
  const a = db.prepare(`SELECT * FROM agents WHERE ${byId ? "id" : "slug"} = ?`).get(byId ? Number(idOrSlug) : String(idOrSlug));
  if (!a) return null;
  if (a.visibility === "private" && a.ownerId !== member.id && !member.isAdmin) return null;
  return a;
}

function follow(member, agentId, level = "inbox") {
  ensure();
  const n = normLevel(level);
  db.prepare(`INSERT INTO agent_follows (agentId, memberId, notify) VALUES (?, ?, ?)
    ON CONFLICT(agentId, memberId) DO UPDATE SET notify = excluded.notify`).run(agentId, member.id, n === "off" ? "none" : n); // WS2's engine skips 'none'

  return status(member, agentId);
}

function unfollow(member, agentId) {
  ensure();
  db.prepare("DELETE FROM agent_follows WHERE agentId = ? AND memberId = ?").run(agentId, member.id);
  return status(member, agentId);
}

function status(member, agentId) {
  const mine = db.prepare("SELECT notify FROM agent_follows WHERE agentId = ? AND memberId = ?").get(agentId, member.id);
  const count = db.prepare("SELECT COUNT(*) AS c FROM agent_follows WHERE agentId = ?").get(agentId).c;
  return { following: !!mine, notify: mine ? LEVEL_ALIASES[mine.notify] || mine.notify : null, followers: count };
}

function followers(agentId) {
  return db.prepare(`SELECT f.memberId AS id, m.name, f.notify, f.createdAt FROM agent_follows f JOIN members m ON m.id = f.memberId
    WHERE f.agentId = ? AND m.active = 1 ORDER BY f.createdAt`).all(agentId);
}

function followedBy(memberId) {
  return db.prepare("SELECT agentId, notify FROM agent_follows WHERE memberId = ?").all(memberId);
}

// ---- Background: notifications for followed agents ----

function cursor(name) {
  return db.prepare("SELECT lastId FROM feed_cursors WHERE name = ?").get(name)?.lastId ?? null;
}
function setCursor(name, id) {
  db.prepare(`INSERT INTO feed_cursors (name, lastId) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET lastId = excluded.lastId, updatedAt = datetime('now')`).run(name, id);
}

const activeMember = (id) => db.prepare("SELECT id, name, isAdmin, canUseAi FROM members WHERE id = ? AND active = 1 AND passwordHash IS NOT NULL").get(id);

// Who may read a raw feed row (privacy rules from query.js), for one member.
function canSee(row, m) {
  const aud = query.audience(row);
  return aud === null || aud.includes(m.id) || !!m.isAdmin;
}

// Sends inbox notifications for agent posts since the last pass. Returns the number sent.
// First call on a database only sets the watermark (no flood of old items).
function notifyNew({ notify = require("../notify").notify } = {}) {
  if (!ensure()) return 0;
  const max = db.prepare("SELECT MAX(id) AS m FROM feed_items").get().m || 0;
  const from = cursor("follow_notify");
  if (from === null) { setCursor("follow_notify", max); return 0; }
  if (max <= from) return 0;
  const rows = db.prepare(`SELECT f.*, a.slug AS agentSlug, a.name AS agentName, a.ownerId AS agentOwnerId, a.visibility AS agentVisibility
    FROM feed_items f JOIN agents a ON a.id = f.agentId WHERE f.id > ? AND f.id <= ? ORDER BY f.id`).all(from, max);
  // memberId -> agentId -> [rows]
  const per = new Map();
  for (const r of rows) {
    for (const fl of db.prepare("SELECT memberId, notify FROM agent_follows WHERE agentId = ?").all(r.agentId)) {
      const lvl = LEVEL_ALIASES[fl.notify] || fl.notify || "inbox";
      if (lvl === "off" || lvl === "digest") continue;
      if (lvl === "inbox" && r.importance !== "high") continue;
      if (r.actorType === "member" && r.actorId === fl.memberId) continue;
      if (r.triggeredBy && r.triggeredBy === fl.memberId) continue;
      const m = activeMember(fl.memberId);
      if (!m || !canSee(r, m)) continue;
      if (!per.has(m.id)) per.set(m.id, new Map());
      const byAgent = per.get(m.id);
      if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
      byAgent.get(r.agentId).push(r);
    }
  }
  let sent = 0;
  for (const [memberId, byAgent] of per) {
    for (const [, list] of byAgent) {
      const first = list[list.length - 1];
      const title = list.length === 1
        ? `${first.agentName}: ${first.title || "new post"}`
        : `${first.agentName} posted ${list.length} times`;
      const body = list.slice(-4).map((r) => `• ${r.symbol ? `${r.symbol}: ` : ""}${r.title || r.kind}`).join("\n");
      try {
        sent += notify([memberId], { type: "agentFollowed", title, body, link: list.length === 1 ? `#/feed/item/${first.id}` : `#/agents/a/${encodeURIComponent(first.agentSlug)}` }).length;
      } catch (err) { console.error("[feed] follow notify failed:", err.message); }
    }
  }
  setCursor("follow_notify", max);
  return sent;
}

const sqlTime = (d) => d.toISOString().replace("T", " ").slice(0, 19);

// Evening digest for followed agents: everything from followed agents at level inbox (normal
// and low importance) or digest since the last one, one notification per member with news.
function digestLines(memberId, sinceId) {
  const m = activeMember(memberId);
  if (!m) return [];
  const rows = db.prepare(`SELECT f.*, a.name AS agentName, a.ownerId AS agentOwnerId, a.visibility AS agentVisibility, fl.notify
    FROM feed_items f JOIN agents a ON a.id = f.agentId JOIN agent_follows fl ON fl.agentId = f.agentId AND fl.memberId = ?
    WHERE f.id > ? ORDER BY f.id`).all(memberId, sinceId);
  return rows.filter((r) => (r.notify === "digest" || ((r.notify || "inbox") === "inbox" && r.importance !== "high")) && canSee(r, m))
    .map((r) => `${r.agentName}: ${r.symbol ? `${r.symbol} ` : ""}${r.title || r.kind}`.replace(/\s+/g, " ").trim());
}

function maybeSendDigest({ now = new Date(), notify = require("../notify").notify } = {}) {
  if (!ensure()) return null;
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6 || now.getUTCHours() < DIGEST_HOUR_UTC) return null;
  const day = now.toISOString().slice(0, 10);
  const marker = `follow_digest:${day}`;
  if (cursor(marker) !== null) return null;
  const since = cursor("follow_digest") ?? (db.prepare("SELECT MAX(id) AS m FROM feed_items WHERE createdAt < ?").get(sqlTime(new Date(now.getTime() - 864e5))).m || 0);
  const max = db.prepare("SELECT MAX(id) AS m FROM feed_items").get().m || 0;
  let sent = 0;
  for (const { memberId } of db.prepare("SELECT DISTINCT memberId FROM agent_follows").all()) {
    const lines = digestLines(memberId, since);
    if (!lines.length) continue;
    let body = "", shown = 0;
    for (const l of lines) { const next = `${body}${body ? "\n" : ""}• ${l}`; if (next.length > 460) break; body = next; shown++; }
    if (shown < lines.length) body += `\n+ ${lines.length - shown} more`;
    try { sent += notify([memberId], { type: "agentFollowed", title: `Agents you follow: ${lines.length} new post${lines.length === 1 ? "" : "s"}`, body, link: "#/feed/followed" }).length; }
    catch (err) { console.error("[feed] follow digest failed:", err.message); }
  }
  setCursor("follow_digest", max);
  setCursor(marker, max);
  return { sent };
}

module.exports = { LEVELS, normLevel, visibleAgent, follow, unfollow, status, followers, followedBy, notifyNew, maybeSendDigest, digestLines };
