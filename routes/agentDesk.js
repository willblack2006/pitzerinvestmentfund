// Research desk API: compare, what-if, meeting prep and idea agents (lib/agents/workflows/desk.js).
// Run on the member's own daily AI budget; members with AI access only.
const express = require("express");
const db = require("../db");
const { requireAi } = require("../middleware/auth");
const runs = require("../lib/agents/runs");
const openai = require("../lib/sources/openai");
const desk = require("../lib/agents/workflows/desk");

const router = express.Router();
const KINDS = ["compare", "what_if", "meeting_prep", "ideas"];

async function memberRun(req, res, workflow, symbol, fn) {
  if (!openai.configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  try {
    const out = await runs.run({ workflow, memberId: req.member.id, symbol }, fn);
    res.json({ runId: out.runId, output: out.output, costUsd: out.costUsd });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, runId: err.runId || null, code: err.code });
  }
}

router.post("/agents/desk/compare", requireAi, (req, res) => {
  let symbols;
  try { symbols = (Array.isArray(req.body?.symbols) ? req.body.symbols : String(req.body?.symbols || "").split(/[\s,]+/)).filter(Boolean); } catch { symbols = []; }
  const list = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
  if (list.length < 2 || list.length > 4 || list.some((s) => !/^[A-Z0-9.\-]{1,12}$/.test(s))) return res.status(400).json({ error: "Pick two to four tickers to compare." });
  return memberRun(req, res, "compare", list[0], (ctx) => desk.compare({ symbols: list }, ctx));
});

router.post("/agents/desk/what-if", requireAi, async (req, res) => {
  // Validate and price the trades before spending any AI budget.
  try { await desk.simulateTrades(req.body?.trades); } catch (err) { return res.status(err.status || 502).json({ error: err.message }); }
  return memberRun(req, res, "what_if", null, (ctx) => desk.whatIf({ trades: req.body.trades }, ctx));
});

router.post("/agents/desk/meeting-prep", requireAi, (req, res) => memberRun(req, res, "meeting_prep", null, (ctx) => desk.meetingPrep({ since: req.body?.since }, ctx)));

router.post("/agents/desk/ideas", requireAi, (req, res) => memberRun(req, res, "ideas", null, (ctx) => desk.ideas({ focus: req.body?.focus }, ctx)));

// The member's own recent desk runs, newest first.
router.get("/agents/desk/history", requireAi, (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
  const rows = db.prepare(`SELECT id, workflow, status, output, error, costUsd, createdAt FROM agent_runs WHERE memberId = ? AND workflow IN (${KINDS.map(() => "?").join(",")})
    ${kind ? "AND workflow = ?" : ""} ORDER BY id DESC LIMIT 20`).all(req.member.id, ...KINDS, ...(kind ? [kind] : []));
  res.json({ runs: rows.map((r) => ({ runId: r.id, workflow: r.workflow, status: r.status, error: r.error, costUsd: r.costUsd, createdAt: r.createdAt, output: r.output ? JSON.parse(r.output) : null })) });
});

module.exports = router;
