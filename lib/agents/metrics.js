// Observability for agents (plan WS8): the run trace, per-agent stats, the fund's AI spend and
// health problems. Read-only queries over agent_runs, agent_feedback and (once WS1 lands) the
// agents table. Pure helpers are exported for tests.
const db = require("../../db");
const openai = require("../sources/openai");
const budget = require("./budget");
const schema = require("../schema/observability");

const DAY_MS = 864e5;
const WEB_SEARCH_USD = () => Number(process.env.WEB_SEARCH_COST_USD) || 0.01;
const FAILURE_STREAK = 3;           // this many failed runs in a row is a health problem
const SCHEDULE_GRACE_MS = 2 * 3600e3; // an agent this far past its next run time has stopped firing
const BUDGET_WARN = 0.8;            // red banner and an alert at 80% of a cap

// Feedback reason chips. Each maps to the verdict it implies when given on its own.
const REASONS = {
  wrong_number: { label: "Wrong number", verdict: "wrong" },
  wrong_source: { label: "Bad source", verdict: "wrong" },
  not_relevant: { label: "Not relevant", verdict: "not_useful" },
  already_knew: { label: "Already knew", verdict: "not_useful" },
  too_long: { label: "Too long", verdict: "not_useful" },
  great_catch: { label: "Great catch", verdict: "useful" },
  saved_time: { label: "Saved me time", verdict: "useful" },
};

// ---- small helpers ----

const tableExists = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const hasColumn = (table, column) => tableExists(table) && db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
const round = (v, d = 6) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const sqlTime = (d) => d.toISOString().replace("T", " ").slice(0, 19);
const parseTime = (s) => (s ? Date.parse(String(s).includes("T") ? s : `${String(s).replace(" ", "T")}Z`) : NaN);

function quantile(values, q) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

function tierOf(model) {
  if (!model) return "none";
  let TIERS = {};
  try { TIERS = require("./runs").TIERS; } catch { /* runs not loadable in some tests */ }
  for (const [tier, fn] of Object.entries(TIERS)) {
    const m = fn();
    if (model === m || String(model).startsWith(`${m}-`)) return tier;
  }
  return "other";
}

// Agents table rows by id (WS1). Empty before WS1 lands.
function agentRows() {
  if (!tableExists("agents")) return [];
  return db.prepare("SELECT id, slug, name, kind, workflow, ownerId, status, spec, nextRunAt, lastRunAt FROM agents").all()
    .map((a) => ({ ...a, spec: safeJson(a.spec, {}) }));
}
function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

// A run belongs to an agent: its agentId when the column exists (WS1), else its workflow name.
// Keys are "a<id>" or "w<workflow>" so both can live in one list.
function keyOf(run, byWorkflow) {
  if (run.agentId) return `a${run.agentId}`;
  const a = byWorkflow.get(run.workflow);
  return a ? `a${a.id}` : `w${run.workflow}`;
}
function keyFilter(key) {
  const s = String(key || "");
  if (/^a\d+$/.test(s) && hasColumn("agent_runs", "agentId")) {
    const a = agentRows().find((x) => x.id === Number(s.slice(1)));
    // Built-in agents' older runs predate agentId; count them by workflow too.
    if (a?.kind === "builtin" && a.workflow) return { sql: "(agentId = ? OR (agentId IS NULL AND workflow = ?))", args: [a.id, a.workflow], agent: a };
    return { sql: "agentId = ?", args: [Number(s.slice(1))], agent: a || null };
  }
  if (/^w[\w-]{1,60}$/.test(s)) return { sql: "workflow = ?", args: [s.slice(1)], agent: null };
  return null;
}

// ---- run trace ----

const TOOL_LABELS = { web_search: "Web search" };

// Cost of one model step. New steps carry costUsd; older ones are priced from their tokens.
function stepCost(s) {
  if (s.kind !== "model") return 0;
  if (Number.isFinite(s.costUsd)) return s.costUsd;
  const tokens = openai.costOf(s.model, { input: s.input || 0, cached: s.cached || 0, output: s.output || 0 });
  return tokens == null ? null : tokens + (s.webSearches?.length || 0) * WEB_SEARCH_USD();
}

