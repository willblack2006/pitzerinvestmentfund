// WS11: live runs (stream hub, OpenAI stream mode) and Ask PIF conversations. OpenAI is faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-stream-")), "stream.db");
process.env.OPENAI_API_KEY = "test-key";

const db = require("../db");
const openai = require("../lib/sources/openai");
const stream = require("../lib/agents/stream");
const runs = require("../lib/agents/runs");
const threads = require("../lib/agents/askThreads");
const tools = require("../lib/agents/tools");
const { setSettings } = require("../lib/settings");

const realFetch = global.fetch;
let replies = [], requests = [];
const final = (text, extra = {}) => ({ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 800, output_tokens: 90 }, output: [{ type: "message", content: [{ type: "output_text", text }] }], ...extra });
const call = (name, args, id = "c1") => ({ model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 500, output_tokens: 50 }, output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] });
const answerJson = (a, followUps = []) => JSON.stringify({ answer: a, claims: [], followUps });

// An event-stream body that sends `text` in small pieces, then the final response.
function sse(resp, { chunk = 7 } = {}) {
  const text = resp.output.filter((o) => o.type === "message").flatMap((o) => o.content).map((c) => c.text).join("");
  const events = [];
  for (let i = 0; i < text.length; i += chunk) events.push({ type: "response.output_text.delta", delta: text.slice(i, i + chunk) });
  events.push({ type: "response.completed", response: resp });
  const body = events.map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join("");
  // Split at odd places so events straddle network chunks.
  const parts = [];
  for (let i = 0; i < body.length; i += 53) parts.push(body.slice(i, i + 53));
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

test.beforeEach(() => {
  replies = []; requests = [];
  setSettings({ aiMonthlyCapUsd: 25, aiMemberDailyUsd: 5 });
  tools.setBaseUrl("http://app.test");
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) {
      const body = JSON.parse(opts.body);
      requests.push(body);
      const r = replies.shift();
      return body.stream ? sse(r) : new Response(JSON.stringify(r), { status: 200 });
    }
    if (u.startsWith("http://app.test/api/research/")) return new Response(JSON.stringify({ symbol: "NVDA", price: 150 }), { status: 200 });
    return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
  };
});
test.afterEach(() => { global.fetch = realFetch; });

const member = (name = "Asker", extra = {}) => {
  const id = Number(db.prepare("INSERT INTO members (name, role, pinHash, canUseAi) VALUES (?, 'Analyst', '', 1)").run(name).lastInsertRowid);
  return { id, name, isAdmin: false, canUseAi: true, ...extra };
};
const waitFor = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } throw new Error("timed out"); };

test("partialField decodes a JSON string field while it is still arriving", () => {
  assert.equal(stream.partialField('{"answer":"Hel', "answer"), "Hel");
  assert.equal(stream.partialField('{"answer":"a\\nb \\"q\\" \\u00e9', "answer"), 'a\nb "q" é');
  assert.equal(stream.partialField('{"answer":"cut \\', "answer"), "cut ", "a split escape waits for the rest");
  assert.equal(stream.partialField('{"answer":"cut \\u00', "answer"), "cut ");
  assert.equal(stream.partialField('{"claims":[]', "answer"), null);
  assert.equal(stream.partialField('{"answer":"done","claims":[]}', "answer"), "done");
});

test("respondStream returns what respondRaw would, and passes text deltas along", async () => {
  replies.push(final(answerJson("NVDA is up.")));
  const seen = [];
  const out = await openai.respondStream({ input: [{ role: "user", content: "hi" }], onText: (d) => seen.push(d) });
  assert.equal(requests[0].stream, true);
  assert.equal(out.text, answerJson("NVDA is up."));
  assert.equal(seen.join(""), out.text);
  assert.ok(seen.length > 2, "arrives in pieces");
  assert.deepEqual(out.usage, { input: 800, output: 90 });
  // A plain JSON reply (no event stream) is accepted too.
  global.fetch = async () => new Response(JSON.stringify(final("plain")), { status: 200, headers: { "content-type": "application/json" } });
  const out2 = await openai.respondStream({ input: [] });
  assert.equal(out2.text, "plain");
});

