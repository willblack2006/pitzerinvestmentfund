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

// Rolling beta and correlation of daily returns over a trailing `window` of trading days, so
// you can see whether a stock has started moving more (or less) with the market. Running sums
// keep it O(n). Returns { dates, beta, correlation } (one point per window end) or null.
function rollingStats(asset, bench, window = 126) {
  const { dates, values } = align({ asset, bench });
  const ra = returns(values.asset), rb = returns(values.bench);
  const n = ra.length;
  if (n < window || window < 10) return null;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const out = { dates: [], beta: [], correlation: [] };
  for (let i = 0; i < n; i++) {
    sa += ra[i]; sb += rb[i]; saa += ra[i] * ra[i]; sbb += rb[i] * rb[i]; sab += ra[i] * rb[i];
    if (i >= window) {
      const j = i - window;
      sa -= ra[j]; sb -= rb[j]; saa -= ra[j] * ra[j]; sbb -= rb[j] * rb[j]; sab -= ra[j] * rb[j];
    }
    if (i < window - 1) continue;
    const cov = (sab - (sa * sb) / window) / (window - 1);
    const va = (saa - (sa * sa) / window) / (window - 1);
    const vb = (sbb - (sb * sb) / window) / (window - 1);
    out.dates.push(dates[i + 1]); // return i is the move into dates[i + 1]
    out.beta.push(vb > 0 ? cov / vb : null);
    out.correlation.push(va > 0 && vb > 0 ? Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb))) : null);
  }
  return out;
}

// Plain-language read of a rolling series: has correlation with the benchmark risen or fallen
// over the past year? Changes under `band` count as "about the same".
function correlationTrend(rolling, benchName = "the market", { lookback = 252, band = 0.1 } = {}) {
  if (!rolling?.dates?.length) return null;
  const last = rolling.dates.length - 1;
  const from = Math.max(0, last - lookback);
  const corrNow = rolling.correlation[last], corrThen = rolling.correlation[from];
  const betaNow = rolling.beta[last], betaThen = rolling.beta[from];
  if (![corrNow, corrThen].every(Number.isFinite) || from === last) return null;
  const change = corrNow - corrThen;
  const direction = change >= band ? "up" : change <= -band ? "down" : "flat";
  const span = last - from >= 240 ? "over the past year" : `since ${rolling.dates[from]}`;
  const f = (v) => v.toFixed(2);
  const text = direction === "up"
    ? `Correlation with ${benchName} rose from ${f(corrThen)} to ${f(corrNow)} ${span}: it moves more in step with ${benchName} now, so it diversifies the fund less.`
    : direction === "down"
      ? `Correlation with ${benchName} fell from ${f(corrThen)} to ${f(corrNow)} ${span}: it moves less in step with ${benchName} now, so it diversifies the fund more.`
      : `Correlation with ${benchName} is about the same as a year ago (${f(corrThen)} then, ${f(corrNow)} now).`;
  return { corrNow, corrThen, betaNow, betaThen, change, direction, thenDate: rolling.dates[from], text };
}

module.exports = { rollingStats, correlationTrend, SECTOR_ETF, SECTOR_KEY, align, returns, stdev, riskProfile, maxDrawdown, sma, correlationMatrix };
