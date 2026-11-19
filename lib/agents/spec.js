// Agent spec (plan section 3.2): validation, normalization and a cost estimate.
//
// A spec is the JSON a member writes (through the builder UI or a template) to describe an
// agent: what it watches (scope), when it wakes up (triggers), free checks that must pass
// (conditions), what it does (steps: tool calls, rules, AI steps) and where results go
// (outputs). Everything here is pure: no database, no network. `normalize` returns the cleaned
// spec plus a list of friendly errors and warnings; `validate` throws when there are errors.
//
// Variables a spec may use in tool args and conditions: `$symbol`, `$event.<path>`,
// `$prev.<path>` (the last run's output for this agent+symbol) and `<stepId>.<path>`.

const LIMITS = { steps: 12, aiSteps: 3, triggers: 8, conditions: 10, outputs: 8, symbols: 50, instructions: 4000, aiMaxSteps: 10, toolsPerAi: 25 };

const SCOPES = ["holdings", "watchlist", "symbols", "fund"];
const PRESETS = {
  premarket: { cron: "30 8 * * 1-5", label: "Weekdays 8:30 AM ET, before the open" },
  open: { cron: "45 9 * * 1-5", label: "Weekdays 9:45 AM ET, just after the open" },
  close: { cron: "15 16 * * 1-5", label: "Weekdays 4:15 PM ET, after the close" },
  weekly_mon: { cron: "0 8 * * 1", label: "Mondays 8 AM ET" },
  weekly_fri: { cron: "30 16 * * 5", label: "Fridays 4:30 PM ET" },
  monthly: { cron: "0 9 1 * *", label: "The 1st of each month, 9 AM ET" },
  hourly_market: { cron: "0 10-16 * * 1-5", label: "Every hour while the market is open" },
};
// Event types the trigger matcher listens for (lib/agents/triggers.js), with a plain label and
// the extra fields each one accepts.
const EVENTS = {
  filing: { label: "a new SEC filing", fields: { forms: "strings", items: "strings" } },
  price_move: { label: "a large price move (scaled to the stock's own volatility)", fields: { sigma: "number", pct: "number" } },
  earnings_soon: { label: "earnings coming up", fields: { days: "number" } },
  insider_buy: { label: "insider buying", fields: { minScore: "number" } },
  tripwire: { label: "an exit tripwire tripping", fields: {} },
  news_high: { label: "high-importance news", fields: {} },
  thirteenf: { label: "a 13F filing that changes a holder", fields: {} },
  ips_breach: { label: "an investment-policy limit breached or near", fields: { level: "string" } },
  pitch_status: { label: "a pitch changing status", fields: { status: "strings" } },
  estimate_revision: { label: "a big analyst estimate revision", fields: { minScore: "number" } },
  thesis_change: { label: "a thesis or pillar changing status", fields: {} },
  agent_output: { label: "another agent finishing a run", fields: { agent: "string" } },
};
const OPS = ["<", "<=", ">", ">=", "==", "!=", "crosses_above", "crosses_below", "changed", "pct_change_gt", "in"];
const STEP_TYPES = ["tool", "rule", "ai"];
const TIERS = ["cheap", "mid", "top"];
const AI_OUTPUTS = ["brief", "verdict", "score", "list", "scenario"];
const OUTPUT_TYPES = ["feed", "notify", "memory", "thesis_check", "proposal", "handoff"];
const WHEN = /^(always|changed|verdict:[a-z_]+|verdict_not:[a-z_]+|score_gt:-?\d+(\.\d+)?|score_lt:-?\d+(\.\d+)?|nonempty)$/;
const NOTIFY_WHO = ["owner", "followers", "team"];
const NOTIFY_TIER = ["push", "inbox", "digest"];
const MEMORY_SCOPES = ["fund", "symbol", "agent", "member"];
const MEMORY_KINDS = ["fact", "observation", "decision", "preference", "open_question", "prediction"];
const PROPOSAL_KINDS = ["thesis_status", "tripwire", "watchlist_add", "pillar_status"];
const RESERVED_IDS = new Set(["symbol", "event", "prev", "quote", "fund", "agent", "run"]);
const ID_RE = /^[a-z][a-z0-9_]{0,15}$/;
const TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;

