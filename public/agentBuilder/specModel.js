// Pure helpers behind the agent builder (no DOM; unit-tested in test/builder.test.js):
// the choices the form offers, a plain-English summary of a spec, a rough cost estimate, light
// client-side checks, and a readable diff between two versions. The server (lib/agents/spec.js)
// is the authority on validity and cost; these keep the form responsive while you type.
import { toolLabel } from "../aiFormat.js";

export const MAX_STEPS = 12;
export const MAX_AI_STEPS = 3;

export const UNIVERSES = [
  { key: "holdings", label: "Holdings", hint: "Every stock the fund owns" },
  { key: "watchlist", label: "Watchlist", hint: "Names the team is watching" },
  { key: "symbols", label: "Specific tickers", hint: "Only the tickers you list" },
  { key: "fund", label: "Whole fund", hint: "Runs once for the fund, not per stock" },
];

export const PRESETS = [
  { key: "premarket", label: "Before the open", text: "every weekday at 8:30 AM ET", cron: "30 8 * * 1-5" },
  { key: "close", label: "After the close", text: "every weekday at 4:30 PM ET", cron: "30 16 * * 1-5" },
  { key: "open", label: "At the open", text: "every weekday at the open (9:30 AM ET)", cron: "30 9 * * 1-5" },
  { key: "hourly_market", label: "Hourly in market hours", text: "every hour while the market is open", cron: "30 9-15 * * 1-5" },
  { key: "weekly_mon", label: "Mondays", text: "every Monday morning", cron: "0 8 * * 1" },
  { key: "weekly_fri", label: "Fridays", text: "every Friday at 4:30 PM ET", cron: "30 16 * * 5" },
  { key: "monthly", label: "Monthly", text: "once a month", cron: "0 8 1 * *" },
];

// Event triggers. `param` is the one number a member can tune; `perSymbolMonth` is a rough
// guess at how often it fires for one stock in a month, used only for the cost estimate.
export const EVENTS = [
  { on: "filing", label: "New SEC filing", text: "a new filing lands", forms: ["8-K", "10-Q", "10-K"], perSymbolMonth: 1.2 },
  { on: "price_move", label: "Unusual price move", text: "the stock moves more than {n}σ in a day", param: { key: "sigma", label: "Size (σ)", min: 1, max: 5, step: 0.5, def: 2 }, perSymbolMonth: 1 },
  { on: "earnings_soon", label: "Earnings coming up", text: "earnings are {n} days away", param: { key: "days", label: "Days before", min: 1, max: 30, step: 1, def: 7 }, perSymbolMonth: 0.34 },
  { on: "insider_buy", label: "Insider buying", text: "an insider buys", perSymbolMonth: 0.3 },
  { on: "estimate_revision", label: "Estimate revision", text: "analysts revise estimates", perSymbolMonth: 1 },
  { on: "news_high", label: "Important news", text: "high-importance news breaks", perSymbolMonth: 1.5 },
  { on: "tripwire", label: "Tripwire hit", text: "a tripwire trips", perSymbolMonth: 0.2 },
  { on: "thirteenf", label: "13F changes", text: "new 13F holdings come in", perSymbolMonth: 0.34 },
  { on: "ips_breach", label: "Policy limit breached", text: "a policy limit is breached", perSymbolMonth: 0.1, fundLevel: true },
  { on: "pitch_status", label: "Pitch status changes", text: "a pitch changes status", perSymbolMonth: 1, fundLevel: true },
  { on: "thesis_change", label: "Thesis status changes", text: "a thesis pillar changes status", perSymbolMonth: 0.3 },
  { on: "agent_output", label: "Another agent posts", text: "another agent posts a result", perSymbolMonth: 2, fundLevel: true },
];
export const eventDef = (on) => EVENTS.find((e) => e.on === on);

