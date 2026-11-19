// What a pitch needs before it can go to a vote. "required" items block opening the vote;
// "advised" items only show as a nudge. Pure: takes a pitch row, returns the checklist.
const has = (v) => typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined && v !== "";

const ITEMS = [
  { key: "thesis", label: "Investment thesis", required: true, ok: (p) => has(p.thesis) },
  { key: "variantView", label: "What the market expects and why we differ", required: false, ok: (p) => has(p.variantView) },
  { key: "basePrice", label: "Base-case price target", required: true, ok: (p) => has(p.basePrice) },
  { key: "confidence", label: "Confidence % and time horizon (so the call can be graded later)", required: true, ok: (p) => has(p.confidencePct) && has(p.horizonMonths) },
  { key: "preMortem", label: "Pre-mortem", required: true, ok: (p) => has(p.preMortem) },
  { key: "killCriteria", label: "What would make us sell, with a state and a date", required: true, ok: (p) => has(p.killCriteria) },
  { key: "range", label: "Bear and bull targets", required: false, ok: (p) => has(p.bearPrice) && has(p.bullPrice) },
  { key: "catalysts", label: "Catalysts", required: false, ok: (p) => has(p.catalysts) },
];

function readiness(p) {
  const items = ITEMS.map((i) => ({ key: i.key, label: i.label, required: i.required, done: !!i.ok(p) }));
  const missing = items.filter((i) => i.required && !i.done);
  return { items, ready: !missing.length, missing: missing.map((i) => i.label) };
}

module.exports = { readiness };
