// Short-pressure "avoid" score for a long-only fund. Crowded shorts (high days-to-cover,
// rising short interest) predict underperformance — Hong, Li, Ni, Scheinkman & Wang (NBER
// w21166) — and a long-only fund can capture the signal just by avoiding/trimming these names,
// without the borrow fees a short-seller would pay (Muravyev, Pearson & Pollet, JFE 2025).
//
// Pure functions over Yahoo's defaultKeyStatistics fields plus a FINRA daily short-volume
// series, so the scoring is unit-testable without any network calls.

const LABELS = [
  [70, "Heavily crowded short"],
  [45, "Crowded short"],
  [20, "Elevated short interest"],
  [-Infinity, "Low short interest"],
];

// Least-squares slope of the short-volume ratio over trading-day index — works fine on a
// short, noisy 20-point series.
function finraTrendSlope(series) {
  const n = series.length;
  if (n < 5) return null;
  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.ratio);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den ? num / den : 0;
}

function scoreShortPressure({ daysToCover, shortPctFloat, shortChangePct, finraSeries = [] } = {}) {
  const reasons = [];
  let score = 0;

  if (Number.isFinite(daysToCover)) {
    score += Math.max(0, Math.min(1, daysToCover / 10)) * 45;
    if (daysToCover >= 3) reasons.push(`${daysToCover.toFixed(1)} days to cover at average volume — the harder it is for shorts to exit without moving the price.`);
  }
  if (Number.isFinite(shortPctFloat)) {
    score += Math.max(0, Math.min(1, shortPctFloat / 0.3)) * 30;
    if (shortPctFloat >= 0.1) reasons.push(`${(shortPctFloat * 100).toFixed(1)}% of the float is sold short.`);
  }
  if (Number.isFinite(shortChangePct)) {
    if (shortChangePct > 0) {
      score += Math.max(0, Math.min(1, shortChangePct / 0.5)) * 15;
      if (shortChangePct >= 0.1) reasons.push(`Short interest rose ${(shortChangePct * 100).toFixed(0)}% vs the prior month — shorts are building, not covering.`);
    } else if (shortChangePct < 0) {
      score -= Math.max(0, Math.min(1, -shortChangePct / 0.5)) * 10;
      if (shortChangePct <= -0.1) reasons.push(`Short interest fell ${(-shortChangePct * 100).toFixed(0)}% vs the prior month — shorts are covering.`);
    }
  }
  const slope = finraTrendSlope(finraSeries);
  if (slope !== null) {
    const avg = finraSeries.reduce((s, p) => s + p.ratio, 0) / finraSeries.length;
    const trendPct = avg ? (slope * (finraSeries.length - 1)) / avg : 0; // rough % change across the window
    if (trendPct > 0.15) {
      score += 10;
      reasons.push(`FINRA daily short-volume ratio has trended up over the last ${finraSeries.length} trading days.`);
    } else if (trendPct < -0.15) {
      score -= 5;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = LABELS.find(([min]) => score >= min)[1];
  if (!reasons.length) reasons.push("No elevated short-interest signals.");

  return { score, label, reasons, finraTrendSlope: slope };
}

module.exports = { scoreShortPressure, finraTrendSlope };
