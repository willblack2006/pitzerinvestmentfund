// Agent profiles, the team directory and following (WS7). Read-only plus follow/unfollow;
// editing, forking, pausing and "run now" are WS2's /api/platform/agents endpoints.
const express = require("express");
const { requireSignedIn } = require("../middleware/auth");
const info = require("../lib/feed/agents");
const follows = require("../lib/feed/follows");

const router = express.Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.expose || err.status ? err.message : "Something went wrong on the server." });

router.get("/agents/directory", requireSignedIn, (req, res) => {
  res.json(info.directory(req.member, { q: req.query.q, sort: req.query.sort, mine: req.query.mine === "1", kind: req.query.kind }));
});

router.get("/agents/a/:slug", requireSignedIn, (req, res) => {
  const p = info.profile(req.member, req.params.slug);
  if (!p) return res.status(404).json({ error: "No such agent." });
  res.json(p);
});

// Follow (or change the notify level): body { notify: all | inbox | digest | off }.
router.put("/agents/a/:slug/follow", requireSignedIn, (req, res) => {
  const a = follows.visibleAgent(req.member, req.params.slug);
  if (!a) return res.status(404).json({ error: "No such agent." });
  try { res.json(follows.follow(req.member, a.id, req.body?.notify)); } catch (err) { fail(res, err); }
});
router.delete("/agents/a/:slug/follow", requireSignedIn, (req, res) => {
  const a = follows.visibleAgent(req.member, req.params.slug);
  if (!a) return res.status(404).json({ error: "No such agent." });
  res.json(follows.unfollow(req.member, a.id));
});

// What the signed-in member follows (for chips and the Home tab).
router.get("/agents/following", requireSignedIn, (req, res) => res.json({ follows: follows.followedBy(req.member.id) }));

module.exports = router;
module.exports.autoMount = true;
