// Agent teams API (WS6): start a committee, deep research or portfolio review run, and read run
// trees for the debate and trace views. Members with AI access only. Team runs are billed to the
// fund's monthly AI budget and shared with every member who has AI access (they're fund
// research, like briefs), so starting them is limited per member and per day (lib/agents/teams.js).
const express = require("express");
const { requireAi } = require("../middleware/auth");
const openai = require("../lib/sources/openai");
const teams = require("../lib/agents/teams");

teams.install();

const router = express.Router();
const TICKER = /^[A-Z0-9.\-]{1,12}$/;

router.get("/agents/teams", requireAi, (req, res) => {
  res.json({ teams: teams.describe(), usage: teams.usage(req.member.id), runs: teams.listRuns({ limit: 25 }), aiConfigured: openai.configured() });
});

router.get("/agents/teams/runs", requireAi, (req, res) => {
  const team = teams.TEAMS[req.query.team] ? req.query.team : null;
  const symbol = TICKER.test(String(req.query.symbol || "").toUpperCase()) ? String(req.query.symbol).toUpperCase() : null;
  const pitchId = Number(req.query.pitchId) || null;
  res.json({ runs: teams.listRuns({ team, symbol, pitchId, limit: Number(req.query.limit) || 30 }) });
});

router.get("/agents/teams/runs/:id", requireAi, (req, res) => {
  const tree = teams.getTree(Number(req.params.id));
  if (!tree) return res.status(404).json({ error: "No such team run." });
  res.json(tree);
});

// Starts a run and answers 202 with its id right away; the page polls the run tree.
router.post("/agents/teams/:team/runs", requireAi, async (req, res) => {
  const team = String(req.params.team);
  if (!teams.TEAMS[team]) return res.status(404).json({ error: "No such team." });
  if (!openai.configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  const b = req.body || {};
  const input = {};
  if (team === "committee") {
    if (b.pitchId != null && b.pitchId !== "") input.pitchId = Number(b.pitchId);
    else input.symbol = String(b.symbol || "").trim().toUpperCase();
    if (!input.pitchId && !TICKER.test(input.symbol || "")) return res.status(400).json({ error: "Pick a pitch or a ticker for the committee." });
  } else if (team === "deep_research") {
    input.symbol = String(b.symbol || "").trim().toUpperCase();
    if (!TICKER.test(input.symbol)) return res.status(400).json({ error: "Enter a ticker to research." });
    input.focus = String(b.focus || "").slice(0, 500);
  }
  try {
    const { runId } = await teams.start(team, input, { memberId: req.member.id, trigger: "manual" });
    res.status(202).json({ runId, team });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.expose || err.status ? err.message : "Couldn't start the team run.", code: err.code, runId: err.runId || null });
  }
});

// The pitch page's committee panel: the newest committee run on this pitch (running first).
router.get("/pitches/:id/committee", requireAi, (req, res) => {
  res.json({ run: teams.latestForPitch(Number(req.params.id)), usage: teams.usage(req.member.id), aiConfigured: openai.configured() });
});

module.exports = router;
module.exports.autoMount = true;
