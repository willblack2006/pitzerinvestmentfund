// Agent observability API (plan WS8): run traces, per-agent stats, the fund's AI spend for
// admins, health problems and feedback reasons. Mounted under /api by WS1's router auto-mount.
const express = require("express");
const db = require("../db");
const { requireAi, requireAdmin } = require("../middleware/auth");
const runs = require("../lib/agents/runs");
const metrics = require("../lib/agents/metrics");
const health = require("../lib/agents/health");
const schema = require("../lib/schema/observability");

const router = express.Router();
health.register();

const daysParam = (q) => Math.min(90, Math.max(1, Number(q) || 30));

// Same visibility rule as GET /agents/runs/:id: a member's own runs (Ask PIF etc.) show only to
// them and admins; agent runs show to everyone with AI access.
function visibleRun(req, id) {
  const r = runs.getRun(Number(id));
  if (!r) return null;
  if (r.memberId && r.memberId !== req.member.id && !req.member.isAdmin && !r.shared) return null;
  return r;
}

router.get("/agents/runs/:id/trace", requireAi, (req, res) => {
  const r = visibleRun(req, req.params.id);
  if (!r) return res.status(404).json({ error: "No such run." });
  const event = r.eventId ? db.prepare("SELECT id, title, sourceUrl, type, symbol FROM agent_events WHERE id = ?").get(r.eventId) : null;
  const parent = r.parentRunId ? db.prepare("SELECT id, workflow, status FROM agent_runs WHERE id = ?").get(r.parentRunId) : null;
  schema.ensure(db);
  const fb = db.prepare("SELECT verdict, reasons, memberId FROM agent_feedback WHERE runId = ?").all(r.id);
  const feedback = { useful: 0, not_useful: 0, wrong: 0, mine: null, myReasons: [], reasons: {} };
  for (const f of fb) {
    feedback[f.verdict]++;
    const rs = String(f.reasons || "").split(",").filter(Boolean);
    for (const k of rs) feedback.reasons[k] = (feedback.reasons[k] || 0) + 1;
    if (f.memberId === req.member.id) { feedback.mine = f.verdict; feedback.myReasons = rs; }
  }
  const { steps, ...run } = r;
  res.json({
    run: { ...run, stepCount: steps.length },
    event, parent, feedback,
    member: r.memberId ? db.prepare("SELECT id, name FROM members WHERE id = ?").get(r.memberId) || null : null,
    ...metrics.trace(r),
  });
});

router.get("/agents/stats", requireAi, (req, res) => {
  res.json(metrics.agentsOverview({ days: daysParam(req.query.days) }));
});

router.get("/agents/stats/:key", requireAi, (req, res) => {
  const s = metrics.agentStats(req.params.key, { days: daysParam(req.query.days) });
  if (!s) return res.status(404).json({ error: "No such agent." });
  // Members' own questions (Ask PIF) are private: others see the totals but not the run list.
  if (!req.member.isAdmin) {
    const own = new Set(db.prepare(`SELECT id FROM agent_runs WHERE id IN (${s.recent.map(() => "?").join(",") || "NULL"}) AND (memberId IS NULL OR memberId = ?)`).all(...s.recent.map((r) => r.id), req.member.id).map((r) => r.id));
    s.recent = s.recent.filter((r) => own.has(r.id));
  }
  res.json(s);
});

router.get("/agents/health", requireAi, (req, res) => {
  res.json({ problems: health.findProblems(), recent: health.recent() });
});

router.get("/admin/ai-spend", requireAdmin, (req, res) => {
  res.json(metrics.fundSpend());
});

// Reason chips on feedback. Sets the verdict too: the one given, or the one the first reason
// implies (so "Wrong number" on its own counts as "wrong").
router.get("/agents/feedback-reasons", requireAi, (req, res) => {
  res.json({ reasons: Object.entries(metrics.REASONS).map(([key, v]) => ({ key, ...v })) });
});

router.post("/agents/runs/:id/reasons", requireAi, (req, res) => {
  schema.ensure(db);
  const id = Number(req.params.id);
  const r = db.prepare("SELECT id, memberId FROM agent_runs WHERE id = ?").get(id);
  if (!r || (r.memberId && r.memberId !== req.member.id)) return res.status(404).json({ error: "No such run." });
  const reasons = [...new Set((Array.isArray(req.body?.reasons) ? req.body.reasons : []).map(String))].filter((k) => metrics.REASONS[k]).slice(0, 5);
  const existing = db.prepare("SELECT verdict FROM agent_feedback WHERE runId = ? AND memberId = ?").get(id, req.member.id);
  let verdict = req.body?.verdict;
  if (verdict != null && !["useful", "wrong", "not_useful"].includes(verdict)) return res.status(400).json({ error: "verdict must be useful, wrong or not_useful." });
  verdict = verdict || existing?.verdict || (reasons[0] ? metrics.REASONS[reasons[0]].verdict : null);
  if (!verdict) return res.status(400).json({ error: "Pick at least one reason." });
  db.prepare(`INSERT INTO agent_feedback (runId, memberId, verdict, reasons) VALUES (?, ?, ?, ?)
    ON CONFLICT(runId, memberId) DO UPDATE SET verdict = excluded.verdict, reasons = excluded.reasons, createdAt = datetime('now')`).run(id, req.member.id, verdict, reasons.join(","));
  res.json({ verdict, reasons });
});

module.exports = router;
module.exports.autoMount = true;
