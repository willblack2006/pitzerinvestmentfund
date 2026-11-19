// Agent engine (WS2): spec validation, conditions, rule-only agents on a schedule and on an
// event, an AI agent against a fake OpenAI, the per-agent budget stop, auto-pause, handoff loop
// protection, the dry run, and the API. No network: quotes, charts and OpenAI are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-engine-")), "engine.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const { setSettings } = require("../lib/settings");
const spec = require("../lib/agents/spec");
const conditions = require("../lib/agents/conditions");
const registry = require("../lib/metrics/registry");
const engine = require("../lib/agents/engine");
const triggers = require("../lib/agents/triggers");
const bus = require("../lib/platform/bus");
const { dryRun } = require("../lib/agents/dryRun");
const tools = require("../lib/agents/tools");
triggers.install();

// A controllable metric so tests don't depend on Yahoo.
const testValues = {};
registry.register("test.value", { label: "Test value", unit: "", group: "test", source: "custom", fetch: async (s) => ({ value: testValues[s] ?? null, asOf: "2026-11-19", sourceUrl: `#/research/${s}` }) });

// Synthetic daily closes: flat at 100 with a -8% day on 2026-11-10 and a +5% day on 2026-11-17.
function chart() {
  const out = [];
  let p = 100;
  for (let t = Date.parse("2026-01-02T00:00:00Z"); t <= Date.parse("2026-11-19T00:00:00Z"); t += 864e5) {
    const date = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    p = date === "2026-11-10" ? p * 0.92 : date === "2026-11-17" ? p * 1.05 : p * (1 + (out.length % 2 ? 0.004 : -0.004));
    out.push({ date, close: p });
  }
  return out;
}
const stubLoaders = () => registry.createLoaders({ chart: async () => chart(), quote: async () => null });

const realFetch = global.fetch;
let replies = [], requests = [];
const msg = (obj, usage = { input_tokens: 800, output_tokens: 90 }) => ({ model: "gpt-6-luna", status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] });

let owner, other;
test.before(() => {
  setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5, maxPositionPct: 20 });
  owner = Number(db.prepare("INSERT INTO members (name, role, pinHash, canUseAi) VALUES ('Owner', 'Analyst', '', 1)").run().lastInsertRowid);
  other = Number(db.prepare("INSERT INTO members (name, role, pinHash, canUseAi) VALUES ('Fan', 'Analyst', '', 1)").run().lastInsertRowid);
  db.prepare("DELETE FROM positions").run();
  db.prepare("INSERT INTO positions (symbol, shares, lastPrice, avgCost, totalCost, marketValue) VALUES ('NVDA', 10, 100, 80, 800, 1000), ('XOM', 5, 100, 100, 500, 500)").run();
  tools.setBaseUrl("http://app.test");
});
test.beforeEach(() => {
  replies = []; requests = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) { requests.push(JSON.parse(opts.body)); const r = replies.shift(); return r ? new Response(JSON.stringify(r), { status: 200 }) : new Response(JSON.stringify({ error: { message: "upstream down" } }), { status: 500 }); }
    if (u.startsWith("http://app.test/api/research/")) return new Response(JSON.stringify({ symbol: u.split("/").pop(), quote: { price: 100 } }), { status: 200 });
    return new Response(JSON.stringify({ error: "offline" }), { status: 404 });
  };
});
test.afterEach(() => { global.fetch = realFetch; });

let n = 0;
function makeAgent(s, { status = "active", ownerId = owner, name } = {}) {
  const { spec: clean } = spec.validate(s);
  const slug = `t-${++n}`;
  const id = Number(db.prepare("INSERT INTO agents (slug, name, kind, workflow, ownerId, visibility, status, spec) VALUES (?, ?, 'custom', 'engine', ?, 'team', ?, ?)").run(slug, name || `Test agent ${n}`, ownerId, status, JSON.stringify(clean)).lastInsertRowid);
  return engine.getAgent(id);
}
const feedFor = (agentId) => db.prepare("SELECT * FROM feed_items WHERE agentId = ? ORDER BY id").all(agentId);

