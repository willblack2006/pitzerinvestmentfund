// Fund cockpit: one response with everything the at-a-glance dashboard draws (KPIs, holdings
// treemap, value vs benchmark with event markers, daily return calendar, contribution
// waterfall, IPS headroom, "what moved the fund"), plus lazier endpoints for the heavier
// panels (exposures, rolling performance, Brinson attribution, per-holding cost basis).
// Read-only; reuses lib/portfolio, lib/prices and lib/benchmarks so numbers match the
// Holdings, Performance and Allocation pages. Math lives in lib/attribution.js.
const express = require("express");
const db = require("../db");
const portfolio = require("../lib/portfolio");
const { latestPrices, histories } = require("../lib/prices");
const benchmarks = require("../lib/benchmarks");
const { getSettings } = require("../lib/settings");
const { benchmarkFor } = require("../lib/prefs");
const { SECTOR_ETF } = require("../lib/analytics");
const A = require("../lib/attribution");
const yahoo = require("../lib/sources/yahoo");

const router = express.Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const tableExists = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

function readBenchmark(req, res) {
  try { return benchmarkFor(req); } catch (e) { res.status(400).json({ error: e.message }); return null; }
}

// Things that happened to the fund, for markers on the value chart. Every source is optional
// (tables from later features may not exist yet), so each is wrapped.
function fundEvents(since) {
  const out = [];
  const add = (fn) => { try { out.push(...fn()); } catch { /* table or column not there yet */ } };
  add(() => db.prepare("SELECT id, date, type, symbol, shares, price, amount FROM transactions WHERE date >= ? ORDER BY date").all(since)
    .filter((t) => ["buy", "sell", "deposit", "withdrawal"].includes(t.type))
    .map((t) => ({
      date: t.date, kind: "trade", sub: t.type, symbol: t.symbol || null, href: "#/transactions",
      title: t.type === "buy" || t.type === "sell" ? `${t.type === "buy" ? "Bought" : "Sold"} ${+t.shares.toFixed(4)} ${t.symbol} at $${t.price.toFixed(2)}` : `${t.type === "deposit" ? "Deposit" : "Withdrawal"} of $${Math.round(t.amount).toLocaleString("en-US")}`,
    })));
  add(() => db.prepare("SELECT id, symbol, direction, status, createdAt, votingOpenedAt, decidedAt FROM pitches WHERE status != 'draft' AND (createdAt >= ? OR decidedAt >= ?)").all(since, since)
    .flatMap((p) => [
      p.votingOpenedAt && p.votingOpenedAt.slice(0, 10) >= since && { date: p.votingOpenedAt.slice(0, 10), kind: "pitch", symbol: p.symbol, href: `#/pitches/${p.id}`, title: `Pitch opened for vote: ${p.direction} ${p.symbol}` },
      p.decidedAt && p.decidedAt.slice(0, 10) >= since && ["approved", "rejected", "executed"].includes(p.status) && { date: p.decidedAt.slice(0, 10), kind: "vote", symbol: p.symbol, href: `#/pitches/${p.id}`, title: `Vote ${p.status === "rejected" ? "rejected" : "approved"}: ${p.direction} ${p.symbol}` },
    ].filter(Boolean)));
  add(() => db.prepare("SELECT id, symbol, trippedAt, trippedDetail FROM tripwires WHERE trippedAt IS NOT NULL AND trippedAt >= ?").all(since)
    .map((t) => ({ date: t.trippedAt.slice(0, 10), kind: "tripwire", symbol: t.symbol, href: `#/research/${encodeURIComponent(t.symbol)}`, title: `${t.symbol} tripwire tripped${t.trippedDetail ? `: ${t.trippedDetail}` : ""}` })));
  // High-importance agent alerts from the team feed (agent platform), when that exists.
  if (tableExists("feed_items")) {
    add(() => db.prepare("SELECT id, kind, symbol, title, createdAt FROM feed_items WHERE importance = 'high' AND kind IN ('agent_alert','thesis_change','tripwire_tripped') AND createdAt >= ? ORDER BY createdAt DESC LIMIT 60").all(since)
      .map((f) => ({ date: f.createdAt.slice(0, 10), kind: f.kind === "tripwire_tripped" ? "tripwire" : "agent", symbol: f.symbol || null, href: "#/agents", title: f.title })));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Latest thesis health per symbol from the agent platform's thesis tracking, when present.
function thesisHealth(symbols) {
  if (!symbols.length || !tableExists("thesis_checks")) return {};
  try {
    const rows = db.prepare(`SELECT symbol, status, createdAt FROM thesis_checks WHERE pillarId IS NULL AND symbol IN (${symbols.map(() => "?").join(",")}) ORDER BY createdAt`).all(...symbols);
    const out = {};
    for (const r of rows) out[r.symbol] = { status: r.status, asOf: r.createdAt };
    return out;
  } catch { return {}; }
}

async function gather(benchmark) {
  const s = getSettings();
  const positions = db.prepare("SELECT symbol, shares, avgCost, totalCost, marketValue FROM positions ORDER BY symbol").all();
  const symbols = positions.map((p) => p.symbol);
  const [hist, live, bench, alloc] = await Promise.all([
    histories(symbols, "2y"),
    latestPrices(symbols).catch(() => ({})),
    benchmarks.series(benchmark, "2y").catch(() => []),
    portfolio.allocation(benchmark).catch(() => null),
  ]);
  const prices = Object.fromEntries(Object.entries(live).filter(([, q]) => Number.isFinite(q?.price)).map(([k, q]) => [k, q.price]));
  return { s, positions, symbols, hist, live, prices, bench, alloc, cash: Number(s.cash) || 0 };
}

router.get("/cockpit", async (req, res) => {
  const benchmark = readBenchmark(req, res);
  if (!benchmark) return;
  const g = await gather(benchmark);
  const { positions, hist, prices, bench, alloc, cash } = g;
  const benchName = benchmarks.shortName(benchmark);
  const latest = Object.values(hist).map((h) => h?.at(-1)?.date).filter(Boolean).sort().at(-1) || null;

  // Holdings rows: value at live prices, per-period returns and contribution.
  const contribs = {};
  for (const k of A.PERIOD_KEYS) contribs[k] = A.contribution({ positions, histories: hist, cash, from: k, prices });
  const sectorOf = Object.fromEntries((alloc?.positions || []).map((p) => [p.symbol, p.sector]));
  const nameOf = Object.fromEntries((alloc?.positions || []).map((p) => [p.symbol, p.name]));
  const health = thesisHealth(g.symbols);
  const rows = positions.map((p) => {
    const price = prices[p.symbol] ?? hist[p.symbol]?.at(-1)?.close ?? (p.shares ? p.marketValue / p.shares : null);
    const value = Number.isFinite(price) ? price * p.shares : p.marketValue;
    const ret = A.periodReturns(hist[p.symbol], { endPrice: prices[p.symbol], latest });
    const contribution = Object.fromEntries(A.PERIOD_KEYS.map((k) => [k, contribs[k].rows.find((r) => r.symbol === p.symbol)?.contribution ?? null]));
    return {
      symbol: p.symbol, name: nameOf[p.symbol] || "", sector: sectorOf[p.symbol] || "Unclassified", shares: p.shares, price, value,
      avgCost: p.avgCost, gainPct: p.avgCost > 0 && Number.isFinite(price) ? price / p.avgCost - 1 : null,
      ret, contribution, thesis: health[p.symbol] || null, hasHistory: !!hist[p.symbol]?.length,
    };
  });
  const invested = rows.reduce((sum, r) => sum + (r.value || 0), 0);
  const nav = invested + cash;
  rows.forEach((r) => { r.weight = nav ? r.value / nav : 0; });
  rows.sort((a, b) => b.value - a.value);

  // Fund vs benchmark per period (today's holdings basis).
  const benchRet = A.periodReturns(bench, { latest });
  const periods = Object.fromEntries(A.PERIOD_KEYS.map((k) => [k, {
    label: A.PERIOD_LABELS[k], fund: contribs[k].fundReturn, bench: benchRet[k],
    from: contribs[k].rows[0]?.baseDate || null, missing: contribs[k].missing,
  }]));

  // Value series: today's holdings over two years, and the recorded NAV ledger.
  const { series: hv, covered } = A.holdingsValueSeries(positions, hist, cash);
  const navRows = db.prepare("SELECT date, totalValue, netFlow FROM nav_history WHERE totalValue > 0 ORDER BY date").all();
  const twr = portfolio.twr(db.prepare("SELECT date, totalValue, netFlow FROM nav_history ORDER BY date").all(), bench);
  const reb = A.rebased(hv, bench);
  const firstDate = reb.dates[0] || new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);

  // Sector-level active share and benchmark sector weights for the exposure bars.
  const fundSectorW = Object.fromEntries((alloc?.sectors || []).filter((x) => x.weight > 0).map((x) => [x.sector, x.weight]));
  const benchSectorW = Object.fromEntries((alloc?.sectors || []).filter((x) => x.benchmarkWeight !== null).map((x) => [x.sector, x.benchmarkWeight]));
  const activeShare = A.sectorActiveShare(fundSectorW, benchSectorW);
  const ips = alloc ? A.ipsHeadroom(alloc) : null;

  const oneDay = contribs["1d"];
  const explain = A.explainMove(oneDay, { benchReturn: benchRet["1d"], benchName, periodLabel: "on the latest session", sectors: sectorOf });

  res.json({
    asOf: latest, generatedAt: new Date().toISOString(),
    benchmark: benchName, benchmarkValue: benchmark, benchmarkLabel: benchmarks.label(benchmark), fundBenchmark: g.s.benchmark,
    kpis: {
      nav, invested, cash, cashPct: nav ? cash / nav : 0, holdings: rows.length,
      day: periods["1d"], mtd: periods.mtd, ytd: periods.ytd,
      activeShare, activeShareBasis: "sector",
      ips: ips ? { tightest: ips.tightest, breaches: ips.breaches, count: ips.items.length } : null,
      twr: twr ? { totalReturn: twr.totalReturn, benchReturn: twr.benchReturn, since: twr.series[0].date, points: twr.series.length } : null,
    },
    periods,
    holdings: rows,
    sectors: (alloc?.sectors || []).map((x) => ({ sector: x.sector, weight: x.weight, benchmarkWeight: x.benchmarkWeight, active: x.active, symbols: x.symbols })),
    sectorBenchmark: alloc?.sectorBenchmarkLabel || null,
    ips: ips?.items || [],
    checks: alloc?.checks || [],
    series: { basis: "holdings", covered: covered.length, total: positions.length, ...reb, values: hv.filter((p) => p.date >= firstDate).map((p) => p.close) },
    nav: navRows.map((r) => ({ date: r.date, value: r.totalValue, flow: r.netFlow })),
    navTwr: twr ? twr.series : null,
    calendar: A.dailyCalendar(hv, bench).filter((d) => d.date >= firstDate),
    monthly: A.monthlyReturns(hv),
    events: fundEvents(firstDate),
    explain,
  });
});

// Contribution waterfall for any range: ?period=1m or ?from=YYYY-MM-DD[&to=YYYY-MM-DD].
router.get("/cockpit/contribution", async (req, res) => {
  const benchmark = readBenchmark(req, res);
  if (!benchmark) return;
  const period = A.PERIOD_KEYS.includes(req.query.period) ? req.query.period : null;
  const from = period || (DATE.test(req.query.from || "") ? req.query.from : null);
  const to = DATE.test(req.query.to || "") ? req.query.to : null;
  if (!from) return res.status(400).json({ error: "Pass ?period=1m or ?from=YYYY-MM-DD." });
  if (to && !period && to < from) return res.status(400).json({ error: "The end date is before the start date." });
  const s = getSettings();
  const positions = db.prepare("SELECT symbol, shares FROM positions").all();
  const [hist, live, bench, alloc] = await Promise.all([
    histories(positions.map((p) => p.symbol), "2y"),
    to ? Promise.resolve({}) : latestPrices(positions.map((p) => p.symbol)).catch(() => ({})),
    benchmarks.series(benchmark, "2y").catch(() => []),
    portfolio.allocation(benchmark).catch(() => null),
  ]);
  const prices = Object.fromEntries(Object.entries(live).filter(([, q]) => Number.isFinite(q?.price)).map(([k, q]) => [k, q.price]));
  const c = A.contribution({ positions, histories: hist, cash: Number(s.cash) || 0, from, to, prices });
  let benchReturn = null;
  const latest = to || bench.at(-1)?.date;
  if (bench.length && latest) {
    const b0 = period ? A.baseFor(bench, period, latest) : A.closeOn(bench, from, true);
    const b1 = A.closeOn(bench, latest);
    benchReturn = b0 && b1 ? b1.close / b0.close - 1 : null;
  }
  const sectors = Object.fromEntries((alloc?.positions || []).map((p) => [p.symbol, p.sector]));
  const label = period ? A.PERIOD_LABELS[period].toLowerCase() : `from ${from}${to ? ` to ${to}` : ""}`;
  res.json({
    period, from: c.rows[0]?.baseDate || from, to: to || latest, benchmark: benchmarks.shortName(benchmark), benchReturn,
    fundReturn: c.fundReturn, cashWeight: c.cashWeight, missing: c.missing,
    rows: c.rows.map((r) => ({ symbol: r.symbol, sector: sectors[r.symbol] || "Unclassified", contribution: r.contribution, return: r.return, startWeight: r.startWeight })),
    explain: A.explainMove(c, { benchReturn, benchName: benchmarks.shortName(benchmark), periodLabel: period === "1d" ? "on the latest session" : period ? `over ${label}` : label, sectors }),
  });
});

// Exposures: sector vs benchmark, market-cap buckets, factor tilts (lazy: quote summaries are
// slower, so the cockpit loads this after the first paint).
router.get("/cockpit/exposures", async (req, res) => {
  const benchmark = readBenchmark(req, res);
  if (!benchmark) return;
  const alloc = await portfolio.allocation(benchmark).catch(() => null);
  if (!alloc) return res.status(502).json({ error: "Allocation is unavailable right now." });
  const syms = alloc.positions.map((p) => p.symbol);
  const caps = {};
  const queue = [...syms];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const sym = queue.shift();
      try {
        const qs = await yahoo.getQuoteSummary(sym);
        const v = qs?.price?.marketCap ?? qs?.summaryDetail?.marketCap;
        caps[sym] = typeof v === "object" ? v?.raw : v;
      } catch { /* unknown bucket */ }
    }
  }));
  const weights = Object.fromEntries(alloc.positions.map((p) => [p.symbol, p.weight / 100]));
  res.json({
    benchmark: alloc.sectorBenchmarkLabel, coverage: alloc.sectorCoverage, cashPct: alloc.cashPct,
    sectors: alloc.sectors.map((x) => ({ sector: x.sector, weight: x.weight, benchmarkWeight: x.benchmarkWeight, active: x.active, symbols: x.symbols })),
    caps: A.capBuckets(caps, weights),
  });
});

