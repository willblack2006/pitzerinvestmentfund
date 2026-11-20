// Cost and routing for the agent system: cache-aware pricing, the Ask PIF planner (cheap tier,
// narrowed tools, escalation), stale tool-output shrinking and the eval scoring.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-cost-")), "cost.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const openai = require("../lib/sources/openai");
const runs = require("../lib/agents/runs");
const tools = require("../lib/agents/tools");
const askPlan = require("../lib/agents/askPlan");
const { score, summarize } = require("../lib/agents/evalScore");
const { ask, ASK_TOOLS } = require("../lib/agents/workflows/ask");
const { setSettings } = require("../lib/settings");

const realFetch = global.fetch;
let replies = [], requests = [];
function mock(appData = {}) {
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) { requests.push(JSON.parse(opts.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); }
    const hit = Object.entries(appData).find(([k]) => u === `http://app.test/api${k}`);
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response(JSON.stringify({ error: "nope" }), { status: 404 });
  };
}
const msg = (text, model = "gpt-6-luna", usage = { input_tokens: 1000, output_tokens: 100 }) => ({ model, status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const call = (name, args, model = "gpt-6-luna", id = "c1") => ({ model, status: "completed", usage: { input_tokens: 500, output_tokens: 50 }, output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] });
const HOLD = { "/positions": [{ symbol: "NVDA", shares: 100, marketValue: 18000 }] };
const answer = (a) => JSON.stringify({ answer: a, claims: [{ text: "x", source_url: "#/holdings", quote: "" }], followUps: [] });

test.beforeEach(() => { replies = []; requests = []; mock(); db.exec("DELETE FROM agent_runs;"); setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5 }); });
test.afterEach(() => { global.fetch = realFetch; });

test("cost: cached input tokens are billed at the cached rate", () => {
  const full = openai.costOf("gpt-6.1-sol", { input: 100000, output: 1000 });
  assert.equal(full, (100000 * 2 + 1000 * 10) / 1e6);
  const hit = openai.costOf("gpt-6.1-sol", { input: 100000, cached: 90000, output: 1000 });
  assert.ok(Math.abs(hit - (10000 * 2 + 90000 * 0.2 + 1000 * 10) / 1e6) < 1e-12);
  process.env.CACHED_INPUT_RATIO = "0.5";
  assert.ok(openai.costOf("gpt-6.1-sol", { input: 100000, cached: 100000, output: 0 }) > hit);
  delete process.env.CACHED_INPUT_RATIO;
});

test("planner: eval questions route as expected and narrow the tool list", () => {
  const all = ASK_TOOLS();
  const qs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "eval", "ask-questions.json"), "utf8"));
  for (const q of qs) {
    const p = askPlan.plan(q.question, all);
    assert.equal(p.tier, q.expectTier, `${q.id}: tier`);
    for (const alts of q.expectTools) assert.ok(alts.some((t) => p.tools.includes(t)), `${q.id}: ${alts.join("|")} available`);
  }
  assert.ok(askPlan.plan("What is NVDA's price?", all).tools.length < 15);
  assert.equal(askPlan.plan("Tell me something interesting", all).tools.length, all.length, "no signal: everything");
  assert.ok(askPlan.plan("What is NVDA's price?", all).tools.every((t) => all.includes(t)));
});

test("Ask PIF: a simple question runs on the cheap tier with a short tool list and a cache key", async () => {
  mock(HOLD);
  replies.push(call("get_holdings", {}), msg(answer("NVDA is the biggest holding at 18000.")));
  const r = await runs.run({ workflow: "ask_pif" }, (ctx) => ask({ question: "What is our biggest holding?" }, ctx));
  assert.equal(r.output.plan.tier, "cheap");
  assert.equal(r.output.plan.escalated, false);
  assert.equal(requests[0].model, "gpt-6-luna");
  assert.ok(requests[0].tools.length < ASK_TOOLS().length, "narrowed tool list");
  assert.equal(requests[0].prompt_cache_key, "ask_pif");
});

