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

test("insider signal: routine traders are ignored, opportunistic cluster buys score high", () => {
  const { classifyInsider, scoreInsiders } = require("../lib/insiderSignals");
  const t = (name, date, code, change, price = 20, share = 10000) => ({ name, transactionDate: date, transactionCode: code, change, transactionPrice: price, share, isDerivative: false });
  // Routine: sells every March for 3+ years.
  const routineHist = ["2022-03-10", "2023-03-09", "2024-03-12"].map((d) => t("Rita Routine", d, "S", -1000));
  assert.equal(classifyInsider(routineHist, "2025-03-11"), "routine");
  assert.equal(classifyInsider(routineHist, "2025-07-11"), "opportunistic");
  assert.equal(classifyInsider([t("New Nick", "2024-05-01", "P", 100)], "2025-05-01"), "new");

  const now = new Date("2025-06-30");
  const oppHist = (name) => ["2021-01-05", "2022-08-05", "2023-11-05"].map((d) => t(name, d, "S", -50));
  const rows = [
    ...routineHist, t("Rita Routine", "2025-06-10", "S", -5000), // routine month? no — June isn't her month, so it counts
    ...oppHist("Ann"), t("Ann", "2025-06-20", "P", 5000, 20, 15000),
    ...oppHist("Bob"), t("Bob", "2025-06-22", "P", 3000, 20, 9000),
    ...oppHist("Cy"), t("Cy", "2025-06-25", "P", 2000, 20, 4000),
  ];
  const r = scoreInsiders(rows, { now });
  assert.equal(r.cluster, 3);
  assert.ok(r.score >= 60, `expected strong buy, got ${r.score}`);
  assert.equal(r.label, "Strong buy signal");

  // The same buying spread out by a lone insider scores lower than the cluster.
  const solo = scoreInsiders([...oppHist("Ann"), t("Ann", "2025-06-20", "P", 5000, 20, 15000)], { now });
  assert.ok(solo.score < r.score && solo.cluster === 1);

  // Routine selling alone leaves the score neutral; non-routine selling pushes it negative.
  const routineOnly = scoreInsiders([...routineHist, t("Rita Routine", "2025-03-11", "S", -1000)], { now: new Date("2025-04-01") });
  assert.equal(routineOnly.score, 0);
  assert.equal(routineOnly.counts.routine, 1);
  const sellers = scoreInsiders(["Ann", "Bob", "Cy", "Dee"].flatMap((n) => [...oppHist(n), t(n, "2025-06-15", "S", -20000, 50)]), { now });
  assert.ok(sellers.score < 0, `expected negative, got ${sellers.score}`);

  // Derivative rows, grants and old trades don't count.
  const noise = scoreInsiders([{ ...t("Z", "2025-06-20", "P", 999), isDerivative: true }, t("Z", "2025-06-20", "A", 999), t("Z", "2024-01-01", "P", 999)], { now });
  assert.equal(noise.score, 0);
});

test("short-pressure score: crowded shorts (high days-to-cover, rising short interest) score high", () => {
  const { scoreShortPressure, finraTrendSlope } = require("../lib/shortPressure");

  const crowded = scoreShortPressure({ daysToCover: 9, shortPctFloat: 0.28, shortChangePct: 0.2 });
  assert.ok(crowded.score >= 70, `expected heavily crowded, got ${crowded.score}`);
  assert.equal(crowded.label, "Heavily crowded short");
  assert.ok(crowded.reasons.some((r) => /days to cover/.test(r)));
  assert.ok(crowded.reasons.some((r) => /rose/.test(r)));

  const clean = scoreShortPressure({ daysToCover: 0.5, shortPctFloat: 0.01, shortChangePct: -0.1 });
  assert.equal(clean.label, "Low short interest");
  assert.ok(clean.score < crowded.score);

  // Falling short interest should score lower than the same stats with rising short interest.
  const covering = scoreShortPressure({ daysToCover: 5, shortPctFloat: 0.15, shortChangePct: -0.3 });
  const building = scoreShortPressure({ daysToCover: 5, shortPctFloat: 0.15, shortChangePct: 0.3 });
  assert.ok(covering.score < building.score);

  // Missing inputs (no Yahoo short-interest data) degrade gracefully instead of throwing.
  const empty = scoreShortPressure({});
  assert.equal(empty.score, 0);
  assert.equal(empty.label, "Low short interest");

  // A clearly rising FINRA short-volume-ratio trend nudges the score up a little.
  const day = (ratio, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, ratio });
  const risingSeries = Array.from({ length: 20 }, (_, i) => day(0.1 + i * 0.02, i));
  assert.ok(finraTrendSlope(risingSeries) > 0);
  const withTrend = scoreShortPressure({ daysToCover: 2, shortPctFloat: 0.05, finraSeries: risingSeries });
  const withoutTrend = scoreShortPressure({ daysToCover: 2, shortPctFloat: 0.05 });
  assert.ok(withTrend.score > withoutTrend.score);
  assert.equal(finraTrendSlope([day(0.1, 0), day(0.1, 1)]), null); // too few points
});

