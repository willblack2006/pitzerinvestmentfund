// WS8: run traces, per-agent stats, fund AI spend, health alerts and feedback reasons.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-obs-")), "obs.db");
process.env.OPENAI_API_KEY = "test-key";

const express = require("express");
const db = require("../db");
const runs = require("../lib/agents/runs");
const tools = require("../lib/agents/tools");
const metrics = require("../lib/agents/metrics");
const health = require("../lib/agents/health");
const { setSettings } = require("../lib/settings");
const { createSession } = require("../middleware/auth");

// Built-in agents (WS1 seeds one per workflow) are keyed a<id>; otherwise w<workflow>.
const keyFor = (w) => { try { const a = db.prepare("SELECT id FROM agents WHERE workflow = ? AND kind = 'builtin'").get(w); if (a) return `a${a.id}`; } catch { /* no agents table */ } return `w${w}`; };
const iso = (d) => d.toISOString();
const sql = (d) => d.toISOString().replace("T", " ").slice(0, 19);

function insertRun({ workflow = "filing_flash", status = "done", costUsd = 0.01, createdAt, finishedAt, steps = [], memberId = null, model = "gpt-6.1-sol", output = null, error = null }) {
  return Number(db.prepare(`INSERT INTO agent_runs (workflow, status, costUsd, createdAt, finishedAt, steps, memberId, model, output, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(workflow, status, costUsd, createdAt, finishedAt, JSON.stringify(steps), memberId, model, output ? JSON.stringify(output) : null, error).lastInsertRowid);
}

test.beforeEach(() => {
  db.exec("DELETE FROM agent_feedback; DELETE FROM agent_runs; DELETE FROM notifications;");
  try { db.exec("DELETE FROM agent_health_alerts;"); } catch { /* created lazily */ }
  setSettings({ aiMonthlyCapUsd: 10, aiMemberDailyUsd: 5 });
});

test("trace: waterfall from steps with durations, tokens, cost and verification", () => {
  const t0 = new Date("2026-11-19T12:00:00Z");
  const at = (ms) => iso(new Date(t0.getTime() + ms));
  const steps = [
    { at: at(2000), kind: "model", ms: 1900, costUsd: 0.002, model: "gpt-6.1-sol", input: 1000, cached: 0, output: 50, toolCalls: ["get_quote", "get_filings"] },
    { at: at(2600), kind: "tool", name: "get_quote", args: { symbol: "NVDA" }, ok: true, ms: 500, preview: "{\"price\":180}" },
    { at: at(2700), kind: "tool", name: "get_filings", args: { symbol: "NVDA" }, ok: false, error: "SEC down", ms: 650 },
    { at: at(5000), kind: "model", model: "gpt-6.1-sol", input: 2000, cached: 1000, output: 300 }, // legacy: no ms/cost
    { at: at(5100), kind: "review", note: "Numbers not backed: 42%" },
    { at: at(5200), kind: "memory_read", label: "Recalled 3 notes", count: 3 },
  ];
  const id = insertRun({ createdAt: sql(t0), finishedAt: sql(new Date(t0.getTime() + 6000)), steps, costUsd: 0.01,
    output: { claims: [{ text: "a", quote: "x", verified: true, sourced: true }, { text: "b", quote: "y", verified: false, sourced: false }], unbackedNumbers: ["42%"] } });
  const tr = metrics.trace(runs.getRun(id));
  assert.equal(tr.spans.length, 6);
  const [m1, q, f, m2, rv, mem] = tr.spans;
  assert.equal(m1.start, 100); assert.equal(m1.ms, 1900); assert.equal(m1.costUsd, 0.002); assert.equal(m1.estimated, false);
  assert.equal(q.start, 2100); assert.equal(q.preview, "{\"price\":180}");
  assert.equal(f.ok, false); assert.equal(f.error, "SEC down");
  assert.equal(m2.estimated, true, "legacy model step duration is inferred");
  assert.equal(m2.ms, 2300, "since the previous step ended");
  assert.ok(Math.abs(m2.costUsd - (1000 * 2 + 1000 * 0.2 + 300 * 10) / 1e6) < 1e-9, "legacy cost priced from tokens");
  assert.equal(rv.label, "Self-check sent back");
  assert.equal(mem.label, "Recalled 3 notes"); assert.equal(mem.detail.count, 3);
  assert.equal(tr.totals.modelTurns, 2); assert.equal(tr.totals.toolErrors, 1); assert.equal(tr.totals.durationMs, 6000);
  assert.deepEqual(tr.totals.tokens, { input: 3000, cached: 1000, output: 350 });
  assert.equal(tr.verification.quotesChecked, 2); assert.equal(tr.verification.quotesVerified, 1);
  assert.equal(tr.verification.claimsSourced, 1); assert.equal(tr.verification.revised, true);
});

test("RunContext logs duration, cost and a tool preview on each step", async () => {
  const realFetch = global.fetch;
  tools.setBaseUrl("http://app.test");
  const replies = [
    { model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 400, output_tokens: 20 }, output: [{ type: "function_call", call_id: "c1", name: "get_holdings", arguments: "{}" }] },
    { model: "gpt-6.1-sol", status: "completed", usage: { input_tokens: 600, output_tokens: 40 }, output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }] },
  ];
  global.fetch = async (url) => String(url).startsWith("https://api.openai.com/") ? new Response(JSON.stringify(replies.shift()), { status: 200 })
    : new Response(JSON.stringify([{ symbol: "NVDA", price: 181.2 }]), { status: 200 });
  try {
    const out = await runs.run({ workflow: "test_trace" }, (ctx) => ctx.agent({ system: "s", user: "u", tools: ["get_holdings"], maxSteps: 3 }));
    const r = runs.getRun(out.runId);
    const model = r.steps.filter((s) => s.kind === "model");
    assert.equal(model.length, 2);
    assert.ok(model.every((s) => Number.isFinite(s.ms) && s.costUsd > 0));
    assert.ok(Math.abs(model[0].costUsd + model[1].costUsd - r.costUsd) < 1e-12, "step costs add up to the run");
    const tool = r.steps.find((s) => s.kind === "tool");
    assert.ok(Number.isFinite(tool.ms)); assert.match(tool.preview, /181\.2/);
  } finally { global.fetch = realFetch; }
});

test("stats: success rate, latency, cost quantiles, feedback reasons and failure streak", () => {
  const now = new Date();
  const ago = (min) => sql(new Date(now.getTime() - min * 60e3));
  insertRun({ status: "done", costUsd: 0.01, createdAt: ago(100), finishedAt: ago(99) });
  insertRun({ status: "done", costUsd: 0.03, createdAt: ago(90), finishedAt: ago(88) });
  const f1 = insertRun({ status: "failed", costUsd: 0.002, createdAt: ago(80), finishedAt: ago(80), error: "boom" });
  insertRun({ status: "failed", costUsd: 0, createdAt: ago(70), finishedAt: ago(70) });
  insertRun({ status: "failed", costUsd: 0, createdAt: ago(60), finishedAt: ago(60) });
  insertRun({ workflow: "macro_brief", status: "done", costUsd: 0.5, createdAt: ago(50), finishedAt: ago(49) });
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Stat Fan', 'Analyst', '')").run().lastInsertRowid);
  require("../lib/schema/observability").ensure(db);
  const first = db.prepare("SELECT id FROM agent_runs WHERE workflow = 'filing_flash' ORDER BY id LIMIT 1").get().id;
  db.prepare("INSERT INTO agent_feedback (runId, memberId, verdict, reasons) VALUES (?, ?, 'useful', 'great_catch')").run(first, m);
  db.prepare("INSERT INTO agent_feedback (runId, memberId, verdict, reasons) VALUES (?, ?, 'wrong', 'wrong_number')").run(f1, m);

  const s = metrics.agentStats("wfiling_flash", { days: 7, now });
  assert.equal(s.runs, 5); assert.equal(s.done, 2); assert.equal(s.failed, 3);
  assert.equal(s.successRate, 0.4);
  assert.equal(s.failureStreak, 3);
  assert.equal(s.latencyMs.median, 0);
  assert.equal(s.costUsd.max, 0.03);
  assert.equal(s.feedback.acceptance, 0.5);
  assert.deepEqual(s.feedback.reasons, { great_catch: 1, wrong_number: 1 });
  assert.equal(s.costPerUseful, 0.042);
  assert.equal(s.perDay.length, 8);

  const ov = metrics.agentsOverview({ days: 7, now });
  assert.deepEqual(ov.agents.filter((a) => a.runs).map((a) => a.key).sort(), [keyFor("filing_flash"), keyFor("macro_brief")].sort());
  assert.equal(metrics.agentStats(keyFor("filing_flash"), { days: 7, now }).runs, 5, "agent key counts its workflow's runs");
  assert.equal(metrics.agentStats("bad key!"), null);
});

test("spend: groups by agent, member and tier, projects month end and flags 80%", () => {
  const now = new Date(Date.UTC(2026, 10, 11, 12)); // Nov 11: 10.5 days in, 30 days in month
  const m = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Spender', 'Analyst', '')").run().lastInsertRowid);
  insertRun({ workflow: "ask_pif", memberId: m, costUsd: 4, model: runs.TIERS.mid(), createdAt: "2026-11-02 10:00:00", finishedAt: "2026-11-02 10:01:00" });
  insertRun({ workflow: "filing_flash", costUsd: 3.5, model: runs.TIERS.cheap(), createdAt: "2026-11-10 10:00:00", finishedAt: "2026-11-10 10:01:00" });
  insertRun({ workflow: "filing_flash", costUsd: 1, model: "gpt-unknown", createdAt: "2026-10-30 10:00:00", finishedAt: "2026-10-30 10:01:00" }); // last month
  const s = metrics.fundSpend({ now });
  assert.equal(s.month, "2026-11");
  assert.equal(s.spentUsd, 7.5); assert.equal(s.pct, 0.75);
  assert.equal(s.level, "pace", "under 80% but on pace to go over");
  assert.ok(s.projectedUsd > 10);
  assert.equal(s.byAgent[0].key, keyFor("ask_pif"));
  assert.equal(s.byMember.find((x) => x.key === m).name, "Spender");
  assert.deepEqual(s.byTier.map((t) => t.key).sort(), ["cheap", "mid"]);
  assert.equal(s.byDay.length, 11); assert.equal(s.byDay.at(-1).cumulativeUsd, 7.5);
  assert.equal(s.top[0].costUsd, 4);
  setSettings({ aiMonthlyCapUsd: 9 });
  assert.equal(metrics.fundSpend({ now }).level, "warn");
});

test("health: failure streak and fund budget alert once, to admins, with an inbox notification", () => {
  const now = new Date();
  const ago = (min) => sql(new Date(now.getTime() - min * 60e3));
  const admin = Number(db.prepare("INSERT INTO members (name, role, pinHash, isAdmin, passwordHash) VALUES ('Health Admin', 'Admin', '', 1, 'x')").run().lastInsertRowid);
  for (let i = 0; i < 3; i++) insertRun({ workflow: "weekly_memo", status: "failed", costUsd: 0, createdAt: ago(30 - i), finishedAt: ago(30 - i) });
  insertRun({ workflow: "ask_pif", status: "done", costUsd: 8.5, createdAt: ago(10), finishedAt: ago(10) });
  const kinds = health.findProblems({ now }).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ["failure_streak", "fund_budget"]);
  const fresh = health.check({ now });
  assert.equal(fresh.length, 2);
  assert.equal(health.check({ now }).length, 0, "deduped");
  const notes = db.prepare("SELECT type, title, link FROM notifications WHERE memberId = ?").all(admin);
  assert.equal(notes.length, 2);
  assert.ok(notes.every((n) => n.type === "agentHealth"));
  assert.ok(notes.some((n) => n.link === "#/ai-spend"));
  assert.ok(notes.some((n) => n.link === `#/agents/stats/${keyFor("weekly_memo")}`));
});

test("routes: trace visibility, stats, admin-only spend, feedback reasons", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", require("../routes/agentMetrics"));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const mk = (name, extra = "") => Number(db.prepare(`INSERT INTO members (name, role, pinHash, email, passwordHash, canUseAi${extra ? ", isAdmin" : ""}) VALUES (?, 'Analyst', '', ?, 'x', 1${extra ? ", 1" : ""})`).run(name, `${name.replace(/\W/g, "")}@t.edu`).lastInsertRowid);
  const a = mk("Route A"), b = mk("Route B"), admin = mk("Route Admin", "admin");
  const cookie = (id) => `pif_session=${createSession(id)}`;
  const call = async (p, id, opts = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { cookie: cookie(id), "content-type": "application/json", "x-pif-app": "1" } });
    return { status: r.status, body: await r.json() };
  };
  try {
    const now = sql(new Date());
    const mine = insertRun({ workflow: "ask_pif", memberId: a, createdAt: now, finishedAt: now, steps: [{ at: new Date().toISOString(), kind: "model", model: "gpt-6.1-sol", input: 10, output: 5 }] });
    assert.equal((await call(`/api/agents/runs/${mine}/trace`, a)).status, 200);
    assert.equal((await call(`/api/agents/runs/${mine}/trace`, b)).status, 404, "another member's question is private");
    assert.equal((await call(`/api/agents/runs/${mine}/trace`, admin)).status, 200);
    const tr = (await call(`/api/agents/runs/${mine}/trace`, a)).body;
    assert.equal(tr.spans.length, 1); assert.equal(tr.member.name, "Route A");

    assert.equal((await call("/api/admin/ai-spend", a)).status, 403);
    assert.equal((await call("/api/admin/ai-spend", admin)).status, 200);
    assert.equal((await call("/api/agents/stats", b)).body.agents[0].key, keyFor("ask_pif"));
    assert.equal((await call(`/api/agents/stats/${keyFor("ask_pif")}`, b)).body.recent.length, 0, "others don't see the private run list");

    const rs = await call(`/api/agents/runs/${mine}/reasons`, a, { method: "POST", body: JSON.stringify({ reasons: ["wrong_number", "bogus"] }) });
    assert.deepEqual(rs.body, { verdict: "wrong", reasons: ["wrong_number"] });
    const tr2 = (await call(`/api/agents/runs/${mine}/trace`, a)).body;
    assert.equal(tr2.feedback.mine, "wrong"); assert.deepEqual(tr2.feedback.myReasons, ["wrong_number"]);
    assert.equal((await call(`/api/agents/runs/${mine}/reasons`, b, { method: "POST", body: JSON.stringify({ reasons: ["great_catch"] }) })).status, 404);
  } finally { server.close(); }
});
