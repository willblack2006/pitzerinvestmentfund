// Thesis data: pillars, checks, versions, scenario marks, catalysts and health snapshots.
// Tables come from lib/schema/platform.js (WS1) plus lib/schema/thesis.js (this workstream).
const db = require("../../db");
const { normalizeKpi } = require("./kpi");
const health = require("./health");

const STATUSES = ["intact", "watch", "weakened", "broken", "unknown"];
const ORIGINS = ["thesis", "catalyst", "kill", "variant", "member", "ai"];

let migrated = false;
function ready() {
  if (migrated) return;
  require("../schema/thesis")(db);
  migrated = true;
}
const tableExists = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
function available() {
  return ["thesis_pillars", "thesis_checks", "thesis_versions", "scenario_marks"].every(tableExists);
}

const err = (status, message) => Object.assign(new Error(message), { status, expose: true });
const clean = (s, n) => String(s ?? "").trim().slice(0, n);
const sym = (s) => String(s || "").toUpperCase().trim();
const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// Feed items (WS1/WS7). Best effort: the feed may not exist yet, and a feed failure never
// blocks a thesis change.
function feedPost(item) {
  try { return require("../platform/feed").post(item); } catch { return null; }
}

// ---- Pillars ----

const pillarView = (p) => p && ({ ...p, kpi: parse(p.kpi, null) });
const memberId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

function listPillars(symbol, { includeRetired = false } = {}) {
  ready();
  return db.prepare(`SELECT p.*, m.name AS createdByName FROM thesis_pillars p LEFT JOIN members m ON m.id = p.createdBy WHERE p.symbol = ? ${includeRetired ? "" : "AND p.retiredAt IS NULL"} ORDER BY p.ord, p.id`).all(sym(symbol)).map(pillarView);
}

function getPillar(id) {
  ready();
  return pillarView(db.prepare("SELECT p.*, m.name AS createdByName FROM thesis_pillars p LEFT JOIN members m ON m.id = p.createdBy WHERE p.id = ?").get(Number(id)));
}

function createPillar({ symbol, pitchId = null, text, kpi = null, weight = 1, reviewDays = null, origin = "member", consensus = "", createdBy = null }) {
  ready();
  const s = sym(symbol);
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(s)) throw err(400, "A pillar needs a ticker.");
  const t = clean(text, 600);
  if (t.length < 8) throw err(400, "Write the pillar as a sentence someone can check (8+ characters).");
  if (listPillars(s).length >= 8) throw err(400, "A thesis can have at most 8 live pillars. Retire one first.");
  const k = normalizeKpi(kpi);
  const w = Number(weight) > 0 ? Math.min(5, Number(weight)) : 1;
  const ord = (db.prepare("SELECT MAX(ord) AS m FROM thesis_pillars WHERE symbol = ?").get(s)?.m ?? 0) + 1;
  const info = db.prepare(`INSERT INTO thesis_pillars (symbol, pitchId, ord, text, kpi, status, createdBy, createdAt, updatedAt, weight, reviewDays, origin, consensus)
    VALUES (?, ?, ?, ?, ?, 'unknown', ?, datetime('now'), datetime('now'), ?, ?, ?, ?)`)
    .run(s, pitchId ? Number(pitchId) : null, ord, t, k ? JSON.stringify(k) : null, memberId(createdBy), w, Number(reviewDays) > 0 ? Math.round(Number(reviewDays)) : null, ORIGINS.includes(origin) ? origin : "member", clean(consensus, 400));
  return getPillar(Number(info.lastInsertRowid));
}

