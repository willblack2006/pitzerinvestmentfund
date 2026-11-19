// Member-made agents (plan WS2): CRUD, versions, fork, follow, pause/resume, run now, dry run,
// cost estimate, templates and the metric list. Auto-mounted under /api (server.js).
//
//   GET    /platform/agents                 agents this member can see (team + own private)
//   GET    /platform/agents/templates       12 starter specs (lib/agents/templates/*.json)
//   POST   /platform/agents/validate        {spec} -> {spec, errors, warnings, estimate, describe}
//   POST   /platform/agents/estimate        {spec} -> cost per run and per month
//   POST   /platform/agents/dry-run         {spec, days} for an unsaved spec
//   POST   /platform/agents                 create {name, description, icon, visibility, spec}
//   GET    /platform/agents/:idOrSlug       one agent (+ recent runs and trigger log)
//   PUT    /platform/agents/:id             edit (owner or admin); every edit is a new version
//   DELETE /platform/agents/:id             archive (owner or admin)
//   GET    /platform/agents/:id/versions    POST /:id/restore {version}
//   POST   /platform/agents/:id/fork        copy into the member's own agent
//   POST   /platform/agents/:id/pause|resume (owner or admin)   suspend|unsuspend (admin)
//   POST   /platform/agents/:id/run         {symbol?} run now, billed to the member
//   POST   /platform/agents/:id/dry-run     {days} would-have-fired replay, no model calls
//   POST|DELETE /platform/agents/:id/follow
//   GET    /metrics                          the metric registry, for the builder's pickers
//
// Creating, editing and running agents needs AI access (plan section 7: keeps it with the same
// members, even for rule-only agents). Anyone signed in can read and follow team agents.
const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireSignedIn, requireAi, logActivity } = require("../middleware/auth");
const specLib = require("../lib/agents/spec");
const engine = require("../lib/agents/engine");
const triggers = require("../lib/agents/triggers");
const { dryRun } = require("../lib/agents/dryRun");
const registry = require("../lib/metrics/registry");

triggers.install();

const router = express.Router();
const http = (status, message, extra = {}) => Object.assign(new Error(message), { status, expose: true, ...extra });
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); } catch (err) {
    if (err instanceof specLib.SpecError) return res.status(400).json({ error: err.message, errors: err.errors, warnings: err.warnings });
    if (err.expose) return res.status(err.status || 400).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.runId ? { runId: err.runId } : {}) });
    next(err);
  }
};
const canAi = (m) => !!(m && (m.canUseAi || m.isAdmin));

// ---- Templates ----

const TEMPLATE_DIR = path.join(__dirname, "..", "lib", "agents", "templates");
let templateCache = null;
function templates() {
  if (templateCache) return templateCache;
  templateCache = fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const t = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, f), "utf8"));
    const { spec } = specLib.validate(t.spec);
    const aiFree = !spec.steps.some((s) => s.type === "ai");
    return { slug: t.slug, name: t.name, description: t.description, icon: t.icon || "bot", aiFree, category: aiFree ? "rule" : "ai", spec, describe: specLib.describe(spec), estimate: specLib.estimateCost(spec) };
  });
  return templateCache;
}

// ---- Views ----

function visibleTo(agent, member) {
  return agent.visibility === "team" || agent.ownerId === member.id || member.isAdmin;
}
function canEdit(agent, member) {
  return agent.kind === "custom" && (agent.ownerId === member.id || member.isAdmin);
}
function load(idOrSlug, member) {
  const a = engine.getAgent(idOrSlug);
  if (!a || (a.status === "archived" && !member.isAdmin && a.ownerId !== member.id)) throw http(404, "No such agent.");
  if (!visibleTo(a, member)) throw http(404, "No such agent.");
  return a;
}
function view(a, member) {
  const owner = a.ownerId ? db.prepare("SELECT name FROM members WHERE id = ?").get(a.ownerId) : null;
  const followers = db.prepare("SELECT COUNT(*) AS n FROM agent_follows WHERE agentId = ?").get(a.id).n;
  const following = !!db.prepare("SELECT 1 FROM agent_follows WHERE agentId = ? AND memberId = ?").get(a.id, member.id);
  const norm = a.kind === "custom" ? specLib.normalize(a.spec) : null;
  return {
    id: a.id, slug: a.slug, name: a.name, description: a.description, icon: a.icon, kind: a.kind, workflow: a.workflow,
    ownerId: a.ownerId, ownerName: owner?.name || null, visibility: a.visibility, status: a.status, version: a.version, forkedFrom: a.forkedFrom,
    lastRunAt: a.lastRunAt, nextRunAt: a.nextRunAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
    spec: a.spec, following, followers,
    describe: norm && !norm.errors.length ? specLib.describe(norm.spec) : null,
    estimate: norm && !norm.errors.length ? norm.estimate : null,
    canEdit: canEdit(a, member),
    monthSpendUsd: Math.round(engine.monthSpend(a.id) * 10000) / 10000,
  };
}

