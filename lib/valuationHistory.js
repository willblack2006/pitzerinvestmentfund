// How expensive a stock is against its own past: price divided by the trailing-twelve-month
// EPS that was public at the time (a quarter's EPS counts from ~40 days after it ended, when
// the 10-Q or 10-K is filed). Pure functions; the route feeds them SEC EPS and Yahoo prices.
const DAY = 864e5;
const FILING_LAG_DAYS = 40;
const MAX_PE = 150; // above this the ratio is mostly noise from near-zero earnings

// [{end, eps}] where eps = sum of four consecutive single quarters spanning about a year.
function ttmEpsSeries(epsQuarters = []) {
  const q = epsQuarters.filter((p) => p.form === "10-Q" && Number.isFinite(p.val));
  const out = [];
  for (let i = 3; i < q.length; i++) {
    const span = (new Date(q[i].end) - new Date(q[i - 3].end)) / DAY;
    if (span < 240 || span > 300) continue;
    out.push({ end: q[i].end, eps: q[i].val + q[i - 1].val + q[i - 2].val + q[i - 3].val });
  }
  return out;
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function peHistory(epsQuarters, bars) {
  const series = ttmEpsSeries(epsQuarters);
  if (!series.length || !bars?.length) return null;
  const points = [];
  for (const b of bars) {
    if (!Number.isFinite(b.close)) continue;
    const t = new Date(b.date).getTime();
    let known = null;
    for (const s of series) if (new Date(s.end).getTime() + FILING_LAG_DAYS * DAY <= t) known = s;
    if (!known) continue;
    points.push({ date: b.date, price: b.close, eps: known.eps, pe: known.eps > 0 && b.close / known.eps <= MAX_PE ? b.close / known.eps : null });
  }
  const valid = points.filter((p) => p.pe !== null);
  if (valid.length < 20) return { points, summary: null, series };
  const sorted = valid.map((p) => p.pe).sort((a, b) => a - b);
  const current = points.at(-1).pe;
  const summary = {
    from: valid[0].date,
    current,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted.at(-1),
    percentile: current === null ? null : sorted.filter((x) => x <= current).length / sorted.length,
    ttmEps: points.at(-1).eps,
    // Weeks (or months) with negative or unusable earnings aren't in the range.
    coverage: valid.length / points.length,
  };
  return { points, summary, series };
}

module.exports = { ttmEpsSeries, peHistory };
