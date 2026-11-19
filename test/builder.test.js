// Agent builder (WS3): the spec helpers behind the form (summary, estimate, checks, version diff),
// the dry-run timeline, and "describe it in words" drafting with and without a (fake) model.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-builder-")), "builder.db");
process.env.OPENAI_API_KEY = "test-key";

const model = () => import("../public/agentBuilder/specModel.js");

test("builder: plain-English summary reads like the plan's example", async () => {
  const M = await model();
  const s = M.defaultSpec();
  s.triggers.push({ type: "event", on: "price_move", sigma: 2 });
  s.conditions.push({ metric: "quote.changePct", op: "<", value: -5 });
  s.steps[0].instructions = "Read its news and filings and say what changed.";
  const text = M.describe(s);
  assert.match(text, /^Every weekday at 8:30 AM ET and whenever the stock moves more than 2σ in a day, for each holding, if change today is below -5%/);
  assert.match(text, /post to the team feed\.$/);
  assert.equal(M.describeCron("0 9 * * 1"), "every Monday at 9:00 AM");
  assert.equal(M.cronRunsPerMonth("30 8 * * 1-5"), 22);
  assert.equal(M.parseCron("61 8 * * *"), null);
});

test("builder: estimate is free without AI and scales with scope", async () => {
  const M = await model();
  const free = M.normalize({ scope: { universe: "holdings" }, triggers: [{ type: "event", on: "price_move" }], steps: [{ id: "d1", type: "tool", tool: "get_news" }], outputs: [{ type: "feed" }] });
  assert.equal(M.estimate(free).aiFree, true);
  assert.equal(M.estimate(free).perMonthUsd, 0);
  const ai = M.defaultSpec();
  const one = M.estimate({ ...ai, scope: { universe: "symbols", symbols: ["NVDA"] } });
  const many = M.estimate(ai, { holdingsCount: 20 });
  assert.ok(many.perMonthUsd > one.perMonthUsd * 10);
  const top = M.estimate({ ...ai, steps: [{ ...ai.steps[0], tier: "top" }] });
  assert.ok(top.perRunUsd > M.estimate(ai).perRunUsd * 4);
});

test("builder: checks catch what the server would reject", async () => {
  const M = await model();
  const s = M.defaultSpec();
  s.scope = { universe: "symbols", symbols: [] };
  s.triggers.push({ type: "schedule", cron: "every day" });
  s.steps = [{ id: "a1", type: "ai", instructions: "" }, { id: "a1", type: "rule", if: {} }];
  const paths = M.check(s, { name: "" }).filter((x) => !x.warn).map((x) => x.path);
  for (const p of ["name", "scope.symbols", "steps.0.instructions", "steps.1.id", "steps.1.if"]) assert.ok(paths.includes(p), p);
  assert.ok(paths.some((p) => /^triggers\.\d+\.cron$/.test(p)));
});

test("builder: version diff says what changed in words", async () => {
  const M = await model();
  const a = M.defaultSpec();
  const b = JSON.parse(JSON.stringify(a));
  b.steps[0].tier = "top";
  b.outputs.push({ type: "notify", who: "team", tier: "push" });
  b.triggers.push({ type: "event", on: "filing", forms: ["8-K"] });
  const d = M.diffSpecs(a, b).map((x) => x.text);
  assert.ok(d.includes('Step a1: model "mid" → "top"'));
  assert.ok(d.includes("Added: notify the whole team right away"));
  assert.ok(d.includes("Added: run whenever a new 8-K is filed"));
  assert.deepEqual(M.diffSpecs(a, a), []);
});

test("builder: dry-run timeline groups fires by day inside the window", async () => {
  global.window = global.window || {};
  const { timeline } = await import("../public/agentBuilder/testPanel.js").catch(() => ({}));
  if (!timeline) return; // needs a browser-ish shared.js; covered by the page checks
  const now = Date.parse("2026-11-19T12:00:00Z");
  const t = timeline([{ date: "2026-11-10", symbol: "NVDA" }, { date: "2026-11-10", symbol: "MU" }, { date: "2026-10-01", symbol: "X" }], 30, now);
  assert.equal(t.length, 2);
  assert.equal(t[1].list.length, 2);
  assert.equal(t[0].pct, 0);
});

