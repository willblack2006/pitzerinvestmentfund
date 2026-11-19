// The data tools agents and Ask PIF can call (lib/agents/dataTools.js). App endpoints are mocked;
// nothing here calls a real data source or model.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-agentdata-")), "agentdata.db");

const db = require("../db");
const tools = require("../lib/agents/tools");
const { priceSummary } = require("../lib/agents/dataTools");

const realFetch = global.fetch;
function mockApp(routes) {
  tools.setBaseUrl("http://app.test");
  const seen = [];
  global.fetch = async (url) => {
    const p = String(url).slice("http://app.test/api".length);
    seen.push(p);
    const hit = routes[p];
    return hit ? new Response(JSON.stringify(hit), { status: 200 }) : new Response(JSON.stringify({ error: "nope" }), { status: 404 });
  };
  return seen;
}
test.afterEach(() => { global.fetch = realFetch; });

test("every tool has a strict-mode schema OpenAI accepts", () => {
  const names = Object.keys(tools.TOOLS);
  for (const n of ["get_financials", "get_price_history", "get_options", "get_news", "get_fund_view", "get_transactions", "get_dividends", "get_calendar", "get_signals", "get_market_news", "get_13f_manager"]) assert.ok(names.includes(n), `${n} is registered`);
  const defs = tools.toOpenAITools(names);
  assert.equal(new Set(defs.map((d) => d.name)).size, defs.length, "no duplicate names");
  assert.ok(defs.length <= 128, "under OpenAI's tool limit");
  assert.ok(defs.some((d) => d.type === "web_search"), "web search is offered as OpenAI's built-in tool");
  for (const d of defs.filter((x) => x.type === "function")) {
    assert.match(d.name, /^[a-z0-9_]{1,64}$/);
    assert.equal(d.parameters.additionalProperties, false, d.name);
    assert.deepEqual([...d.parameters.required].sort(), Object.keys(d.parameters.properties).sort(), `${d.name}: strict mode needs every property required`);
    assert.ok(d.description.length > 30, `${d.name} explains itself`);
  }
});

test("Ask PIF's catalog includes the new tools", () => {
  const { ASK_TOOLS } = require("../lib/agents/workflows/ask");
  const list = typeof ASK_TOOLS === "function" ? ASK_TOOLS() : ASK_TOOLS;
  for (const n of ["get_financials", "get_fund_view", "get_price_history"]) assert.ok(list.includes(n));
});

test("get_financials returns the full statement history, not just the latest year", async () => {
  mockApp({ "/research/MU": { symbol: "MU", name: "Micron", analysis: { annual: [{ end: "2024-08-29", revenue: 1 }, { end: "2025-08-28", revenue: 2 }], quarterly: { revenue: [] }, piotroski: { score: 6, outOf: 9, tests: [] } } } });
  const r = await tools.callTool("get_financials", { symbol: "mu" });
  assert.equal(r.data.annual.length, 2);
  assert.equal(r.data.piotroski.score, 6);
  assert.equal(r.source_url, "#/research/MU/financials");
});

test("a data source error on the page comes back as a tool error, not as data", async () => {
  mockApp({ "/research/MU/options": { symbol: "MU", error: "Yahoo request failed: 429" } });
  const r = await tools.callTool("get_options", { symbol: "MU" });
  assert.match(r.error, /429/);
});

test("get_options keeps the summary and only strikes near the money", async () => {
  mockApp({ "/research/MU/options": { symbol: "MU", spot: 100, expiration: 1764288000, expirationDates: [1764288000], pcRatio: { oiRatio: 0.8 }, expectedMovePct: 0.06,
    callOI: [{ strike: 50, openInterest: 1 }, { strike: 100, openInterest: 9 }, { strike: 200, openInterest: 1 }], putOI: [{ strike: 95, openInterest: 4 }], gammaByStrike: [] } });
  const r = await tools.callTool("get_options", { symbol: "MU" });
  assert.deepEqual(r.data.callOINearMoney.map((x) => x.strike), [100]);
  assert.equal(r.data.expiration, "2025-11-28");
  assert.equal(r.data.callOI, undefined, "the full chain is left out");
});