const DEFAULT_BUDGET = { perRunUsd: 0.10, perMonthUsd: 3 };
const MAX_BUDGET = { perRunUsd: 2, perMonthUsd: 50 };
const DEFAULT_MAX_RUNS_PER_DAY = 24;

// Rough token use of one AI step turn, by tier, for the estimate shown before saving. Each turn
// resends the conversation, so a step's input grows; this is the average turn, measured on Ask
// PIF runs (about 9K input, 600 output) and trimmed for the smaller tool lists agents get.
const TURN_TOKENS = { input: 7000, cachedShare: 0.5, output: 700 };

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

// A metric reference in a condition: a registry name ("quote.changePct"), a step result
// ("d1.data.pe"), the previous run ("$prev.score") or the event ("$event.sigma").
const METRIC_RE = /^(\$(prev|event)(\.[A-Za-z0-9_]+)*|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+)$/;

function deps() {
  // Lazy so this file stays usable in the browser-less builder tests and without the tool layer.
  let tools = {}, metrics = null;
  try { tools = require("./tools").TOOLS; } catch { /* tool layer unavailable */ }
  try { metrics = require("../metrics/registry"); } catch { /* registry unavailable */ }
  return { tools, metrics };
}

function checkCondition(c, where, stepIds, errors, { metrics }) {
  if (!isObj(c)) { errors.push(`${where}: a condition must be an object like {"metric": "quote.changePct", "op": "<", "value": -5}.`); return null; }
  const metric = str(c.metric, 120);
  const op = str(c.op, 20);
  if (!metric || !METRIC_RE.test(metric)) { errors.push(`${where}: "${metric || "(blank)"}" is not a metric name. Use one from the metric list, a step result like "d1.pe", or "$prev.score".`); return null; }
  const head = metric.split(".")[0];
  const isRef = head.startsWith("$") || stepIds.has(head);
  if (!isRef && metrics && !metrics.has(metric)) {
    const near = metrics.suggest ? metrics.suggest(metric) : [];
    errors.push(`${where}: unknown metric "${metric}".${near.length ? ` Did you mean ${near.map((n) => `"${n}"`).join(" or ")}?` : ""}`);
    return null;
  }
  if (!OPS.includes(op)) { errors.push(`${where}: "${op || "(blank)"}" is not a comparison. Use one of ${OPS.join(", ")}.`); return null; }
  const out = { metric, op };
  if (op === "changed") return out;
  if (op === "in") {
    if (!Array.isArray(c.value) || !c.value.length || c.value.length > 50) { errors.push(`${where}: "in" needs a list of 1-50 values.`); return null; }
    out.value = c.value.map((v) => (typeof v === "number" ? v : str(v, 60)));
    return out;
  }
  const v = typeof c.value === "string" && c.value.trim() !== "" && Number.isFinite(Number(c.value)) ? Number(c.value) : c.value;
  if (op === "pct_change_gt" || op.startsWith("crosses_") || ["<", "<=", ">", ">="].includes(op)) {
    if (typeof v !== "number" && !(typeof v === "string" && METRIC_RE.test(v))) { errors.push(`${where}: "${op}" needs a number (or another metric name) as the value.`); return null; }
  } else if (v === undefined || v === null || (typeof v === "object")) { errors.push(`${where}: "${op}" needs a value.`); return null; }
  out.value = typeof v === "string" ? str(v, 120) : v;
  return out;
}