test("red-flag scanner: 8-K items, late filings, and full-text hits", () => {
  const { scanRedFlags, flagScore } = require("../lib/redFlags");
  const filings = [
    { form: "8-K", filingDate: "2026-01-10", items: "4.01", url: "https://sec.gov/a" },
    { form: "8-K", filingDate: "2026-02-01", items: "5.02,9.01", url: "https://sec.gov/b" },
    { form: "8-K", filingDate: "2026-03-01", items: "2.02", url: "https://sec.gov/c" }, // earnings only, no flag
    { form: "NT 10-Q", filingDate: "2026-04-01", url: "https://sec.gov/d" },
    { form: "10-Q", filingDate: "2026-04-15", items: "", url: "https://sec.gov/e" },
  ];
  const flags = scanRedFlags(filings, {
    goingConcern: [{ filedAt: "2026-04-15", form: "10-Q", url: "https://sec.gov/e" }],
    materialWeakness: [],
  });
  assert.equal(flags.length, 4); // auditor change, departure, late filing, going concern
  assert.equal(flags[0].date, "2026-04-15"); // sorted newest first
  assert.ok(flags.some((f) => f.type === "auditor_change"));
  assert.ok(flags.some((f) => f.type === "departure"));
  assert.ok(flags.some((f) => f.type === "late_filing"));
  assert.ok(flags.some((f) => f.type === "going_concern"));
  assert.ok(!flags.some((f) => f.type === "restatement"));
  assert.ok(flagScore(flags) > flagScore(flags.filter((f) => f.type === "departure")));

  assert.deepEqual(scanRedFlags([], {}), []);
});

test("estimate revision score: breadth and drift combine, nearer periods weigh more", () => {
  const { scoreEstimateRevisions, driftPct, breadthScore } = require("../lib/estimateRevision");

  close(driftPct({ current: 1.1, d30: 1.0 }), 0.1, 1e-9);
  assert.equal(driftPct({ current: 1.0, d30: 0, d90: 0.5 }), 1.0);
  assert.equal(driftPct(null), null);
  assert.equal(breadthScore({ up30: 8, down30: 2 }), 0.6);
  assert.equal(breadthScore(null), null);

  const rising = scoreEstimateRevisions([
    { period: "0q", epsTrend: { current: 1.3, d30: 1.0, d90: 0.95 }, revisions: { up30: 10, down30: 0 } },
    { period: "0y", epsTrend: { current: 5.5, d30: 4.0, d90: 3.9 }, revisions: { up30: 9, down30: 1 } },
    { period: "+1y", epsTrend: { current: 6.6, d30: 5.0 }, revisions: { up30: 10, down30: 0 } },
  ]);
  assert.ok(rising.score >= 40, `expected rising estimates, got ${rising.score}`);
  assert.equal(rising.label, "Estimates rising");
  assert.ok(rising.reasons.some((r) => /0q/i.test(r) === false)); // uses plain-language labels, not raw period codes
  assert.ok(rising.reasons.some((r) => /This quarter/.test(r)));

  const falling = scoreEstimateRevisions([{ period: "0q", epsTrend: { current: 0.8, d30: 1.0 }, revisions: { up30: 1, down30: 9 } }]);
  assert.ok(falling.score < 0);
  assert.equal(falling.label, "Estimates falling");

  const flat = scoreEstimateRevisions([{ period: "+1q", epsTrend: { current: 1.0, d30: 1.0 }, revisions: { up30: 5, down30: 5 } }]);
  assert.equal(flat.score, 0);
  assert.equal(flat.label, "Estimates stable");

  assert.deepEqual(scoreEstimateRevisions([]), { score: 0, label: "Estimates stable", reasons: ["No meaningful estimate revisions recently."], byPeriod: [] });
  assert.deepEqual(scoreEstimateRevisions([{ period: "0q" }]).byPeriod, []); // no epsTrend/revisions data at all
});

