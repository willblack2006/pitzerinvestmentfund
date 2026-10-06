// Execution helper: a rough cost/impact estimate and plain warnings from quote data, so
// whoever is about to place a trade has context. Pure functions over numbers the route
// supplies (no I/O, no clock reads) — the caller passes `etMinutes` instead of this module
// reading the clock, so the time-of-day check is testable too.

function spreadStats(bid, ask) {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  return { mid, spread: ask - bid, spreadPct: (ask - bid) / mid };
}

// A rough cost model for context, not a precise forecast: half the spread (what a marketable
// order pays to cross it) plus a square-root impact term scaled by the order's share of
// average daily volume — the standard shape of empirical market-impact models.
function estimateImpactBps(spreadPct, participationPct) {
  const halfSpreadBps = Number.isFinite(spreadPct) ? (spreadPct / 2) * 10000 : 0;
  const impactBps = Number.isFinite(participationPct) && participationPct > 0 ? 25 * Math.sqrt(participationPct) : 0;
  return halfSpreadBps + impactBps;
}

// Buying: bias toward the bid rather than paying the full ask. Selling: bias toward the ask
// rather than hitting the full bid. 40% of the way across the spread from your own side.
function suggestLimitPrice(direction, bid, ask) {
  const s = spreadStats(bid, ask);
  if (!s) return null;
  const buy = direction === "buy" || direction === "add";
  const price = buy ? bid + s.spread * 0.4 : ask - s.spread * 0.4;
  return Math.round(price * 100) / 100;
}

// `etMinutes` = minutes since midnight in America/New_York (0-1439). Regular session 9:30-16:00.
function sessionWarning(etMinutes) {
  if (etMinutes == null) return null;
  const open = 9 * 60 + 30, close = 16 * 60;
  if (etMinutes < open || etMinutes > close) return "Market is closed — this quote may be stale.";
  if (etMinutes - open <= 15) return "First 15 minutes of trading: prices are volatile while the market finds its open.";
  if (close - etMinutes <= 15) return "Last 15 minutes of trading: volume and volatility spike into the close.";
  return null;
}

function assessExecution({ direction, bid, ask, avgDailyVolume, orderShares, etMinutes } = {}) {
  const spread = spreadStats(bid, ask);
  const participationPct = Number.isFinite(avgDailyVolume) && avgDailyVolume > 0 && Number.isFinite(orderShares)
    ? orderShares / avgDailyVolume : null;

  const warnings = [];
  const session = sessionWarning(etMinutes);
  if (session) warnings.push(session);
  if (spread && spread.spreadPct > 0.01) warnings.push(`Wide spread (${(spread.spreadPct * 100).toFixed(2)}%) — consider a limit order.`);
  if (Number.isFinite(avgDailyVolume) && avgDailyVolume > 0 && avgDailyVolume < 100000) warnings.push("Thin name: average daily volume is under 100,000 shares.");
  if (participationPct !== null && participationPct > 0.1) warnings.push(`This order would be ${(participationPct * 100).toFixed(1)}% of average daily volume — consider breaking it up or using a limit order.`);

  return {
    mid: spread?.mid ?? null,
    spreadPct: spread?.spreadPct ?? null,
    participationPct,
    estimatedCostBps: spread ? estimateImpactBps(spread.spreadPct, participationPct) : null,
    suggestedLimitPrice: direction && Number.isFinite(bid) && Number.isFinite(ask) ? suggestLimitPrice(direction, bid, ask) : null,
    warnings,
  };
}

module.exports = { spreadStats, estimateImpactBps, suggestLimitPrice, sessionWarning, assessExecution };