function normTrigger(t, i, errors, warnings) {
  const where = `Trigger ${i + 1}`;
  if (!isObj(t)) { errors.push(`${where}: must be an object.`); return null; }
  const type = str(t.type, 20);
  if (type === "manual") return { type };
  if (type === "schedule") {
    const tz = str(t.tz || "America/New_York", 60);
    if (!isValidTz(tz)) { errors.push(`${where}: "${tz}" is not a time zone (try America/New_York).`); return null; }
    if (t.preset) {
      if (!PRESETS[t.preset]) { errors.push(`${where}: "${t.preset}" is not a schedule preset. Use one of ${Object.keys(PRESETS).join(", ")}, or a cron line.`); return null; }
      return { type, preset: t.preset, tz };
    }
    const cron = str(t.cron, 100).replace(/\s+/g, " ");
    const cronErr = cronError(cron);
    if (cronErr) { errors.push(`${where}: ${cronErr}`); return null; }
    if (cronFiresTooOften(cron)) warnings.push(`${where}: "${cron}" fires more than once an hour. Runs are capped per day, so most of those would be skipped.`);
    return { type, cron, tz };
  }
  if (type === "event") {
    const on = str(t.on, 40);
    const ev = EVENTS[on];
    if (!ev) { errors.push(`${where}: "${on || "(blank)"}" is not an event. Use one of ${Object.keys(EVENTS).join(", ")}.`); return null; }
    const out = { type, on };
    for (const [k, kind] of Object.entries(ev.fields)) {
      if (t[k] == null) continue;
      if (kind === "number") {
        const n = Number(t[k]);
        if (!Number.isFinite(n)) { errors.push(`${where}: "${k}" must be a number.`); continue; }
        out[k] = n;
      } else if (kind === "strings") {
        if (!Array.isArray(t[k])) { errors.push(`${where}: "${k}" must be a list.`); continue; }
        out[k] = t[k].map((x) => str(x, 20)).filter(Boolean).slice(0, 20);
      } else out[k] = str(t[k], 60);
    }
    if (on === "price_move" && out.sigma == null && out.pct == null) out.sigma = 2;
    if (on === "price_move" && out.sigma != null && (out.sigma < 1 || out.sigma > 6)) { errors.push(`${where}: sigma must be between 1 and 6.`); }
    if (on === "earnings_soon" && out.days == null) out.days = 7;
    if (on === "earnings_soon" && (out.days < 0 || out.days > 30)) errors.push(`${where}: days must be between 0 and 30.`);
    return out;
  }
  if (type === "handoff") {
    const topic = str(t.topic, 40).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(topic)) { errors.push(`${where}: a handoff trigger needs a topic like "thesis".`); return null; }
    return { type, topic };
  }
  errors.push(`${where}: "${type || "(blank)"}" is not a trigger type. Use schedule, event, handoff or manual.`);
  return null;
}

function substitutesOk(v) {
  // Tool args may be literals or "$symbol" / "$event.x" / "$prev.x" / "<step>.x".
  if (typeof v !== "string" || !v.startsWith("$")) return true;
  return /^\$(symbol|event(\.[A-Za-z0-9_]+)*|prev(\.[A-Za-z0-9_]+)*)$/.test(v);
}

