// Estimate-revision score: combines revision breadth (analysts raising vs cutting EPS
// estimates, 7d and 30d) and EPS-estimate drift (current estimate vs 30/90 days ago) across
// the four periods Yahoo tracks (this quarter, next quarter, this year, next year). Nearer
// periods (0q, 0y) carry more weight than farther ones (+1q, +1y).
const PERIOD_WEIGHT = { "0q": 1, "+1q": 0.7, "0y": 1, "+1y": 0.7 };
const PERIOD_LABEL = { "0q": "This quarter's", "+1q": "Next quarter's", "0y": "This year's", "+1y": "Next year's" };

function driftPct(trend) {
  if (!trend || !Number.isFinite(trend.current)) return null;
  const base = Number.isFinite(trend.d30) && trend.d30 !== 0 ? trend.d30 : trend.d90;
  if (!Number.isFinite(base) || base === 0) return null;
  return trend.current / base - 1;
}

// -1 (all downward) .. +1 (all upward); 7-day revisions count at half weight of 30-day ones.
function breadthScore(rev) {
  if (!rev) return null;
  const up = (rev.up30 ?? 0) + (rev.up7 ?? 0) * 0.5;
  const down = (rev.down30 ?? 0) + (rev.down7 ?? 0) * 0.5;
  const total = up + down;
  return total ? (up - down) / total : 0;
}

function scoreEstimateRevisions(estimates = []) {
  let weighted = 0, weightTotal = 0;
  const byPeriod = [];
  for (const e of estimates) {
    const w = PERIOD_WEIGHT[e.period];
    if (!w) continue;
    const drift = driftPct(e.epsTrend);
    const breadth = breadthScore(e.revisions);
    const driftComponent = drift === null ? null : Math.max(-1, Math.min(1, drift / 0.2)) * 40;
    const breadthComponent = breadth === null ? null : breadth * 60;
    const parts = [driftComponent, breadthComponent].filter((x) => x !== null);
    if (!parts.length) continue;
    const periodScore = parts.reduce((s, x) => s + x, 0) / parts.length;
    weighted += periodScore * w;
    weightTotal += w;
    byPeriod.push({ period: e.period, drift, breadth, score: Math.round(periodScore) });
  }
  const score = weightTotal ? Math.max(-100, Math.min(100, Math.round(weighted / weightTotal))) : 0;

  const reasons = [];
  for (const p of byPeriod) {
    if (p.drift !== null && Math.abs(p.drift) >= 0.02) reasons.push(`${PERIOD_LABEL[p.period]} EPS estimate is ${p.drift > 0 ? "up" : "down"} ${(Math.abs(p.drift) * 100).toFixed(1)}% vs 30 days ago.`);
    if (p.breadth !== null && Math.abs(p.breadth) >= 0.3) reasons.push(`${PERIOD_LABEL[p.period]} revisions skew ${p.breadth > 0 ? "upward" : "downward"}.`);
  }
  if (!reasons.length) reasons.push("No meaningful estimate revisions recently.");

  const label = score >= 40 ? "Estimates rising" : score >= 15 ? "Estimates drifting up" : score <= -40 ? "Estimates falling" : score <= -15 ? "Estimates drifting down" : "Estimates stable";
  return { score, label, reasons, byPeriod };
}

module.exports = { scoreEstimateRevisions, driftPct, breadthScore };
