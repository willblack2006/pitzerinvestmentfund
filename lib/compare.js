// Compare view math (WS10). Pure functions; routes/compare.js feeds them Yahoo data.

const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : Number.isFinite(v) ? v : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// Each ticker's closes rebased to 100 on the first date all of them traded, on the dates they
// share (so a line never starts later than another and looks like it outran it).
function compareSeries(list) {
  const withData = list.filter((x) => x.bars?.length);
  if (!withData.length) return list.map((x) => ({ symbol: x.symbol, points: [], change: null, maxDrawdown: null, vol: null }));
  const start = withData.map((x) => x.bars.find((b) => Number.isFinite(b.close))?.date).filter(Boolean).sort().at(-1);
  return list.map((x) => {
    const bars = (x.bars || []).filter((b) => Number.isFinite(b.close) && b.date >= start);
    if (!bars.length) return { symbol: x.symbol, points: [], change: null, maxDrawdown: null, vol: null };
    const base = bars[0].close;
    const points = bars.map((b) => ({ date: b.date, value: r2((b.close / base) * 100) }));
    let peak = -Infinity, mdd = 0;
    for (const b of bars) { peak = Math.max(peak, b.close); mdd = Math.min(mdd, b.close / peak - 1); }
    const rets = [];
    for (let i = 1; i < bars.length; i++) rets.push(Math.log(bars[i].close / bars[i - 1].close));
    const mean = rets.reduce((s, v) => s + v, 0) / Math.max(1, rets.length);
    const sd = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    // Weekly bars (5Y) annualise with 52, daily with 252.
    const span = bars.length > 1 ? (new Date(bars.at(-1).date) - new Date(bars[0].date)) / 864e5 / (bars.length - 1) : 1;
    const perYear = span > 4 ? 52 : 252;
    return { symbol: x.symbol, from: start, points, change: r2((bars.at(-1).close / base - 1) * 100), maxDrawdown: r2(mdd * 100), vol: r2(sd * Math.sqrt(perYear) * 100) };
  });
}

// Key metrics in display units (percent as %, multiples as ×). `null` when Yahoo has none.
function compareMetrics(symbol, qs, quote, s) {
  const sd = qs?.summaryDetail || {}, ks = qs?.defaultKeyStatistics || {}, fd = qs?.financialData || {};
  const pct = (v) => (raw(v) === null ? null : r2(raw(v) * 100));
  const mult = (v) => { const x = raw(v); return x !== null && x > 0 && x < 1000 ? r2(x) : null; };
  return {
    symbol,
    name: qs?.price?.shortName || qs?.price?.longName || null,
    sector: qs?.assetProfile?.sector || null,
    price: quote?.price ?? raw(fd.currentPrice) ?? null,
    marketCap: raw(sd.marketCap) ?? raw(qs?.price?.marketCap),
    pe: mult(sd.trailingPE), forwardPe: mult(ks.forwardPE) ?? mult(sd.forwardPE), evEbitda: mult(ks.enterpriseToEbitda), evRevenue: mult(ks.enterpriseToRevenue),
    revenueGrowth: pct(fd.revenueGrowth), earningsGrowth: pct(fd.earningsGrowth),
    grossMargin: pct(fd.grossMargins), operatingMargin: pct(fd.operatingMargins), profitMargin: pct(fd.profitMargins),
    roe: pct(fd.returnOnEquity), debtToEquity: raw(fd.debtToEquity) === null ? null : r2(raw(fd.debtToEquity) / 100),
    beta: raw(ks.beta) === null ? null : r2(raw(ks.beta)), dividendYield: pct(sd.dividendYield),
    targetUpside: raw(fd.targetMeanPrice) && (quote?.price ?? raw(fd.currentPrice)) ? r2((raw(fd.targetMeanPrice) / (quote?.price ?? raw(fd.currentPrice)) - 1) * 100) : null,
    change: s?.change ?? null, maxDrawdown: s?.maxDrawdown ?? null, vol: s?.vol ?? null,
  };
}

module.exports = { compareSeries, compareMetrics };