// Rolling 3/6/12-month return, beta and Sharpe; drawdown; daily return distribution;
// benchmark-relative cumulative return. On today's holdings over two years.
router.get("/cockpit/performance", async (req, res) => {
  const benchmark = readBenchmark(req, res);
  if (!benchmark) return;
  const s = getSettings();
  const positions = db.prepare("SELECT symbol, shares FROM positions").all();
  const [hist, bench] = await Promise.all([histories(positions.map((p) => p.symbol), "2y"), benchmarks.series(benchmark, "2y").catch(() => [])]);
  const { series: hv, covered } = A.holdingsValueSeries(positions, hist, Number(s.cash) || 0);
  if (hv.length < 30) return res.json({ ready: false, reason: "Not enough overlapping price history for today's holdings yet." });
  const reb = A.rebased(hv, bench);
  const roll = A.rollingWindows(hv, bench, [63, 126, 252]);
  const fundDd = A.drawdownSeries(hv), benchDd = A.drawdownSeries(bench.filter((p) => p.date >= hv[0].date));
  const fr = A.dailyReturns(hv).map((r) => r.ret);
  const br = A.dailyReturns(bench.filter((p) => p.date >= hv[0].date)).map((r) => r.ret);
  res.json({
    ready: true, benchmark: benchmarks.shortName(benchmark), benchmarkLabel: benchmarks.label(benchmark),
    covered: covered.length, total: positions.length, start: hv[0].date, end: hv.at(-1).date,
    rebased: reb,
    rolling: Object.fromEntries(Object.entries(roll).map(([w, v]) => [w, v])),
    drawdown: { fund: fundDd, bench: { ...benchDd, points: undefined }, benchPoints: benchDd.points },
    histogram: A.returnHistogram(fr, br),
  });
});