// Turns a run's step log into a waterfall. Steps are logged when they finish, so a step's start
// is its time minus its duration. Older steps have no duration: a model step is assumed to have
// run since the step before it (marked estimated); a tool step as instant.
function trace(run) {
  const steps = run.steps || [];
  const t0 = parseTime(run.createdAt) || (steps[0] ? Date.parse(steps[0].at) : 0);
  const end = parseTime(run.finishedAt) || (steps.length ? Date.parse(steps[steps.length - 1].at) : t0);
  let prevEnd = t0;
  const spans = steps.map((s, i) => {
    const at = Date.parse(s.at);
    let ms = Number.isFinite(s.ms) ? s.ms : null, estimated = false;
    if (ms == null) { estimated = true; ms = s.kind === "model" ? Math.max(0, at - prevEnd) : 0; }
    const start = Math.max(0, at - ms - t0);
    prevEnd = Math.max(prevEnd, at);
    const span = { i, kind: s.kind, start, ms, estimated, at: s.at };
    if (s.kind === "model") {
      Object.assign(span, {
        label: s.toolCalls?.length ? `Model asks for ${s.toolCalls.length} tool${s.toolCalls.length === 1 ? "" : "s"}` : "Model answers",
        model: s.model || null, tier: s.tier || tierOf(s.model),
        tokens: { input: s.input || 0, cached: s.cached || 0, output: s.output || 0 },
        costUsd: round(stepCost(s)), toolCalls: s.toolCalls || [], webSearches: s.webSearches || [], incomplete: s.incomplete || null,
      });
    } else if (s.kind === "tool") {
      Object.assign(span, {
        label: TOOL_LABELS[s.name] || s.name, name: s.name, args: s.args ?? null, ok: s.ok !== false, error: s.error || null,
        sourceUrl: s.source_url || null, title: s.title || null, preview: s.preview || null, asOf: s.as_of || null, fromCache: !!s.cached,
      });
    } else if (s.kind === "source") {
      Object.assign(span, { label: "Read source", sourceUrl: s.url || null, chars: s.chars || 0, truncated: !!s.truncated });
    } else if (s.kind === "review") {
      Object.assign(span, { label: "Self-check sent back", note: s.note || "" });
    } else {
      // Memory reads/writes, handoffs, rule steps and child runs (WS2/WS5/WS6) log their own kinds;
      // show them with whatever they recorded.
      const { at: _a, kind: _k, ms: _m, ...rest } = s;
      Object.assign(span, { label: s.label || s.name || s.kind, detail: rest, childRunId: s.childRunId || s.runId || null });
    }
    return span;
  });
  const model = spans.filter((s) => s.kind === "model");
  const tools = spans.filter((s) => s.kind === "tool");
  const totals = {
    durationMs: Math.max(0, (Number.isFinite(end) ? end : t0) - t0),
    modelTurns: model.length, toolCalls: tools.length, toolErrors: tools.filter((s) => !s.ok).length,
    tokens: model.reduce((a, s) => ({ input: a.input + s.tokens.input, cached: a.cached + s.tokens.cached, output: a.output + s.tokens.output }), { input: 0, cached: 0, output: 0 }),
    costUsd: round(run.costUsd ?? model.reduce((a, s) => a + (s.costUsd || 0), 0)),
    modelMs: model.reduce((a, s) => a + s.ms, 0), toolMs: tools.reduce((a, s) => a + s.ms, 0),
    estimated: spans.some((s) => s.estimated),
  };
  totals.cacheHit = totals.tokens.input ? round(totals.tokens.cached / totals.tokens.input, 3) : 0;
  let children = [];
  if (hasColumn("agent_runs", "parentRunId")) {
    children = db.prepare("SELECT id, workflow, status, costUsd, createdAt, finishedAt FROM agent_runs WHERE parentRunId = ? ORDER BY id").all(run.id)
      .map((c) => ({ ...c, start: Math.max(0, parseTime(c.createdAt) - t0), ms: Math.max(0, (parseTime(c.finishedAt) || end) - parseTime(c.createdAt)) }));
  }
  return { spans, totals, verification: verification(run.output, steps), children };
}

// What the run's own checks found: quotes matched against sources, numbers no tool backs,
// claims without a source read in the run, and whether the self-check sent the draft back.
function verification(o, steps = []) {
  if (!o || typeof o !== "object") return null;
  const quotes = [];
  for (const p of o.points || []) if (p.quote) quotes.push(!!p.verified);
  for (const k of o.kpis || []) quotes.push(!!k.verified);
  for (const c of o.claims || []) if (c.quote) quotes.push(!!c.verified);
  const claims = o.claims || (o.sections || []).flatMap((s) => s.items || []);
  const out = {
    quotesChecked: quotes.length, quotesVerified: quotes.filter(Boolean).length,
    unbackedNumbers: o.unbackedNumbers || [],
    claims: claims.length, claimsSourced: claims.filter((c) => c.sourced !== false).length,
    revised: o.revised ?? steps.some((s) => s.kind === "review"),
    reviewNotes: steps.filter((s) => s.kind === "review").map((s) => s.note),
  };
  return out.quotesChecked || out.unbackedNumbers.length || out.claims || out.revised ? out : null;
}

