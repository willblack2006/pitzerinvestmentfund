// Shared memory and agents that understand each other (WS5): ranking, dedupe, expiry, write
// policy, supersede chains, contradictions, the blackboard (thesis handoff, ask_agent), memory in
// Ask PIF prompts, member preferences and the dossier writer. OpenAI is mocked.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-memory-")), "memory.db");
process.env.OPENAI_API_KEY = "test-key";
process.env.AGENT_BLACKBOARD_GRACE_MIN = "0";

const db = require("../db");
const memory = require("../lib/agents/memory");
const handoffs = require("../lib/agents/handoffs");
const proposals = require("../lib/agents/proposals");
const runs = require("../lib/agents/runs");
const tools = require("../lib/agents/tools");
const { ask } = require("../lib/agents/workflows/ask");
const dossier = require("../lib/agents/workflows/dossier");
const { setSettings } = require("../lib/settings");
require("../lib/agents/workflows"); // registers workflows, the memory proposal kind and subscribers

const realFetch = global.fetch;
let replies = [], requests = [];
const msg = (text) => ({ model: "gpt-6-luna", status: "completed", usage: { input_tokens: 400, output_tokens: 60 }, output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const call = (name, args, id = "c1") => ({ model: "gpt-6-luna", status: "completed", usage: { input_tokens: 300, output_tokens: 40 }, output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] });

test.beforeEach(() => {
  replies = []; requests = [];
  setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5 });
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) { requests.push(JSON.parse(opts.body)); const r = replies.shift(); if (!r) throw new Error("no scripted reply"); return new Response(JSON.stringify(r), { status: 200 }); }
    if (u.startsWith("http://app.test/api/research/")) return new Response(JSON.stringify({ symbol: "NVDA", price: 150 }), { status: 200 });
    return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
  };
});
test.afterEach(() => { global.fetch = realFetch; });

const member = (name, ai = 1) => Number(db.prepare("INSERT INTO members (name, role, pinHash, canUseAi) VALUES (?, 'Analyst', '', ?)").run(name, ai).lastInsertRowid);
const agentId = (wf) => db.prepare("SELECT id FROM agents WHERE workflow = ?").get(wf).id;
const status = (id) => db.prepare("SELECT status FROM agent_memory WHERE id = ?").get(id).status;
const inputText = (req) => JSON.stringify(req.input);

test("text helpers: dates, expiry, polarity", () => {
  const { autoExpiry, datesIn, polarity } = memory._internal;
  const ref = new Date("2026-11-19T12:00:00Z");
  assert.equal(datesIn("Earnings on Nov 20", ref)[0].toISOString().slice(0, 10), "2026-11-20");
  assert.equal(datesIn("reports Jan 5", new Date("2026-12-20T00:00:00Z"))[0].toISOString().slice(0, 10), "2027-01-05", "January named in December is next year");
  assert.equal(autoExpiry("NVDA reports earnings on 2026-11-20", "observation", ref), "2026-11-22 00:00:00");
  assert.equal(autoExpiry("Margins were 2026-11-20 something", "decision", ref), null, "decisions never expire on their own");
  assert.equal(autoExpiry("Gross margin expanded", "observation", ref), null, "no date, no expiry");
  assert.equal(polarity("Revenue grew 20%"), 1);
  assert.equal(polarity("Revenue declined 5%"), -1);
  assert.equal(polarity("Revenue did not grow"), -1);
});

test("write policy: agent facts and decisions are proposed, observations active, member writes active", async () => {
  const a = agentId("filing_flash");
  const m = member("Writer");
  const obs = memory.remember({ scope: "symbol", scopeKey: "AAPL", kind: "observation", text: "iPhone units fell in China", agentId: a, sourceRunId: null });
  const fact = memory.remember({ scope: "symbol", scopeKey: "AAPL", kind: "fact", text: "Services is about a quarter of revenue", agentId: a });
  const mine = memory.remember({ scope: "symbol", scopeKey: "AAPL", kind: "decision", text: "We trim AAPL above 8% weight", memberId: m });
  assert.equal(status(obs), "active");
  assert.equal(status(fact), "proposed");
  assert.equal(status(mine), "active");
  // The fact is in the approval queue; approving it makes it active and recallable.
  const p = proposals.list().find((x) => x.kind === "memory" && x.payload.memoryId === fact);
  assert.ok(p, "proposal filed");
  assert.equal(memory.recall({ symbol: "AAPL" }).some((r) => r.id === fact), false);
  await proposals.decide(p.id, { id: m, name: "Writer" }, true);
  assert.equal(status(fact), "active");
  assert.ok(memory.recall({ symbol: "AAPL" }).some((r) => r.id === fact));
});

