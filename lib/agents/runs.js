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
// OpenAI bills built-in web search per call on top of tokens ($10 per 1,000 calls, Nov 2026).
const WEB_SEARCH_USD = () => Number(process.env.WEB_SEARCH_COST_USD) || 0.01;
const MAX_STEP_LOG = 60;
const TRACE_PREVIEW_CHARS = 600;
// max_output_tokens is a ceiling, not a price: reasoning tokens count against it, so a tight
// limit cuts answers off mid-thought ("The model's answer was cut off") without saving money.
// The spending caps are what bound cost. A cut-off answer is retried once with double the room.
const OUTPUT_TOKENS_DEFAULT = 16000;
const OUTPUT_TOKENS_MAX = 32000;

// Each model step resends everything so far. A big tool result read two steps ago has already
// done its job, so it is cut down to a short version (re-calling the tool is free: repeats are
// answered from the run's memory). Done once per result, so the prompt prefix stays stable
// (and cached) between steps.
const STALE_AFTER_STEPS = 2;
const STALE_IF_OVER = 4000;
const STALE_KEEP_CHARS = 1800;
const STALE_NOTE = "[earlier result shortened; call the same tool again for the full data]";
const wrapTool = (name, text) => `<untrusted_tool_data tool="${name}">\n${text}\n</untrusted_tool_data>`;

