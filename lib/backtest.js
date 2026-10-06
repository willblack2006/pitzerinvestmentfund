// Signal backtester (guardrail, not a forecast). Monthly-rebalance long-only backtest of a
// price-based signal across a universe, built only from data we actually have point-in-time
// history for: daily closes. Pure functions over price series — the route gathers the
// histories and calls this; no network or randomness here, so it's fully unit-testable.
//
// Momentum is the only signal backed by real historical values at each past rebalance date.
// Insider score, estimate-revision score and short-pressure are all computed from CURRENT
// snapshots (today's Form 4 history, today's consensus estimates, today's short interest) —
// we don't store what those looked like historically, so backtesting them would mean
// silently reusing today's value at every past date, which is not a real backtest. The route
// only calls this for momentum and says so plainly for the others.

function monthEndCloses(series) {
  const byMonth = new Map();
  for (const p of series) byMonth.set(p.date.slice(0, 7), p); // ascending dates: last write per month wins
  return [...byMonth.values()];
}

// 12-1 month momentum as of index i in a month-end series (skips the most recent month).
function momentumAt(monthly, i) {
  if (i < 12) return null;
  return monthly[i - 1].close / monthly[i - 12].close - 1;
}

// Equal-weighted monthly rebalance into the top and bottom terciles by momentum, vs a
// buy-and-hold benchmark, net of `costBps` round-trip cost applied proportionally to turnover.
function backtestMomentum(universeSeries, benchSeries, { costBps = 20 } = {}) {
  const symbols = Object.keys(universeSeries);
  const monthly = Object.fromEntries(symbols.map((s) => [s, monthEndCloses(universeSeries[s])]));
  const allMonths = [...new Set(Object.values(monthly).flatMap((s) => s.map((p) => p.date.slice(0, 7))))].sort();
  const bench = monthEndCloses(benchSeries);
  const benchByMonth = new Map(bench.map((p) => [p.date.slice(0, 7), p.close]));

  const rows = [];
  let topValue = 100, bottomValue = 100, benchValue = 100;
  let prevTop = null, prevBottom = null;

  const turnoverCost = (prevSet, newSymbols) => {
    if (!prevSet) return costBps / 10000;
    const newSet = new Set(newSymbols);
    const changed = [...prevSet].filter((s) => !newSet.has(s)).length + [...newSet].filter((s) => !prevSet.has(s)).length;
    return newSymbols.length ? (changed / (2 * newSymbols.length)) * (costBps / 10000) : 0;
  };

  for (let m = 12; m < allMonths.length - 1; m++) {
    const month = allMonths[m], nextMonth = allMonths[m + 1];
    const scored = symbols.map((s) => {
      const series = monthly[s];
      const idx = series.findIndex((p) => p.date.slice(0, 7) === month);
      if (idx < 0) return null;
      const mom = momentumAt(series, idx);
      return mom === null ? null : { symbol: s, momentum: mom, idx, series };
    }).filter(Boolean);
    if (scored.length < 3) continue;
    scored.sort((a, b) => b.momentum - a.momentum);
    const tercileSize = Math.max(1, Math.floor(scored.length / 3));
    const top = scored.slice(0, tercileSize), bottom = scored.slice(-tercileSize);

    const groupReturn = (group) => {
      const rets = group.map((g) => {
        const nextIdx = g.series.findIndex((p) => p.date.slice(0, 7) === nextMonth);
        return nextIdx === g.idx + 1 ? g.series[nextIdx].close / g.series[g.idx].close - 1 : null;
      }).filter((r) => r !== null);
      return rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : null;
    };
    const topRet = groupReturn(top), bottomRet = groupReturn(bottom);
    const benchRet = benchByMonth.has(nextMonth) && benchByMonth.has(month) ? benchByMonth.get(nextMonth) / benchByMonth.get(month) - 1 : null;

    const topSymbols = top.map((g) => g.symbol), bottomSymbols = bottom.map((g) => g.symbol);
    const topCost = turnoverCost(prevTop, topSymbols), bottomCost = turnoverCost(prevBottom, bottomSymbols);
    prevTop = new Set(topSymbols); prevBottom = new Set(bottomSymbols);

    if (topRet !== null) topValue *= 1 + topRet - topCost;
    if (bottomRet !== null) bottomValue *= 1 + bottomRet - bottomCost;
    if (benchRet !== null) benchValue *= 1 + benchRet;

    rows.push({ month: nextMonth, topReturn: topRet, bottomReturn: bottomRet, benchReturn: benchRet, topValue, bottomValue, benchValue, topHoldings: topSymbols, bottomHoldings: bottomSymbols });
  }

  return {
    rows,
    summary: rows.length ? {
      months: rows.length,
      topTotalReturn: topValue / 100 - 1,
      bottomTotalReturn: bottomValue / 100 - 1,
      benchTotalReturn: benchValue / 100 - 1,
      longShortSpread: topValue / 100 - bottomValue / 100,
    } : null,
  };
}

module.exports = { monthEndCloses, momentumAt, backtestMomentum };
