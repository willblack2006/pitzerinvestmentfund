// Insider signal score, following Cohen, Malloy & Pomorski ("Decoding Inside Information",
// J. Finance 2012). Pure functions over Form 4 rows ({ name, change, share, transactionDate,
// transactionCode, transactionPrice, isDerivative }) so the logic is unit-testable.
//
// Key idea: an insider who trades in the same calendar month year after year is "routine"
// (bonus timing, tax planning, scheduled sales) and their trades carry ~no information.
// Everyone else is "opportunistic", and their trades — especially open-market BUYS, and
// especially several insiders buying at once ("cluster") — have predicted returns.

const DAY = 24 * 60 * 60 * 1000;
const isTrade = (t) => (t.transactionCode === "P" || t.transactionCode === "S") && !t.isDerivative && t.transactionDate;

// Routine if the insider traded (P or S) in the same calendar month in each of the three
// preceding years. Insiders without 3+ prior years of history are "new" (no track record).
function classifyInsider(trades, asOf) {
  const byYearMonth = new Set(trades.map((t) => t.transactionDate.slice(0, 7)));
  const years = [...new Set(trades.map((t) => Number(t.transactionDate.slice(0, 4))))];
  const asOfYear = Number(asOf.slice(0, 4));
  const priorYears = years.filter((y) => y < asOfYear);
  if (priorYears.length < 3) return "new";
  const month = asOf.slice(5, 7);
  const routine = [1, 2, 3].every((k) => byYearMonth.has(`${asOfYear - k}-${month}`));
  return routine ? "routine" : "opportunistic";
}

// Classify every trade by its insider's pattern *as of that trade's date* (no look-ahead).
function classifyTrades(rows) {
  const trades = rows.filter(isTrade);
  const byInsider = new Map();
  for (const t of trades) {
    if (!byInsider.has(t.name)) byInsider.set(t.name, []);
    byInsider.get(t.name).push(t);
  }
  return trades.map((t) => {
    const prior = byInsider.get(t.name).filter((x) => x.transactionDate < t.transactionDate.slice(0, 4) + "-01-01");
    return { ...t, kind: classifyInsider(prior, t.transactionDate) };
  });
}

// Holdings increase from a purchase: change / holdings before the trade.
function holdingIncrease(t) {
  const before = (t.share ?? 0) - (t.change ?? 0);
  return before > 0 ? t.change / before : null; // null = first purchase (no prior stake)
}

const WEIGHT = { opportunistic: 1, new: 0.6, routine: 0 };
// Selling is capped at -60 (it's the weaker signal), so the bottom band starts at -50.
const LABELS = [
  [60, "Strong buy signal"],
  [25, "Buy signal"],
  [-25, "Neutral"],
  [-50, "Some insider selling"],
  [-Infinity, "Selling pressure"],
];

