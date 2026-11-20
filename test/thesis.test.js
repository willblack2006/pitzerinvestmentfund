// Thesis tracking (WS4): KPI rules, health score, drift, scenarios, catalysts, pillar status
// rules (who may move a pillar), the daily rule pass, and the AI suggestions (OpenAI mocked).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-thesis-")), "thesis.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const { evaluateKpi, normalizeKpi, validateKpi } = require("../lib/thesis/kpi");
const health = require("../lib/thesis/health");
const store = require("../lib/thesis/store");
const evaluate = require("../lib/thesis/evaluate");
const metrics = require("../lib/thesis/metrics");
const thesisAi = require("../lib/thesis/ai");
const proposals = require("../lib/agents/proposals");
const runs = require("../lib/agents/runs");
const { setSettings } = require("../lib/settings");

const NOW = "2026-11-19T12:00:00Z";

test("KPI rules: hold, near miss, clear miss, stale, missing", () => {
  const k = { metric: "fundamentals.revenueGrowthYoY", op: ">=", value: 0.2, staleAfterDays: 120 };
  assert.equal(evaluateKpi(k, { value: 0.25, asOf: "2026-10-01" }, { now: NOW, unit: "pct" }).status, "intact");
  const near = evaluateKpi(k, { value: 0.19, asOf: "2026-10-01" }, { now: NOW, unit: "pct" });
  assert.equal(near.status, "watch");
  assert.match(near.detail, /19\.0%.*>= 20\.0%.*near miss/);
  assert.equal(evaluateKpi(k, { value: 0.05, asOf: "2026-10-01" }, { now: NOW }).status, "weakened");
  const stale = evaluateKpi(k, { value: 0.3, asOf: "2026-01-01" }, { now: NOW });
  assert.equal(stale.status, "unknown"); assert.equal(stale.stale, true);
  assert.equal(evaluateKpi(k, { value: null }, { now: NOW }).status, "unknown");
  assert.equal(evaluateKpi({ metric: "a.b", op: "between", value: [10, 20] }, { value: 25 }, { now: NOW }).status, "weakened");
  assert.equal(evaluateKpi({ metric: "a.b", op: "between", value: [10, 20] }, { value: 21 }, { now: NOW }).status, "watch");
  assert.equal(evaluateKpi({ metric: "a.b", op: "pct_change_gt", value: 0.1 }, { value: 120 }, { now: NOW, prev: 100 }).status, "weakened");
  assert.equal(evaluateKpi({ metric: "a.b", op: "crosses_below", value: 50 }, { value: 40 }, { now: NOW }).status, "intact");
});

test("KPI validation rejects bad rules with a plain message", () => {
  assert.match(validateKpi({ metric: "revenue", op: ">", value: 1 }), /metric name/);
  assert.match(validateKpi({ metric: "a.b", op: "~", value: 1 }), /Unknown operator/);
  assert.match(validateKpi({ metric: "a.b", op: "between", value: [3, 1] }), /low, high/);
  assert.match(validateKpi({ metric: "a.b", op: ">", value: "" }), /numeric/);
  assert.deepEqual(normalizeKpi('{"metric":"a.b","op":">","value":"2"}'), { metric: "a.b", op: ">", value: 2 });
  assert.equal(normalizeKpi(null), null);
  assert.throws(() => normalizeKpi("{nope"), /valid JSON/);
});

test("health score: weighted pillars, unknown and overdue left out, stale/bear/kill adjustments", () => {
  const fresh = "2026-11-10T00:00:00Z";
  const h = health.healthScore([
    { status: "intact", weight: 2, lastCheckAt: fresh },
    { status: "weakened", weight: 1, lastCheckAt: fresh },
    { status: "unknown", lastCheckAt: fresh },
    { status: "intact", lastCheckAt: "2026-01-01T00:00:00Z" }, // overdue (120 days default)
  ], { now: NOW });
  assert.equal(h.score, Math.round((2 * 1 + 1 * 0.5) / 3 * 100)); // 83
  assert.equal(h.unknown, 1); assert.equal(h.overdue, 1); assert.equal(h.known, 2);
  assert.equal(h.label, "Healthy");
  const bear = health.healthScore([{ status: "intact", lastCheckAt: fresh }], { now: NOW, price: 40, bearPrice: 50, basePrice: 80 });
  assert.equal(bear.score, 80); assert.equal(bear.adjustments[0].key, "bear");
  const half = health.healthScore([{ status: "intact", lastCheckAt: fresh }], { now: NOW, price: 65, bearPrice: 50, basePrice: 80 });
  assert.equal(half.score, 95, "halfway between base and bear costs 5");
  const kill = health.healthScore([{ status: "intact", lastCheckAt: fresh }], { now: NOW, killTripped: 1 });
  assert.equal(kill.score, 85);
  const stale = health.healthScore([{ status: "intact", lastCheckAt: "2026-09-01T00:00:00Z", reviewDays: 365 }], { now: NOW });
  assert.ok(stale.score < 100 && stale.adjustments.some((a) => a.key === "stale"));
  assert.equal(health.healthScore([], {}).score, null);
  assert.equal(health.overallStatus([{ status: "intact" }, { status: "watch" }]), "watch");
  assert.equal(health.overallStatus([{ status: "weakened" }, { status: "intact" }]), "weakened");
  assert.equal(health.overallStatus([{ status: "broken" }, { status: "intact" }]), "broken");
});