function normStep(s, i, seen, errors, warnings, d) {
  const where = `Step ${i + 1}${s && s.id ? ` (${s.id})` : ""}`;
  if (!isObj(s)) { errors.push(`Step ${i + 1}: must be an object.`); return null; }
  const id = str(s.id || `s${i + 1}`, 16);
  if (!ID_RE.test(id) || RESERVED_IDS.has(id)) { errors.push(`${where}: id "${id}" must start with a letter, use a-z, 0-9 or _, and not be a reserved word (${[...RESERVED_IDS].join(", ")}).`); return null; }
  if (seen.has(id)) { errors.push(`${where}: id "${id}" is used twice.`); return null; }
  const type = str(s.type, 10);
  if (!STEP_TYPES.includes(type)) { errors.push(`${where}: type must be tool, rule or ai.`); return null; }
  const out = { id, type };
  if (s.label) out.label = str(s.label, 80);
  if (type === "tool") {
    const t = d.tools[s.tool];
    if (!t) { errors.push(`${where}: "${s.tool}" is not a tool.`); return null; }
    if (t.builtin) { errors.push(`${where}: "${s.tool}" only works inside an AI step.`); return null; }
    const args = isObj(s.args) ? s.args : {};
    const props = t.parameters?.properties || {};
    const req = t.parameters?.required || [];
    const clean = {};
    for (const [k, v] of Object.entries(args)) {
      if (!props[k]) { errors.push(`${where}: "${s.tool}" has no argument "${k}".`); continue; }
      if (!substitutesOk(v)) { errors.push(`${where}: "${v}" is not a variable. Use $symbol, $event.<field> or $prev.<field>.`); continue; }
      clean[k] = typeof v === "string" ? str(v, 300) : v;
    }
    for (const k of req) if (clean[k] === undefined) { if (k === "symbol") clean.symbol = "$symbol"; else errors.push(`${where}: "${s.tool}" needs "${k}".`); }
    out.tool = s.tool; out.args = clean;
    return out;
  }
  if (type === "rule") {
    const c = checkCondition(s.if, `${where} rule`, seen, errors, d);
    if (!c) return null;
    out.if = c;
    out.else = s.else === "continue" ? "continue" : "stop";
    return out;
  }
  // ai
  const tier = TIERS.includes(s.tier) ? s.tier : "cheap";
  if (s.tier && !TIERS.includes(s.tier)) warnings.push(`${where}: tier "${s.tier}" is not cheap, mid or top; using cheap.`);
  const instructions = str(s.instructions, LIMITS.instructions + 1);
  if (instructions.length < 10) { errors.push(`${where}: tell the AI what to do (at least a sentence).`); return null; }
  if (instructions.length > LIMITS.instructions) { errors.push(`${where}: instructions are over ${LIMITS.instructions} characters.`); return null; }
  const tools = Array.isArray(s.tools) ? [...new Set(s.tools.map(String))] : [];
  if (tools.length > LIMITS.toolsPerAi) errors.push(`${where}: at most ${LIMITS.toolsPerAi} tools per AI step.`);
  for (const t of tools) if (!d.tools[t]) errors.push(`${where}: "${t}" is not a tool.`);
  const maxSteps = Math.round(Number(s.maxSteps ?? (tools.length ? 6 : 1)));
  if (!(maxSteps >= 1 && maxSteps <= LIMITS.aiMaxSteps)) { errors.push(`${where}: maxSteps must be 1-${LIMITS.aiMaxSteps}.`); return null; }
  if (tools.length && maxSteps < 2) warnings.push(`${where}: with tools, maxSteps 1 leaves no turn to answer after a tool call; use 2 or more.`);
  const output = AI_OUTPUTS.includes(s.output) ? s.output : "brief";
  if (s.output && !AI_OUTPUTS.includes(s.output)) errors.push(`${where}: output must be one of ${AI_OUTPUTS.join(", ")}.`);
  Object.assign(out, { tier, instructions, tools: tools.filter((t) => d.tools[t]), maxSteps, output, recall: s.recall !== false });
  return out;
}

function normOutput(o, i, errors) {
  const where = `Output ${i + 1}`;
  if (!isObj(o)) { errors.push(`${where}: must be an object.`); return null; }
  const type = str(o.type, 20);
  if (!OUTPUT_TYPES.includes(type)) { errors.push(`${where}: "${type || "(blank)"}" is not an output. Use one of ${OUTPUT_TYPES.join(", ")}.`); return null; }
  const out = { type };
  const when = str(o.when || (type === "notify" ? "changed" : "always"), 40);
  if (!WHEN.test(when)) { errors.push(`${where}: "when" must be always, changed, nonempty, verdict:<v>, verdict_not:<v>, score_gt:<n> or score_lt:<n>.`); return null; }
  out.when = when;
  if (type === "notify") {
    out.who = NOTIFY_WHO.includes(o.who) ? o.who : "owner";
    out.tier = NOTIFY_TIER.includes(o.tier) ? o.tier : "digest";
    if (o.who && !NOTIFY_WHO.includes(o.who)) errors.push(`${where}: who must be owner, followers or team.`);
    if (o.tier && !NOTIFY_TIER.includes(o.tier)) errors.push(`${where}: tier must be push, inbox or digest.`);
  } else if (type === "memory") {
    out.scope = MEMORY_SCOPES.includes(o.scope) ? o.scope : "symbol";
    out.kind = MEMORY_KINDS.includes(o.kind) ? o.kind : "observation";
    if (o.scope && !MEMORY_SCOPES.includes(o.scope)) errors.push(`${where}: memory scope must be one of ${MEMORY_SCOPES.join(", ")}.`);
    if (o.kind && !MEMORY_KINDS.includes(o.kind)) errors.push(`${where}: memory kind must be one of ${MEMORY_KINDS.join(", ")}.`);
  } else if (type === "proposal") {
    if (!PROPOSAL_KINDS.includes(o.kind)) { errors.push(`${where}: proposal kind must be one of ${PROPOSAL_KINDS.join(", ")}.`); return null; }
    out.kind = o.kind;
  } else if (type === "handoff") {
    const topic = str(o.topic, 40).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(topic)) { errors.push(`${where}: a handoff needs a topic like "thesis".`); return null; }
    out.topic = topic;
    if (o.to) {
      const to = str(o.to, 48).toLowerCase();
      if (!SLUG_RE.test(to)) errors.push(`${where}: "to" must be an agent's short name (slug).`);
      else out.to = to;
    }
  } else if (type === "feed") {
    if (o.importance && ["high", "normal", "low"].includes(o.importance)) out.importance = o.importance;
  }
  return out;
}