export const OPS = [
  { op: "<", label: "is below" }, { op: "<=", label: "is at most" }, { op: ">", label: "is above" }, { op: ">=", label: "is at least" },
  { op: "==", label: "equals" }, { op: "!=", label: "is not" }, { op: "crosses_above", label: "crosses above" }, { op: "crosses_below", label: "crosses below" },
  { op: "changed", label: "changed since last run", noValue: true }, { op: "pct_change_gt", label: "changed by more than (%)" }, { op: "in", label: "is one of" },
];
export const opDef = (op) => OPS.find((o) => o.op === op) || { op, label: op };

// Model tiers and a deliberately rough per-AI-step cost (calls × typical tokens; input is
// mostly prompt-cache hits after the first step). The server's estimate replaces this.
export const TIERS = [
  { key: "cheap", label: "Fast", hint: "Lookups and short checks", inUsd: 0.10, outUsd: 0.50 },
  { key: "mid", label: "Balanced", hint: "Most analysis", inUsd: 2.00, outUsd: 10.00 },
  { key: "top", label: "Deep", hint: "Hard judgment calls, about 5× the cost", inUsd: 10.00, outUsd: 50.00 },
];
const CALL_IN_TOKENS = 2500, CALL_OUT_TOKENS = 400;
export function aiStepCost(step) {
  const t = TIERS.find((x) => x.key === step.tier) || TIERS[1];
  const calls = Math.max(1, Math.min(12, Number(step.maxSteps) || 6));
  return calls * (CALL_IN_TOKENS * t.inUsd + CALL_OUT_TOKENS * t.outUsd) / 1e6;
}

export const AI_OUTPUTS = [
  { key: "brief", label: "Short brief" }, { key: "verdict", label: "Verdict (intact / watch / broken)" }, { key: "score", label: "Score 0-10" },
  { key: "list", label: "Ranked list" }, { key: "scenario", label: "Bull / base / bear" },
];

export const OUTPUT_KINDS = [
  { type: "feed", label: "Post to the team feed" },
  { type: "notify", label: "Notify people" },
  { type: "memory", label: "Save to shared memory" },
  { type: "thesis_check", label: "Record a thesis check" },
  { type: "proposal", label: "Suggest a change for approval" },
  { type: "handoff", label: "Hand off to another agent" },
];
export const WHEN = [
  { key: "always", label: "every run" }, { key: "changed", label: "only when the result changed" }, { key: "nonempty", label: "only when it found something" },
  { key: "verdict_not:intact", label: "only when the verdict isn't intact" }, { key: "score_gt:7", label: "only when the score is above 7" },
];
export function describeWhen(w) {
  if (!w || w === "always") return "";
  if (w === "changed") return " when the result changes";
  if (w === "nonempty") return " when it finds something";
  const [k, v] = String(w).split(":");
  if (k === "verdict") return ` when the verdict is ${v}`;
  if (k === "verdict_not") return ` when the verdict isn't ${v}`;
  if (k === "score_gt") return ` when the score is above ${v}`;
  if (k === "score_lt") return ` when the score is below ${v}`;
  return ` when ${w}`;
}
export const PROPOSAL_KINDS = [
  { key: "thesis_status", label: "thesis status" }, { key: "pillar_status", label: "pillar status" }, { key: "tripwire", label: "tripwire" }, { key: "watchlist_add", label: "watchlist addition" },
];
export const WHO = [{ key: "owner", label: "me" }, { key: "followers", label: "followers" }, { key: "team", label: "the whole team" }];
export const NOTIFY_TIERS = [{ key: "push", label: "right away" }, { key: "inbox", label: "in their inbox" }, { key: "digest", label: "in the daily digest" }];