test("factor scorecard: percentile ranks and tilt", () => {
  const { percentileRank, scoreFactors, aggregateTilt } = require("../lib/factors");

  assert.deepEqual(percentileRank([1, 2, 3]), [0, 50, 100]);
  assert.deepEqual(percentileRank([1, 1, 3]), [25, 25, 100]); // tied ranks share the average
  assert.deepEqual(percentileRank([5]), [50]); // a universe of one is neutral
  assert.deepEqual(percentileRank([null, 1, 2]), [null, 0, 100]);

  const rows = [
    { symbol: "CHEAP", earningsYield: 0.1, fcfYield: 0.08, bookYield: 0.5, momentum: -0.1, roe: 0.05, grossProfitability: 0.1, piotroskiRatio: 0.3, accruals: 0.02, volatility: 0.4, beta: 1.5, marketCap: 1e9 },
    { symbol: "MID", earningsYield: 0.05, fcfYield: 0.04, bookYield: 0.2, momentum: 0.1, roe: 0.15, grossProfitability: 0.2, piotroskiRatio: 0.6, accruals: 0, volatility: 0.25, beta: 1.0, marketCap: 10e9 },
    { symbol: "QUALITY", earningsYield: 0.02, fcfYield: 0.01, bookYield: 0.1, momentum: 0.3, roe: 0.3, grossProfitability: 0.4, piotroskiRatio: 0.9, accruals: -0.03, volatility: 0.15, beta: 0.7, marketCap: 100e9 },
  ];
  const scored = scoreFactors(rows);
  assert.equal(scored.find((r) => r.symbol === "CHEAP").value, 100); // highest yields = cheapest
  assert.equal(scored.find((r) => r.symbol === "QUALITY").value, 0);
  assert.equal(scored.find((r) => r.symbol === "QUALITY").quality, 100); // best ROE/profitability/Piotroski/low accruals
  assert.equal(scored.find((r) => r.symbol === "QUALITY").lowVol, 100); // lowest vol & beta
  assert.equal(scored.find((r) => r.symbol === "CHEAP").lowVol, 0);
  assert.equal(scored.find((r) => r.symbol === "QUALITY").momentum, 100);
  assert.equal(scored.find((r) => r.symbol === "QUALITY").size, 100);

  // Missing fields degrade to null rather than throwing.
  const partial = scoreFactors([{ symbol: "X" }, { symbol: "Y", momentum: 0.1 }]);
  assert.equal(partial[0].momentum, null);
  assert.equal(partial[1].momentum, 50); // the only finite value in its column ranks neutral

  const tilt = aggregateTilt(scored, { CHEAP: 1, MID: 1, QUALITY: 1 });
  assert.ok(Number.isFinite(tilt.value) && tilt.value > 0 && tilt.value < 100);
  const weighted = aggregateTilt(scored, { CHEAP: 0, MID: 0, QUALITY: 1 });
  assert.equal(weighted.quality, 100); // all weight on QUALITY
});

test("calibration: target hits, Brier score, buckets and group stats", () => {
  const { didHitTarget, brierScore, hitRate, calibrationBuckets, groupStats } = require("../lib/calibration");

  const series = [{ date: "2026-01-01", close: 10 }, { date: "2026-02-01", close: 11 }, { date: "2026-03-01", close: 13 }, { date: "2026-04-01", close: 9 }];
  assert.equal(didHitTarget({ direction: "buy", basePrice: 12, series, horizonDate: "2026-04-01" }), true); // hit 13 in March
  assert.equal(didHitTarget({ direction: "buy", basePrice: 20, series, horizonDate: "2026-04-01" }), false);
  assert.equal(didHitTarget({ direction: "sell", basePrice: 9.5, series, horizonDate: "2026-04-01" }), true); // price fell to 9
  assert.equal(didHitTarget({ direction: "buy", basePrice: 12, series, horizonDate: "2026-12-01" }), null); // horizon not reached yet
  assert.equal(didHitTarget({ direction: "buy", basePrice: null, series }), null);
  assert.equal(didHitTarget({ direction: "buy", basePrice: 12, series: [] }), null);

  const items = [{ p: 0.9, outcome: 1 }, { p: 0.9, outcome: 1 }, { p: 0.5, outcome: 0 }, { p: 0.5, outcome: 1 }];
  close(brierScore(items), ((0.1 ** 2) * 2 + 0.25 + 0.25) / 4, 1e-9);
  assert.equal(hitRate(items), 0.75);
  assert.equal(brierScore([]), null);

  const buckets = calibrationBuckets(items, 0.5);
  assert.equal(buckets.length, 1); // the [0, 0.5) bucket is empty, so only [0.5, 1.0] is reported
  const highBucket = buckets.find((b) => b.lo === 0.5);
  assert.equal(highBucket.n, 4);
  close(highBucket.actualHitRate, 0.75, 1e-9);

  const grouped = groupStats([{ p: 0.9, outcome: 1, analyst: "Ann" }, { p: 0.5, outcome: 0, analyst: "Ann" }, { p: 0.6, outcome: 1, analyst: "Bob" }], (x) => x.analyst);
  assert.equal(grouped.Ann.n, 2);
  assert.equal(grouped.Bob.hitRate, 1);
});

test("filing-diff: cosine similarity and paragraph-level diff", () => {
  const { tokenize, cosineSimilarity, diffParagraphs, compareFilingSections } = require("../lib/filingDiff");

  close(cosineSimilarity(tokenize("the cat sat on the mat"), tokenize("the cat sat on the mat")), 1, 1e-9);
  assert.equal(cosineSimilarity(tokenize("alpha beta"), tokenize("gamma delta")), 0);
  assert.equal(cosineSimilarity(tokenize(""), tokenize("x")), null);

  const para = (n) => `This is risk factor paragraph number ${n} describing something material at reasonable length for the test.`;
  const oldText = [para(1), para(2), para(3)].join("\n\n");
  const newText = [para(1), para(2).toUpperCase(), para(4)].join("\n\n"); // 2 reworded (case only, still matches normalized), 3 removed, 4 added
  const { added, removed } = diffParagraphs(oldText, newText);
  assert.equal(added.length, 1);
  assert.ok(added[0].includes("number 4"));
  assert.equal(removed.length, 1);
  assert.ok(removed[0].includes("number 3"));

  const identical = compareFilingSections(oldText, oldText);
  close(identical.similarity, 1, 1e-9);
  assert.equal(identical.changeSize, 0);

  const rewritten = compareFilingSections(oldText, "Completely different language about an entirely unrelated subject matter here for contrast.");
  assert.ok(rewritten.similarity < identical.similarity);
});

