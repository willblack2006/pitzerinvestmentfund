// Factor scorecard: value, momentum, quality, low-volatility, size — each a 0-100 percentile
// rank within a universe (the fund's holdings + watchlist, since a full S&P 500/100 universe
// is too costly to fetch on every request). Pure percentile/aggregation math; the route does
// the data gathering (price history, fundamentals, Yahoo stats) per symbol.

// 0-100 percentile rank of each value within the array (ties share the average rank);
// non-finite values rank as null rather than being dropped from the array shape.
function percentileRank(values) {
  const indexed = values.map((v, i) => ({ v, i })).filter((x) => Number.isFinite(x.v));
  indexed.sort((a, b) => a.v - b.v);
  const n = indexed.length;
  const out = new Array(values.length).fill(null);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2;
    const pct = n > 1 ? (avgRank / (n - 1)) * 100 : 50;
    for (let k = i; k <= j; k++) out[indexed[k].i] = pct;
    i = j + 1;
  }
  return out;
}

const avg = (values) => {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : null;
};

// `rows`: [{ symbol, earningsYield, fcfYield, bookYield, momentum, roe, grossProfitability,
//   piotroskiRatio, accruals, volatility, beta, marketCap }] — any field may be null/missing.
function scoreFactors(rows) {
  const col = (key, invert = false) => percentileRank(rows.map((r) => (invert && Number.isFinite(r[key]) ? -r[key] : r[key] ?? null)));
  const value = ["earningsYield", "fcfYield", "bookYield"].map((k) => col(k));
  const momentum = col("momentum");
  const quality = [col("roe"), col("grossProfitability"), col("piotroskiRatio"), col("accruals", true)];
  const lowVol = [col("volatility", true), col("beta", true)];
  const size = col("marketCap");

  return rows.map((r, i) => ({
    symbol: r.symbol,
    value: avg(value.map((c) => c[i])),
    momentum: momentum[i],
    quality: avg(quality.map((c) => c[i])),
    lowVol: avg(lowVol.map((c) => c[i])),
    size: size[i],
  }));
}

// Fund's aggregate tilt per factor vs neutral (50), weighted by `weights[symbol]` (market
// value) when given, else averaged unweighted.
function aggregateTilt(scored, weights = {}) {
  const factors = ["value", "momentum", "quality", "lowVol", "size"];
  const out = {};
  for (const f of factors) {
    let wsum = 0, total = 0;
    for (const r of scored) {
      if (!Number.isFinite(r[f])) continue;
      const w = weights[r.symbol] ?? 1;
      total += r[f] * w;
      wsum += w;
    }
    out[f] = wsum ? total / wsum : null;
  }
  return out;
}

module.exports = { percentileRank, scoreFactors, aggregateTilt };
