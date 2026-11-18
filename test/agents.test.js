// Research agents foundation: verification, routing rules, spending caps, run recording and the
// agent tool loop (OpenAI is mocked; nothing here calls a real model or SEC).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-agents-")), "agents.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const verify = require("../lib/agents/verify");
const router = require("../lib/agents/router");
const budget = require("../lib/agents/budget");
const runs = require("../lib/agents/runs");
const agents = require("../lib/agents");
const tools = require("../lib/agents/tools");
const openai = require("../lib/sources/openai");
const { setSettings } = require("../lib/settings");
const { startServer } = require("./helpers");

// ---- Mocked OpenAI Responses API ----
const realFetch = global.fetch;
let replies = [];        // queue of response bodies
let requests = [];       // bodies sent
function mockOpenAI() {
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.openai.com/")) {
      requests.push(JSON.parse(opts.body));
      const body = replies.shift();
      if (!body) throw new Error("no mocked reply left");
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
}
const msg = (text, usage = { input_tokens: 1000, output_tokens: 100 }, model = "gpt-6.1-sol") =>
  ({ model, status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const call = (name, args, id = "c1", usage = { input_tokens: 500, output_tokens: 50 }) =>
  ({ model: "gpt-6.1-sol", status: "completed", usage, output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] });

test.beforeEach(() => { replies = []; requests = []; mockOpenAI(); db.exec("DELETE FROM agent_runs; DELETE FROM agent_events;"); setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 0.5 }); });
test.afterEach(() => { global.fetch = realFetch; });

// ---- verify ----

test("verify: quotes match verbatim after normalizing whitespace, quotes and dashes", () => {
  const source = "Revenue for the quarter was $4.2 billion, up 12% year over year.\n\nThe Company’s backlog — excluding one-time items — grew.";
  const [a, b, c, d] = verify.verifyQuotes([
    { quote: "revenue for the quarter was $4.2 billion, up 12%", source: "f1" },
    { quote: "The Company's backlog - excluding one-time items - grew." },
    { quote: "Revenue fell sharply in the quarter" },
    { quote: "revenue" },
  ], { f1: source });
  assert.equal(a.verified, true); assert.equal(a.foundIn, "f1");
  assert.equal(b.verified, true, "curly apostrophe and em dashes normalize");
  assert.equal(c.verified, false, "invented quote is rejected");
  assert.equal(d.verified, false, "too short to prove anything");
  assert.equal(verify.verifyQuotes([{ quote: "Revenue for the quarter … up 12% year over year" }], { f1: source })[0].verified, true, "ellipsis-joined fragments each match");
});

test("verify: numbers in prose must match a tool result or the source text", () => {
  const toolResults = [{ revenue: 4213000000, grossMargin: 0.6431, eps: "1.27" }];
  const text = "Revenue was $4.2 billion with a 64.3% gross margin and EPS of $1.27. Item 2.02 was filed in 2026. Debt rose to $9.8 billion.";
  assert.deepEqual(verify.unbackedNumbers(text, toolResults), ["$9.8 billion"]);
  assert.deepEqual(verify.unbackedNumbers("Debt rose to $9.8 billion.", [], ["total debt of $9,812 million"]), []);
});

// ---- router ----

test("router: 8-K items map to tiers and workflows", () => {
  assert.deepEqual(router.classify({ type: "8-K", items: "2.02,9.01" }).workflow, "earnings_flash");
  assert.equal(router.classify({ type: "8-K", items: "1.03" }).tier, "push");
  assert.equal(router.classify({ type: "8-K", items: "5.02,9.01" }).tier, "inbox");
  assert.equal(router.classify({ type: "8-K", items: "5.02,9.01" }).workflow, "filing_flash");
  assert.equal(router.classify({ type: "8-K", items: "1.01,2.03,5.02" }).tier, "push", "three substantive items bump to push");
  const reg = router.classify({ type: "8-K", items: "7.01,9.01" });
  assert.equal(reg.tier, "digest"); assert.equal(reg.workflow, null);
  assert.equal(router.classify({ type: "8-K", items: "9.01" }).workflow, null);
  assert.equal(router.classify({ type: "10-Q" }).workflow, "filing_flash");
  assert.equal(router.classify({ type: "10-K/A" }).workflow, null);
  assert.equal(router.classify({ type: "SOMETHING" }).tier, "digest");
});

// ---- budget ----