const slugify = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
function uniqueSlug(name) {
  const base = slugify(name).length >= 2 ? slugify(name) : `agent-${slugify(name)}`;
  let slug = base;
  for (let i = 2; db.prepare("SELECT 1 FROM agents WHERE slug = ?").get(slug); i++) slug = `${base}-${i}`;
  return slug;
}
function cleanMeta(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 60);
    if (name.length < 2) throw http(400, "Give the agent a name (2-60 characters).", { errors: [{ path: "name", message: "Give the agent a name (2-60 characters)." }] });
    out.name = name;
  }
  if (!partial || body.description !== undefined) out.description = String(body.description || "").trim().slice(0, 500);
  if (!partial || body.icon !== undefined) out.icon = /^[a-z0-9-]{1,30}$/.test(body.icon || "") ? body.icon : "bot";
  if (!partial || body.visibility !== undefined) out.visibility = body.visibility === "private" ? "private" : "team";
  return out;
}

function postFeed(kind, agent, member, title) {
  if (agent.visibility !== "team") return;
  try { require("../lib/platform/feed").post({ kind, actorType: "member", actorId: member.id, agentId: agent.id, title, body: { summary: agent.description || "", describe: (() => { try { return specLib.describe(specLib.normalize(agent.spec).spec); } catch { return null; } })() } }); } catch { /* feed optional */ }
}

function saveVersion(agentId, version, spec, memberId, note) {
  db.prepare("INSERT OR REPLACE INTO agent_versions (agentId, version, spec, editedBy, note) VALUES (?, ?, ?, ?, ?)").run(agentId, version, JSON.stringify(spec), memberId, String(note || "").slice(0, 300));
}

// ---- Routes ----

router.get("/metrics", requireSignedIn, (req, res) => res.json({ metrics: registry.list() }));

router.get("/platform/agents", requireSignedIn, wrap((req, res) => {
  const rows = db.prepare(`SELECT * FROM agents WHERE status != 'archived' AND (visibility = 'team' OR ownerId = ?) ORDER BY kind DESC, name`).all(req.member.id);
  res.json({ agents: rows.map((r) => view(engine.parseAgent(r), req.member)) });
}));

router.get("/platform/agents/templates", requireSignedIn, wrap((req, res) => res.json({ templates: templates() })));

router.post("/platform/agents/validate", requireSignedIn, wrap((req, res) => {
  const r = specLib.normalize(req.body?.spec);
  res.json({ spec: r.spec, errors: r.errors, warnings: r.warnings, estimate: r.estimate || null, describe: r.spec && !r.errors.length ? specLib.describe(r.spec) : null });
}));

router.post("/platform/agents/estimate", requireSignedIn, wrap((req, res) => {
  const { spec, warnings } = specLib.validate(req.body?.spec);
  const est = specLib.estimateCost(spec, { symbols: engine.symbolsFor(spec).length || 1 });
  const notes = warnings.map((w) => w.message);
  if (est.free) notes.unshift("No AI steps: this agent runs for free.");
  if (est.runsPerMonth == null) notes.push("Event-driven: the monthly cost depends on how often the events happen. Try a dry run.");
  res.json({ perRunUsd: est.perRunUsd, typicalRunUsd: est.typicalRunUsd, perMonthUsd: est.monthlyUsd, runsPerMonth: est.runsPerMonth, symbols: est.symbols, free: est.free, perStep: est.perStep, budget: spec.budget, notes, describe: specLib.describe(spec) });
}));

router.post("/platform/agents/dry-run", requireAi, wrap(async (req, res) => {
  const { spec } = specLib.validate(req.body?.spec);
  res.json(await dryRun(spec, { days: req.body?.days }));
}));