test("dedupe: the same memory twice refreshes the first instead of adding a copy", () => {
  const a = memory.rememberDetailed({ scope: "symbol", scopeKey: "MSFT", kind: "observation", text: "Azure growth accelerated to 40% last quarter", sourceUrl: "u1" });
  const b = memory.rememberDetailed({ scope: "symbol", scopeKey: "msft", kind: "observation", text: "Azure growth accelerated to 40% last quarter.", sourceUrl: "u2", asOf: "2026-11-01" });
  assert.equal(b.id, a.id);
  assert.equal(b.duplicate, true);
  const row = db.prepare("SELECT * FROM agent_memory WHERE id = ?").get(a.id);
  assert.equal(row.sourceUrl, "u2");
  assert.equal(row.seenCount, 2);
  const c = memory.rememberDetailed({ scope: "symbol", scopeKey: "MSFT", kind: "observation", text: "Copilot seats doubled year over year" });
  assert.notEqual(c.id, a.id);
});

test("recall ranking: scope, query overlap, pins, expiry and member privacy", () => {
  const m1 = member("Pref1"), m2 = member("Pref2");
  const old = memory.remember({ scope: "symbol", scopeKey: "AMD", kind: "observation", text: "Data center GPU sales ramped strongly", memberId: m1 });
  db.prepare("UPDATE agent_memory SET createdAt = datetime('now', '-200 days') WHERE id = ?").run(old);
  const fresh = memory.remember({ scope: "symbol", scopeKey: "AMD", kind: "observation", text: "Client PC chips gained share", memberId: m1 });
  const fcf = memory.remember({ scope: "symbol", scopeKey: "AMD", kind: "observation", text: "Free cash flow conversion improved", memberId: m1 });
  memory.remember({ scope: "symbol", scopeKey: "AMD", kind: "observation", text: "Investor day on 2020-01-05", memberId: m1, expiresAt: "2020-01-07 00:00:00" });
  const pref = memory.remember({ scope: "member", scopeKey: m1, kind: "preference", text: "I care about FCF conversion", memberId: m1 });

  const plain = memory.recall({ symbol: "AMD" });
  assert.ok(plain.findIndex((r) => r.id === fresh) < plain.findIndex((r) => r.id === old), "newer beats older");
  assert.equal(plain.some((r) => /Investor day/.test(r.text)), false, "expired memories drop out");
  const q = memory.recall({ symbol: "AMD", query: "data center GPU" });
  assert.equal(q[0].id, old, "word overlap outranks recency");
  // A member's preference is only for that member.
  assert.ok(memory.recall({ symbol: "AMD", memberId: m1 }).some((r) => r.id === pref));
  assert.equal(memory.recall({ symbol: "AMD", memberId: m2 }).some((r) => r.id === pref), false);
  assert.equal(memory.list({ symbol: null, viewerId: m2, scope: "member" }).items.length, 0);
  // Pinning lifts a memory to the top.
  memory.pin(fcf, m1, true);
  assert.equal(memory.recall({ symbol: "AMD" })[0].id, fcf);
  // Tickers named in a query pull in their memories without passing a symbol.
  assert.ok(memory.recall({ query: "what do we know about AMD chips" }).some((r) => r.scopeKey === "AMD"));
});

test("supersede keeps a history; retract removes from recall", () => {
  const m = member("Editor");
  const a = memory.remember({ scope: "symbol", scopeKey: "TSLA", kind: "fact", text: "Deliveries were 400k last quarter", memberId: m });
  const b = memory.supersede(a, { text: "Deliveries were 420k last quarter", memberId: m });
  const c = memory.supersede(b, { text: "Deliveries were 425k last quarter (revised)", memberId: m });
  const h = memory.history(a);
  assert.deepEqual(h.map((x) => x.id), [c, b, a]);
  assert.deepEqual(h.map((x) => x.status), ["active", "superseded", "superseded"]);
  assert.throws(() => memory.supersede(a, { text: "x y z" }), /already superseded/);
  memory.retract(c, m, "wrong");
  assert.equal(memory.dossier("TSLA").facts.length, 0);
});

