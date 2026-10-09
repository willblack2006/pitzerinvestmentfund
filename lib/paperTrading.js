// Paper-trading sandbox: each member's virtual portfolio is an append-only trade log, replayed
// with the same rules as the fund's real ledger (lib/portfolio.js): buys add shares at cost,
// sells remove shares at average cost and book the difference as realized gain, and you can't
// sell more than you hold or spend more cash than you have. Pure functions, no I/O.
//
// Rules added from docs/paper-trading-research.md (each season can set its own numbers):
// - a fee on every trade (basis points of the trade's value) so churning costs something;
// - a reason with every order (why, and optionally a target, a stop and a time frame);
// - orders placed while the market is shut fill at the next session's opening price;
// - stock splits and dividends are applied, so a 2-for-1 split isn't a 50% "loss";
// - diversification: a price and market-cap floor, a cap on any one position at purchase,
//   and a minimum number of holdings to be ranked;
// - the leaderboard shows risk (Sharpe ratio, max drawdown) next to return.

const EPS = 1e-9;
const cents = (x) => Math.round(x * 100) / 100; // money is shown to the cent; drop float noise

const DEFAULT_RULES = { feeBps: 10, minHoldings: 5, maxPositionPct: 25, minPrice: 5, minMarketCap: 300e6 };
const HORIZONS = { weeks: "A few weeks", months: "A few months", year: "A year or more" };
const MIN_BUY_REASON = 15;
const MIN_SELL_REASON = 10;
const MIN_SHARPE_DAYS = 20; // fewer daily returns than this and a Sharpe ratio is noise

function rulesFor(season = {}) {
  const out = {};
  for (const [k, d] of Object.entries(DEFAULT_RULES)) out[k] = Number.isFinite(season[k]) ? season[k] : d;
  return out;
}

const tradeFee = (gross, feeBps) => cents((gross * (feeBps || 0)) / 10000);

