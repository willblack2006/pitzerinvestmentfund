#!/usr/bin/env node
// Runs the fixed Ask PIF questions (eval/ask-questions.json) through the real workflow against
// the app's current data and the real OpenAI API, then prints cost, steps, tools used and a
// pass/fail per question, plus a JSON report under data/eval/. Use it to compare a change
// (model tier, prompt, tool limits) on cost and quality before and after.
//
//   node scripts/eval-ask.js                      # all questions, planner's routing
//   node scripts/eval-ask.js --only nvda-price,compare-nvda-mu
//   node scripts/eval-ask.js --force-tier mid     # skip the cheap path (baseline for comparison)
//   node scripts/eval-ask.js --all-tools          # skip tool narrowing
//   node scripts/eval-ask.js --plan-only          # no API calls: show routing for each question
//   node scripts/eval-ask.js --base http://127.0.0.1:10000   # use an already running server
//
// Needs OPENAI_API_KEY (not for --plan-only). Spend is real and counts toward the monthly cap
// under the workflow name "eval_ask"; the whole set costs roughly the same as a dozen questions.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "eval", "ask-questions.json"), "utf8"))
  .filter((q) => !opt("only") || opt("only").split(",").includes(q.id));

async function startServer() {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(port), DISABLE_SCHEDULER: "true", AUTO_REFRESH_PRICES: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 30000);
    const poll = setInterval(() => { if (log.includes("running on")) { clearTimeout(t); clearInterval(poll); resolve(); } }, 200);
    child.on("exit", (c) => reject(new Error(`server exited ${c}:\n${log}`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

async function main() {
  const askPlan = require("../lib/agents/askPlan");
  if (flag("plan-only")) {
    const { TOOLS } = require("../lib/agents/tools");
    const all = Object.keys(TOOLS).filter((n) => !n.startsWith("fake_"));
    for (const q of questions) {
      const p = askPlan.plan(q.question, all);
      console.log(`${q.id.padEnd(18)} ${p.tier.padEnd(5)} tools ${String(p.tools.length).padStart(2)}/${all.length}  groups: ${p.groups.join(",") || "-"}${q.expectTier && q.expectTier !== p.tier ? `   (expected ${q.expectTier})` : ""}`);
    }
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (use --plan-only to check routing without it).");
  const server = opt("base") ? { base: opt("base"), stop() {} } : await startServer();
  require("../lib/agents/tools").setBaseUrl(server.base);
  const runs = require("../lib/agents/runs");
  const { ask } = require("../lib/agents/workflows/ask");
  const { score, summarize } = require("../lib/agents/evalScore");
  const forced = args.find((a) => a.startsWith("--force-tier="))?.split("=")[1];
  if (forced || flag("all-tools")) {
    const orig = askPlan.plan;
    askPlan.plan = (q, all) => { const p = orig(q, all); return { ...p, ...(forced ? { tier: forced, maxSteps: 8 } : {}), ...(flag("all-tools") ? { tools: all, narrowed: false } : {}) }; };
  }
  const rows = [];
  try {
    for (const q of questions) {
      process.stdout.write(`${q.id.padEnd(18)} `);
      let row;
      try {
        const r = await runs.run({ workflow: "eval_ask" }, (ctx) => ask({ question: q.question }, ctx).then((out) => { out._ctx = { steps: ctx.steps, usage: { ...ctx.usage } }; return out; }));
        const { _ctx, ...output } = r.output;
        row = score(q, output, { costUsd: r.costUsd, steps: _ctx.steps, usage: _ctx.usage });
      } catch (err) { row = score(q, null, { error: err.message, costUsd: 0 }); }
      rows.push(row);
      console.log(row.error ? `ERROR ${row.error}` : `${row.pass ? "pass" : "FAIL"}  ${String(row.tier).padEnd(5)}${row.escalated ? "^" : " "} steps ${row.modelSteps} tools ${row.toolCalls}  $${row.costUsd.toFixed(4)}  cache ${(row.cacheHit * 100).toFixed(0)}%  unbacked ${row.unbacked}${row.pass ? "" : `  ${JSON.stringify(Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k))} ${row.missingTools.join(",")}`}`);
    }
  } finally { server.stop(); }
  const summary = summarize(rows);
  console.log(`\n${summary.passed}/${summary.questions} passed, ${summary.errors} errors, ${summary.escalated} escalated to mid, total $${summary.totalCostUsd.toFixed(4)} (avg $${summary.avgCostUsd.toFixed(4)}), avg ${summary.avgModelSteps.toFixed(1)} model steps, cache hit ${(summary.cacheHit * 100).toFixed(0)}%, unbacked numbers ${summary.unbackedNumbers}`);
  const dir = path.join(__dirname, "..", "data", "eval");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ask-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), env: { cheap: runs.TIERS.cheap(), mid: runs.TIERS.mid(), forced: forced || null, allTools: flag("all-tools") }, summary, rows }, null, 2));
  console.log(`Report: ${file}`);
  process.exit(0);
}
main().catch((err) => { console.error(err.message); process.exit(1); });
