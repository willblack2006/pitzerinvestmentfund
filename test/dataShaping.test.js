const { test } = require("node:test");
const assert = require("node:assert");
const a = require("../lib/analytics");
const bars = (f, n = 80) => Array.from({ length: n }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(3, "0")}`, close: f(i) }));

test("risk profile with a flat benchmark gives null beta, not NaN or Infinity", () => {
  const r = a.riskProfile(bars((i) => 100 + i + Math.sin(i)), bars(() => 50));
  assert.strictEqual(r.beta, null);
  assert.strictEqual(r.correlation, null);
  assert.strictEqual(r.informationRatio === null || Number.isFinite(r.informationRatio), true);
});

test("missing, zero and duplicate-date closes are ignored when aligning", () => {
  const x = bars((i) => 100 + i); x[10].close = null; x[11].close = 0; x.push({ ...x[20] });
  const { dates } = a.align({ x, y: bars((i) => 10 + i) });
  assert.strictEqual(dates.length, 78);
  const r = a.riskProfile(x, bars((i) => 10 + i + Math.cos(i)));
  assert.ok(Number.isFinite(r.maxDrawdown) && Number.isFinite(r.volatility));
});

test("get_risk shaping keeps the verdict and a few points of each series", () => {
  const { riskForAgent } = require("../lib/agents/tools");
  const n = 400, arr = Array.from({ length: n }, (_, i) => i);
  const d = { symbol: "X", profile: { beta: 1.2, series: { dates: arr.map(String), asset: arr, bench: arr, sector: null } }, rolling: { 63: { dates: arr.map(String), beta: arr, correlation: arr, trend: { verdict: "rising" } } } };
  const out = riskForAgent(d);
  assert.strictEqual(out.profile.beta, 1.2);
  assert.strictEqual(out.profile.series.asset.length, 12);
  assert.strictEqual(out.profile.series.asset.at(-1), 399);
  assert.strictEqual(out.rolling[63].trend.verdict, "rising");
  assert.strictEqual(out.rolling[63].latest.beta, 399);
  assert.ok(JSON.stringify(out).length < JSON.stringify(d).length / 5);
});