// Returns { spec, errors, warnings }. Never throws on member input.
function normalize(input, { stepTools } = {}) {
  const errors = [], warnings = [];
  const d = deps();
  if (stepTools) d.tools = stepTools;
  let raw = input;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return { spec: null, errors: [{ path: "", message: "The spec is not valid JSON." }], warnings }; } }
  if (!isObj(raw)) return { spec: null, errors: [{ path: "", message: "The spec must be a JSON object." }], warnings };
  const spec = { v: 1 };

  // Scope
  const sc = isObj(raw.scope) ? raw.scope : { universe: "holdings" };
  const universe = SCOPES.includes(sc.universe) ? sc.universe : null;
  if (!universe) errors.push(`Scope: universe must be one of ${SCOPES.join(", ")}.`);
  spec.scope = { universe: universe || "holdings" };
  if (universe === "symbols") {
    const syms = Array.isArray(sc.symbols) ? [...new Set(sc.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))] : [];
    const bad = syms.filter((s) => !TICKER_RE.test(s));
    if (bad.length) errors.push(`Scope: not tickers: ${bad.slice(0, 5).join(", ")}.`);
    if (!syms.length) errors.push("Scope: list at least one ticker, or pick holdings or watchlist.");
    if (syms.length > LIMITS.symbols) errors.push(`Scope: at most ${LIMITS.symbols} tickers.`);
    spec.scope.symbols = syms.filter((s) => TICKER_RE.test(s)).slice(0, LIMITS.symbols);
  }

  // Triggers
  const trig = Array.isArray(raw.triggers) ? raw.triggers : [];
  if (!trig.length) errors.push("Add at least one trigger (a schedule, an event, or manual).");
  if (trig.length > LIMITS.triggers) errors.push(`At most ${LIMITS.triggers} triggers.`);
  spec.triggers = trig.slice(0, LIMITS.triggers).map((t, i) => normTrigger(t, i, errors, warnings)).filter(Boolean);

  // Steps (ids collected first so conditions can reference them)
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (steps.length > LIMITS.steps) errors.push(`At most ${LIMITS.steps} steps.`);
  const seen = new Set();
  spec.steps = [];
  for (const [i, s] of steps.slice(0, LIMITS.steps).entries()) {
    const n = normStep(s, i, seen, errors, warnings, d);
    if (n) { spec.steps.push(n); seen.add(n.id); }
  }
  const aiCount = spec.steps.filter((s) => s.type === "ai").length;
  if (aiCount > LIMITS.aiSteps) errors.push(`At most ${LIMITS.aiSteps} AI steps.`);

  // Conditions: evaluated before any step, so they can't name step ids.
  const conds = Array.isArray(raw.conditions) ? raw.conditions : [];
  if (conds.length > LIMITS.conditions) errors.push(`At most ${LIMITS.conditions} conditions.`);
  spec.conditions = conds.slice(0, LIMITS.conditions).map((c, i) => checkCondition(c, `Condition ${i + 1}`, new Set(), errors, d)).filter(Boolean);

  // Outputs
  const outs = Array.isArray(raw.outputs) ? raw.outputs : [];
  if (outs.length > LIMITS.outputs) errors.push(`At most ${LIMITS.outputs} outputs.`);
  spec.outputs = outs.slice(0, LIMITS.outputs).map((o, i) => normOutput(o, i, errors)).filter(Boolean);
  if (!spec.outputs.length) warnings.push("No outputs: runs will be recorded but nobody will see the result unless they open the run.");
  if (spec.outputs.some((o) => o.when.startsWith("verdict")) && !spec.steps.some((s) => s.type === "ai" && s.output === "verdict")) warnings.push('An output waits for a verdict, but no AI step has output "verdict".');
  if (spec.outputs.some((o) => o.type === "thesis_check") && spec.scope.universe === "fund") errors.push("A thesis check needs a symbol scope (holdings, watchlist or symbols), not the whole fund.");

  // Budget
  const b = isObj(raw.budget) ? raw.budget : {};
  spec.budget = {
    perRunUsd: clampMoney(b.perRunUsd, DEFAULT_BUDGET.perRunUsd, MAX_BUDGET.perRunUsd, "perRunUsd", errors),
    perMonthUsd: clampMoney(b.perMonthUsd, DEFAULT_BUDGET.perMonthUsd, MAX_BUDGET.perMonthUsd, "perMonthUsd", errors),
  };
  const mrd = raw.maxRunsPerDay == null ? DEFAULT_MAX_RUNS_PER_DAY : Math.round(Number(raw.maxRunsPerDay));
  if (!(mrd >= 1 && mrd <= 200)) errors.push("maxRunsPerDay must be 1-200.");
  spec.maxRunsPerDay = mrd >= 1 && mrd <= 200 ? mrd : DEFAULT_MAX_RUNS_PER_DAY;
  if (raw.quietHours != null) {
    const q = raw.quietHours;
    if (!isObj(q) || !/^\d{1,2}$/.test(String(q.from)) || !/^\d{1,2}$/.test(String(q.to)) || q.from > 23 || q.to > 23) errors.push('quietHours must look like {"from": 22, "to": 7, "tz": "America/New_York"}.');
    else spec.quietHours = { from: Number(q.from), to: Number(q.to), tz: isValidTz(q.tz) ? q.tz : "America/New_York" };
  }
  spec.runAs = "owner";

  if (spec.steps.length === 0 && spec.outputs.some((o) => o.type !== "feed" && o.type !== "notify")) warnings.push("With no steps, only feed and notify outputs have something to say (the trigger and conditions).");
  const est = estimateCost(spec);
  if (est.perRunUsd > spec.budget.perRunUsd) warnings.push(`Budget: a full run could cost about $${est.perRunUsd.toFixed(3)}, above this agent's per-run budget of $${spec.budget.perRunUsd.toFixed(2)}; long runs will be stopped early.`);
  return { spec, errors: errors.map(withPath), warnings: warnings.map(withPath), estimate: est };
}

