// Paper-trading sandbox: each member's virtual portfolio is an append-only trade log, replayed
// with the same rules as the fund's real ledger (lib/portfolio.js): buys add shares at cost,
// sells remove shares at average cost and book the difference as realized gain, and you can't
// sell more than you hold or spend more cash than you have. Pure functions, no I/O.

const EPS = 1e-9;
const cents = (x) => Math.round(x * 100) / 100; // money is shown to the cent; drop float noise

// trades: [{ type: "buy"|"sell", symbol, shares, price }] in the order they were placed.
function replayLedger(trades, startingCash) {
  let cash = startingCash, realizedGain = 0;
  const book = new Map(); // symbol -> { shares, totalCost }
  for (const t of trades) {
    const gross = t.shares * t.price;
    const pos = book.get(t.symbol) || { shares: 0, totalCost: 0 };
    if (t.type === "buy") {
      pos.shares += t.shares;
      pos.totalCost += gross;
      cash -= gross;
    } else {
      const costBasis = pos.shares > EPS ? (pos.totalCost / pos.shares) * t.shares : 0;
      pos.shares -= t.shares;
      pos.totalCost -= costBasis;
      realizedGain += gross - costBasis;
      cash += gross;
    }
    if (pos.shares <= EPS) book.delete(t.symbol);
    else book.set(t.symbol, pos);
  }
  const positions = [...book.entries()].map(([symbol, p]) => ({ symbol, shares: p.shares, totalCost: p.totalCost, avgCost: p.totalCost / p.shares }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { cash: cents(cash), positions, realizedGain: cents(realizedGain) };
}

// Why a new trade can't be placed against the current state, or null if it can.
function validateTrade(state, t) {
  if (!["buy", "sell"].includes(t.type)) return "Trade type must be buy or sell.";
  if (!/^[A-Z0-9.\-^]{1,10}$/.test(t.symbol || "")) return "Enter a valid ticker.";
  if (!(t.shares > 0) || !Number.isFinite(t.shares)) return "Shares must be a positive number.";
  if (!(t.price > 0)) return `No live price for ${t.symbol}.`;
  if (t.type === "buy" && t.shares * t.price > state.cash + EPS) {
    return `Not enough cash: this costs $${(t.shares * t.price).toFixed(2)} and you have $${state.cash.toFixed(2)}.`;
  }
  if (t.type === "sell") {
    const held = state.positions.find((p) => p.symbol === t.symbol)?.shares || 0;
    if (held + EPS < t.shares) return `You hold ${held} shares of ${t.symbol}.`;
  }
  return null;
}

// Mark a replayed portfolio to market. A position with no price is valued at cost, and flagged.
function valuePortfolio(state, prices, startingCash) {
  const positions = state.positions.map((p) => {
    const price = prices[p.symbol];
    const marketValue = Number.isFinite(price) ? p.shares * price : p.totalCost;
    return { ...p, price: Number.isFinite(price) ? price : null, marketValue: cents(marketValue), gain: cents(marketValue - p.totalCost) };
  });
  const holdingsValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalValue = cents(state.cash + holdingsValue);
  return { ...state, positions, holdingsValue, totalValue, returnPct: startingCash > 0 ? totalValue / startingCash - 1 : null };
}

// Highest return first; ties broken by fewer trades (same result with less churn ranks higher).
function rankLeaderboard(rows) {
  return [...rows].sort((a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity) || a.tradeCount - b.tradeCount)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

module.exports = { replayLedger, validateTrade, valuePortfolio, rankLeaderboard };
