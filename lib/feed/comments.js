// Comments and reactions on feed items (WS7). A comment can @mention members (inbox
// notification) and agents (the agent answers in the thread, billed to the commenter).
// Live updates go out on the /api/events stream as feed.comment, feed.comment_deleted,
// feed.reaction and feed.agent_working, only to members who may see the item.
const { db, ensure } = require("./store");
const query = require("./query");
const mentions = require("./mentions");
const events = require("../events");
const chat = require("../chat");

const REACTIONS = chat.REACTIONS;
const MAX_TEXT = 2000;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status, expose: true });

const nameOf = (id) => (id == null ? null : db.prepare("SELECT name FROM members WHERE id = ?").get(id)?.name || "Former member");
const agentOf = (id) => (id == null ? null : db.prepare("SELECT id, slug, name, icon FROM agents WHERE id = ?").get(id) || null);

function shape(c, member) {
  const deleted = !!c.deletedAt;
  const agent = c.agentId ? agentOf(c.agentId) : null;
  let m = [];
  try { m = JSON.parse(c.mentions || "[]"); } catch { /* old rows */ }
  return {
    id: c.id, itemId: c.itemId, memberId: c.memberId ?? null,
    authorName: agent ? agent.name : c.memberId ? nameOf(c.memberId) : "Ask PIF",
    agent: agent ? { id: agent.id, slug: agent.slug, name: agent.name, icon: agent.icon || "bot" } : null,
    byAgent: !c.memberId, runId: c.runId ?? null,
    text: deleted ? "" : c.text, deleted, mentions: m, createdAt: c.createdAt,
    canDelete: !deleted && !!member && (c.memberId === member.id || !!member.isAdmin),
  };
}

function publish(type, data, row) {
  const to = query.audience(row);
  events.publish(type, data, { membersOnly: true, ...(to ? { to } : {}) });
}

function list(member, itemId) {
  const item = query.get(member, itemId);
  if (!item) return null;
  const rows = db.prepare("SELECT * FROM feed_comments WHERE itemId = ? ORDER BY id").all(item.id);
  return { item, comments: rows.map((c) => shape(c, member)) };
}

// At most 12 comments a minute per member (in memory; resets on restart, which is fine).
const recent = new Map();
function rateLimited(memberId) {
  const now = Date.now();
  const l = (recent.get(memberId) || []).filter((t) => now - t < 60e3);
  if (l.length >= 12) return true;
  l.push(now);
  recent.set(memberId, l);
  return false;
}

// Writes a comment and kicks off any @agent runs in the background. Returns
// { comment, agentRuns: [{ slug, name }], notices: [text] }. `runner` is injectable for tests.
function add(member, itemId, rawText, { runner = mentions.runMention } = {}) {
  if (!ensure()) throw bad("The team feed isn't set up on this server yet.", 503);
  const item = query.get(member, itemId);
  if (!item) throw bad("That feed item isn't there.", 404);
  const text = String(rawText ?? "").trim();
  if (!text) throw bad("Write a comment.");
  if (text.length > MAX_TEXT) throw bad(`Comments are limited to ${MAX_TEXT} characters.`);
  if (rateLimited(member.id)) throw bad("Slow down a little: at most 12 comments a minute.", 429);

  const memberIds = mentions.parseMemberMentions(text, member.id);
  const agentHits = mentions.parseAgentMentions(text, mentions.addressableAgents(member));
  const info = db.prepare("INSERT INTO feed_comments (itemId, memberId, text, mentions) VALUES (?, ?, ?, ?)")
    .run(item.id, member.id, text, JSON.stringify({ members: memberIds, agents: agentHits.map((h) => h.agent?.slug || "pif") }));
  const row = db.prepare("SELECT * FROM feed_comments WHERE id = ?").get(info.lastInsertRowid);
  const raw = query.rawItem(item.id);
  const comment = shape(row, member);
  publish("feed.comment", { ...comment, canDelete: false }, raw);

  // Members only hear about it if they can see the item.
  const audience = query.audience(raw);
  const notifyIds = audience ? memberIds.filter((id) => audience.includes(id)) : memberIds;
  if (notifyIds.length) {
    try {
      require("../notify").notify(notifyIds, {
        type: "mention", title: `${member.name} mentioned you on the team feed`,
        body: `${item.title ? `${item.title}: ` : ""}${text}`.slice(0, 300), link: `#/feed/item/${item.id}`,
      });
    } catch (err) { console.error("[feed] mention notify failed:", err.message); }
  }

  const notices = [];
  const agentRuns = [];
  if (agentHits.length) {
    const openai = require("../sources/openai");
    if (!(member.canUseAi || member.isAdmin)) notices.push("Agents answer @mentions only for members with AI access. Ask an admin to turn it on.");
    else if (!openai.configured()) notices.push("AI isn't configured on this server, so the agent can't answer.");
    else {
      const thread = db.prepare("SELECT * FROM feed_comments WHERE itemId = ? AND id < ? AND deletedAt IS NULL ORDER BY id").all(item.id, row.id).map((c) => shape(c, member));
      for (const hit of agentHits) {
        const who = hit.agent && !hit.ask ? { id: hit.agent.id, slug: hit.agent.slug, name: hit.agent.name } : { id: hit.agent?.id ?? null, slug: hit.agent?.slug || "pif", name: hit.agent?.name || "Ask PIF" };
        agentRuns.push(who);
        publish("feed.agent_working", { itemId: item.id, commentId: row.id, agent: who, by: member.name }, raw);
        Promise.resolve()
          .then(() => runner({ ...hit, item, thread, comment, member }))
          .then((r) => replyFromAgent(item.id, { agentId: who.id, runId: r.runId, text: r.text || "(no answer)" }))
          .catch((err) => replyFromAgent(item.id, { agentId: who.id, runId: err.runId ?? null, text: `I couldn't answer that: ${String(err.message || err).slice(0, 300)}`, failed: true }))
          .catch((err) => console.error("[feed] agent reply failed:", err.message));
      }
    }
  }
  return { comment, agentRuns, notices };
}

