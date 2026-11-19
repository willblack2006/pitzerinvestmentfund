// Live agent runs and Ask PIF conversations (WS11).
//   GET  /api/agents/runs/:id/stream     Server-Sent Events: steps, answer text as it is written, done/error
//   GET  /api/ask/threads?scope=mine|team&q=
//   POST /api/ask/threads                { question, agentSlug?, forkOf? } -> 202 { thread, runId }
//   GET  /api/ask/threads/:id            the thread with every turn
//   POST /api/ask/threads/:id/messages   { question, agentSlug? } -> 202 { thread, runId }
//   POST /api/ask/threads/:id/share      { share: true|false }
//   PATCH/DELETE /api/ask/threads/:id    rename / archive
//   GET  /api/ask/agents                 team agents a member can address with @slug
const express = require("express");
const db = require("../db");
const { requireAi } = require("../middleware/auth");
const openai = require("../lib/sources/openai");
const stream = require("../lib/agents/stream");
const threads = require("../lib/agents/askThreads");

const router = express.Router();
const fail = (res, err) => res.status(err.status && err.status < 600 ? err.status : 502).json({ error: err.message, code: err.code, runId: err.runId || null });

router.get("/agents/runs/:id/stream", requireAi, (req, res) => {
  const id = Number(req.params.id);
  const run = Number.isInteger(id) ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) : null;
  if (!threads.canWatchRun(req.member, run)) return res.status(404).json({ error: "No such run." });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform also keeps the compression middleware from buffering the stream.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  let closed = false, unsub = () => {}, beat = null, poll = null;
  const end = () => {
    if (closed) return;
    closed = true; unsub(); clearInterval(beat); clearInterval(poll);
    try { res.end(); } catch { /* gone */ }
  };
  const send = (e) => {
    if (closed) return;
    try { res.write(`event: run\ndata: ${JSON.stringify(e)}\n\n`); } catch { end(); return; }
    if (e.type === "done" || e.type === "error") end();
  };
  const fromDb = () => {
    const r = db.prepare("SELECT status, output, error, costUsd, steps FROM agent_runs WHERE id = ?").get(id);
    if (!r || r.status === "running") return false;
    send(r.status === "done" ? { type: "done", output: r.output ? JSON.parse(r.output) : null, costUsd: r.costUsd } : { type: "error", error: r.error || r.status, status: r.status });
    return true;
  };
  req.on("close", end);
  // Finished before the page connected and no longer in memory: answer from the database.
  if (!stream.known(id) && run.status !== "running") { fromDb(); return; }
  // Steps logged before this page subscribed (a run started without a listener).
  if (!stream.known(id)) for (const s of JSON.parse(run.steps || "[]")) send({ type: "step", step: stream.stepView(s) });
  unsub = stream.subscribe(id, send);
  beat = setInterval(() => { try { res.write(": ping\n\n"); } catch { end(); } }, 20000);
  // Safety net: a run that finished somewhere this hub didn't hear about (another process).
  poll = setInterval(() => { if (!closed && !stream.known(id)) fromDb(); }, 5000);
  beat.unref?.(); poll.unref?.();
});

router.get("/ask/agents", requireAi, (req, res) => res.json({ agents: threads.addressableAgents(req.member) }));

router.get("/ask/threads", requireAi, (req, res) => {
  const scope = req.query.scope === "team" ? "team" : "mine";
  res.json({ threads: threads.listThreads(req.member, { scope, limit: req.query.limit, q: req.query.q || "" }) });
});

router.get("/ask/threads/:id", requireAi, (req, res) => {
  const t = threads.threadRow(req.params.id);
  if (!threads.canSee(t, req.member)) return res.status(404).json({ error: "No such conversation." });
  res.json(threads.threadView(t, req.member, { withTurns: true }));
});

router.post("/ask/threads", requireAi, async (req, res) => {
  if (!openai.configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  try { res.status(202).json(await threads.createThread(req.member, { question: req.body?.question, agentSlug: req.body?.agentSlug, forkOf: req.body?.forkOf ? Number(req.body.forkOf) : null })); }
  catch (err) { fail(res, err); }
});

router.post("/ask/threads/:id/messages", requireAi, async (req, res) => {
  if (!openai.configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  try { res.status(202).json(await threads.addTurn(req.member, Number(req.params.id), { question: req.body?.question, agentSlug: req.body?.agentSlug })); }
  catch (err) { fail(res, err); }
});

router.post("/ask/threads/:id/share", requireAi, (req, res) => {
  try { res.json(threads.share(req.member, Number(req.params.id), req.body?.share !== false)); } catch (err) { fail(res, err); }
});

router.patch("/ask/threads/:id", requireAi, (req, res) => {
  try { res.json(threads.rename(req.member, Number(req.params.id), req.body?.title)); } catch (err) { fail(res, err); }
});

router.delete("/ask/threads/:id", requireAi, (req, res) => {
  try { threads.archive(req.member, Number(req.params.id)); res.status(204).end(); } catch (err) { fail(res, err); }
});

module.exports = router;