// "Step 2 (a1): ..." -> { path: "steps[1]", message }. The builder highlights the field.
const PATHS = [[/^Trigger (\d+)/, "triggers"], [/^Step (\d+)/, "steps"], [/^Condition (\d+)/, "conditions"], [/^Output (\d+)/, "outputs"]];
function withPath(message) {
  if (typeof message !== "string") return message;
  for (const [re, key] of PATHS) { const m = message.match(re); if (m) return { path: `${key}[${Number(m[1]) - 1}]`, message }; }
  if (/^Scope/.test(message)) return { path: "scope", message };
  if (/^Budget/.test(message)) return { path: "budget", message };
  if (/^Add at least one trigger|^At most \d+ triggers/.test(message)) return { path: "triggers", message };
  if (/ steps\.$/.test(message)) return { path: "steps", message };
  if (/outputs\.$|^No outputs|^An output|^A thesis check/.test(message)) return { path: "outputs", message };
  if (/^maxRunsPerDay/.test(message)) return { path: "maxRunsPerDay", message };
  if (/^quietHours/.test(message)) return { path: "quietHours", message };
  return { path: "", message };
}

function clampMoney(v, def, max, name, errors) {
  if (v == null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) { errors.push(`Budget ${name} must be a positive dollar amount.`); return def; }
  if (n > max) { errors.push(`Budget ${name} can be at most $${max}.`); return max; }
  return Math.round(n * 1000) / 1000;
}

class SpecError extends Error {
  constructor(errors, warnings = []) {
    const msgs = errors.map((e) => (typeof e === "string" ? e : e.message));
    super(msgs.length === 1 ? msgs[0] : `The agent has ${msgs.length} problems: ${msgs.join(" ")}`);
    this.status = 400; this.expose = true; this.errors = errors; this.warnings = warnings;
  }
}

function validate(input, opts) {
  const r = normalize(input, opts);
  if (r.errors.length) throw new SpecError(r.errors, r.warnings);
  return r;
}

// ---- Cost estimate ----

