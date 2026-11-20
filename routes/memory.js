// Shared memory API (plan WS5): browse, search, add, edit (supersede), retract and pin what the
// fund's agents and members know; per-ticker dossiers; the agents' blackboard; and "Why?" for a
// run (the memory, handoffs and tool data it used). Reading is for every signed-in member (it's
// the team's knowledge, like the feed); a member's own preferences are visible only to them.
const express = require("express");
const db = require("../db");
const { requireSignedIn, requireAi } = require("../middleware/auth");
const memory = require("../lib/agents/memory");
const handoffs = require("../lib/agents/handoffs");

const router = express.Router();
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
const int = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Who may change a memory: its author, an admin, or (for agent-written memory) an AI member.
function canEdit(member, m) {
  if (!m) return false;
  if (member.isAdmin) return true;
  if (m.scope === "member") return m.scopeKey === String(member.id);
  if (m.by?.type === "member") return m.by.id === member.id;
  return !!member.canUseAi;
}
// Member-scope memories are private to that member.
const visible = (member, m) => m && (m.scope !== "member" || m.scopeKey === String(member.id));

router.get("/memory", requireSignedIn, (req, res) => {
  const q = req.query;
  const out = memory.list({
    symbol: q.symbol || null, scope: q.scope || null, kind: q.kind || null, agentId: int(q.agentId), memberId: int(q.by),
    viewerId: req.member.id, status: q.status || "active", q: String(q.q || "").slice(0, 200), limit: Math.min(200, int(q.limit) || 50), offset: int(q.offset) || 0,
    pinned: q.pinned === "1",
  });
  res.json({ ...out, facets: memory.facets(req.member.id), canWrite: true, canModerate: !!(req.member.isAdmin || req.member.canUseAi) });
});

// Ranked recall, the same ranking agents get (for "what would an agent see?").
router.get("/memory/recall", requireSignedIn, (req, res) => {
  res.json({ items: memory.recall({ symbol: req.query.symbol || null, query: String(req.query.q || "").slice(0, 300), memberId: req.member.id, limit: Math.min(50, int(req.query.limit) || 20) }) });
});

router.get("/memory/dossier/:symbol", requireSignedIn, (req, res) => {
  const s = String(req.params.symbol).toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(s)) return bad(res, "Not a valid ticker.");
  res.json({ ...memory.dossier(s), messages: handoffs.list({ symbol: s, limit: 10 }) });
});

// Writes the dossier card now (cheap model call) instead of waiting for the nightly pass.
router.post("/memory/dossier/:symbol/refresh", requireAi, async (req, res) => {
  const s = String(req.params.symbol).toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(s)) return bad(res, "Not a valid ticker.");
  if (!require("../lib/sources/openai").configured()) return bad(res, "AI isn't set up on this server.", 503);
  try {
    const r = await require("../lib/agents/workflows/dossier").refresh(s, { memberId: req.member.id });
    res.json({ runId: r.runId, ...memory.dossier(s) });
  } catch (err) { res.status(err.status || 500).json({ error: err.expose || err.name === "BudgetError" ? err.message : "Couldn't write the summary.", runId: err.runId }); }
});

router.get("/memory/blackboard", requireSignedIn, (req, res) => {
  res.json({ topics: handoffs.TOPICS, items: handoffs.list({ topic: req.query.topic || null, status: req.query.status || null, symbol: req.query.symbol || null, kind: req.query.kind || null, limit: Math.min(100, int(req.query.limit) || 40) }) });
});

router.get("/memory/:id", requireSignedIn, (req, res) => {
  const m = memory.get(int(req.params.id));
  if (!visible(req.member, m)) return bad(res, "No such memory.", 404);
  res.json({ ...m, history: memory.history(m.id), canEdit: canEdit(req.member, m) });
});

// A member adds a memory: active right away, credited to them. Preferences are always the
// member's own (scope member).
router.post("/memory", requireSignedIn, (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || "observation");
  let scope = String(b.scope || (b.symbol ? "symbol" : "fund"));
  let scopeKey = b.scopeKey ?? b.symbol ?? null;
  if (kind === "preference" || scope === "member") { scope = "member"; scopeKey = String(req.member.id); }
  if (scope === "agent") return bad(res, "Agent memory is written by the agent itself.");
  try {
    const r = memory.rememberDetailed({ scope, scopeKey, kind, text: b.text, sourceUrl: b.sourceUrl ? String(b.sourceUrl).slice(0, 500) : null, asOf: b.asOf || null, memberId: req.member.id, ...(b.expiresAt !== undefined ? { expiresAt: b.expiresAt || null } : {}) });
    res.status(r.duplicate ? 200 : 201).json({ ...memory.get(r.id), duplicate: r.duplicate });
  } catch (err) { res.status(err.status || 500).json({ error: err.expose ? err.message : "Couldn't save that." }); }
});