// SQLite datetimes are UTC ("2026-10-09 14:05:00"); trading days are New York dates.
function nyDate(utc) {
  if (!utc) return null;
  const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(utc) ? utc : `${utc.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
function nyMinutes(utc) {
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}
const tradeDay = (t) => t.day || nyDate(t.filledAt || t.createdAt) || "0000-00-00";

// Corporate actions per symbol: { SYM: { splits: [{ date, ratio }], dividends: [{ exDate, amount }] } }.
// Events on a date apply before that day's trades: a dividend goes to whoever held the stock
// the evening before its ex-date, and a split takes effect at that day's open.
function timeline(trades, actions = {}) {
  const items = trades.map((t, i) => ({ day: tradeDay(t), order: 1, seq: i, trade: t }));
  for (const [symbol, a] of Object.entries(actions)) {
    for (const s of a.splits || []) if (s.ratio > 0 && s.ratio !== 1) items.push({ day: s.date, order: 0, seq: 0, split: { symbol, ratio: s.ratio } });
    for (const d of a.dividends || []) if (d.amount > 0) items.push({ day: d.exDate, order: 0, seq: 1, dividend: { symbol, amount: d.amount } });
  }
  return items.sort((x, y) => x.day.localeCompare(y.day) || x.order - y.order || x.seq - y.seq);
}

function makeBook(startingCash) {
  const st = { cash: startingCash, realizedGain: 0, dividends: 0, fees: 0, book: new Map() };
  st.apply = (it) => {
    if (it.split) {
      const p = st.book.get(it.split.symbol);
      if (p) p.shares *= it.split.ratio; // same total cost, more (or fewer) shares
      return;
    }
    if (it.dividend) {
      const p = st.book.get(it.dividend.symbol);
      if (p) { const amt = p.shares * it.dividend.amount; st.cash += amt; st.dividends += amt; }
      return;
    }
    const t = it.trade;
    const gross = t.shares * t.price, fee = t.fee || 0;
    const pos = st.book.get(t.symbol) || { shares: 0, totalCost: 0 };
    st.fees += fee;
    if (t.type === "buy") {
      pos.shares += t.shares;
      pos.totalCost += gross + fee;
      st.cash -= gross + fee;
    } else {
      const costBasis = pos.shares > EPS ? (pos.totalCost / pos.shares) * t.shares : 0;
      pos.shares -= t.shares;
      pos.totalCost -= costBasis;
      st.realizedGain += gross - fee - costBasis;
      st.cash += gross - fee;
    }
    if (pos.shares <= EPS) st.book.delete(t.symbol);
    else st.book.set(t.symbol, pos);
  };
  st.snapshot = () => ({
    cash: cents(st.cash),
    positions: [...st.book.entries()].map(([symbol, p]) => ({ symbol, shares: p.shares, totalCost: p.totalCost, avgCost: p.totalCost / p.shares }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    realizedGain: cents(st.realizedGain),
    dividends: cents(st.dividends),
    fees: cents(st.fees),
  });
  return st;
}

// trades: filled trades [{ type: "buy"|"sell", symbol, shares, price, fee?, filledAt|createdAt|day }]
// in the order they filled. `until` (a New York date) ignores anything later, e.g. future ex-dates.
function replayLedger(trades, startingCash, actions = {}, { until = null } = {}) {
  const st = makeBook(startingCash);
  for (const it of timeline(trades, actions)) {
    if (until && it.day > until) break;
    st.apply(it);
  }
  return st.snapshot();
}

// Daily portfolio value on each date in `dates` (sorted New York dates). `closes` holds Yahoo's
// split-adjusted daily closes per symbol; they're turned back into the price actually traded
// that day by multiplying by every later split.
function equityCurve(trades, startingCash, actions, closes, dates) {
  const items = timeline(trades, actions);
  const st = makeBook(startingCash);
  const lastClose = {};
  const series = {};
  for (const [sym, bars] of Object.entries(closes || {})) {
    const splits = actions?.[sym]?.splits || [];
    series[sym] = new Map(bars.map((b) => [b.date, b.close * splits.filter((s) => s.date > b.date).reduce((m, s) => m * s.ratio, 1)]));
  }
  let i = 0;
  const out = [];
  for (const day of dates) {
    while (i < items.length && items[i].day <= day) st.apply(items[i++]);
    let value = st.cash;
    for (const [sym, p] of st.book) {
      const c = series[sym]?.get(day);
      if (Number.isFinite(c)) lastClose[sym] = c;
      value += Number.isFinite(lastClose[sym]) ? p.shares * lastClose[sym] : p.totalCost;
    }
    out.push({ date: day, value: cents(value) });
  }
  return out;
}

// Risk from a daily value series. Sharpe uses a 0% risk-free rate and is annualized by √252;
// it's left out until there are MIN_SHARPE_DAYS daily returns.
function riskStats(curve) {
  const vals = curve.map((p) => p.value).filter((v) => v > 0);
  const rets = [];
  for (let i = 1; i < vals.length; i++) rets.push(vals[i] / vals[i - 1] - 1);
  let peak = -Infinity, maxDrawdown = 0;
  for (const v of vals) { peak = Math.max(peak, v); maxDrawdown = Math.min(maxDrawdown, v / peak - 1); }
  let sharpe = null;
  if (rets.length >= MIN_SHARPE_DAYS) {
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1));
    sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : null;
  }
  return { sharpe, maxDrawdown: vals.length ? maxDrawdown : null, days: rets.length };
}

// Why a new order can't be placed, or null if it can.
// ctx: { rules, reserved: { cash, shares: { SYM: n } }, totalValue, positionValue, marketCap }
function validateTrade(state, t, ctx = {}) {
  const rules = ctx.rules || DEFAULT_RULES;
  const reserved = ctx.reserved || { cash: 0, shares: {} };
  if (!["buy", "sell"].includes(t.type)) return "Trade type must be buy or sell.";
  if (!/^[A-Z0-9.\-^]{1,10}$/.test(t.symbol || "")) return "Enter a valid ticker.";
  if (!(t.shares > 0) || !Number.isFinite(t.shares)) return "Shares must be a positive number.";
  if (!(t.price > 0)) return `No live price for ${t.symbol}.`;
  const reason = String(t.reason || "").trim();
  if (t.type === "buy" && reason.length < MIN_BUY_REASON) return "Say why you're buying (a sentence is enough): what you expect to happen, and what would prove you wrong.";
  if (t.type === "sell" && reason.length < MIN_SELL_REASON) return "Say why you're selling: what happened compared with your reason for buying?";
  for (const k of ["targetPrice", "stopPrice"]) if (t[k] != null && !(t[k] > 0)) return `${k === "targetPrice" ? "Target" : "Stop"} price must be a positive number.`;
  if (t.type === "buy" && t.stopPrice != null && t.stopPrice >= t.price) return `A stop is the price where you'd admit you're wrong, so it goes below today's price ($${t.price.toFixed(2)}).`;
  if (t.horizon && !HORIZONS[t.horizon]) return "Pick a time frame from the list.";

  const gross = t.shares * t.price;
  const fee = tradeFee(gross, rules.feeBps);
  if (t.type === "buy") {
    if (t.price < rules.minPrice) return `This season only allows stocks priced at $${rules.minPrice} or more (${t.symbol} is $${t.price.toFixed(2)}).`;
    if (Number.isFinite(ctx.marketCap) && ctx.marketCap < rules.minMarketCap) return `This season only allows companies worth at least $${fmtBig(rules.minMarketCap)} (${t.symbol} is $${fmtBig(ctx.marketCap)}).`;
    const free = state.cash - (reserved.cash || 0);
    if (gross + fee > free + EPS) return `Not enough cash: this costs $${(gross + fee).toFixed(2)} with the fee, and you have $${Math.max(0, free).toFixed(2)}${reserved.cash ? " not already set aside for orders waiting to fill" : ""}.`;
    if (ctx.totalValue > 0 && rules.maxPositionPct > 0) {
      const after = (ctx.positionValue || 0) + gross;
      if (after / ctx.totalValue > rules.maxPositionPct / 100 + EPS) {
        const room = Math.max(0, (rules.maxPositionPct / 100) * ctx.totalValue - (ctx.positionValue || 0));
        return `No single position can be more than ${rules.maxPositionPct}% of your portfolio when you buy. You can add up to $${room.toFixed(0)} of ${t.symbol} (about ${Math.floor(room / t.price)} shares).`;
      }
    }
  } else {
    const held = state.positions.find((p) => p.symbol === t.symbol)?.shares || 0;
    const avail = held - (reserved.shares?.[t.symbol] || 0);
    if (avail + EPS < t.shares) return `You hold ${+held.toFixed(4)} shares of ${t.symbol}${reserved.shares?.[t.symbol] ? `, ${+reserved.shares[t.symbol].toFixed(4)} already in a sell order waiting to fill` : ""}.`;
  }
  return null;
}
const fmtBig = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : `${Math.round(n / 1e6)}M`);

