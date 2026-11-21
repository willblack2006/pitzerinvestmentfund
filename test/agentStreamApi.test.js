// WS11 routes through the real server: auth on the run stream and the Ask conversation API.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers");

let s;
test.before(async () => { delete process.env.OPENAI_API_KEY; s = await startServer(); });
test.after(async () => { await s.stop(); });

test("ask threads and run streams need AI access; unknown ids are 404", async () => {
  const plain = await s.createMember("Plain");
  assert.equal((await s.api("/api/ask/threads", { member: plain.cookie })).status, 403);
  assert.equal((await s.api("/api/agents/runs/1/stream")).status, 401);
  const list = await s.api("/api/ask/threads", { auth: true });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.threads, []);
  assert.equal((await s.api("/api/ask/threads/999", { auth: true })).status, 404);
  assert.equal((await s.api("/api/agents/runs/999/stream", { auth: true })).status, 404);
  const agents = await s.api("/api/ask/agents", { auth: true });
  assert.ok(agents.body.agents.length > 0, "built-in agents can be addressed");
  // No OpenAI key on this server: starting a conversation says so instead of failing later.
  assert.equal((await s.api("/api/ask/threads", { method: "POST", auth: true, body: { question: "What is NVDA's P/E?" } })).status, 503);
});

test("the stream of a finished run answers from the database and closes", async () => {
  const sqlite = require("libsql");
  const db = new sqlite(s.dbPath);
  await s.api("/api/ask/threads", { auth: true }); // admin exists
  const admin = db.prepare("SELECT id FROM members WHERE isAdmin = 1").get();
  const id = Number(db.prepare("INSERT INTO agent_runs (workflow, memberId, status, output) VALUES ('ask_pif', ?, 'done', ?)").run(admin.id, JSON.stringify({ kind: "ask_pif", answer: "Done." })).lastInsertRowid);
  db.close();
  const res = await fetch(`${s.base}/api/agents/runs/${id}/stream`, { headers: { Cookie: await s.ensureAdmin() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /event-stream/);
  assert.equal(res.headers.get("content-encoding"), null, "not compressed (compression would hold events back)");
  const text = await res.text();
  assert.match(text, /"type":"done"/);
  assert.match(text, /"answer":"Done."/);
});
