// Agent teams (WS6): a parent run that spawns worker runs in parallel under one shared budget,
// collects their structured results and runs a synthesis step. Every worker is its own
// agent_runs row (so its steps, tools, tokens and cost are inspectable like any run) linked to
// the parent in team_children and, once WS1's column exists, agent_runs.parentRunId.
//
//   const { ready, done } = startTeam({ team: "committee", title, symbol, budgetUsd: 0.75 }, async (t, ctx) => {
//     const memos = await t.parallel(ROLES.map((r) => ({ role: r.key, label: r.label, fn: (c) => memo(r, c) })));
//     const pm = await ctx.ai({ ... });            // synthesis runs in the parent's own context
//     return { ... };
//   });
//   const runId = await ready;                     // the parent's id, known before any model call
//
// Budget: the fund and member caps in lib/agents/budget.js still apply to every model call. On
// top of that, a team run has its own ceiling: before each model turn (parent or worker) the
// team's spend so far is compared with budgetUsd and the turn is refused once it's reached, so
// a team run can overshoot by at most the turns already in flight.
const db = require("../../db");
const runs = require("./runs");
const budget = require("./budget");
require("../schema/teams").apply(db);

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 4;
const MAX_CHILDREN = 40;

class TeamBudgetError extends budget.BudgetError {
  constructor(budgetUsd) {
    super(`This team run reached its budget ($${Number(budgetUsd).toFixed(2)}), so it stopped starting new model calls.`, "team_budget");
  }
}

