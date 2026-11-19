// Thesis tracking API (WS4): the thesis board, one holding's thesis timeline, pillars and their
// checks, member overrides, catalysts, scenario odds, and AI suggestions (which file proposals a
// member approves). Signed-in members only; AI output (ai checks) only for members with AI access.
const express = require("express");
const db = require("../db");
const { requireSignedIn, requireAi, logActivity } = require("../middleware/auth");
const store = require("../lib/thesis/store");
const evaluate = require("../lib/thesis/evaluate");
const metrics = require("../lib/thesis/metrics");
const thesisAi = require("../lib/thesis/ai");
require("../lib/thesis"); // registers workflows and the daily rule job

const router = express.Router();
const SYM = /^[A-Z0-9.\-^=]{1,12}$/;
const symOf = (req) => {
  const s = String(req.params.symbol || "").toUpperCase().trim();
  if (!SYM.test(s)) throw Object.assign(new Error("Bad ticker."), { status: 400, expose: true });
  return s;
};
const canSeeAi = (m) => !!(m && (m.canUseAi || m.isAdmin));

// 503 with a plain message until the platform tables exist (WS1's schema).
router.use("/theses", (req, res, next) => {
  if (!store.available()) return res.status(503).json({ error: "Thesis tracking isn't set up on this server yet (missing tables)." });
  store.ready();
  next();
});

// Live data is optional here: a slow or offline source never holds the page for long.
const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms).unref?.())]);
async function pricesFor(symbols) {
  if (!symbols.length) return {};
  return within(require("../lib/prices").latestPrices(symbols), 6000, {});
}

router.get("/theses", requireSignedIn, async (req, res) => {
  const symbols = evaluate.trackedSymbols();
  const prices = await pricesFor(symbols);
  const days = Math.min(365, Math.max(30, Number(req.query.days) || 180));
  res.json({ rows: evaluate.board({ prices, days }), asOf: new Date().toISOString() });
});

router.get("/theses/metrics", requireSignedIn, (req, res) => {
  res.json({ metrics: metrics.catalog() });
});

// Everything the per-holding timeline needs, on one time axis.
router.get("/theses/:symbol", requireSignedIn, async (req, res) => {
  const s = symOf(req);
  const prices = await pricesFor([s]);
  const summary = evaluate.summarize(s, { price: prices[s]?.price ?? null });
  const showAi = canSeeAi(req.member);
  const checks = store.checks(s, { limit: 500 }).filter((c) => showAi || c.method !== "ai");
  const versions = store.versions(s).map((v) => ({ ...v, text: v.text.slice(0, 6000) }));
  const marks = store.scenarioMarks(s);
  const catalysts = store.listCatalysts(s);
  let tripwires = [];
  try { tripwires = db.prepare("SELECT id, kind, value, dueDate, note, status, trippedAt, trippedDetail, createdAt FROM tripwires WHERE symbol = ? ORDER BY createdAt").all(s); } catch { /* table optional */ }
  let priceHistory = [];
  try {
    const h = await within(require("../lib/prices").histories([s], "1y"), 6000, {});
    priceHistory = (h[s] || []).map((p) => ({ date: p.date, close: p.close })).filter((p) => p.date && Number.isFinite(p.close));
  } catch { /* offline: timeline without the price line */ }
  const health = store.healthSeries([s], { days: 365 })[s] || [];
  const orig = evaluate.originalThesis(s);
  let pending = [];
  if (showAi) {
    pending = require("../lib/agents/proposals").list({ status: "pending" }).filter((p) => p.symbol === s && ["thesis_pillars", "pillar_status", "scenario_update", "thesis_status"].includes(p.kind));
  }
  res.json({ ...summary, checks, versions, marks, catalysts, tripwires, priceHistory, healthHistory: health, original: orig ? { from: orig.from, at: orig.at, text: orig.text.slice(0, 6000) } : null, pending, canUseAi: showAi });
});

router.post("/theses/:symbol/pillars", requireSignedIn, (req, res) => {
  const s = symOf(req);
  const b = req.body || {};
  const p = store.createPillar({ symbol: s, pitchId: b.pitchId || null, text: b.text, kpi: b.kpi, weight: b.weight, reviewDays: b.reviewDays, origin: b.origin || "member", consensus: b.consensus, createdBy: req.member.id });
  logActivity(req, "thesis.pillar.create", { symbol: s, pillarId: p.id });
  store.feedPost({ kind: "thesis_change", actorType: "member", actorId: req.member.id, symbol: s, title: `${s}: new thesis pillar`, body: JSON.stringify({ pillarId: p.id, text: p.text }), importance: "low" });
  res.status(201).json(p);
});

router.patch("/theses/pillars/:id", requireSignedIn, (req, res) => {
  const p = store.updatePillar(Number(req.params.id), req.body || {});
  logActivity(req, "thesis.pillar.edit", { pillarId: p.id });
  res.json(p);
});

router.post("/theses/pillars/:id/retire", requireSignedIn, (req, res) => {
  const p = store.retirePillar(Number(req.params.id), { by: req.member.name });
  logActivity(req, "thesis.pillar.retire", { pillarId: p.id });
  res.json(p);
});