// An order placed while the market was shut fills at the opening price of the first session
// that starts after it: the same day if placed before 9:30 AM New York time, else a later day.
// bars: daily bars [{ date, open, close }] (New York dates). Returns the bar, or null if that
// session hasn't happened yet.
function pickFillBar(bars, placedAtUtc) {
  const day = nyDate(placedAtUtc);
  const beforeOpen = nyMinutes(placedAtUtc) < 9 * 60 + 30;
  return bars.find((b) => (b.date > day || (b.date === day && beforeOpen)) && Number.isFinite(b.open ?? b.close)) || null;
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

// Members holding at least `minHoldings` stocks are ranked by return (ties: fewer trades, since
// the same result with less churn is better). Everyone else is listed after, unranked, with why.
function rankLeaderboard(rows, rules = DEFAULT_RULES) {
  const byReturn = (a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity) || a.tradeCount - b.tradeCount;
  const ok = rows.filter((r) => r.positions >= rules.minHoldings).sort(byReturn).map((r, i) => ({ ...r, rank: i + 1, qualified: true }));
  const rest = rows.filter((r) => r.positions < rules.minHoldings).sort(byReturn)
    .map((r) => ({ ...r, rank: null, qualified: false, why: `Needs ${rules.minHoldings} holdings to be ranked (has ${r.positions}).` }));
  return [...ok, ...rest];
}

module.exports = {
  DEFAULT_RULES, HORIZONS, MIN_SHARPE_DAYS, rulesFor, tradeFee, nyDate, replayLedger, equityCurve, riskStats,
  validateTrade, pickFillBar, valuePortfolio, rankLeaderboard,
};
