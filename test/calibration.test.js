const { test } = require("node:test");
const assert = require("node:assert/strict");
const { wilson, murphy, payoff, committeeScorecard, learningCurve, calibrationBuckets, brierScore } = require("../lib/calibration");

test("wilson interval is wide for tiny samples and contains the observed rate", () => {
  const small = wilson(3, 4);
  assert.ok(small.lo < 0.45 && small.hi > 0.9);
  const big = wilson(75, 100);
  assert.ok(big.hi - big.lo < small.hi - small.lo);
  assert.equal(wilson(0, 0), null);
  assert.ok(wilson(0, 5).lo === 0 && wilson(5, 5).hi === 1);
});

test("murphy: always-60% has no resolution; a sharp forecaster does", () => {
  const flat = [1, 1, 1, 0, 0, 0].map((o) => ({ p: 0.6, outcome: o }));
  const m = murphy(flat);
  assert.equal(m.resolution, 0);
  assert.ok(Math.abs(m.uncertainty - 0.25) < 1e-9);
  assert.ok(Math.abs(m.reliability - 0.01) < 1e-9);
  const sharp = [...Array(5).fill({ p: 0.9, outcome: 1 }), ...Array(5).fill({ p: 0.1, outcome: 0 })];
  const s = murphy(sharp);
  assert.ok(s.resolution > 0.24 && s.reliability < 0.02);
  assert.equal(murphy([]), null);
});

test("payoff and committee scorecard use direction-adjusted excess return", () => {
  const rows = [
    { direction: "buy", excessReturn: 0.2, status: "approved", outcome: true },
    { direction: "buy", excessReturn: -0.1, status: "approved", outcome: false },
    { direction: "sell", excessReturn: -0.1, status: "rejected", outcome: true }, // stock fell: the sell was right
  ];
  const p = payoff(rows);
  assert.equal(p.n, 3);
  assert.ok(Math.abs(p.avgWin - 0.15) < 1e-9);
  assert.ok(Math.abs(p.ratio - 1.5) < 1e-9);
  const c = committeeScorecard(rows);
  assert.equal(c.approved.n, 2);
  assert.equal(c.rejected.n, 1);
  assert.ok(Math.abs(c.rejected.avgEdge - 0.1) < 1e-9, "rejecting a good sell is a miss for the committee");
  assert.equal(payoff([{ direction: "buy", excessReturn: null }]), null);
});

test("learning curve needs enough calls, then compares halves", () => {
  const bad = Array(5).fill({ p: 0.9, outcome: 0 }), good = Array(5).fill({ p: 0.9, outcome: 1 });
  assert.equal(learningCurve([...bad, ...good.slice(0, 2)]), null);
  const l = learningCurve([...bad, ...good]);
  assert.ok(l.later < l.earlier);
  assert.equal(calibrationBuckets([{ p: 0.7, outcome: 1 }])[0].ci.hi, 1);
  assert.ok(brierScore([{ p: 1, outcome: 1 }]) === 0);
});