test("respondStream: a failed stream is an error, a 429 before any text is retried", async () => {
  let n = 0;
  global.fetch = async () => {
    n++;
    if (n === 1) return new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 });
    const body = `data: ${JSON.stringify({ type: "response.failed", response: { error: { message: "boom" } } })}\n\n`;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  await assert.rejects(openai.respondStream({ input: [] }, { sleep: async () => {} }), /boom/);
  assert.equal(n, 2);
});

test("a watched run streams steps and decoded answer text, then done; an unwatched run doesn't stream", async () => {
  const m = member();
  replies.push(call("get_research_overview", { symbol: "NVDA" }), final(answerJson("NVDA \"rose\" today.\nSecond line.")));
  const events = [];
  let unsub;
  const p = runs.run({ workflow: "ask_pif", memberId: m.id, onCreate: (id) => { unsub = stream.subscribe(id, (e) => events.push(e)); } }, (ctx) =>
    ctx.agent({ system: "s", user: "u", tools: ["get_research_overview"], schema: require("../lib/agents/workflows/ask").SCHEMA, schemaName: "ask_pif" }));
  const r = await p;
  unsub();
  assert.ok(requests.every((b) => b.stream === true), "streams every turn while someone watches");
  const kinds = events.map((e) => e.type);
  assert.ok(kinds.includes("step") && kinds.includes("turn") && kinds.includes("text"));
  assert.equal(kinds.at(-1), "done");
  const lastTurn = kinds.lastIndexOf("turn");
  const text = events.slice(lastTurn).filter((e) => e.type === "text").map((e) => e.delta).join("");
  assert.equal(text, "NVDA \"rose\" today.\nSecond line.", "the page gets plain words, not JSON");
  const toolStep = events.find((e) => e.type === "step" && e.step.kind === "tool");
  assert.equal(toolStep.step.name, "get_research_overview");
  assert.equal(events.at(-1).output.answer, undefined, "ctx.agent's raw output (json + text) is passed through");
  assert.ok(r.runId);

  requests = [];
  replies.push(final("no listener"));
  await runs.run({ workflow: "app", memberId: m.id }, (ctx) => ctx.ai({ system: "s", user: "u" }));
  assert.equal(requests[0].stream, undefined, "nobody watching: plain request");
});

test("a refused run reports the refusal on its stream", async () => {
  const m = member("Broke");
  setSettings({ aiMonthlyCapUsd: 0, aiMemberDailyUsd: 5 });
  const events = [];
  await assert.rejects(runs.run({ workflow: "ask_pif", memberId: m.id, onCreate: (id) => stream.subscribe(id, (e) => events.push(e)) }, async () => "x"));
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).status, "refused");
});

test("late subscriber gets the replay; stepView drops tool output and long args", () => {
  stream.publish(990001, { type: "step", step: { kind: "tool" } });
  stream.publish(990001, { type: "text", delta: "abc" });
  const got = [];
  stream.subscribe(990001, (e) => got.push(e.type))();
  assert.deepEqual(got, ["step", "text"]);
  const v = stream.stepView({ at: "t", kind: "tool", name: "x", args: { q: "y".repeat(500) }, data: { secret: 1 } });
  assert.equal(v.data, undefined);
  assert.ok(v.args.q.length < 130);
});

