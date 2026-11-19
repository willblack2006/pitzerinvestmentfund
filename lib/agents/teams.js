// Agent teams registry (WS6): the three team patterns, their start functions, run limits, and
// how they plug into the platform: each team is a built-in row in `agents` (so it can be
// followed and shown like any agent), the committee runs when a pitch opens for a vote or when
// another agent hands off to topic "committee", deep research on handoff topic "deep_research",
// and the portfolio review on its weekly schedule. Loaded once at boot by routes/agentTeams.js.
const db = require("../../db");
const orchestrator = require("./orchestrator");
const committee = require("./workflows/committee");
const deepResearch = require("./workflows/deepResearch");
const portfolioReview = require("./workflows/portfolioReview");
const { optional } = require("./workflows/teamCommon");

const TEAMS = {
  committee: {
    key: "committee", name: "Investment committee", icon: "users",
    description: "Bull, Bear, Risk & policy and Valuation agents each write a cited memo on a pitch or holding, rebut each other once, then a PM agent lists the disagreements and says how the committee leans.",
    members: committee.ROLES.map((r) => ({ key: r.key, label: r.label })).concat([{ key: "pm", label: "PM synthesis" }]),
    budgetUsd: committee.BUDGET_USD, typicalMinutes: "3 to 5",
    triggers: ["From a pitch page or this tab", "Automatically when a pitch opens for a vote", "When another agent hands off to it"],
  },
  deep_research: {
    key: "deep_research", name: "Deep research", icon: "search",
    description: "A planner splits a new name into four to six questions (business, unit economics, competition, management, valuation, risks), analysts answer them in parallel with the app's data and web search, and a lead analyst writes one dossier. Findings are saved to shared memory.",
    members: [{ key: "planner", label: "Planner" }, { key: "analysts", label: "4-6 analysts" }, { key: "lead", label: "Lead analyst" }],
    budgetUsd: deepResearch.BUDGET_USD, typicalMinutes: "3 to 6",
    triggers: ["On demand for any ticker", "When another agent hands off to it"],
  },
  portfolio_review: {
    key: "portfolio_review", name: "Weekly portfolio review", icon: "clipboard",
    description: "One quick agent per holding scores thesis, valuation and risk; a senior agent reads every scorecard and writes five things to discuss at Monday's meeting.",
    members: [{ key: "holdings", label: "One per holding" }, { key: "pm", label: "PM agenda" }],
    budgetUsd: portfolioReview.BUDGET_USD, typicalMinutes: "3 to 8",
    triggers: ["Every Sunday from 4 PM New York time", "On demand"],
  },
};

// Team runs are billed to the fund's monthly AI budget (the per-member daily cap is far below a
// team run's cost), so starting them is limited per member and fund-wide per day instead, and
// only a few may work at once.
const LIMITS = {
  perMemberDay: () => Number(process.env.TEAM_RUNS_PER_MEMBER_DAY) || 3,
  perDay: () => Number(process.env.TEAM_RUNS_PER_DAY) || 12,
  concurrent: () => Number(process.env.TEAM_RUNS_CONCURRENT) || 2,
};
const dayStart = () => `${new Date().toISOString().slice(0, 10)} 00:00:00`;

function usage(memberId = null) {
  const d = dayStart();
  return {
    today: db.prepare("SELECT COUNT(*) AS c FROM team_runs WHERE createdAt >= ?").get(d).c,
    mineToday: memberId ? db.prepare("SELECT COUNT(*) AS c FROM team_runs WHERE startedBy = ? AND trigger = 'manual' AND createdAt >= ?").get(memberId, d).c : 0,
    running: db.prepare("SELECT COUNT(*) AS c FROM team_runs t JOIN agent_runs r ON r.id = t.runId WHERE r.status = 'running'").get().c,
    limits: { perMemberDay: LIMITS.perMemberDay(), perDay: LIMITS.perDay(), concurrent: LIMITS.concurrent() },
  };
}

const limitError = (message, code) => Object.assign(new Error(message), { status: 429, expose: true, code });

// Throws if a new team run may not start now. Scheduled and event runs skip the per-member limit.
function checkLimits({ memberId = null, manual = true } = {}) {
  const u = usage(memberId);
  if (u.running >= u.limits.concurrent) throw limitError(`${u.running} team runs are already working. Try again in a few minutes.`, "team_busy");
  if (u.today >= u.limits.perDay) throw limitError(`The fund has used today's ${u.limits.perDay} team runs. They reset at midnight UTC.`, "team_day_cap");
  if (manual && memberId && u.mineToday >= u.limits.perMemberDay) throw limitError(`You've started ${u.mineToday} team runs today (limit ${u.limits.perMemberDay}). They reset at midnight UTC.`, "team_member_cap");
  require("./budget").check(); // fund monthly cap
}

