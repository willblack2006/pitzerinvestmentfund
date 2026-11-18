// Agents API: spending, the event feed, runs with their steps and cost, briefs, member feedback,
// the approval queue, and on-demand runs. Members with AI access only (admins always have it).
const express = require("express");
const db = require("../db");
const { requireAi } = require("../middleware/auth");
const budget = require("../lib/agents/budget");
const agents = require("../lib/agents");
const runs = require("../lib/agents/runs");
const router_ = require("../lib/agents/router");
const proposals = require("../lib/agents/proposals");
const sec = require("../lib/sources/sec");
const openai = require("../lib/sources/openai");

const router = express.Router();
const BRIEF_WORKFLOWS = ["filing_flash", "earnings_flash"];

const runSummary = (r) => ({
  id: r.id, workflow: r.workflow, eventId: r.eventId, memberId: r.memberId, symbol: r.symbol, status: r.status,
  model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd,
  error: r.error, createdAt: r.createdAt, finishedAt: r.finishedAt,
});

function feedbackFor(runIds, memberId) {
  if (!runIds.length) return {};
  const q = runIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT runId, verdict, memberId FROM agent_feedback WHERE runId IN (${q})`).all(...runIds);
  const out = {};
  for (const r of rows) {
    const f = (out[r.runId] ||= { useful: 0, wrong: 0, not_useful: 0, mine: null });
    f[r.verdict]++;
    if (r.memberId === memberId) f.mine = r.verdict;
  }
  return out;
}

router.get("/agents/overview", requireAi, (req, res) => {
  const events = db.prepare("SELECT id, symbol, type, items, title, sourceUrl, asOf, tier, workflow, status, createdAt FROM agent_events ORDER BY id DESC LIMIT 50").all();
  // Agent runs show to everyone with AI access; a member's own questions show only to them.
  const recent = db.prepare("SELECT * FROM agent_runs WHERE memberId IS NULL OR memberId = ? ORDER BY id DESC LIMIT 50").all(req.member.id);
  const since = budget.monthStart();
  const byFeature = db.prepare("SELECT workflow, COUNT(*) AS runs, ROUND(SUM(costUsd), 4) AS costUsd FROM agent_runs WHERE createdAt >= ? GROUP BY workflow ORDER BY costUsd DESC").all(since);
  const acceptance = db.prepare(`SELECT r.workflow, SUM(f.verdict = 'useful') AS useful, SUM(f.verdict = 'wrong') AS wrong, SUM(f.verdict = 'not_useful') AS notUseful
    FROM agent_feedback f JOIN agent_runs r ON r.id = f.runId GROUP BY r.workflow`).all();
  res.json({
    aiConfigured: openai.configured(),
    budget: budget.status(req.member.id),
    workflows: agents.registered(),
    monthByFeature: byFeature,
    acceptance,
    pendingProposals: db.prepare("SELECT COUNT(*) AS c FROM agent_proposals WHERE status = 'pending'").get().c,
    events,
    runs: recent.map(runSummary),
  });
});

router.get("/agents/runs/:id", requireAi, (req, res) => {
  const r = runs.getRun(Number(req.params.id));
  if (!r || (r.memberId && r.memberId !== req.member.id && !req.member.isAdmin)) return res.status(404).json({ error: "No such run." });
  const event = r.eventId ? db.prepare("SELECT * FROM agent_events WHERE id = ?").get(r.eventId) : null;
  res.json({ ...r, event, feedback: feedbackFor([r.id], req.member.id)[r.id] || { useful: 0, wrong: 0, not_useful: 0, mine: null } });
});

// Briefs (filing and earnings flashes), newest first; ?symbol= for one holding.
router.get("/agents/briefs", requireAi, (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase().slice(0, 12) : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const rows = db.prepare(`SELECT id, workflow, symbol, output, costUsd, createdAt FROM agent_runs
    WHERE status = 'done' AND workflow IN (${BRIEF_WORKFLOWS.map(() => "?").join(",")}) ${symbol ? "AND symbol = ?" : ""} ORDER BY id DESC LIMIT ?`)
    .all(...BRIEF_WORKFLOWS, ...(symbol ? [symbol] : []), limit);
  const fb = feedbackFor(rows.map((r) => r.id), req.member.id);
  res.json({ briefs: rows.map((r) => ({ runId: r.id, workflow: r.workflow, symbol: r.symbol, costUsd: r.costUsd, createdAt: r.createdAt, brief: JSON.parse(r.output || "null"), feedback: fb[r.id] || { useful: 0, wrong: 0, not_useful: 0, mine: null } })) });
});

router.post("/agents/runs/:id/feedback", requireAi, (req, res) => {
  const id = Number(req.params.id);
  const { verdict, note = "" } = req.body || {};
  if (!["useful", "wrong", "not_useful"].includes(verdict)) return res.status(400).json({ error: "verdict must be useful, wrong or not_useful." });
  const r = db.prepare("SELECT id, memberId FROM agent_runs WHERE id = ?").get(id);
  if (!r || (r.memberId && r.memberId !== req.member.id)) return res.status(404).json({ error: "No such run." });
  db.prepare(`INSERT INTO agent_feedback (runId, memberId, verdict, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(runId, memberId) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, createdAt = datetime('now')`).run(id, req.member.id, verdict, String(note).slice(0, 1000));
  res.json(feedbackFor([id], req.member.id)[id]);
});

// Brief one filing now (any ticker), on the member's own daily budget.
router.post("/agents/brief", requireAi, async (req, res) => {
  if (!openai.configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  const symbol = String(req.body?.symbol || "").toUpperCase().trim();
  const accession = String(req.body?.accession || "").trim();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol) || !accession) return res.status(400).json({ error: "symbol and accession are required." });
  let f;
  try { f = (await sec.getAllRecentFilings(symbol)).find((x) => x.accession === accession); }
  catch (err) { return res.status(502).json({ error: `SEC EDGAR couldn't be read: ${err.message}` }); }
  if (!f) return res.status(404).json({ error: "Filing not found for that ticker." });
  agents.recordEvent({ dedupeKey: `filing:${f.accession}`, symbol, type: f.form, items: f.items || "", title: `${symbol} ${f.form} filed ${f.filingDate}`, sourceUrl: f.url, asOf: f.filingDate, payload: f });
  const e = db.prepare("SELECT * FROM agent_events WHERE dedupeKey = ?").get(`filing:${f.accession}`);
  const r = router_.classify(e);
  const workflow = r.workflow === "earnings_flash" ? "earnings_flash" : "filing_flash";
  if (!agents.workflows[workflow]) return res.status(501).json({ error: "That workflow isn't available." });
  try {
    const out = await runs.run({ workflow, eventId: e.id, memberId: req.member.id, symbol }, (ctx) => agents.workflows[workflow]({ ...e, tier: "digest", workflow, payload: f }, ctx));
    db.prepare("UPDATE agent_events SET status = 'done', tier = ?, workflow = ? WHERE id = ?").run(r.tier, workflow, e.id);
    res.json({ runId: out.runId, brief: out.output, costUsd: out.costUsd });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, runId: err.runId || null, code: err.code });
  }
});

// Approval queue.
router.get("/agents/proposals", requireAi, (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
  res.json({ proposals: proposals.list({ status }) });
});

router.post("/agents/proposals/:id/decide", requireAi, async (req, res) => {
  const approve = req.body?.approve === true;
  if (req.body?.approve !== true && req.body?.approve !== false) return res.status(400).json({ error: "approve must be true or false." });
  res.json(await proposals.decide(Number(req.params.id), req.member, approve));
});

module.exports = router;
