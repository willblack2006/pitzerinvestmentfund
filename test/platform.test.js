// Agent platform foundation (WS1): schema, cron, jobs, bus, feed, memory, run plumbing,
// router auto-mount and the front-end registries.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-platform-")), "platform.db");

const db = require("../db");
const cron = require("../lib/platform/cron");
const jobs = require("../lib/platform/jobs");
const bus = require("../lib/platform/bus");
const feed = require("../lib/platform/feed");
const memory = require("../lib/agents/memory");
const runs = require("../lib/agents/runs");
const { marketHolidays, isTradingDay } = require("../lib/calendar");
const { BUILTINS } = require("../lib/schema/platform");

const iso = (d) => d.toISOString();
const member = (name = "Plat") => Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES (?, 'Analyst', '')").run(name).lastInsertRowid);

// ---- schema ----

test("schema: every platform table exists and agent_runs has the new columns", () => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  for (const t of ["agents", "agent_versions", "agent_follows", "feed_items", "feed_comments", "feed_reactions", "agent_memory", "agent_messages", "thesis_pillars", "thesis_checks", "thesis_versions", "scenario_marks"]) assert.ok(tables.has(t), t);
  const cols = db.prepare("PRAGMA table_info(agent_runs)").all().map((c) => c.name);
  for (const c of ["agentId", "parentRunId", "trigger", "triggeredBy", "shared", "summary"]) assert.ok(cols.includes(c), c);
});