// Metric names the engine knows. The live list comes from GET /api/metrics; this is the
// fallback so the form still works before that route exists.
export const FALLBACK_METRICS = [
  { name: "quote.price", label: "Price", unit: "$", group: "Price" },
  { name: "quote.changePct", label: "Change today", unit: "%", group: "Price" },
  { name: "price.moveSigma", label: "Move vs normal (σ)", unit: "σ", group: "Price" },
  { name: "price.rsi14", label: "RSI (14 days)", unit: "", group: "Price" },
  { name: "valuation.pe", label: "P/E", unit: "×", group: "Valuation" },
  { name: "valuation.evEbitda", label: "EV/EBITDA", unit: "×", group: "Valuation" },
  { name: "valuation.fcfYield", label: "FCF yield", unit: "%", group: "Valuation" },
  { name: "fundamentals.revenueGrowthYoY", label: "Revenue growth (YoY)", unit: "%", group: "Fundamentals" },
  { name: "fundamentals.grossMargin", label: "Gross margin", unit: "%", group: "Fundamentals" },
  { name: "street.epsRevision30dPct", label: "EPS estimate change (30 days)", unit: "%", group: "Street" },
  { name: "ownership.shortPctFloat", label: "Short interest", unit: "%", group: "Ownership" },
  { name: "ownership.insiderBuys90d", label: "Insider net buys (90 days)", unit: "$", group: "Ownership" },
  { name: "fund.weightPct", label: "Weight in fund", unit: "%", group: "Fund" },
  { name: "fund.targetDistancePct", label: "Distance to target", unit: "%", group: "Fund" },
  { name: "fund.tripwireDistancePct", label: "Distance to tripwire", unit: "%", group: "Fund" },
  { name: "street.nextEarningsDays", label: "Days to earnings", unit: "days", group: "Events" },
];

const clone = (x) => JSON.parse(JSON.stringify(x));

export function defaultSpec() {
  return {
    v: 1,
    scope: { universe: "holdings", symbols: [] },
    triggers: [{ type: "schedule", preset: "premarket", tz: "America/New_York" }, { type: "manual" }],
    conditions: [],
    steps: [{ id: "a1", type: "ai", tier: "mid", instructions: "", tools: [], maxSteps: 6, output: "brief", recall: true }],
    outputs: [{ type: "feed", when: "always" }],
    budget: { perRunUsd: 0.10, perMonthUsd: 3 },
    runAs: "owner",
  };
}

// Fills in anything missing so the form can always render a spec from the server, a template
// or the draft endpoint. Does not drop unknown fields: the engine may know things the form doesn't.
export function normalize(input) {
  const s = Object.assign(defaultSpec(), clone(input || {}));
  s.scope = Object.assign({ universe: "holdings", symbols: [] }, s.scope || {});
  s.scope.symbols = (s.scope.symbols || []).map((x) => String(x).toUpperCase());
  for (const k of ["triggers", "conditions", "steps", "outputs"]) if (!Array.isArray(s[k])) s[k] = [];
  if (!s.triggers.some((t) => t.type === "manual")) s.triggers.push({ type: "manual" });
  s.budget = Object.assign({ perRunUsd: 0.10, perMonthUsd: 3 }, s.budget || {});
  return s;
}

// A fresh step id that doesn't collide: d1, d2… for data, r1… for rules, a1… for AI.
export function nextStepId(spec, type) {
  const p = type === "tool" ? "d" : type === "rule" ? "r" : "a";
  const used = new Set((spec.steps || []).map((x) => x.id));
  for (let i = 1; ; i++) if (!used.has(`${p}${i}`)) return `${p}${i}`;
}

// ---- Cron: just enough to describe a schedule and count runs for the estimate ----