// agent_runs columns added by WS1 (parentRunId, triggeredBy, trigger, agentId). Checked once per
// process; set when present so the platform's run trees and attribution see team runs too.
let colsCache = null;
function runCols() {
  if (!colsCache) colsCache = new Set(db.prepare("PRAGMA table_info(agent_runs)").all().map((c) => c.name));
  return colsCache;
}
function setRunFields(runId, fields) {
  const cols = runCols();
  const entries = Object.entries(fields).filter(([k, v]) => cols.has(k) && v !== undefined && v !== null);
  if (!entries.length) return;
  db.prepare(`UPDATE agent_runs SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...entries.map(([, v]) => v), runId);
}

// Runs `tasks` (functions returning promises) at most `limit` at a time; results keep their order.
async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return out;
}

class Team {
  constructor(parentCtx, { team, budgetUsd, reserveUsd = 0, billTo = null, startedBy = null, symbol = null, agentId = null, concurrency = DEFAULT_CONCURRENCY }) {
    this.parent = parentCtx; this.team = team; this.budgetUsd = budgetUsd;
    // Workers stop at budget minus the reserve, so the synthesis step always has room to run.
    this.workerCeiling = Math.max(0, budgetUsd - Math.min(reserveUsd, budgetUsd / 2)); this.billTo = billTo; this.startedBy = startedBy;
    this.symbol = symbol; this.agentId = agentId; this.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, concurrency));
    this.ctxs = []; // worker RunContexts (live cost)
    this.children = []; // { role, label, round, runId, ok, costUsd, error }
    this.ord = 0;
  }

  spent() { return this.parent.cost + this.ctxs.reduce((s, c) => s + c.cost, 0); }
  remaining() { return Math.max(0, this.budgetUsd - this.spent()); }

  // Every model turn of `ctx` checks the team ceiling first (workers a lower one).
  guard(ctx, ceiling = this.budgetUsd) {
    const turn = ctx.turn.bind(ctx);
    ctx.turn = async (opts) => {
      if (this.spent() >= ceiling) throw new TeamBudgetError(this.budgetUsd);
      return turn(opts);
    };
  }

  // One worker run. Never throws: a failed worker comes back { ok: false, error } so the
  // synthesis can say what's missing instead of the whole team failing.
  async child({ role, label = role, workflow = `${this.team}_${role}`, symbol = this.symbol, round = 1, fn }) {
    if (this.children.length >= MAX_CHILDREN) return { role, label, round, ok: false, error: "Too many workers in one team run.", runId: null, costUsd: 0 };
    const ord = this.ord++;
    const rec = { role, label, round, runId: null, ok: false, costUsd: 0, error: null };
    this.children.push(rec);
    let ctxRef = null;
    try {
      const r = await runs.run({ workflow, memberId: this.billTo, symbol, parentRunId: this.parent.id, trigger: "handoff", triggeredBy: this.startedBy }, async (ctx) => {
        ctxRef = ctx; rec.runId = ctx.id;
        this.ctxs.push(ctx);
        db.prepare("INSERT OR IGNORE INTO team_children (parentRunId, childRunId, role, label, round, ord) VALUES (?, ?, ?, ?, ?, ?)").run(this.parent.id, ctx.id, role, String(label).slice(0, 80), round, ord);
        setRunFields(ctx.id, { parentRunId: this.parent.id, trigger: "handoff", triggeredBy: this.startedBy });
        this.guard(ctx, this.workerCeiling);
        if (this.spent() >= this.workerCeiling) throw new TeamBudgetError(this.budgetUsd);
        return fn(ctx);
      });
      Object.assign(rec, { ok: true, costUsd: r.costUsd });
      return { ...rec, output: r.output };
    } catch (err) {
      Object.assign(rec, { ok: false, error: String(err.message).slice(0, 300), runId: rec.runId ?? err.runId ?? null, costUsd: ctxRef?.cost || 0 });
      return { ...rec, output: null };
    }
  }

  // Workers in parallel, at most `limit` at a time.
  parallel(specs, { limit = this.concurrency } = {}) {
    return pool(specs.map((s) => () => this.child(s)), Math.min(MAX_CONCURRENCY, limit));
  }

  summary() {
    return { budgetUsd: this.budgetUsd, spentUsd: Math.round(this.spent() * 10000) / 10000, workers: this.children.map((c) => ({ ...c, costUsd: Math.round((c.costUsd || 0) * 10000) / 10000 })) };
  }
}

// Starts a team run. Returns { ready, done }: `ready` resolves to the parent run id as soon as
// the run row exists (or rejects if the run was refused before starting), `done` to the
// finished { runId, output, costUsd } (costUsd is the whole team's).
function startTeam({ team, workflow = team, title = "", symbol = null, pitchId = null, startedBy = null, trigger = "manual", budgetUsd, reserveUsd = 0, billTo = null, agentId = null, concurrency }, fn) {
  if (!(budgetUsd > 0)) throw new Error("A team run needs a budget.");
  let known = false, resolveId, rejectId;
  const ready = new Promise((res, rej) => { resolveId = res; rejectId = rej; });
  let teamRef = null;
  const done = runs.run({ workflow, memberId: billTo, symbol, trigger, triggeredBy: startedBy, agentId }, async (ctx) => {
    db.prepare("INSERT OR REPLACE INTO team_runs (runId, team, title, symbol, pitchId, startedBy, trigger, budgetUsd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(ctx.id, team, String(title).slice(0, 200), symbol, pitchId, startedBy, trigger, budgetUsd);
    setRunFields(ctx.id, { trigger, triggeredBy: startedBy, agentId });
    known = true; resolveId(ctx.id);
    const t = new Team(ctx, { team, budgetUsd, reserveUsd, billTo, startedBy, symbol, agentId, concurrency });
    teamRef = t;
    t.guard(ctx);
    const output = await fn(t, ctx);
    return { ...output, team: t.summary() };
  }).then((r) => ({ ...r, costUsd: teamRef ? teamRef.spent() : r.costUsd }), (err) => {
    if (!known) rejectId(err);
    if (teamRef) err.team = teamRef.summary();
    throw err;
  });
  done.catch(() => {}); // callers that only await `ready` must not leave an unhandled rejection
  return { ready, done };
}

// A team run with its worker tree, for the debate and trace views. Null if it isn't a team run.
function getTree(runId) {
  const meta = db.prepare("SELECT * FROM team_runs WHERE runId = ?").get(runId);
  if (!meta) return null;
  const parent = runs.getRun(runId);
  if (!parent) return null;
  const kids = db.prepare(`SELECT c.role, c.label, c.round, c.ord, r.id, r.workflow, r.status, r.model, r.costUsd, r.inputTokens, r.outputTokens, r.steps, r.output, r.error, r.createdAt, r.finishedAt
    FROM team_children c JOIN agent_runs r ON r.id = c.childRunId WHERE c.parentRunId = ? ORDER BY c.round, c.ord`).all(runId);
  const workers = kids.map((k) => {
    const steps = JSON.parse(k.steps || "[]");
    return {
      runId: k.id, role: k.role, label: k.label, round: k.round, workflow: k.workflow, status: k.status, model: k.model, costUsd: k.costUsd,
      inputTokens: k.inputTokens, outputTokens: k.outputTokens, error: k.error, createdAt: k.createdAt, finishedAt: k.finishedAt,
      toolCalls: steps.filter((s) => s.kind === "tool").length, modelCalls: steps.filter((s) => s.kind === "model").length,
      lastStep: steps.length ? stepLabel(steps[steps.length - 1]) : null,
      output: k.output ? JSON.parse(k.output) : null,
    };
  });
  const teamCost = parent.costUsd + workers.reduce((s, w) => s + (w.costUsd || 0), 0);
  return {
    runId, team: meta.team, title: meta.title, symbol: meta.symbol, pitchId: meta.pitchId, startedBy: meta.startedBy,
    startedByName: meta.startedBy ? db.prepare("SELECT name FROM members WHERE id = ?").get(meta.startedBy)?.name || null : null, trigger: meta.trigger, budgetUsd: meta.budgetUsd,
    status: parent.status, error: parent.error, createdAt: parent.createdAt, finishedAt: parent.finishedAt,
    costUsd: Math.round(teamCost * 10000) / 10000, synthesisCostUsd: parent.costUsd,
    phase: parent.status === "running" ? phaseOf(parent.steps, workers) : null,
    output: parent.output, workers,
  };
}

function stepLabel(s) {
  if (s.kind === "tool") return `Read ${s.name}${s.args?.symbol ? ` (${s.args.symbol})` : ""}`;
  if (s.kind === "model") return s.toolCalls?.length ? `Chose ${s.toolCalls.length} tool${s.toolCalls.length === 1 ? "" : "s"}` : "Writing";
  if (s.kind === "phase") return s.label;
  if (s.kind === "review") return "Checking its numbers";
  return s.kind;
}
function phaseOf(steps, workers) {
  const phase = [...steps].reverse().find((s) => s.kind === "phase");
  if (phase) return phase.label;
  return workers.some((w) => w.status === "running") ? "Workers are researching" : "Starting";
}

// Recent team runs, newest first.
function listRuns({ team = null, symbol = null, pitchId = null, limit = 30 } = {}) {
  const where = [], args = [];
  if (team) { where.push("t.team = ?"); args.push(team); }
  if (symbol) { where.push("t.symbol = ?"); args.push(symbol); }
  if (pitchId) { where.push("t.pitchId = ?"); args.push(pitchId); }
  const rows = db.prepare(`SELECT t.*, r.status, r.error, r.finishedAt, r.output,
      r.costUsd + COALESCE((SELECT SUM(k.costUsd) FROM team_children c JOIN agent_runs k ON k.id = c.childRunId WHERE c.parentRunId = t.runId), 0) AS costUsd,
      (SELECT COUNT(*) FROM team_children c WHERE c.parentRunId = t.runId) AS workers, m.name AS startedByName
    FROM team_runs t JOIN agent_runs r ON r.id = t.runId LEFT JOIN members m ON m.id = t.startedBy
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.runId DESC LIMIT ?`).all(...args, Math.min(100, limit));
  return rows.map((r) => {
    let headline = null;
    try { const o = r.output ? JSON.parse(r.output) : null; headline = o?.headline || o?.synthesis?.summary || o?.summary || null; } catch { /* ignore */ }
    const { output, ...rest } = r;
    return { ...rest, costUsd: Math.round(r.costUsd * 10000) / 10000, headline: headline ? String(headline).slice(0, 300) : null };
  });
}

// Records a progress marker on the parent run (shown while it works).
function phase(ctx, label) { ctx.step("phase", { label }); }

module.exports = { startTeam, getTree, listRuns, phase, pool, Team, TeamBudgetError, setRunFields, _resetCols: () => { colsCache = null; } };
