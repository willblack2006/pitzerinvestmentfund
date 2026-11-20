// Fund cockpit math (lib/attribution.js) and the prefs it saves. Offline, synthetic series.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../lib/attribution");

// Weekday series from start with daily multiplier fn(i).
function series(start, n, fn, base = 100) {
  const out = [];
  let d = new Date(`${start}T12:00:00Z`), v = base, i = 0;
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd && wd < 6) { out.push({ date: d.toISOString().slice(0, 10), close: v }); v *= fn(i++); }
    d = new Date(d.getTime() + 864e5);
  }
  return out;
}

test("contributions add up to the fund return, cash earns zero", () => {
  const hist = { AAA: series("2026-01-05", 60, () => 1.01), BBB: series("2026-01-05", 60, () => 0.995) };
  const c = A.contribution({ positions: [{ symbol: "AAA", shares: 10 }, { symbol: "BBB", shares: 20 }], histories: hist, cash: 1000, from: "1m" });
  const sum = c.rows.reduce((s, r) => s + r.contribution, 0);
  assert.ok(Math.abs(sum - c.fundReturn) < 1e-12);
  assert.equal(c.rows[0].symbol, "AAA");
  assert.ok(c.cashWeight > 0 && c.cashWeight < 1);
});

test("period bases: mtd uses the last close before the month, 1d the previous close", () => {
  const s = series("2026-01-05", 40, () => 1.001);
  const latest = s.at(-1).date;
  const mtd = A.baseFor(s, "mtd", latest);
  assert.ok(mtd.date < `${latest.slice(0, 7)}-01`);
  assert.equal(A.baseFor(s, "1d").date, s.at(-2).date);
  const r = A.periodReturns(s);
  assert.ok(Math.abs(r["1d"] - 0.001) < 1e-9);
});

test("drawdown, rolling stats and histogram", () => {
  const up = series("2025-01-06", 300, (i) => (i > 100 && i < 130 ? 0.99 : 1.002));
  const dd = A.drawdownSeries(up);
  assert.ok(dd.maxDrawdown < -0.2 && dd.maxDrawdown > -0.3);
  assert.ok(dd.recoveredDate === null || dd.recoveredDate > dd.troughDate);
  const bench = series("2025-01-06", 300, (i) => (i % 2 ? 1.01 : 0.995));
  const roll = A.rollingWindows(up, bench, [63]);
  assert.equal(roll[63].dates.length, 300 - 63);
  const h = A.returnHistogram(A.dailyReturns(up).map((r) => r.ret), []);
  assert.equal(h.bins.reduce((s, b) => s + b.fund, 0), 299);
});

test("brinson effects sum to fund minus benchmark when weights cover everything", () => {
  const fund = { Tech: { weight: 0.6, return: 0.1 }, Health: { weight: 0.4, return: 0.02 } };
  const bench = { Tech: { weight: 0.5, return: 0.08 }, Health: { weight: 0.5, return: 0.03 } };
  const B = 0.5 * 0.08 + 0.5 * 0.03;
  const r = A.brinson(fund, bench, B);
  assert.ok(Math.abs(r.total - (0.6 * 0.1 + 0.4 * 0.02 - B)) < 1e-12);
});

test("sector active share, cap buckets, explain", () => {
  assert.equal(A.sectorActiveShare({ A: 50, B: 50 }, { A: 50, B: 50 }), 0);
  assert.equal(A.sectorActiveShare({ A: 100 }, { B: 100 }), 1);
  const caps = A.capBuckets({ X: 3e11, Y: 5e9 }, { X: 0.3, Y: 0.2, Z: 0.1 });
  assert.equal(caps.find((b) => b.key === "mega").weight, 0.3);
  assert.equal(caps.find((b) => b.key === "unknown").weight, 0.1);
  const ex = A.explainMove({ fundReturn: 0.01, cashWeight: 0, rows: [{ symbol: "AAA", contribution: 0.008 }, { symbol: "BBB", contribution: 0.003 }, { symbol: "CCC", contribution: -0.001 }] }, { benchReturn: 0.005, benchName: "QQQ" });
  assert.match(ex.text, /beat it/);
  assert.deepEqual(ex.top, ["AAA", "BBB"]);
});

test("dashboardLayout pref is cleaned", () => {
  const { SCHEMA } = require("../lib/prefs");
  const v = SCHEMA.dashboardLayout({ period: "zzz", widgets: [{ key: "treemap", size: "l", opts: { colorBy: "return", "bad key": 1 } }, { key: "treemap" }, { key: "<x>" }] });
  assert.equal(v.period, "1d");
  assert.deepEqual(v.widgets, [{ key: "treemap", size: "l", opts: { colorBy: "return" } }]);
  assert.throws(() => SCHEMA.dashboardLayout([]));
});

test("cockpit endpoints answer offline", async () => {
  const { startServer } = require("./helpers");
  const s = await startServer();
  try {
    const r = await s.api("/api/cockpit");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.holdings) && r.body.kpis);
    assert.equal((await s.api("/api/cockpit/contribution")).status, 400);
    assert.equal((await s.api("/api/cockpit/position/NOPE")).status, 404);
  } finally { s.stop?.(); }
});
