// Agent output quality: tool results the model can read, numbers checks without false flags,
// near-miss quote repair, the filing source budget, OpenAI retries, cut-off answers and retried
// events. OpenAI and the app's endpoints are mocked; nothing here calls a real model.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-agentq-")), "agentq.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const verify = require("../lib/agents/verify");
const tools = require("../lib/agents/tools");
const runs = require("../lib/agents/runs");
const agents = require("../lib/agents");
const openai = require("../lib/sources/openai");
const { fitParts } = require("../lib/agents/workflows/flash");
const { setSettings } = require("../lib/settings");

const realFetch = global.fetch;
test.beforeEach(() => { db.exec("DELETE FROM agent_runs; DELETE FROM agent_events;"); setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 0.5 }); });
test.afterEach(() => { global.fetch = realFetch; });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const msg = (text, extra = {}) => ({ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 100, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text }] }], ...extra });

// ---- numbers check: no false flags on labels, rules, dates ----

test("verify: rule numbers, index names, dates and times are not read as amounts", () => {
  const text = "Executives sold under Rule 10b5-1 plans; 10b5-1 sales aren't a signal. The S&P 500 rose on Nov 17 at 4:30 PM. Item 2.02 of the 8-K. Revenue was $4.2 billion, up 12.5%. It's the 1st time.";
  assert.deepEqual(verify.extractNumbers(text).map((n) => n.raw), ["$4.2 billion", "12.5%"]);
  assert.deepEqual(verify.unbackedNumbers(text, [{ revenue: 4.2e9, growth: 0.125 }]), []);
});

// ---- quote repair ----

test("verify: a near-verbatim quote is replaced by the exact source sentence; a wrong number is not", () => {
  const src = "Total revenue for the third quarter was $4.2 billion, an increase of 12% compared with the prior-year period. The Company repurchased 3.1 million shares.";
  const [good, wrongNumber, invented] = verify.verifyAndRepairQuotes([
    { quote: "Revenue for the third quarter was $4.2 billion, up 12% compared with the prior year period", source: "f" },
    { quote: "Revenue for the third quarter was $4.5 billion, an increase of 12% compared with the prior-year period", source: "f" },
    { quote: "Management expects margins to expand meaningfully next year", source: "f" },
  ], { f: src });
  assert.equal(good.verified, true);
  assert.equal(good.repaired, true);
  assert.equal(good.quote, "Total revenue for the third quarter was $4.2 billion, an increase of 12% compared with the prior-year period.");
  assert.match(good.modelQuote, /^Revenue for the third/);
  assert.equal(wrongNumber.verified, false, "a quote with a number the source doesn't have stays unverified");
  assert.equal(invented.verified, false);
  assert.equal(verify.verifyAndRepairQuotes([{ quote: "The Company repurchased 3.1 million shares.", source: "f" }], { f: src })[0].repaired, undefined, "exact quotes are untouched");
});

// ---- tool results ----