// ---- Spec ----

test("spec: templates validate, errors are friendly and point at the field", () => {
  const dir = path.join(__dirname, "..", "lib", "agents", "templates");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 12);
  let ruleOnly = 0;
  for (const f of files) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const r = spec.normalize(t.spec);
    assert.deepEqual(r.errors, [], `${f}: ${JSON.stringify(r.errors)}`);
    if (r.estimate.free) ruleOnly++;
    assert.ok(spec.describe(r.spec).length > 20);
  }
  assert.equal(ruleOnly, 4, "four rule-only templates");

  const bad = spec.normalize({
    scope: { universe: "symbols", symbols: ["nvda", "BAD TICKER"] },
    triggers: [{ type: "schedule", cron: "61 8 * * *" }, { type: "event", on: "moon_landing" }],
    conditions: [{ metric: "quote.chngPct", op: "<", value: -5 }],
    steps: [{ id: "a1", type: "ai", instructions: "short" }, { id: "x", type: "tool", tool: "get_my_notes" }],
    outputs: [{ type: "proposal", kind: "buy_stock" }],
    budget: { perRunUsd: 99 },
  });
  const by = Object.fromEntries(bad.errors.map((e) => [e.path, e.message]));
  assert.match(by.scope, /BAD TICKER/);
  assert.match(by["triggers[0]"], /minute field/);
  assert.match(by["triggers[1]"], /moon_landing/);
  assert.match(by["conditions[0]"], /Did you mean "quote.changePct"/);
  assert.match(by["steps[0]"], /tell the AI what to do/);
  assert.match(by["steps[1]"], /not a tool agents can use/, "private notes stay out of shared agents");
  assert.match(by["outputs[0]"], /proposal kind/);
  assert.match(by.budget, /at most \$2/);
  assert.throws(() => spec.validate({ triggers: [] }), spec.SpecError);
});

test("spec: cost estimate counts AI turns only and schedules per month", () => {
  const { spec: s } = spec.validate({ scope: { universe: "symbols", symbols: ["NVDA", "XOM"] }, triggers: [{ type: "schedule", preset: "premarket" }], steps: [{ id: "a1", type: "ai", tier: "mid", instructions: "Write a short note on the stock.", maxSteps: 4 }], outputs: [{ type: "feed" }] });
  const e = spec.estimateCost(s);
  assert.equal(e.free, false);
  assert.equal(e.symbols, 2);
  assert.ok(e.runsPerMonth >= 20 && e.runsPerMonth <= 23, `weekday schedule ~21/month, got ${e.runsPerMonth}`);
  assert.ok(e.perRunUsd > 0 && e.typicalRunUsd === e.perRunUsd / 2);
  assert.equal(spec.estimateCost({ ...s, steps: [] }).perRunUsd, 0);
});

// ---- Conditions ----

test("conditions: comparisons, step references and crossings against the last value", async () => {
  testValues.NVDA = 12;
  const scope = { symbol: "NVDA", steps: { d1: { data: { pe: 45 } } }, prevMetrics: { "test.value": 8 }, prev: { score: 3 }, event: { sigma: -2.5 } };
  assert.equal((await conditions.evaluate({ metric: "test.value", op: ">", value: 10 }, scope)).pass, true);
  assert.equal((await conditions.evaluate({ metric: "d1.pe", op: ">", value: 40 }, scope)).pass, true, "step data path without 'data.'");
  assert.equal((await conditions.evaluate({ metric: "$event.sigma", op: "<=", value: -2 }, scope)).pass, true);
  assert.equal((await conditions.evaluate({ metric: "test.value", op: "crosses_above", value: 10 }, scope)).pass, true, "8 -> 12 crosses 10");
  assert.equal((await conditions.evaluate({ metric: "test.value", op: "crosses_above", value: 5 }, scope)).pass, false, "was already above 5");
  assert.equal((await conditions.evaluate({ metric: "test.value", op: "pct_change_gt", value: 40 }, scope)).pass, true, "+50%");
  const first = await conditions.evaluate({ metric: "test.value", op: "changed" }, { ...scope, prevMetrics: {} });
  assert.equal(first.pass, false);
  assert.match(first.reason, /no earlier value/);
  testValues.XOM = null;
  const miss = await conditions.evaluate({ metric: "test.value", op: ">", value: 1 }, { symbol: "XOM" });
  assert.equal(miss.missing, true);
  assert.equal(conditions.compare("in", "watch", ["watch", "weakened"]), true);
});

