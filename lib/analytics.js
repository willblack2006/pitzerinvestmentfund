// Price-series risk/return math. Inputs are arrays of { date, close } (Yahoo chart format).

// SPDR sector ETFs, keyed by Yahoo's sector names, for "vs its sector" comparisons.
const SECTOR_ETF = {
  Technology: "XLK",
  "Communication Services": "XLC",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  "Financial Services": "XLF",
  Healthcare: "XLV",
  Industrials: "XLI",
  Energy: "XLE",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Basic Materials": "XLB",
};

// Yahoo's SPY sector-weight keys -> the display names used by assetProfile.sector.
const SECTOR_KEY = {
  technology: "Technology",
  communication_services: "Communication Services",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  financial_services: "Financial Services",
  healthcare: "Healthcare",
  industrials: "Industrials",
  energy: "Energy",
  utilities: "Utilities",
  realestate: "Real Estate",
  basic_materials: "Basic Materials",
};

// Align several series on common dates.
function align(seriesMap) {
  const keys = Object.keys(seriesMap);
  const maps = keys.map((k) => new Map(seriesMap[k].map((p) => [p.date, p.close])));
  const dates = seriesMap[keys[0]].map((p) => p.date).filter((d) => maps.every((m) => m.has(d)));
  return { dates, values: Object.fromEntries(keys.map((k, i) => [k, dates.map((d) => maps[i].get(d))])) };
}

const returns = (closes) => closes.slice(1).map((c, i) => c / closes[i] - 1);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
function stdev(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function covariance(a, b) {
  const ma = mean(a), mb = mean(b);
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1);
}

function maxDrawdown(closes) {
  let peak = closes[0], worst = 0, peakIdx = 0, troughIdx = 0, bestPeakIdx = 0;
  closes.forEach((c, i) => {
    if (c > peak) { peak = c; peakIdx = i; }
    const dd = c / peak - 1;
    if (dd < worst) { worst = dd; troughIdx = i; bestPeakIdx = peakIdx; }
  });
  return { drawdown: worst, peakIndex: bestPeakIdx, troughIndex: troughIdx };
}

// Full risk profile of `asset` vs `bench` (and optional `sector`), annualized from daily data.
function riskProfile(asset, bench, sector = null, riskFreeRate = 0.04) {
  const input = { asset, bench };
  if (sector?.length) input.sector = sector;
  const { dates, values } = align(input);
  if (dates.length < 30) return null;
  const ra = returns(values.asset), rb = returns(values.bench);
  const vol = stdev(ra) * Math.sqrt(252);
  const beta = covariance(ra, rb) / (stdev(rb) ** 2);
  const corr = covariance(ra, rb) / (stdev(ra) * stdev(rb));
  const total = (v) => v.at(-1) / v[0] - 1;
  const years = dates.length / 252;
  const annual = (v) => Math.pow(1 + total(v), 1 / years) - 1;
  const excess = ra.map((r, i) => r - rb[i]);
  const trackingError = stdev(excess) * Math.sqrt(252);
  const dd = maxDrawdown(values.asset);
  const norm = (v) => v.map((x) => (x / v[0]) * 100);
  return {
    start: dates[0],
    end: dates.at(-1),
    totalReturn: total(values.asset),
    benchReturn: total(values.bench),
    sectorReturn: values.sector ? total(values.sector) : null,
    annualizedReturn: annual(values.asset),
    volatility: vol,
    benchVolatility: stdev(rb) * Math.sqrt(252),
    beta,
    correlation: corr,
    sharpe: (annual(values.asset) - riskFreeRate) / vol,
    trackingError,
    informationRatio: (annual(values.asset) - annual(values.bench)) / trackingError,
    maxDrawdown: dd.drawdown,
    drawdownPeak: dates[dd.peakIndex],
    drawdownTrough: dates[dd.troughIndex],
    // Rebased to 100 for an overlay chart.
    series: { dates, asset: norm(values.asset), bench: norm(values.bench), sector: values.sector ? norm(values.sector) : null },
  };
}

// Simple moving average of the last n closes.
function sma(closes, n) {
  if (closes.length < n) return null;
  return mean(closes.slice(-n));
}

// Pairwise correlation matrix of daily returns (aligned on common dates).
function correlationMatrix(seriesMap) {
  const { dates, values } = align(seriesMap);
  if (dates.length < 30) return null;
  const keys = Object.keys(values);
  const rets = Object.fromEntries(keys.map((k) => [k, returns(values[k])]));
  const sd = Object.fromEntries(keys.map((k) => [k, stdev(rets[k])]));
  const matrix = keys.map((a) => keys.map((b) => (a === b ? 1 : covariance(rets[a], rets[b]) / (sd[a] * sd[b]))));
  return { symbols: keys, matrix, start: dates[0], end: dates.at(-1) };
}

module.exports = { SECTOR_ETF, SECTOR_KEY, align, returns, stdev, riskProfile, maxDrawdown, sma, correlationMatrix };