// An agent's (or Ask PIF's) reply in a thread. memberId stays null so it reads as the agent.
function replyFromAgent(itemId, { agentId = null, runId = null, text, failed = false }) {
  ensure();
  const info = db.prepare("INSERT INTO feed_comments (itemId, memberId, agentId, runId, text, mentions) VALUES (?, NULL, ?, ?, ?, ?)")
    .run(itemId, agentId, runId, String(text).slice(0, 6000), JSON.stringify(failed ? { failed: true } : {}));
  const row = db.prepare("SELECT * FROM feed_comments WHERE id = ?").get(info.lastInsertRowid);
  const c = shape(row, null);
  publish("feed.comment", c, query.rawItem(itemId));
  return c;
}

function remove(member, commentId) {
  ensure();
  const c = db.prepare("SELECT * FROM feed_comments WHERE id = ?").get(Number(commentId));
  if (!c || c.deletedAt || !query.get(member, c.itemId)) throw bad("Comment not found.", 404);
  if (!(c.memberId === member.id || member.isAdmin)) throw bad("You can only delete your own comments.", 403);
  db.prepare("UPDATE feed_comments SET deletedAt = datetime('now') WHERE id = ?").run(c.id);
  publish("feed.comment_deleted", { id: c.id, itemId: c.itemId }, query.rawItem(c.itemId));
}

// Toggle one of the fixed reactions; returns the item's reactions.
function react(member, itemId, emoji) {
  if (!ensure()) throw bad("The team feed isn't set up on this server yet.", 503);
  const item = query.get(member, itemId);
  if (!item) throw bad("That feed item isn't there.", 404);
  if (!REACTIONS.includes(emoji)) throw bad("Unknown reaction.");
  const had = db.prepare("SELECT 1 FROM feed_reactions WHERE itemId = ? AND memberId = ? AND emoji = ?").get(item.id, member.id, emoji);
  if (had) db.prepare("DELETE FROM feed_reactions WHERE itemId = ? AND memberId = ? AND emoji = ?").run(item.id, member.id, emoji);
  else db.prepare("INSERT INTO feed_reactions (itemId, memberId, emoji) VALUES (?, ?, ?)").run(item.id, member.id, emoji);
  const reactions = db.prepare("SELECT emoji, COUNT(*) AS count, SUM(memberId = ?) AS mine FROM feed_reactions WHERE itemId = ? GROUP BY emoji").all(member.id, item.id)
    .map((r) => ({ emoji: r.emoji, count: r.count, mine: !!r.mine }));
  publish("feed.reaction", { itemId: item.id, reactions: reactions.map(({ emoji, count }) => ({ emoji, count })) }, query.rawItem(item.id));
  return reactions;
}

module.exports = { list, add, remove, react, replyFromAgent, shape, REACTIONS, MAX_TEXT };