test("metrics: registry lists ~50 metrics; price math on a known series", async () => {
  const list = registry.list();
  assert.ok(list.length >= 50, `${list.length} metrics`);
  assert.ok(list.find((m) => m.name === "price.moveSigma").backtestable);
  const L = stubLoaders();
  const sig = await registry.history("price.moveSigma", "NVDA", 30, { loaders: L });
  const crash = sig.find((p) => p.date === "2026-11-10");
  assert.ok(crash.value < -10, "an -8% day on a 0.4%-a-day stock is many sigma");
  const rsi = (await registry.value("price.rsi14", "NVDA", { loaders: L })).value;
  assert.ok(rsi > 0 && rsi < 100);
  const w = await registry.value("fund.weightPct", "NVDA", { loaders: registry.createLoaders({ allocation: async () => ({ positions: [{ symbol: "NVDA", weight: 12.5 }], checks: [], cashPct: 5 }) }) });
  assert.equal(w.value, 12.5);
  assert.match((await registry.value("nope.metric", "NVDA")).error, /Unknown metric/);
});

// ---- Rule-only agents ----

test("rule-only agent runs on its schedule once per slot, posts to the feed, costs nothing", async () => {
  testValues.NVDA = 30; testValues.XOM = 3;
  const a = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "schedule", preset: "daily" }], conditions: [{ metric: "test.value", op: ">", value: 10 }], outputs: [{ type: "feed" }, { type: "notify", who: "owner", tier: "inbox", when: "always" }] });
  triggers.reschedule(a.id);
  assert.ok(engine.getAgent(a.id).nextRunAt, "nextRunAt is set from the preset");
  db.prepare("UPDATE agents SET nextRunAt = '2026-01-01 00:00:00' WHERE id = ?").run(a.id);
  const r = triggers.scheduleTick(new Date());
  assert.equal(r.queued, 2, "one job per holding");
  await triggers.idle();
  const ran = db.prepare("SELECT * FROM agent_runs WHERE agentId = ?").all(a.id);
  assert.equal(ran.length, 1, "XOM failed its condition, so no run row");
  assert.equal(ran[0].symbol, "NVDA");
  assert.equal(ran[0].status, "done");
  assert.equal(ran[0].costUsd, 0);
  assert.equal(ran[0].trigger, "schedule");
  const items = feedFor(a.id);
  assert.equal(items.length, 1);
  assert.match(JSON.parse(items[0].body).summary, /test.value is 30/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE memberId = ? AND type = 'agentRun'").get(owner).n, 1);
  const log = db.prepare("SELECT outcome FROM agent_trigger_log WHERE agentId = ? ORDER BY symbol").all(a.id).map((x) => x.outcome);
  assert.deepEqual(log, ["ran", "skipped"]);
  assert.ok(engine.getAgent(a.id).nextRunAt > "2026-11-19", "moved to the next slot");
  assert.equal(triggers.scheduleTick(new Date()).queued, 0, "the same slot never runs twice");
});

test("rule-only agent on an event: matching filter runs once per event, others ignored", async () => {
  const a = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "event", on: "price_move", sigma: 2 }], outputs: [{ type: "feed" }] });
  await bus.emit("price_move", { symbol: "NVDA", sigma: -1.2, changePct: -1, date: "2026-11-19" }, { sync: true });
  await bus.emit("price_move", { symbol: "AAPL", sigma: -4, changePct: -6, date: "2026-11-19" }, { sync: true }); // not a holding
  await triggers.idle();
  assert.equal(feedFor(a.id).length, 0);
  await bus.emit("price_move", { symbol: "NVDA", sigma: -3.1, changePct: -6.2, date: "2026-11-19" }, { sync: true });
  await bus.emit("price_move", { symbol: "NVDA", sigma: -3.3, changePct: -6.5, date: "2026-11-19" }, { sync: true }); // same day: deduped
  await triggers.idle();
  const items = feedFor(a.id);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /NVDA moved -6.2%/);
  const run = db.prepare("SELECT trigger, output FROM agent_runs WHERE agentId = ?").get(a.id);
  assert.equal(run.trigger, "event");
  assert.equal(JSON.parse(run.output).ai, false);
});

