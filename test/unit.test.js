// Pure-logic tests: benchmark parsing, fundamentals scores, risk math, front-end escaping.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

// Modules that import db.js need a throwaway database.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-unit-")), "unit.db");

const benchmarks = require("../lib/benchmarks");
const F = require("../lib/fundamentals");
const A = require("../lib/analytics");

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("benchmarks: single tickers and blends parse and normalize", () => {
  assert.deepEqual(benchmarks.parse("spy"), [{ symbol: "SPY", weight: 1 }]);
  assert.equal(benchmarks.normalize(" spy:60, agg:40 "), "SPY:60,AGG:40");
  assert.equal(benchmarks.normalize("SPY:3,AGG:1"), "SPY:75,AGG:25");
  assert.equal(benchmarks.normalize("^GSPC"), "^GSPC");
  const p = benchmarks.parse("SPY:1,AGG:1,EFA:2");
  close(p.reduce((s, c) => s + c.weight, 0), 1);
});

test("benchmarks: invalid input is rejected with a readable error", () => {
  for (const bad of ["", "SPY:abc", "SPY:60,SPY:40", "SPY:0,AGG:100", "SPY$", "A:1,B:1,C:1,D:1,E:1,F:1,G:1", "<script>"]) {
    assert.throws(() => benchmarks.parse(bad), Error, `should reject ${JSON.stringify(bad)}`);
  }
});

test("benchmarks: labels and short names", () => {
  assert.equal(benchmarks.label("SPY"), "S&P 500");
  assert.equal(benchmarks.label("SPY:60,AGG:40"), "60/40 stocks/bonds (classic balanced)");
  assert.equal(benchmarks.label("SPY:70,EFA:30"), "70% S&P 500 + 30% MSCI EAFE (developed ex-US)");
  assert.equal(benchmarks.label("ZZZZ"), "ZZZZ");
  assert.equal(benchmarks.shortName("SPY:60,AGG:40"), "60/40 SPY/AGG");
  // Every preset must itself be valid and unique.
  const values = benchmarks.PRESETS.flatMap((g) => g.items.map(([v]) => v));
  assert.equal(new Set(values).size, values.length, "duplicate preset");
  for (const v of values) assert.equal(benchmarks.normalize(v), v, `preset ${v} not normalized`);
  assert.ok(values.length >= 60);
});

// Synthetic company: two fiscal years, clearly improving.
const fy = (end, val) => ({ end, val, form: "10-K" });
const facts = {
  companyName: "Test Co",
  revenue: [fy("2024-12-31", 1000), fy("2025-12-31", 1200)],
  costOfRevenue: [fy("2024-12-31", 600), fy("2025-12-31", 660)],
  operatingIncome: [fy("2024-12-31", 150), fy("2025-12-31", 240)],
  netIncome: [fy("2024-12-31", 100), fy("2025-12-31", 180)],
  operatingCashFlow: [fy("2024-12-31", 130), fy("2025-12-31", 230)],
  capex: [fy("2024-12-31", 30), fy("2025-12-31", 40)],
  totalAssets: [fy("2024-12-31", 2000), fy("2025-12-31", 2100)],
  totalLiabilities: [fy("2024-12-31", 1000), fy("2025-12-31", 950)],
  currentAssets: [fy("2024-12-31", 500), fy("2025-12-31", 650)],
  currentLiabilities: [fy("2024-12-31", 400), fy("2025-12-31", 380)],
  cash: [fy("2024-12-31", 100), fy("2025-12-31", 200)],
  longTermDebt: [fy("2024-12-31", 500), fy("2025-12-31", 450)],
  equity: [fy("2024-12-31", 1000), fy("2025-12-31", 1150)],
  retainedEarnings: [fy("2024-12-31", 300), fy("2025-12-31", 450)],
  receivables: [fy("2024-12-31", 100), fy("2025-12-31", 110)],
  ppe: [fy("2024-12-31", 800), fy("2025-12-31", 820)],
  sga: [fy("2024-12-31", 200), fy("2025-12-31", 220)],
  depreciation: [fy("2024-12-31", 50), fy("2025-12-31", 55)],
  dilutedShares: [fy("2024-12-31", 100), fy("2025-12-31", 98)],
  sharesOutstanding: [fy("2025-12-31", 97)],
};

test("fundamentals: margins, FCF and returns", () => {
  const a = F.analyze(facts, { marketCap: 5000 });
  const last = a.annual.at(-1);
  close(last.grossMargin, 540 / 1200);
  close(last.operatingMargin, 0.2);
  close(last.netMargin, 0.15);
  assert.equal(last.fcf, 190);
  close(last.roe, 180 / 1150);
  assert.equal(last.netDebt, 250);
  assert.ok(last.roic > 0 && last.roic < 1);
});