function field(src, min, max) {
  const out = new Set();
  for (const part of String(src).split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    let lo = min, hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a; hi = b == null || Number.isNaN(b) ? (stepRaw ? max : a) : b;
    }
    if (![lo, hi, step].every(Number.isInteger) || lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}
export function parseCron(expr) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mi, h, dom, mon, dow] = [field(parts[0], 0, 59), field(parts[1], 0, 23), field(parts[2], 1, 31), field(parts[3], 1, 12), field(parts[4], 0, 7)];
  if (!mi || !h || !dom || !mon || !dow) return null;
  if (dow.has(7)) dow.add(0);
  return { mi, h, dom, mon, dow, raw: parts };
}
// Runs in a 30-day window (calendar days, ignoring holidays and DST: it's an estimate).
export function cronRunsPerMonth(expr) {
  const c = parseCron(expr);
  if (!c) return 0;
  let n = 0;
  const start = Date.UTC(2026, 0, 5); // a Monday; any month-ish window works
  for (let d = 0; d < 30; d++) {
    const day = new Date(start + d * 864e5);
    if (!c.dom.has(day.getUTCDate()) || !c.mon.has(day.getUTCMonth() + 1) || !c.dow.has(day.getUTCDay())) continue;
    n += c.h.size * c.mi.size;
  }
  return n;
}
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
export function describeCron(expr) {
  const c = parseCron(expr);
  if (!c) return `on the schedule "${expr}"`;
  const one = (set) => set.size === 1 ? [...set][0] : null;
  const days = [...c.dow].filter((d) => d < 7).sort();
  const everyDay = c.raw[4] === "*" && c.raw[2] === "*";
  const weekdays = days.join(",") === "1,2,3,4,5" && c.raw[2] === "*";
  const dayText = everyDay ? "every day" : weekdays ? "every weekday" : c.raw[2] === "*" && days.length <= 3 ? `every ${days.map((d) => DAY[d]).join(" and ")}` : null;
  const h = one(c.h), m = one(c.mi);
  if (dayText && h != null && m != null) return `${dayText} at ${clock(h, m)}`;
  if (dayText && c.raw[1].startsWith("*/") && m != null) return `${dayText}, every ${c.raw[1].slice(2)} hours`;
  return `on the schedule "${c.raw.join(" ")}"`;
}
export const scheduleCron = (t) => t.cron || PRESETS.find((p) => p.key === t.preset)?.cron || null;
export function describeSchedule(t) {
  const p = PRESETS.find((x) => x.key === t.preset);
  if (p && !t.cron) return p.text;
  const tz = t.tz && t.tz !== "America/New_York" ? ` (${t.tz})` : " ET";
  return describeCron(t.cron) + (parseCron(t.cron) ? tz : "");
}

// ---- Plain-English summary ----

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinAnd = (xs) => xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const metricLabel = (name, metrics) => (metrics || FALLBACK_METRICS).find((m) => m.name === name)?.label || String(name || "a value").replace(/^\$?[a-z]\d+\./, "");
function fmtValue(v, unit) {
  if (Array.isArray(v)) return v.join(", ");
  if (unit === "%") return `${v}%`;
  if (unit === "$") return `$${v}`;
  if (unit === "σ") return `${v}σ`;
  return unit && unit !== "×" ? `${v} ${unit}` : `${v}${unit === "×" ? "×" : ""}`;
}
export function describeCondition(c, metrics) {
  const m = (metrics || FALLBACK_METRICS).find((x) => x.name === c.metric);
  const o = opDef(c.op);
  return `${lowerFirst(metricLabel(c.metric, metrics))} ${o.label}${o.noValue ? "" : ` ${fmtValue(c.value, m?.unit)}`}`;
}
export function describeEvent(t) {
  const d = eventDef(t.on);
  if (!d) return `a ${String(t.on || "").replace(/_/g, " ")} event happens`;
  if (t.on === "filing" && t.forms?.length) return `a new ${joinAnd(t.forms)} is filed`;
  return d.param ? d.text.replace("{n}", t[d.param.key] ?? d.param.def) : d.text;
}
function describeScope(scope) {
  if (scope.universe === "fund") return "for the fund as a whole";
  if (scope.universe === "watchlist") return "for each watchlist name";
  if (scope.universe === "symbols") return scope.symbols?.length ? `for ${joinAnd(scope.symbols)}` : "for the tickers you pick";
  return "for each holding";
}
function describeStep(s, metrics) {
  if (s.type === "tool") return `read ${toolLabel(s.tool)}`;
  if (s.type === "rule") return `stop unless ${describeCondition(s.if || {}, metrics)}`;
  const what = String(s.instructions || "").trim().replace(/\s+/g, " ");
  const short = what.length > 90 ? `${what.slice(0, 87).replace(/\s\S*$/, "")}…` : what;
  const tier = TIERS.find((t) => t.key === s.tier)?.label.toLowerCase() || "balanced";
  return `have AI (${tier}) ${short ? `"${short}"` : "write a " + (AI_OUTPUTS.find((o) => o.key === s.output)?.label.toLowerCase() || "brief")}`;
}
function describeOutput(o, agentsBySlug = {}) {
  const when = describeWhen(o.when);
  if (o.type === "feed") return `post to the team feed${when}`;
  if (o.type === "notify") return `notify ${WHO.find((w) => w.key === o.who)?.label || "me"}${o.tier === "push" ? " right away" : o.tier === "digest" ? " in the daily digest" : ""}${when}`;
  if (o.type === "memory") return "save what it found to shared memory";
  if (o.type === "thesis_check") return "record a thesis check";
  if (o.type === "proposal") return `suggest a ${PROPOSAL_KINDS.find((k) => k.key === o.kind)?.label || "change"} change for approval`;
  if (o.type === "handoff") return `hand off to ${o.to ? (agentsBySlug[o.to]?.name || o.to) : `agents listening on "${o.topic || "general"}"`}`;
  return o.type;
}