test("drift, scenario value and catalyst hit rate", () => {
  const orig = "Data center GPU demand drives revenue growth above 30 percent; CUDA software moat keeps margins high.";
  assert.equal(health.drift(orig, orig).drifted, false);
  const d = health.drift(orig, "Gaming console recovery and crypto mining demand support a turnaround in consumer sales.");
  assert.equal(d.drifted, true);
  assert.ok(d.added.includes("gaming") && d.dropped.includes("cuda"));
  const ev = health.expectedValue({ bullProb: 2, baseProb: 5, bearProb: 3 }, { bullPrice: 200, basePrice: 120, bearPrice: 60 }, 100);
  assert.equal(ev.value, 118); assert.ok(Math.abs(ev.upsidePct - 0.18) < 1e-9);
  assert.equal(health.expectedValue({ bullProb: 0, baseProb: 0, bearProb: 0 }, { bullPrice: 1, basePrice: 1, bearPrice: 1 }), null);
  const today = "2026-11-19";
  const s = health.catalystStats([
    { status: "hit", dueDate: "2026-10-01", resolvedAt: "2026-09-30" },
    { status: "hit", dueDate: "2026-10-01", resolvedAt: "2026-10-20" },
    { status: "miss", dueDate: "2026-09-01" },
    { status: "pending", dueDate: "2026-11-01" },
    { status: "pending", dueDate: "2027-01-01" },
  ], today);
  assert.deepEqual([s.onTime, s.lateHit, s.miss, s.late, s.pending, s.due], [1, 1, 1, 1, 1, 4]);
  assert.equal(s.hitRate, 0.25);
});

// ---- Database flows ----

function seed() {
  const m = db.prepare("INSERT INTO members (name, pinHash, canUseAi) VALUES ('Ada', '', 1)").run();
  db.prepare("INSERT INTO positions (symbol, shares, marketValue) VALUES ('NVDA', 10, 1000)").run();
  db.prepare(`INSERT INTO pitches (symbol, status, thesis, catalysts, bearCase, bullPrice, basePrice, bearPrice, decidedAt)
    VALUES ('NVDA', 'executed', 'Data center GPU demand keeps revenue growing over 30% a year.', 'Blackwell ramp by 2027-02-15', 'Hyperscalers cut capex.', 200, 150, 90, '2026-06-01')`).run();
  return { id: Number(m.lastInsertRowid), name: "Ada" };
}
let member;
test.before(() => { member = seed(); setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5 }); });