test("changed conditions get a baseline even when they keep the agent from running", async () => {
  testValues.XOM = 5;
  const a = makeAgent({ scope: { universe: "symbols", symbols: ["XOM"] }, triggers: [{ type: "manual" }], conditions: [{ metric: "test.value", op: "changed" }], outputs: [{ type: "feed" }] });
  const first = await engine.runAgent(a.id, { symbol: "XOM" });
  assert.equal(first.skipped, true);
  const same = await engine.runAgent(a.id, { symbol: "XOM" });
  assert.equal(same.skipped, true);
  testValues.XOM = 6;
  const moved = await engine.runAgent(a.id, { symbol: "XOM" });
  assert.ok(moved.runId, "5 -> 6 counts as changed");
  assert.match(moved.output.conditions[0].reason, /was 5/);
});

// ---- AI agents ----

test("AI agent: tool step + AI verdict -> feed, thesis check, memory, proposal, follower notification", async () => {
  const a = makeAgent({
    scope: { universe: "holdings" }, triggers: [{ type: "manual" }],
    steps: [{ id: "d1", type: "tool", tool: "get_research_overview" }, { id: "a1", type: "ai", tier: "cheap", output: "verdict", maxSteps: 2, instructions: "Check the thesis against the latest data and give a verdict." }],
    outputs: [{ type: "feed" }, { type: "thesis_check" }, { type: "memory", scope: "symbol", kind: "observation" }, { type: "proposal", kind: "thesis_status", when: "verdict_not:intact" }, { type: "notify", who: "followers", tier: "inbox", when: "verdict_not:intact" }],
  });
  db.prepare("INSERT INTO agent_follows (agentId, memberId) VALUES (?, ?)").run(a.id, other);
  replies.push(msg({ summary: "Margins fell two quarters running.", claims: [{ text: "Gross margin fell", source_url: "#/research/NVDA" }], verdict: "weakened", reason: "The margin pillar is not holding." }));
  const r = await engine.runAgent(a.id, { symbol: "NVDA", triggeredBy: owner });
  assert.equal(r.output.verdict, "weakened");
  assert.equal(r.output.claims[0].sourced, true, "cited the tool step's source");
  assert.ok(r.costUsd > 0);
  const prompt = requests[0].input[1].content;
  assert.match(prompt, /<untrusted_tool_data tool="get_research_overview" step="d1"/);
  assert.match(prompt, /Check the thesis/);
  assert.match(requests[0].input[0].content, /No buy or sell instructions/);
  const outs = Object.fromEntries(r.output.outputs.map((o) => [o.type, o]));
  assert.ok(outs.feed.id && outs.thesis_check.id && outs.memory.id && outs.proposal.id);
  assert.equal(db.prepare("SELECT importance, kind FROM feed_items WHERE id = ?").get(outs.feed.id).kind, "agent_alert");
  assert.equal(db.prepare("SELECT status FROM thesis_checks WHERE id = ?").get(outs.thesis_check.id).status, "weakened");
  assert.equal(db.prepare("SELECT kind, scopeKey FROM agent_memory WHERE id = ?").get(outs.memory.id).scopeKey, "NVDA");
  const p = db.prepare("SELECT kind, payload FROM agent_proposals WHERE id = ?").get(outs.proposal.id);
  assert.equal(p.kind, "thesis_status");
  assert.equal(JSON.parse(p.payload).status, "weakened");
  assert.equal(outs.notify.sent, 2, "owner and follower");
  assert.equal(db.prepare("SELECT memberId FROM agent_runs WHERE id = ?").get(r.runId).memberId, owner, "billed to the member who ran it");

  // Second run: same verdict, so "changed" outputs stay quiet; memory from the first run is recalled.
  replies.push(msg({ summary: "Still weak.", claims: [], verdict: "weakened", reason: "Same." }));
  const a2 = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "manual" }], steps: [{ id: "a1", type: "ai", instructions: "Check again and give a verdict.", output: "verdict", maxSteps: 1 }], outputs: [{ type: "feed", when: "changed" }] });
  await engine.runAgent(a2.id, { symbol: "NVDA" });
  assert.match(requests[1].input[1].content, /<memory[\s\S]*Margins fell two quarters running/);
  replies.push(msg({ summary: "Still weak.", claims: [], verdict: "weakened", reason: "Same." }));
  const again = await engine.runAgent(a2.id, { symbol: "NVDA" });
  assert.deepEqual(again.output.outputs.map((o) => o.skipped), ["when changed"]);
});

