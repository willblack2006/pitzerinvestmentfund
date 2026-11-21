#!/usr/bin/env node
// Golden-case evals for agents (eval/agents/*.json, see lib/agents/evalAgents.js). Each case is
// replayed through the real workflow with its tool and HTTP responses taken from fixtures, so a
// prompt, model or code change can be compared on the same inputs.
//
//   npm run eval:agents                       # every case, real OpenAI (spend is real)
//   npm run eval:agents -- --plan-only        # offline: check the case files, list the cases
//   npm run eval:agents -- --fake             # offline: scripted model replies from the cases
//   npm run eval:agents -- --only filing_flash
//   npm run eval:agents -- --save             # also store results for the Agents > Stats page
//   npm run eval:agents -- --record 123 > eval/agents/new.json   # case skeleton from run #123
//
// Runs happen on a temporary copy of the database, so briefs, notifications and events the
// workflows write never reach the real app. With --save, results and one cost row (workflow
// "eval_agents", so the spend counts toward the monthly cap) are written to the real database.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const realDbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "pif.db");
const only = opt("only") ? opt("only").split(",") : null;

function openRealDb() {
  const Database = require("libsql");
  return new Database(realDbPath);
}

function record(runId) {
  const db = openRealDb();
  const r = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(Number(runId));
  if (!r) throw new Error(`No run #${runId} in ${realDbPath}`);
  const e = r.eventId ? db.prepare("SELECT * FROM agent_events WHERE id = ?").get(r.eventId) : null;
  const steps = JSON.parse(r.steps || "[]");
  const tools = {};
  for (const s of steps.filter((x) => x.kind === "tool" && x.name !== "web_search")) {
    let data = null;
    try { data = JSON.parse(s.preview); } catch { data = s.preview || "TODO: paste the full tool result here"; }
    (tools[s.name] ||= []).push({ args: s.args || {}, data, source_url: s.source_url || null });
  }
  const sources = steps.filter((s) => s.kind === "source").map((s) => ({ match: s.url, body: "TODO: save the source text here (the run only kept its length)" }));
  const caseDef = {
    agent: r.workflow, workflow: r.workflow, description: `Recorded from run #${r.id} on ${r.createdAt}. Fill in the TODOs and tighten expect.`,
    cases: [{
      id: `run-${r.id}`,
      event: e ? { symbol: e.symbol, type: e.type, items: e.items, title: e.title, sourceUrl: e.sourceUrl, asOf: e.asOf, tier: e.tier, payload: JSON.parse(e.payload || "{}") } : { symbol: r.symbol },
      tools, http: sources,
      expect: { status: "done", maxCostUsd: Math.max(0.01, Math.ceil(r.costUsd * 200) / 100), maxModelTurns: steps.filter((s) => s.kind === "model").length + 2 },
    }],
  };
  process.stdout.write(`${JSON.stringify(caseDef, null, 2)}\n`);
}

async function main() {
  if (opt("record")) return record(opt("record"));
  const evals = require("../lib/agents/evalAgents");
  const files = evals.loadCaseFiles(evals.CASE_DIR, only);

  if (flag("plan-only")) {
    // Workflows register on require; that needs the db module, so point it at a throwaway file.
    process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-evalplan-")), "plan.db");
    require("../lib/agents/workflows");
    const registered = require("../lib/agents").registered();
    const problems = files.flatMap((f) => evals.lint(f, registered));
    for (const f of files) for (const c of f.cases) console.log(`${f.agent.padEnd(18)} ${String(c.id).padEnd(26)} ${c.fakeModel ? "fake-ready" : "live-only "}  ${Object.keys(c.tools || {}).length} tool / ${(c.http || []).length} http fixtures`);
    console.log(problems.length ? `\n${problems.join("\n")}` : `\n${files.reduce((s, f) => s + f.cases.length, 0)} cases in ${files.length} files, no problems.`);
    process.exitCode = problems.length ? 1 : 0;
    return;
  }

  const mode = flag("fake") ? "fake" : "live";
  if (mode === "live" && !process.env.OPENAI_API_KEY) { console.error("OPENAI_API_KEY is not set. Use --fake or --plan-only to run offline."); process.exitCode = 2; return; }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-evalagents-")), "eval.db");
  if (fs.existsSync(realDbPath)) fs.copyFileSync(realDbPath, tmp);
  process.env.DB_PATH = tmp;
  process.env.DISABLE_SCHEDULER = "true";
  if (mode === "fake") process.env.OPENAI_API_KEY ||= "eval-fake";
  // The copy keeps the real caps; evals shouldn't be refused by today's member spend.
  require("../lib/settings").setSettings({ aiMonthlyCapUsd: 1000, aiMemberDailyUsd: 1000 });

  const results = await evals.runAll({ mode, only, onResult: (r) => console.log(`${r.pass ? "PASS" : "FAIL"} ${r.agent}/${r.id}  $${(r.costUsd || 0).toFixed(4)}  ${r.modelTurns} turns${r.notes.length ? `  · ${r.notes.join("; ")}` : ""}`) });
  const sum = evals.summarize(results);
  console.log(`\n${sum.passed}/${sum.cases} passed, $${sum.costUsd.toFixed(4)} (${mode})`);
  for (const a of sum.agents) console.log(`  ${a.agent}: ${a.passed}/${a.cases}`);

  const outDir = path.join(path.dirname(realDbPath), "eval");
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `agents-${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}.json`);
    fs.writeFileSync(file, JSON.stringify({ mode, summary: sum, results }, null, 2));
    console.log(`Report: ${file}`);
  } catch (err) { console.warn(`Couldn't write the report: ${err.message}`); }

  if (flag("save")) {
    const db = openRealDb();
    evals.save(db, results, mode);
    if (mode === "live" && sum.costUsd > 0) {
      db.prepare("INSERT INTO agent_runs (workflow, status, provider, costUsd, finishedAt, output) VALUES ('eval_agents', 'done', 'openai', ?, datetime('now'), ?)").run(sum.costUsd, JSON.stringify({ kind: "eval_agents", summary: sum }));
    }
    console.log(`Saved to ${realDbPath}.`);
  }
  process.exitCode = sum.passed === sum.cases ? 0 : 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
