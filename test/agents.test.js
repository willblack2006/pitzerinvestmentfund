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

test.beforeEach(() => { replies = []; requests = []; mockOpenAI(); db.exec("DELETE FROM agent_proposals; DELETE FROM agent_feedback; DELETE FROM agent_runs; DELETE FROM agent_events;"); setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 0.5 }); });
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

// ---- filing and earnings flash ----

test("flash: an earnings 8-K gets a brief from the press-release exhibit, with quotes checked and members notified", async () => {
  require("../lib/agents/workflows");
  const folder = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000099";
  const pressRelease = "<html><body><p>NVIDIA Announces Financial Results for Third Quarter Fiscal 2027</p><p>Revenue was $57.0 billion, up 62% from a year ago.</p><p>GAAP earnings per diluted share were $1.30.</p></body></html>";
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) { requests.push(JSON.parse(opts.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); }
    if (u === `${folder}/index.json`) return new Response(JSON.stringify({ directory: { item: [{ name: "nvda-8k.htm" }, { name: "q3fy27pr-ex991.htm" }] } }), { status: 200 });
    if (u === `${folder}/nvda-8k.htm`) return new Response("<p>Item 2.02 Results of Operations and Financial Condition. See Exhibit 99.1.</p>", { status: 200 });
    if (u === `${folder}/q3fy27pr-ex991.htm`) return new Response(pressRelease, { status: 200 });
    return new Response("not mocked", { status: 404 });
  };
  const admin = db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, isAdmin) VALUES ('Flash Admin', 'Admin', '', 'flash@test.edu', 'x', 1)").run().lastInsertRowid;
  const plain = db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash) VALUES ('No AI', 'Analyst', '', 'noai@test.edu', 'x')").run().lastInsertRowid;
  replies.push(msg(JSON.stringify({
    headline: "Revenue up 62% to $57.0 billion", bottomLine: "Revenue was $57.0 billion, up 62% from a year ago.", tone: "positive",
    points: [
      { text: "Revenue grew 62% year over year to $57.0 billion.", quote: "Revenue was $57.0 billion, up 62% from a year ago." },
      { text: "Margins hit a record 81%.", quote: "Gross margin was a record 81%." },
    ],
    kpis: [{ name: "Diluted EPS (GAAP)", value: "$1.30", quote: "GAAP earnings per diluted share were $1.30." }],
    questions: ["How much of the growth came from data center?"],
  })));
  const today = new Date().toISOString().slice(0, 10);
  agents.recordEvent({ dedupeKey: "filing:NV1", symbol: "NVDA", type: "8-K", items: "2.02,9.01", asOf: today, sourceUrl: `${folder}/nvda-8k.htm` });
  agents.routeNew();
  const d = await agents.dispatch();
  assert.deepEqual(d, { ran: 1, failed: 0 });
  const run = db.prepare("SELECT * FROM agent_runs WHERE workflow = 'earnings_flash'").get();
  const brief = JSON.parse(run.output);
  assert.equal(brief.points[0].verified, true);
  assert.equal(brief.points[1].verified, false, "a quote that isn't in the filing is marked");
  assert.equal(brief.kpis[0].verified, true);
  assert.deepEqual(brief.unbackedNumbers, ["81%"], "a number the filing doesn't contain is flagged");
  assert.match(requests[0].input[1].content, /Revenue was \$57\.0 billion/, "the model read the exhibit, not just the cover page");
  assert.equal(requests[0].model, "gpt-6.1-sol");
  const notes = db.prepare("SELECT memberId, type, link FROM notifications WHERE type = 'agentBrief'").all();
  assert.deepEqual(notes.map((n) => n.memberId), [Number(admin)], "only members with AI access are notified");
  assert.equal(notes[0].link, `#/agents/runs/${run.id}`);
  assert.ok(Number(plain));
});

// ---- Ask PIF, red team, pitch primer ----