test("pillars: create, validate, member override beats rules until released", async () => {
  assert.throws(() => store.createPillar({ symbol: "NVDA", text: "short" }), /8\+ characters/);
  assert.throws(() => store.createPillar({ symbol: "NVDA", text: "Revenue keeps growing fast", kpi: { metric: "x", op: ">", value: 1 } }), /metric name/);
  const p = store.createPillar({ symbol: "NVDA", text: "Revenue keeps growing 20%+ a year", kpi: { metric: "fundamentals.revenueGrowthYoY", op: ">=", value: 0.2 }, weight: 2, createdBy: member.id });
  assert.equal(p.status, "unknown"); assert.equal(p.createdByName, "Ada"); assert.equal(p.kpi.value, 0.2);

  let growth = 0.3;
  const read = async (name) => (name === "fundamentals.revenueGrowthYoY" ? { value: growth, asOf: "2026-11-01", sourceUrl: "https://example.test" } : { value: null });
  let r = await evaluate.runRules({ symbols: ["NVDA"], read, now: new Date().toISOString(), prices: { NVDA: { price: 160 } } });
  assert.equal(r.checked, 1); assert.equal(r.moved, 1);
  assert.equal(store.getPillar(p.id).status, "intact");
  assert.equal(store.getPillar(p.id).statusBy, "rule");
  r = await evaluate.runRules({ symbols: ["NVDA"], read });
  assert.equal(r.checked, 0, "one rule check per pillar per day");

  // A member's call stands; the rule keeps recording beside it.
  store.recordCheck({ pillarId: p.id, status: "weakened", method: "member", memberId: member.id, by: "Ada", evidence: ["Guide cut on the call."], detail: "Guide cut on the call." });
  assert.equal(store.getPillar(p.id).statusBy, "Ada");
  r = await evaluate.runRules({ symbols: ["NVDA"], read, force: true });
  assert.equal(store.getPillar(p.id).status, "weakened", "rule can't undo a member's status");
  // An unapproved AI check doesn't move it either.
  store.recordCheck({ pillarId: p.id, status: "broken", method: "ai" });
  assert.equal(store.getPillar(p.id).status, "weakened");
  const feed = db.prepare("SELECT * FROM feed_items WHERE kind = 'thesis_change'").all();
  assert.ok(feed.some((f) => /unknown → intact/.test(f.title)) && feed.some((f) => /intact → weakened/.test(f.title)));

  const hist = store.checks("NVDA", { pillarId: p.id });
  assert.deepEqual(hist.map((c) => c.method), ["ai", "rule", "member", "rule"]);
  assert.equal(hist.find((c) => c.method === "member").memberName, "Ada");

  growth = 0.1;
  db.prepare("UPDATE thesis_pillars SET statusBy = 'rule' WHERE id = ?").run(p.id);
  await evaluate.runRules({ symbols: ["NVDA"], read, force: true });
  assert.equal(store.getPillar(p.id).status, "weakened");
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM thesis_health WHERE symbol = 'NVDA'").get().n >= 1);
});

test("summary: health, drift against the pitch, scenario expected value, catalysts", () => {
  db.prepare("INSERT INTO research_notes (symbol, thesis) VALUES ('NVDA', 'Gaming consoles and crypto mining recovery drive a consumer turnaround.') ON CONFLICT(symbol) DO UPDATE SET thesis = excluded.thesis").run();
  store.addScenarioMark({ symbol: "NVDA", bullProb: 0.3, baseProb: 0.5, bearProb: 0.2, memberId: member.id });
  store.addCatalyst({ symbol: "NVDA", text: "Blackwell ramp", dueDate: "2020-01-01" });
  const s = evaluate.summarize("NVDA", { price: 150 });
  assert.equal(s.drift.drifted, true); assert.equal(s.drift.from, "pitch #1");
  assert.equal(s.scenario.expected.value, 0.3 * 200 + 0.5 * 150 + 0.2 * 90);
  assert.equal(s.catalysts.stats.late, 1);
  assert.equal(s.pitch.bearPrice, 90);
  assert.ok(Number.isFinite(s.health.score));
  assert.throws(() => store.addScenarioMark({ symbol: "NVDA", bullProb: 0, baseProb: 0, bearProb: 0 }), /probabilities/);
});

test("versions: written on change only, with the editor", () => {
  const a = store.saveVersion({ symbol: "AMD", text: "v1", targetPrice: 100, editedBy: member.id });
  assert.ok(a);
  assert.equal(store.saveVersion({ symbol: "AMD", text: "v1", targetPrice: 100, editedBy: member.id }), null);
  assert.ok(store.saveVersion({ symbol: "AMD", text: "v2", targetPrice: 100 }));
  const v = store.versions("AMD");
  assert.deepEqual(v.map((x) => x.text), ["v2", "v1"]);
  assert.equal(v[1].editedByName, "Ada");
});

test("metrics read the research overview once per symbol", async () => {
  let calls = 0;
  metrics.setOverviewFetcher(async () => { calls++; return { quote: { price: 120 }, street: { keyStats: { revenueGrowth: 0.4, grossMargin: { raw: 0.7 } } }, thesis: { priceAtThesis: 100 } }; });
  const read = metrics.reader();
  assert.equal((await read("fundamentals.revenueGrowthYoY", "NVDA")).value, 0.4);
  assert.equal((await read("fundamentals.grossMargin", "NVDA")).value, 0.7);
  assert.ok(Math.abs((await read("price.sinceThesisPct", "NVDA")).value - 0.2) < 1e-9);
  assert.equal((await read("price.vsBearPct", "NVDA")).value, 120 / 90 - 1);
  assert.equal(calls, 1);
  assert.match((await read("nope.metric", "NVDA")).error, /Unknown metric/);
  metrics.setOverviewFetcher(null);
});

