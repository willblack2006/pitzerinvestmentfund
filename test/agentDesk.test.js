// Research desk agents: compare, what-if, meeting prep, ideas. OpenAI and Yahoo are mocked; the
// what-if math is checked against hand-computed weights.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-desk-")), "desk.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const prices = require("../lib/prices");
const portfolio = require("../lib/portfolio");
prices.latestPrices = async (syms) => Object.fromEntries(syms.map((s) => [s, { price: 50 }]));
const desk = require("../lib/agents/workflows/desk");
const runs = require("../lib/agents/runs");
const tools = require("../lib/agents/tools");
const { setSettings } = require("../lib/settings");

const realFetch = global.fetch;
let replies = [], requests = [];
const msg = (text) => ({ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 800, output_tokens: 90 }, output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const call = (name, args, id = "c1") => ({ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 500, output_tokens: 50 }, output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] });
const answer = (a, claims = [], followUps = []) => msg(JSON.stringify({ answer: a, claims, followUps }));

test.beforeEach(() => {
  replies = []; requests = [];
  setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5, maxPositionPct: 20, maxSectorPct: 40, minCashPct: 5 });
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) { requests.push(JSON.parse(opts.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); }
    if (u === "http://app.test/api/research/AMD") return new Response(JSON.stringify({ symbol: "AMD", price: 150 }), { status: 200 });
    return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
  };
});
test.afterEach(() => { global.fetch = realFetch; });

// Fund of $1,000: NVDA 300 (tech), XOM 200 (energy), cash 500.
function stubAllocation() {
  portfolio.allocation = async () => ({
    total: 1000, cash: 500, invested: 500,
    positions: [{ symbol: "NVDA", sector: "Technology", value: 300, weight: 30 }, { symbol: "XOM", sector: "Energy", value: 200, weight: 20 }],
  });
  portfolio.sectorsFor = async (syms) => Object.fromEntries(syms.map((s) => [s, { sector: s === "AMD" ? "Technology" : "Unclassified" }]));
}

test("what-if math: weights, cash and new policy issues are computed in code", async () => {
  stubAllocation();
  const sim = await desk.simulateTrades([{ symbol: "amd", action: "buy", pct: 15 }, { symbol: "NVDA", action: "sell", usd: 100 }]);
  assert.deepEqual(sim.trades.map((t) => [t.symbol, t.action, t.usd]), [["AMD", "buy", 150], ["NVDA", "sell", 100]]);
  const w = Object.fromEntries(sim.after.positions.map((p) => [p.symbol, p.weight]));
  assert.deepEqual(w, { NVDA: 20, AMD: 15, XOM: 20 });
  assert.equal(sim.after.cashPct, 45, "500 - 150 + 100 = 450 of 1000");
  const tech = sim.after.sectors.find((s) => s.sector === "Technology").weight;
  assert.equal(tech, 35);
  assert.deepEqual(sim.newPolicyIssues, [], "XOM was already at the 20% limit, which is not a breach");
  const big = await desk.simulateTrades([{ symbol: "AMD", action: "buy", pct: 25 }]);
  assert.match(big.newPolicyIssues.join(" "), /AMD is 25% of the fund \(max position 20%\)/);
  const oversell = await desk.simulateTrades([{ symbol: "XOM", action: "sell", usd: 999 }]);
  assert.equal(oversell.after.positions.some((p) => p.symbol === "XOM"), false, "selling more than held closes the position");
  assert.match(oversell.notes[0], /cut to the 200/);
});

test("what-if rejects bad trades before any AI spend", async () => {
  stubAllocation();
  await assert.rejects(desk.simulateTrades([]), /one to six/);
  await assert.rejects(desk.simulateTrades([{ symbol: "AMD", action: "hold", usd: 5 }]), /buy or sell/);
  await assert.rejects(desk.simulateTrades([{ symbol: "AMD", action: "buy" }]), /dollar amount or a percent/);
  await assert.rejects(desk.simulateTrades([{ symbol: "A MD!", action: "buy", usd: 5 }]), /valid ticker/);
});

test("what-if agent: simulated figures back the answer; it is billed to the member and tagged", async () => {
  stubAllocation();
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Desk', 'Analyst', '')").run().lastInsertRowid);
  replies.push(call("get_research_overview", { symbol: "AMD" }), answer("Buying AMD takes tech from 30% to 45% of the fund.", [{ text: "Simulated weights", source_url: "#/agents/desk", quote: "" }]));
  const r = await runs.run({ workflow: "what_if", memberId: m }, (ctx) => desk.whatIf({ trades: [{ symbol: "AMD", action: "buy", pct: 15 }] }, ctx));
  assert.equal(r.output.kind, "what_if");
  assert.equal(r.output.claims[0].sourced, true, "the simulated-figures source counts as read");
  assert.equal(r.output.simulation.after.cashPct, 35);
  assert.deepEqual(r.output.unbackedNumbers, [], "30% and 45% come from the simulation");
  assert.match(requests[0].input[1].content, /Simulated result/);
  assert.equal(db.prepare("SELECT memberId FROM agent_runs WHERE id = ?").get(r.runId).memberId, m);
  assert.equal(requests[0].tools.some((t) => t.name === "get_fund_policy"), true);
});

test("compare needs two to four distinct tickers and uses the comparison tools", async () => {
  await assert.rejects(runs.run({ workflow: "compare" }, (ctx) => desk.compare({ symbols: ["NVDA"] }, ctx)), /two to four/);
  await assert.rejects(runs.run({ workflow: "compare" }, (ctx) => desk.compare({ symbols: ["A", "B", "C", "D", "E"] }, ctx)), /two to four/);
  replies.push(call("get_research_overview", { symbol: "AMD" }), answer("AMD is the smaller name here.", [{ text: "AMD price", source_url: "#/research/AMD", quote: "" }]));
  const r = await runs.run({ workflow: "compare" }, (ctx) => desk.compare({ symbols: ["amd", "nvda", "AMD"] }, ctx));
  assert.deepEqual(r.output.symbols, ["AMD", "NVDA"]);
  assert.equal(r.output.question, "Compare AMD, NVDA");
  assert.equal(r.output.claims[0].sourced, true, "AMD's overview was read");
});

test("meeting prep and ideas run with their own tool lists and never get write tools", async () => {
  replies.push(answer("Quiet week."));
  const mp = await runs.run({ workflow: "meeting_prep" }, (ctx) => desk.meetingPrep({ since: "2026-11-10" }, ctx));
  assert.equal(mp.output.since, "2026-11-10");
  assert.match(requests[0].input[1].content, /since "2026-11-10"/);
  replies.push(answer("Nothing stands out."));
  const id = await runs.run({ workflow: "ideas" }, (ctx) => desk.ideas({ focus: "bogus" }, ctx));
  assert.equal(id.output.focus, "balanced", "an unknown focus falls back");
  const names = new Set([...desk.MEETING_TOOLS, ...desk.IDEA_TOOLS, ...desk.COMPARE_TOOLS, ...desk.WHATIF_TOOLS]);
  for (const n of names) assert.ok(tools.TOOLS[n] || n === "web_search", `${n} is a real tool`);
  for (const n of names) assert.match(n, /^get_|^web_search$/, "read-only tools only");
});
