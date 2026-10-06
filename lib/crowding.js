// Crowding / hype monitor: volume z-score, opening-gap size, and a news-attention spike —
// simple, well-documented "attention" signals. Barber, Huang, Odean & Schwarz find
// attention-driven retail buying tends to underperform by roughly 3% over the following
// week. Pure stats over arrays/numbers the route supplies (price/volume history, news
// counts) — no network or I/O here.

function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; }
function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

// z-score of the most recent day's volume vs the `window` trading days before it.
function volumeZScore(series, window = 60) {
  if (series.length < window + 1) return null;
  const trailing = series.slice(-window - 1, -1).map((p) => p.volume).filter(Number.isFinite);
  const current = series.at(-1)?.volume;
  if (!Number.isFinite(current) || trailing.length < 10) return null;
  const sd = stdev(trailing);
  return sd ? (current - mean(trailing)) / sd : null;
}

// Most recent day's open vs the prior day's close, as a fraction.
function latestGapPct(series) {
  if (series.length < 2) return null;
  const today = series.at(-1), prior = series.at(-2);
  if (!Number.isFinite(today?.open) || !Number.isFinite(prior?.close) || prior.close === 0) return null;
  return today.open / prior.close - 1;
}

// Ratio of the recent news rate (count/day over the last `recentDays`) to the baseline rate
// over the rest of the fetched window. >1 means coverage has picked up.
function newsAttentionRatio(recentCount, recentDays, baselineCount, baselineDays) {
  if (recentDays <= 0 || baselineDays <= 0) return null;
  const recentRate = recentCount / recentDays;
  const baselineRate = baselineCount / baselineDays;
  if (baselineRate > 0) return recentRate / baselineRate;
  return recentCount > 0 ? Infinity : 1;
}

function scoreCrowding({ volumeZ, gapPct, newsRatio } = {}) {
  const reasons = [];
  let score = 0;
  if (Number.isFinite(volumeZ)) {
    if (volumeZ >= 2) { score += 40; reasons.push(`Volume is ${volumeZ.toFixed(1)}σ above its 60-day average.`); }
    else if (volumeZ >= 1) score += 15;
  }
  if (Number.isFinite(gapPct) && Math.abs(gapPct) >= 0.05) {
    score += 30;
    reasons.push(`${gapPct > 0 ? "Gapped up" : "Gapped down"} ${(Math.abs(gapPct) * 100).toFixed(1)}% at the open.`);
  }
  if (Number.isFinite(newsRatio) && newsRatio >= 3) {
    score += 30;
    reasons.push(`News coverage has picked up sharply (about ${newsRatio.toFixed(1)}× its recent pace).`);
  } else if (newsRatio === Infinity) {
    score += 30;
    reasons.push("A burst of news coverage with none in the prior period.");
  }
  score = Math.min(100, Math.round(score));
  const label = score >= 60 ? "Attention spike" : score >= 30 ? "Elevated attention" : "Normal";
  if (!reasons.length) reasons.push("No unusual volume, gap or news activity.");
  return { score, label, reasons };
}

module.exports = { mean, stdev, volumeZScore, latestGapPct, newsAttentionRatio, scoreCrowding };