// Edit = supersede: the old text stays in the history.
router.patch("/memory/:id", requireSignedIn, (req, res) => {
  const m = memory.get(int(req.params.id));
  if (!visible(req.member, m)) return bad(res, "No such memory.", 404);
  if (!canEdit(req.member, m)) return bad(res, "You can't edit this memory.", 403);
  const b = req.body || {};
  const fields = { memberId: req.member.id };
  if (b.text != null) fields.text = b.text;
  if (b.kind != null) fields.kind = b.kind;
  if (b.expiresAt !== undefined) fields.expiresAt = b.expiresAt || null;
  if (b.sourceUrl !== undefined) fields.sourceUrl = b.sourceUrl ? String(b.sourceUrl).slice(0, 500) : null;
  try {
    const id = memory.supersede(m.id, fields);
    res.json({ ...memory.get(id), history: memory.history(id) });
  } catch (err) { res.status(err.status || 500).json({ error: err.expose ? err.message : "Couldn't save that." }); }
});

router.post("/memory/:id/retract", requireSignedIn, (req, res) => {
  const m = memory.get(int(req.params.id));
  if (!visible(req.member, m)) return bad(res, "No such memory.", 404);
  if (!canEdit(req.member, m)) return bad(res, "You can't retract this memory.", 403);
  memory.retract(m.id, req.member.id, String(req.body?.reason || "").slice(0, 300));
  res.json(memory.get(m.id));
});

router.post("/memory/:id/pin", requireSignedIn, (req, res) => {
  const m = memory.get(int(req.params.id));
  if (!visible(req.member, m)) return bad(res, "No such memory.", 404);
  if (!(req.member.isAdmin || req.member.canUseAi || canEdit(req.member, m))) return bad(res, "You can't pin this memory.", 403);
  res.json(memory.pin(m.id, req.member.id, req.body?.pinned !== false));
});

// "Why?" for a run: the memories it was given and which it cited, the messages it sent and got,
// child runs (ask_agent), the tools it called with their sources, and the memories it wrote.
router.get("/agents/runs/:id/explain", requireAi, (req, res) => {
  const runs = require("../lib/agents/runs");
  const r = runs.getRun(int(req.params.id));
  if (!r || (r.memberId && r.memberId !== req.member.id && !req.member.isAdmin)) return bad(res, "No such run.", 404);
  const given = [...new Set(r.steps.filter((s) => s.kind === "memory").flatMap((s) => s.ids || []))];
  const outText = JSON.stringify(r.output || "");
  const cited = new Set(memory.citedIds(outText));
  const mems = given.length ? db.prepare(`SELECT id FROM agent_memory WHERE id IN (${given.map(() => "?").join(",")})`).all(...given).map((x) => memory.get(x.id)) : [];
  const written = memory.ready() ? db.prepare("SELECT id FROM agent_memory WHERE sourceRunId = ? ORDER BY id").all(r.id).map((x) => memory.get(x.id)) : [];
  const msgs = handoffs.ready() ? db.prepare("SELECT id FROM agent_messages WHERE fromRunId = ? OR claimedByRunId = ? ORDER BY id").all(r.id, r.id).map((x) => x.id) : [];
  const messages = msgs.length ? handoffs.list({ limit: 200 }).filter((m) => msgs.includes(m.id)) : [];
  let children = [], parent = null;
  try {
    children = db.prepare("SELECT id, workflow, agentId, status, costUsd, summary, createdAt FROM agent_runs WHERE parentRunId = ? ORDER BY id").all(r.id);
    if (r.parentRunId) parent = db.prepare("SELECT id, workflow, agentId, status, summary FROM agent_runs WHERE id = ?").get(r.parentRunId) || null;
  } catch { /* WS1 columns */ }
  const tools = r.steps.filter((s) => s.kind === "tool").map((s) => ({ name: s.name, args: s.args, ok: s.ok, error: s.error, source_url: s.source_url, title: s.title }));
  res.json({
    runId: r.id, workflow: r.workflow, symbol: r.symbol, trigger: r.trigger || null,
    memory: mems.filter((m) => visible(req.member, m)).map((m) => ({ ...m, cited: cited.has(m.id) })),
    memoryWritten: written.filter((m) => visible(req.member, m)),
    messages, children, parent, tools,
    handoffSteps: r.steps.filter((s) => s.kind === "handoff" || s.kind === "ask_agent"),
  });
});

router.autoMount = true;
module.exports = router;