test("momentum backtest: rising names beat falling names, net of cost", () => {
  const { monthEndCloses, momentumAt, backtestMomentum } = require("../lib/backtest");

  const months = 24;
  const dates = Array.from({ length: months }, (_, i) => `2024-${String((i % 12) + 1).padStart(2, "0")}-01`.replace(/^2024-(\d{2})/, (_, m) => `${2023 + Math.floor(i / 12)}-${m}`));
  const series = (growth) => dates.map((date, i) => ({ date, close: 100 * growth ** i }));
  const universe = { UP1: series(1.04), UP2: series(1.03), DOWN1: series(0.97), DOWN2: series(0.96), FLAT: series(1.0) };
  const bench = series(1.005);

  const monthly = monthEndCloses(universe.UP1);
  assert.equal(monthly.length, months); // one point per calendar month, already month-end data
  assert.equal(momentumAt(monthly, 11), null); // needs a full 12 months of history first
  assert.ok(momentumAt(monthly, 12) > 0);

  const { rows, summary } = backtestMomentum(universe, bench, { costBps: 20 });
  assert.ok(rows.length > 0);
  assert.ok(summary.topTotalReturn > summary.bottomTotalReturn, "rising names should beat falling names");
  assert.ok(summary.longShortSpread > 0);
  assert.ok(rows.every((r) => r.topHoldings.includes("UP1") || r.topHoldings.includes("UP2")));
  assert.ok(rows.every((r) => r.bottomHoldings.includes("DOWN1") || r.bottomHoldings.includes("DOWN2")));

  // Higher trading costs should shrink (not flip the sign of) the spread.
  const cheap = backtestMomentum(universe, bench, { costBps: 0 }).summary;
  const expensive = backtestMomentum(universe, bench, { costBps: 500 }).summary;
  assert.ok(expensive.topTotalReturn < cheap.topTotalReturn);

  // Too few symbols in a month to form terciles meaningfully still doesn't throw.
  const tiny = backtestMomentum({ A: series(1.05), B: series(0.95) }, bench);
  assert.equal(tiny.rows.length, 0);
  assert.equal(tiny.summary, null);
});

test("execution helper: spread, impact estimate, limit price and warnings", () => {
  const { spreadStats, estimateImpactBps, suggestLimitPrice, sessionWarning, assessExecution } = require("../lib/execution");

  const s = spreadStats(9.98, 10.02);
  close(s.mid, 10, 1e-9);
  close(s.spreadPct, 0.004, 1e-9);
  assert.equal(spreadStats(10, 9), null); // crossed/bad quote
  assert.equal(spreadStats(null, 10), null);

  assert.ok(estimateImpactBps(0.004, 0.2) > estimateImpactBps(0.004, 0.01));
  assert.equal(estimateImpactBps(0, null), 0);

  const buyLimit = suggestLimitPrice("buy", 9.5, 10.5);
  assert.ok(buyLimit > 9.5 && buyLimit < 10.5);
  const sellLimit = suggestLimitPrice("sell", 9.5, 10.5);
  assert.ok(sellLimit < 10.5 && sellLimit > 9.5);
  assert.ok(buyLimit < sellLimit); // buy leans toward the bid, sell toward the ask

  assert.equal(sessionWarning(9 * 60), "Market is closed — this quote may be stale.");
  assert.ok(sessionWarning(9 * 60 + 35).includes("First 15 minutes"));
  assert.ok(sessionWarning(15 * 60 + 50).includes("Last 15 minutes"));
  assert.equal(sessionWarning(12 * 60), null);
  assert.equal(sessionWarning(null), null);

  const thin = assessExecution({ direction: "buy", bid: 9.5, ask: 10.5, avgDailyVolume: 50000, orderShares: 10000, etMinutes: 12 * 60 });
  assert.ok(thin.warnings.some((w) => /Thin name/.test(w)));
  assert.ok(thin.warnings.some((w) => /Wide spread/.test(w)));
  assert.ok(thin.warnings.some((w) => /average daily volume/.test(w)));
  assert.ok(thin.estimatedCostBps > 0);

  const clean = assessExecution({ direction: "buy", bid: 49.99, ask: 50.01, avgDailyVolume: 5_000_000, orderShares: 100, etMinutes: 12 * 60 });
  assert.equal(clean.warnings.length, 0);
});