test("schema: built-in agents seeded once per workflow, and loading again is idempotent", () => {
  const rows = db.prepare("SELECT * FROM agents WHERE kind = 'builtin'").all();
  assert.equal(rows.length, BUILTINS.length);
  assert.equal(rows.find((r) => r.workflow === "filing_flash").slug, "filing-flash");
  require("../lib/schema")(db, { addColumn: (t, c, d) => { const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name); if (!cols.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM agents WHERE kind = 'builtin'").get().c, BUILTINS.length);
});

test("schema: back-fill gives old runs the agent of their workflow", () => {
  const id = Number(db.prepare("INSERT INTO agent_runs (workflow, status) VALUES ('macro_brief', 'done')").run().lastInsertRowid);
  db.prepare("UPDATE agent_runs SET agentId = NULL WHERE id = ?").run(id);
  require("../lib/schema/platform")(db, { addColumn: () => {} });
  const r = db.prepare("SELECT r.agentId, a.workflow FROM agent_runs r JOIN agents a ON a.id = r.agentId WHERE r.id = ?").get(id);
  assert.equal(r.workflow, "macro_brief");
});

test("schema: CHECK constraints reject bad values", () => {
  assert.throws(() => db.prepare("INSERT INTO agents (slug, name, kind) VALUES ('x', 'X', 'robot')").run());
  assert.throws(() => db.prepare("INSERT INTO agent_memory (scope, kind, text) VALUES ('planet', 'fact', 't')").run());
  assert.throws(() => db.prepare("INSERT INTO thesis_pillars (symbol, text, status) VALUES ('A', 't', 'fine')").run());
});

// ---- market calendar ----

test("calendar: NYSE holidays, observed dates and trading days", () => {
  const h26 = marketHolidays(2026);
  for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]) assert.ok(h26.has(d), d);
  assert.equal(h26.size, 10);
  assert.ok(marketHolidays(2027).has("2027-12-24"), "Christmas on Saturday is observed Friday");
  assert.ok(!marketHolidays(2022).has("2021-12-31"), "New Year's on Saturday is not observed");
  assert.ok(marketHolidays(2027).has("2027-03-26"), "Good Friday 2027");
  assert.equal(isTradingDay("2026-11-26"), false);
  assert.equal(isTradingDay("2026-11-27"), true);
  assert.equal(isTradingDay("2026-11-28"), false);
});

// ---- cron ----

test("cron: weekday 08:30 New York from a Friday evening is Monday 08:30 EST", () => {
  const next = cron.nextRun("30 8 * * 1-5", "America/New_York", new Date("2026-11-20T23:00:00Z"));
  assert.equal(iso(next), "2026-11-23T13:30:00.000Z");
});

test("cron: same minute is not repeated; steps, lists and Sunday as 7", () => {
  assert.equal(iso(cron.nextRun("*/15 * * * *", "UTC", new Date("2026-11-19T12:15:00Z"))), "2026-11-19T12:30:00.000Z");
  assert.equal(iso(cron.nextRun("0 9,17 * * *", "UTC", new Date("2026-11-19T10:00:00Z"))), "2026-11-19T17:00:00.000Z");
  assert.equal(iso(cron.nextRun("0 6 * * 7", "UTC", new Date("2026-11-19T10:00:00Z"))), "2026-11-22T06:00:00.000Z");
  assert.equal(iso(cron.nextRun("0 0 1 * *", "UTC", new Date("2026-11-19T10:00:00Z"))), "2026-12-01T00:00:00.000Z");
});

test("cron: day-of-month and day-of-week both set means either", () => {
  // the 1st, or any Monday: from Wed Nov 18 the next is Mon Nov 23
  assert.equal(iso(cron.nextRun("0 12 1 * 1", "UTC", new Date("2026-11-18T00:00:00Z"))), "2026-11-23T12:00:00.000Z");
});

test("cron: DST spring-forward gap runs after the jump, fall-back runs once", () => {
  // 2027-03-14: 02:00 EST jumps to 03:00 EDT. 02:30 doesn't exist -> 03:30 EDT = 07:30Z.
  assert.equal(iso(cron.nextRun("30 2 * * *", "America/New_York", new Date("2027-03-14T05:00:00Z"))), "2027-03-14T07:30:00.000Z");
  // 2026-11-01: 01:30 happens twice (EDT 05:30Z, then EST 06:30Z); run at the first only.
  const first = cron.nextRun("30 1 * * *", "America/New_York", new Date("2026-11-01T04:00:00Z"));
  assert.equal(iso(first), "2026-11-01T05:30:00.000Z");
  assert.equal(iso(cron.nextRun("30 1 * * *", "America/New_York", first)), "2026-11-02T06:30:00.000Z");
  // A summer time is in EDT (UTC-4).
  assert.equal(iso(cron.nextRun("0 9 * * *", "America/New_York", new Date("2026-07-01T00:00:00Z"))), "2026-07-01T13:00:00.000Z");
});

test("cron: presets skip weekends and market holidays", () => {
  // Wed Nov 25 after 08:30 -> Thu Nov 26 is Thanksgiving -> Fri Nov 27 08:30 EST.
  assert.equal(iso(cron.nextRun("premarket", undefined, new Date("2026-11-25T15:00:00Z"))), "2026-11-27T13:30:00.000Z");
  // Plain cron ignores holidays unless asked.
  assert.equal(iso(cron.nextRun("30 8 * * 1-5", "America/New_York", new Date("2026-11-25T15:00:00Z"))), "2026-11-26T13:30:00.000Z");
  assert.equal(iso(cron.nextRun("30 8 * * 1-5", "America/New_York", new Date("2026-11-25T15:00:00Z"), { marketDays: true })), "2026-11-27T13:30:00.000Z");
  assert.equal(iso(cron.nextRun("weekly_fri", undefined, new Date("2026-11-19T12:00:00Z"))), "2026-11-20T22:00:00.000Z");
});

test("cron: bad expressions throw", () => {
  assert.throws(() => cron.nextRun("61 * * * *"));
  assert.throws(() => cron.nextRun("* * *"));
  assert.throws(() => cron.nextRun("nonsense_preset"));
  assert.equal(cron.nextRun("0 0 31 2 *", "UTC"), null, "Feb 31 never happens");
});

// ---- jobs ----

test("jobs: runOnce runs, records status, skips overlap and survives errors", async () => {
  let n = 0, release;
  jobs.register("t-slow", { everyMs: 1e9, fn: () => new Promise((r) => { n++; release = r; }) });
  const first = jobs.runOnce("t-slow");
  assert.equal(await jobs.runOnce("t-slow"), false, "second call skipped while running");
  release(); assert.equal(await first, true);
  assert.equal(n, 1);
  jobs.register("t-bad", { everyMs: 1e9, fn: async () => { throw new Error("boom"); } });
  assert.equal(await jobs.runOnce("t-bad"), true);
  const st = jobs.status().find((j) => j.name === "t-bad");
  assert.equal(st.lastError, "boom"); assert.equal(st.runs, 1);
  assert.throws(() => jobs.register("x", { everyMs: 0, fn: () => {} }));
  jobs.stop();
});

test("jobs: start() schedules registered jobs and later registrations", async () => {
  let a = 0, b = 0;
  jobs.register("t-a", { everyMs: 1e9, delayMs: 1, fn: () => { a++; } });
  jobs.start();
  jobs.register("t-b", { everyMs: 1e9, delayMs: 1, fn: () => { b++; } });
  await new Promise((r) => setTimeout(r, 30));
  jobs.stop();
  assert.equal(a, 1); assert.equal(b, 1);
});

// ---- bus ----

test("bus: on/emit delivers async, isolates failing handlers, sync mode awaits", async () => {
  bus._reset();
  const got = [];
  bus.on("tripwire", () => { throw new Error("bad handler"); });
  const offFn = bus.on("tripwire", (p) => got.push(p.symbol));
  bus.on("*", (p, e) => got.push(`*${e.type}`));
  assert.equal(bus.emit("tripwire", { symbol: "NVDA" }), 3);
  assert.deepEqual(got, [], "handlers run after emit returns");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(got.sort(), ["*tripwire", "NVDA"]);
  offFn();
  got.length = 0;
  await bus.emit("tripwire", { symbol: "MU" }, { sync: true });
  assert.deepEqual(got, ["*tripwire"]);
  assert.equal(bus.recent({ type: "tripwire" })[0].payload.symbol, "MU");
});

test("bus: handoff writes agent_messages, emits, and claim is first-wins", async () => {
  bus._reset();
  const seen = [];
  bus.on("handoff", (p) => seen.push(p));
  const from = db.prepare("SELECT id FROM agents WHERE workflow = 'filing_flash'").get().id;
  const id = bus.handoff({ fromAgentId: from, topic: "thesis", kind: "finding", symbol: "NVDA", payload: { note: "margin down" } });
  await new Promise((r) => setImmediate(r));
  assert.equal(seen[0].id, id);
  const row = db.prepare("SELECT * FROM agent_messages WHERE id = ?").get(id);
  assert.equal(row.topic, "thesis"); assert.equal(row.status, "open"); assert.equal(JSON.parse(row.payload).note, "margin down");
  const r1 = Number(db.prepare("INSERT INTO agent_runs (workflow) VALUES ('thesis_check')").run().lastInsertRowid);
  const r2 = Number(db.prepare("INSERT INTO agent_runs (workflow) VALUES ('thesis_check')").run().lastInsertRowid);
  assert.equal(bus.claim(id, r1), true); assert.equal(bus.claim(id, r2), false);
  assert.throws(() => bus.handoff({ kind: "handoff" }), /toAgentId or topic/);
  assert.throws(() => bus.handoff({ topic: "x", kind: "shout" }));
});

// ---- feed ----

test("feed: post stores, publishes SSE to members, lists newest first with filters", async () => {
  const events = require("../lib/events");
  const sent = [];
  const fakeRes = { write: (s) => sent.push(s) };
  events._clients.add({ res: fakeRes, member: { id: 1 } });
  events._clients.add({ res: { write: () => sent.push("VISITOR") }, member: null });
  const a = feed.post({ kind: "tripwire_tripped", title: "NVDA under $100", symbol: "nvda", body: { price: 99 }, importance: "high" });
  const b = feed.post({ kind: "note_shared", actorType: "member", actorId: 1, title: "Note" });
  events._clients.clear();
  assert.ok(sent.some((s) => s.startsWith("event: feed")));
  assert.ok(!sent.includes("VISITOR"), "visitors don't get feed events");
  const items = feed.list({ limit: 10 });
  assert.equal(items[0].id, b); assert.equal(items[1].id, a);
  assert.equal(items[1].symbol, "NVDA"); assert.equal(items[1].body.price, 99);
  assert.deepEqual(feed.list({ symbol: "NVDA" }).map((i) => i.id), [a]);
  assert.deepEqual(feed.list({ before: b, limit: 1 }).map((i) => i.id), [a]);
  assert.throws(() => feed.post({ kind: "made_up" }), /Unknown feed kind/);
});

// ---- memory ----

test("memory: remember/recall by symbol, agent, member and fund; supersede and retract", () => {
  const m = member("Mem");
  const agentId = db.prepare("SELECT id FROM agents WHERE workflow = 'thesis_check'").get().id;
  const f = memory.remember({ scope: "symbol", scopeKey: "nvda", kind: "fact", text: "Data center is 88% of revenue", sourceUrl: "https://sec.gov/x", agentId });
  memory.remember({ scope: "symbol", scopeKey: "MU", kind: "fact", text: "Other company" });
  memory.remember({ scope: "fund", kind: "decision", text: "Max 10% per position", memberId: m });
  memory.remember({ scope: "member", scopeKey: m, kind: "preference", text: "Likes short briefs", memberId: m });
  memory.remember({ scope: "symbol", scopeKey: "NVDA", kind: "observation", text: "old", expiresAt: "2000-01-01T00:00:00Z" });
  const got = memory.recall({ symbol: "NVDA" });
  assert.deepEqual(got.map((r) => r.text).sort(), ["Data center is 88% of revenue", "Max 10% per position"]);
  assert.equal(got.find((r) => r.id === f).by.name, "Thesis check");
  assert.equal(memory.recall({ symbol: "NVDA", memberId: m }).length, 3);
  assert.equal(memory.recall({ symbol: "NVDA", kinds: ["fact"] }).length, 1);
  assert.equal(memory.recall({ symbol: "NVDA", query: "88%" }).length, 1, "LIKE wildcards stripped from the query");
  assert.equal(memory.recall({ symbol: "NVDA", query: "%" }).length, 2, "a bare wildcard matches like an empty query");
  assert.equal(memory.recall({ symbol: "NVDA", query: "data center" }).length, 1);
  const f2 = memory.supersede(f, { text: "Data center is 90% of revenue" });
  assert.equal(db.prepare("SELECT status FROM agent_memory WHERE id = ?").get(f).status, "superseded");
  assert.equal(memory.dossier("nvda").facts[0].id, f2);
  assert.equal(memory.retract(f2, m), true);
  assert.equal(memory.dossier("NVDA").facts.length, 0);
  assert.throws(() => memory.remember({ scope: "symbol", kind: "fact", text: "no key" }), /scopeKey/);
  assert.throws(() => memory.remember({ scope: "fund", kind: "gossip", text: "x" }));
});

// ---- runs plumbing ----

test("runs: platform fields recorded, agent resolved from workflow, feed post and agent_output emitted", async () => {
  bus._reset();
  const outputs = [];
  bus.on("agent_output", (p) => outputs.push(p));
  const parent = Number(db.prepare("INSERT INTO agent_runs (workflow) VALUES ('macro_brief')").run().lastInsertRowid);
  const out = await runs.run({ workflow: "macro_brief", symbol: "SPY", parentRunId: parent, trigger: "handoff" }, async (ctx) => {
    assert.ok(ctx.agentId);
    ctx.remember({ scope: "symbol", scopeKey: "SPY", kind: "observation", text: "Curve steepened" });
    assert.equal(ctx.recall({ kinds: ["observation"] })[0].text, "Curve steepened");
    return { title: "Macro brief: curve", summary: "Rates fell." };
  });
  const r = db.prepare("SELECT r.*, a.workflow AS aw FROM agent_runs r JOIN agents a ON a.id = r.agentId WHERE r.id = ?").get(out.runId);
  assert.equal(r.aw, "macro_brief"); assert.equal(r.parentRunId, parent); assert.equal(r.trigger, "handoff"); assert.equal(r.summary, "Rates fell.");
  const mem = db.prepare("SELECT * FROM agent_memory WHERE text = 'Curve steepened'").get();
  assert.equal(mem.sourceRunId, out.runId); assert.equal(mem.createdByAgent, r.agentId);
  const item = feed.list({ agentId: r.agentId })[0];
  assert.equal(item.kind, "agent_brief"); assert.equal(item.runId, out.runId); assert.equal(item.title, "Macro brief: curve");
  await new Promise((res) => setImmediate(res));
  assert.equal(outputs[0].runId, out.runId); assert.equal(outputs[0].workflow, "macro_brief");
  assert.ok(db.prepare("SELECT lastRunAt FROM agents WHERE id = ?").get(r.agentId).lastRunAt);
});

test("runs: member runs default to manual and private workflows don't reach the feed", async () => {
  const m = member("Asker");
  const before = db.prepare("SELECT COUNT(*) c FROM feed_items").get().c;
  const out = await runs.run({ workflow: "ask_pif", memberId: m }, async () => ({ answer: "42" }));
  const r = db.prepare("SELECT trigger, triggeredBy FROM agent_runs WHERE id = ?").get(out.runId);
  assert.equal(r.trigger, "manual"); assert.equal(r.triggeredBy, m);
  const ev = await runs.run({ workflow: "weekly_memo", eventId: null }, async () => ({ title: "Memo" }));
  assert.equal(db.prepare("SELECT trigger FROM agent_runs WHERE id = ?").get(ev.runId).trigger, "schedule");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM feed_items").get().c, before, "ask_pif and weekly_memo stay out of the feed");
});

test("runs: an unknown workflow still runs (no agent, no feed)", async () => {
  const out = await runs.run({ workflow: "test_only" }, async () => ({ title: "x" }));
  assert.equal(db.prepare("SELECT agentId FROM agent_runs WHERE id = ?").get(out.runId).agentId, null);
});

// ---- server auto-mount and front-end registries ----

test("server: auto-mounted routers are reachable under /api", async () => {
  const app = require("../server");
  const srv = app.listen(0);
  try {
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/platform/health`);
    assert.equal(r.status, 401, "mounted (and requires sign-in) rather than 404");
  } finally { srv.close(); }
});

test("front end: registries exist and are append-only lists", () => {
  const pub = path.join(__dirname, "..", "public");
  assert.match(fs.readFileSync(path.join(pub, "routes.d", "index.js"), "utf8"), /export const ROUTE_FILES = \[/);
  assert.match(fs.readFileSync(path.join(pub, "views", "agents", "index.js"), "utf8"), /export const TAB_FILES = \[/);
  assert.ok(fs.existsSync(path.join(pub, "css", "index.css")));
  assert.match(fs.readFileSync(path.join(pub, "index.html"), "utf8"), /href="css\/index.css"/);
  assert.match(fs.readFileSync(path.join(pub, "router.js"), "utf8"), /routes\.d\/index\.js/);
});
