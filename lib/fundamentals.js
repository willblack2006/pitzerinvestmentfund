// Derived fundamentals and academic quality scores computed from SEC XBRL facts.
// Everything here is pure (no I/O) so it can be unit-checked against known filings.

const annual = (series) => (series || []).filter((p) => p.form === "10-K");
const quarterly = (series) => (series || []).filter((p) => p.form === "10-Q");

// Value of an annual series at a fiscal-year end (±20 days, since companies on 52/53-week
// years drift), or the instant value nearest to it.
function at(series, end) {
  if (!series || !end) return null;
  const t = new Date(end).getTime();
  let best = null;
  for (const p of series) {
    const d = Math.abs(new Date(p.end).getTime() - t);
    if (d <= 20 * 864e5 && (!best || d < best.d)) best = { d, val: p.val };
  }
  return best ? best.val : null;
}

const div = (a, b) => (a === null || b === null || b === 0 || a === undefined || b === undefined ? null : a / b);
const sum = (...xs) => (xs.some((x) => x === null || x === undefined) ? null : xs.reduce((s, x) => s + x, 0));
const orZero = (x) => (x === null || x === undefined ? 0 : x);

// One row per fiscal year with the inputs every ratio below needs.
function fiscalYears(f) {
  const ends = annual(f.revenue).map((p) => p.end);
  if (!ends.length) annual(f.netIncome).forEach((p) => ends.push(p.end));
  return ends.map((end) => {
    const revenue = at(annual(f.revenue), end);
    const costOfRevenue = at(annual(f.costOfRevenue), end);
    const gross = at(annual(f.grossProfit), end) ?? (revenue !== null && costOfRevenue !== null ? revenue - costOfRevenue : null);
    const ocf = at(annual(f.operatingCashFlow), end);
    const capex = at(annual(f.capex), end);
    const debt = sum(orZero(at(f.longTermDebt, end)), orZero(at(f.shortTermDebt, end)));
    return {
      end,
      revenue,
      costOfRevenue,
      grossProfit: gross,
      operatingIncome: at(annual(f.operatingIncome), end),
      netIncome: at(annual(f.netIncome), end),
      eps: at(annual(f.eps), end),
      sga: at(annual(f.sga), end),
      depreciation: at(annual(f.depreciation), end),
      interestExpense: at(annual(f.interestExpense), end),
      incomeTax: at(annual(f.incomeTax), end),
      preTaxIncome: at(annual(f.preTaxIncome), end),
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: ocf !== null ? ocf - orZero(capex) : null,
      dividendsPaid: at(annual(f.dividendsPaid), end),
      buybacks: at(annual(f.buybacks), end),
      totalAssets: at(f.totalAssets, end),
      totalLiabilities: at(f.totalLiabilities, end),
      currentAssets: at(f.currentAssets, end),
      currentLiabilities: at(f.currentLiabilities, end),
      cash: at(f.cash, end),
      longTermDebt: at(f.longTermDebt, end),
      debt,
      equity: at(f.equity, end),
      retainedEarnings: at(f.retainedEarnings, end),
      receivables: at(f.receivables, end),
      ppe: at(f.ppe, end),
      dilutedShares: at(annual(f.dilutedShares), end),
    };
  });
}

function ratios(y) {
  const taxRate = y.preTaxIncome && y.incomeTax !== null ? Math.min(Math.max(y.incomeTax / y.preTaxIncome, 0), 0.4) : 0.21;
  const investedCapital = y.equity !== null ? orZero(y.debt) + y.equity - orZero(y.cash) : null;
  return {
    end: y.end,
    revenue: y.revenue,
    grossMargin: div(y.grossProfit, y.revenue),
    operatingMargin: div(y.operatingIncome, y.revenue),
    netMargin: div(y.netIncome, y.revenue),
    fcf: y.freeCashFlow,
    fcfMargin: div(y.freeCashFlow, y.revenue),
    roe: div(y.netIncome, y.equity),
    roic: y.operatingIncome !== null && investedCapital > 0 ? (y.operatingIncome * (1 - taxRate)) / investedCapital : null,
    netDebt: y.debt !== null && y.cash !== null ? y.debt - y.cash : null,
    netDebtToEbitda: y.operatingIncome !== null ? div(y.debt !== null && y.cash !== null ? y.debt - y.cash : null, y.operatingIncome + orZero(y.depreciation)) : null,
    currentRatio: div(y.currentAssets, y.currentLiabilities),
    interestCoverage: div(y.operatingIncome, y.interestExpense),
    dilutedShares: y.dilutedShares,
    shareholderYield: null, // filled in with market cap
    dividendsPaid: y.dividendsPaid,
    buybacks: y.buybacks,
  };
}