// ---- per-agent stats ----

function runsSince(since, filter = null) {
  const cols = ["id", "workflow", "memberId", "symbol", "status", "model", "costUsd", "error", "createdAt", "finishedAt"];
  if (hasColumn("agent_runs", "agentId")) cols.push("agentId");
  if (hasColumn("agent_runs", "trigger")) cols.push("\"trigger\"");
  return db.prepare(`SELECT ${cols.join(", ")} FROM agent_runs WHERE createdAt >= ? ${filter ? `AND ${filter.sql}` : ""} ORDER BY id`)
    .all(sqlTime(since), ...(filter ? filter.args : []));
}

function feedbackFor(runIds) {
  schema.ensure(db);
  const out = { useful: 0, not_useful: 0, wrong: 0, reasons: {} };
  for (let i = 0; i < runIds.length; i += 400) {
    const chunk = runIds.slice(i, i + 400);
    if (!chunk.length) break;
    const rows = db.prepare(`SELECT verdict, reasons FROM agent_feedback WHERE runId IN (${chunk.map(() => "?").join(",")})`).all(...chunk);
    for (const r of rows) {
      out[r.verdict] = (out[r.verdict] || 0) + 1;
      for (const k of String(r.reasons || "").split(",").filter(Boolean)) out.reasons[k] = (out.reasons[k] || 0) + 1;
    }
  }
  const total = out.useful + out.not_useful + out.wrong;
  out.total = total;
  out.acceptance = total ? round(out.useful / total, 3) : null;
  return out;
}

const latencyMs = (r) => { const a = parseTime(r.createdAt), b = parseTime(r.finishedAt); return Number.isFinite(a) && Number.isFinite(b) ? b - a : null; };

function dayList(since, now) {
  const days = [];
  for (let t = Date.parse(`${since.toISOString().slice(0, 10)}T00:00:00Z`); t <= now.getTime(); t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

function failureStreak(rows) {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].status === "running") continue;
    if (rows[i].status === "failed") n++; else break;
  }
  return n;
}

// Expected fires per day for an agent from its schedule triggers (WS1's cron.nextRun), or a
// dry-run figure the builder saved in the spec (spec.expectedFiresPerWeek). Null when unknown.
function expectedPerDay(agent, now = new Date()) {
  if (!agent?.spec) return null;
  if (Number.isFinite(agent.spec.expectedFiresPerWeek)) return agent.spec.expectedFiresPerWeek / 7;
  const schedules = (agent.spec.triggers || []).filter((t) => t.type === "schedule");
  if (!schedules.length) return null;
  let cron;
  try { cron = require("../platform/cron"); } catch { return null; }
  let fires = 0;
  for (const t of schedules) {
    let at = new Date(now.getTime() - 7 * DAY_MS);
    for (let i = 0; i < 200; i++) {
      let next;
      try { next = cron.nextRun(t.cron || t.preset, t.tz || "America/New_York", at); } catch { break; }
      if (!next || next > now) break;
      fires++; at = new Date(next.getTime() + 60e3);
    }
  }
  return fires / 7;
}

function displayName(key, agentsById, labels = {}) {
  if (key.startsWith("a")) { const a = agentsById.get(Number(key.slice(1))); return a ? a.name : `Agent ${key.slice(1)}`; }
  const w = key.slice(1);
  return labels[w] || w;
}

