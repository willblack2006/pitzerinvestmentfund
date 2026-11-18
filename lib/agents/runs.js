// Agent and workflow runs: one agent_runs row per run with its steps, tool calls, tokens, cost
// and output (research report 8.2, "job records and checkpoints"). A run checks the spending
// caps before every model call, so a long run stops when the budget runs out instead of
// overshooting it.
const db = require("../../db");
const openai = require("../sources/openai");
const budget = require("./budget");
const { callTool, toOpenAITools, truncate } = require("./tools");

// Model tiers (report 8.3). Override per tier with env vars without a code change.
const TIERS = {
  cheap: () => process.env.AGENT_MODEL_CHEAP || process.env.OPENAI_MODEL || "gpt-6-luna",
  mid: () => process.env.AGENT_MODEL_MID || "gpt-6.1-sol",
  top: () => process.env.AGENT_MODEL_TOP || "gpt-6-astra",
};

const MAX_STEPS_DEFAULT = 8;
const MAX_STEP_LOG = 60;

function createRun({ workflow, eventId = null, memberId = null, symbol = null }) {
  const info = db.prepare("INSERT INTO agent_runs (workflow, eventId, memberId, symbol, provider) VALUES (?, ?, ?, ?, 'openai')").run(workflow, eventId, memberId, symbol);
  return Number(info.lastInsertRowid);
}

function getRun(id) {
  const r = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id);
  if (!r) return null;
  return { ...r, steps: JSON.parse(r.steps || "[]"), output: r.output ? JSON.parse(r.output) : null };
}

// The context a workflow gets: model calls with cost tracking, tool calls with logging.
class RunContext {
  constructor(id, { memberId = null } = {}) {
    this.id = id; this.memberId = memberId;
    this.steps = []; this.usage = { input: 0, output: 0 }; this.cost = 0; this.model = null;
    this.toolResults = []; // everything tools returned, for number verification
    this.sourceTexts = {}; // id -> text, for quote verification
  }

  step(kind, detail) {
    this.steps.push({ at: new Date().toISOString(), kind, ...detail });
    if (this.steps.length > MAX_STEP_LOG) this.steps.splice(1, 1);
    this.save();
  }

  save() {
    db.prepare("UPDATE agent_runs SET steps = ?, inputTokens = ?, outputTokens = ?, costUsd = ?, model = ? WHERE id = ?")
      .run(JSON.stringify(this.steps), this.usage.input, this.usage.output, this.cost, this.model, this.id);
  }

  account(out) {
    const cost = openai.costOf(out.model, out.usage);
    if (cost == null) throw new Error(`No price on file for model ${out.model}; add it to PRICES in lib/sources/openai.js so the spending cap can count it.`);
    this.usage.input += out.usage.input; this.usage.output += out.usage.output; this.cost += cost; this.model = out.model;
    this.save();
  }

  // One model call, no tools. Returns { text, json } (json when a schema was given).
  async ai({ tier = "mid", system, user, schema = null, schemaName = "result", effort = "low", maxOutputTokens = 6000 }) {
    budget.check({ memberId: this.memberId });
    const out = await openai.respondRaw({
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      schema, schemaName, effort, maxOutputTokens, useModel: TIERS[tier](),
    });
    this.account(out);
    this.step("model", { model: out.model, input: out.usage.input, output: out.usage.output, incomplete: out.incomplete });
    if (out.refusal) throw new Error(`The model declined: ${out.refusal}`);
    if (out.incomplete) throw new Error(`The model's answer was cut off (${out.incomplete}).`);
    let json = null;
    if (schema) { try { json = JSON.parse(out.text); } catch { throw new Error("The model's answer was malformed."); } }
    return { text: out.text, json };
  }

  async tool(name, args) {
    const r = await callTool(name, args);
    this.step("tool", { name, args, ok: !r.error, error: r.error || undefined, source_url: r.source_url || null });
    if (!r.error) {
      this.toolResults.push(r.data);
      if (r.fullText) this.sourceTexts[r.source_url] = r.fullText;
    }
    return r;
  }

  // An open tool loop (an "agent" in the report's sense): the model picks tools until it answers
  // or hits maxSteps. Tool outputs are wrapped as untrusted data (OWASP LLM01).
  async agent({ tier = "mid", system, user, tools, schema = null, schemaName = "result", effort = "low", maxSteps = MAX_STEPS_DEFAULT, maxOutputTokens = 6000 }) {
    const defs = toOpenAITools(tools);
    const input = [{ role: "system", content: system }, { role: "user", content: user }];
    for (let i = 0; i < maxSteps; i++) {
      budget.check({ memberId: this.memberId });
      const last = i === maxSteps - 1;
      const out = await openai.respondRaw({ input, tools: last ? [] : defs, schema, schemaName, effort, maxOutputTokens, useModel: TIERS[tier]() });
      this.account(out);
      this.step("model", { model: out.model, input: out.usage.input, output: out.usage.output, toolCalls: out.calls.map((c) => c.name) });
      if (out.refusal) throw new Error(`The model declined: ${out.refusal}`);
      if (!out.calls.length) {
        if (out.incomplete) throw new Error(`The model's answer was cut off (${out.incomplete}).`);
        let json = null;
        if (schema) { try { json = JSON.parse(out.text); } catch { throw new Error("The model's answer was malformed."); } }
        return { text: out.text, json };
      }
      input.push(...out.output);
      for (const c of out.calls) {
        let args = {};
        try { args = JSON.parse(c.arguments || "{}"); } catch { /* bad args → tool error */ }
        const r = await this.tool(c.name, args);
        const payload = r.error ? { error: r.error } : { source_url: r.source_url, as_of: r.as_of, data: r.data };
        input.push({ type: "function_call_output", call_id: c.call_id, output: `<untrusted_tool_data tool="${c.name}">\n${truncate(payload)}\n</untrusted_tool_data>` });
      }
    }
    throw new Error("The agent ran out of steps without an answer.");
  }
}

// Runs `fn(ctx)` as one recorded run. Refuses (and records the refusal) if the caps are hit.
async function run({ workflow, eventId = null, memberId = null, symbol = null }, fn) {
  const id = createRun({ workflow, eventId, memberId, symbol });
  const ctx = new RunContext(id, { memberId });
  try {
    budget.check({ memberId });
  } catch (err) {
    db.prepare("UPDATE agent_runs SET status = 'refused', error = ?, finishedAt = datetime('now') WHERE id = ?").run(err.message, id);
    throw err;
  }
  try {
    const output = await fn(ctx);
    ctx.save();
    db.prepare("UPDATE agent_runs SET status = 'done', output = ?, finishedAt = datetime('now') WHERE id = ?").run(JSON.stringify(output ?? null), id);
    return { runId: id, output, costUsd: ctx.cost };
  } catch (err) {
    ctx.save();
    const status = err instanceof budget.BudgetError ? "refused" : "failed";
    db.prepare("UPDATE agent_runs SET status = ?, error = ?, finishedAt = datetime('now') WHERE id = ?").run(status, String(err.message).slice(0, 1000), id);
    err.runId = id;
    throw err;
  }
}

// Runs left 'running' by a restart (Render redeploys kill the process mid-run).
function markInterrupted() {
  return db.prepare("UPDATE agent_runs SET status = 'failed', error = 'Interrupted by a server restart.', finishedAt = datetime('now') WHERE status = 'running'").run().changes;
}

module.exports = { run, getRun, RunContext, TIERS, markInterrupted };