test("budget: an agent stops at its per-run cap and is refused once its month is spent", async () => {
  const a = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "manual" }], steps: [{ id: "a1", type: "ai", instructions: "Look around with tools and report.", tools: ["get_research_overview"], maxSteps: 4, output: "brief" }], outputs: [], budget: { perRunUsd: 0.0001, perMonthUsd: 0.001 } });
  const big = { input_tokens: 4000, output_tokens: 400 };
  replies.push({ model: "gpt-6-luna", status: "completed", usage: big, output: [{ type: "function_call", call_id: "c1", name: "get_research_overview", arguments: JSON.stringify({ symbol: "NVDA" }) }] });
  await assert.rejects(engine.runAgent(a.id, { symbol: "NVDA" }), /per-run budget/);
  const row = db.prepare("SELECT status FROM agent_runs WHERE agentId = ?").get(a.id);
  assert.equal(row.status, "refused");
  db.prepare("UPDATE agent_runs SET costUsd = 0.01 WHERE agentId = ?").run(a.id);
  const r = await engine.runAgent(a.id, { symbol: "NVDA" });
  assert.equal(r.skipped, true);
  assert.equal(r.code, "agent_month_cap");
  assert.equal(engine.getAgent(a.id).status, "active", "running out of budget doesn't pause the agent");
});

test("auto-pause after 3 failed runs in a row, with a feed item; suspended and paused agents don't run", async () => {
  const a = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "manual" }, { type: "event", on: "tripwire" }], steps: [{ id: "a1", type: "ai", instructions: "Say something useful about it.", maxSteps: 1 }], outputs: [] });
  for (let i = 0; i < 3; i++) await assert.rejects(engine.runAgent(a.id, { symbol: "NVDA" })); // OpenAI 500s
  assert.equal(engine.getAgent(a.id).status, "paused");
  assert.match(feedFor(a.id).at(-1).title, /paused after 3 failed runs/);
  await assert.rejects(engine.runAgent(a.id, { symbol: "NVDA", trigger: "event" }), /paused/);
  db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").run(a.id);
  await assert.rejects(engine.runAgent(a.id, { symbol: "NVDA" }), /suspended/);
});

test("max runs per day", async () => {
  const a = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "manual" }], outputs: [], maxRunsPerDay: 2 });
  assert.ok((await engine.runAgent(a.id, { symbol: "NVDA" })).runId);
  assert.ok((await engine.runAgent(a.id, { symbol: "NVDA" })).runId);
  const third = await engine.runAgent(a.id, { symbol: "NVDA" });
  assert.match(third.reason, /2 runs today/);
});

// ---- Agents talking to each other ----