// A member's own read of a pillar. It stands until a member changes it; rule checks keep being
// recorded beside it (shown as "rule disagrees") but don't move it.
router.post("/theses/pillars/:id/status", requireSignedIn, (req, res) => {
  const { status, note } = req.body || {};
  const text = String(note || "").trim();
  if (text.length < 10) return res.status(400).json({ error: "Add a sentence of evidence (10+ characters) so others can see why." });
  const out = store.recordCheck({ pillarId: Number(req.params.id), status, method: "member", memberId: req.member.id, by: req.member.name, evidence: [{ text }], detail: text });
  logActivity(req, "thesis.pillar.status", { pillarId: Number(req.params.id), status });
  res.json({ ...out, pillar: store.getPillar(Number(req.params.id)) });
});

// Hand a pillar back to its KPI rule (undo a member's override).
router.post("/theses/pillars/:id/release", requireSignedIn, (req, res) => {
  const p = store.getPillar(Number(req.params.id));
  if (!p) return res.status(404).json({ error: "No such pillar." });
  db.prepare("UPDATE thesis_pillars SET statusBy = 'rule', updatedAt = datetime('now') WHERE id = ?").run(p.id);
  res.json(store.getPillar(p.id));
});

// Free: re-run the KPI rules for one symbol now.
router.post("/theses/:symbol/evaluate", requireSignedIn, async (req, res) => {
  const s = symOf(req);
  const prices = await pricesFor([s]);
  res.json(await evaluate.runRules({ symbols: [s], prices, force: true }));
});

router.post("/theses/:symbol/scenario", requireSignedIn, (req, res) => {
  const s = symOf(req);
  const { bullProb, baseProb, bearProb, note } = req.body || {};
  const id = store.addScenarioMark({ symbol: s, bullProb, baseProb, bearProb, note, memberId: req.member.id, source: "member" });
  store.feedPost({ kind: "thesis_change", actorType: "member", actorId: req.member.id, symbol: s, title: `${s} scenario odds updated`, body: JSON.stringify({ markId: id, bullProb, baseProb, bearProb, note: String(note || "").slice(0, 200) }), importance: "low" });
  res.status(201).json({ id });
});

router.post("/theses/:symbol/catalysts", requireSignedIn, (req, res) => {
  const s = symOf(req);
  const { text, dueDate, pillarId } = req.body || {};
  res.status(201).json(store.addCatalyst({ symbol: s, text, dueDate: dueDate || null, pillarId: pillarId || null, createdBy: req.member.name }));
});

router.post("/theses/catalysts/:id", requireSignedIn, (req, res) => {
  const { status, note } = req.body || {};
  res.json(store.resolveCatalyst(Number(req.params.id), { status, note, by: req.member.name }));
});

router.delete("/theses/catalysts/:id", requireSignedIn, (req, res) => {
  res.json({ deleted: store.deleteCatalyst(Number(req.params.id)) });
});

// ---- AI suggestions (proposals a member approves) ----

async function runAi(req, res, workflow, symbol, fn) {
  const runs = require("../lib/agents/runs");
  if (!require("../lib/sources/openai").configured()) return res.status(503).json({ error: "AI needs OPENAI_API_KEY set on the server." });
  try {
    const out = await runs.run({ workflow, memberId: req.member.id, symbol }, fn);
    res.json({ runId: out.runId, costUsd: out.costUsd, ...out.output });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, runId: err.runId || null, code: err.code });
  }
}

router.post("/theses/:symbol/pillars/suggest", requireAi, (req, res) => {
  const s = symOf(req);
  return runAi(req, res, "thesis_pillars", s, (ctx) => thesisAi.suggestPillars({ symbol: s, pitchId: req.body?.pitchId || null }, ctx));
});

router.post("/theses/:symbol/scenario/suggest", requireAi, (req, res) => {
  const s = symOf(req);
  return runAi(req, res, "thesis_scenario", s, (ctx) => thesisAi.suggestScenario({ symbol: s }, ctx));
});

// AI check of every pillar against the newest brief on this symbol (or text the member pastes).
router.post("/theses/:symbol/check", requireAi, (req, res) => {
  const s = symOf(req);
  const pasted = String(req.body?.text || "").trim().slice(0, 6000);
  let info = pasted ? { memberNote: pasted } : null, briefRunId = null;
  if (!info) {
    const r = db.prepare("SELECT id, output FROM agent_runs WHERE symbol = ? AND status = 'done' AND workflow IN ('filing_flash','earnings_flash','earnings_preview') ORDER BY id DESC LIMIT 1").get(s);
    if (!r) return res.status(400).json({ error: "No recent brief on this ticker. Paste the news or notes to check against." });
    const b = JSON.parse(r.output || "null") || {};
    info = { headline: b.headline, bottomLine: b.bottomLine, points: (b.points || []).filter((p) => p.verified !== false) };
    briefRunId = r.id;
  }
  return runAi(req, res, "thesis_pillar_check", s, (ctx) => thesisAi.checkPillars({ symbol: s, info, briefRunId }, ctx));
});

module.exports = router;
module.exports.autoMount = true;