// "Every weekday at 8:30 AM ET and whenever the stock moves more than 2σ in a day, for each
// holding, if change today is below -5%: read company news, then have AI (balanced) "…", and
// post to the team feed."
export function describe(spec, { metrics, agentsBySlug } = {}) {
  const s = normalize(spec);
  const sched = s.triggers.filter((t) => t.type === "schedule").map(describeSchedule);
  const events = s.triggers.filter((t) => t.type === "event").map(describeEvent);
  const handoffs = s.triggers.filter((t) => t.type === "handoff").map((t) => `another agent hands off on "${t.topic || "general"}"`);
  const whenParts = [...sched, ...[...events, ...handoffs].map((e, i) => (i === 0 && !sched.length ? `Whenever ${e}` : `whenever ${e}`))];
  let when = whenParts.length ? joinAnd(whenParts) : "When someone presses Run";
  when = when.charAt(0).toUpperCase() + when.slice(1);
  const cond = s.conditions.length ? `, if ${joinAnd(s.conditions.map((c) => describeCondition(c, metrics)))}` : "";
  const steps = s.steps.map((x) => describeStep(x, metrics));
  const outs = s.outputs.map((o) => describeOutput(o, agentsBySlug));
  const doing = joinAnd([...steps, ...(outs.length ? [] : ["keep the result on the run page"])]);
  const tail = outs.length ? `${steps.length ? ", then " : ""}${joinAnd(outs)}` : "";
  return `${when}, ${describeScope(s.scope)}${cond}: ${doing}${tail}.`.replace(/: ,/, ":").replace(/\s+/g, " ");
}

// ---- Cost estimate ----

// How many runs a month: schedules × stocks in scope + expected event fires × stocks.
export function runsPerMonth(spec, { holdingsCount = 12, watchlistCount = 15 } = {}) {
  const s = normalize(spec);
  const n = s.scope.universe === "fund" ? 1 : s.scope.universe === "symbols" ? Math.max(1, s.scope.symbols.length)
    : s.scope.universe === "watchlist" ? watchlistCount : holdingsCount;
  let runs = 0;
  for (const t of s.triggers) {
    if (t.type === "schedule") runs += cronRunsPerMonth(scheduleCron(t)) * n;
    else if (t.type === "event") { const d = eventDef(t.on); runs += (d?.perSymbolMonth ?? 1) * (d?.fundLevel ? 1 : n); }
    else if (t.type === "handoff") runs += 2;
  }
  return Math.round(runs * 10) / 10;
}
// Conditions and rule steps filter runs before any AI; assume they let through about a third.
export function estimate(spec, opts = {}) {
  const s = normalize(spec);
  const ai = s.steps.filter((x) => x.type === "ai");
  const perRunUsd = ai.reduce((sum, x) => sum + aiStepCost(x), 0);
  const raw = runsPerMonth(s, opts);
  const gated = s.conditions.length > 0 || s.steps.some((x) => x.type === "rule");
  const aiRuns = gated ? raw / 3 : raw;
  const perMonthUsd = perRunUsd * aiRuns;
  const cap = Number(s.budget?.perMonthUsd) || null;
  return {
    perRunUsd, perMonthUsd, runsPerMonth: raw, aiFree: ai.length === 0,
    overBudget: cap != null && perMonthUsd > cap,
    overRunCap: s.budget?.perRunUsd != null && perRunUsd > Number(s.budget.perRunUsd),
    gated,
  };
}