test("crowding monitor: volume z-score, gap, news ratio and composite score", () => {
  const { volumeZScore, latestGapPct, newsAttentionRatio, scoreCrowding } = require("../lib/crowding");

  const quiet = Array.from({ length: 60 }, (_, i) => ({ date: `d${i}`, volume: 1_000_000 + (i % 2 === 0 ? 10_000 : -10_000), open: 10, close: 10 }));
  const spike = [...quiet, { date: "spike", volume: 5_000_000, open: 10.5, close: 11 }];
  assert.ok(volumeZScore(spike) > 2);
  assert.equal(volumeZScore(quiet.slice(0, 10)), null); // not enough history

  close(latestGapPct([{ close: 10 }, { open: 10.5, close: 11 }]), 0.05, 1e-9);
  assert.equal(latestGapPct([{ close: 10 }]), null);

  assert.equal(newsAttentionRatio(0, 3, 0, 11), 1); // no news at all = no spike
  assert.equal(newsAttentionRatio(5, 3, 0, 11), Infinity);
  close(newsAttentionRatio(6, 3, 2, 11), (6 / 3) / (2 / 11), 1e-9);
  assert.equal(newsAttentionRatio(1, 0, 1, 11), null);

  const spiky = scoreCrowding({ volumeZ: 3, gapPct: 0.08, newsRatio: 4 });
  assert.equal(spiky.label, "Attention spike");
  assert.equal(spiky.score, 100);
  assert.equal(spiky.reasons.length, 3);

  const normal = scoreCrowding({ volumeZ: 0.2, gapPct: 0.001, newsRatio: 1 });
  assert.equal(normal.label, "Normal");
  assert.equal(normal.score, 0);
});

test("13F best-ideas: portfolio weights, name matching and QoQ change", () => {
  const { computeWeights, topConviction, normalizeName, matchOverlaps, qoqChanges } = require("../lib/thirteenF");

  const holdings = [
    { nameOfIssuer: "APPLE INC", cusip: "037833100", value: 6000 },
    { nameOfIssuer: "MICROSOFT CORP", cusip: "594918104", value: 3000 },
    { nameOfIssuer: "SMALL CO", cusip: "999999999", value: 1000 },
  ];
  const weighted = computeWeights(holdings);
  close(weighted[0].weightPct, 0.6, 1e-9);
  assert.equal(weighted[0].cusip, "037833100"); // sorted largest first
  assert.equal(topConviction(holdings, 2).length, 2);

  assert.equal(normalizeName("Apple Inc."), normalizeName("APPLE INC"));
  assert.equal(normalizeName("Alphabet Inc. Class A"), normalizeName("ALPHABET INC CLASS A"));

  const universe = [{ symbol: "AAPL", name: "Apple Inc." }, { symbol: "MSFT", name: "Microsoft Corporation" }];
  const overlaps = matchOverlaps(holdings, universe);
  assert.equal(overlaps.length, 2);
  assert.ok(overlaps.find((h) => h.matchedSymbol === "AAPL"));
  assert.ok(overlaps.find((h) => h.matchedSymbol === "MSFT"));
  assert.ok(!overlaps.find((h) => h.nameOfIssuer === "SMALL CO"));

  const prior = [
    { nameOfIssuer: "APPLE INC", cusip: "037833100", value: 3000 },
    { nameOfIssuer: "MICROSOFT CORP", cusip: "594918104", value: 3000 },
  ];
  const changes = qoqChanges(holdings, prior);
  const apple = changes.find((h) => h.cusip === "037833100");
  assert.ok(apple.weightChangePct > 0, "Apple's weight within the book grew");
  const smallCo = changes.find((h) => h.cusip === "999999999");
  assert.equal(smallCo.isNew, true);
  assert.equal(smallCo.priorWeightPct, null);
});

test("activist filings: cover-page parsing and alert building", () => {
  const { parseCoverPage, buildActivistAlerts } = require("../lib/activistFilings");

  const cover = `SCHEDULE 13D\n\nNAME OF REPORTING PERSONS\nIcahn Partners LP\n\n...\nPERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11)\n9.8%\n`;
  const parsed = parseCoverPage(cover);
  assert.equal(parsed.reportingPerson, "Icahn Partners LP");
  assert.equal(parsed.stakePct, 9.8);
  assert.deepEqual(parseCoverPage("nothing useful here"), { reportingPerson: null, stakePct: null });

  const filings = [
    { form: "SC 13D", filingDate: "2026-02-01", accession: "a1", url: "u1" },
    { form: "10-K", filingDate: "2026-01-15", accession: "a2", url: "u2" },
    { form: "SC 13G/A", filingDate: "2026-03-01", accession: "a3", url: "u3" },
  ];
  const alerts = buildActivistAlerts(filings, { a1: { reportingPerson: "Icahn Partners LP", stakePct: 9.8 } });
  assert.equal(alerts.length, 2); // 10-K excluded
  assert.equal(alerts[0].accession, "a3"); // newest first
  assert.equal(alerts[0].isAmendment, true);
  assert.equal(alerts.find((a) => a.accession === "a1").reportingPerson, "Icahn Partners LP");
  assert.equal(alerts.find((a) => a.accession === "a3").reportingPerson, null); // no cover page data supplied for it
});