test("Ask PIF: the cheap model's unbacked numbers escalate to the mid model with every tool", async () => {
  mock(HOLD);
  const bad = answer("NVDA is up 77% this year.");
  replies.push(call("get_holdings", {}), msg(bad), msg(bad), // cheap: answer, revision still wrong
    call("get_holdings", {}, "gpt-6.1-sol"), msg(answer("NVDA is the biggest holding at 18000."), "gpt-6.1-sol"));
  const r = await runs.run({ workflow: "ask_pif" }, (ctx) => ask({ question: "What is our biggest holding?" }, ctx));
  assert.equal(r.output.plan.escalated, true);
  assert.equal(requests.at(-1).model, "gpt-6.1-sol");
  assert.equal(requests.at(-1).tools.filter((t) => t.type === "function").length, ASK_TOOLS().filter((n) => !tools.TOOLS[n].builtin && n !== "ask_agent" && n !== "list_agents").length, "every tool (asking other agents only when the question mentions agents)");
  assert.match(r.output.answer, /18000/);
  assert.equal(r.output.toolsUsed.length, 1, "the repeated tool call was answered from memory");
});

test("Ask PIF: a cheap-tier error escalates, a mid-tier error does not", async () => {
  replies.push(msg("not json"), msg(answer("Nothing to add."), "gpt-6.1-sol"));
  const r = await runs.run({ workflow: "ask_pif" }, (ctx) => ask({ question: "What is our biggest holding?" }, ctx));
  assert.equal(r.output.plan.escalated, true);
});

test("agent loop: big tool results from two steps back are shortened once, the latest stay whole", async () => {
  const pad = "x".repeat(200);
  const big = { rows: Array.from({ length: 30 }, (_, i) => ({ i, label: `row ${i} ${pad}` })) };
  mock({ "/positions": big, "/portfolio/allocation": big, "/portfolio/performance": big });
  replies.push(call("get_holdings", {}, "gpt-6.1-sol", "a"), call("get_allocation", {}, "gpt-6.1-sol", "b"),
    call("get_performance", {}, "gpt-6.1-sol", "c"), msg(answer("done"), "gpt-6.1-sol"));
  await runs.run({ workflow: "ask_pif" }, (ctx) => ctx.agent({ tier: "mid", system: "s", user: "u", tools: ["get_holdings", "get_allocation", "get_performance"], maxSteps: 6 }));
  const outputs = (req) => req.input.filter((x) => x.type === "function_call_output").map((x) => x.output);
  const last = outputs(requests.at(-1));
  assert.equal(last.length, 3);
  assert.match(last[0], /earlier result shortened/);
  assert.match(last[1], /earlier result shortened/);
  assert.ok(last[0].length < 3000);
  assert.doesNotMatch(last[2], /earlier result shortened/);
  assert.match(outputs(requests[2])[0], /earlier result shortened/);
  assert.doesNotMatch(outputs(requests[2])[1], /earlier result shortened/, "one step old is still whole");
});

test("run: cached tokens are recorded in the step log and cost less", async () => {
  const cached = { model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 100000, output_tokens: 100, input_tokens_details: { cached_tokens: 90000 } }, output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] };
  replies.push(cached);
  const r = await runs.run({ workflow: "x" }, (ctx) => ctx.ai({ system: "s", user: "u" }));
  assert.ok(r.costUsd < (100000 * 2 + 100 * 10) / 1e6 / 2);
  assert.equal(runs.getRun(r.runId).steps[0].cached, 90000);
});

test("eval scoring: checks tools, text, sourcing, numbers and the tier", () => {
  const q = { id: "t", expectTier: "cheap", expectTools: [["get_holdings", "get_allocation"]], mustMatch: ["%"] };
  const good = { answer: "NVDA is 30%.", claims: [{ sourced: true }], unbackedNumbers: [], toolsUsed: [{ name: "get_allocation", ok: true }], plan: { tier: "cheap", escalated: false, toolCount: 20 } };
  const s = score(q, good, { costUsd: 0.01, steps: [{ kind: "model" }, { kind: "model" }], usage: { input: 1000, cached: 500, output: 50 } });
  assert.equal(s.pass, true);
  assert.equal(s.cacheHit, 0.5);
  const bad = score(q, { ...good, answer: "unknown", toolsUsed: [], unbackedNumbers: ["3x"] });
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.missingTools, ["get_holdings|get_allocation"]);
  assert.equal(bad.checks.numbers, false);
  assert.equal(score(q, null, { error: "boom" }).pass, false);
  const sum = summarize([s, bad]);
  assert.equal(sum.passed, 1);
  assert.equal(sum.questions, 2);
});
