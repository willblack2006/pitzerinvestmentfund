// Team feed (WS7): privacy, filters, comments, @mentions, reactions, sharing runs, follow-ups,
// follow notifications and the activity hooks. In-process against a throwaway database; the
// agent runner for @mentions is injected, so no model is called.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-feed-")), "feed.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const feed = require("../lib/platform/feed");
const query = require("../lib/feed/query");
const comments = require("../lib/feed/comments");
const share = require("../lib/feed/share");
const follows = require("../lib/feed/follows");
const activity = require("../lib/feed/activity");
const agentsInfo = require("../lib/feed/agents");
const presence = require("../lib/feed/presence");
const mentions = require("../lib/feed/mentions");

function member(name, { isAdmin = 0, canUseAi = 1 } = {}) {
  const id = Number(db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, isAdmin, canUseAi, active) VALUES (?, 'analyst', 'x', ?, 'x:y', ?, ?, 1)")
    .run(name, `${name.toLowerCase().replace(/\s+/g, ".")}@t.edu`, isAdmin, canUseAi).lastInsertRowid);
  return { id, name, isAdmin: !!isAdmin, canUseAi: !!canUseAi };
}
function agent(slug, { ownerId = null, visibility = "team", kind = "custom", name = slug } = {}) {
  return Number(db.prepare("INSERT INTO agents (slug, name, kind, workflow, ownerId, visibility, spec) VALUES (?, ?, ?, 'engine', ?, ?, ?)")
    .run(slug, name, kind, ownerId, visibility, JSON.stringify({ v: 1, scope: { universe: "holdings" }, triggers: [{ type: "schedule", preset: "premarket" }], steps: [{ id: "a1", type: "ai" }] })).lastInsertRowid);
}

const ana = member("Ana Lyst"), ben = member("Ben Chart"), admin = member("Ada Min", { isAdmin: 1 }), viv = member("Viv NoAi", { canUseAi: 0 });
const teamAgent = agent("nvda-watch", { ownerId: ana.id, name: "NVDA watch" });
const privAgent = agent("secret-sauce", { ownerId: ana.id, visibility: "private", name: "Secret sauce" });
db.prepare("INSERT OR IGNORE INTO positions (symbol, shares, lastPrice) VALUES ('NVDA', 10, 100)").run();

test("privacy: private agents' posts show only to the owner and admins", () => {
  const pub = feed.post({ kind: "agent_brief", actorType: "agent", agentId: teamAgent, symbol: "NVDA", title: "NVDA brief" });
  const sec = feed.post({ kind: "agent_brief", actorType: "agent", agentId: privAgent, symbol: "XOM", title: "Private brief" });
  const ids = (m) => query.list(m).items.map((i) => i.id);
  assert.ok(ids(ben).includes(pub));
  assert.ok(!ids(ben).includes(sec), "Ben can't see Ana's private agent");
  assert.ok(ids(ana).includes(sec));
  assert.ok(ids(admin).includes(sec));
  assert.equal(query.get(ben, sec), null);
  assert.deepEqual(query.audience(query.rawItem(sec)).sort(), [ana.id, admin.id].sort());
  assert.equal(query.audience(query.rawItem(pub)), null);
});

test("filters: holdings, mine, followed, high, ticker, member", () => {
  const trade = feed.post({ kind: "trade_executed", actorType: "member", actorId: ben.id, symbol: "AAPL", title: "Bought AAPL", importance: "high" });
  const hold = query.list(ben, { filter: "holdings" }).items;
  assert.ok(hold.every((i) => i.symbol === "NVDA") && hold.length > 0);
  assert.ok(query.list(ana, { filter: "mine" }).items.every((i) => i.agent?.ownerId === ana.id || i.actor.id === ana.id));
  assert.deepEqual(query.list(ben, { filter: "high" }).items.map((i) => i.id), [trade]);
  assert.deepEqual(query.list(ben, { symbol: "aapl" }).items.map((i) => i.id), [trade]);
  assert.ok(query.list(ana, { memberId: ben.id }).items.some((i) => i.id === trade));
  assert.equal(query.list(ben, { filter: "followed" }).items.length, 0);
  follows.follow(ben, teamAgent);
  assert.ok(query.list(ben, { filter: "followed" }).items.length > 0);
  follows.unfollow(ben, teamAgent);
});