function priceFor(tier) {
  try {
    const { TIERS: T } = require("./runs");
    const openai = require("../sources/openai");
    const model = T[tier]();
    const c = openai.costOf(model, { input: TURN_TOKENS.input, output: TURN_TOKENS.output, cached: Math.round(TURN_TOKENS.input * TURN_TOKENS.cachedShare) });
    if (c != null) return c;
  } catch { /* fall through */ }
  return { cheap: 0.001, mid: 0.02, top: 0.06 }[tier];
}

// Worst case and typical cost of one run per symbol, and a month at the schedule's pace.
// Rule and tool steps cost nothing; each AI step costs up to maxSteps model turns (plus web
// searches if it has web_search). Typical assumes about half the turns are used.
function estimateCost(spec, { symbols = null } = {}) {
  let max = 0;
  const perStep = [];
  for (const s of spec.steps || []) {
    if (s.type !== "ai") continue;
    const turn = priceFor(s.tier);
    const searches = (s.tools || []).includes("web_search") ? Math.min(3, s.maxSteps) * (Number(process.env.WEB_SEARCH_COST_USD) || 0.01) : 0;
    const c = turn * s.maxSteps + searches;
    perStep.push({ id: s.id, tier: s.tier, maxUsd: round4(c) });
    max += c;
  }
  const typical = max ? max * 0.5 : 0;
  const n = symbols ?? (spec.scope?.universe === "symbols" ? (spec.scope.symbols || []).length : spec.scope?.universe === "fund" ? 1 : 10);
  const runsPerMonth = estimateRunsPerMonth(spec);
  const monthly = runsPerMonth == null ? null : Math.min(typical * n * runsPerMonth, spec.budget?.perMonthUsd ?? Infinity);
  return { perRunUsd: round4(max), typicalRunUsd: round4(typical), symbols: n, runsPerMonth, monthlyUsd: monthly == null ? null : round4(monthly), free: max === 0, perStep };
}

function estimateRunsPerMonth(spec) {
  let total = 0, known = false;
  for (const t of spec.triggers || []) {
    if (t.type !== "schedule") continue;
    known = true;
    total += cronPerMonth(t.preset ? PRESETS[t.preset].cron : t.cron);
  }
  if (!known) return null; // event-driven: depends on the market
  return Math.min(total, (spec.maxRunsPerDay || DEFAULT_MAX_RUNS_PER_DAY) * 30);
}

// ---- Cron helpers (5-field subset: numbers, *, lists, ranges, steps). Firing times come from
// lib/platform/cron.js; these only check syntax and count fires for the estimate. ----

