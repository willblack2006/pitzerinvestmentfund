const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readiness } = require("../lib/pitchReadiness");

test("readiness lists what blocks a vote and treats the rest as suggestions", () => {
  const r = readiness({ thesis: "t", basePrice: 10, preMortem: " ", killCriteria: "", confidencePct: 60, horizonMonths: null });
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing.length, 3);
  const full = readiness({ thesis: "t", basePrice: 10, preMortem: "p", killCriteria: "k", confidencePct: 0, horizonMonths: 12 });
  assert.equal(full.ready, true, "0% confidence is still an answer");
  assert.equal(full.items.filter((i) => !i.done && !i.required).length, 3);
});