test("contradiction: an observation that points the other way from an active fact raises an open question", () => {
  const m = member("Contra");
  const f = memory.remember({ scope: "symbol", scopeKey: "NFLX", kind: "fact", text: "Netflix subscriber growth accelerated in Asia", memberId: m });
  const o = memory.remember({ scope: "symbol", scopeKey: "NFLX", kind: "observation", text: "Netflix subscriber growth in Asia slowed and declined", agentId: agentId("filing_flash") });
  const qs = memory.dossier("NFLX").openQuestions;
  assert.equal(qs.length, 1);
  assert.match(qs[0].text, new RegExp(`\\[m${o}\\].*\\[m${f}\\]`));
  // Unrelated observations don't trigger it.
  memory.remember({ scope: "symbol", scopeKey: "NFLX", kind: "observation", text: "Ad tier pricing fell", agentId: agentId("filing_flash") });
  assert.equal(memory.dossier("NFLX").openQuestions.length, 1);
});

test("promptBlock and forPrompt: ids, kinds, authors, a cap, and a 'memory' step for Why?", async () => {
  memory.remember({ scope: "symbol", scopeKey: "ORCL", kind: "observation", text: "RPO jumped on cloud contracts", memberId: member("P1") });
  await runs.run({ workflow: "macro_brief", symbol: "ORCL" }, async (ctx) => {
    const r = memory.forPrompt(ctx, { symbol: "ORCL", query: "cloud" });
    assert.match(r.block, /^<fund_memory note=/);
    assert.match(r.block, /\[m\d+\] observation · ORCL · \d{4}-\d\d-\d\d · by P1: RPO jumped/);
    assert.ok(r.rules.includes("cite its id"));
    assert.ok(ctx.steps.some((s) => s.kind === "memory" && s.ids.length === 1));
    assert.equal(memory.promptBlock(r.items, { maxChars: 10 }), "", "nothing that doesn't fit");
    return {};
  });
  assert.deepEqual(memory.citedIds("as noted [m3] and [m9], [m3]", [3]), [3]);
});

test("Ask PIF: memory in the prompt, cited ids in the output, and remember/forget commands", async () => {
  const m = member("Asker");
  const id = memory.remember({ scope: "symbol", scopeKey: "NVDA", kind: "observation", text: "Blackwell supply is the main constraint", memberId: member("Other") });
  // "remember ..." stores a preference without a model call.
  const r1 = await runs.run({ workflow: "ask_pif", memberId: m }, (ctx) => ask({ question: "Remember I care about FCF conversion." }, ctx));
  assert.equal(requests.length, 0);
  assert.match(r1.output.answer, /keep this in mind/);
  const pref = memory.get(r1.output.memoryId);
  assert.equal(pref.scope, "member");
  assert.equal(pref.kind, "preference");
  // A normal question gets the memory block (the ticker's memory and the preference).
  replies = [msg(JSON.stringify({ answer: `Supply is the constraint [m${id}].`, claims: [], followUps: [] }))];
  const r2 = await runs.run({ workflow: "ask_pif", memberId: m }, (ctx) => ask({ question: "What limits NVDA right now?" }, ctx));
  const sent = inputText(requests[0]);
  assert.ok(sent.includes("<fund_memory"));
  assert.ok(sent.includes("Blackwell supply"));
  assert.ok(sent.includes("I care about FCF conversion"));
  assert.deepEqual(r2.output.memoryUsed, [id]);
  assert.deepEqual(r2.output.unbackedNumbers, [], "memory ids aren't flagged as unbacked numbers");
  // Another member's question doesn't see the preference.
  replies = [msg(JSON.stringify({ answer: "Supply.", claims: [], followUps: [] }))];
  await runs.run({ workflow: "ask_pif", memberId: member("Third") }, (ctx) => ask({ question: "What limits NVDA right now?" }, ctx));
  assert.equal(inputText(requests[1]).includes("FCF conversion"), false);
  // "forget ..." retracts it.
  const r3 = await runs.run({ workflow: "ask_pif", memberId: m }, (ctx) => ask({ question: "forget that I care about FCF conversion" }, ctx));
  assert.match(r3.output.answer, /forgotten/);
  assert.equal(status(pref.id), "retracted");
});