test("Ask conversations: start a thread, follow up with history, others can't post, share and continue as your own", async () => {
  const a = member("Ann"), b = member("Ben");
  replies.push(final(answerJson("MU guided revenue up.", ["And margins?"])));
  const t1 = await threads.createThread(a, { question: "What did MU guide?" });
  assert.ok(t1.runId && t1.thread.id);
  assert.equal(t1.thread.title, "What did MU guide?");
  await waitFor(() => db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(t1.runId).status === "done");

  replies.push(final(answerJson("Gross margin improved.")));
  const t2 = await threads.addTurn(a, t1.thread.id, { question: "And margins?" });
  await waitFor(() => db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(t2.runId).status === "done");
  const userMsg = requests.at(-1).input.find((i) => i.role === "user").content;
  assert.match(userMsg, /Earlier in this conversation/);
  assert.match(userMsg, /MU guided revenue up/);
  assert.match(userMsg, /Question: And margins\?/);

  const view = threads.threadView(threads.threadRow(t1.thread.id), a, { withTurns: true });
  assert.equal(view.messages.length, 2);
  assert.equal(view.messages[1].output.answer, "Gross margin improved.");

  assert.equal(threads.canSee(threads.threadRow(t1.thread.id), b), false, "private until shared");
  assert.equal(threads.listThreads(b, { scope: "team" }).length, 0);
  const shared = threads.share(a, t1.thread.id, true);
  assert.equal(shared.visibility, "team");
  assert.equal(threads.listThreads(b, { scope: "team" })[0].id, t1.thread.id);
  assert.equal(threads.canWatchRun(b, db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(t2.runId)), true);
  await assert.rejects(threads.addTurn(b, t1.thread.id, { question: "Mine now?" }), (e) => e.status === 403);

  replies.push(final(answerJson("Ben's follow-up.")));
  const fork = await threads.createThread(b, { question: "What about inventory?", forkOf: t1.thread.id });
  await waitFor(() => db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(fork.runId).status === "done");
  const fv = threads.threadView(threads.threadRow(fork.thread.id), b, { withTurns: true });
  assert.equal(fv.messages.length, 3, "the earlier turns come along");
  assert.equal(fv.forkedFrom, t1.thread.id);
  assert.match(requests.at(-1).input.find((i) => i.role === "user").content, /Gross margin improved/);

  threads.rename(a, t1.thread.id, "  MU guidance  ");
  assert.equal(threads.threadRow(t1.thread.id).title, "MU guidance");
  threads.archive(a, t1.thread.id);
  assert.equal(threads.listThreads(a).some((t) => t.id === t1.thread.id), false);
});

test("@agent: unknown agents are refused before any spend; a real one shapes the prompt", async () => {
  const a = member("Cat");
  await assert.rejects(threads.createThread(a, { question: "@nobody what's up?" }), (e) => e.code === "no_such_agent");
  assert.equal(requests.length, 0);
  assert.deepEqual(threads.parseMention("@Earnings-Watch, what changed?"), { slug: "earnings-watch", rest: "what changed?" });
  assert.equal(threads.parseMention("email a@b.com"), null);
  db.prepare("INSERT INTO agents (slug, name, kind, ownerId, visibility, spec) VALUES ('chip-watch', 'Chip watch', 'custom', ?, 'team', ?)")
    .run(a.id, JSON.stringify({ scope: { universe: "symbols", symbols: ["NVDA", "MU"] }, steps: [{ type: "ai", instructions: "Focus on memory pricing." }] }));
  db.prepare("INSERT INTO agents (slug, name, kind, ownerId, visibility) VALUES ('secret', 'Secret', 'custom', ?, 'private')").run(member("Other").id);
  assert.ok(threads.addressableAgents(a).some((x) => x.slug === "chip-watch"));
  assert.equal(threads.addressableAgents(a).some((x) => x.slug === "secret"), false);
  assert.equal(threads.personaFor("secret", a), null);
  replies.push(final(answerJson("DRAM prices rose.")));
  const t = await threads.createThread(a, { question: "@chip-watch how is memory pricing?" });
  await waitFor(() => db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(t.runId).status !== "running");
  assert.equal(db.prepare("SELECT error FROM agent_runs WHERE id = ?").get(t.runId).error, null);
  assert.equal(t.thread.agentSlug, "chip-watch");
  assert.equal(t.thread.title, "how is memory pricing?");
  const sys = requests.at(-1).input.find((i) => i.role === "system").content;
  assert.match(sys, /team agent "Chip watch"/);
  assert.match(sys, /Focus on memory pricing/);
  assert.match(sys, /NVDA, MU/);
  const row = db.prepare("SELECT output, agentId, \"trigger\" AS trig FROM agent_runs WHERE id = ?").get(t.runId);
  assert.equal(row.trig, "mention");
  assert.equal(row.agentId, db.prepare("SELECT id FROM agents WHERE slug = 'chip-watch'").get().id);
  const out = JSON.parse(row.output);
  assert.deepEqual(out.agent, { slug: "chip-watch", name: "Chip watch" });
});
