// Agent builder API (plan WS3): "describe it in words" drafting and the builder's catalog of
// tools, events and schedules. Creating, saving and running agents is the engine's API
// (routes/agentEngine.js). Members with AI access only, like every agent feature.
const express = require("express");
const { requireAi } = require("../middleware/auth");
const draft = require("../lib/agents/draft");

const router = express.Router();

// Words -> a spec the form opens pre-filled. Nothing is saved.
router.post("/platform/agents/draft", requireAi, async (req, res) => {
  try {
    const out = await draft.draft(req.body?.text, { memberId: req.member.id, useAi: req.body?.useAi !== false });
    res.json(out);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// What the builder can offer: tools grouped like Ask PIF's planner, events, schedule presets.
router.get("/platform/builder/catalog", requireAi, (req, res) => {
  res.json({ ...draft.catalog(), metrics: draft.metricNames() });
});

module.exports = router;
module.exports.autoMount = true;
