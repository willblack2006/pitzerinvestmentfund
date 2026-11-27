// Data health (rebuild plan step 1.1), admins only. Auto-mounted under /api (see server.js).
//   GET  /api/admin/data-health              every collector's last run, health and the warehouse size
//   POST /api/admin/data-health/:name/run    run one collector now (returns the finished run)
const express = require("express");
const { requireAdmin, logActivity } = require("../middleware/auth");
const collectors = require("../lib/collectors");

collectors.loadAll(); // defines them even when the scheduler is off (tests, DISABLE_SCHEDULER)

const router = express.Router();

router.get("/admin/data-health", requireAdmin, (req, res) => {
  res.json(collectors.status());
});

const runningByHand = new Set();
router.post("/admin/data-health/:name/run", requireAdmin, async (req, res, next) => {
  const { name } = req.params;
  if (!collectors.list().some((c) => c.name === name)) return res.status(404).json({ error: "No such collector." });
  const scheduled = require("../lib/platform/jobs").status().find((j) => j.name === `collector:${name}`);
  if (runningByHand.has(name) || scheduled?.running) return res.status(409).json({ error: "That collector is already running." });
  runningByHand.add(name);
  try {
    const run = await collectors.run(name, "manual");
    logActivity(req, "collector.run", { name, status: run.status });
    res.json({ run });
  } catch (err) { next(err); } finally { runningByHand.delete(name); }
});

module.exports = router;
module.exports.autoMount = true;
