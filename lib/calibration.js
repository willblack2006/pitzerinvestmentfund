// Calibration & decision journal: pure scoring over pitch predictions and outcomes. "p" is
// a 0-1 stated confidence; "outcome" is 1 if the base-case target was hit by the horizon, 0
// if not. The price-series lookup that produces `outcome` lives in the route (I/O); this
// file only does the statistics, so it's testable without any network calls.

// Did price cross the target by the horizon date? Returns true/false, or null if the horizon
// hasn't been reached yet in the series we have (a "pending" call, not a known outcome).
function didHitTarget({ direction, basePrice, series, horizonDate }) {
  if (!basePrice || !series?.length) return null;
  const upward = direction === "buy" || direction === "add";
  const inWindow = horizonDate ? series.filter((p) => p.date <= horizonDate) : series;
  if (!inWindow.length) return null;
  if (horizonDate && inWindow.at(-1).date < horizonDate) return null; // not there yet
  return upward ? inWindow.some((p) => p.close >= basePrice) : inWindow.some((p) => p.close <= basePrice);
}

// Mean squared error between stated confidence and the 0/1 outcome — lower is better
// calibrated (0 = perfect, 0.25 = no better than a coin flip stated with 50% confidence
// every time, 1 = maximally wrong).
function brierScore(items) {
  if (!items.length) return null;
  return items.reduce((s, x) => s + (x.p - x.outcome) ** 2, 0) / items.length;
}

function hitRate(items) {
  if (!items.length) return null;
  return items.filter((x) => x.outcome).length / items.length;
}

// Buckets by stated confidence (default quintiles) for a calibration chart: predicted vs
// actual hit rate per bucket. Well-calibrated 70%-confidence calls should hit ~70% of the time.
function calibrationBuckets(items, bucketSize = 0.2) {
  const buckets = [];
  for (let lo = 0; lo < 1; lo += bucketSize) {
    const hi = lo + bucketSize;
    const inBucket = items.filter((x) => x.p >= lo && (x.p < hi || hi >= 1 - 1e-9));
    if (!inBucket.length) continue;
    buckets.push({
      lo, hi,
      avgPredicted: inBucket.reduce((s, x) => s + x.p, 0) / inBucket.length,
      actualHitRate: hitRate(inBucket),
      n: inBucket.length,
    });
  }
  return buckets;
}

// Group items by an arbitrary key (analyst, sector, direction) and report n/hitRate/brier per group.
function groupStats(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const out = {};
  for (const [key, group] of groups) out[key] = { n: group.length, hitRate: hitRate(group), brier: brierScore(group) };
  return out;
}

module.exports = { didHitTarget, brierScore, hitRate, calibrationBuckets, groupStats };
