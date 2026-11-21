// Golden-case evals for agents (plan WS8). A case file in eval/agents/<agent>.json holds fixed
// inputs (the event, plus recorded tool and HTTP responses) and expectations for one agent. The
// runner replays a case through the real workflow with every outside call answered from the
// fixtures, so only the model varies. Modes:
//   live: the real OpenAI API (costs money; what the nightly job and `npm run eval:agents` do)
//   fake: scripted model replies from the case (`fakeModel`), fully offline, for tests and CI
// Scoring is a pure function, unit-tested offline.
//
// Case file shape:
// { "agent": "filing_flash", "workflow": "filing_flash", "description": "...",
//   "cases": [{ "id": "exec-departure",
//     "event": { "symbol": "NVDA", "type": "8-K", "items": "5.02", "sourceUrl": "https://...", "asOf": "2026-11-01", "tier": "inbox" },
//     "tools": { "get_research_overview": { "data": {...}, "source_url": "#/research/NVDA" } },   // by tool name
//     "http": [{ "match": "sec.gov/Archives/...htm", "body": "<html>...", "status": 200 }],       // substring of the URL
//     "fakeModel": [{ "json": {...} } | { "text": "..." } | { "call": "tool_name", "args": {...} }],
//     "expect": { "status": "done", "fields": ["headline"], "match": { "headline": "(?i)resign" },
//                 "notMatch": { "bottomLine": "buy" }, "maxCostUsd": 0.05, "maxModelTurns": 3,
//                 "toolsUsed": ["get_research_overview"], "minVerifiedShare": 0.6, "maxUnbacked": 0 } }] }
const fs = require("node:fs");
const path = require("node:path");

const CASE_DIR = path.join(__dirname, "..", "..", "eval", "agents");

function loadCaseFiles(dir = CASE_DIR, only = null) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const file = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { ...file, file: f, agent: file.agent || f.replace(/\.json$/, "") };
  }).filter((f) => !only || only.includes(f.agent));
}

// Problems with a case file that would make a run meaningless. Empty array = fine.
function lint(file, registered = []) {
  const out = [];
  const wf = file.workflow || file.agent;
  if (registered.length && !registered.includes(wf) && wf !== "ask_pif_eval") out.push(`${file.file}: workflow ${wf} is not registered`);
  if (!Array.isArray(file.cases) || !file.cases.length) out.push(`${file.file}: no cases`);
  const ids = new Set();
  for (const c of file.cases || []) {
    if (!c.id) out.push(`${file.file}: a case has no id`);
    if (ids.has(c.id)) out.push(`${file.file}: duplicate case id ${c.id}`);
    ids.add(c.id);
    if (!c.event || typeof c.event !== "object") out.push(`${file.file}#${c.id}: no event`);
    if (!c.expect || typeof c.expect !== "object") out.push(`${file.file}#${c.id}: no expect`);
    for (const re of Object.values({ ...(c.expect?.match || {}), ...(c.expect?.notMatch || {}) })) {
      try { toRegex(re); } catch { out.push(`${file.file}#${c.id}: bad regex ${re}`); }
    }
  }
  return out;
}

// "(?i)text" is the case-insensitive form (JSON has no regex flags).
function toRegex(s) {
  const str = String(s);
  return str.startsWith("(?i)") ? new RegExp(str.slice(4), "i") : new RegExp(str);
}

const get = (obj, p) => String(p).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const filled = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);
const asText = (v) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