function agentStats(key, { days = 30, now = new Date() } = {}) {
  const f = keyFilter(key);
  if (!f) return null;
  const since = new Date(now.getTime() - days * DAY_MS);
  const rows = runsSince(since, f);
  const finished = rows.filter((r) => r.status !== "running");
  const done = finished.filter((r) => r.status === "done").length;
  const failed = finished.filter((r) => r.status === "failed").length;
  const refused = finished.filter((r) => r.status === "refused").length;
  const perDay = Object.fromEntries(dayList(since, now).map((d) => [d, { runs: 0, failed: 0, costUsd: 0 }]));
  for (const r of rows) {
    const d = perDay[String(r.createdAt).slice(0, 10)];
    if (!d) continue;
    d.runs++; if (r.status === "failed") d.failed++; d.costUsd += r.costUsd || 0;
  }
  const costs = finished.map((r) => r.costUsd || 0);
  const lat = finished.map(latencyMs).filter((x) => x != null);
  const fb = feedbackFor(rows.map((r) => r.id));
  const monthStart = budget.monthStart(now);
  const monthSpend = rows.filter((r) => r.createdAt >= monthStart).reduce((a, r) => a + (r.costUsd || 0), 0);
  const agent = f.agent;
  const perMonthUsd = Number(agent?.spec?.budget?.perMonthUsd) || null;
  const expected = expectedPerDay(agent, now);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  let lastEval = null;
  try {
    schema.ensure(db);
    const name = agent?.slug || key.slice(1);
    const ev = db.prepare("SELECT COUNT(*) AS cases, SUM(pass) AS passed, MAX(createdAt) AS at FROM agent_eval_results WHERE agent = ? AND createdAt = (SELECT MAX(createdAt) FROM agent_eval_results WHERE agent = ?)").get(name, name);
    if (ev?.cases) lastEval = { cases: ev.cases, passed: ev.passed || 0, at: ev.at };
  } catch { /* no eval table */ }
  return {
    key, name: agent?.name || key.slice(1), agent: agent ? { id: agent.id, slug: agent.slug, kind: agent.kind, status: agent.status, ownerId: agent.ownerId, nextRunAt: agent.nextRunAt } : null,
    days, runs: rows.length, done, failed, refused,
    successRate: done + failed ? round(done / (done + failed), 3) : null,
    latencyMs: { median: quantile(lat, 0.5), p90: quantile(lat, 0.9) },
    costUsd: { total: round(totalCost), median: round(quantile(costs, 0.5)), p90: round(quantile(costs, 0.9)), max: round(costs.length ? Math.max(...costs) : null) },
    month: { spentUsd: round(monthSpend), budgetUsd: perMonthUsd, pct: perMonthUsd ? round(monthSpend / perMonthUsd, 3) : null },
    fireRate: { perDay: round(rows.length / days, 3), expectedPerDay: expected == null ? null : round(expected, 3) },
    feedback: fb,
    // Stretch metric from the plan: what a member-confirmed useful output costs.
    costPerUseful: fb.useful ? round(totalCost / fb.useful) : null,
    failureStreak: failureStreak(rows),
    lastEval,
    perDay: Object.entries(perDay).map(([day, v]) => ({ day, ...v, costUsd: round(v.costUsd) })),
    recent: rows.slice(-20).reverse().map((r) => ({ id: r.id, status: r.status, symbol: r.symbol, costUsd: r.costUsd, createdAt: r.createdAt, latencyMs: latencyMs(r), error: r.error ? String(r.error).slice(0, 160) : null, trigger: r.trigger || null })),
  };
}

// One row per agent (or workflow) that ran in the window, plus every agent defined in the
// agents table even if it hasn't run.
function agentsOverview({ days = 30, now = new Date(), labels = {} } = {}) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const agents = agentRows();
  const agentsById = new Map(agents.map((a) => [a.id, a]));
  const byWorkflow = new Map(agents.filter((a) => a.kind === "builtin" && a.workflow).map((a) => [a.workflow, a]));
  const groups = new Map();
  for (const a of agents) if (a.status !== "archived") groups.set(`a${a.id}`, []);
  for (const r of runsSince(since)) {
    const k = keyOf(r, byWorkflow);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const monthStart = budget.monthStart(now);
  const list = [...groups].map(([key, rows]) => {
    const fin = rows.filter((r) => r.status !== "running");
    const done = fin.filter((r) => r.status === "done").length, failed = fin.filter((r) => r.status === "failed").length;
    const fb = feedbackFor(rows.map((r) => r.id));
    const a = key.startsWith("a") ? agentsById.get(Number(key.slice(1))) : null;
    const month = rows.filter((r) => r.createdAt >= monthStart).reduce((s, r) => s + (r.costUsd || 0), 0);
    const perMonthUsd = Number(a?.spec?.budget?.perMonthUsd) || null;
    return {
      key, name: displayName(key, agentsById, labels), workflow: a?.workflow || (key.startsWith("w") ? key.slice(1) : null),
      kind: a?.kind || "workflow", status: a?.status || null,
      runs: rows.length, successRate: done + failed ? round(done / (done + failed), 3) : null,
      medianCostUsd: round(quantile(fin.map((r) => r.costUsd || 0), 0.5)), medianLatencyMs: quantile(fin.map(latencyMs).filter((x) => x != null), 0.5),
      totalCostUsd: round(rows.reduce((s, r) => s + (r.costUsd || 0), 0)), monthSpentUsd: round(month), monthBudgetUsd: perMonthUsd,
      acceptance: fb.acceptance, feedback: fb.total, failureStreak: failureStreak(rows),
      lastRunAt: rows.length ? rows[rows.length - 1].createdAt : a?.lastRunAt || null,
    };
  });
  list.sort((x, y) => (y.runs - x.runs) || (y.totalCostUsd - x.totalCostUsd));
  return { days, agents: list };
}

