const test = require("node:test");
const assert = require("node:assert/strict");

test("revision path: rebases each period to its 90-day-ago estimate and skips unusable ones", async () => {
  const { revisionPath } = await import("../public/revisionPath.js");
  const r = revisionPath([
    { period: "0q", epsTrend: { d90: 1, d60: 1.05, d30: 1.1, d7: 1.15, current: 1.2 } },
    { period: "0y", epsTrend: { d90: -0.5, d60: -0.4, d30: -0.3, d7: -0.2, current: -0.1 } },
    { period: "+1q", epsTrend: { d90: 2, d60: null, d30: 2, d7: 2, current: 2 } },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].label, "This quarter");
  assert.deepEqual(r[0].values.map((v) => Math.round(v)), [0, 5, 10, 15, 20]);
  assert.equal(revisionPath([]), null);
});