test("handoffs and agent_output chains: topic subscribers run, never the sender, and depth stops at 3", async () => {
  const a = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "manual" }, { type: "handoff", topic: "loop" }], outputs: [{ type: "handoff", topic: "loop" }] }, { name: "Ping" });
  const b = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "handoff", topic: "loop" }], outputs: [{ type: "handoff", topic: "loop" }] }, { name: "Pong" });
  await engine.runAgent(a.id, { symbol: "NVDA" });
  for (let i = 0; i < 10; i++) { await new Promise((r) => setImmediate(r)); await triggers.idle(); }
  const runsA = db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE agentId = ?").get(a.id).n;
  const runsB = db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE agentId = ?").get(b.id).n;
  assert.ok(runsB >= 1, "Pong picked up Ping's handoff");
  assert.ok(runsA + runsB <= 4, `the ping-pong stops (A ${runsA}, B ${runsB})`);
  const msgs = db.prepare("SELECT payload FROM agent_messages WHERE fromAgentId IN (?, ?)").all(a.id, b.id).map((m) => JSON.parse(m.payload).depth);
  assert.ok(Math.max(...msgs) <= 3);
  const child = db.prepare("SELECT parentRunId FROM agent_runs WHERE agentId = ? ORDER BY id LIMIT 1").get(b.id);
  assert.ok(child.parentRunId, "the handoff run links to the run that caused it");

  const watcher = makeAgent({ scope: { universe: "holdings" }, triggers: [{ type: "event", on: "agent_output", agent: a.slug }], outputs: [] });
  assert.equal(triggers.matches({ type: "event", on: "agent_output", agent: a.slug }, "agent_output", { slug: a.slug }), true);
  const q = triggers.onEvent("agent_output", { runId: 999999, agentId: watcher.id, slug: a.slug, symbol: "NVDA", output: { depth: 0 } });
  assert.equal(q.queued, 0, "an agent never triggers itself");
});

test("event filters", () => {
  assert.equal(triggers.matches({ type: "event", on: "filing", forms: ["8-K"], items: ["2.02"] }, "filing", { form: "8-K", items: "2.02, 9.01" }), true);
  assert.equal(triggers.matches({ type: "event", on: "filing", forms: ["8-K"], items: ["2.02"] }, "filing", { form: "8-K", items: "5.02" }), false);
  assert.equal(triggers.matches({ type: "event", on: "earnings_soon", days: 3 }, "earnings_soon", { days: 5 }), false);
  assert.equal(triggers.matches({ type: "event", on: "pitch_status", status: ["voting"] }, "pitch_status", { status: "voting" }), true);
  assert.equal(triggers.eventKey("filing", { accession: "0001" }), "filing:0001");
});

// ---- Dry run ----

test("dry run replays a price-move trigger and conditions over stored closes without a model", async () => {
  const { spec: s } = spec.validate({ scope: { universe: "symbols", symbols: ["NVDA"] }, triggers: [{ type: "event", on: "price_move", sigma: 3 }, { type: "event", on: "news_high" }], conditions: [{ metric: "price.change1dPct", op: "<", value: 0 }], outputs: [{ type: "feed" }] });
  const before = requests.length;
  const r = await dryRun(s, { days: 30, now: new Date("2026-11-19T20:00:00Z"), loaders: stubLoaders() });
  assert.deepEqual(r.fires.map((f) => f.date), ["2026-11-10"], "the -8% day fires; the +5% day fails the condition");
  assert.match(r.fires[0].reason, /-8.0%/);
  assert.ok(r.skipped.some((x) => x.trigger === "news_high"));
  assert.equal(requests.length, before, "no model calls");
  const sched = spec.validate({ scope: { universe: "symbols", symbols: ["NVDA"] }, triggers: [{ type: "schedule", preset: "weekly_mon" }], outputs: [] }).spec;
  const w = await dryRun(sched, { days: 30, now: new Date("2026-11-19T20:00:00Z"), loaders: stubLoaders() });
  assert.ok(w.fires.length >= 4 && w.fires.length <= 5, `${w.fires.length} Mondays`);
});

// ---- API ----