// Piotroski F-score (2000): nine binary tests of profitability, leverage/liquidity and
// operating efficiency, comparing the latest fiscal year (t) with the prior (p).
function piotroski(t, p) {
  if (!t || !p) return null;
  // Year-end assets for both years so the two ROAs are comparable.
  const roaT = div(t.netIncome, t.totalAssets), roaP = div(p.netIncome, p.totalAssets);
  const levT = div(t.longTermDebt ?? 0, t.totalAssets), levP = div(p.longTermDebt ?? 0, p.totalAssets);
  const crT = div(t.currentAssets, t.currentLiabilities), crP = div(p.currentAssets, p.currentLiabilities);
  const gmT = div(t.grossProfit, t.revenue), gmP = div(p.grossProfit, p.revenue);
  const atT = div(t.revenue, t.totalAssets), atP = div(p.revenue, p.totalAssets);
  const test = (name, ok, detail) => ({ name, pass: ok === null ? null : !!ok, detail });
  const tests = [
    test("Positive net income (ROA > 0)", roaT === null ? null : roaT > 0),
    test("Positive operating cash flow", t.operatingCashFlow === null ? null : t.operatingCashFlow > 0),
    test("ROA improved year over year", roaT === null || roaP === null ? null : roaT > roaP),
    test("Cash flow exceeds net income (earnings quality)", t.operatingCashFlow === null || t.netIncome === null ? null : t.operatingCashFlow > t.netIncome),
    test("Long-term debt / assets fell", levT === null || levP === null ? null : levT <= levP),
    test("Current ratio improved", crT === null || crP === null ? null : crT > crP),
    test("No new shares issued", t.dilutedShares === null || p.dilutedShares === null ? null : t.dilutedShares <= p.dilutedShares * 1.005),
    test("Gross margin improved", gmT === null || gmP === null ? null : gmT > gmP),
    test("Asset turnover improved", atT === null || atP === null ? null : atT > atP),
  ];
  const scored = tests.filter((x) => x.pass !== null);
  const score = scored.filter((x) => x.pass).length;
  return {
    score,
    outOf: scored.length,
    tests,
    verdict: scored.length < 7 ? "Incomplete data" : score >= 7 ? "Strong" : score >= 4 ? "Average" : "Weak",
  };
}

// Altman Z-score (1968, public manufacturers). Not meaningful for banks/insurers.
function altman(t, marketCap) {
  if (!t || !t.totalAssets || !t.totalLiabilities) return null;
  const wc = t.currentAssets !== null && t.currentLiabilities !== null ? t.currentAssets - t.currentLiabilities : null;
  const parts = {
    workingCapital: div(wc, t.totalAssets),
    retainedEarnings: div(t.retainedEarnings, t.totalAssets),
    ebit: div(t.operatingIncome, t.totalAssets),
    marketToLiabilities: div(marketCap, t.totalLiabilities),
    salesToAssets: div(t.revenue, t.totalAssets),
  };
  if (Object.values(parts).some((v) => v === null)) return { z: null, parts, zone: "Incomplete data" };
  const z = 1.2 * parts.workingCapital + 1.4 * parts.retainedEarnings + 3.3 * parts.ebit + 0.6 * parts.marketToLiabilities + 1.0 * parts.salesToAssets;
  return { z, parts, zone: z > 2.99 ? "Safe" : z >= 1.81 ? "Grey zone" : "Distress" };
}

