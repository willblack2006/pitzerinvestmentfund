// Thesis evaluation: rule checks on every pillar KPI (free, daily), the health score and overall
// status per holding, and the per-symbol summary the board and timeline read.
const db = require("../../db");
const store = require("./store");
const health = require("./health");
const { evaluateKpi } = require("./kpi");
const metrics = require("./metrics");

const today = () => new Date().toISOString().slice(0, 10);

function holdings() {
  try { return db.prepare("SELECT symbol FROM positions WHERE shares > 0 ORDER BY marketValue DESC").all().map((r) => r.symbol); } catch { return []; }
}

// Symbols with at least one live pillar, plus every holding (a holding with no pillars still
// gets a health row so the board can say "no pillars").
function trackedSymbols() {
  store.ready();
  const withPillars = db.prepare("SELECT DISTINCT symbol FROM thesis_pillars WHERE retiredAt IS NULL").all().map((r) => r.symbol);
  return [...new Set([...holdings(), ...withPillars])];
}

// The thesis as first pitched: the newest approved/executed pitch's thesis, else the first saved
// version of the Research thesis.
function originalThesis(symbol) {
  const p = metrics.latestPitch(symbol);
  if (p?.thesis?.trim()) return { text: p.thesis, from: `pitch #${p.id}`, at: p.decidedAt || p.createdAt };
  const v = db.prepare("SELECT text, createdAt FROM thesis_versions WHERE symbol = ? ORDER BY id ASC LIMIT 1").get(symbol);
  return v ? { text: v.text, from: "first saved version", at: v.createdAt } : null;
}

function killTripped(symbol) {
  try { return db.prepare("SELECT COUNT(*) AS n FROM tripwires WHERE symbol = ? AND status = 'tripped'").get(symbol).n; } catch { return 0; }
}

// Everything about one holding's thesis right now. `price` is optional (the board passes live
// prices; without one the bear adjustment is skipped).
function summarize(symbol, { price = null, now = new Date().toISOString() } = {}) {
  store.ready();
  const s = String(symbol).toUpperCase();
  const pillars = store.listPillars(s);
  const note = db.prepare("SELECT thesis, targetPrice, priceAtThesis, thesisStatus, updatedAt FROM research_notes WHERE symbol = ?").get(s) || null;
  const pitch = metrics.latestPitch(s);
  const h = health.healthScore(pillars, { now, price, bearPrice: pitch?.bearPrice, basePrice: pitch?.basePrice, killTripped: killTripped(s) });
  const orig = originalThesis(s);
  const drift = orig && note?.thesis ? { ...health.drift(orig.text, note.thesis), from: orig.from } : null;
  const marks = store.scenarioMarks(s);
  const lastMark = marks.at(-1) || null;
  const ev = lastMark && pitch ? health.expectedValue(lastMark, pitch, price) : null;
  const cats = store.listCatalysts(s);
  return {
    symbol: s,
    status: health.overallStatus(pillars),
    health: h,
    pillars,
    thesis: note ? { hasText: !!note.thesis?.trim(), targetPrice: note.targetPrice, priceAtThesis: note.priceAtThesis, approvedStatus: note.thesisStatus, updatedAt: note.updatedAt } : null,
    pitch: pitch ? { id: pitch.id, status: pitch.status, bullPrice: pitch.bullPrice, basePrice: pitch.basePrice, bearPrice: pitch.bearPrice, createdAt: pitch.createdAt } : null,
    drift,
    scenario: lastMark ? { ...lastMark, expected: ev } : null,
    catalysts: { stats: health.catalystStats(cats), next: cats.filter((c) => c.state === "pending" || c.state === "late").slice(0, 3) },
    price,
  };
}

// Rule pass: every live pillar with a KPI gets at most one rule check per day. Then a health
// snapshot per tracked symbol. `read` is a metrics reader (tests pass a fake).
async function runRules({ symbols = null, read = metrics.reader(), now = new Date().toISOString(), prices = null, force = false } = {}) {
  store.ready();
  const list = symbols || trackedSymbols();
  const day = now.slice(0, 10);
  let checked = 0, moved = 0;
  const changes = [];
  for (const s of list) {
    for (const p of store.listPillars(s)) {
      if (!p.kpi) continue;
      const already = db.prepare("SELECT id FROM thesis_checks WHERE pillarId = ? AND method = 'rule' AND substr(createdAt, 1, 10) = ? LIMIT 1").get(p.id, day);
      if (already && !force) continue;
      const def = metrics.definition(p.kpi.metric);
      const reading = await read(p.kpi.metric, s);
      const r = evaluateKpi(p.kpi, reading, { now, prev: p.lastValue, unit: def?.unit, label: def?.label });
      const detail = reading?.error ? `${r.detail} (${reading.error})` : r.detail;
      const evidence = [{ text: detail, source_url: reading?.sourceUrl || undefined, as_of: reading?.asOf || undefined }];
      const out = store.recordCheck({ symbol: s, pillarId: p.id, status: r.status, method: "rule", score: health.SCORE[r.status] ?? null, evidence, detail, value: typeof r.value === "number" ? r.value : null });
      checked++;
      if (out.moved) { moved++; changes.push({ symbol: s, pillarId: p.id, from: out.prev, to: r.status, detail }); }
    }
  }
  const px = prices || {};
  for (const s of list) {
    const sum = summarize(s, { price: px[s]?.price ?? px[s] ?? null, now });
    store.writeHealth(s, { score: sum.health.score, status: sum.status, parts: { counts: sum.health.counts, adjustments: sum.health.adjustments, drift: sum.drift?.drifted || false } }, day);
  }
  return { symbols: list.length, checked, moved, changes };
}

// Board: every tracked symbol with its summary and health history.
function board({ prices = {}, days = 180 } = {}) {
  const list = trackedSymbols();
  const series = store.healthSeries(list, { days });
  const owned = new Set(holdings());
  return list.map((s) => ({ ...summarize(s, { price: prices[s]?.price ?? null }), owned: owned.has(s), history: series[s] || [] }));
}

module.exports = { runRules, summarize, board, trackedSymbols, originalThesis, holdings, today };