test("unread: own actions never count, markRead moves the marker", () => {
  query.markRead(ben, 0);
  const before = query.unreadCount(ben).unread;
  feed.post({ kind: "note_shared", actorType: "member", actorId: ben.id, title: "my note" });
  assert.equal(query.unreadCount(ben).unread, before, "own post isn't unread");
  feed.post({ kind: "note_shared", actorType: "member", actorId: ana.id, title: "Ana's note" });
  assert.equal(query.unreadCount(ben).unread, before + 1);
  const top = query.list(ben).items[0].id;
  query.markRead(ben, top);
  assert.equal(query.unreadCount(ben).unread, 0);
  assert.equal(query.list(ben).items[0].unread, false);
});

test("comments: @member notifies, @agent runs and replies in the thread", async () => {
  const item = feed.post({ kind: "agent_brief", actorType: "agent", agentId: teamAgent, symbol: "NVDA", title: "Guidance raised", body: { summary: "Revenue guide up 8%." } });
  const calls = [];
  const runner = async (hit) => { calls.push(hit); return { runId: null, text: `Answer from ${hit.agent?.slug || "pif"}` }; };
  const r = comments.add(ana, item, "@Ben what do you think? @nvda-watch is this priced in? @pif too", { runner });
  assert.deepEqual(r.comment.mentions.members, [ben.id]);
  assert.deepEqual(r.agentRuns.map((a) => a.slug), ["nvda-watch", "pif"]);
  const inbox = db.prepare("SELECT * FROM notifications WHERE memberId = ? AND type = 'mention'").all(ben.id);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].link, new RegExp(`#/feed/item/${item}`));
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(calls.length, 2);
  assert.match(calls[0].item.title, /Guidance raised/);
  const thread = comments.list(ben, item).comments;
  assert.equal(thread.length, 3);
  assert.deepEqual(thread.slice(1).map((c) => [c.byAgent, c.text]).sort(), [[true, "Answer from nvda-watch"], [true, "Answer from pif"]]);
  assert.equal(thread.find((c) => c.agent?.slug === "nvda-watch").authorName, "NVDA watch");
  assert.equal(query.get(ben, item).commentCount, 3);
});

