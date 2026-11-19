// Agent profiles and the team directory (WS7): everything a member needs to decide whether to
// follow, run, ask or copy an agent. Reads WS1's agents tables; agent CRUD itself (create,
// edit, fork, pause, run now) is WS2's routes/agentEngine.js.
const { db, ensure, runsHas, hasTable } = require("./store");
const follows = require("./follows");
const query = require("./query");

const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().replace("T", " ").slice(0, 19); };

// Runs belong to an agent by agent_runs.agentId (WS1) or, for built-ins before the back-fill,
// by workflow name.
function runWhere(agent) {
  if (runsHas("agentId")) {
    return agent.kind === "builtin" && agent.workflow
      ? { sql: "(r.agentId = ? OR (r.agentId IS NULL AND r.workflow = ?))", args: [agent.id, agent.workflow] }
      : { sql: "r.agentId = ?", args: [agent.id] };
  }
  return agent.kind === "builtin" && agent.workflow ? { sql: "r.workflow = ?", args: [agent.workflow] } : { sql: "0", args: [] };
}

// Plain-English schedule/trigger summary from the spec (plan section 3.2).
const PRESETS = { premarket: "Weekdays before the open", close: "Weekdays after the close", weekly_fri: "Fridays" };
const EVENTS = {
  filing: "a new filing", price_move: "a big price move", earnings_soon: "earnings coming up", insider_buy: "insider buying",
  tripwire: "a tripwire", news_high: "important news", thirteenf: "a 13F filing", ips_breach: "a policy limit breach",
  pitch_status: "a pitch changing status", estimate_revision: "an estimate revision",
};
function describeTriggers(spec) {
  const out = [];
  for (const t of spec?.triggers || []) {
    if (t.type === "schedule") out.push(t.preset ? PRESETS[t.preset] || t.preset : `On schedule (${t.cron}${t.tz ? `, ${t.tz.replace(/^America\//, "")}` : ""})`);
    else if (t.type === "event") out.push(`On ${EVENTS[t.on] || t.on}${t.forms ? ` (${t.forms.join(", ")})` : ""}`);
    else if (t.type === "handoff") out.push(`When another agent hands off "${t.topic}"`);
    else if (t.type === "manual") out.push("When someone runs it");
  }
  return out;
}
function describeScope(spec) {
  const s = spec?.scope || {};
  if (s.universe === "symbols") return (s.symbols || []).join(", ") || "Chosen tickers";
  return { holdings: "Every holding", watchlist: "The watchlist", fund: "The whole fund" }[s.universe] || "—";
}

function canSee(member, a) { return !!a && (a.visibility !== "private" || a.ownerId === member.id || !!member.isAdmin); }

function stats(agent) {
  const w = runWhere(agent);
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString().replace("T", " ").slice(0, 19);
  const runs = db.prepare(`SELECT COUNT(*) AS n, SUM(status = 'done') AS ok, SUM(status = 'failed') AS failed, MAX(createdAt) AS last FROM agent_runs r WHERE ${w.sql} AND r.createdAt >= ?`).get(...w.args, since30);
  const cost = db.prepare(`SELECT COALESCE(SUM(costUsd), 0) AS c FROM agent_runs r WHERE ${w.sql} AND r.createdAt >= ?`).get(...w.args, monthStart()).c;
  const fb = db.prepare(`SELECT SUM(f.verdict = 'useful') AS useful, SUM(f.verdict = 'wrong') AS wrong, SUM(f.verdict = 'not_useful') AS notUseful
    FROM agent_feedback f JOIN agent_runs r ON r.id = f.runId WHERE ${w.sql}`).get(...w.args);
  const rated = (fb.useful || 0) + (fb.wrong || 0) + (fb.notUseful || 0);
  return {
    runs30d: runs.n || 0, ok30d: runs.ok || 0, failed30d: runs.failed || 0, lastRunAt: agent.lastRunAt || runs.last || null,
    costMonthUsd: Math.round(cost * 10000) / 10000,
    feedback: { useful: fb.useful || 0, wrong: fb.wrong || 0, notUseful: fb.notUseful || 0 },
    acceptance: rated ? Math.round(((fb.useful || 0) / rated) * 100) / 100 : null,
  };
}

function card(member, a, names) {
  const spec = parse(a.spec, {});
  const fs = follows.status(member, a.id);
  return {
    id: a.id, slug: a.slug, name: a.name, description: a.description || "", icon: a.icon || "bot", kind: a.kind,
    workflow: a.workflow, visibility: a.visibility, status: a.status, version: a.version,
    owner: a.ownerId ? { id: a.ownerId, name: names[a.ownerId] || "Former member" } : null,
    triggers: describeTriggers(spec), scope: describeScope(spec), usesAi: (spec.steps || []).some((s) => s.type === "ai") || a.kind === "builtin",
    following: fs.following, notify: fs.notify, followers: fs.followers,
    nextRunAt: a.nextRunAt || null, createdAt: a.createdAt, updatedAt: a.updatedAt,
    forkedFrom: a.forkedFrom || null,
    isOwner: a.ownerId === member.id,
  };
}

const names = () => Object.fromEntries(db.prepare("SELECT id, name FROM members").all().map((r) => [r.id, r.name]));

// Team directory. q: { q, sort: followed|useful|recent|name, mine, kind }
function directory(member, q = {}) {
  if (!ensure() || !hasTable("agents")) return { agents: [], unavailable: true };
  const where = ["a.status != 'archived'", "(a.visibility = 'team' OR a.ownerId = ? OR ? = 1)"];
  const args = [member.id, member.isAdmin ? 1 : 0];
  if (q.q) { where.push("(a.name LIKE ? OR a.description LIKE ? OR a.slug LIKE ?)"); const like = `%${String(q.q).slice(0, 60)}%`; args.push(like, like, like); }
  if (q.mine) { where.push("a.ownerId = ?"); args.push(member.id); }
  if (q.kind && ["builtin", "custom"].includes(q.kind)) { where.push("a.kind = ?"); args.push(q.kind); }
  const rows = db.prepare(`SELECT a.* FROM agents a WHERE ${where.join(" AND ")}`).all(...args);
  const n = names();
  const list = rows.map((a) => ({ ...card(member, a, n), stats: stats(a) }));
  const sort = ["followed", "useful", "recent", "name"].includes(q.sort) ? q.sort : "followed";
  const by = {
    followed: (x, y) => y.followers - x.followers || (y.stats.runs30d - x.stats.runs30d),
    useful: (x, y) => (y.stats.feedback.useful - x.stats.feedback.useful) || ((y.stats.acceptance ?? -1) - (x.stats.acceptance ?? -1)),
    recent: (x, y) => String(y.stats.lastRunAt || y.updatedAt || "").localeCompare(String(x.stats.lastRunAt || x.updatedAt || "")),
    name: (x, y) => x.name.localeCompare(y.name),
  }[sort];
  list.sort(by);
  return { agents: list, sort };
}

// Full profile, or null when the member can't see the agent.
function profile(member, slug) {
  if (!ensure() || !hasTable("agents")) return null;
  const a = db.prepare("SELECT * FROM agents WHERE slug = ?").get(String(slug));
  if (!canSee(member, a)) return null;
  const n = names();
  const spec = parse(a.spec, {});
  const w = runWhere(a);
  // Ask-style member runs stay private unless shared; fund-wide runs show to everyone.
  const privacy = member.isAdmin ? "1 = 1" : `(r.memberId IS NULL OR r.memberId = ?${runsHas("shared") ? " OR r.shared = 1" : ""})`;
  const runs = db.prepare(`SELECT r.id, r.workflow, r.symbol, r.status, r.costUsd, r.createdAt, r.finishedAt, r.memberId, r.error${runsHas("trigger") ? ", r.trigger" : ""}${runsHas("summary") ? ", r.summary" : ""}
    FROM agent_runs r WHERE ${w.sql} AND ${privacy} ORDER BY r.id DESC LIMIT 15`).all(...w.args, ...(member.isAdmin ? [] : [member.id]));
  const running = runs.filter((r) => r.status === "running").map((r) => ({ id: r.id, symbol: r.symbol, by: r.memberId ? n[r.memberId] || null : null, createdAt: r.createdAt }));
  const memory = hasTable("agent_memory")
    ? db.prepare("SELECT id, scope, scopeKey, kind, text, sourceRunId, sourceUrl, asOf, status, createdAt FROM agent_memory WHERE createdByAgent = ? AND status IN ('active', 'proposed') ORDER BY id DESC LIMIT 10").all(a.id)
    : [];
  const versions = hasTable("agent_versions")
    ? db.prepare("SELECT version, editedBy, note, createdAt FROM agent_versions WHERE agentId = ? ORDER BY version DESC LIMIT 20").all(a.id).map((v) => ({ ...v, editedByName: v.editedBy ? n[v.editedBy] || "Former member" : null }))
    : [];
  const feed = query.list(member, { agentId: a.id, limit: 8 }).items;
  const outputs = (spec.outputs || []).map((o) => o.type);
  return {
    agent: { ...card(member, a, n), spec: a.ownerId === member.id || member.isAdmin || a.visibility === "team" ? spec : null, outputs, budget: spec.budget || null },
    stats: stats(a),
    followers: follows.followers(a.id),
    runs: runs.map((r) => ({ ...r, byName: r.memberId ? n[r.memberId] || null : null })),
    running, memory, versions, feed,
    can: {
      edit: a.ownerId === member.id || !!member.isAdmin,
      pause: a.ownerId === member.id || !!member.isAdmin,
      suspend: !!member.isAdmin,
      run: !!(member.canUseAi || member.isAdmin) && a.status === "active",
      duplicate: !!(member.canUseAi || member.isAdmin) && a.kind === "custom",
    },
  };
}

// Runs in progress right now, for the "Running now" chips (visible ones only).
function runningNow(member) {
  const cols = runsHas("agentId") ? ", r.agentId" : "";
  const since = new Date(Date.now() - 30 * 60e3).toISOString().replace("T", " ").slice(0, 19);
  const rows = db.prepare(`SELECT r.id, r.workflow, r.symbol, r.memberId, r.createdAt${cols} FROM agent_runs r WHERE r.status = 'running' AND r.createdAt >= ?
    ${member.isAdmin ? "" : `AND (r.memberId IS NULL OR r.memberId = ?)`} ORDER BY r.id DESC LIMIT 20`).all(since, ...(member.isAdmin ? [] : [member.id]));
  const agents = hasTable("agents") ? Object.fromEntries(db.prepare("SELECT id, slug, name, icon, workflow, visibility, ownerId FROM agents").all().map((a) => [a.id, a])) : {};
  const byWorkflow = Object.fromEntries(Object.values(agents).filter((a) => a.workflow && a.workflow !== "engine").map((a) => [a.workflow, a]));
  return rows.map((r) => {
    const a = (r.agentId && agents[r.agentId]) || byWorkflow[r.workflow] || null;
    if (a && !canSee(member, a)) return null;
    return { runId: r.id, workflow: r.workflow, symbol: r.symbol, createdAt: r.createdAt, mine: r.memberId === member.id, agent: a ? { id: a.id, slug: a.slug, name: a.name, icon: a.icon || "bot" } : null };
  }).filter(Boolean);
}

module.exports = { directory, profile, runningNow, describeTriggers, describeScope, stats, canSee };
