const test = require("node:test");
const assert = require("node:assert/strict");
const viz = require("../lib/researchViz");
const { buildMatrix, priceSignals, ranks, topMovers } = require("../lib/signalMatrix");
const { compareSeries, compareMetrics } = require("../lib/compare");
const { recessionRanges, sahm, readRegime } = require("../lib/macroRegime");

test("annotations: 8-K items labelled, 9.01 ignored, earnings split out with beat/miss", () => {
  const filings = [
    { form: "8-K", filingDate: "2026-02-01", items: "2.02,9.01", url: "u1" },
    { form: "8-K", filingDate: "2026-03-01", items: "9.01" },
    { form: "8-K", filingDate: "2026-04-01", items: "4.02" },
    { form: "10-Q", filingDate: "2026-05-01", reportDate: "2026-03-31" },
    { form: "8-K", filingDate: "2019-01-01", items: "5.02" },
  ];
  const a = viz.buildAnnotations({ from: "2021-01-01", filings, history: [{ quarter: "4Q2025", actual: 1.1, estimate: 1, surprisePct: 0.1 }], nextEarnings: ["2099-01-01"] });
  assert.deepEqual(a.layers.filings.map((f) => f.date), ["2026-04-01", "2026-05-01"]);
  assert.equal(a.layers.filings[0].serious, true);
  assert.equal(a.layers.earnings[0].surprisePct, 0.1);
  assert.equal(a.layers.earnings.at(-1).upcoming, true);
});

test("annotations: insider cluster needs three different buyers in 30 days", () => {
  const t = (d, name, code = "P") => ({ transactionDate: d, name, transactionCode: code, change: 100, transactionPrice: 10 });
  const rows = viz.insiderLayer([t("2026-01-01", "A"), t("2026-01-10", "B"), t("2026-01-20", "C"), t("2026-01-20", "D", "S"), t("2025-01-01", "A")], "2020-01-01");
  const byDate = Object.fromEntries(rows.filter((r) => r.side === "buy").map((r) => [r.date, r.cluster]));
  assert.equal(byDate["2026-01-20"], true);
  assert.equal(byDate["2026-01-01"], false);
  assert.equal(rows.find((r) => r.side === "sell").cluster, false);
  assert.equal(rows.find((r) => r.date === "2026-01-01").value, 1000);
});

test("annotations: scenarios come from the newest live pitch with prices", () => {
  const p = viz.pitchLayer([
    { id: 1, createdAt: "2025-01-01", status: "executed", bullPrice: 200, basePrice: 150, bearPrice: 90 },
    { id: 2, createdAt: "2026-01-01", status: "draft", bullPrice: 300 },
  ]);
  assert.equal(viz.scenarioLines(p).pitchId, 1);
});

test("bands: P/E band implied prices bracket the price and use only known EPS", () => {
  const q = (end, val) => ({ end, val, form: "10-Q" });
  const eps = [];
  for (let y = 2020; y <= 2026; y++) for (const m of ["03-31", "06-30", "09-30", "12-31"]) eps.push(q(`${y}-${m}`, 1));
  const bars = [];
  for (let t = Date.parse("2021-06-01"); t < Date.parse("2026-06-01"); t += 7 * 864e5) bars.push({ date: new Date(t).toISOString().slice(0, 10), close: 60 + 40 * Math.sin(t / 1e10) });
  const b = viz.multipleBands({ eps }, bars, { now: Date.parse("2026-06-01") });
  assert.ok(b.pe.summary.p10 < b.pe.summary.p50 && b.pe.summary.p50 < b.pe.summary.p90);
  const last = b.pe.points.at(-1);
  assert.ok(Math.abs(last.implied.p50 - b.pe.summary.p50 * 4) < 0.5); // TTM EPS = 4
  assert.equal(b.evEbitda, null);
});

test("football field: drops missing methods, orders low/high, includes price in extent", () => {
  const f = viz.footballField({ price: 50, range52: { low: 40, high: 60 }, targets: { low: 70, high: 55, mean: 62 }, pitch: { bear: 30, base: 45, bull: 80, id: 3 } });
  assert.deepEqual(f.rows.map((r) => r.key), ["range52", "analysts", "pitch"]);
  assert.equal(f.rows[1].low, 55);
  assert.equal(f.min, 30);
  assert.equal(f.max, 80);
  assert.equal(viz.footballField({}).rows.length, 0);
});

