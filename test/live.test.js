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

live("gov contracts and House congressional trades", async () => {
  const gov = (await s.api("/api/research/LMT/gov-contracts")).body;
  assert.ok(gov.available && gov.relevant, JSON.stringify(gov).slice(0, 300));
  assert.ok(gov.count > 0 && gov.total > 0);
  assert.ok(gov.top.every((a) => a.amount > 0 && /^https:\/\/www\.usaspending\.gov\//.test(a.url)));

  const ct = (await s.api("/api/congress-trades")).body;
  assert.ok(!ct.error, ct.error);
  assert.ok(ct.filingCount > 0 && ct.tradeCount > 0, "parsed some House PTRs");
  assert.ok(ct.matched.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.tradeDate) && /house\.gov/.test(t.url)));
}, 240000);

live("short pressure: single-symbol detail and ranked list", async () => {
  const one = (await s.api("/api/short-pressure/AAPL")).body;
  assert.ok(!one.error, one.error);
  assert.ok(Number.isFinite(one.score) && one.score >= 0 && one.score <= 100);
  assert.ok(Array.isArray(one.reasons) && one.reasons.length);
  assert.ok(Array.isArray(one.finra));

  const ranked = (await s.api("/api/short-pressure?scope=holdings")).body;
  assert.equal(ranked.scope, "holdings");
  assert.ok(Array.isArray(ranked.rows));
  for (let i = 1; i < ranked.rows.length; i++) {
    const a = ranked.rows[i - 1].score ?? -1, b = ranked.rows[i].score ?? -1;
    assert.ok(a >= b, "ranked most crowded first");
  }
}, 240000);

live("live quotes: batched prices, today's change and market state", async () => {
  const r = await s.api("/api/quotes?symbols=AAPL,MSFT,ZZZZQX");
  assert.equal(r.status, 200);
  assert.ok(r.body.quotes.AAPL.price > 0 && r.body.quotes.MSFT.price > 0);
  assert.ok("changePct" in r.body.quotes.AAPL);
  assert.equal(r.body.quotes.ZZZZQX, undefined, "unknown tickers are omitted");
  assert.ok(r.body.marketState);
  assert.equal((await s.api("/api/quotes")).status, 400);
  const research = (await s.api("/api/research/AAPL")).body;
  assert.equal(research.technicals.price, research.quote.price, "research uses the live quote");
});

live("13F manager search: finds a fund by name via EDGAR", async () => {
  const r = await s.api("/api/13f/search?q=bridgewater");
  assert.equal(r.status, 200);
  assert.ok(r.body.results.find((m) => m.cik === "0001350694"), JSON.stringify(r.body).slice(0, 500));
  assert.equal((await s.api("/api/13f/search?q=a")).status, 400);
});

live("today: editions list and live market side column", async () => {
  const ed = await s.api("/api/today/editions");
  assert.equal(ed.status, 200);
  assert.equal(ed.body.editions.length, 4);
  assert.deepEqual(ed.body.editions[0].slots.map((x) => x.key), ["premarket", "midday", "postmarket"]);
  if (!ed.body.edition) assert.ok(ed.body.liveHeadlines.length > 0, "live headlines when nothing is captured yet");
  assert.equal((await s.api("/api/today/editions?date=2020-01-01&slot=premarket")).status, 400);
  const live = (await s.api("/api/today/live")).body;
  assert.ok(live.snapshot.find((r) => r.symbol === "^GSPC").price > 0, "S&P 500 quote");
  assert.equal(live.sectors.length, 11);
  assert.ok(live.fed.nextMeeting?.date || live.fed.lastMeeting?.date, "Fed calendar parsed");
});

live("holdings time frames: base closes for every period in one call", async () => {
  const add = await s.api("/api/positions", { method: "POST", auth: true, body: { symbol: "AAPL", shares: 10, avgCost: 100, totalCost: 1000 } });
  assert.ok([200, 201, 409].includes(add.status), `add position: ${add.status} ${add.text}`);
  const r = await s.api("/api/portfolio/period-bases");
  assert.equal(r.status, 200);
  assert.ok(r.body.bySymbol.AAPL, "AAPL included");
  for (const [sym, b] of Object.entries(r.body.bySymbol)) {
    for (const p of ["5d", "1m", "3m", "ytd", "1y"]) assert.ok(b[p]?.close > 0, `${sym} ${p} base`);
    assert.ok(b.ytd.date < `${r.body.latest.slice(0, 4)}-01-01`, "YTD base is in the prior year");
  }
});

live("server log has no crashes after live run", () => {
  assert.ok(!/TypeError|ReferenceError|SqliteError|Unhandled/.test(s.log()), s.log().slice(-3000));
});
