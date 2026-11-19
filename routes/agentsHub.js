// Agents hub (WS11): the Home tab's data in one call, and the command palette's agent/run search.
//   GET /api/agents-hub/home     needs you, running now, my agents, followed agents, latest team feed
//   GET /api/agents-hub/search?q= agents, recent runs and Ask conversations matching q
const express = require("express");
const db = require("../db");
const { requireAi } = require("../middleware/auth");
const threads = require("../lib/agents/askThreads");

const router = express.Router();
const tryAll = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
const tryGet = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return undefined; } };
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// An agent as the page needs it: identity, schedule triggers (not the whole spec), counts.
function agentView(a, runningIds) {
  const spec = parse(a.spec, {});
  return {
    id: a.id, slug: a.slug, name: a.name, description: a.description || "", icon: a.icon, kind: a.kind, status: a.status,
    visibility: a.visibility, ownerId: a.ownerId, ownerName: a.ownerName || null, lastRunAt: a.lastRunAt, nextRunAt: a.nextRunAt,
    triggers: Array.isArray(spec.triggers) ? spec.triggers.slice(0, 6) : [], running: runningIds.has(a.id), followers: a.followers || 0,
  };
}

const AGENT_COLS = `a.id, a.slug, a.name, a.description, a.icon, a.kind, a.status, a.visibility, a.ownerId, a.lastRunAt, a.nextRunAt, a.spec,
  m.name AS ownerName, (SELECT COUNT(*) FROM agent_follows f WHERE f.agentId = a.id) AS followers`;

function runView(r, agents) {
  const a = r.agentId ? agents.get(r.agentId) : null;
  return {
    id: r.id, workflow: r.workflow, symbol: r.symbol, status: r.status, costUsd: r.costUsd, createdAt: r.createdAt, summary: r.summary || null,
    memberId: r.memberId, memberName: r.memberName || null, trigger: r.trigger || null,
    agent: a ? { slug: a.slug, name: a.name, icon: a.icon, kind: a.kind } : null,
  };
}

router.get("/agents-hub/home", requireAi, (req, res) => {
  const me = req.member.id;
  const running = tryAll(`SELECT r.id, r.workflow, r.symbol, r.status, r.costUsd, r.createdAt, r.memberId, r.agentId, r."trigger" AS "trigger", m.name AS memberName
    FROM agent_runs r LEFT JOIN members m ON m.id = r.memberId
    WHERE r.status = 'running' AND r.createdAt >= datetime('now', '-15 minutes') AND (r.memberId IS NULL OR r.memberId = ? OR r.workflow NOT IN ('ask_pif','compare','what_if','meeting_prep','ideas','pitch_primer'))
    ORDER BY r.id DESC LIMIT 12`, me);
  const runningIds = new Set(running.map((r) => r.agentId).filter(Boolean));
  const mine = tryAll(`SELECT ${AGENT_COLS} FROM agents a LEFT JOIN members m ON m.id = a.ownerId WHERE a.ownerId = ? AND a.status != 'archived' ORDER BY a.updatedAt DESC LIMIT 20`, me);
  const followed = tryAll(`SELECT ${AGENT_COLS} FROM agent_follows f JOIN agents a ON a.id = f.agentId LEFT JOIN members m ON m.id = a.ownerId
    WHERE f.memberId = ? AND a.status != 'archived' AND (a.visibility = 'team' OR a.ownerId = ?) ORDER BY a.lastRunAt DESC LIMIT 20`, me, me);
  const team = tryAll(`SELECT ${AGENT_COLS} FROM agents a LEFT JOIN members m ON m.id = a.ownerId WHERE a.kind = 'custom' AND a.visibility = 'team' AND a.status = 'active' AND (a.ownerId IS NULL OR a.ownerId != ?)
    ORDER BY a.lastRunAt DESC LIMIT 6`, me);
  const allAgents = new Map(tryAll("SELECT id, slug, name, icon, kind FROM agents").map((a) => [a.id, a]));
  const proposals = tryAll("SELECT id, kind, symbol, title, runId, createdAt FROM agent_proposals WHERE status = 'pending' ORDER BY id DESC LIMIT 10");
  const pendingProposals = tryGet("SELECT COUNT(*) AS c FROM agent_proposals WHERE status = 'pending'")?.c || 0;
  // Mentions and agent alerts the member hasn't read yet.
  const unread = tryAll(`SELECT id, type, title, body, link, createdAt FROM notifications WHERE memberId = ? AND readAt IS NULL
    AND (type IN ('mention','agentBrief','tripwire') OR type LIKE 'agent%') ORDER BY id DESC LIMIT 8`, me);
  let feed = [];
  try {
    feed = require("../lib/platform/feed").list({ limit: 8, memberId: me }).map((f) => {
      const a = f.agentId ? allAgents.get(f.agentId) : null;
      const m = f.actorType === "member" && f.actorId ? tryGet("SELECT name FROM members WHERE id = ?", f.actorId) : null;
      return { ...f, agent: a ? { slug: a.slug, name: a.name, icon: a.icon, kind: a.kind } : undefined, member: m ? { name: m.name } : undefined };
    });
  } catch { /* the feed isn't there yet */ }
  const recent = tryAll(`SELECT r.id, r.workflow, r.symbol, r.status, r.costUsd, r.createdAt, r.summary, r.memberId, r.agentId, r."trigger" AS "trigger"
    FROM agent_runs r WHERE r.memberId = ? ORDER BY r.id DESC LIMIT 5`, me);
  res.json({
    needsYou: { proposals, pendingProposals, unread },
    running: running.map((r) => runView(r, allAgents)),
    myAgents: mine.map((a) => agentView(a, runningIds)),
    followed: followed.map((a) => agentView(a, runningIds)),
    teamAgents: team.map((a) => agentView(a, runningIds)),
    myRecentRuns: recent.map((r) => runView(r, allAgents)),
    feed,
    threads: threads.listThreads(req.member, { limit: 4 }),
  });
});

router.get("/agents-hub/search", requireAi, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  const like = `%${q}%`;
  const me = req.member.id;
  const agents = tryAll(`SELECT id, slug, name, description, icon, kind, status FROM agents
    WHERE status != 'archived' AND (visibility = 'team' OR ownerId = ?) AND (? = '' OR name LIKE ? OR slug LIKE ? OR description LIKE ?)
    ORDER BY kind = 'builtin', name LIMIT 8`, me, q, like, like, like);
  const allAgents = new Map(tryAll("SELECT id, slug, name, icon, kind FROM agents").map((a) => [a.id, a]));
  const runs = q ? tryAll(`SELECT id, workflow, symbol, status, costUsd, createdAt, summary, memberId, agentId FROM agent_runs
    WHERE (memberId IS NULL OR memberId = ?) AND (symbol LIKE ? OR workflow LIKE ? OR summary LIKE ? OR CAST(id AS TEXT) = ?)
    ORDER BY id DESC LIMIT 6`, me, like, like, like, q) : [];
  res.json({ agents, runs: runs.map((r) => runView(r, allAgents)), threads: q ? threads.listThreads(req.member, { q, limit: 5 }) : [] });
});

module.exports = router;
module.exports.autoMount = true;
