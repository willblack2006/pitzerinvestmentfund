// Agent platform plumbing endpoints (WS1). Auto-mounted under /api (see server.js).
//   GET /api/platform/health   background jobs' last runs and recent bus events (signed-in members)
//   GET /api/platform/feed     the team feed, newest first (?before=<id>&symbol=&agentId=&kind=&limit=)
//   GET /api/platform/agents   every agent row (built-ins and team-visible custom ones)
const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const jobs = require("../lib/platform/jobs");
const bus = require("../lib/platform/bus");
const feed = require("../lib/platform/feed");

const router = express.Router();

router.get("/platform/health", requireSignedIn, (req, res) => {
  res.json({
    jobs: jobs.status(),
    recentEvents: bus.recent({ limit: 30 }).map((e) => ({ type: e.type, at: e.at, symbol: e.payload?.symbol || null })),
    counts: db.prepare(`SELECT (SELECT COUNT(*) FROM agents) AS agents, (SELECT COUNT(*) FROM feed_items) AS feedItems,
      (SELECT COUNT(*) FROM agent_memory WHERE status = 'active') AS memories, (SELECT COUNT(*) FROM agent_messages WHERE status = 'open') AS openMessages`).get(),
  });
});

router.get("/platform/feed", requireSignedIn, (req, res) => {
  const num = (v) => (v == null || v === "" ? null : Number(v) || null);
  res.json({ items: feed.list({ limit: num(req.query.limit) || 50, before: num(req.query.before), symbol: req.query.symbol || null, agentId: num(req.query.agentId), kind: req.query.kind || null, memberId: req.member.id }) });
});

router.get("/platform/agents", requireSignedIn, (req, res) => {
  const rows = db.prepare(`SELECT id, slug, name, description, icon, kind, workflow, ownerId, visibility, status, version, forkedFrom, lastRunAt, nextRunAt, createdAt, updatedAt
    FROM agents WHERE visibility = 'team' OR ownerId = ? ORDER BY kind, name`).all(req.member.id);
  res.json({ agents: rows });
});

module.exports = router;
module.exports.autoMount = true;