router.post("/platform/agents", requireAi, wrap((req, res) => {
  const meta = cleanMeta(req.body || {});
  const { spec, warnings } = specLib.validate(req.body?.spec);
  const slug = uniqueSlug(meta.name);
  const info = db.prepare(`INSERT INTO agents (slug, name, description, icon, kind, workflow, ownerId, visibility, status, spec, version)
    VALUES (?, ?, ?, ?, 'custom', 'engine', ?, ?, 'active', ?, 1)`).run(slug, meta.name, meta.description, meta.icon, req.member.id, meta.visibility, JSON.stringify(spec));
  const id = Number(info.lastInsertRowid);
  saveVersion(id, 1, spec, req.member.id, req.body?.note || "Created");
  db.prepare("INSERT OR IGNORE INTO agent_follows (agentId, memberId) VALUES (?, ?)").run(id, req.member.id);
  triggers.reschedule(id);
  const agent = engine.getAgent(id);
  postFeed("agent_created", agent, req.member, `${req.member.name} made a new agent: ${agent.name}`);
  logActivity(req, "agent_create", { id, slug });
  res.status(201).json({ agent: view(agent, req.member), warnings });
}));

router.get("/platform/agents/:idOrSlug", requireSignedIn, wrap((req, res) => {
  const a = load(req.params.idOrSlug, req.member);
  const runs = db.prepare("SELECT id, symbol, status, trigger, costUsd, summary, error, createdAt, finishedAt FROM agent_runs WHERE agentId = ? ORDER BY id DESC LIMIT 20").all(a.id);
  const fired = db.prepare("SELECT dedupeKey, trigger, symbol, outcome, runId, detail, createdAt FROM agent_trigger_log WHERE agentId = ? ORDER BY id DESC LIMIT 30").all(a.id);
  res.json({ agent: view(a, req.member), runs, triggerLog: fired });
}));

router.put("/platform/agents/:id", requireAi, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  if (!canEdit(a, req.member)) throw http(403, a.kind === "builtin" ? "Built-in agents can't be edited; fork one instead." : "Only the agent's owner or an admin can edit it. You can fork it.");
  const meta = cleanMeta(req.body || {}, { partial: true });
  let spec = a.spec, warnings = [], version = a.version;
  if (req.body?.spec !== undefined) {
    ({ spec, warnings } = specLib.validate(req.body.spec));
    if (JSON.stringify(spec) !== JSON.stringify(a.spec)) { version = a.version + 1; saveVersion(a.id, version, spec, req.member.id, req.body?.note); }
  }
  const m = { name: a.name, description: a.description, icon: a.icon, visibility: a.visibility, ...meta };
  db.prepare("UPDATE agents SET name = ?, description = ?, icon = ?, visibility = ?, spec = ?, version = ?, updatedAt = datetime('now') WHERE id = ?")
    .run(m.name, m.description, m.icon, m.visibility, JSON.stringify(spec), version, a.id);
  triggers.reschedule(a.id);
  const agent = engine.getAgent(a.id);
  if (version !== a.version) postFeed("agent_edited", agent, req.member, `${req.member.name} updated ${agent.name} (v${version})`);
  logActivity(req, "agent_edit", { id: a.id, version });
  res.json({ agent: view(agent, req.member), warnings });
}));

router.delete("/platform/agents/:id", requireAi, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  if (!canEdit(a, req.member)) throw http(403, "Only the agent's owner or an admin can archive it.");
  db.prepare("UPDATE agents SET status = 'archived', nextRunAt = NULL, updatedAt = datetime('now') WHERE id = ?").run(a.id);
  logActivity(req, "agent_archive", { id: a.id });
  res.json({ ok: true });
}));

router.get("/platform/agents/:id/versions", requireSignedIn, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  const versions = db.prepare(`SELECT v.version, v.spec, v.editedBy, m.name AS editedByName, v.note, v.createdAt FROM agent_versions v
    LEFT JOIN members m ON m.id = v.editedBy WHERE v.agentId = ? ORDER BY v.version DESC`).all(a.id).map((v) => ({ ...v, spec: JSON.parse(v.spec) }));
  res.json({ versions });
}));

router.post("/platform/agents/:id/restore", requireAi, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  if (!canEdit(a, req.member)) throw http(403, "Only the agent's owner or an admin can restore a version.");
  const v = db.prepare("SELECT spec FROM agent_versions WHERE agentId = ? AND version = ?").get(a.id, Number(req.body?.version));
  if (!v) throw http(404, "No such version.");
  const { spec } = specLib.validate(JSON.parse(v.spec));
  const version = a.version + 1;
  saveVersion(a.id, version, spec, req.member.id, `Restored v${req.body.version}`);
  db.prepare("UPDATE agents SET spec = ?, version = ?, updatedAt = datetime('now') WHERE id = ?").run(JSON.stringify(spec), version, a.id);
  triggers.reschedule(a.id);
  res.json({ agent: view(engine.getAgent(a.id), req.member) });
}));