// Brinson attribution by sector for a period: allocation vs selection. Benchmark sector
// returns come from the SPDR sector ETFs (a proxy; the page says so).
router.get("/cockpit/attribution", async (req, res) => {
  const benchmark = readBenchmark(req, res);
  if (!benchmark) return;
  const period = A.PERIOD_KEYS.includes(req.query.period) ? req.query.period : "3m";
  const s = getSettings();
  const positions = db.prepare("SELECT symbol, shares FROM positions").all();
  const etfs = Object.values(SECTOR_ETF);
  const [hist, etfHist, bench, alloc] = await Promise.all([
    histories(positions.map((p) => p.symbol), "2y"),
    histories(etfs, "2y"),
    benchmarks.series(benchmark, "2y").catch(() => []),
    portfolio.allocation(benchmark).catch(() => null),
  ]);
  if (!alloc) return res.status(502).json({ error: "Allocation is unavailable right now." });
  const latest = bench.at(-1)?.date || null;
  const c = A.contribution({ positions, histories: hist, cash: Number(s.cash) || 0, from: period, to: null });
  const sectorOf = Object.fromEntries(alloc.positions.map((p) => [p.symbol, p.sector]));
  const fund = {};
  for (const r of c.rows) {
    const sec = sectorOf[r.symbol] || "Unclassified";
    fund[sec] = fund[sec] || { weight: 0, gain: 0 };
    fund[sec].weight += r.startWeight;
    fund[sec].gain += r.contribution;
  }
  for (const v of Object.values(fund)) v.return = v.weight ? v.gain / v.weight : null;
  const benchW = Object.fromEntries(alloc.sectors.filter((x) => x.benchmarkWeight !== null).map((x) => [x.sector, { weight: x.benchmarkWeight / 100 }]));
  for (const [sector, etf] of Object.entries(SECTOR_ETF)) {
    if (!benchW[sector] && !fund[sector]) continue;
    const r = A.periodReturns(etfHist[etf], { latest })[period];
    (benchW[sector] = benchW[sector] || { weight: 0 }).return = r;
  }
  const benchTotal = A.periodReturns(bench, { latest })[period];
  if (!Number.isFinite(benchTotal)) return res.json({ ready: false, reason: "No benchmark history for this period." });
  // Cash is its own "sector": zero return, zero benchmark weight.
  // Its drag shows up as allocation (weight held out of the market × the market's return).
  if (c.cashWeight > 0) { fund.Cash = { weight: c.cashWeight, return: 0 }; benchW.Cash = { weight: 0, return: 0 }; }
  const result = A.brinson(fund, benchW, benchTotal);
  res.json({ ready: true, period, label: A.PERIOD_LABELS[period], benchmark: benchmarks.shortName(benchmark), sectorBenchmark: alloc.sectorBenchmarkLabel,
    fundReturn: c.fundReturn, benchReturn: benchTotal, active: Number.isFinite(c.fundReturn) ? c.fundReturn - benchTotal : null, ...result });
});