// Scores one finished (or failed) run against its case's expectations.
function score(c, { status, output, error, steps = [], costUsd = 0 }) {
  const e = c.expect || {};
  const checks = {};
  const notes = [];
  checks.status = (e.status || "done") === status;
  if (!checks.status) notes.push(`status ${status}${error ? `: ${error}` : ""}`);
  if (e.fields) { const miss = e.fields.filter((f) => !filled(get(output, f))); checks.fields = !miss.length; if (miss.length) notes.push(`missing ${miss.join(", ")}`); }
  if (e.match) { const miss = Object.entries(e.match).filter(([p, re]) => !toRegex(re).test(asText(get(output, p)))); checks.match = !miss.length; if (miss.length) notes.push(`no match: ${miss.map(([p]) => p).join(", ")}`); }
  if (e.notMatch) { const hit = Object.entries(e.notMatch).filter(([p, re]) => toRegex(re).test(asText(get(output, p)))); checks.notMatch = !hit.length; if (hit.length) notes.push(`unwanted text in ${hit.map(([p]) => p).join(", ")}`); }
  if (e.maxCostUsd != null) { checks.cost = costUsd <= e.maxCostUsd; if (!checks.cost) notes.push(`cost $${costUsd.toFixed(4)} > $${e.maxCostUsd}`); }
  const turns = steps.filter((s) => s.kind === "model").length;
  if (e.maxModelTurns != null) { checks.turns = turns <= e.maxModelTurns; if (!checks.turns) notes.push(`${turns} model turns`); }
  if (e.toolsUsed) { const used = new Set(steps.filter((s) => s.kind === "tool").map((s) => s.name)); const miss = e.toolsUsed.filter((t) => !used.has(t)); checks.tools = !miss.length; if (miss.length) notes.push(`tools not used: ${miss.join(", ")}`); }
  if (e.minVerifiedShare != null) { const v = output?.verifiedShare; checks.verified = v != null && v >= e.minVerifiedShare; if (!checks.verified) notes.push(`verified share ${v ?? "none"}`); }
  if (e.maxUnbacked != null) { const n = (output?.unbackedNumbers || []).length; checks.numbers = n <= e.maxUnbacked; if (!checks.numbers) notes.push(`${n} unbacked numbers`); }
  return { id: c.id, pass: Object.values(checks).every(Boolean), checks, notes, costUsd, modelTurns: turns };
}

// ---- running a case ----

function fakeReply(r, i) {
  const usage = { input_tokens: 1200, output_tokens: 150, ...(r.usage || {}) };
  const model = r.model || "gpt-6.1-sol";
  if (r.call) return { model, status: "completed", usage, output: [{ type: "function_call", call_id: `fake${i}`, name: r.call, arguments: JSON.stringify(r.args || {}) }] };
  const text = r.json !== undefined ? JSON.stringify(r.json) : String(r.text ?? "");
  return { model, status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text }] }] };
}

// Runs one case. `fetchImpl` is the real fetch (live mode passes OpenAI calls through to it).
async function runCase(file, c, { mode = "live", fetchImpl = global.fetch } = {}) {
  const runs = require("./runs");
  const agents = require("./index");
  require("./workflows");
  const workflow = file.workflow || file.agent;
  // Ask PIF isn't an event workflow; the eval calls it with event.question.
  const fn = workflow === "ask_pif_eval"
    ? (e, ctx) => require("./workflows/ask").ask({ question: e.question }, ctx)
    : agents.workflows[workflow];
  if (!fn) return { ...score(c, { status: "failed", error: `No workflow ${workflow}` }), error: `No workflow ${workflow}` };

  const fakes = (c.fakeModel || []).map(fakeReply);
  const http = c.http || [];
  const realFetch = global.fetch;
  const realTool = runs.RunContext.prototype.tool;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/")) {
      if (mode === "live") return fetchImpl(url, opts);
      const next = fakes.shift();
      if (!next) return new Response(JSON.stringify({ error: { message: "eval: no scripted model reply left" } }), { status: 500 });
      return new Response(JSON.stringify(next), { status: 200 });
    }
    const hit = http.find((h) => u.includes(h.match));
    if (hit) return new Response(typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body), { status: hit.status || 200, headers: { "content-type": typeof hit.body === "string" ? "text/html" : "application/json" } });
    return new Response(JSON.stringify({ error: `eval: no fixture for ${u}` }), { status: 404 });
  };
  runs.RunContext.prototype.tool = async function tool(name, args) {
    const fx = c.tools?.[name];
    if (fx === undefined) return realTool.call(this, name, args);
    const r = Array.isArray(fx) ? (fx.find((x) => JSON.stringify(x.args || {}) === JSON.stringify(args || {})) || fx[0]) : fx;
    this.step("tool", { name, args, ok: !r.error, error: r.error, source_url: r.source_url || null, ms: 0, preview: r.error ? undefined : JSON.stringify(r.data).slice(0, 600), fixture: true });
    if (!r.error) { this.toolResults.push(r.data); if (r.fullText) this.sourceTexts[r.source_url] = r.fullText; }
    return r;
  };
  const event = { id: null, tier: "inbox", workflow, payload: {}, ...c.event };
  let res = { status: "done", output: null, error: null, runId: null, costUsd: 0 };
  try {
    const out = await runs.run({ workflow, symbol: event.symbol || null }, (ctx) => fn(event, ctx));
    res = { status: "done", output: out.output, runId: out.runId, costUsd: out.costUsd, error: null };
  } catch (err) {
    res = { status: "failed", output: null, runId: err.runId || null, costUsd: 0, error: err.message };
  } finally {
    global.fetch = realFetch;
    runs.RunContext.prototype.tool = realTool;
  }
  const run = res.runId ? runs.getRun(res.runId) : null;
  return { ...score(c, { ...res, steps: run?.steps || [], costUsd: run?.costUsd ?? res.costUsd }), runId: res.runId, error: res.error };
}

