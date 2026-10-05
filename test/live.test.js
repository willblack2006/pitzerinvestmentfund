// Live-data tests: hit Yahoo, SEC, Finnhub and FRED through the real server. Skipped unless
// LIVE=1 (npm run test:live) so the default suite works offline and in CI.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers");

const LIVE = process.env.LIVE === "1";
let s;
test.before(async () => { if (LIVE) s = await startServer(); });
test.after(async () => { await s?.stop(); });
const live = (name, fn, timeout = 120000) => test(name, { skip: !LIVE && "set LIVE=1", timeout }, fn);

live("research: large-cap stock has every section populated", async () => {
  const r = await s.api("/api/research/AAPL");
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.notFound, false);
  assert.ok(d.name && d.chart.length > 200, "price history");
  assert.ok(d.street.targets.mean > 0, "price targets");
  assert.ok(d.street.trend.length >= 1 && d.street.estimates.length >= 2, "ratings + estimates");
  assert.ok(d.analysis.annual.length >= 3, "SEC annual history");
  const last = d.analysis.annual.at(-1);
  assert.ok(last.grossMargin > 0.2 && last.grossMargin < 0.8, `gross margin ${last.grossMargin}`);
  assert.ok(d.analysis.piotroski.outOf >= 7);
  assert.ok(Number.isFinite(d.analysis.altman.z));
  assert.ok(d.analysis.dcf.fcf > 0 && d.analysis.dcf.shares > 1e9);
  assert.ok(d.technicals.sma50 > 0);
});

live("research: quarterly SEC values are single quarters, not year-to-date", async () => {
  const d = (await s.api("/api/research/GOOGL")).body;
  const q = d.analysis.quarterly.revenue;
  const fy = d.analysis.annual.at(-1).revenue;
  assert.ok(q.length >= 4);
  for (const p of q) assert.ok(p.val < fy * 0.45, `quarter ${p.end} ${p.val} looks like a YTD/annual figure`);
});

live("research: unknown ticker is flagged notFound", async () => {
  const d = (await s.api("/api/research/ZZZZQX")).body;
  assert.equal(d.notFound, true);
});

live("research: ETF and bank degrade without errors", async () => {
  const etf = (await s.api("/api/research/SPY")).body;
  assert.equal(etf.notFound, false);
  assert.ok(etf.chart.length > 100);
  const bank = (await s.api("/api/research/JPM")).body;
  assert.match(bank.profile.sector, /Financial/);
});

live("research: share-class ticker with a dot resolves", async () => {
  const d = (await s.api("/api/research/BRK-B")).body;
  assert.equal(d.notFound, false);
});

live("comps, risk (incl. blend), filings", async () => {
  const c = (await s.api("/api/research/MSFT/comps?add=ORCL")).body;
  assert.ok(c.rows.length >= 3 && c.rows.some((r) => r.symbol === "ORCL"));
  assert.ok(c.peerMedian.peTTM > 0);
  const r = (await s.api("/api/research/MSFT/risk")).body;
  assert.ok(r.profile.beta > 0 && r.sectorEtf === "XLK");
  const rb = (await s.api(`/api/research/MSFT/risk?benchmark=${encodeURIComponent("SPY:60,AGG:40")}`)).body;
  assert.equal(rb.benchmark, "60/40 SPY/AGG");
  assert.ok(rb.profile.series.bench.length > 200);
  assert.equal((await s.api("/api/research/MSFT/risk?benchmark=BAD:x")).status, 400);
  const f = (await s.api("/api/research/MSFT/filings")).body;
  assert.ok(f.filings.some((x) => x.form === "10-K") && f.filings.every((x) => /^https:\/\/www\.sec\.gov\//.test(x.url)));
});

live("portfolio: performance, allocation, earnings, alerts", async () => {
  const p = (await s.api("/api/portfolio/performance")).body;
  assert.ok(p.backtest && p.holdingsCovered >= p.holdingsTotal - 3, `covered ${p.holdingsCovered}/${p.holdingsTotal}`);
  assert.ok(p.contributions.length && p.correlation.symbols.length >= 5);
  const q = (await s.api("/api/portfolio/performance?benchmark=QQQ")).body;
  assert.equal(q.benchmark, "QQQ");
  const a = (await s.api("/api/portfolio/allocation")).body;
  const sum = a.sectors.reduce((x, r) => x + r.weight, 0);
  assert.ok(Math.abs(sum - (100 - a.cashPct)) < 1, `sector weights sum ${sum}`);
  assert.ok(Object.values(a.sectors).some((r) => r.benchmarkWeight > 0));
  const e = (await s.api("/api/portfolio/earnings")).body;
  assert.ok(Array.isArray(e.events));
  const al = (await s.api("/api/alerts")).body;
  assert.ok(Array.isArray(al.alerts));
});

live("market pages: macro, screener, insiders", async () => {
  const m = (await s.api("/api/macro")).body;
  assert.ok(m.fedFundsRate?.observations?.length);
  const sc = (await s.api("/api/screener")).body;
  assert.ok(sc.candidates.length > 5);
  for (let i = 1; i < sc.candidates.length; i++) assert.ok(sc.candidates[i - 1].sourcedFrom.length >= sc.candidates[i].sourcedFrom.length, "ranked");
  const ins = (await s.api("/api/insiders")).body;
  assert.ok(Number.isFinite(ins.netValue) && ins.recent.length);
}, 240000);

live("server log has no crashes after live run", () => {
  assert.ok(!/TypeError|ReferenceError|SqliteError|Unhandled/.test(s.log()), s.log().slice(-3000));
});
