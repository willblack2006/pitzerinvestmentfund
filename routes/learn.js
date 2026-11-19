// "Start here" learning path: which milestones the signed-in member has reached.
const express = require("express");
const { requireSignedIn } = require("../middleware/auth");
const { learnProgress } = require("../lib/learnProgress");

const router = express.Router();

router.get("/learn/progress", requireSignedIn, (req, res) => res.json({ done: learnProgress(req.member.id) }));

module.exports = router;
