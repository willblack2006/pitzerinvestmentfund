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
      ci: wilson(inBucket.filter((x) => x.outcome).length, inBucket.length),
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
  for (const [key, group] of groups) out[key] = { n: group.length, hitRate: hitRate(group), brier: brierScore(group), ci: wilson(group.filter((x) => x.outcome).length, group.length) };
  return out;
}

// Wilson score interval for a hit rate (default ~90%). Far better than the plain +/- formula at
// the tiny sample sizes a student fund has: 3 of 4 hits is "somewhere between 34% and 95%".
function wilson(k, n, z = 1.645) {
  if (!n) return null;
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

// Murphy decomposition of the Brier score (BS ~ REL - RES + UNC), binned by stated confidence in
// 10-point steps. reliability = how far stated confidence sits from the real hit rate (lower is
// better); resolution = how well the analyst separates likelier calls from unlikelier ones (higher
// is better; an analyst who always says 60% scores 0); uncertainty = how hard the questions were.
function murphy(items) {
  if (!items.length) return null;
  const N = items.length, base = hitRate(items);
  const bins = new Map();
  for (const x of items) {
    const k = Math.round(x.p * 10);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(x);
  }
  let rel = 0, res = 0;
  for (const g of bins.values()) {
    const pk = g.reduce((s, x) => s + x.p, 0) / g.length, ok = hitRate(g);
    rel += (g.length * (pk - ok) ** 2) / N;
    res += (g.length * (ok - base) ** 2) / N;
  }
  return { reliability: rel, resolution: res, uncertainty: base * (1 - base) };
}

// Direction-adjusted excess return: a sell or trim is right when the stock falls.
const edgeOf = (r) => (r.excessReturn == null ? null : r.direction === "sell" || r.direction === "trim" ? -r.excessReturn : r.excessReturn);

// How much the wins pay compared with what the losses cost, next to the hit rate (pros are often
// right under half the time and still make money). Uses each call's excess return at its horizon.
function payoff(rows) {
  const edges = rows.map(edgeOf).filter((v) => v !== null);
  if (!edges.length) return null;
  const wins = edges.filter((v) => v > 0), losses = edges.filter((v) => v <= 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
  return {
    n: edges.length, beatBenchmark: wins.length / edges.length, avgWin, avgLoss,
    ratio: avgWin !== null && avgLoss !== null && avgLoss < 0 ? avgWin / -avgLoss : null,
    avgEdge: edges.reduce((a, b) => a + b, 0) / edges.length,
  };
}

// Did the committee add value? Compares calls it approved against ones it turned down, on the same
// direction-adjusted excess return. Only meaningful once both groups have a few calls.
function committeeScorecard(rows) {
  const group = (rs) => {
    const e = rs.map(edgeOf).filter((v) => v !== null);
    return { n: rs.length, avgEdge: e.length ? e.reduce((a, b) => a + b, 0) / e.length : null, hitRate: rs.length ? rs.filter((r) => r.outcome).length / rs.length : null };
  };
  return { approved: group(rows.filter((r) => r.status === "approved" || r.status === "executed")), rejected: group(rows.filter((r) => r.status === "rejected")) };
}

// Brier for the earlier half of calls vs the later half (by order given): the St. Thomas-style
// "are we getting better" check. Needs enough calls to mean anything.
function learningCurve(items, minPerHalf = 5) {
  if (items.length < minPerHalf * 2) return null;
  const mid = Math.floor(items.length / 2);
  return { earlier: brierScore(items.slice(0, mid)), later: brierScore(items.slice(mid)), nEarlier: mid, nLater: items.length - mid };
}

module.exports = { didHitTarget, brierScore, hitRate, calibrationBuckets, groupStats, wilson, murphy, payoff, committeeScorecard, learningCurve };