function updatePillar(id, fields) {
  ready();
  const p = getPillar(id);
  if (!p) throw err(404, "No such pillar.");
  const sets = [], vals = [];
  if ("text" in fields) { const t = clean(fields.text, 600); if (t.length < 8) throw err(400, "Write the pillar as a sentence someone can check."); sets.push("text = ?"); vals.push(t); }
  if ("kpi" in fields) { const k = normalizeKpi(fields.kpi); sets.push("kpi = ?"); vals.push(k ? JSON.stringify(k) : null); }
  if ("weight" in fields) { sets.push("weight = ?"); vals.push(Number(fields.weight) > 0 ? Math.min(5, Number(fields.weight)) : 1); }
  if ("reviewDays" in fields) { sets.push("reviewDays = ?"); vals.push(Number(fields.reviewDays) > 0 ? Math.round(Number(fields.reviewDays)) : null); }
  if ("consensus" in fields) { sets.push("consensus = ?"); vals.push(clean(fields.consensus, 400)); }
  if ("ord" in fields && Number.isInteger(Number(fields.ord))) { sets.push("ord = ?"); vals.push(Number(fields.ord)); }
  if (!sets.length) return p;
  db.prepare(`UPDATE thesis_pillars SET ${sets.join(", ")}, updatedAt = datetime('now') WHERE id = ?`).run(...vals, p.id);
  return getPillar(p.id);
}