// Beneish M-score (1999): eight indices that flag earnings manipulation. Missing inputs
// default to the neutral value 1 (0 for TATA) and are reported so readers can discount it.
function beneish(t, p) {
  if (!t || !p) return null;
  const missing = [];
  const idx = (name, v, neutral = 1) => {
    if (v === null || !Number.isFinite(v)) { missing.push(name); return neutral; }
    return v;
  };
  const DSRI = idx("DSRI", div(div(t.receivables, t.revenue), div(p.receivables, p.revenue)));
  const GMI = idx("GMI", div(div(p.grossProfit, p.revenue), div(t.grossProfit, t.revenue)));
  const aq = (y) => (y.currentAssets !== null && y.ppe !== null && y.totalAssets ? 1 - (y.currentAssets + y.ppe) / y.totalAssets : null);
  const AQI = idx("AQI", div(aq(t), aq(p)));
  const SGI = idx("SGI", div(t.revenue, p.revenue));
  const dep = (y) => (y.depreciation !== null && y.ppe !== null ? y.depreciation / (y.depreciation + y.ppe) : null);
  const DEPI = idx("DEPI", div(dep(p), dep(t)));
  const SGAI = idx("SGAI", div(div(t.sga, t.revenue), div(p.sga, p.revenue)));
  const LVGI = idx("LVGI", div(div(t.totalLiabilities, t.totalAssets), div(p.totalLiabilities, p.totalAssets)));
  const TATA = idx("TATA", t.netIncome !== null && t.operatingCashFlow !== null ? div(t.netIncome - t.operatingCashFlow, t.totalAssets) : null, 0);
  const m = -4.84 + 0.92 * DSRI + 0.528 * GMI + 0.404 * AQI + 0.892 * SGI + 0.115 * DEPI - 0.172 * SGAI + 4.679 * TATA - 0.327 * LVGI;
  return {
    m,
    indices: { DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA },
    missing,
    verdict: missing.length > 3 ? "Incomplete data" : m > -1.78 ? "Possible manipulation flag" : "No red flag",
  };
}

// Inputs for the DCF workbench: trailing FCF, growth history, balance sheet, share count.
function dcfInputs(years, f) {
  const last = years.at(-1);
  if (!last) return null;
  const fcfs = years.map((y) => y.freeCashFlow).filter((v) => v !== null);
  const revs = years.map((y) => y.revenue).filter((v) => v !== null);
  const cagr = (arr) => (arr.length >= 3 && arr[0] > 0 && arr.at(-1) > 0 ? Math.pow(arr.at(-1) / arr[0], 1 / (arr.length - 1)) - 1 : null);
  const shares = f.sharesOutstanding?.at(-1)?.val ?? last.dilutedShares;
  return {
    fcf: last.freeCashFlow,
    fcfAvg3: fcfs.length >= 3 ? fcfs.slice(-3).reduce((s, v) => s + v, 0) / 3 : null,
    revenueCagr: cagr(revs.slice(-5)),
    fcfCagr: cagr(fcfs.slice(-5)),
    cash: last.cash,
    debt: last.debt,
    shares,
    fiscalYearEnd: last.end,
  };
}

function analyze(facts, { marketCap = null } = {}) {
  if (!facts) return null;
  const years = fiscalYears(facts);
  const r = years.map(ratios);
  const t = years.at(-1), p = years.at(-2);
  if (marketCap && r.length) {
    const lr = r.at(-1);
    lr.shareholderYield = div(orZero(lr.dividendsPaid) + orZero(lr.buybacks), marketCap);
  }
  const q = (name) => quarterly(facts[name]).slice(-8);
  return {
    companyName: facts.companyName,
    annual: r,
    quarterly: { revenue: q("revenue"), netIncome: q("netIncome"), eps: q("eps"), operatingIncome: q("operatingIncome") },
    shares: annual(facts.dilutedShares).slice(-6),
    piotroski: piotroski(t, p),
    altman: altman(t, marketCap),
    beneish: beneish(t, p),
    dcf: dcfInputs(years, facts),
  };
}

module.exports = { analyze, fiscalYears, piotroski, altman, beneish };
