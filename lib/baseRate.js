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

// One entry per company: share classes (GOOG/GOOGL) and the target itself under another
// ticker would otherwise count the same business twice. Matches on normalized company name.
function dedupeCompanies(profiles, target) {
  const { normalizeName } = require("./thirteenF");
  const seen = new Set(target?.name ? [normalizeName(target.name)] : []);
  return profiles.filter((p) => {
    const key = p.name ? normalizeName(p.name) : p.symbol;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Counts of returns in fixed-width bins, for a histogram. The ends are open-ended buckets so a
// few extreme windows don't stretch the axis.
function histogram(returns, { width = 0.1, min = -0.6, max = 1.0 } = {}) {
  const bins = [];
  for (let lo = min; lo < max - 1e-9; lo += width) bins.push({ lo, hi: lo + width, n: 0 });
  for (const r of returns) {
    const i = r < min ? 0 : r >= max ? bins.length - 1 : Math.floor((r - min) / width + 1e-9);
    bins[Math.min(bins.length - 1, Math.max(0, i))].n++;
  }
  bins[0].openLow = true;
  bins[bins.length - 1].openHigh = true;
  return bins;
}

module.exports = { dedupeCompanies, histogram, sizeBucket, valuationBucket, matchesBucket, oneYearForwardReturns, distributionStats };