function mockAppAndOpenAI(appData) {
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) { requests.push(JSON.parse(opts.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); }
    if (u.startsWith("http://app.test/api/")) {
      const path = u.slice("http://app.test/api".length);
      const hit = Object.entries(appData).find(([k]) => path === k);
      return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response(JSON.stringify({ error: "nope" }), { status: 404 });
    }
    return new Response("not mocked", { status: 404 });
  };
}

test("Ask PIF: answers from tool data, marks sources it actually read, flags unbacked numbers", async () => {
  const { ask } = require("../lib/agents/workflows/ask");
  mockAppAndOpenAI({ "/positions": [{ symbol: "NVDA", shares: 100, marketValue: 18000 }, { symbol: "MU", shares: 50, marketValue: 6000 }] });
  replies.push(call("get_holdings", {}), msg(JSON.stringify({
    answer: "NVDA is the largest holding at $18,000, about 3x MU.",
    claims: [{ text: "NVDA market value is $18,000", source_url: "#/holdings", quote: "" }, { text: "MU is cheap", source_url: "#/research/MU", quote: "" }],
    followUps: ["How has NVDA performed since purchase?"],
  })));
  // The self-check sends "3x" back; the model's second answer still has it, so it stays flagged.
  replies.push(msg(JSON.stringify({
    answer: "NVDA is the largest holding at $18,000 (my calculation: about 3x MU's $6,000).",
    claims: [{ text: "NVDA market value is $18,000", source_url: "#/holdings", quote: "" }, { text: "MU is cheap", source_url: "#/research/MU", quote: "" }],
    followUps: ["How has NVDA performed since purchase?"],
  })));
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Asker', 'Analyst', '')").run().lastInsertRowid);
  const saved = db.prepare("SELECT * FROM positions").all();
  db.exec("DELETE FROM positions");
  db.prepare("INSERT INTO positions (symbol, shares, marketValue) VALUES ('NVDA', 100, 18000), ('MU', 50, 6000)").run();
  let r;
  try { r = await runs.run({ workflow: "ask_pif", memberId: m }, (ctx) => ask({ question: "What's our biggest holding?" }, ctx)); } finally {
    db.exec("DELETE FROM positions");
    for (const p of saved) db.prepare(`INSERT INTO positions (${Object.keys(p).join(",")}) VALUES (${Object.keys(p).map(() => "?").join(",")})`).run(...Object.values(p));
  }
  assert.equal(r.output.claims[0].sourced, true);
  assert.equal(r.output.claims[1].sourced, false, "a source the agent never read is marked");
  assert.deepEqual(r.output.toolsUsed.map((t) => t.name), ["get_holdings"]);
  assert.match(JSON.stringify(requests[2].input.at(-1)), /3x/, "the unbacked number went back to the model");
  assert.equal(requests[2].tools.length > 10, true, "the revision turn may call tools");
  assert.equal(r.output.revised, true);
  assert.deepEqual(r.output.unbackedNumbers, ["3x"], "a computed ratio is still flagged for checking");
  assert.equal(requests[0].tools.length > 10, true, "Ask PIF gets the whole read-only catalog");
  assert.match(requests[0].input[1].content, /Fund holdings \(weight[^\n]*NVDA 75\.0%, MU 25\.0%/, "holdings are in the prompt so the model can route");
  assert.equal(db.prepare("SELECT memberId FROM agent_runs WHERE id = ?").get(r.runId).memberId, m, "billed to the member's daily budget");
});

test("red team: runs when a pitch opens for a vote, cites tool evidence, notifies the author", async () => {
  require("../lib/agents/workflows");
  const author = Number(db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash) VALUES ('Pitcher', 'Analyst', '', 'pitcher@test.edu', 'x')").run().lastInsertRowid);
  const pitchId = Number(db.prepare("INSERT INTO pitches (symbol, title, author, authorId, status, thesis) VALUES ('MU', 'Memory upcycle', 'Pitcher', ?, 'voting', 'HBM demand')").run(author).lastInsertRowid);
  mockAppAndOpenAI({ "/research/MU/risk": { beta: 1.6, piotroski: 4 } });
  replies.push(call("get_risk", { symbol: "MU" }), msg(JSON.stringify({
    summary: "The pitch ignores cyclicality.", bearCase: "Memory prices roll over.", questions: ["What if HBM pricing falls?"],
    objections: [{ title: "High beta", detail: "Beta is 1.6, so the position swings more than the market.", severity: "medium", evidence: "beta 1.6", source_url: "#/research/MU/risk" }],
  })));
  agents.recordEvent({ dedupeKey: `pitch:${pitchId}:voting:x`, symbol: "MU", type: "PITCH_SUBMITTED", title: "Pitch opened", payload: { pitchId } });
  agents.routeNew();
  assert.deepEqual(await agents.dispatch(), { ran: 1, failed: 0 });
  const out = JSON.parse(db.prepare("SELECT output FROM agent_runs WHERE workflow = 'red_team'").get().output);
  assert.equal(out.pitchId, pitchId);
  assert.equal(out.objections[0].sourced, true);
  assert.deepEqual(out.unbackedNumbers, []);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE memberId = ? AND type = 'agentBrief' AND link = ?").get(author, `#/pitches/${pitchId}`), "the author is told");
});

test("pitch primer: calls a fixed set of tools, then drafts every section in one model call", async () => {
  const { pitchPrimer, PRIMER_TOOLS } = require("../lib/agents/workflows/pitch");
  const data = Object.fromEntries(PRIMER_TOOLS.map((t) => [t, { ok: t }]));
  mockAppAndOpenAI({ "/research/DUOL": { name: "Duolingo", price: 300 }, "/research/DUOL/comps": { peers: [] }, "/research/DUOL/risk": {}, "/estimate-revisions/DUOL": {}, "/research/DUOL/base-rate": {}, "/insiders/DUOL": {}, "/13f/breadth/DUOL": {}, "/research/DUOL/red-flags": {} });
  const draft = { thesis: "t", catalysts: "c", risks: "r", valuation: "v", bullCase: "b", baseCase: "b", bearCase: "b", facts: [{ fact: "price 300", tool: "get_research_overview" }], openQuestions: ["q"] };
  replies.push(msg(JSON.stringify(draft)));
  const r = await runs.run({ workflow: "pitch_primer" }, (ctx) => pitchPrimer({ symbol: "DUOL" }, ctx));
  assert.equal(r.output.thesis, "t");
  assert.equal(requests.length, 1);
  assert.match(requests[0].input[1].content, /<untrusted_tool_data tool="get_research_overview">/);
  assert.equal(runs.getRun(r.runId).steps.filter((s) => s.kind === "tool").length, PRIMER_TOOLS.length);
  assert.ok(data);
});

// ---- scheduled agents ----

test("schedule: weekly reports, the nightly data check and earnings previews are recorded once per period", async () => {
  const s = require("../lib/agents/workflows/scheduled");
  const fri = new Date("2026-11-20T22:00:00Z"); // Friday after 21:00 UTC: every weekly report is due
  const earnings = [{ symbol: "NVDA", date: "2026-11-24", owned: true }, { symbol: "AAPL", date: "2026-11-25", owned: false }, { symbol: "MU", date: "2026-12-20", owned: true }];
  const n = await s.scheduledEvents(agents, { now: fri, earnings });
  assert.equal(n, 6, "4 weekly + data check + 1 preview");
  assert.equal(await s.scheduledEvents(agents, { now: fri, earnings }), 0, "deduped");
  const types = db.prepare("SELECT type FROM agent_events ORDER BY type").all().map((r) => r.type);
  assert.deepEqual(types, ["DATA_QA", "EARNINGS_PREVIEW", "MACRO_BRIEF", "OWNERSHIP_WATCH", "POLICY_WATCH", "WEEKLY_MEMO"]);
  const mon = new Date("2026-11-23T08:00:00Z");
  db.exec("DELETE FROM agent_events");
  await s.scheduledEvents(agents, { now: mon, earnings: [] });
  assert.deepEqual(db.prepare("SELECT type FROM agent_events").all().map((r) => r.type), ["DATA_QA"], "Monday before 13:00 UTC: only the data check");
  agents.routeNew();
  assert.equal(db.prepare("SELECT workflow FROM agent_events").get().workflow, "data_qa");
});

test("macro brief: one cheap call over tool data; items citing unread sources are marked", async () => {
  const s = require("../lib/agents/workflows/scheduled");
  mockAppAndOpenAI({ "/macro": { dgs10: 4.1 }, "/portfolio/allocation": { sectors: [{ name: "Technology", pct: 40 }] } });
  replies.push(msg(JSON.stringify({ title: "Rates steady", summary: "The 10-year is 4.1.", sections: [{ heading: "Rates", items: [
    { text: "10-year at 4.1%", source_url: "#/macro", symbol: "" }, { text: "Tech is 40% of the fund", source_url: "#/nowhere", symbol: "" }] }] }), undefined, "gpt-6-luna"));
  const r = await runs.run({ workflow: "macro_brief" }, (ctx) => s.macroBrief({}, ctx));
  assert.equal(requests[0].model, "gpt-6-luna", "cheap tier");
  assert.deepEqual(r.output.sections[0].items.map((i) => i.sourced), [true, false]);
  assert.deepEqual(r.output.unbackedNumbers, []);
});

test("data check: SEC vs Yahoo mismatches over 15% are listed with a likely cause, no model call", async () => {
  const s = require("../lib/agents/workflows/scheduled");
  const sec = require("../lib/sources/sec"), yahoo = require("../lib/sources/yahoo");
  const orig = [sec.getCompanyFacts, yahoo.getQuoteSummary];
  const top = db.prepare("SELECT symbol FROM positions ORDER BY marketValue DESC").get().symbol;
  sec.getCompanyFacts = async (sym) => sym === top ? { longTermDebt: [{ end: "2026-09-30", val: 1000 }], shortTermDebt: [{ end: "2026-09-30", val: 0 }], cash: [{ val: 500 }], sharesOutstanding: [{ val: 100 }] } : null;
  yahoo.getQuoteSummary = async () => ({ financialData: { totalDebt: { raw: 1600 }, totalCash: { raw: 520 } }, defaultKeyStatistics: { sharesOutstanding: { raw: 100 } } });
  try {
    const r = await runs.run({ workflow: "data_qa" }, (ctx) => s.dataQa({}, ctx));
    assert.deepEqual(r.output.mismatches.map((m) => [m.symbol, m.field, m.diffPct]), [[top, "debt", 37.5]]);
    assert.match(r.output.mismatches[0].likelyCause, /leases/);
    assert.equal(requests.length, 0);
  } finally { [sec.getCompanyFacts, yahoo.getQuoteSummary] = orig; }
});

test("thesis check: a flash on a holding with a thesis queues a check; the status changes only on approval", async () => {
  const s = require("../lib/agents/workflows/scheduled");
  const proposals = require("../lib/agents/proposals");
  const sym = db.prepare("SELECT symbol FROM positions LIMIT 1").get().symbol;
  db.prepare("INSERT OR REPLACE INTO research_notes (symbol, thesis) VALUES (?, 'Margins expand as the new fab ramps.')").run(sym);
  const brief = { headline: "Fab delayed a year", bottomLine: "The new fab is delayed to 2028.", points: [{ text: "Fab delayed", quote: "The fab is now expected in 2028.", verified: true }] };
  const briefRunId = Number(db.prepare("INSERT INTO agent_runs (workflow, status, output) VALUES ('filing_flash', 'done', ?)").run(JSON.stringify(brief)).lastInsertRowid);
  replies.push(msg(JSON.stringify({ status: "weakened", reason: "The ramp the thesis needs is a year later.", evidence: "The fab is now expected in 2028." })));
  const r = await runs.run({ workflow: "thesis_check" }, (ctx) => s.thesisCheck({ payload: { symbol: sym, briefRunId } }, ctx));
  assert.equal(r.output.status, "weakened");
  assert.equal(r.output.evidenceVerified, true);
  assert.equal(db.prepare("SELECT thesisStatus FROM research_notes WHERE symbol = ?").get(sym).thesisStatus, null, "nothing changes before approval");
  const [p] = proposals.list();
  assert.equal(p.kind, "thesis_status");
  await proposals.decide(p.id, { id: 1, name: "Reviewer" }, true);
  const note = db.prepare("SELECT thesisStatus, thesisStatusBy FROM research_notes WHERE symbol = ?").get(sym);
  assert.deepEqual(note, { thesisStatus: "weakened", thesisStatusBy: "Reviewer" });
  await assert.rejects(proposals.decide(p.id, { id: 1, name: "Reviewer" }, true), /already decided/);
});

test("weekly memo: top tier, uses only this week's output not marked wrong, waits for an editor", async () => {
  const s = require("../lib/agents/workflows/scheduled");
  const proposals = require("../lib/agents/proposals");
  const good = Number(db.prepare("INSERT INTO agent_runs (workflow, symbol, status, output) VALUES ('filing_flash', 'NVDA', 'done', ?)").run(JSON.stringify({ headline: "Good", bottomLine: "b", points: [] })).lastInsertRowid);
  const bad = Number(db.prepare("INSERT INTO agent_runs (workflow, symbol, status, output) VALUES ('filing_flash', 'MU', 'done', ?)").run(JSON.stringify({ headline: "Bad", bottomLine: "b", points: [] })).lastInsertRowid);
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Critic', 'Analyst', '')").run().lastInsertRowid);
  db.prepare("INSERT INTO agent_feedback (runId, memberId, verdict) VALUES (?, ?, 'wrong')").run(bad, m);
  mockAppAndOpenAI({ "/portfolio/performance": {}, "/positions": [] });
  replies.push(msg(JSON.stringify({ title: "Week", summary: "Quiet week.", sections: [] }), undefined, "gpt-6-astra"));
  const r = await runs.run({ workflow: "weekly_memo" }, (ctx) => s.weeklyMemo({ payload: { since: "2000-01-01" } }, ctx));
  assert.equal(requests[0].model, "gpt-6-astra");
  assert.deepEqual(r.output.runIds, [good], "output members marked wrong is left out");
  const [p] = proposals.list();
  assert.equal(p.kind, "weekly_memo");
  await proposals.decide(p.id, { id: m, name: "Editor" }, true);
  assert.equal(JSON.parse(db.prepare("SELECT output FROM agent_runs WHERE id = ?").get(r.runId).output).approved, true);
});

// ---- API ----

test("API: agents overview is members-only and reports budget, events and runs; admins set the caps", async () => {
  global.fetch = realFetch;
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // the test server runs without AI
  const s = await startServer();
  process.env.OPENAI_API_KEY = key;
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
    assert.deepEqual((await s.api("/api/agents/briefs", { auth: true })).body, { briefs: [] });
    assert.equal((await s.api("/api/agents/runs/999/feedback", { method: "POST", auth: true, body: { verdict: "useful" } })).status, 404);
    assert.equal((await s.api("/api/agents/runs/1/feedback", { method: "POST", auth: true, body: { verdict: "meh" } })).status, 400);
    assert.deepEqual((await s.api("/api/agents/proposals", { auth: true })).body, { proposals: [] });
    assert.equal((await s.api("/api/agents/proposals/5/decide", { method: "POST", auth: true, body: { approve: true } })).status, 404);
    assert.equal((await s.api("/api/agents/brief", { method: "POST", auth: true, body: { symbol: "NVDA", accession: "x" } })).status, 503, "no OpenAI key on the test server");
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
