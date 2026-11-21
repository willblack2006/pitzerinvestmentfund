// Agent health alerts (plan WS8): a failure streak, an agent or the fund running out of budget,
// or a scheduled agent that stopped firing. Each problem posts one feed item and one inbox
// notification to the agent's owner and the admins, once per day (budget: once per month per
// level). Runs every 15 minutes as a registered job once WS1's job registry exists.
const db = require("../../db");
const schema = require("../schema/observability");
const metrics = require("./metrics");
const budget = require("./budget");

const CHECK_EVERY_MS = 15 * 60e3;

// Pure-ish: reads the DB, returns the problems found now. No side effects.
function findProblems({ now = new Date() } = {}) {
  const problems = [];
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);

  // 1. Failure streaks, per agent (or workflow), over the last two weeks of runs.
  const ov = metrics.agentsOverview({ days: 14, now });
  for (const a of ov.agents) {
    if (a.failureStreak >= metrics.FAILURE_STREAK) {
      problems.push({ kind: "failure_streak", key: `failure_streak:${a.key}:${day}`, subject: a.key, agentKey: a.key, name: a.name,
        title: `${a.name} failed ${a.failureStreak} runs in a row`, detail: "Open its stats to see the errors. Pausing it stops the spend until it's fixed." });
    }
    // 2a. An agent's own monthly budget (spec.budget.perMonthUsd).
    if (a.monthBudgetUsd && a.monthSpentUsd >= a.monthBudgetUsd) {
      problems.push({ kind: "agent_budget", key: `agent_budget:${a.key}:${month}`, subject: a.key, agentKey: a.key, name: a.name,
        title: `${a.name} used its monthly AI budget`, detail: `$${a.monthSpentUsd.toFixed(2)} of $${a.monthBudgetUsd.toFixed(2)}. It won't run its AI steps again until next month unless the budget is raised.` });
    }
  }

  // 2b. The fund's monthly cap.
  const spent = budget.monthSpend(now), cap = budget.caps().monthlyUsd;
  if (cap > 0 && spent >= cap * metrics.BUDGET_WARN) {
    const level = spent >= cap ? 100 : 80;
    problems.push({ kind: "fund_budget", key: `fund_budget:${level}:${month}`, subject: "fund", agentKey: null, name: "AI budget",
      title: level === 100 ? "The fund's monthly AI budget is used up" : "The fund has used 80% of its monthly AI budget",
      detail: `$${spent.toFixed(2)} of $${cap.toFixed(2)} this month. Agents and Ask PIF stop at the cap. An admin can raise it in Settings.` });
  }

  // 3. Scheduled agents that stopped firing (WS1's agents.nextRunAt left in the past).
  if (metrics.tableExists("agents")) {
    const cutoff = metrics.sqlTime(new Date(now.getTime() - metrics.SCHEDULE_GRACE_MS));
    const stalled = db.prepare("SELECT id, name, nextRunAt FROM agents WHERE status = 'active' AND nextRunAt IS NOT NULL AND REPLACE(nextRunAt, 'T', ' ') < ?").all(cutoff);
    for (const a of stalled) {
      problems.push({ kind: "schedule_stalled", key: `schedule_stalled:a${a.id}:${day}`, subject: `a${a.id}`, agentKey: `a${a.id}`, name: a.name,
        title: `${a.name} stopped running on schedule`, detail: `It was due ${String(a.nextRunAt).slice(0, 16).replace("T", " ")} UTC and hasn't run since. The scheduler may be down or the agent's trigger may be broken.` });
    }
  }
  return problems;
}

function recipients(agentKey) {
  const ids = new Set(db.prepare("SELECT id FROM members WHERE isAdmin = 1 AND active = 1").all().map((r) => r.id));
  if (agentKey && agentKey.startsWith("a") && metrics.tableExists("agents")) {
    const a = db.prepare("SELECT ownerId FROM agents WHERE id = ?").get(Number(agentKey.slice(1)));
    if (a?.ownerId) ids.add(a.ownerId);
  }
  return [...ids];
}

function linkFor(p) {
  if (p.kind === "fund_budget") return "#/ai-spend";
  return `#/agents/stats/${encodeURIComponent(p.agentKey)}`;
}

// Records new problems and tells people. Returns the problems that were new this time.
function check({ now = new Date() } = {}) {
  schema.ensure(db);
  const fresh = [];
  for (const p of findProblems({ now })) {
    const info = db.prepare("INSERT OR IGNORE INTO agent_health_alerts (key, kind, subject, detail) VALUES (?, ?, ?, ?)").run(p.key, p.kind, p.subject, p.title);
    if (!info.changes) continue;
    fresh.push(p);
    const agentId = p.agentKey?.startsWith("a") ? Number(p.agentKey.slice(1)) : null;
    try {
      require("../platform/feed").post({ kind: "agent_alert", actorType: "system", actorId: null, agentId, title: p.title, body: JSON.stringify({ text: p.detail, health: p.kind, link: linkFor(p) }), importance: "high" });
    } catch { /* feed not available before WS1 */ }
    try {
      require("../notify").notify(recipients(p.agentKey), { type: "agentHealth", title: p.title, body: p.detail, link: linkFor(p) });
    } catch (err) { console.error("[agent-health] notify failed:", err.message); }
  }
  return fresh;
}

function recent({ limit = 30 } = {}) {
  schema.ensure(db);
  return db.prepare("SELECT key, kind, subject, detail AS title, createdAt FROM agent_health_alerts ORDER BY createdAt DESC LIMIT ?").all(limit);
}

let registered = false;
function register() {
  if (registered) return;
  try {
    require("../platform/jobs").register("agent_health", { everyMs: CHECK_EVERY_MS, fn: () => check() });
    registered = true;
  } catch { /* job registry not available before WS1 */ }
}

module.exports = { findProblems, check, recent, register, recipients };