test("blackboard: a thesis handoff becomes a THESIS_CHECK event and the message is done", async () => {
  const brief = Number(db.prepare("INSERT INTO agent_runs (workflow, symbol, status) VALUES ('filing_flash', 'KO', 'done')").run().lastInsertRowid);
  const id = handoffs.post({ fromRunId: brief, topic: "thesis", kind: "handoff", symbol: "KO", payload: { briefRunId: brief, title: "KO thesis check after 8-K" } });
  await new Promise((r) => setTimeout(r, 30));
  const m = handoffs.get(id);
  assert.equal(m.status, "done");
  assert.equal(m.fromAgentId, agentId("filing_flash"), "sender resolved from the run");
  const ev = db.prepare("SELECT * FROM agent_events WHERE dedupeKey = ?").get(`THESIS_CHECK:${brief}`);
  assert.ok(ev);
  assert.equal(JSON.parse(ev.payload).handoffId, id);
  assert.equal(handoffs.list({ topic: "thesis" })[0].from.name, db.prepare("SELECT name FROM agents WHERE id = ?").get(agentId("filing_flash")).name);
});

test("blackboard: an open request on a topic is answered by the research desk", async () => {
  replies = [msg(JSON.stringify({ answer: "Supply chain looks fine per filings.", sources: [], confidence: "medium" }))];
  const id = handoffs.request({ fromAgentId: agentId("macro_brief"), topic: "question", symbol: "NVDA", question: "Is the NVDA supply chain at risk?" });
  for (let i = 0; i < 50 && handoffs.get(id).status !== "done"; i++) await new Promise((r) => setTimeout(r, 20));
  const req = handoffs.get(id);
  assert.equal(req.status, "done");
  assert.match(req.answer, /Supply chain looks fine/);
  const ans = handoffs.list({ kind: "answer" }).find((x) => x.payload.requestId === id);
  assert.ok(ans);
  assert.equal(db.prepare("SELECT workflow FROM agent_runs WHERE id = ?").get(ans.fromRunId).workflow, "blackboard_answer");
});

test("ask_agent: a child run answers as the other agent, linked to the parent; depth is capped", async () => {
  const owner = member("Owner");
  const spec = { v: 1, steps: [{ id: "a1", type: "ai", tier: "cheap", instructions: "Watch semiconductor supply chains.", tools: ["get_research_overview"] }] };
  db.prepare("INSERT INTO agents (slug, name, description, kind, workflow, ownerId, visibility, spec) VALUES ('semis-watch', 'Semis watcher', 'Tracks chip supply', 'custom', 'engine', ?, 'team', ?)").run(owner, JSON.stringify(spec));
  db.prepare("INSERT INTO agents (slug, name, kind, workflow, ownerId, visibility, spec) VALUES ('secret-agent', 'Private one', 'custom', 'engine', ?, 'private', '{}')").run(owner);
  // Parent run: the model calls ask_agent, the child (scripted second) answers, the parent finishes.
  replies = [
    call("ask_agent", { agent: "semis-watch", question: "Any NVDA supply risk?", symbol: "NVDA" }),
    msg(JSON.stringify({ answer: "CoWoS capacity is tight.", sources: [], confidence: "high" })),
    msg(JSON.stringify({ answer: "The semis watcher says CoWoS capacity is tight.", claims: [], followUps: [] })),
  ];
  const parent = await runs.run({ workflow: "ask_pif", memberId: owner }, (ctx) => ask({ question: "Ask the semis agent about NVDA supply" }, ctx));
  const child = db.prepare("SELECT * FROM agent_runs WHERE parentRunId = ?").get(parent.runId);
  assert.ok(child);
  assert.equal(child.workflow, "ask_agent");
  assert.equal(child.agentId, db.prepare("SELECT id FROM agents WHERE slug = 'semis-watch'").get().id);
  assert.match(inputText(requests[1]), /Semis watcher.*Watch semiconductor supply chains/);
  const tl = requests[1].tools.map((t) => t.name).filter(Boolean);
  assert.equal(tl.includes("ask_agent"), false, "the child can't ask onward from its tool list");
  const m = handoffs.list({ kind: "request" }).find((x) => x.claimedByRunId === child.id);
  assert.equal(m.status, "done");
  assert.match(m.answer, /CoWoS/);
  // Depth and visibility limits.
  await assert.rejects(handoffs.askAgent({ agent: "semis-watch", question: "x y z" }, { depth: 2 }), /two levels|2 levels/);
  await assert.rejects(handoffs.askAgent({ agent: "secret-agent", question: "x y z" }, { memberId: member("Nosy") }), /No active team agent/);
  assert.ok(handoffs.askable(null).some((a) => a.slug === "semis-watch"));
  assert.equal(handoffs.askable(null).some((a) => a.slug === "secret-agent"), false);
});

