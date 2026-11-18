// Agents page API: spending, events the router saw, and every run with its steps and cost.
// Members with AI access only (runs can include members' own questions).
const express = require("express");
const db = require("../db");
const { requireAi } = require("../middleware/auth");
const budget = require("../lib/agents/budget");
const agents = require("../lib/agents");
const runs = require("../lib/agents/runs");
const openai = require("../lib/sources/openai");

const router = express.Router();

const runSummary = (r) => ({
  id: r.id, workflow: r.workflow, eventId: r.eventId, memberId: r.memberId, symbol: r.symbol, status: r.status,
  model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd,
  error: r.error, createdAt: r.createdAt, finishedAt: r.finishedAt,
});

router.get("/agents/overview", requireAi, (req, res) => {
  const events = db.prepare("SELECT id, symbol, type, items, title, sourceUrl, asOf, tier, workflow, status, createdAt FROM agent_events ORDER BY id DESC LIMIT 50").all();
  // Agent runs show to everyone; a member's own questions show only to them.
  const recent = db.prepare("SELECT * FROM agent_runs WHERE memberId IS NULL OR memberId = ? ORDER BY id DESC LIMIT 50").all(req.member.id);
  const byFeature = db.prepare("SELECT workflow, COUNT(*) AS runs, ROUND(SUM(costUsd), 4) AS costUsd FROM agent_runs WHERE createdAt >= ? GROUP BY workflow ORDER BY costUsd DESC").all(budget.monthStart());
  res.json({
    aiConfigured: openai.configured(),
    budget: budget.status(req.member.id),
    workflows: agents.registered(),
    monthByFeature: byFeature,
    events,
    runs: recent.map(runSummary),
  });
});

router.get("/agents/runs/:id", requireAi, (req, res) => {
  const r = runs.getRun(Number(req.params.id));
  if (!r || (r.memberId && r.memberId !== req.member.id && !req.member.isAdmin)) return res.status(404).json({ error: "No such run." });
  res.json(r);
});

module.exports = router;