test("market calendar: opex dates, month ends, event merge and ICS export", () => {
  const { thirdFriday, monthlyOpexDates, quarterlyRebalanceDates, monthEnds, buildCalendarEvents, toICS } = require("../lib/calendar");

  assert.equal(thirdFriday(2026, 0), "2026-01-16"); // Jan 1 2026 is a Thursday
  assert.equal(thirdFriday(2026, 5), "2026-06-19");

  const opex = monthlyOpexDates(new Date("2026-01-01T00:00:00Z"), 3);
  assert.equal(opex.length, 3);
  assert.equal(opex[0].date, "2026-01-16");
  assert.equal(opex[0].quarterly, false);
  assert.equal(opex[2].quarterly, true); // March

  const rebal = quarterlyRebalanceDates(new Date("2026-02-01T00:00:00Z"), 1);
  assert.ok(rebal.every((d) => d >= "2026-02-01"));
  assert.ok(rebal.includes("2026-03-20"));

  assert.equal(monthEnds(new Date("2026-02-01T00:00:00Z"), 1)[0], "2026-02-28"); // 2026 not a leap year
  assert.equal(monthEnds(new Date("2024-02-01T00:00:00Z"), 1)[0], "2024-02-29");

  const events = buildCalendarEvents({
    earnings: [{ symbol: "AAPL", date: "2026-01-20", hour: "amc" }],
    exDividends: [{ symbol: "MSFT", date: "2026-01-10" }],
    cpiDates: ["2026-01-14"],
    fomcDates: ["2026-01-28"],
  }, { windowStart: "2026-01-01", windowEnd: "2026-01-31" });
  assert.ok(events.every((e) => e.date >= "2026-01-01" && e.date <= "2026-01-31"));
  assert.ok(events.some((e) => e.type === "earnings"));
  assert.ok(events.some((e) => e.type === "opex")); // Jan opex falls inside the window
  assert.ok(events.every((e, i) => i === 0 || e.date >= events[i - 1].date)); // sorted

  const ics = toICS([{ date: "2026-01-20", title: "AAPL earnings, after close", detail: "Consensus EPS $1.50" }]);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260120"));
  assert.ok(ics.includes("SUMMARY:AAPL earnings\\, after close"));
  assert.ok(ics.trim().endsWith("END:VCALENDAR"));
});

test("news triage: response parsing, ranking, and stable headline keys", () => {
  const { parseTriageResponse, topItems, headlineKey } = require("../lib/newsTriage");

  const text = 'Here you go:\n[{"materiality":8,"direction":"negative","reason":"Guidance cut"},{"materiality":1,"direction":"neutral","reason":"Routine filing"}]';
  const parsed = parseTriageResponse(text, 2);
  assert.equal(parsed[0].materiality, 8);
  assert.equal(parsed[0].direction, "negative");
  assert.equal(parsed[1].materiality, 1);

  // Out-of-range / bad-type values are clamped, not thrown.
  const clamped = parseTriageResponse('[{"materiality":99,"direction":"bogus","reason":"x"}]', 1);
  assert.equal(clamped[0].materiality, 10);
  assert.equal(clamped[0].direction, "neutral");

  // Missing rows (model returned fewer than asked) degrade to neutral/zero rather than crashing.
  const short = parseTriageResponse("[{}]", 3);
  assert.equal(short.length, 3);
  assert.equal(short[2].materiality, 0);

  assert.equal(parseTriageResponse("not json at all", 2), null);

  const ranked = topItems([{ materiality: 2 }, { materiality: 9 }, { materiality: 0 }, { materiality: 5 }], 2);
  assert.deepEqual(ranked.map((r) => r.materiality), [9, 5]);

  assert.equal(headlineKey("same string"), headlineKey("same string"));
  assert.notEqual(headlineKey("string a"), headlineKey("string b"));
});

test("supply-chain: customer-concentration extraction and economic-link gap", () => {
  const { extractCustomerMentions, economicLinkGap } = require("../lib/supplyChain");

  const text = `Risk Factors. Walmart Inc. accounted for approximately 17% of our net sales in fiscal 2025.
    No other customer accounted for more than 10% of our total revenue. Target Corporation represented approximately 8% of our revenue, a smaller share.
    Walmart Inc. accounted for approximately 15% of our net sales in fiscal 2024.`;
  const mentions = extractCustomerMentions(text);
  assert.equal(mentions.length, 1); // Target is below the 10% threshold, so it's excluded
  assert.equal(mentions[0].customer, "Walmart Inc.");
  assert.equal(mentions[0].pct, 17); // keeps the higher of the two duplicate mentions

  assert.deepEqual(extractCustomerMentions("Nothing relevant here."), []);

  close(economicLinkGap(0.1, 0.03), 0.07, 1e-9);
  assert.equal(economicLinkGap(null, 0.03), null);
});

test("forced sellers: tax-loss window and spinoff detection", () => {
  const { isTaxLossCandidate, looksLikeSpinoff } = require("../lib/forcedSellers");

  assert.equal(isTaxLossCandidate({ ytdReturnPct: -25, asOfMonth: 12 }), true);
  assert.equal(isTaxLossCandidate({ ytdReturnPct: -25, asOfMonth: 6 }), false, "only screened in Nov/Dec");
  assert.equal(isTaxLossCandidate({ ytdReturnPct: -10, asOfMonth: 12 }), false, "not down enough");
  assert.equal(isTaxLossCandidate({ ytdReturnPct: -25, asOfMonth: 11 }), true);
  assert.equal(isTaxLossCandidate({ ytdReturnPct: null, asOfMonth: 12 }), false);

  assert.equal(looksLikeSpinoff({ items: "2.01,9.01", description: "Completion of the spin-off of XYZ Co." }), true);
  assert.equal(looksLikeSpinoff({ items: "2.01", description: "Sale of a manufacturing plant" }), false);
  assert.equal(looksLikeSpinoff({ items: "5.02", description: "spin-off announcement" }), false, "wrong item code");
});