test("get_memory tool returns ranked items with ids and sources", async () => {
  memory.remember({ scope: "symbol", scopeKey: "PLTR", kind: "observation", text: "Government revenue grew faster than commercial", sourceUrl: "https://www.sec.gov/x", memberId: member("T") });
  const r = await tools.callTool("get_memory", { symbol: "pltr", query: "government revenue", kinds: null });
  assert.equal(r.data.items[0].about, "PLTR");
  assert.match(r.data.items[0].id, /^m\d+$/);
  assert.equal(r.source_url, "#/agents/memory?symbol=PLTR");
});

test("dossier writer: summarises memory with checked ids, stores the card and its open questions", async () => {
  const m = member("Dos");
  const a = memory.remember({ scope: "symbol", scopeKey: "DUOL", kind: "observation", text: "Daily active users grew 40%", memberId: m });
  const b = memory.remember({ scope: "symbol", scopeKey: "DUOL", kind: "decision", text: "Hold through the next print", memberId: m });
  assert.ok(dossier.due().some((d) => d.symbol === "DUOL"));
  replies = [msg(JSON.stringify({ summary: "Users are growing fast and the fund is holding.", points: [{ text: "DAU +40%", memoryIds: [a, 99999] }, { text: "Holding", memoryIds: [b] }], openQuestions: ["Is monetisation keeping up?"] }))];
  const r = await dossier.refresh("DUOL");
  assert.deepEqual(r.output.points[0].memoryIds, [a], "made-up ids are dropped");
  const d = memory.dossier("DUOL");
  assert.equal(d.summary.text, "Users are growing fast and the fund is holding.");
  assert.equal(d.summary.stale, false);
  assert.equal(d.openQuestions[0].text, "Is monetisation keeping up?");
  assert.equal(dossier.due().some((x) => x.symbol === "DUOL"), false, "not due again until memory changes");
  assert.ok(inputText(requests[0]).includes("<fund_memory"));
});

test("flash hands off to the thesis check through the blackboard and writes an observation", async () => {
  const flash = require("../lib/agents/workflows/flash");
  const sec = require("../lib/sources/sec");
  const yahoo = require("../lib/sources/yahoo");
  sec.getFilingText = async () => "Revenue was $10 billion. Margins improved.";
  yahoo.getQuotes = async () => ({ HSY: { price: 180 } });
  db.prepare("INSERT OR IGNORE INTO positions (symbol, shares, lastPrice) VALUES ('HSY', 10, 180)").run();
  db.prepare("INSERT OR REPLACE INTO research_notes (symbol, thesis) VALUES ('HSY', 'Pricing power holds')").run();
  memory.remember({ scope: "symbol", scopeKey: "HSY", kind: "observation", text: "Cocoa costs squeezed margins last year", memberId: member("H") });
  replies = [msg(JSON.stringify({ headline: "Margins improved", bottomLine: "Margins improved on pricing.", tone: "positive", points: [{ text: "Margins up", quote: "Margins improved." }], kpis: [], questions: [] }))];
  const r = await runs.run({ workflow: "filing_flash", symbol: "HSY" }, (ctx) => flash.flash({ symbol: "HSY", type: "8-K", items: "8.01", asOf: "2026-11-18", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/x.htm", workflow: "filing_flash", tier: "digest" }, ctx));
  assert.ok(inputText(requests[0]).includes("Cocoa costs"), "memory in the flash prompt");
  await new Promise((res) => setTimeout(res, 30));
  assert.ok(db.prepare("SELECT 1 FROM agent_events WHERE dedupeKey = ?").get(`THESIS_CHECK:${r.runId}`));
  const msgRow = db.prepare("SELECT * FROM agent_messages WHERE fromRunId = ? AND topic = 'thesis'").get(r.runId);
  assert.equal(msgRow.status, "done");
  assert.ok(memory.dossier("HSY").observations.some((o) => o.sourceRunId === r.runId && /Margins improved/.test(o.text)));
});
