// Thesis health, drift, scenarios and catalysts: pure functions, no database, no model.
//
// Health score (report section 7, "Thesis health score"): H = sum(w * s) / sum(w) over pillars
// with a current status, s = 1 intact, 0.75 watch, 0.5 weakened, 0 broken. Pillars that are
// unknown or overdue for a review are left out of H and counted separately, so a thesis nobody
// checks doesn't look healthy. Two adjustments from the plan: a stale thesis (no check for a
// long time) and a price near or under the bear case both pull the score down, and are listed so
// the number can be explained.
const SCORE = { intact: 1, watch: 0.75, weakened: 0.5, broken: 0 };
const STALE_DAYS = 45;         // no check on any pillar for this long: the thesis is stale
const PILLAR_REVIEW_DAYS = 120; // default: a pillar with no check for this long counts as unknown

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

// pillars: [{ id, status, weight, reviewDays, lastCheckAt }]
// opts: { now, price, bearPrice, basePrice, killTripped }
function healthScore(pillars, { now = new Date().toISOString(), price = null, bearPrice = null, basePrice = null, killTripped = 0 } = {}) {
  const live = (pillars || []).filter((p) => !p.retiredAt);
  if (!live.length) return { score: null, label: "No pillars", known: 0, unknown: 0, overdue: 0, adjustments: [], counts: {} };
  let num = 0, den = 0, unknown = 0, overdue = 0;
  const counts = { intact: 0, watch: 0, weakened: 0, broken: 0, unknown: 0 };
  let newest = null;
  for (const p of live) {
    const w = Number(p.weight) > 0 ? Number(p.weight) : 1;
    if (p.lastCheckAt && (!newest || p.lastCheckAt > newest)) newest = p.lastCheckAt;
    const reviewDays = Number(p.reviewDays) > 0 ? Number(p.reviewDays) : PILLAR_REVIEW_DAYS;
    const late = !p.lastCheckAt || daysBetween(p.lastCheckAt, now) > reviewDays;
    if (!(p.status in SCORE)) { unknown++; counts.unknown++; continue; }
    if (late) { overdue++; counts.unknown++; continue; }
    counts[p.status]++;
    num += w * SCORE[p.status]; den += w;
  }
  const adjustments = [];
  let score = den ? (num / den) * 100 : null;
  if (score != null) {
    const age = newest ? daysBetween(newest, now) : Infinity;
    if (age > STALE_DAYS) {
      const pen = Math.min(15, Math.round((age - STALE_DAYS) / 6));
      if (pen > 0) { score -= pen; adjustments.push({ key: "stale", points: -pen, text: `No pillar checked in ${Math.round(age)} days.` }); }
    }
    if (Number(price) > 0 && Number(bearPrice) > 0) {
      if (price <= bearPrice) {
        score -= 20; adjustments.push({ key: "bear", points: -20, text: `Price is at or under the bear case ($${bearPrice}).` });
      } else if (Number(basePrice) > bearPrice && price < basePrice) {
        // Linear: 0 at the base price, -10 just above the bear price.
        const pen = Math.round(10 * (basePrice - price) / (basePrice - bearPrice));
        if (pen > 0) { score -= pen; adjustments.push({ key: "bear", points: -pen, text: `Price is ${Math.round((price / bearPrice - 1) * 100)}% above the bear case.` }); }
      }
    }
    if (killTripped > 0) {
      score -= 15; adjustments.push({ key: "kill", points: -15, text: `${killTripped} exit tripwire${killTripped > 1 ? "s" : ""} tripped and not yet decided.` });
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
  }
  return { score, label: labelFor(score), known: live.length - unknown - overdue, unknown, overdue, adjustments, counts };
}

function labelFor(score) {
  if (score == null) return "Unchecked";
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Holding";
  if (score >= 40) return "Weakening";
  return "At risk";
}

// Overall status word from pillar statuses: the worst heavy pillar sets the tone.
function overallStatus(pillars) {
  const live = (pillars || []).filter((p) => !p.retiredAt && p.status in SCORE);
  if (!live.length) return "unknown";
  if (live.some((p) => p.status === "broken")) return "broken";
  const weak = live.filter((p) => p.status === "weakened").length;
  if (weak >= Math.max(1, Math.ceil(live.length / 2))) return "weakened";
  if (weak || live.some((p) => p.status === "watch")) return "watch";
  return "intact";
}

// ---- Thesis drift: has the written thesis moved away from what was pitched? ----
const STOP = new Set("the a an and or of to in on for with is are be that this it as at by from we our will its their they has have was were which but not if than so can".split(" "));
function words(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9$%. ]+/g, " ").split(/\s+/).map((w) => w.replace(/\.+$/, "")).filter((w) => w.length > 2 && !STOP.has(w));
}
function bag(text) {
  const m = new Map();
  for (const w of words(text)) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
// Cosine similarity of word counts: 1 = same words, 0 = nothing in common.
function similarity(a, b) {
  const x = bag(a), y = bag(b);
  if (!x.size || !y.size) return null;
  let dot = 0, nx = 0, ny = 0;
  for (const [w, c] of x) { nx += c * c; if (y.has(w)) dot += c * y.get(w); }
  for (const c of y.values()) ny += c * c;
  return dot / Math.sqrt(nx * ny);
}

// Drift flag: the current thesis compared with the original (pitch thesis or the first saved
// version). Words that appear now but not at first, and the reverse, are listed so a member can
// see what moved. A low score is a prompt to look, not a verdict: legitimate updates drift too.
function drift(original, current, { threshold = 0.55 } = {}) {
  const sim = similarity(original, current);
  if (sim == null) return { similarity: null, drifted: false, added: [], dropped: [] };
  const a = bag(original), b = bag(current);
  const top = (m, other) => [...m.entries()].filter(([w]) => !other.has(w) && !/^\d/.test(w)).sort((p, q) => q[1] - p[1]).slice(0, 12).map(([w]) => w);
  return { similarity: Math.round(sim * 100) / 100, drifted: sim < threshold, added: top(b, a), dropped: top(a, b) };
}

// ---- Scenario probabilities and the probability-weighted value ----
function normalizeProbs({ bullProb, baseProb, bearProb }) {
  const p = [bullProb, baseProb, bearProb].map((x) => Math.max(0, Number(x) || 0));
  const s = p[0] + p[1] + p[2];
  if (!s) return null;
  return { bullProb: p[0] / s, baseProb: p[1] / s, bearProb: p[2] / s };
}

function expectedValue(probs, { bullPrice, basePrice, bearPrice }, price = null) {
  const p = normalizeProbs(probs || {});
  if (!p || ![bullPrice, basePrice, bearPrice].every((x) => Number(x) > 0)) return null;
  const value = p.bullProb * bullPrice + p.baseProb * basePrice + p.bearProb * bearPrice;
  return { value: Math.round(value * 100) / 100, upsidePct: Number(price) > 0 ? value / price - 1 : null, ...p };
}

// ---- Catalysts: dated events the thesis depends on ----
// status stored: pending | hit | miss | dropped. "late" is derived: pending and past its date.
function catalystState(c, today = new Date().toISOString().slice(0, 10)) {
  if (c.status && c.status !== "pending") return c.status;
  if (c.dueDate && c.dueDate < today) return "late";
  return "pending";
}

// Hit rate (report section 7): catalysts that happened by their date / catalysts whose date has
// passed. Late-but-happened counts separately from on time.
function catalystStats(rows, today = new Date().toISOString().slice(0, 10)) {
  const s = { onTime: 0, lateHit: 0, miss: 0, late: 0, pending: 0, dropped: 0 };
  for (const c of rows || []) {
    const st = catalystState(c, today);
    if (st === "hit") (c.resolvedAt && c.dueDate && c.resolvedAt.slice(0, 10) > c.dueDate ? s.lateHit++ : s.onTime++);
    else if (st in s) s[st]++;
  }
  const due = s.onTime + s.lateHit + s.miss + s.late;
  return { ...s, due, hitRate: due ? s.onTime / due : null };
}

module.exports = { SCORE, STALE_DAYS, PILLAR_REVIEW_DAYS, healthScore, labelFor, overallStatus, similarity, drift, normalizeProbs, expectedValue, catalystState, catalystStats };