async function runAll({ mode = "live", only = null, dir = CASE_DIR, onResult = () => {} } = {}) {
  const results = [];
  const fetchImpl = global.fetch;
  for (const file of loadCaseFiles(dir, only)) {
    for (const c of file.cases) {
      const r = { agent: file.agent, ...(await runCase(file, c, { mode, fetchImpl })) };
      results.push(r); onResult(r);
    }
  }
  return results;
}

function summarize(results) {
  const by = {};
  for (const r of results) {
    const a = (by[r.agent] ||= { agent: r.agent, cases: 0, passed: 0, costUsd: 0 });
    a.cases++; a.passed += r.pass ? 1 : 0; a.costUsd += r.costUsd || 0;
  }
  return { cases: results.length, passed: results.filter((r) => r.pass).length, costUsd: results.reduce((s, r) => s + (r.costUsd || 0), 0), agents: Object.values(by) };
}

// Saves results where the stats page reads them (agent_eval_results).
function save(db, results, mode) {
  require("../schema/observability").apply(db);
  const at = new Date().toISOString().replace("T", " ").slice(0, 19);
  const ins = db.prepare("INSERT INTO agent_eval_results (agent, caseId, mode, pass, checks, costUsd, runId, error, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of results) ins.run(r.agent, r.id, mode, r.pass ? 1 : 0, JSON.stringify({ checks: r.checks, notes: r.notes }), r.costUsd || 0, r.runId || null, r.error || null, at);
}

// Nightly regression run, off unless AGENT_EVALS_NIGHTLY=1. Runs the script in a child process
// so its fixture fetch patching can't touch the live server.
function registerNightly() {
  if (process.env.AGENT_EVALS_NIGHTLY !== "1") return false;
  try {
    let last = null;
    require("../platform/jobs").register("agent_evals_nightly", {
      everyMs: 60 * 60e3,
      fn: async () => {
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        if (last === day || now.getUTCHours() !== 9) return; // ~4-5 AM New York
        last = day;
        const { execFile } = require("node:child_process");
        await new Promise((resolve) => execFile(process.execPath, [path.join(__dirname, "..", "..", "scripts", "eval-agents.js"), "--save"], { env: process.env, timeout: 30 * 60e3 }, (err, stdout) => {
          if (err) console.error("[agent-evals] nightly failed:", err.message);
          else console.log(String(stdout).trim().split("\n").slice(-3).join("\n"));
          resolve();
        }));
      },
    });
    return true;
  } catch { return false; }
}

module.exports = { CASE_DIR, loadCaseFiles, lint, score, runCase, runAll, summarize, save, registerNightly, toRegex };