test("budget: monthly cap counts every logged call and refuses once reached", () => {
  budget.logAppCall({ feature: "filing_brief", model: "gpt-6-luna", usage: { input: 1, output: 1 }, costUsd: 24.99 });
  assert.doesNotThrow(() => budget.check());
  budget.logAppCall({ feature: "news_triage", model: "gpt-6-luna", usage: { input: 1, output: 1 }, costUsd: 0.02 });
  assert.throws(() => budget.check(), (e) => e instanceof budget.BudgetError && e.code === "ai_month_cap");
  setSettings({ aiMonthlyCapUsd: 50 });
  assert.doesNotThrow(() => budget.check());
  assert.equal(budget.status().monthSpentUsd, 25.01);
});

test("budget: per-member daily cap", () => {
  const m = db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Cap Tester', 'Analyst', '')").run().lastInsertRowid;
  db.prepare("INSERT INTO agent_runs (workflow, memberId, status, costUsd) VALUES ('ask_pif', ?, 'done', 0.5)").run(m);
  assert.throws(() => budget.check({ memberId: Number(m) }), (e) => e.code === "ai_member_cap");
  assert.doesNotThrow(() => budget.check(), "fund-wide runs aren't limited by one member's cap");
});

test("budget: the app's existing AI features are logged and blocked through the OpenAI hooks", async () => {
  budget.install();
  replies.push(msg('{"ratings":[{"materiality":3,"direction":"neutral","reason":"x"}]}', { input_tokens: 2000, output_tokens: 200 }, "gpt-6-luna"));
  await openai.triageHeadlines("NVDA", ["Headline"]);
  const row = db.prepare("SELECT * FROM agent_runs WHERE workflow = 'news_triage'").get();
  assert.ok(row, "the call is logged");
  assert.ok(Math.abs(row.costUsd - (2000 * 0.10 + 200 * 0.50) / 1e6) < 1e-12);
  setSettings({ aiMonthlyCapUsd: 0 });
  await assert.rejects(openai.triageHeadlines("NVDA", ["Headline"]), (e) => e.code === "ai_month_cap");
  assert.equal(requests.length, 1, "a refused call never reaches OpenAI");
});

// ---- runs and the agent loop ----

test("runs: a run records model usage, cost, steps and output", async () => {
  replies.push(msg('{"answer":"ok"}'));
  const r = await runs.run({ workflow: "test_wf", symbol: "NVDA" }, async (ctx) => {
    const { json } = await ctx.ai({ system: "s", user: "u", schema: { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } } });
    return json;
  });
  const row = runs.getRun(r.runId);
  assert.equal(row.status, "done");
  assert.deepEqual(row.output, { answer: "ok" });
  assert.equal(row.inputTokens, 1000);
  assert.ok(Math.abs(row.costUsd - (1000 * 2 + 100 * 10) / 1e6) < 1e-12);
  assert.equal(row.steps[0].kind, "model");
  assert.equal(requests[0].model, "gpt-6.1-sol", "mid tier by default");
});

test("runs: a run is refused up front when the cap is reached, and recorded as refused", async () => {
  setSettings({ aiMonthlyCapUsd: 0 });
  await assert.rejects(runs.run({ workflow: "test_wf" }, async () => "never"), (e) => e instanceof budget.BudgetError);
  assert.equal(db.prepare("SELECT status FROM agent_runs ORDER BY id DESC").get().status, "refused");
  assert.equal(requests.length, 0);
});

test("runs: the agent loop calls tools, wraps their output as untrusted data and returns the answer", async () => {
  tools.TOOLS.fake_tool = {
    name: "fake_tool", description: "test", parameters: { type: "object", additionalProperties: false, required: ["symbol"], properties: { symbol: { type: "string" } } },
    run: async ({ symbol }) => ({ data: { symbol, revenue: 4213000000 }, source_url: "#/research/NVDA", as_of: "2026-11-17", cached: null }),
  };
  replies.push(call("fake_tool", { symbol: "NVDA" }), msg("Revenue was $4.2 billion."));
  const r = await runs.run({ workflow: "test_agent" }, async (ctx) => {
    const out = await ctx.agent({ system: "s", user: "u", tools: ["fake_tool"] });
    return { text: out.text, unbacked: verify.unbackedNumbers(out.text, ctx.toolResults) };
  });
  assert.deepEqual(r.output, { text: "Revenue was $4.2 billion.", unbacked: [] });
  const second = requests[1].input;
  const outItem = second.find((i) => i.type === "function_call_output");
  assert.match(outItem.output, /^<untrusted_tool_data tool="fake_tool">/);
  assert.equal(requests[0].tools[0].name, "fake_tool");
  const row = runs.getRun(r.runId);
  assert.deepEqual(row.steps.map((s) => s.kind), ["model", "tool", "model"]);
  delete tools.TOOLS.fake_tool;
});