const WRAP_UP = "You have used your tool budget. Answer now from the tool results you already have, and say plainly what you could not find.";

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
    const tokens = openai.costOf(out.model, out.usage);
    const cost = tokens == null ? null : tokens + (out.searches?.length || 0) * WEB_SEARCH_USD();
    if (cost == null) throw new Error(`No price on file for model ${out.model}; add it to PRICES in lib/sources/openai.js so the spending cap can count it.`);
    this.usage.input += out.usage.input; this.usage.output += out.usage.output; this.usage.cached = (this.usage.cached || 0) + (out.usage.cached || 0); this.cost += cost; this.model = out.model;
    this.save();
    return cost;
  }

  // One model turn with cost accounting; a turn cut off by the token ceiling is retried once
  // with more room.
  async turn({ input, tools = [], schema, schemaName, effort, maxOutputTokens, tier, cacheKey }) {
    let limit = maxOutputTokens;
    for (let attempt = 0; ; attempt++) {
      budget.check({ memberId: this.memberId });
      const t0 = Date.now();
      const out = await openai.respondRaw({ input, tools, schema, schemaName, effort, maxOutputTokens: limit, useModel: TIERS[tier](), cacheKey: cacheKey || this.cacheKey });
      const ms = Date.now() - t0;
      const costUsd = this.account(out);
      // ms and costUsd feed the run trace (lib/agents/metrics.js).
      this.step("model", { ms, costUsd, tier, model: out.model, input: out.usage.input, cached: out.usage.cached || undefined, output: out.usage.output, toolCalls: out.calls.length ? out.calls.map((c) => c.name) : undefined, incomplete: out.incomplete || undefined, webSearches: out.searches?.length ? out.searches : undefined });
      if (out.incomplete === "max_output_tokens" && !out.calls.length && attempt === 0 && limit < OUTPUT_TOKENS_MAX) { limit = Math.min(limit * 2, OUTPUT_TOKENS_MAX); continue; }
      return out;
    }
  }

  // One model call, no tools. Returns { text, json } (json when a schema was given).
  async ai({ tier = "mid", system, user, schema = null, schemaName = "result", effort = "low", maxOutputTokens = OUTPUT_TOKENS_DEFAULT }) {
    const out = await this.turn({ input: [{ role: "system", content: system }, { role: "user", content: user }], schema, schemaName, effort, maxOutputTokens, tier });
    if (out.refusal) throw new Error(`The model declined: ${out.refusal}`);
    if (out.incomplete) throw new Error(`The model's answer was cut off (${out.incomplete}).`);
    let json = null;
    if (schema) { try { json = JSON.parse(out.text); } catch { throw new Error("The model's answer was malformed."); } }
    return { text: out.text, json };
  }

  async tool(name, args) {
    // The same call twice in one run (models often re-check) is answered from memory.
    const key = `${name}:${JSON.stringify(args || {})}`;
    this.memo = this.memo || new Map();
    if (this.memo.has(key)) return this.memo.get(key);
    const t0 = Date.now();
    const r = await callTool(name, args, { memberId: this.memberId });
    this.memo.set(key, r);
    // A short preview of what the tool returned, for the run trace (the full result isn't kept).
    let preview;
    try { preview = r.error ? undefined : truncate(r.data, TRACE_PREVIEW_CHARS); } catch { preview = undefined; }
    this.step("tool", { name, args, ok: !r.error, error: r.error || undefined, source_url: r.source_url || null, ms: Date.now() - t0, preview, as_of: r.as_of || undefined, cached: r.cached || undefined });
    if (!r.error) {
      this.toolResults.push(r.data);
      if (r.fullText) this.sourceTexts[r.source_url] = r.fullText;
    }
    return r;
  }

  // An open tool loop (an "agent" in the report's sense): the model picks tools until it answers
  // or hits maxSteps. Tool outputs are wrapped as untrusted data (OWASP LLM01). Calls the model
  // makes in one turn run in parallel. On the last step the tools are taken away and the model
  // is told to answer with what it has. `review(json)` may return a note on a problem with the
  // answer (for example numbers no tool backs); the model then gets one more chance, with tools,
  // to fix it. The result says `revised: true` and keeps `firstDraft` when that happened.
  async agent({ tier = "mid", system, user, tools, schema = null, schemaName = "result", effort = "low", maxSteps = MAX_STEPS_DEFAULT, maxOutputTokens = OUTPUT_TOKENS_DEFAULT, review = null, cacheKey = null }) {
    const defs = toOpenAITools(tools);
    this.cacheKey = cacheKey || this.cacheKey;
    const shrinkable = []; // { item, name, payload, turn } for every tool output in the input
    const input = [{ role: "system", content: system }, { role: "user", content: user }];
    let reviewed = false, first = null;
    let budgetSteps = maxSteps;
    for (let i = 0; i < budgetSteps; i++) {
      const last = i === budgetSteps - 1;
      for (const e of shrinkable) {
        if (e.done || i - e.turn < STALE_AFTER_STEPS || e.item.output.length <= STALE_IF_OVER) continue;
        e.item.output = wrapTool(e.name, `${truncate(e.payload, STALE_KEEP_CHARS)}\n${STALE_NOTE}`);
        e.done = true;
      }
      if (last && i > 0) input.push({ role: "user", content: WRAP_UP });
      const out = await this.turn({ input, tools: last ? [] : defs, schema, schemaName, effort, maxOutputTokens, tier });
      // Pages a web search answer cites become sources of this run, like a tool result.
      for (const c of out.citations || []) {
        if (this.steps.some((st) => st.kind === "tool" && st.source_url === c.url)) continue;
        this.step("tool", { name: "web_search", args: { query: out.searches?.[0] || "" }, ok: true, source_url: c.url, title: c.title });
      }
      if (out.refusal) throw new Error(`The model declined: ${out.refusal}`);
      if (!out.calls.length) {
        if (out.incomplete) throw new Error(`The model's answer was cut off (${out.incomplete}).`);
        let json = null;
        if (schema) { try { json = JSON.parse(out.text); } catch { throw new Error("The model's answer was malformed."); } }
        const result = { text: out.text, json };
        const note = !reviewed && review ? review(json ?? out.text) : null;
        if (!note) return first ? { ...result, revised: true, firstDraft: first } : result;
        // One revision pass: keep the draft, tell the model what's wrong, give it 3 more steps.
        reviewed = true; first = result;
        this.step("review", { note: note.slice(0, 500) });
        input.push(...out.output, { role: "user", content: note });
        budgetSteps = i + 1 + 3;
        continue;
      }
      input.push(...out.output);
      const results = await Promise.all(out.calls.map(async (c) => {
        let args = {};
        try { args = JSON.parse(c.arguments || "{}"); } catch { /* bad args → tool error */ }
        return [c, await this.tool(c.name, args)];
      }));
      for (const [c, r] of results) {
        const payload = r.error ? { error: r.error } : { source_url: r.source_url, as_of: r.as_of, data: r.data };
        const item = { type: "function_call_output", call_id: c.call_id, output: wrapTool(c.name, truncate(payload)) };
        input.push(item);
        shrinkable.push({ item, name: c.name, payload, turn: i, done: false });
      }
    }
    if (first) return { ...first, revised: false };
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
