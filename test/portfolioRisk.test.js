const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../lib/portfolioRisk");

// Deterministic pseudo-random walk.
function walk(seed, n, vol, drift = 0, common = null, mix = 0, start = "2025-01-01") {
  let x = seed, v = 100;
  const out = [{ date: new Date(Date.parse(start)).toISOString().slice(0, 10), close: v }];
  for (let i = 1; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    const own = (x / 4294967296 - 0.5) * 2 * vol;
    v *= 1 + drift + (common ? mix * common[i - 1] + (1 - mix) * own : own);
    out.push({ date: new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10), close: v });
  }
  return out;
}
const rets = (s) => s.slice(1).map((p, i) => p.close / s[i].close - 1);

test("risk shares sum to 1 and a duplicate-driven pair carries more risk than its weight", () => {
  const spy = walk(1, 260, 0.01);
  const m = rets(spy);
  const hist = { A: walk(2, 260, 0.02, 0, m, 0.9), B: walk(3, 260, 0.02, 0, m, 0.9), C: walk(4, 260, 0.004) };
  const out = r.portfolioRisk({ histories: hist, spy, values: { A: 3000, B: 3000, C: 4000 }, cash: 0 });
  const sum = out.rows.reduce((s, x) => s + x.riskShare, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const c = out.rows.find((x) => x.symbol === "C");
  assert.ok(c.riskShare < c.weight, "low-vol C dampens risk");
  assert.ok(out.effectiveBets < 3);
  assert.ok(out.loss.expectedShortfall >= out.loss.oneDayVar);
  assert.ok(out.loss.worstDay >= out.loss.expectedShortfall);
});

test("cash dilutes loss measures and beta", () => {
  const spy = walk(1, 260, 0.01);
  const hist = { A: spy };
  const a = r.portfolioRisk({ histories: hist, spy, values: { A: 1000 }, cash: 0 });
  const b = r.portfolioRisk({ histories: hist, spy, values: { A: 1000 }, cash: 1000 });
  assert.ok(Math.abs(a.beta - 1) < 1e-6);
  assert.ok(Math.abs(b.beta - 0.5) < 1e-6);
  assert.ok(Math.abs(b.loss.oneDayVar - a.loss.oneDayVar / 2) < 1e-9);
});

test("a short-history holding is dropped and reported, not silently shrinking the window", () => {
  const spy = walk(1, 260, 0.01);
  const hist = { A: walk(2, 260, 0.02), NEW: walk(5, 30, 0.03, 0, null, 0, "2025-09-10") };
  const out = r.portfolioRisk({ histories: hist, spy, values: { A: 1000, NEW: 500 }, cash: 0 });
  assert.deepEqual(out.dropped, ["NEW"]);
  assert.equal(out.days, 259);
});

test("drawdown and worst windows", () => {
  const dates = ["d1", "d2", "d3", "d4"];
  const dd = r.drawdownStats(dates, [0.1, -0.2, 0.05, 0]);
  assert.ok(Math.abs(dd.max - (0.88 / 1.1 - 1)) < 1e-9);
  assert.equal(dd.maxPeak, "d1");
  assert.equal(dd.maxTrough, "d2");
  const w = r.worstWindow(dates, [0.1, -0.2, 0.05, 0], 2);
  assert.ok(Math.abs(w.ret - (0.8 * 1.05 - 1)) < 1e-9);
  assert.equal(w.start, "d2");
});

test("scenarios scale by beta; episodes only when history covers them", () => {
  const s = r.scenario([{ symbol: "A", value: 1000, beta: 2 }, { symbol: "B", value: 1000, beta: null }], -0.1, 4000);
  assert.ok(Math.abs(s.change - -300) < 1e-9);
  assert.ok(Math.abs(s.changePct - -0.075) < 1e-9);
  assert.equal(s.worst[0].symbol, "A");
  assert.deepEqual(r.episodeMoves(walk(1, 260, 0.01)), []);
  const long = [{ date: "2020-02-18", close: 100 }, { date: "2020-02-19", close: 100 }, { date: "2020-03-23", close: 66 }];
  const e = r.episodeMoves(long);
  assert.equal(e.length, 1);
  assert.ok(Math.abs(e[0].spyMove - -0.34) < 1e-9);
});

test("not enough history returns null", () => {
  assert.equal(r.portfolioRisk({ histories: { A: walk(2, 20, 0.02) }, spy: [], values: { A: 1 } }), null);
});

test("liquidity: days to sell uses median dollar volume and flags thin names", () => {
  const mk = (vol) => Array.from({ length: 40 }, (_, i) => ({ date: `2025-01-${String(i + 1).padStart(2, "0")}`, close: 10, volume: vol }));
  const q = r.liquidity({ BIG: mk(1_000_000), THIN: mk(1_000), NONE: [] }, { BIG: 10_000, THIN: 10_000, NONE: 5_000 });
  const thin = q.rows.find((x) => x.symbol === "THIN");
  assert.ok(Math.abs(thin.days - 10_000 / (0.2 * 10_000)) < 1e-9);
  assert.equal(q.rows.find((x) => x.symbol === "NONE").days, null);
  assert.equal(q.withinDay, 0.5);
  assert.equal(q.slowest[0].symbol, "THIN");
  assert.deepEqual(q.unknown, ["NONE"]);
});

test("growth shocks and policy note appear when inputs allow", () => {
  const spy = walk(1, 260, 0.01), m = rets(spy);
  const growth = walk(7, 260, 0.014, 0, m, 0.5);
  const hist = { A: walk(2, 260, 0.03, 0, m, 0.8), B: walk(3, 260, 0.004) };
  const out = r.portfolioRisk({ histories: hist, spy, growth, values: { A: 5000, B: 5000 }, cash: 0, limits: { maxPositionPct: 10 } });
  assert.equal(out.growthShocks.length, 2);
  assert.ok(out.growthShocks[1].change < out.growthShocks[0].change);
  assert.ok(out.policy.length >= 1 && /single-position limit/.test(out.notes[0]));
  const none = r.portfolioRisk({ histories: hist, spy, values: { A: 5000, B: 5000 }, cash: 0 });
  assert.deepEqual(none.growthShocks, []);
  assert.deepEqual(none.policy, []);
});