test("API: templates, validate, create, run, version, fork, follow, permissions", async () => {
  global.fetch = realFetch;
  const { startServer } = require("./helpers");
  const s = await startServer();
  try {
    const t = await s.api("/api/platform/agents/templates", { auth: true });
    assert.equal(t.status, 200);
    assert.equal(t.body.templates.length, 12);
    const rule = t.body.templates.find((x) => x.slug === "stale-thesis-reminder");
    assert.equal(rule.aiFree, true);

    const v = await s.api("/api/platform/agents/validate", { method: "POST", auth: true, body: { spec: { triggers: [{ type: "nope" }] } } });
    assert.equal(v.body.errors[0].path, "triggers[0]");
    const bad = await s.api("/api/platform/agents", { method: "POST", auth: true, body: { name: "Bad", spec: { triggers: [] } } });
    assert.equal(bad.status, 400);
    assert.ok(Array.isArray(bad.body.errors));

    const c = await s.api("/api/platform/agents", { method: "POST", auth: true, body: { name: "Stale theses", spec: { ...rule.spec, triggers: [{ type: "manual" }, ...rule.spec.triggers] } } });
    assert.equal(c.status, 201, c.text);
    const agent = c.body.agent;
    assert.equal(agent.slug, "stale-theses");
    assert.equal(agent.following, true, "the owner follows their own agent");
    assert.ok(agent.nextRunAt, "scheduled");
    const est = await s.api("/api/platform/agents/estimate", { method: "POST", auth: true, body: { spec: rule.spec } });
    assert.equal(est.body.free, true);

    const list = await s.api("/api/platform/agents", { auth: true });
    assert.ok(list.body.agents.some((a) => a.slug === "stale-theses" && a.ownerName === "Test Admin"));
    assert.ok(list.body.agents.some((a) => a.kind === "builtin"));

    const run = await s.api(`/api/platform/agents/${agent.id}/run`, { method: "POST", auth: true, body: {} });
    assert.equal(run.status, 200, run.text);
    assert.ok(run.body.runId || run.body.skipped);

    const up = await s.api(`/api/platform/agents/${agent.id}`, { method: "PUT", auth: true, body: { spec: { ...agent.spec, conditions: [{ metric: "thesis.daysSinceUpdate", op: ">=", value: 120 }] }, note: "120 days" } });
    assert.equal(up.body.agent.version, 2);
    const vers = await s.api(`/api/platform/agents/${agent.id}/versions`, { auth: true });
    assert.deepEqual(vers.body.versions.map((x) => x.version), [2, 1]);
    const restored = await s.api(`/api/platform/agents/${agent.id}/restore`, { method: "POST", auth: true, body: { version: 1 } });
    assert.equal(restored.body.agent.version, 3);
    assert.equal(restored.body.agent.spec.conditions[0].value, 90);

    const m = await s.createMember("Mia");
    const noAi = await s.api(`/api/platform/agents/${agent.id}/fork`, { method: "POST", member: m.cookie, body: {} });
    assert.equal(noAi.status, 403, "creating agents needs AI access");
    const f = await s.api(`/api/platform/agents/${agent.id}/follow`, { method: "POST", member: m.cookie, body: {} });
    assert.equal(f.body.following, true);
    const edit = await s.api(`/api/platform/agents/${agent.id}`, { method: "PUT", member: m.cookie, body: { name: "Mine now" } });
    assert.equal(edit.status, 403);

    const fork = await s.api(`/api/platform/agents/${agent.id}/fork`, { method: "POST", auth: true, body: {} });
    assert.equal(fork.status, 201);
    assert.equal(fork.body.agent.status, "paused");
    assert.equal(fork.body.agent.visibility, "private");
    const pause = await s.api(`/api/platform/agents/${agent.id}/pause`, { method: "POST", auth: true });
    assert.equal(pause.body.agent.status, "paused");
    assert.equal(pause.body.agent.nextRunAt, null);
    const dry = await s.api(`/api/platform/agents/${agent.id}/dry-run`, { method: "POST", auth: true, body: { days: 30 } });
    assert.equal(dry.status, 200);
    assert.ok(Array.isArray(dry.body.fires));
    const metrics = await s.api("/api/metrics", { auth: true });
    assert.ok(metrics.body.metrics.length >= 50);
    const one = await s.api(`/api/platform/agents/stale-theses`, { auth: true });
    assert.equal(one.body.agent.id, agent.id);
    assert.ok(Array.isArray(one.body.runs));
  } finally { await s.stop(); }
});
