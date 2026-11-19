// EPS estimate at 90, 60, 30 and 7 days ago and now, as % change from the 90-day-ago value.
// A period with a missing or non-positive starting estimate is skipped (a % change from a
// loss or zero means nothing).
const PERIOD = { "0q": "This quarter", "+1q": "Next quarter", "0y": "This fiscal year", "+1y": "Next fiscal year" };

export function revisionPath(estimates) {
  const out = [];
  for (const e of estimates || []) {
    const t = e.epsTrend;
    if (!t || !(t.d90 > 0)) continue;
    const pts = [t.d90, t.d60, t.d30, t.d7, t.current];
    if (pts.some((v) => !Number.isFinite(v))) continue;
    out.push({ period: e.period, label: PERIOD[e.period] || e.period, values: pts.map((v) => (v / t.d90 - 1) * 100) });
  }
  return out.length ? out : null;
}