test("tools: results are compacted (Yahoo raw/fmt, empties, long floats) and fitted without cutting JSON", () => {
  assert.deepEqual(tools.compact({ pe: { raw: 15.0877285, fmt: "15.09" }, empty: {}, none: null, s: "", list: [0.5357837470620785, 7], big: 182527000000 }),
    { pe: 15.088, list: [0.53578, 7], big: 182527000000 });
  const huge = { thesis: "keep me", rows: Array.from({ length: 2000 }, (_, i) => ({ date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`, v: i })) };
  const text = tools.truncate(huge, 4000);
  const parsed = JSON.parse(text);
  assert.equal(parsed.thesis, "keep me", "fields outside the long array survive");
  assert.ok(text.length <= 4000);
  assert.ok(parsed.rows.some((r) => r._leftOut), "says rows were left out");
});

test("tools: research overview puts thesis, fundamentals and red flags in a small result", async () => {
  const overview = {
    symbol: "GOOGL", name: "Alphabet", quote: { price: 290 }, thesis: { thesis: "Search moat plus cloud", targetPrice: 350 },
    stats: { summaryDetail: { trailingPE: { raw: 15.08, fmt: "15.08" }, junk: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, { raw: i, fmt: String(i) }])) } },
    street: { targets: { mean: 400 }, estimates: [{ period: "0q", epsAvg: 3.2 }] },
    analysis: { annual: [{ end: "2025-12-31", revenue: 402836000000 }], piotroski: { score: 7, outOf: 9 } },
    redFlags: { serious: 0 }, chart: Array.from({ length: 500 }, (_, i) => ({ date: i, close: i })), financials: { revenue: Array(500).fill({ val: 1 }) },
  };
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url) => (String(url).endsWith("/api/research/GOOGL") ? json(overview) : json({ error: "nope" }, 404));
  const r = await tools.callTool("get_research_overview", { symbol: "GOOGL" });
  assert.equal(r.data.thesis.thesis, "Search moat plus cloud");
  assert.equal(r.data.fundamentals.latestFiscalYear.revenue, 402836000000);
  assert.equal(r.data.keyStats.trailingPE, 15.08);
  assert.equal(r.data.chart, undefined);
  assert.ok(JSON.stringify(r.data).length < 3000);
});

// ---- filing source budget ----

test("flash: a long section can't crowd out the others", () => {
  const out = fitParts([{ label: "MD&A", body: "a".repeat(30000) }, { label: "Risk Factors", body: "b".repeat(150000) }, { label: "Legal", body: "c".repeat(5000) }], 120000);
  assert.equal(out[0].body.length, 30000); assert.equal(out[0].cut, false);
  assert.equal(out[2].body.length, 5000);
  assert.equal(out[1].cut, true);
  assert.ok(out.reduce((a, p) => a + p.body.length, 0) <= 120200);
});

// ---- OpenAI retries ----

test("openai: retries 5xx and rate limits with backoff, not bad requests or exhausted quota", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return calls < 3 ? json({ error: { message: "overloaded" } }, calls === 1 ? 503 : 429) : json(msg("ok")); };
  const ok = await openai.postResponses({ model: "x" }, { sleep: async () => {} });
  assert.equal(ok.output[0].content[0].text, "ok"); assert.equal(calls, 3);

  calls = 0;
  global.fetch = async () => { calls++; return json({ error: { message: "bad schema" } }, 400); };
  await assert.rejects(openai.postResponses({}, { sleep: async () => {} }), /400/); assert.equal(calls, 1);

  calls = 0;
  global.fetch = async () => { calls++; return json({ error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, 429); };
  await assert.rejects(openai.postResponses({}, { sleep: async () => {} }), /quota/); assert.equal(calls, 1);

  calls = 0;
  global.fetch = async () => { calls++; throw new TypeError("fetch failed"); };
  await assert.rejects(openai.postResponses({}, { sleep: async () => {} }), /fetch failed/); assert.equal(calls, 4);
});

// ---- cut-off answers ----

test("runs: an answer cut off by the token ceiling is retried once with more room", async () => {
  const bodies = [];
  const replies = [{ ...msg(""), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, msg('{"a":1}')];
  global.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return json(replies.shift()); };
  const r = await runs.run({ workflow: "t" }, (ctx) => ctx.ai({ system: "s", user: "u", schema: { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "integer" } } } }));
  assert.deepEqual(r.output.json, { a: 1 });
  assert.equal(bodies[1].max_output_tokens, bodies[0].max_output_tokens * 2);
  assert.ok(bodies[0].max_output_tokens >= 16000, "room for reasoning tokens by default");
});

test("runs: the last step takes tools away and tells the model to answer", async () => {
  const bodies = [];
  const toolCall = { model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 10, output_tokens: 1 }, output: [{ type: "function_call", call_id: "c", name: "get_holdings", arguments: "{}" }] };
  const replies = [toolCall, msg("done")];
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url, opts) => (String(url).startsWith("https://api.openai.com/") ? (bodies.push(JSON.parse(opts.body)), json(replies.shift())) : json([]));
  const r = await runs.run({ workflow: "t" }, (ctx) => ctx.agent({ system: "s", user: "u", tools: ["get_holdings"], maxSteps: 2 }));
  assert.equal(r.output.text, "done");
  assert.equal(bodies[1].tools, undefined);
  assert.match(JSON.stringify(bodies[1].input.at(-1)), /used your tool budget/);
});

// ---- failed events are retried ----

test("dispatch: a failed event is retried after a wait, up to 3 runs", async () => {
  let attempts = 0;
  agents.register("flaky_test", async () => { attempts++; throw new Error("SEC said 429"); });
  const today = new Date().toISOString().slice(0, 10);
  const id = agents.recordEvent({ dedupeKey: "flaky:1", type: "X", asOf: today });
  db.prepare("UPDATE agent_events SET status = 'routed', workflow = 'flaky_test', tier = 'inbox' WHERE id = ?").run(id);
  await agents.dispatch();
  assert.equal(attempts, 1);
  await agents.dispatch();
  assert.equal(attempts, 1, "not retried right away");
  const later = new Date(Date.now() + 25 * 60000);
  await agents.dispatch({ now: later });
  assert.equal(attempts, 2);
  db.prepare("UPDATE agent_runs SET finishedAt = datetime('now', '-1 hour') WHERE eventId = ?").run(id);
  await agents.dispatch({ now: later });
  assert.equal(attempts, 3);
  db.prepare("UPDATE agent_runs SET finishedAt = datetime('now', '-1 hour') WHERE eventId = ?").run(id);
  await agents.dispatch({ now: later });
  assert.equal(attempts, 3, "gives up after 3 runs");
  assert.equal(db.prepare("SELECT status FROM agent_events WHERE id = ?").get(id).status, "failed");
});

// ---- alert volume: what goes out alone, what waits for the digest ----

test("digest: only big filings, big-holding or negative earnings alert alone", () => {
  const { alertFor } = require("../lib/agents/digest");
  db.exec("DELETE FROM positions");
  db.prepare("INSERT INTO positions (symbol, shares, marketValue) VALUES ('BIG', 1, 970), ('SMALL', 1, 30)").run();
  assert.equal(alertFor({ tier: "push", workflow: "filing_flash", symbol: "SMALL" }), "important filing");
  assert.match(alertFor({ tier: "inbox", workflow: "earnings_flash", symbol: "BIG", tone: "positive" }), /97% holding/);
  assert.equal(alertFor({ tier: "inbox", workflow: "earnings_flash", symbol: "SMALL", tone: "positive" }), null);
  assert.equal(alertFor({ tier: "inbox", workflow: "earnings_flash", symbol: "SMALL", tone: "negative" }), "negative earnings");
  assert.equal(alertFor({ tier: "inbox", workflow: "filing_flash", symbol: "BIG", tone: "negative" }), null, "a 10-Q or officer change waits for the digest");
});

test("digest: one notification per weekday evening listing what wasn't sent alone", () => {
  const digest = require("../lib/agents/digest");
  db.exec("DELETE FROM notifications; DELETE FROM members;");
  const ai = Number(db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, canUseAi) VALUES ('AI', 'Analyst', '', 'ai@t.edu', 'x', 1)").run().lastInsertRowid);
  db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash) VALUES ('Plain', 'Analyst', '', 'p@t.edu', 'x')").run();
  const add = (workflow, symbol, output) => db.prepare("INSERT INTO agent_runs (workflow, symbol, status, output) VALUES (?, ?, 'done', ?)").run(workflow, symbol, JSON.stringify(output));
  add("filing_flash", "MU", { form: "10-Q", headline: "Margins widen" });
  add("earnings_flash", "BIG", { headline: "Beat", alerted: "earnings on a 90% holding" });
  add("earnings_preview", "TJX", { reportDate: "2026-11-20" });
  add("thesis_check", "MU", { status: "intact" });
  add("macro_brief", null, { title: "Rates fall again" });
  add("ask_pif", null, { answer: "private question" });
  const wed = (h) => new Date(Date.UTC(2026, 10, 18, h, 30));
  assert.equal(digest.maybeSend({ now: wed(15) }), null, "not before the evening");
  assert.equal(digest.maybeSend({ now: new Date(Date.UTC(2026, 10, 21, 23)) }), null, "not on Saturday");
  assert.deepEqual(digest.maybeSend({ now: wed(22) }), { sent: 1, items: 3 });
  assert.equal(digest.maybeSend({ now: wed(23) }), null, "once a day");
  const n = db.prepare("SELECT * FROM notifications").all();
  assert.equal(n.length, 1); assert.equal(n[0].memberId, ai); assert.equal(n[0].type, "agentDigest");
  assert.equal(n[0].title, "Research digest: 3 new items");
  assert.match(n[0].body, /MU 10-Q: Margins widen/); assert.match(n[0].body, /TJX reports 2026-11-20/); assert.match(n[0].body, /Rates fall again/);
  assert.doesNotMatch(n[0].body, /Beat|intact|private/, "alerted items, intact thesis checks and Ask PIF stay out");
});

test("notify: replaceToday folds a burst into one unread notification; muting 13F sticks", () => {
  const { notify } = require("../lib/notify");
  const prefs = require("../lib/prefs");
  db.exec("DELETE FROM notifications; DELETE FROM members;");
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash) VALUES ('M', 'Analyst', '', 'm@t.edu', 'x')").run().lastInsertRowid);
  notify([m], { type: "thirteenF", title: "13F filed: A" }, { replaceToday: true });
  notify([m], { type: "thirteenF", title: "13F filings today from 2 managers" }, { replaceToday: true });
  assert.deepEqual(db.prepare("SELECT title FROM notifications").all().map((r) => r.title), ["13F filings today from 2 managers"]);
  prefs.setPrefs(m, { notifyOff: ["thirteenF", "agentDigest"] });
  assert.deepEqual(prefs.getPrefs(m).notifyOff, ["thirteenF", "agentDigest"]);
  notify([m], { type: "thirteenF", title: "another" }, { replaceToday: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1, "muted type isn't delivered");
});

test("digest: weekly reports alone don't send one; they ride along with the next", () => {
  const digest = require("../lib/agents/digest");
  db.exec("DELETE FROM notifications; DELETE FROM members; DELETE FROM agent_events;");
  db.prepare("INSERT INTO members (name, role, pinHash, email, passwordHash, isAdmin) VALUES ('A', 'Admin', '', 'a@t.edu', 'x', 1)").run();
  db.prepare("INSERT INTO agent_runs (workflow, status, output) VALUES ('macro_brief', 'done', ?)").run(JSON.stringify({ title: "Rates fall" }));
  assert.deepEqual(digest.maybeSend({ now: new Date(Date.UTC(2026, 10, 16, 22, 30)) }), { sent: 0 });
  db.prepare("INSERT INTO agent_runs (workflow, symbol, status, output) VALUES ('filing_flash', 'MU', 'done', ?)").run(JSON.stringify({ form: "8-K", headline: "CFO leaves" }));
  assert.deepEqual(digest.maybeSend({ now: new Date(Date.UTC(2026, 10, 17, 22, 30)) }), { sent: 1, items: 2 });
});