test("comments: no AI access means no agent run, and a failing agent says so", async () => {
  const item = feed.post({ kind: "agent_brief", actorType: "agent", agentId: teamAgent, title: "x" });
  const r = comments.add(viv, item, "@nvda-watch hello", { runner: async () => { throw new Error("should not run"); } });
  assert.equal(r.agentRuns.length, 0);
  assert.match(r.notices[0], /AI access/);
  comments.add(ben, item, "@pif hello", { runner: async () => { throw Object.assign(new Error("budget hit"), { runId: null }); } });
  await new Promise((res) => setTimeout(res, 30));
  assert.match(comments.list(ben, item).comments.at(-1).text, /couldn't answer that: budget hit/);
});

test("comments: @private agent is only addressable by its owner; delete rules", () => {
  assert.equal(mentions.parseAgentMentions("@secret-sauce hi", mentions.addressableAgents(ben)).length, 0);
  assert.equal(mentions.parseAgentMentions("@secret-sauce hi", mentions.addressableAgents(ana)).length, 1);
  const item = feed.post({ kind: "agent_brief", actorType: "agent", agentId: teamAgent, title: "y" });
  const c = comments.add(ben, item, "first").comment;
  assert.throws(() => comments.remove(ana, c.id), /own comments/);
  comments.remove(admin, c.id);
  assert.equal(comments.list(ben, item).comments[0].deleted, true);
  assert.throws(() => comments.add(ben, privAgent && feed.post({ kind: "agent_brief", actorType: "agent", agentId: privAgent, title: "p" }), "hi"), /isn't there/);
});

test("reactions toggle", () => {
  const item = feed.post({ kind: "agent_brief", actorType: "agent", agentId: teamAgent, title: "z" });
  assert.deepEqual(comments.react(ben, item, "🔥"), [{ emoji: "🔥", count: 1, mine: true }]);
  assert.deepEqual(comments.react(ana, item, "🔥"), [{ emoji: "🔥", count: 2, mine: true }]);
  assert.deepEqual(comments.react(ben, item, "🔥"), [{ emoji: "🔥", count: 1, mine: false }]);
  assert.throws(() => comments.react(ben, item, "💩"), /Unknown reaction/);
});

test("share an Ask run: posts once, teammates can read it and ask a follow-up", async () => {
  const runId = Number(db.prepare("INSERT INTO agent_runs (workflow, memberId, status, output, costUsd) VALUES ('ask_pif', ?, 'done', ?, 0.02)")
    .run(ana.id, JSON.stringify({ question: "Is MU cheap?", answer: "MU trades at 9x forward earnings.", claims: [{ text: "9x", source_url: "https://x", sourced: true }], followUps: ["vs peers?"] })).lastInsertRowid);
  const run = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
  assert.equal(share.canRead(ben, run), false, "private before sharing");
  assert.throws(() => share.share(ben, runId), /your own runs/);
  const s = share.share(ana, runId, { note: "worth a look" });
  assert.equal(share.share(ana, runId).itemId, s.itemId, "idempotent");
  const item = query.get(ben, s.itemId);
  assert.equal(item.kind, "ask_shared");
  assert.match(item.title, /Ana Lyst asked: Is MU cheap\?/);
  assert.equal(item.body.note, "worth a look");
  assert.equal(db.prepare("SELECT shared FROM agent_runs WHERE id = ?").get(runId).shared, 1);
  assert.equal(share.canRead(ben, db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId)), true);
  let seen;
  const r = await share.followUp(ben, s.itemId, "And versus SK Hynix?", { runner: async (x) => { seen = x; return { runId: 999, output: { answer: "ok" }, costUsd: 0.01 }; } });
  assert.equal(r.parentRunId, runId);
  assert.match(seen.context, /MU trades at 9x/);
  assert.equal(share.unshare(ana, runId).removed, 1);
  assert.equal(query.get(ben, s.itemId), null);
});

test("follow notifications honour the level and fold bursts", () => {
  follows.notifyNew(); // first pass only sets the watermark
  follows.follow(ben, teamAgent, "inbox");
  follows.follow(admin, teamAgent, "all");
  follows.follow(viv, teamAgent, "off");
  db.prepare("DELETE FROM notifications").run();
  feed.post({ kind: "agent_brief", actorType: "agent", agentId: teamAgent, symbol: "NVDA", title: "routine" });
  feed.post({ kind: "agent_alert", actorType: "agent", agentId: teamAgent, symbol: "NVDA", title: "Thesis weakened", importance: "high" });
  feed.post({ kind: "agent_brief", actorType: "agent", agentId: privAgent, title: "private" });
  follows.notifyNew();
  const n = (m) => db.prepare("SELECT title FROM notifications WHERE memberId = ? AND type = 'agentFollowed'").all(m.id).map((r) => r.title);
  assert.deepEqual(n(ben), ["NVDA watch: Thesis weakened"], "inbox level: only the important one");
  assert.deepEqual(n(admin), ["NVDA watch posted 2 times"], "all level: one folded notification");
  assert.deepEqual(n(viv), []);
  assert.equal(follows.notifyNew(), 0, "nothing new, nothing sent");
  assert.throws(() => follows.follow(ben, teamAgent, "loud"), /Notify level/);
});

test("evening digest for followed agents: weekdays after 22:00 UTC, once a day", () => {
  db.prepare("DELETE FROM notifications").run();
  db.prepare("INSERT OR REPLACE INTO feed_cursors (name, lastId) VALUES ('follow_digest', 0)").run();
  const fri = new Date("2026-11-20T23:00:00Z");
  assert.equal(follows.maybeSendDigest({ now: new Date("2026-11-20T12:00:00Z") }), null);
  const r = follows.maybeSendDigest({ now: fri });
  assert.ok(r.sent >= 1);
  const ben1 = db.prepare("SELECT title, body FROM notifications WHERE memberId = ? AND type = 'agentFollowed'").get(ben.id);
  assert.match(ben1.title, /Agents you follow/);
  assert.match(ben1.body, /routine/);
  assert.equal(follows.maybeSendDigest({ now: fri }), null, "only once a day");
});

test("activity hooks post member actions to the feed", () => {
  const p = { id: 7, symbol: "MU", direction: "buy", title: "Memory upcycle", thesis: "HBM demand." };
  const a = activity.pitchOpened(p, ana);
  const b = activity.pitchDecided(p, "approved", admin, { yes: 4, no: 1 });
  const c = activity.tradeExecuted("transaction.buy", { symbol: "MU", shares: 5, price: 101.5 }, admin);
  const d = activity.tripwireTripped({ symbol: "MU", note: "stop" }, "Price 80 is below 85.", "price below $85");
  const e = activity.noteShared({ symbol: "MU", body: "Read the 10-Q.", memberId: ben.id }, ben);
  const items = [a, b, c, d, e].map((id) => query.get(ben, id));
  assert.deepEqual(items.map((i) => i.kind), ["pitch_opened", "vote_closed", "trade_executed", "tripwire_tripped", "note_shared"]);
  assert.equal(items[1].importance, "high");
  assert.match(items[2].title, /The fund bought 5 MU at \$101.50/);
  assert.equal(activity.post({ kind: "nope" }), null, "a bad post never throws");
});

test("directory and profile: stats, followers, privacy", () => {
  db.prepare("INSERT INTO agent_runs (workflow, agentId, status, costUsd) VALUES ('engine', ?, 'done', 0.05)").run(teamAgent);
  const dir = agentsInfo.directory(ben, { sort: "followed" });
  assert.ok(!dir.agents.some((a) => a.slug === "secret-sauce"));
  assert.equal(dir.agents[0].slug, "nvda-watch", "most followed first");
  assert.ok(agentsInfo.directory(ana).agents.some((a) => a.slug === "secret-sauce"));
  const p = agentsInfo.profile(ben, "nvda-watch");
  assert.equal(p.agent.owner.name, "Ana Lyst");
  assert.deepEqual(p.agent.triggers, ["Weekdays before the open"]);
  assert.equal(p.stats.runs30d, 1);
  assert.ok(p.followers.some((f) => f.id === ben.id));
  assert.equal(p.can.edit, false);
  assert.equal(agentsInfo.profile(ana, "nvda-watch").can.edit, true);
  assert.equal(agentsInfo.profile(ben, "secret-sauce"), null);
  const builtin = agentsInfo.profile(ben, "ask-pif");
  assert.equal(builtin.agent.kind, "builtin");
});

test("presence: heartbeat, leave and expiry", () => {
  assert.deepEqual(presence.beat(ana, "agent:nvda-watch", { now: 1000 }).map((v) => v.name), ["Ana Lyst"]);
  presence.beat(ben, "agent:nvda-watch", { now: 2000 });
  assert.equal(presence.list("agent:nvda-watch", 3000).length, 2);
  presence.beat(ana, "agent:nvda-watch", { leave: true, now: 3000 });
  assert.deepEqual(presence.list("agent:nvda-watch", 3000).map((v) => v.name), ["Ben Chart"]);
  assert.equal(presence.list("agent:nvda-watch", 2000 + presence.TTL_MS + 1).length, 0);
  assert.equal(presence.valid("<script>"), false);
});