// ---- Light checks (the server repeats these and more) ----

export function check(spec, { name, ...counts } = {}) {
  const s = normalize(spec), issues = [];
  const add = (path, message) => issues.push({ path, message });
  if (name != null && !String(name).trim()) add("name", "Give the agent a name.");
  if (s.scope.universe === "symbols" && !s.scope.symbols.length) add("scope.symbols", "List at least one ticker, or watch holdings instead.");
  for (const [i, t] of s.triggers.entries()) {
    if (t.type === "schedule" && t.cron && !parseCron(t.cron)) add(`triggers.${i}.cron`, `"${t.cron}" isn't a schedule the app understands. Use five parts, like 30 8 * * 1-5.`);
    if (t.type === "event" && !eventDef(t.on)) add(`triggers.${i}.on`, `Unknown event "${t.on}".`);
  }
  for (const [i, c] of s.conditions.entries()) {
    if (!c.metric) add(`conditions.${i}.metric`, "Pick what to compare in each condition.");
    else if (!opDef(c.op).noValue && (c.value === "" || c.value == null)) add(`conditions.${i}.value`, `Add a value for "${metricLabel(c.metric)}".`);
  }
  if (!s.steps.length) add("steps", "Add at least one step for the agent to do.");
  if (s.steps.length > MAX_STEPS) add("steps", `An agent can have at most ${MAX_STEPS} steps.`);
  const ai = s.steps.filter((x) => x.type === "ai");
  if (ai.length > MAX_AI_STEPS) add("steps", `At most ${MAX_AI_STEPS} AI steps per agent.`);
  const ids = new Set();
  for (const [i, x] of s.steps.entries()) {
    if (ids.has(x.id)) add(`steps.${i}.id`, `Two steps share the id ${x.id}.`);
    ids.add(x.id);
    if (x.type === "ai" && String(x.instructions || "").trim().length < 10) add(`steps.${i}.instructions`, "Tell the AI step what to do in a sentence or two.");
    if (x.type === "tool" && !x.tool) add(`steps.${i}.tool`, "Pick the data this step reads.");
    if (x.type === "rule" && !x.if?.metric) add(`steps.${i}.if`, "Pick what this rule checks.");
  }
  for (const [i, o] of s.outputs.entries()) {
    if (o.type === "proposal" && !o.kind) add(`outputs.${i}.kind`, "Pick what kind of change the agent may suggest.");
    if (o.type === "handoff" && !o.topic && !o.to) add(`outputs.${i}.topic`, "Name a topic or an agent to hand off to.");
  }
  if (!s.outputs.length) issues.push({ path: "outputs", message: "Results only show on the run page. Add the feed or a notification so people see them.", warn: true });
  const est = estimate(s, counts);
  if (est.overBudget) issues.push({ path: "budget.perMonthUsd", message: `The estimate (${usd(est.perMonthUsd)} a month) is above this agent's monthly cap, so it will pause when the cap is reached.`, warn: true });
  return issues;
}

export const usd = (v) => v == null ? "—" : v === 0 ? "$0" : v < 0.01 ? "<$0.01" : `$${v < 10 ? v.toFixed(2) : v.toFixed(0)}`;

// ---- Version diff: compare section by section and say what changed in words ----

