const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const fundamentals = require("../lib/fundamentals");
const analytics = require("../lib/analytics");
const { scoreFactors, aggregateTilt } = require("../lib/factors");

const router = express.Router();

const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);

async function rawFactorsFor(symbol, benchSeries) {
  const [qsR, factsR, chartR] = await Promise.allSettled([
    yahoo.getQuoteSummary(symbol),
    sec.getCompanyFacts(symbol),
    yahoo.getChart(symbol, "1y", "1d"),
  ]);
  const qs = qsR.status === "fulfilled" ? qsR.value : null;
  const facts = factsR.status === "fulfilled" ? factsR.value : null;
  const chart = chartR.status === "fulfilled" ? chartR.value : [];

  const sd = qs?.summaryDetail || {}, ks = qs?.defaultKeyStatistics || {}, fd = qs?.financialData || {};
  const marketCap = raw(sd.marketCap) ?? raw(qs?.price?.marketCap);
  const trailingPE = raw(sd.trailingPE), forwardPE = raw(ks.forwardPE);
  const earningsYield = trailingPE > 0 ? 1 / trailingPE : (forwardPE > 0 ? 1 / forwardPE : null);
  const freeCashflow = raw(fd.freeCashflow);
  const fcfYield = marketCap && Number.isFinite(freeCashflow) ? freeCashflow / marketCap : null;
  const priceToBook = raw(ks.priceToBook);
  const bookYield = priceToBook > 0 ? 1 / priceToBook : null;

  const closes = chart.map((p) => p.close);
  // 12-1 month momentum: skip the most recent ~month (reversal effect) and look back ~1 year.
  const momentum = closes.length >= 40 ? closes.at(-22) / closes[0] - 1 : null;
  let volatility = null, beta = null;
  if (chart.length >= 30 && benchSeries?.length >= 30) {
    const rp = analytics.riskProfile(chart, benchSeries);
    if (rp) { volatility = rp.volatility; beta = rp.beta; }
  }

  let roe = null, grossProfitability = null, piotroskiRatio = null, accruals = null;
  if (facts) {
    const years = fundamentals.fiscalYears(facts);
    const t = years.at(-1), p = years.at(-2);
    if (t) {
      roe = t.equity ? t.netIncome / t.equity : null;
      grossProfitability = t.totalAssets ? t.grossProfit / t.totalAssets : null;
      accruals = t.totalAssets && t.operatingCashFlow !== null && t.netIncome !== null ? (t.netIncome - t.operatingCashFlow) / t.totalAssets : null;
    }
    const pio = fundamentals.piotroski(t, p);
    piotroskiRatio = pio ? pio.score / pio.outOf : null;
  }

  return { symbol, earningsYield, fcfYield, bookYield, momentum, roe, grossProfitability, piotroskiRatio, accruals, volatility, beta, marketCap };
}

function universeSymbols(scope) {
  const positions = db.prepare("SELECT symbol, marketValue FROM positions").all();
  const owned = positions.map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...(scope !== "watchlist" ? owned : []), ...(scope !== "holdings" ? watched : [])])];
  return { symbols, owned, positions };
}

// Factor scorecard across holdings and/or the watchlist (the universe; a full S&P 500/100
// universe is too costly to fetch on every request).
router.get("/factors", async (req, res) => {
  const scope = ["holdings", "watchlist", "all"].includes(req.query.scope) ? req.query.scope : "all";
  const { symbols, owned, positions } = universeSymbols(scope);
  if (!symbols.length) return res.json({ scope, rows: [], tilt: null });

  let benchSeries = [];
  try { benchSeries = await yahoo.getChart("SPY", "1y", "1d"); } catch { /* best effort */ }

  const rawRows = await Promise.all(symbols.map((s) => rawFactorsFor(s, benchSeries)));
  const scored = scoreFactors(rawRows);
  const weights = Object.fromEntries(positions.map((p) => [p.symbol, p.marketValue]));
  const tilt = aggregateTilt(scored.filter((r) => owned.includes(r.symbol)), weights);
  const bySymbol = Object.fromEntries(scored.map((r) => [r.symbol, r]));
  res.json({ scope, rows: symbols.map((s) => ({ ...bySymbol[s], owned: owned.includes(s) })), tilt });
});

// One symbol's percentile profile, ranked within the fund's holdings + watchlist universe
// (plus the symbol itself, if it's neither).
router.get("/factors/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const { symbols } = universeSymbols("all");
  const universe = [...new Set([...symbols, symbol])];
  let benchSeries = [];
  try { benchSeries = await yahoo.getChart("SPY", "1y", "1d"); } catch { /* best effort */ }
  const rawRows = await Promise.all(universe.map((s) => rawFactorsFor(s, benchSeries)));
  const scored = scoreFactors(rawRows);
  res.json(scored.find((r) => r.symbol === symbol) || { symbol, error: "No data" });
});

module.exports = router;