test("options positioning: Black-Scholes gamma/delta, max pain, skew, expected move", () => {
  const { normalCdf, bsGamma, bsDelta, putCallRatio, maxPain, expectedMove, ivSkew, dealerGammaByStrike } = require("../lib/options");

  close(normalCdf(0), 0.5, 1e-6);
  assert.ok(normalCdf(3) > 0.998);
  assert.ok(normalCdf(-3) < 0.002);

  // Deep ITM call delta -> 1, deep OTM call delta -> 0, ATM roughly 0.5-ish.
  const atmDelta = bsDelta(100, 100, 0.25, 0.3, 0, "call");
  assert.ok(atmDelta > 0.5 && atmDelta < 0.65); // positive drift term pushes it a bit above 0.5
  assert.ok(bsDelta(100, 50, 0.25, 0.3, 0, "call") > 0.95);
  assert.ok(bsDelta(100, 200, 0.25, 0.3, 0, "call") < 0.05);
  const putDelta = bsDelta(100, 100, 0.25, 0.3, 0, "put");
  assert.ok(putDelta < 0 && putDelta > -0.5);
  assert.equal(bsGamma(100, 100, 0, 0.3), null); // zero time to expiry is undefined, not a crash

  const calls = [{ strike: 95, openInterest: 100 }, { strike: 100, openInterest: 200 }, { strike: 105, openInterest: 50 }];
  const puts = [{ strike: 95, openInterest: 300 }, { strike: 100, openInterest: 100 }, { strike: 105, openInterest: 10 }];
  const pc = putCallRatio(calls, puts);
  close(pc.oiRatio, 410 / 350, 1e-9);

  const pain = maxPain(calls, puts);
  assert.ok([95, 100, 105].includes(pain));

  close(expectedMove(3, 2.5, 100), 0.055, 1e-9);
  assert.equal(expectedMove(null, 2.5, 100), null);

  const skew = ivSkew(
    [{ strike: 110, impliedVolatility: 0.25 }],
    [{ strike: 90, impliedVolatility: 0.35 }],
    100,
  );
  close(skew.skew, 0.1, 1e-9);
  assert.ok(skew.skew > 0, "downside puts usually cost more (the normal volatility smirk)");

  const gammaRows = dealerGammaByStrike(
    [{ strike: 100, openInterest: 500, impliedVolatility: 0.3 }],
    [{ strike: 95, openInterest: 500, impliedVolatility: 0.3 }],
    100, 0.1,
  );
  assert.equal(gammaRows.length, 2);
  assert.ok(gammaRows.every((r) => Number.isFinite(r.gammaExposure)));
  assert.ok(gammaRows[0].strike < gammaRows[1].strike); // sorted ascending
});

test("index event radar: Russell reconstitution date and S&P eligibility screen", () => {
  const { russellReconstitutionDate, sp500EligibilityCheck } = require("../lib/indexRadar");

  // June 2026: June 30 is a Tuesday, so the last Friday of June is the 26th.
  assert.equal(russellReconstitutionDate(2026), "2026-06-26");

  const eligible = sp500EligibilityCheck({ marketCap: 30e9, trailingQuarterEarnings: [1e9, 1e9, 1e9, 1e9], latestQuarterEarnings: 1e9, publicFloatPct: 0.9 });
  assert.equal(eligible.eligible, true);

  const tooSmall = sp500EligibilityCheck({ marketCap: 5e9, trailingQuarterEarnings: [1e9, 1e9, 1e9, 1e9], latestQuarterEarnings: 1e9, publicFloatPct: 0.9 });
  assert.equal(tooSmall.eligible, false);
  assert.ok(tooSmall.reasons.some((r) => /Market cap/.test(r)));

  const unprofitable = sp500EligibilityCheck({ marketCap: 30e9, trailingQuarterEarnings: [1e9, 1e9, 1e9, -5e9], latestQuarterEarnings: -1e9, publicFloatPct: 0.9 });
  assert.equal(unprofitable.eligible, false);
  assert.ok(unprofitable.reasons.some((r) => /Latest quarter/.test(r)));
  assert.ok(unprofitable.reasons.some((r) => /trailing four quarters/.test(r)));

  const lowFloat = sp500EligibilityCheck({ marketCap: 30e9, trailingQuarterEarnings: [1e9, 1e9, 1e9, 1e9], latestQuarterEarnings: 1e9, publicFloatPct: 0.3 });
  assert.equal(lowFloat.eligible, false);
});