const FIELDS = [["minute", 0, 59], ["hour", 0, 23], ["day of month", 1, 31], ["month", 1, 12], ["day of week", 0, 7]];
function expand(field, lo, hi) {
  const out = new Set();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    let a = lo, b = hi;
    if (m[1] !== "*") { const [x, y] = m[1].split("-").map(Number); a = x; b = y ?? x; if (m[2] && y == null) b = hi; }
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
function cronError(cron) {
  if (!cron) return "a schedule needs a cron line (like \"30 8 * * 1-5\") or a preset.";
  const parts = cron.split(" ");
  if (parts.length !== 5) return `"${cron}" needs 5 fields: minute hour day-of-month month day-of-week.`;
  for (let i = 0; i < 5; i++) if (!expand(parts[i], FIELDS[i][1], FIELDS[i][2])) return `the ${FIELDS[i][0]} field "${parts[i]}" isn't valid (allowed ${FIELDS[i][1]}-${FIELDS[i][2]}, *, lists, ranges, /steps).`;
  return null;
}
function cronParts(cron) { return cron.split(" ").map((p, i) => expand(p, FIELDS[i][1], FIELDS[i][2])); }
function cronFiresTooOften(cron) { const [m, h] = cronParts(cron); return m.size > 1 && h.size >= 1; }
function cronPerMonth(cron) {
  if (cronError(cron)) return 0;
  const [m, h, dom, mon, dow] = cronParts(cron);
  const parts = cron.split(" ");
  const dows = new Set([...dow].map((d) => d % 7));
  // Days per month the cron matches: standard cron ORs day-of-month and day-of-week when both
  // are restricted.
  const domStar = parts[2] === "*", dowStar = parts[4] === "*";
  let days;
  if (domStar && dowStar) days = 30;
  else if (domStar) days = (dows.size / 7) * 30;
  else if (dowStar) days = Math.min(dom.size, 30);
  else days = Math.min(30, dom.size + (dows.size / 7) * 30);
  return Math.round(m.size * h.size * days * (mon.size / 12));
}

function isValidTz(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
const round4 = (v) => Math.round(v * 10000) / 10000;

// Plain-English summary of a spec ("Runs weekdays 8:30 AM ET on holdings; when price falls 5%...").
function describe(spec) {
  const parts = [];
  const scope = spec.scope?.universe === "symbols" ? (spec.scope.symbols || []).join(", ") : spec.scope?.universe === "fund" ? "the whole fund" : `every ${spec.scope?.universe === "watchlist" ? "watchlist name" : "holding"}`;
  const when = (spec.triggers || []).map((t) => {
    if (t.type === "manual") return "when someone runs it";
    if (t.type === "schedule") return t.preset ? PRESETS[t.preset].label.replace(/^./, (c) => c.toLowerCase()) : `on schedule "${t.cron}" (${t.tz})`;
    if (t.type === "handoff") return `when another agent hands off on "${t.topic}"`;
    const e = EVENTS[t.on];
    return `on ${e ? e.label : t.on}${t.on === "price_move" && t.sigma ? ` (${t.sigma}σ)` : ""}${t.on === "earnings_soon" ? ` (${t.days} days before)` : ""}`;
  });
  parts.push(`Watches ${scope}, ${when.join(" or ")}.`);
  if (spec.conditions?.length) parts.push(`Only if ${spec.conditions.map((c) => `${c.metric} ${c.op}${c.value != null ? ` ${Array.isArray(c.value) ? c.value.join("/") : c.value}` : ""}`).join(" and ")}.`);
  const ai = (spec.steps || []).filter((s) => s.type === "ai").length;
  const rules = (spec.steps || []).filter((s) => s.type !== "ai").length;
  parts.push(ai ? `${rules ? `${rules} data/rule step${rules > 1 ? "s" : ""}, then ` : ""}${ai} AI step${ai > 1 ? "s" : ""}.` : rules ? `${rules} data/rule step${rules > 1 ? "s" : ""}, no AI (free).` : "No steps.");
  if (spec.outputs?.length) parts.push(`Results go to: ${spec.outputs.map((o) => (o.type === "notify" ? `notify ${o.who} (${o.tier})` : o.type === "handoff" ? `handoff "${o.topic}"` : o.type.replace("_", " "))).join(", ")}.`);
  return parts.join(" ");
}

// The JSON schema an AI step's answer must follow, by output kind. Every kind carries `summary`
// and `claims` (each claim cites a source_url from the tool data), so outputs and the feed can
// show something uniform.
function outputSchema(kind) {
  const claim = { type: "object", additionalProperties: false, required: ["text", "source_url"], properties: { text: { type: "string" }, source_url: { type: "string" } } };
  const base = { summary: { type: "string", description: "1-3 sentences: what the agent found." }, claims: { type: "array", items: claim } };
  const req = ["summary", "claims"];
  const extra = {
    brief: { headline: { type: "string", description: "Under 90 characters." } },
    verdict: { verdict: { type: "string", enum: ["intact", "watch", "weakened", "broken", "unknown"] }, reason: { type: "string" } },
    score: { score: { type: "number", description: "-100 (very negative) to 100 (very positive)." }, label: { type: "string" } },
    list: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "text", "source_url"], properties: { symbol: { type: "string" }, text: { type: "string" }, source_url: { type: "string" } } } } },
    scenario: { bullProb: { type: "number" }, baseProb: { type: "number" }, bearProb: { type: "number" }, note: { type: "string" } },
  }[kind] || {};
  return { type: "object", additionalProperties: false, required: [...req, ...Object.keys(extra)], properties: { ...base, ...extra } };
}

module.exports = {
  normalize, validate, estimateCost, describe, outputSchema, SpecError,
  cronError, cronPerMonth, isValidTz,
  LIMITS, SCOPES, PRESETS, EVENTS, OPS, STEP_TYPES, TIERS, AI_OUTPUTS, OUTPUT_TYPES, PROPOSAL_KINDS, MEMORY_KINDS, MEMORY_SCOPES,
  DEFAULT_BUDGET, MAX_BUDGET, DEFAULT_MAX_RUNS_PER_DAY, SLUG_RE,
};