test("fundamentals: Piotroski counts each test correctly", () => {
  const p = F.analyze(facts).piotroski;
  assert.equal(p.outOf, 9);
  assert.equal(p.score, 9, JSON.stringify(p.tests.filter((t) => !t.pass)));
  assert.equal(p.verdict, "Strong");
});

test("fundamentals: Altman Z matches the published formula", () => {
  const z = F.analyze(facts, { marketCap: 5000 }).altman;
  const expected = 1.2 * (270 / 2100) + 1.4 * (450 / 2100) + 3.3 * (240 / 2100) + 0.6 * (5000 / 950) + 1.0 * (1200 / 2100);
  close(z.z, expected);
  assert.equal(z.zone, "Safe");
  assert.equal(F.analyze(facts).altman.zone, "Incomplete data", "no market cap -> incomplete");
});

test("fundamentals: Beneish M-score is finite and reports missing inputs", () => {
  const b = F.analyze(facts).beneish;
  assert.ok(Number.isFinite(b.m));
  assert.deepEqual(b.missing, []);
  const sparse = F.analyze({ ...facts, receivables: [], sga: [], depreciation: [] }).beneish;
  assert.ok(sparse.missing.includes("DSRI") && sparse.missing.includes("SGAI"));
});

test("fundamentals: no data and single-year data degrade gracefully", () => {
  assert.equal(F.analyze(null), null);
  const one = F.analyze({ ...facts, revenue: [fy("2025-12-31", 1)], netIncome: [fy("2025-12-31", 1)] });
  assert.equal(one.piotroski, null);
});

// Deterministic price paths.
const days = (n, f) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10), close: f(i) }));

test("analytics: beta of a 2x-levered series is 2, correlation 1", () => {
  const bench = days(120, (i) => 100 * (1 + 0.01 * Math.sin(i / 3)) * (1 + i * 0.001));
  const r = A.returns(bench.map((p) => p.close));
  const lev = [{ date: bench[0].date, close: 100 }];
  r.forEach((x, i) => lev.push({ date: bench[i + 1].date, close: lev[i].close * (1 + 2 * x) }));
  const p = A.riskProfile(lev, bench);
  close(p.beta, 2, 1e-6);
  close(p.correlation, 1, 1e-6);
  assert.equal(p.series.asset[0], 100);
});

test("analytics: max drawdown and too-short series", () => {
  const dd = A.maxDrawdown([100, 120, 60, 90, 130]);
  close(dd.drawdown, -0.5);
  assert.equal(A.riskProfile(days(10, (i) => i + 1), days(10, (i) => i + 1)), null);
  assert.equal(A.sma([1, 2, 3], 5), null);
  close(A.sma([1, 2, 3, 4], 2), 3.5);
});

test("analytics: correlation matrix is symmetric with unit diagonal", () => {
  const a = days(60, (i) => 100 + Math.sin(i)), b = days(60, (i) => 100 + Math.cos(i)), c = days(60, (i) => 100 + i);
  const m = A.correlationMatrix({ A: a, B: b, C: c });
  for (let i = 0; i < 3; i++) {
    close(m.matrix[i][i], 1);
    for (let j = 0; j < 3; j++) close(m.matrix[i][j], m.matrix[j][i], 1e-12);
  }
});

test("front end: escaping and markdown rendering are injection-safe", async () => {
  const shared = await import("../public/shared.js");
  assert.equal(shared.esc(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
  assert.equal(shared.safeUrl("javascript:alert(1)"), "#");
  assert.equal(shared.safeUrl("https://sec.gov/a?b=1&c=2"), "https://sec.gov/a?b=1&amp;c=2");
  const html = shared.renderMarkdown("## Head\n**bold** <script>x</script>\n- item [link](javascript:1)");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<h4>Head</h4>") && html.includes("<strong>bold</strong>") && html.includes("<li>"));
  assert.ok(!/href=/.test(html));
  assert.ok(shared.signed(null).includes("—"));
  assert.ok(shared.signed(-1, "-1").includes("▼"));
});

test("time-weighted return ignores deposits, even on days with no valuation", () => {
  const { twr } = require("../lib/portfolio");
  const history = [
    { date: "2026-01-01", totalValue: 1000, netFlow: 0 },
    { date: "2026-01-02", totalValue: 0, netFlow: 1000 }, // deposit recorded, no snapshot that day
    { date: "2026-01-03", totalValue: 2200, netFlow: 0 },  // +1000 deposit, +200 genuine gain
  ];
  const bench = [{ date: "2026-01-01", close: 50 }, { date: "2026-01-03", close: 55 }];
  const r = twr(history, bench);
  close(r.totalReturn, 0.2, 1e-9);
  close(r.benchReturn, 0.1, 1e-9);
  assert.equal(twr([{ date: "2026-01-01", totalValue: 5, netFlow: 0 }]), null);
});