function retirePillar(id, { by = "" } = {}) {
  ready();
  const p = getPillar(id);
  if (!p) throw err(404, "No such pillar.");
  db.prepare("UPDATE thesis_pillars SET retiredAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(p.id);
  feedPost({ kind: "thesis_change", actorType: "member", symbol: p.symbol, title: `${p.symbol}: pillar retired`, body: JSON.stringify({ pillarId: p.id, text: p.text, by }), importance: "low" });
  return getPillar(p.id);
}

// ---- Checks and status ----

// Records one check on a pillar (or the whole thesis when pillarId is null) and moves the
// pillar's status when the method is allowed to:
//   member: always (a member's call stands until a member changes it);
//   ai:     only through an approved proposal (callers pass approved: true);
//   rule:   only while the status was last set by a rule, or never set.
// Returns { checkId, moved, prev, status, overridden }.
function recordCheck({ symbol, pillarId = null, status, method, runId = null, score = null, evidence = [], detail = "", value = null, memberId = null, by = null, approved = false }) {
  ready();
  if (!STATUSES.includes(status)) throw err(400, `Status must be one of ${STATUSES.join(", ")}.`);
  if (!["rule", "ai", "member"].includes(method)) throw err(400, "Unknown check method.");
  const p = pillarId ? getPillar(pillarId) : null;
  if (pillarId && !p) throw err(404, "No such pillar.");
  const s = p ? p.symbol : sym(symbol);
  const ev = (Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean).slice(0, 6).map((e) => (typeof e === "string" ? { text: clean(e, 500) } : { text: clean(e.text, 500), source_url: e.source_url ? clean(e.source_url, 500) : undefined, as_of: e.as_of ? clean(e.as_of, 30) : undefined }));
  const prev = p ? p.status : null;
  const info = db.prepare("INSERT INTO thesis_checks (symbol, pillarId, runId, status, score, evidence, method, createdAt, value, detail, memberId, prevStatus) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)")
    .run(s, p ? p.id : null, runId, status, Number.isFinite(score) ? score : null, JSON.stringify(ev), method, Number.isFinite(value) ? value : null, clean(detail, 500), memberId, prev);
  let moved = false, overridden = false;
  if (p) {
    const ruleMayMove = !p.statusBy || p.statusBy === "rule";
    const may = method === "member" || (method === "ai" && approved) || (method === "rule" && ruleMayMove);
    const sets = ["lastCheckAt = datetime('now')"]; const vals = [];
    if (Number.isFinite(value)) { sets.push("lastValue = ?"); vals.push(value); }
    if (may && status !== p.status) {
      sets.push("status = ?", "statusBy = ?", "statusAt = datetime('now')");
      vals.push(status, method === "member" ? clean(by, 80) || "member" : method);
      moved = true;
    } else if (may && method === "member") {
      sets.push("statusBy = ?", "statusAt = datetime('now')"); vals.push(clean(by, 80) || "member");
    } else if (!may && method === "rule" && status !== p.status) overridden = true;
    db.prepare(`UPDATE thesis_pillars SET ${sets.join(", ")}, updatedAt = datetime('now') WHERE id = ?`).run(...vals, p.id);
    if (moved) db.prepare("UPDATE thesis_checks SET moved = 1 WHERE id = ?").run(Number(info.lastInsertRowid));
    // Agents can trigger on this (spec trigger "thesis_change").
    if (moved) { try { require("../platform/bus").emit("thesis_change", { symbol: s, pillarId: p.id, from: prev, status, method }); } catch { /* bus optional */ } }
    if (moved) {
      feedPost({
        kind: "thesis_change", actorType: method === "member" ? "member" : method === "ai" ? "agent" : "system", actorId: memberId || null, runId, symbol: s,
        title: `${s} pillar ${prev} → ${status}`, body: JSON.stringify({ pillarId: p.id, pillar: p.text, from: prev, to: status, method, detail: clean(detail, 300) }),
        importance: status === "broken" || status === "weakened" ? "high" : "normal",
      });
    }
  }
  return { checkId: Number(info.lastInsertRowid), moved, prev, status, overridden };
}

function checks(symbol, { pillarId = null, since = null, limit = 300 } = {}) {
  ready();
  const where = ["symbol = ?"], vals = [sym(symbol)];
  if (pillarId) { where.push("pillarId = ?"); vals.push(Number(pillarId)); }
  if (since) { where.push("createdAt >= ?"); vals.push(since); }
  return db.prepare(`SELECT c.*, m.name AS memberName FROM thesis_checks c LEFT JOIN members m ON m.id = c.memberId WHERE ${where.map((w) => `c.${w}`).join(" AND ")} ORDER BY c.createdAt DESC, c.id DESC LIMIT ?`).all(...vals, limit)
    .map((c) => ({ ...c, evidence: parse(c.evidence, []) }));
}

// ---- Versions (written on every thesis save) ----

function saveVersion({ symbol, text, targetPrice = null, editedBy = null, note = "" }) {
  ready();
  const s = sym(symbol);
  const last = db.prepare("SELECT text, targetPrice FROM thesis_versions WHERE symbol = ? ORDER BY id DESC LIMIT 1").get(s);
  const tp = Number(targetPrice) > 0 ? Number(targetPrice) : null;
  if (last && last.text === String(text || "") && (last.targetPrice ?? null) === tp) return null; // nothing changed
  const info = db.prepare("INSERT INTO thesis_versions (symbol, text, targetPrice, editedBy, createdAt, note) VALUES (?, ?, ?, ?, datetime('now'), ?)").run(s, String(text || "").slice(0, 20000), tp, memberId(editedBy), clean(note, 200));
  return Number(info.lastInsertRowid);
}

function versions(symbol, { limit = 50 } = {}) {
  ready();
  return db.prepare("SELECT v.*, m.name AS editedByName FROM thesis_versions v LEFT JOIN members m ON m.id = v.editedBy WHERE v.symbol = ? ORDER BY v.id DESC LIMIT ?").all(sym(symbol), limit);
}

// ---- Scenario probabilities ----

function addScenarioMark({ symbol, runId = null, bullProb, baseProb, bearProb, note = "", memberId = null, source = "member" }) {
  ready();
  const p = health.normalizeProbs({ bullProb, baseProb, bearProb });
  if (!p) throw err(400, "Give bull, base and bear probabilities (they're scaled to add up to 100%).");
  const info = db.prepare("INSERT INTO scenario_marks (symbol, runId, bullProb, baseProb, bearProb, note, createdAt, memberId, source) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)")
    .run(sym(symbol), runId, round3(p.bullProb), round3(p.baseProb), round3(p.bearProb), clean(note, 400), memberId == null ? null : Number(memberId), source === "agent" ? "agent" : "member");
  return Number(info.lastInsertRowid);
}
const round3 = (x) => Math.round(x * 1000) / 1000;

function scenarioMarks(symbol, { limit = 100 } = {}) {
  ready();
  return db.prepare("SELECT s.*, m.name AS memberName FROM scenario_marks s LEFT JOIN members m ON m.id = s.memberId WHERE s.symbol = ? ORDER BY s.createdAt ASC, s.id ASC LIMIT ?").all(sym(symbol), limit);
}

// ---- Catalysts ----

function listCatalysts(symbol) {
  ready();
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare("SELECT * FROM thesis_catalysts WHERE symbol = ? ORDER BY COALESCE(dueDate, '9999') ASC, id ASC").all(sym(symbol)).map((c) => ({ ...c, state: health.catalystState(c, today) }));
}

function addCatalyst({ symbol, text, dueDate = null, pitchId = null, pillarId = null, createdBy = "" }) {
  ready();
  const t = clean(text, 300);
  if (t.length < 4) throw err(400, "Describe the catalyst.");
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw err(400, "Due date must be YYYY-MM-DD.");
  const info = db.prepare("INSERT INTO thesis_catalysts (symbol, text, dueDate, pitchId, pillarId, createdBy) VALUES (?, ?, ?, ?, ?, ?)").run(sym(symbol), t, dueDate || null, pitchId, pillarId, clean(createdBy, 80));
  return db.prepare("SELECT * FROM thesis_catalysts WHERE id = ?").get(Number(info.lastInsertRowid));
}

function resolveCatalyst(id, { status, note = "", by = "" }) {
  ready();
  const c = db.prepare("SELECT * FROM thesis_catalysts WHERE id = ?").get(Number(id));
  if (!c) throw err(404, "No such catalyst.");
  if (!["pending", "hit", "miss", "dropped"].includes(status)) throw err(400, "Status must be pending, hit, miss or dropped.");
  db.prepare("UPDATE thesis_catalysts SET status = ?, note = ?, resolvedAt = CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END, resolvedBy = ? WHERE id = ?").run(status, clean(note, 300), status, clean(by, 80), c.id);
  if (status === "hit" || status === "miss") {
    feedPost({ kind: "thesis_change", actorType: "member", symbol: c.symbol, title: `${c.symbol} catalyst ${status === "hit" ? "happened" : "missed"}: ${c.text.slice(0, 80)}`, body: JSON.stringify({ catalystId: c.id, status, by }), importance: "normal" });
  }
  return db.prepare("SELECT * FROM thesis_catalysts WHERE id = ?").get(c.id);
}

function deleteCatalyst(id) {
  ready();
  return db.prepare("DELETE FROM thesis_catalysts WHERE id = ?").run(Number(id)).changes;
}

// ---- Health snapshots ----

function writeHealth(symbol, { score, status, parts }, date = new Date().toISOString().slice(0, 10)) {
  ready();
  db.prepare("INSERT INTO thesis_health (symbol, date, score, status, parts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET score = excluded.score, status = excluded.status, parts = excluded.parts")
    .run(sym(symbol), date, score, status, JSON.stringify(parts || {}));
}

function healthSeries(symbols, { days = 180 } = {}) {
  ready();
  if (!symbols.length) return {};
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT symbol, date, score, status FROM thesis_health WHERE date >= ? AND symbol IN (${symbols.map(() => "?").join(",")}) ORDER BY date`).all(since, ...symbols.map(sym));
  const out = {};
  for (const r of rows) (out[r.symbol] ||= []).push({ date: r.date, score: r.score, status: r.status });
  return out;
}

module.exports = {
  STATUSES, ORIGINS, ready, available, feedPost,
  listPillars, getPillar, createPillar, updatePillar, retirePillar,
  recordCheck, checks, saveVersion, versions, addScenarioMark, scenarioMarks,
  listCatalysts, addCatalyst, resolveCatalyst, deleteCatalyst, writeHealth, healthSeries,
};