router.post("/platform/agents/:id/fork", requireAi, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  if (a.kind !== "custom") throw http(400, "Built-in agents run fixed workflows; start from a template instead.");
  const { spec } = specLib.validate(a.spec);
  const name = String(req.body?.name || `${a.name} (copy)`).trim().slice(0, 60);
  const slug = uniqueSlug(name);
  const info = db.prepare(`INSERT INTO agents (slug, name, description, icon, kind, workflow, ownerId, visibility, status, spec, version, forkedFrom)
    VALUES (?, ?, ?, ?, 'custom', 'engine', ?, 'private', 'paused', ?, 1, ?)`).run(slug, name, a.description, a.icon, req.member.id, JSON.stringify(spec), a.id);
  const id = Number(info.lastInsertRowid);
  saveVersion(id, 1, spec, req.member.id, `Forked from ${a.name} v${a.version}`);
  logActivity(req, "agent_fork", { from: a.id, id });
  // A fork starts private and paused, so a copy never doubles the original's alerts by surprise.
  res.status(201).json({ agent: view(engine.getAgent(id), req.member) });
}));

function setStatus(req, res, from, to, { admin = false } = {}) {
  const a = load(req.params.id, req.member);
  if (a.kind !== "custom") throw http(400, "Built-in agents are controlled in Settings.");
  if (admin ? !req.member.isAdmin : !canEdit(a, req.member)) throw http(403, admin ? "Only an admin can do that." : "Only the agent's owner or an admin can do that.");
  if (a.status === "suspended" && !req.member.isAdmin) throw http(403, "An admin suspended this agent.");
  if (!from.includes(a.status)) throw http(409, `The agent is ${a.status}.`);
  db.prepare("UPDATE agents SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(to, a.id);
  triggers.reschedule(a.id);
  logActivity(req, `agent_${to}`, { id: a.id });
  res.json({ agent: view(engine.getAgent(a.id), req.member) });
}
router.post("/platform/agents/:id/pause", requireAi, wrap((req, res) => setStatus(req, res, ["active"], "paused")));
router.post("/platform/agents/:id/resume", requireAi, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  specLib.validate(a.spec); // a broken spec can't be resumed
  return setStatus(req, res, ["paused"], "active");
}));
router.post("/platform/agents/:id/suspend", requireAi, wrap((req, res) => setStatus(req, res, ["active", "paused"], "suspended", { admin: true })));
router.post("/platform/agents/:id/unsuspend", requireAi, wrap((req, res) => setStatus(req, res, ["suspended"], "paused", { admin: true })));

router.post("/platform/agents/:id/run", requireAi, wrap(async (req, res) => {
  const a = load(req.params.id, req.member);
  if (a.kind !== "custom") throw http(400, "Built-in agents run from their own pages.");
  const { spec } = specLib.validate(a.spec);
  let symbol = req.body?.symbol ? String(req.body.symbol).trim().toUpperCase() : null;
  if (symbol && !/^[A-Z0-9.\-^=]{1,12}$/.test(symbol)) throw http(400, "Not a valid ticker.");
  if (spec.scope.universe === "fund") symbol = null;
  else if (!symbol) symbol = engine.symbolsFor(spec)[0] || null;
  const r = await engine.runAgent(a, { symbol, trigger: "manual", triggeredBy: req.member.id, force: false });
  if (r.skipped) return res.json({ skipped: true, reason: r.reason, conditions: r.conditions || [] });
  res.json({ runId: r.runId, output: r.output, costUsd: r.costUsd });
}));

router.post("/platform/agents/:id/dry-run", requireAi, wrap(async (req, res) => {
  const a = load(req.params.id, req.member);
  const { spec } = specLib.validate(a.spec);
  res.json(await dryRun(spec, { days: req.body?.days }));
}));

router.post("/platform/agents/:id/follow", requireSignedIn, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  const notify = ["inbox", "digest", "push", "none"].includes(req.body?.notify) ? req.body.notify : "inbox";
  db.prepare("INSERT INTO agent_follows (agentId, memberId, notify) VALUES (?, ?, ?) ON CONFLICT(agentId, memberId) DO UPDATE SET notify = excluded.notify").run(a.id, req.member.id, notify);
  res.json({ following: true, notify });
}));
router.delete("/platform/agents/:id/follow", requireSignedIn, wrap((req, res) => {
  const a = load(req.params.id, req.member);
  db.prepare("DELETE FROM agent_follows WHERE agentId = ? AND memberId = ?").run(a.id, req.member.id);
  res.json({ following: false });
}));

module.exports = router;
module.exports.autoMount = true;
module.exports.templates = templates;