test("football field: DCF and comps ranges", () => {
  const { dcfValue } = require("../lib/dcf");
  const d = viz.dcfRange({ fcf: 100, shares: 10, cash: 0, debt: 0 }, 0.05, dcfValue);
  assert.ok(d.low < d.mid && d.mid < d.high);
  assert.equal(viz.dcfRange({ fcf: -5, shares: 10 }, 0.05, dcfValue), null);
  const c = viz.compsRange([{ symbol: "X", peTTM: 20 }, { symbol: "A", peTTM: 10 }, { symbol: "B", peTTM: 20 }, { symbol: "C", peTTM: 30 }], "X", 100);
  assert.equal(c.mid, 100);
});

test("signal matrix: scores in [-1,1], cross-sectional momentum, thesis pillars beat status", () => {
  const up = Array.from({ length: 250 }, (_, i) => 100 + i);
  const down = Array.from({ length: 250 }, (_, i) => 300 - i);
  const m = buildMatrix([
    { symbol: "UP", closes: up, revision: { score: 60, label: "Rising" }, short: { score: 80 }, thesis: { status: "broken", pillars: [{ status: "intact" }] } },
    { symbol: "DN", closes: down, pe: { percentile: 0.9, current: 30, median: 20 } },
  ]);
  const [a, b] = m.rows;
  assert.equal(a.cells.momentum.score, 1);
  assert.equal(b.cells.momentum.score, -1);
  assert.equal(a.cells.revisions.score, 0.6);
  assert.equal(a.cells.short.score, -0.8);
  assert.equal(a.cells.thesis.score, 1);
  assert.equal(b.cells.valuation.score, -0.8);
  assert.equal(b.cells.insider.score, null);
  for (const r of m.rows) for (const c of Object.values(r.cells)) assert.ok(c.score === null || (c.score >= -1 && c.score <= 1));
  assert.ok(topMovers(m.rows).length <= 2);
  assert.deepEqual(ranks([3, null, 1]), [1, null, 0]);
  assert.equal(priceSignals([1, 2]).momentum, null);
});

test("compare: rebased to 100 from the latest common start", () => {
  const s = compareSeries([
    { symbol: "A", bars: [{ date: "2026-01-01", close: 10 }, { date: "2026-01-02", close: 20 }, { date: "2026-01-03", close: 15 }] },
    { symbol: "B", bars: [{ date: "2026-01-02", close: 50 }, { date: "2026-01-03", close: 100 }] },
    { symbol: "C", bars: [] },
  ]);
  assert.equal(s[0].points[0].value, 100);
  assert.equal(s[0].points[0].date, "2026-01-02");
  assert.equal(s[0].change, -25);
  assert.equal(s[0].maxDrawdown, -25);
  assert.equal(s[1].change, 100);
  assert.deepEqual(s[2].points, []);
  const m = compareMetrics("A", { summaryDetail: { trailingPE: { raw: 25 } }, financialData: { operatingMargins: { raw: 0.3 }, targetMeanPrice: { raw: 12 } } }, { price: 10 }, s[0]);
  assert.equal(m.pe, 25);
  assert.equal(m.operatingMargin, 30);
  assert.equal(m.targetUpside, 20);
});

test("macro regime: recession ranges, Sahm rule, reads", () => {
  const rec = recessionRanges([{ date: "2020-01-01", value: 0 }, { date: "2020-03-01", value: 1 }, { date: "2020-04-01", value: 1 }, { date: "2020-05-01", value: 0 }]);
  assert.deepEqual(rec, [{ start: "2020-03-01", end: "2020-04-01" }]);
  const flat = Array.from({ length: 15 }, (_, i) => ({ date: `x${i}`, value: 4 }));
  assert.equal(sahm(flat), 0);
  const rising = flat.map((o, i) => ({ ...o, value: i >= 12 ? 5 : 4 }));
  assert.ok(sahm(rising) >= 0.5);
  const r = readRegime({ curve10y2y: [{ value: -0.3 }], corePce: Array.from({ length: 8 }, (_, i) => ({ value: 2 + i * 0.1 })), unemployment: rising });
  assert.equal(r.reads.find((x) => x.key === "curve").status, "warn");
  assert.equal(r.reads.find((x) => x.key === "jobs").status, "warn");
  assert.equal(r.regime, "Stagflation risk");
});

test("research viz routes are mounted and degrade offline", { timeout: 60000 }, async () => {
  const { startServer } = require("./helpers");
  const s = await startServer();
  try {
    for (const p of ["/api/research/ZZZZ/annotations", "/api/research/ZZZZ/valuation-viz", "/api/signal-matrix", "/api/compare?symbols=AAA,BBB", "/api/macro/regime"]) {
      const r = await s.api(p);
      assert.equal(r.status, 200, `${p}: ${r.text}`);
    }
    assert.equal((await s.api("/api/compare?symbols=AAA")).status, 400);
    assert.equal((await s.api("/api/research/%3Cx%3E/annotations")).status, 400);
  } finally { await s.stop?.(); }
});
