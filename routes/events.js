const express = require("express");
const { optionalMember } = require("../middleware/auth");
const events = require("../lib/events");

const router = express.Router();

// Live update stream for every open page. Visitors get fund changes; signed-in members also
// get chat and who's online.
router.get("/events", optionalMember, (req, res) => {
  events.subscribe(req, res, req.member);
});

module.exports = router;
