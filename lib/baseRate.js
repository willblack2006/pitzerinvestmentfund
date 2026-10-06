// Base-rate panel: historical distribution of 1-year forward returns for stocks similar to a
// given one (same sector, size bucket and valuation bucket), pooled from cached price
// history. Mainly for calibration — "what actually happens to stocks like this one" — not a
// prediction for this specific stock.

function sizeBucket(marketCap) {
  if (!Number.isFinite(marketCap)) return null;
  if (marketCap >= 200e9) return "mega";
  if (marketCap >= 10e9) return "large";
  if (marketCap >= 2e9) return "mid";
  return "small";
}

// Earnings yield (1/P/E) as a crude value/growth split — positive and high = cheap ("value").
function valuationBucket(earningsYield) {
  if (!Number.isFinite(earningsYield)) return null;
  if (earningsYield >= 0.08) return "value";
  if (earningsYield >= 0.03) return "blend";
  return "growth";
}

function matchesBucket(candidate, target) {
  if (!candidate.sector || candidate.sector !== target.sector) return false;
  if (!candidate.sizeBucket || candidate.sizeBucket !== target.sizeBucket) return false;
  // Valuation bucket is a softer match: fall back to sector+size only if either is unknown.
  if (target.valuationBucket && candidate.valuationBucket && candidate.valuationBucket !== target.valuationBucket) return false;
  return true;
}

// Every overlapping 1-year (252 trading day) forward return in a daily close series.
function oneYearForwardReturns(series) {
  const closes = series.map((p) => p.close);
  const out = [];
  for (let i = 0; i + 252 < closes.length; i++) out.push(closes[i + 252] / closes[i] - 1);
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function distributionStats(returns) {
  if (!returns.length) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  return {
    n: returns.length,
    mean: returns.reduce((s, r) => s + r, 0) / returns.length,
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    pctPositive: returns.filter((r) => r > 0).length / returns.length,
  };
}

module.exports = { sizeBucket, valuationBucket, matchesBucket, oneYearForwardReturns, distributionStats };
