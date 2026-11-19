// AI spending caps (research report 8.2: "the router should refuse new runs, not just warn").
// Every OpenAI call in the app is logged in agent_runs with its cost: agent runs record their own
// rows, and the older features (filing briefs, news triage, Today recap) are logged through the
// hooks registered in install(). The fund-wide monthly cap covers all of it; the per-member daily
// cap covers runs a member starts (Ask PIF, red team on demand).
const db = require("../../db");
const { getSettings } = require("../settings");

class BudgetError extends Error {
  constructor(message, code) { super(message); this.status = 429; this.expose = true; this.code = code; }
}

// Calendar month in UTC, as SQLite datetime text ("2026-11-01 00:00:00").
function monthStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}
function dayStart(now = new Date()) {
  return `${now.toISOString().slice(0, 10)} 00:00:00`;
}

function monthSpend(now = new Date()) {
  return db.prepare("SELECT COALESCE(SUM(costUsd), 0) AS s FROM agent_runs WHERE createdAt >= ?").get(monthStart(now)).s;
}
function memberDaySpend(memberId, now = new Date()) {
  return db.prepare("SELECT COALESCE(SUM(costUsd), 0) AS s FROM agent_runs WHERE memberId = ? AND createdAt >= ?").get(memberId, dayStart(now)).s;
}

function caps() {
  const s = getSettings();
  return { monthlyUsd: Number(s.aiMonthlyCapUsd ?? 25), memberDailyUsd: Number(s.aiMemberDailyUsd ?? 0.5) };
}

function status(memberId = null) {
  const c = caps();
  const spent = monthSpend();
  const out = { monthlyCapUsd: c.monthlyUsd, monthSpentUsd: round(spent), monthRemainingUsd: round(Math.max(0, c.monthlyUsd - spent)), memberDailyCapUsd: c.memberDailyUsd };
  if (memberId) {
    const mine = memberDaySpend(memberId);
    Object.assign(out, { memberTodayUsd: round(mine), memberRemainingUsd: round(Math.max(0, c.memberDailyUsd - mine)) });
  }
  return out;
}
const round = (v) => Math.round(v * 10000) / 10000;

// Throws a BudgetError if a new call or run may not start.
function check({ memberId = null } = {}) {
  const c = caps();
  if (monthSpend() >= c.monthlyUsd) throw new BudgetError(`The fund's monthly AI budget ($${c.monthlyUsd.toFixed(2)}) is used up. An admin can raise it in Settings.`, "ai_month_cap");
  if (memberId && memberDaySpend(memberId) >= c.memberDailyUsd) throw new BudgetError(`You've used today's AI budget ($${c.memberDailyUsd.toFixed(2)}). It resets at midnight UTC.`, "ai_member_cap");
}

// Logs a call made outside an agent run (the older AI features) as a one-step run row.
function logAppCall({ feature, model, usage, costUsd }) {
  db.prepare(`INSERT INTO agent_runs (workflow, status, provider, model, inputTokens, outputTokens, costUsd, finishedAt)
    VALUES (?, 'done', 'openai', ?, ?, ?, ?, datetime('now'))`).run(feature || "app", model, usage.input, usage.output, costUsd ?? 0);
}

function install() {
  require("../sources/openai").setHooks({ before: () => check(), after: logAppCall });
}

module.exports = { BudgetError, check, status, caps, monthSpend, memberDaySpend, logAppCall, install, monthStart };