// One holding: price history with the fund's trades and its average cost over time.
router.get("/cockpit/position/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Bad ticker." });
  const pos = db.prepare("SELECT symbol, shares, avgCost, totalCost FROM positions WHERE symbol = ?").get(symbol);
  const txns = db.prepare("SELECT id, date, type, shares, price, amount, costBasis, realizedGain, note FROM transactions WHERE symbol = ? ORDER BY date, id").all(symbol);
  if (!pos && !txns.length) return res.status(404).json({ error: `The fund has no history in ${symbol}.` });
  let history = [];
  try { history = await yahoo.getChart(symbol, "2y", "1d"); } catch { /* chart shows trades only */ }
  // Average cost over time: walk back from today's position through the trades, so holdings
  // imported before the ledger started still get a sensible line.
  let shares = pos?.shares || 0, cost = pos?.totalCost || 0;
  const steps = [{ date: null, shares, avgCost: shares ? cost / shares : null }];
  for (const t of [...txns].reverse()) {
    if (t.type === "buy") { shares -= t.shares; cost -= t.shares * t.price + (t.amount || 0); }
    else if (t.type === "sell") { shares += t.shares; cost += t.costBasis || 0; }
    else continue;
    // Tiny leftovers (a broker sync adjusting fractional shares) are not a real earlier position.
    steps.unshift({ date: t.date, shares: Math.max(0, shares), avgCost: shares > 1e-6 && cost > 0.01 ? cost / shares : null });
  }
  // steps[i] holds the state BEFORE trade i; turn into dated segments after each trade.
  const trades = txns.filter((t) => t.type === "buy" || t.type === "sell");
  const costPath = [];
  if (steps[0].avgCost !== null) costPath.push({ date: history[0]?.date || trades[0]?.date || null, avgCost: steps[0].avgCost, shares: steps[0].shares });
  trades.forEach((t, i) => costPath.push({ date: t.date, avgCost: steps[i + 1]?.avgCost ?? null, shares: steps[i + 1]?.shares ?? 0 }));
  res.json({
    symbol, shares: pos?.shares || 0, avgCost: pos?.avgCost ?? null, history: history.map((p) => ({ date: p.date, close: p.close })),
    trades: trades.map((t) => ({ id: t.id, date: t.date, type: t.type, shares: t.shares, price: t.price, realizedGain: t.realizedGain, note: t.note })),
    dividends: txns.filter((t) => t.type === "dividend").map((t) => ({ date: t.date, amount: t.amount })),
    costPath, ledgerStarts: txns[0]?.date || null, heldBeforeLedger: steps[0].avgCost !== null,
  });
});

router.autoMount = true;
module.exports = router;
