// Team feed API (WS7). Signed-in members only: visitors never see the feed. Writing comments
// and reacting needs only sign-in; @agent answers, sharing AI runs and follow-ups need AI access.
const express = require("express");
const { requireSignedIn, requireAi } = require("../middleware/auth");
const query = require("../lib/feed/query");
const comments = require("../lib/feed/comments");
const share = require("../lib/feed/share");
const presence = require("../lib/feed/presence");
const agentsInfo = require("../lib/feed/agents");
const { db, ensure } = require("../lib/feed/store");

const router = express.Router();

const fail = (res, err) => res.status(err.status || 500).json({ error: err.expose || err.status ? err.message : "Something went wrong on the server." });
const q = (req) => ({
  filter: req.query.filter, symbol: req.query.symbol, memberId: req.query.member, agentId: req.query.agent,
  kind: req.query.kind, importance: req.query.importance, before: req.query.before, after: req.query.after, limit: req.query.limit,
});

router.get("/feed", requireSignedIn, (req, res) => res.json(query.list(req.member, q(req))));
router.get("/feed/unread", requireSignedIn, (req, res) => res.json(query.unreadCount(req.member)));
router.get("/feed/facets", requireSignedIn, (req, res) => res.json(query.facets(req.member)));
router.post("/feed/read", requireSignedIn, (req, res) => res.json({ lastReadId: query.markRead(req.member, req.body?.lastReadId) }));
router.get("/feed/reactions", requireSignedIn, (req, res) => res.json(comments.REACTIONS));

// Live presence: heartbeat while a page is open; leave on unload.
router.post("/feed/presence", requireSignedIn, (req, res) => {
  const target = String(req.body?.target || "");
  if (!presence.valid(target)) return res.status(400).json({ error: "Bad presence target." });
  res.json({ target, viewers: presence.beat(req.member, target, { leave: req.body?.leave === true }) });
});
router.get("/feed/presence", requireSignedIn, (req, res) => {
  const target = String(req.query.target || "");
  res.json({ target, viewers: presence.valid(target) ? presence.list(target) : [] });
});

// Runs going on right now (agent chips, "Running now").
router.get("/feed/running", requireSignedIn, (req, res) => res.json({ running: agentsInfo.runningNow(req.member) }));

router.get("/feed/:id", requireSignedIn, (req, res) => {
  const r = comments.list(req.member, Number(req.params.id));
  if (!r) return res.status(404).json({ error: "That feed item isn't there." });
  res.json(r);
});

router.post("/feed/:id/comments", requireSignedIn, (req, res) => {
  try { res.status(201).json(comments.add(req.member, Number(req.params.id), req.body?.text)); } catch (err) { fail(res, err); }
});
router.delete("/feed/comments/:id", requireSignedIn, (req, res) => {
  try { comments.remove(req.member, Number(req.params.id)); res.status(204).end(); } catch (err) { fail(res, err); }
});
router.post("/feed/:id/react", requireSignedIn, (req, res) => {
  try { res.json({ reactions: comments.react(req.member, Number(req.params.id), req.body?.emoji) }); } catch (err) { fail(res, err); }
});

// Pin to the top (admins, or the member who posted it). Pinning again unpins.
router.post("/feed/:id/pin", requireSignedIn, (req, res) => {
  const item = query.get(req.member, Number(req.params.id));
  if (!item) return res.status(404).json({ error: "That feed item isn't there." });
  if (!req.member.isAdmin && !(item.actor.type === "member" && item.actor.id === req.member.id)) return res.status(403).json({ error: "Only admins or the person who posted it can pin an item." });
  const pinned = !!db.prepare("SELECT 1 FROM feed_pins WHERE itemId = ?").get(item.id);
  if (pinned) db.prepare("DELETE FROM feed_pins WHERE itemId = ?").run(item.id);
  else db.prepare("INSERT INTO feed_pins (itemId, pinnedBy) VALUES (?, ?)").run(item.id, req.member.id);
  res.json({ pinned: !pinned });
});

// A teammate's shared AI answer → continue it as your own run.
router.post("/feed/:id/follow-up", requireAi, async (req, res) => {
  if (!require("../lib/sources/openai").configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  try { res.json(await share.followUp(req.member, Number(req.params.id), req.body?.question)); }
  catch (err) { res.status(err.status || 502).json({ error: err.message, runId: err.runId || null, code: err.code }); }
});

// Share / unshare one of your own AI runs (Ask PIF, research desk, primer, red team).
router.post("/agents/runs/:id/share", requireAi, (req, res) => {
  try { res.status(201).json(share.share(req.member, Number(req.params.id), { note: req.body?.note })); } catch (err) { fail(res, err); }
});
router.delete("/agents/runs/:id/share", requireAi, (req, res) => {
  try { res.json(share.unshare(req.member, Number(req.params.id))); } catch (err) { fail(res, err); }
});

// A run a teammate shared: readable by every signed-in member who can see the feed item.
router.get("/feed/runs/:id", requireSignedIn, (req, res) => {
  ensure();
  const run = require("../lib/agents/runs").getRun(Number(req.params.id));
  if (!run || !share.canRead(req.member, run)) return res.status(404).json({ error: "No such run." });
  const { steps, ...rest } = run;
  res.json({ ...rest, steps: (steps || []).filter((s) => s.kind === "tool").map((s) => ({ name: s.name, ok: s.ok, source_url: s.source_url || null })), sharedItemId: share.itemForRun(run.id) });
});

module.exports = router;
module.exports.autoMount = true;