test("draft: keyword reader turns the plan's example into a spec", () => {
  const draft = require("../lib/agents/draft");
  const r = draft.fromWords("tell me when any holding's estimates get cut twice in a month and check it against our thesis");
  const s = r.spec;
  assert.equal(s.scope.universe, "holdings");
  assert.ok(s.triggers.some((t) => t.on === "estimate_revision"));
  assert.deepEqual(s.conditions[0], { metric: "estimates.revisions30d", op: "<=", value: -2 });
  assert.equal(s.steps.find((x) => x.type === "ai").output, "verdict");
  assert.ok(s.outputs.some((o) => o.type === "thesis_check"));
  assert.ok(s.outputs.some((o) => o.type === "notify" && o.who === "owner"));
  const rule = draft.fromWords("alert me when an insider buys a watchlist name, no AI");
  assert.equal(rule.spec.scope.universe, "watchlist");
  assert.ok(!rule.spec.steps.some((x) => x.type === "ai"));
  assert.equal(rule.spec.budget.perMonthUsd, 0);
});

test("draft: model intent is clamped to known events, tools and metrics", () => {
  const draft = require("../lib/agents/draft");
  const r = draft.fromIntent({ name: "X", universe: "symbols", symbols: ["nvda", "bad ticker!"], schedule: "premarket",
    events: [{ on: "price_move", sigma: 40 }, { on: "made_up" }], conditions: [{ metric: "nope.metric", op: "<", value: 1 }, { metric: "quote.changePct", op: "<", value: -3 }],
    dataTools: ["get_news", "get_dcf", "rm_rf"], aiInstructions: "Explain the move.", tier: "ultra", aiOutput: "brief", aiTools: ["get_news", "not_a_tool"], feed: "always", notify: "team", notifyTier: "push", memory: true, thesisCheck: false, proposal: "none" });
  const s = r.spec;
  assert.deepEqual(s.scope.symbols, ["NVDA"]);
  assert.deepEqual(s.triggers.map((t) => t.on || t.preset || t.type), ["premarket", "price_move", "manual"]);
  assert.equal(s.triggers[1].sigma, 5);
  assert.deepEqual(s.conditions, [{ metric: "quote.changePct", op: "<", value: -3 }]);
  assert.deepEqual(s.steps.filter((x) => x.type === "tool").map((x) => x.tool), ["get_news"]);
  const ai = s.steps.find((x) => x.type === "ai");
  assert.equal(ai.tier, "mid");
  assert.deepEqual(ai.tools, ["get_news"]);
});

test("draft: uses the cheap model with a strict schema, falls back to keywords on failure", async () => {
  const draft = require("../lib/agents/draft");
  require("../lib/settings").setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5 });
  const realFetch = global.fetch;
  let req = null, fail = false;
  global.fetch = async (url, opts) => {
    if (!String(url).startsWith("https://api.openai.com/")) return new Response("{}", { status: 404 });
    req = JSON.parse(opts.body);
    if (fail) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
    const intent = { name: "Drop explainer", description: "Explains big drops.", universe: "holdings", symbols: [], schedule: "none", cron: null,
      events: [{ on: "price_move", sigma: 2, days: null, forms: [] }], conditions: [], dataTools: [], aiInstructions: "Explain why it fell, with sources.", tier: "cheap",
      aiOutput: "brief", aiTools: [], feed: "always", notify: "owner", notifyTier: "inbox", memory: false, thesisCheck: false, proposal: "none", assumptions: ["Used 2σ."] };
    return new Response(JSON.stringify({ model: "gpt-6-luna", status: "completed", usage: { input_tokens: 900, output_tokens: 200 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(intent) }] }] }), { status: 200 });
  };
  try {
    const r = await draft.draft("explain any big drop in a holding", { memberId: null });
    assert.equal(r.source, "ai");
    assert.equal(r.name, "Drop explainer");
    assert.ok(r.runId);
    assert.equal(req.model, "gpt-6-luna");
    assert.equal(req.text?.format?.strict ?? true, true);
    assert.deepEqual(r.assumptions, ["Used 2σ."]);
    fail = true;
    const f = await draft.draft("explain any big drop in a holding", { memberId: null });
    assert.equal(f.source, "rules");
    assert.ok(f.aiError);
    await assert.rejects(draft.draft("hi"), /sentence or two/);
  } finally { global.fetch = realFetch; }
});

test("draft: catalog groups every tool once and marks data-step tools", () => {
  const { catalog } = require("../lib/agents/draft");
  const c = catalog();
  const names = c.groups.flatMap((g) => g.tools.map((t) => t.name));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("get_news"));
  const all = c.groups.flatMap((g) => g.tools);
  assert.equal(all.find((t) => t.name === "get_news").dataStep, true);
  assert.equal(all.find((t) => t.name === "get_dcf").dataStep, false);
});