// Score from -100 (heavy informed selling) to +100 (strong informed buying), with reasons.
function scoreInsiders(rows, { now = new Date(), windowDays = 90 } = {}) {
  const classified = classifyTrades(rows);
  const cutoff = new Date(now.getTime() - windowDays * DAY).toISOString().slice(0, 10);
  const recent = classified.filter((t) => t.transactionDate >= cutoff);
  const decay = (t) => Math.pow(0.5, (now - new Date(t.transactionDate)) / (45 * DAY)); // 45-day half-life

  const buys = recent.filter((t) => t.transactionCode === "P" && (t.change ?? 0) > 0);
  const sells = recent.filter((t) => t.transactionCode === "S" && (t.change ?? 0) < 0);

  // Per-insider buy strength: classification weight × recency × size (bigger relative stake
  // increases and bigger dollar amounts mean more conviction), aggregated per person so one
  // insider filing many small lots isn't counted many times.
  const perInsider = (list, sign) => {
    const m = new Map();
    for (const t of list) {
      const w = WEIGHT[t.kind];
      if (!w) continue;
      const dollars = Math.abs(t.change) * (t.transactionPrice || 0);
      const inc = sign > 0 ? holdingIncrease(t) : null;
      const size = Math.min(2, 0.5 + Math.log10(1 + dollars / 25000) * 0.5 + (inc === null ? 0.5 : Math.min(1, inc)));
      const cur = m.get(t.name) || { name: t.name, kind: t.kind, points: 0, shares: 0, dollars: 0, last: t.transactionDate, increase: inc };
      cur.points = Math.max(cur.points, w * decay(t) * size);
      cur.shares += Math.abs(t.change);
      cur.dollars += dollars;
      if (t.transactionDate > cur.last) cur.last = t.transactionDate;
      if (inc !== null && (cur.increase === null || inc > cur.increase)) cur.increase = inc;
      m.set(t.name, cur);
    }
    return [...m.values()].sort((a, b) => b.points - a.points);
  };
  const buyers = perInsider(buys, 1);
  const sellers = perInsider(sells, -1);

  // Cluster: distinct informative buyers within any 30-day span.
  const buyDates = buys.filter((t) => WEIGHT[t.kind] > 0).map((t) => ({ name: t.name, d: new Date(t.transactionDate) }));
  let cluster = 0;
  for (const a of buyDates) {
    const names = new Set(buyDates.filter((b) => b.d >= a.d && b.d - a.d <= 30 * DAY).map((b) => b.name));
    cluster = Math.max(cluster, names.size);
  }
  const clusterMult = cluster >= 3 ? 2 : cluster >= 2 ? 1.5 : 1;

  // Buys are the strong signal; opportunistic sells are informative but much weaker (insiders
  // sell for liquidity and diversification), so they count for less and are capped.
  const buyScore = buyers.reduce((s, b) => s + b.points, 0) * 30 * clusterMult;
  const sellScore = Math.min(60, sellers.reduce((s, b) => s + b.points, 0) * 10);
  const score = Math.max(-100, Math.min(100, Math.round(buyScore - sellScore)));
  const label = LABELS.find(([min]) => score >= min)[1];

  const reasons = [];
  const fmt$ = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}K`);
  if (cluster >= 2) reasons.push(`${cluster} insiders bought within 30 days (cluster buy) — historically the strongest form of the signal.`);
  for (const b of buyers.slice(0, 3)) {
    reasons.push(`${b.name} (${b.kind}) bought ${b.shares.toLocaleString()} shares${b.dollars ? ` (~${fmt$(b.dollars)})` : ""}${b.increase === null ? ", a new position" : b.increase > 2 ? `, multiplying a small prior stake ${Math.round(b.increase + 1)}×` : `, raising their stake ${Math.round(b.increase * 100)}%`} — last on ${b.last}.`);
  }
  if (sellers.length) {
    const tot = sellers.reduce((s, x) => s + x.dollars, 0);
    reasons.push(`${sellers.length} non-routine insider${sellers.length > 1 ? "s" : ""} sold${tot ? ` ~${fmt$(tot)}` : ""} in the last ${windowDays} days (weaker signal: insiders sell for many non-informational reasons).`);
  }
  const routineCount = recent.filter((t) => t.kind === "routine").length;
  if (routineCount) reasons.push(`${routineCount} routine trade${routineCount > 1 ? "s" : ""} ignored (same-month-every-year pattern carries no information).`);
  if (!reasons.length) reasons.push(`No open-market insider buying or non-routine selling in the last ${windowDays} days.`);

  return {
    score,
    label,
    cluster,
    buyers,
    sellers,
    windowDays,
    counts: {
      opportunisticBuys: buys.filter((t) => t.kind === "opportunistic").length,
      newBuys: buys.filter((t) => t.kind === "new").length,
      routine: routineCount,
      sells: sells.filter((t) => t.kind !== "routine").length,
    },
    reasons,
    recent: recent.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)).slice(0, 40),
  };
}

module.exports = { classifyInsider, classifyTrades, holdingIncrease, scoreInsiders };