// ---- fund AI spend (admins) ----

function monthBounds(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, next, daysInMonth: Math.round((next - start) / DAY_MS) };
}

function fundSpend({ now = new Date(), labels = {} } = {}) {
  const { start, next, daysInMonth } = monthBounds(now);
  const rows = runsSince(start);
  const cap = budget.caps().monthlyUsd;
  const spent = rows.reduce((a, r) => a + (r.costUsd || 0), 0);
  const elapsedDays = Math.max(1 / 24, (now - start) / DAY_MS);
  const leftDays = Math.max(0, (next - now) / DAY_MS);
  // Pace: the last 7 days (or the month so far, if younger), carried to month end.
  const weekAgo = sqlTime(new Date(now.getTime() - 7 * DAY_MS));
  const recent = rows.filter((r) => r.createdAt >= weekAgo).reduce((a, r) => a + (r.costUsd || 0), 0);
  const rate = recent / Math.min(7, elapsedDays);
  const projected = spent + rate * leftDays;

  const agents = agentRows();
  const agentsById = new Map(agents.map((a) => [a.id, a]));
  const byWorkflow = new Map(agents.filter((a) => a.kind === "builtin" && a.workflow).map((a) => [a.workflow, a]));
  const members = new Map(db.prepare("SELECT id, name FROM members").all().map((m) => [m.id, m.name]));
  const group = (fn) => {
    const m = new Map();
    for (const r of rows) {
      const k = fn(r);
      const g = m.get(k) || { key: k, runs: 0, costUsd: 0 };
      g.runs++; g.costUsd += r.costUsd || 0; m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, costUsd: round(g.costUsd), share: spent ? round(g.costUsd / spent, 3) : 0 })).sort((a, b) => b.costUsd - a.costUsd);
  };
  const byAgent = group((r) => keyOf(r, byWorkflow)).map((g) => ({ ...g, name: displayName(g.key, agentsById, labels) }));
  const byMember = group((r) => r.memberId || 0).map((g) => ({ ...g, name: g.key ? members.get(g.key) || `Member ${g.key}` : "Scheduled agents (no member)" }));
  const byTier = group((r) => tierOf(r.model));
  const days = Object.fromEntries(dayList(start, now).map((d) => [d, { runs: 0, costUsd: 0 }]));
  for (const r of rows) { const d = days[String(r.createdAt).slice(0, 10)]; if (d) { d.runs++; d.costUsd += r.costUsd || 0; } }
  let cum = 0;
  const byDay = Object.entries(days).map(([day, v]) => { cum += v.costUsd; return { day, runs: v.runs, costUsd: round(v.costUsd), cumulativeUsd: round(cum) }; });
  const top = [...rows].sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0)).slice(0, 10)
    .map((r) => ({ id: r.id, workflow: r.workflow, agent: displayName(keyOf(r, byWorkflow), agentsById, labels), member: r.memberId ? members.get(r.memberId) || null : null, symbol: r.symbol, model: r.model, status: r.status, costUsd: round(r.costUsd), createdAt: r.createdAt }));
  const pct = cap > 0 ? spent / cap : 1;
  return {
    month: start.toISOString().slice(0, 7), capUsd: cap, memberDailyCapUsd: budget.caps().memberDailyUsd,
    spentUsd: round(spent), pct: round(pct, 4), remainingUsd: round(Math.max(0, cap - spent)),
    projectedUsd: round(projected), projectedPct: cap > 0 ? round(projected / cap, 4) : null, dailyRateUsd: round(rate),
    daysInMonth, daysLeft: round(leftDays, 2),
    level: pct >= 1 ? "over" : pct >= BUDGET_WARN ? "warn" : projected > cap ? "pace" : "ok",
    runs: rows.length, refused: rows.filter((r) => r.status === "refused").length,
    byAgent, byMember, byTier, byDay, top,
  };
}

module.exports = {
  REASONS, FAILURE_STREAK, SCHEDULE_GRACE_MS, BUDGET_WARN,
  trace, verification, stepCost, agentStats, agentsOverview, fundSpend, failureStreak, quantile, tierOf,
  keyFilter, agentRows, tableExists, hasColumn, expectedPerDay, runsSince, parseTime, sqlTime,
};