test("runs: an unpriced model fails the run instead of escaping the cap", async () => {
  replies.push(msg("hi", undefined, "mystery-model"));
  await assert.rejects(runs.run({ workflow: "test_wf" }, (ctx) => ctx.ai({ system: "s", user: "u" })), /No price on file/);
  assert.equal(db.prepare("SELECT status FROM agent_runs ORDER BY id DESC").get().status, "failed");
});

// ---- intake, routing, dispatch ----

test("dispatch: events are deduped, routed, and only registered workflows run", async () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(agents.recordEvent({ dedupeKey: "filing:A", symbol: "NVDA", type: "8-K", items: "2.02,9.01", asOf: today }));
  assert.equal(agents.recordEvent({ dedupeKey: "filing:A", symbol: "NVDA", type: "8-K", items: "2.02,9.01", asOf: today }), null, "deduped");
  agents.recordEvent({ dedupeKey: "filing:B", symbol: "NVDA", type: "8-K", items: "7.01", asOf: today });
  agents.recordEvent({ dedupeKey: "filing:C", symbol: "MU", type: "10-Q", asOf: "2020-01-01" });
  assert.equal(agents.routeNew(), 3);
  const ev = Object.fromEntries(db.prepare("SELECT dedupeKey, status, workflow FROM agent_events").all().map((r) => [r.dedupeKey, r]));
  assert.equal(ev["filing:A"].workflow, "earnings_flash");
  assert.equal(ev["filing:B"].status, "done", "digest-only events need no run");

  const seen = [];
  agents.register("earnings_flash", async (event) => { seen.push(event.symbol); return { ok: true }; });
  const d = await agents.dispatch();
  assert.deepEqual(d, { ran: 1, failed: 0 });
  assert.deepEqual(seen, ["NVDA"]);
  const after = Object.fromEntries(db.prepare("SELECT dedupeKey, status FROM agent_events").all().map((r) => [r.dedupeKey, r.status]));
  assert.equal(after["filing:A"], "done");
  assert.equal(after["filing:C"], "skipped", "stale events are not run late");
  delete agents.workflows.earnings_flash;
});

// ---- API ----

test("API: agents overview is members-only and reports budget, events and runs; admins set the caps", async () => {
  global.fetch = realFetch;
  const s = await startServer();
  try {
    assert.equal((await s.api("/api/agents/overview")).status, 401);
    const o = await s.api("/api/agents/overview", { auth: true });
    assert.equal(o.status, 200);
    assert.equal(o.body.budget.monthlyCapUsd, 25);
    assert.ok(Array.isArray(o.body.events) && Array.isArray(o.body.runs));
    const put = await s.api("/api/settings", { method: "PUT", auth: true, body: { aiMonthlyCapUsd: 60 } });
    assert.equal(put.status, 200);
    assert.equal(put.body.aiMonthlyCapUsd, 60);
    assert.equal((await s.api("/api/settings", { method: "PUT", auth: true, body: { aiMonthlyCapUsd: -5 } })).status, 400);
    const m = await s.createMember("Analyst");
    assert.equal((await s.api("/api/settings", { method: "PUT", member: m.cookie, body: { aiMonthlyCapUsd: 1000 } })).status, 403);
    assert.equal((await s.api("/api/agents/runs/999", { auth: true })).status, 404);
    // AI access is off for new members until an admin turns it on; admins always have it.
    assert.equal((await s.api("/api/agents/overview", { member: m.cookie })).status, 403);
    assert.equal((await s.api("/api/news-triage/run", { method: "POST", member: m.cookie })).status, 403);
    assert.equal((await s.api("/api/research/NVDA/filings/x/summary", { method: "POST", member: m.cookie })).status, 403);
    const session = await s.api("/api/auth/session", { member: m.cookie });
    assert.equal(session.body.member.canUseAi, false);
    const grant = await s.api(`/api/members/${m.id}`, { method: "PUT", auth: true, body: { canUseAi: true } });
    assert.equal(grant.status, 200);
    assert.equal(grant.body.aiGranted, true);
    assert.equal((await s.api("/api/agents/overview", { member: m.cookie })).status, 200);
    assert.equal((await s.api("/api/auth/session", { member: m.cookie })).body.member.canUseAi, true);
    assert.equal((await s.api(`/api/members/${m.id}`, { method: "PUT", member: m.cookie, body: { canUseAi: true } })).status, 403, "members can't grant themselves access");
  } finally { await s.stop(); }
});