// ---- AI (OpenAI mocked) ----

const realFetch = global.fetch;
let replies = [];
const msg = (obj) => ({ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 600, output_tokens: 80 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] });
test.beforeEach(() => {
  replies = [];
  global.fetch = async (url) => {
    if (String(url).startsWith("https://api.openai.com/")) return new Response(JSON.stringify(replies.shift()), { status: 200 });
    return new Response("{}", { status: 404 });
  };
});
test.afterEach(() => { global.fetch = realFetch; });

test("suggest pillars: bad KPIs dropped, proposal applies pillars and catalysts on approval", async () => {
  replies.push(msg({
    pillars: [
      { text: "Data-center revenue keeps growing 30%+", origin: "thesis", consensus: "Street expects a slowdown", metric: "fundamentals.revenueGrowthYoY", op: ">=", value: [0.3], reviewDays: 90 },
      { text: "Gross margin stays above 70 percent", origin: "kill", consensus: "", metric: "made.up", op: ">", value: [0.7], reviewDays: 5 },
      { text: "x", origin: "thesis", consensus: "", metric: "", op: "", value: [], reviewDays: 30 },
    ],
    catalysts: [{ text: "Blackwell ramp", dueDate: "2027-02-15" }, { text: "Investor day", dueDate: "sometime" }],
  }));
  const out = await runs.run({ workflow: "thesis_pillars", memberId: member.id, symbol: "MU" }, (ctx) => thesisAi.suggestPillars({ symbol: "MU", pitchId: 1 }, ctx));
  assert.equal(out.output.pillars.length, 2, "too-short pillar dropped");
  assert.equal(out.output.pillars[1].kpi, null, "unknown metric dropped");
  assert.equal(out.output.pillars[1].reviewDays, 14, "review clamped");
  assert.equal(out.output.catalysts[1].dueDate, null);
  assert.equal(store.listPillars("MU").length, 0, "nothing written before approval");
  await proposals.decide(out.output.proposalId, member, true);
  const ps = store.listPillars("MU");
  assert.equal(ps.length, 2); assert.equal(ps[0].origin, "thesis"); assert.equal(ps[0].createdByName, "Ada");
  assert.equal(store.listCatalysts("MU").length, 2);
});

test("AI pillar check: evidence-backed moves become proposals; approval moves the pillar", async () => {
  const [p1, p2] = store.listPillars("MU");
  const info = { headline: "MU cuts guidance", bottomLine: "Data-center revenue fell 5% year over year.", points: [] };
  replies.push(msg({ pillars: [
    { id: p1.id, status: "weakened", reason: "Revenue fell.", evidence: "Data-center revenue fell 5% year over year.", changedFromPrior: true },
    { id: p2.id, status: "broken", reason: "Made up.", evidence: "margins collapsed to 20%", changedFromPrior: true },
  ], overall: "Growth pillar weakened." }));
  const out = await runs.run({ workflow: "thesis_pillar_check", memberId: member.id, symbol: "MU" }, (ctx) => thesisAi.checkPillars({ symbol: "MU", info }, ctx));
  const [r1, r2] = out.output.results;
  assert.ok(r1.proposalId, "verified evidence → proposal");
  assert.equal(r2.proposalId, null, "quote not in the new information → no proposal");
  assert.equal(store.getPillar(p1.id).status, "unknown", "AI alone moves nothing");
  await proposals.decide(r1.proposalId, member, true);
  assert.equal(store.getPillar(p1.id).status, "weakened");
  assert.equal(store.getPillar(p1.id).statusBy, "ai");
});

test("scenario suggestion files a proposal and approval adds a mark", async () => {
  replies.push(msg({ bullProb: 0.2, baseProb: 0.5, bearProb: 0.3, note: "Growth pillar weakened." }));
  const before = store.scenarioMarks("NVDA").length;
  const out = await runs.run({ workflow: "thesis_scenario", memberId: member.id, symbol: "NVDA" }, (ctx) => thesisAi.suggestScenario({ symbol: "NVDA" }, ctx));
  await proposals.decide(out.output.proposalId, member, true);
  const marks = store.scenarioMarks("NVDA");
  assert.equal(marks.length, before + 1); assert.equal(marks.at(-1).source, "agent");
});
