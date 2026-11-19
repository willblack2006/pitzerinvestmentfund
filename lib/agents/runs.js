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

// The agent a workflow run belongs to: the built-in agent seeded for that workflow.
function agentIdFor(workflow) {
  return db.prepare("SELECT id FROM agents WHERE workflow = ? AND kind = 'builtin'").get(workflow)?.id ?? null;
}

// trigger: 'schedule' | 'event' | 'manual' | 'handoff' | 'mention' | 'rule'. When not given it is
// 'event' for event runs, 'manual' for runs a member started, else 'schedule'.
function createRun({ workflow, eventId = null, memberId = null, symbol = null, agentId = null, parentRunId = null, trigger = null, triggeredBy = null }) {
  const aid = agentId ?? agentIdFor(workflow);
  const trig = trigger || (eventId ? "event" : memberId ? "manual" : "schedule");
  const info = db.prepare(`INSERT INTO agent_runs (workflow, eventId, memberId, symbol, provider, agentId, parentRunId, trigger, triggeredBy)
    VALUES (?, ?, ?, ?, 'openai', ?, ?, ?, ?)`).run(workflow, eventId, memberId, symbol, aid, parentRunId, trig, triggeredBy ?? memberId);
  return Number(info.lastInsertRowid);
}

function getRun(id) {
  const r = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id);
  if (!r) return null;
  return { ...r, steps: JSON.parse(r.steps || "[]"), output: r.output ? JSON.parse(r.output) : null };
}

// The context a workflow gets: model calls with cost tracking, tool calls with logging.
class RunContext {
  constructor(id, { memberId = null, agentId = null, parentRunId = null, trigger = null, triggeredBy = null, symbol = null, workflow = null } = {}) {
    this.id = id; this.memberId = memberId;
    this.agentId = agentId; this.parentRunId = parentRunId; this.trigger = trigger; this.triggeredBy = triggeredBy;
    this.symbol = symbol; this.workflow = workflow;
    this.steps = []; this.usage = { input: 0, output: 0 }; this.cost = 0; this.model = null;
    this.toolResults = []; // everything tools returned, for number verification
    this.sourceTexts = {}; // id -> text, for quote verification
  }

  // Shared memory passthroughs (lib/agents/memory.js). recall defaults to this run's symbol and
  // agent; remember stamps the run and agent as the source.
  recall(opts = {}) {
    return require("./memory").recall({ symbol: this.symbol, agentId: this.agentId, memberId: this.memberId, ...opts });
  }
  remember(opts = {}) {
    return require("./memory").remember({ sourceRunId: this.id, agentId: this.agentId, ...opts });
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
    this.usage.input += out.usage.input; this.usage.output += out.usage.output; this.usage.cached += out.usage.cached || 0; this.cost += cost; this.model = out.model;
    this.save();
  }

  // One model turn with cost accounting; a turn cut off by the token ceiling is retried once
  // with more room.
  async turn({ input, tools = [], schema, schemaName, effort, maxOutputTokens, tier, cacheKey }) {
    let limit = maxOutputTokens;
    for (let attempt = 0; ; attempt++) {
      budget.check({ memberId: this.memberId });
      const out = await openai.respondRaw({ input, tools, schema, schemaName, effort, maxOutputTokens: limit, useModel: TIERS[tier](), cacheKey: cacheKey || this.cacheKey });
      this.account(out);
      this.step("model", { model: out.model, input: out.usage.input, cached: out.usage.cached || undefined, output: out.usage.output, toolCalls: out.calls.length ? out.calls.map((c) => c.name) : undefined, incomplete: out.incomplete || undefined, webSearches: out.searches?.length ? out.searches : undefined });
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
    const r = await callTool(name, args, { memberId: this.memberId });
    this.memo.set(key, r);
    this.step("tool", { name, args, ok: !r.error, error: r.error || undefined, source_url: r.source_url || null });
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

// Runs that stay private to the member who started them (Ask PIF and the desk). Everything else
// a built-in workflow writes goes to the team feed when it finishes. weekly_memo waits for an
// editor in the approval queue, so it doesn't post either.
const PRIVATE_WORKFLOWS = new Set(["ask_pif", "compare", "what_if", "meeting_prep", "ideas", "pitch_primer"]);
const NO_FEED_WORKFLOWS = new Set(["weekly_memo"]);

function summaryOf(output) {
  if (!output || typeof output !== "object") return typeof output === "string" ? output.slice(0, 500) : null;
  const s = output.summary || output.headline || output.verdict || output.answer || output.title;
  return typeof s === "string" ? s.slice(0, 500) : null;
}

// After a run finishes: tell bus subscribers (trigger matcher, memory) and post briefs to the feed.
// Never throws: a feed or bus problem must not fail a run that already succeeded.
function afterRun({ id, workflow, symbol, memberId, agentId, output, parentRunId, trigger }) {
  const summary = summaryOf(output);
  try { if (summary) db.prepare("UPDATE agent_runs SET summary = ? WHERE id = ?").run(summary, id); } catch (err) { console.error("[runs] summary failed:", err.message); }
  try { require("../platform/bus").emit("agent_output", { runId: id, agentId, workflow, symbol, memberId, parentRunId, trigger, output }); } catch (err) { console.error("[runs] bus emit failed:", err.message); }
  if (PRIVATE_WORKFLOWS.has(workflow) || NO_FEED_WORKFLOWS.has(workflow) || output == null) return;
  // Only built-in workflows post here; custom agents post through their spec's outputs (WS2).
  const agent = agentId && db.prepare("SELECT kind FROM agents WHERE id = ?").get(agentId);
  if (!agent || agent.kind !== "builtin") return;
  try {
    require("../platform/feed").post({
      kind: "agent_brief", actorType: "agent", actorId: agentId, agentId, runId: id, symbol,
      title: (output && typeof output === "object" && typeof output.title === "string" && output.title) || `${workflow.replace(/_/g, " ")}${symbol ? ` · ${symbol}` : ""}`,
      body: { summary, workflow },
    });
  } catch (err) { console.error("[runs] feed post failed:", err.message); }
}

// Runs `fn(ctx)` as one recorded run. Refuses (and records the refusal) if the caps are hit.
// Platform fields (all optional): agentId (defaults to the workflow's built-in agent),
// parentRunId, trigger, triggeredBy.
async function run({ workflow, eventId = null, memberId = null, symbol = null, agentId = null, parentRunId = null, trigger = null, triggeredBy = null }, fn) {
  const id = createRun({ workflow, eventId, memberId, symbol, agentId, parentRunId, trigger, triggeredBy });
  const row = db.prepare("SELECT agentId, trigger, triggeredBy FROM agent_runs WHERE id = ?").get(id);
  const ctx = new RunContext(id, { memberId, agentId: row.agentId, parentRunId, trigger: row.trigger, triggeredBy: row.triggeredBy, symbol, workflow });
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
    if (row.agentId) db.prepare("UPDATE agents SET lastRunAt = datetime('now') WHERE id = ?").run(row.agentId);
    afterRun({ id, workflow, symbol, memberId, agentId: row.agentId, output, parentRunId, trigger: row.trigger });
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

module.exports = { run, getRun, createRun, agentIdFor, RunContext, TIERS, markInterrupted, PRIVATE_WORKFLOWS };