// Starts a team run; resolves to the parent run id once it exists.
async function start(team, input = {}, { memberId = null, trigger = "manual" } = {}) {
  if (!TEAMS[team]) throw Object.assign(new Error("No such team."), { status: 404, expose: true });
  checkLimits({ memberId, manual: trigger === "manual" });
  const common = { startedBy: memberId, trigger };
  let started;
  if (team === "committee") started = committee.startCommittee({ pitchId: input.pitchId || null, symbol: input.pitchId ? null : input.symbol, ...common });
  else if (team === "deep_research") started = deepResearch.startDeepResearch({ symbol: input.symbol, focus: input.focus, ...common });
  else started = portfolioReview.startPortfolioReview(common);
  started.done.catch((err) => console.error(`[teams] ${team} run failed:`, err.message));
  const runId = await started.ready;
  return { runId, done: started.done };
}

// Built-in rows in the platform's `agents` table (WS1), so teams show up, can be followed and
// keep run history like every other agent. No-op until that table exists.
function seedAgents() {
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agents'").get();
    if (!has) return 0;
    const ins = db.prepare(`INSERT OR IGNORE INTO agents (slug, name, description, icon, kind, workflow, visibility, status, spec) VALUES (?, ?, ?, ?, 'builtin', ?, 'team', 'active', ?)`);
    let n = 0;
    for (const t of Object.values(TEAMS)) {
      const spec = { v: 1, team: true, scope: { universe: t.key === "portfolio_review" ? "holdings" : "symbols" }, triggers: t.key === "portfolio_review" ? [{ type: "schedule", cron: "0 16 * * 0", tz: "America/New_York" }, { type: "manual" }] : t.key === "committee" ? [{ type: "event", on: "pitch_status" }, { type: "handoff", topic: "committee" }, { type: "manual" }] : [{ type: "handoff", topic: "deep_research" }, { type: "manual" }], budget: { perRunUsd: t.budgetUsd() } };
      n += ins.run(t.key, t.name, t.description, t.icon, t.key, JSON.stringify(spec)).changes;
    }
    // Back-fill agentId on team runs made before the rows existed.
    const cols = new Set(db.prepare("PRAGMA table_info(agent_runs)").all().map((c) => c.name));
    if (cols.has("agentId")) {
      db.prepare(`UPDATE agent_runs SET agentId = (SELECT a.id FROM agents a JOIN team_runs t ON t.team = a.slug WHERE t.runId = agent_runs.id) WHERE agentId IS NULL AND id IN (SELECT runId FROM team_runs)`).run();
    }
    return n;
  } catch (err) { console.error("[teams] seeding agents failed:", err.message); return 0; }
}

// Event wiring. Each start is fire-and-forget and swallows limit errors (logged).
const recentEvent = new Map(); // dedupe key -> time
function once(key, ms = 6 * 3600e3) {
  const now = Date.now();
  for (const [k, t] of recentEvent) if (now - t > ms) recentEvent.delete(k);
  if (recentEvent.has(key)) return false;
  recentEvent.set(key, now);
  return true;
}
function quietStart(team, input, trigger) {
  if (!require("../sources/openai").configured()) return;
  start(team, input, { trigger }).catch((err) => console.warn(`[teams] ${team} (${trigger}) not started: ${err.message}`));
}

function onPitchStatus(e) {
  const status = e?.status || e?.payload?.status;
  const pitchId = Number(e?.pitchId || e?.payload?.pitchId);
  if (status !== "voting" || !pitchId || process.env.TEAM_COMMITTEE_ON_VOTE === "false") return;
  // One automatic committee per pitch per day.
  const done = db.prepare("SELECT COUNT(*) AS c FROM team_runs WHERE team = 'committee' AND pitchId = ? AND createdAt >= ?").get(pitchId, dayStart()).c;
  if (done || !once(`pitch:${pitchId}`)) return;
  quietStart("committee", { pitchId }, "event");
}

function onHandoff(m) {
  const topic = m?.topic;
  if (topic !== "committee" && topic !== "deep_research") return;
  if (m.toAgentId) { const slug = db.prepare("SELECT slug FROM agents WHERE id = ?").get(m.toAgentId)?.slug; if (slug && slug !== topic) return; }
  let payload = m.payload;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  const symbol = m.symbol || payload?.symbol;
  const pitchId = payload?.pitchId;
  if (!symbol && !pitchId) return;
  if (!once(`handoff:${topic}:${pitchId || symbol}`)) return;
  quietStart(topic, { symbol, pitchId, focus: payload?.focus || payload?.question || "" }, "handoff");
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  seedAgents();
  const bus = optional("../platform/bus");
  if (bus?.on) {
    bus.on("pitch_status", onPitchStatus);
    bus.on("handoff", onHandoff);
  }
  const jobs = optional("../platform/jobs");
  if (jobs?.register) {
    try { jobs.register("team_portfolio_review", { everyMs: 15 * 60e3, fn: () => portfolioReview.weeklyTick() }); } catch (err) { console.error("[teams] job register failed:", err.message); }
  }
}

const describe = () => Object.values(TEAMS).map(({ budgetUsd, ...t }) => ({ ...t, budgetUsd: budgetUsd() }));

module.exports = { TEAMS, describe, start, usage, checkLimits, seedAgents, install, onPitchStatus, onHandoff, getTree: orchestrator.getTree, listRuns: orchestrator.listRuns, latestForPitch: committee.latestForPitch };