const SECTION = { scope: "What to watch", triggers: "When", conditions: "Only if", steps: "What to do", outputs: "Where results go", budget: "Budget" };
const FIELD = { universe: "watching", symbols: "tickers", tier: "model", instructions: "instructions", tools: "tools", maxSteps: "tool-call limit", output: "output",
  recall: "uses memory", when: "when", who: "who", preset: "schedule", cron: "schedule", tz: "time zone", sigma: "move size", days: "days before", forms: "forms",
  perRunUsd: "per-run cap", perMonthUsd: "monthly cap", metric: "metric", op: "comparison", value: "value", kind: "kind", topic: "topic", to: "to", tool: "data", else: "otherwise", if: "rule" };
const show = (v) => v === undefined || v === null ? "nothing" : typeof v === "string" ? `"${v.length > 70 ? v.slice(0, 67) + "…" : v}"` : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : typeof v === "object" ? JSON.stringify(v) : String(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function itemKey(section, x, i) {
  if (section === "steps") return x.id || `#${i}`;
  if (section === "triggers") return x.type === "event" ? `event:${x.on}` : x.type === "handoff" ? `handoff:${x.topic}` : x.type;
  if (section === "outputs") return x.type === "handoff" ? `handoff:${x.topic || x.to}` : x.type;
  return `#${i}`;
}
function describeItem(section, x, metrics) {
  if (section === "triggers") return x.type === "schedule" ? `run ${describeSchedule(x)}` : x.type === "event" ? `run whenever ${describeEvent(x)}` : x.type === "handoff" ? `listen for handoffs on "${x.topic}"` : "run by hand";
  if (section === "conditions") return `only if ${describeCondition(x, metrics)}`;
  if (section === "steps") return `step ${x.id}: ${describeStep(x, metrics)}`;
  if (section === "outputs") return describeOutput(x);
  return show(x);
}
export function diffSpecs(before, after, { metrics } = {}) {
  const a = normalize(before), b = normalize(after), out = [];
  const push = (section, kind, text) => out.push({ section: SECTION[section] || "Other", kind, text });
  for (const section of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[section], y = b[section];
    if (same(x, y)) continue;
    if (Array.isArray(x) || Array.isArray(y)) {
      const ma = new Map((x || []).map((v, i) => [itemKey(section, v, i), v])), mb = new Map((y || []).map((v, i) => [itemKey(section, v, i), v]));
      for (const [k, v] of ma) if (!mb.has(k)) push(section, "removed", `Removed: ${describeItem(section, v, metrics)}`);
      for (const [k, v] of mb) {
        if (!ma.has(k)) { push(section, "added", `Added: ${describeItem(section, v, metrics)}`); continue; }
        const old = ma.get(k);
        if (same(old, v)) continue;
        const fields = [...new Set([...Object.keys(old), ...Object.keys(v)])].filter((f) => !same(old[f], v[f]));
        const label = section === "steps" ? `Step ${k}` : section === "outputs" ? OUTPUT_KINDS.find((o) => o.type === v.type)?.label || k : section === "triggers" ? (v.type === "event" ? eventDef(v.on)?.label || k : "Schedule") : `Condition ${k.slice(1) * 1 + 1}`;
        for (const f of fields) push(section, "changed", `${label}: ${FIELD[f] || f} ${show(old[f])} → ${show(v[f])}`);
      }
      const order = (m) => [...m.keys()].filter((k) => ma.has(k) && mb.has(k));
      if (section === "steps" && !same(order(ma), order(mb))) push(section, "changed", "Steps were reordered");
    } else if (x && y && typeof x === "object") {
      for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[f], y[f])) push(section, "changed", `${SECTION[section] || section}: ${FIELD[f] || f} ${show(x[f])} → ${show(y[f])}`);
    } else push(section, x === undefined ? "added" : y === undefined ? "removed" : "changed", `${FIELD[section] || section}: ${show(x)} → ${show(y)}`);
  }
  return out;
}
