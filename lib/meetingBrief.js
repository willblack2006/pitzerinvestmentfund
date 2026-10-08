// Weekly-meeting brief: how each holding moved since a chosen date, and what that did to the
// fund (position weight x move). Pure; the route supplies price histories and live prices.

// histories: { SYM: [{ date, close }] }, positions: [{ symbol, shares }], prices: { SYM: number }
function movesSince(histories, positions, since, prices = {}) {
  const rows = positions.map((p) => {
    const series = histories[p.symbol] || [];
    const start = series.find((pt) => pt.date >= since); // first close on/after the meeting date
    const now = Number.isFinite(prices[p.symbol]) ? prices[p.symbol] : series.at(-1)?.close;
    if (!start || !Number.isFinite(now)) return { symbol: p.symbol, changePct: null, value: null };
    return { symbol: p.symbol, from: start.close, fromDate: start.date, to: now, changePct: now / start.close - 1, startValue: p.shares * start.close, value: p.shares * now };
  });
  const startTotal = rows.reduce((s, r) => s + (r.startValue || 0), 0);
  for (const r of rows) r.contributionPct = startTotal && r.startValue ? (r.value - r.startValue) / startTotal : null;
  return rows.sort((a, b) => Math.abs(b.contributionPct ?? 0) - Math.abs(a.contributionPct ?? 0));
}

module.exports = { movesSince };