test("priceSummary: returns, 52-week range, averages and weekly closes from daily bars", () => {
  const bars = [];
  const start = Date.UTC(2024, 10, 18);
  for (let i = 0; i < 520; i++) {
    const d = new Date(start + i * 864e5);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    bars.push({ date: d.toISOString().slice(0, 10), close: 100 + bars.length * 0.1, high: 101 + bars.length * 0.1, low: 99 + bars.length * 0.1, volume: 1000 });
  }
  const s = priceSummary(bars);
  const last = bars.at(-1);
  assert.equal(s.lastClose, last.close);
  assert.ok(s.returns["1Y"] > 0 && s.returns["1M"] > 0 && s.returns["1M"] < s.returns["1Y"]);
  assert.equal(s.high52w.price, last.high, "a steady climb peaks on the last day");
  assert.equal(s.maxDrawdown1Y, 0);
  assert.equal(s.avgVolume20d, 1000);
  assert.ok(s.weeklyCloses1Y.length >= 50 && s.weeklyCloses1Y.length <= 54);
  assert.equal(priceSummary([]), null);
});

test("get_fund_view: thesis, pitches, trades and shared agent output, never a member's private questions", async () => {
  db.prepare("INSERT INTO research_notes (symbol, author, thesis, targetPrice, thesisStatus) VALUES ('NVDA', 'Ana', 'AI capex lasts', 250, 'on_track')").run();
  db.prepare("INSERT INTO pitches (symbol, title, author, status, thesis, basePrice) VALUES ('NVDA', 'Long NVDA', 'Ana', 'approved', 'Data center demand', 240)").run();
  db.prepare("INSERT INTO transactions (date, type, symbol, shares, price, amount) VALUES ('2026-10-01', 'buy', 'NVDA', 10, 180, 1800)").run();
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Bo', 'Analyst', '')").run().lastInsertRowid);
  db.prepare("INSERT INTO agent_runs (workflow, symbol, status, output) VALUES ('filing_flash', 'NVDA', 'done', ?)").run(JSON.stringify({ headline: "CEO change", bottomLine: "Huang resigned." }));
  db.prepare("INSERT INTO agent_runs (workflow, symbol, status, memberId, output) VALUES ('filing_flash', 'NVDA', 'done', ?, ?)").run(m, JSON.stringify({ headline: "private" }));
  const r = await tools.callTool("get_fund_view", { symbol: "nvda" });
  assert.equal(r.data.thesis.thesis, "AI capex lasts");
  assert.equal(r.data.thesis.thesisStatus, "on_track");
  assert.equal(r.data.pitches[0].basePrice, 240);
  assert.equal(r.data.fundTrades[0].shares, 10);
  assert.deepEqual(r.data.agentOutput.map((o) => o.title), ["CEO change"], "member-billed runs stay private");
  assert.equal(r.data.agentOutput[0].summary, "Huang resigned.");
});

test("get_meeting_brief passes a valid date and ignores anything else", async () => {
  const seen = mockApp({ "/meeting-brief?since=2026-11-01": { since: "2026-11-01" }, "/meeting-brief": { since: "default" } });
  assert.equal((await tools.callTool("get_meeting_brief", { since: "2026-11-01" })).data.since, "2026-11-01");
  assert.equal((await tools.callTool("get_meeting_brief", { since: "x&y=1" })).data.since, "default");
  assert.deepEqual(seen, ["/meeting-brief?since=2026-11-01", "/meeting-brief"]);
});

test("web search: built-in tool, billed per search, cited pages logged as run sources; off switch works", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const runs = require("../lib/agents/runs");
  const replies = [{ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 1000, output_tokens: 100 }, output: [
    { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "why did MU fall today" } },
    { type: "message", content: [{ type: "output_text", text: "Guidance cut.", annotations: [{ type: "url_citation", url: "https://news.example/mu", title: "Micron cuts guidance", start_index: 0, end_index: 5 }] }] },
  ] }];
  const sent = [];
  global.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); };
  const r = await runs.run({ workflow: "test_web" }, (ctx) => ctx.agent({ system: "s", user: "u", tools: ["get_holdings", "web_search"] }));
  assert.deepEqual(sent[0].tools.map((t) => t.type), ["function", "web_search"]);
  const run = runs.getRun(r.runId);
  const web = run.steps.find((s) => s.kind === "tool" && s.name === "web_search");
  assert.equal(web.source_url, "https://news.example/mu");
  assert.equal(Math.round(run.costUsd * 1e4) / 1e4, Math.round((1000 * 2 + 100 * 10) / 1e6 * 1e4 + 100) / 1e4, "tokens plus $0.01 for the search");
  process.env.AGENT_WEB_SEARCH = "off";
  assert.ok(!tools.toOpenAITools(["get_holdings", "web_search"]).some((t) => t.type === "web_search"));
  delete process.env.AGENT_WEB_SEARCH;
  assert.match((await tools.callTool("web_search", {})).error, /OpenAI's side/);
});