test("base-rate panel: buckets, forward returns and distribution stats", () => {
  const { sizeBucket, valuationBucket, matchesBucket, oneYearForwardReturns, distributionStats } = require("../lib/baseRate");

  assert.equal(sizeBucket(300e9), "mega");
  assert.equal(sizeBucket(50e9), "large");
  assert.equal(sizeBucket(5e9), "mid");
  assert.equal(sizeBucket(0.5e9), "small");
  assert.equal(sizeBucket(null), null);

  assert.equal(valuationBucket(0.1), "value");
  assert.equal(valuationBucket(0.05), "blend");
  assert.equal(valuationBucket(0.01), "growth");
  assert.equal(valuationBucket(-0.02), "growth");

  const target = { sector: "Technology", sizeBucket: "large", valuationBucket: "growth" };
  assert.equal(matchesBucket({ sector: "Technology", sizeBucket: "large", valuationBucket: "growth" }, target), true);
  assert.equal(matchesBucket({ sector: "Technology", sizeBucket: "large", valuationBucket: "value" }, target), false);
  assert.equal(matchesBucket({ sector: "Healthcare", sizeBucket: "large", valuationBucket: "growth" }, target), false);
  assert.equal(matchesBucket({ sector: "Technology", sizeBucket: "large" }, target), true); // unknown valuation = soft match

  const series = Array.from({ length: 260 }, (_, i) => ({ date: `d${i}`, close: 100 * 1.001 ** i }));
  const returns = oneYearForwardReturns(series);
  assert.equal(returns.length, 260 - 252);
  assert.ok(returns.every((r) => r > 0));

  const stats = distributionStats([-0.2, -0.1, 0, 0.1, 0.2, 0.3]);
  close(stats.mean, (-0.2 - 0.1 + 0 + 0.1 + 0.2 + 0.3) / 6, 1e-9);
  assert.equal(stats.n, 6);
  close(stats.pctPositive, 3 / 6, 1e-9);
  assert.equal(distributionStats([]), null);
});

test("FINRA short-volume file parsing", () => {
  const { parseShortVolumeFile } = require("../lib/sources/finra");
  const text = "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20260102|AAPL|1000|50|4000|Q\n20260102|MSFT|500|0|2000|Q\n";
  const rows = parseShortVolumeFile(text);
  assert.deepEqual(rows.AAPL, { shortVolume: 1000, totalVolume: 4000 });
  assert.deepEqual(rows.MSFT, { shortVolume: 500, totalVolume: 2000 });
  assert.equal(rows.GOOG, undefined);
  assert.deepEqual(parseShortVolumeFile("Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n"), {});
});

test("signals refresh: stops at the time budget and resumes stalest-first", async () => {
  const db = require("../db");
  const { refreshSignals, storedSignals } = require("../lib/signals");
  db.prepare("DELETE FROM positions").run();
  db.prepare("DELETE FROM watchlist").run();
  db.prepare("INSERT INTO positions (symbol, shares) VALUES (?, ?)").run("AAA", 1);
  db.prepare("INSERT INTO positions (symbol, shares) VALUES (?, ?)").run("BBB", 1);
  db.prepare("INSERT INTO watchlist (symbol) VALUES (?)").run("CCC");

  // Fake clock: each compute takes 10 "seconds".
  let clock = Date.parse("2026-01-05T12:00:00Z");
  const now = () => clock;
  const calls = [];
  const compute = async (symbol, { owned }) => {
    calls.push(symbol);
    clock += 10000;
    return { alerts: [{ type: "short", level: "watch", symbol, title: `${symbol} flagged`, owned }], crowding: null };
  };

  const first = await refreshSignals({ budgetMs: 15000, compute, now });
  assert.equal(first.refreshed, 2); // second compute starts at 10s < 15s budget, third at 20s does not
  assert.equal(first.remaining, 1);
  assert.equal(first.total, 3);

  const second = await refreshSignals({ budgetMs: 15000, compute, now });
  assert.equal(second.refreshed, 1);
  assert.equal(second.remaining, 0);
  assert.equal(new Set(calls).size, 3, "every tracked symbol computed exactly once across runs");

  // Fresh results are not recomputed until they age past maxAgeMs.
  const third = await refreshSignals({ budgetMs: 15000, compute, now });
  assert.equal(third.refreshed, 0);

  // A manual refresh (`since`) recomputes everything older than the click, stalest first.
  clock += 60000;
  const since = clock;
  const manual = await refreshSignals({ budgetMs: 100000, since, compute, now });
  assert.equal(manual.refreshed, 3);
  assert.deepEqual(calls.slice(-3).slice(0, 2), calls.slice(0, 2), "stalest symbols go first");
  const again = await refreshSignals({ budgetMs: 100000, since, compute, now });
  assert.equal(again.refreshed, 0, "a manual refresh terminates");

  const stored = storedSignals();
  assert.equal(stored.length, 3);
  assert.ok(stored.find((s) => s.symbol === "CCC").alerts[0].owned === false);
  assert.ok(stored.find((s) => s.symbol === "AAA").alerts[0].owned === true);

  // Sold / unwatched names drop out of the stored view.
  db.prepare("DELETE FROM watchlist WHERE symbol = ?").run("CCC");
  assert.deepEqual(storedSignals().map((s) => s.symbol).sort(), ["AAA", "BBB"]);
  db.prepare("DELETE FROM positions").run();
  db.prepare("DELETE FROM signals").run();
});
