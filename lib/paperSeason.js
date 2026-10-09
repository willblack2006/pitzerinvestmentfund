// Paper trading I/O: seasons, orders, fills at the next open, corporate actions, and the
// standings (values, returns, risk) for a season. The rules themselves are in paperTrading.js.
const db = require("../db");
const yahoo = require("./sources/yahoo");
const benchmarks = require("./benchmarks");
const { latestPrices, histories } = require("./prices");
const { notify } = require("./notify");
const P = require("./paperTrading");

function semesterName(d = new Date()) {
  const m = d.getMonth() + 1;
  return `${m >= 8 ? "Fall" : m >= 6 ? "Summer" : "Spring"} ${d.getFullYear()}`;
}

// The open season; the first visit ever starts one named for the current semester.
function currentSeason() {
  let s = db.prepare("SELECT * FROM paper_seasons WHERE endedAt IS NULL ORDER BY id DESC LIMIT 1").get();
  if (!s) {
    const info = db.prepare("INSERT INTO paper_seasons (name) VALUES (?)").run(semesterName());
    s = db.prepare("SELECT * FROM paper_seasons WHERE id = ?").get(info.lastInsertRowid);
  }
  return s;
}

// Filled trades in the order they filled.
const filledTrades = (seasonId, memberId) => db.prepare(`SELECT * FROM paper_trades WHERE seasonId = ? AND memberId = ? AND status = 'filled'
  ORDER BY COALESCE(filledAt, createdAt), id`).all(seasonId, memberId);
const pendingOrders = (seasonId, memberId) => db.prepare("SELECT * FROM paper_trades WHERE seasonId = ? AND memberId = ? AND status = 'pending' ORDER BY id").all(seasonId, memberId);

// Splits and dividends for these symbols (cached 12h per symbol); a failed lookup means none.
async function corporateActions(symbols) {
  const out = {};
  await Promise.all([...new Set(symbols)].map(async (s) => {
    try { out[s] = await yahoo.getCorporateActions(s); } catch { out[s] = { splits: [], dividends: [] }; }
  }));
  return out;
}

const today = () => P.nyDate(new Date().toISOString());

// Cash and shares already promised to orders waiting for the next open.
function reservedFor(pending, rules) {
  const r = { cash: 0, shares: {} };
  for (const o of pending) {
    if (o.type === "buy") r.cash += o.shares * o.price * (1 + rules.feeBps / 10000);
    else r.shares[o.symbol] = (r.shares[o.symbol] || 0) + o.shares;
  }
  return r;
}

// The member's portfolio right now (filled trades, splits and dividends to date).
async function stateFor(season, memberId, extraSymbols = []) {
  const trades = filledTrades(season.id, memberId);
  const actions = await corporateActions([...trades.map((t) => t.symbol), ...extraSymbols]);
  return { trades, actions, state: P.replayLedger(trades, season.startingCash, actions, { until: today() }) };
}

// Place an order. Fills now at the live price while the market is open; otherwise waits for the
// next session's opening price. Returns the stored row.
async function placeOrder(season, member, input) {
  const rules = P.rulesFor(season);
  const symbol = String(input.symbol || "").toUpperCase().trim();
  const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  const t = {
    type: String(input.type || ""), symbol, shares: Number(input.shares),
    reason: String(input.reason || "").trim().slice(0, 1000),
    targetPrice: num(input.targetPrice), stopPrice: num(input.stopPrice),
    horizon: String(input.horizon || ""),
  };
  let quote = null;
  if (/^[A-Z0-9.\-^]{1,10}$/.test(symbol)) {
    try { quote = (await yahoo.getQuotes([symbol]))[symbol] || null; } catch { quote = null; }
  }
  t.price = quote?.price ?? null;
  const { state } = await stateFor(season, member.id, [symbol]);
  const pending = pendingOrders(season.id, member.id);
  const prices = Object.fromEntries(Object.entries(await latestPrices(state.positions.map((p) => p.symbol))).map(([s, q]) => [s, q.price]));
  if (t.price) prices[symbol] = t.price;
  const valued = P.valuePortfolio(state, prices, season.startingCash);
  const error = P.validateTrade(state, t, {
    rules, reserved: reservedFor(pending, rules), totalValue: valued.totalValue,
    positionValue: valued.positions.find((p) => p.symbol === symbol)?.marketValue || 0,
    marketCap: quote?.marketCap ?? null,
  });
  if (error) throw Object.assign(new Error(error), { status: 400 });

  const open = quote?.marketState === "REGULAR";
  const fee = P.tradeFee(t.shares * t.price, rules.feeBps);
  const info = db.prepare(`INSERT INTO paper_trades (seasonId, memberId, type, symbol, shares, price, fee, status, reason, targetPrice, stopPrice, horizon, filledAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${open ? "datetime('now')" : "NULL"})`)
    .run(season.id, member.id, t.type, symbol, t.shares, t.price, open ? fee : 0, open ? "filled" : "pending", t.reason, t.targetPrice, t.stopPrice, t.horizon);
  return db.prepare("SELECT * FROM paper_trades WHERE id = ?").get(info.lastInsertRowid);
}

// Fill every pending order whose next session has opened, at that session's opening price.
// An order that no longer fits (not enough cash at the open, shares already sold) is cancelled.
async function fillPending() {
  const orders = db.prepare("SELECT o.*, s.startingCash, s.feeBps FROM paper_trades o JOIN paper_seasons s ON s.id = o.seasonId WHERE o.status = 'pending' ORDER BY o.id").all();
  if (!orders.length) return { filled: 0, cancelled: 0 };
  const bars = {};
  await Promise.all([...new Set(orders.map((o) => o.symbol))].map(async (s) => {
    try { bars[s] = await yahoo.getChart(s, "5d", "1d"); } catch { bars[s] = []; }
  }));
  let filled = 0, cancelled = 0;
  for (const o of orders) {
    const bar = P.pickFillBar(bars[o.symbol] || [], o.createdAt);
    if (!bar) continue;
    const price = bar.open ?? bar.close;
    const fee = P.tradeFee(o.shares * price, o.feeBps);
    const season = { id: o.seasonId, startingCash: o.startingCash };
    const { state } = await stateFor(season, o.memberId);
    let why = null;
    if (o.type === "buy" && o.shares * price + fee > state.cash + 1e-9) why = `Not enough cash at the open ($${(o.shares * price + fee).toFixed(2)} needed, $${state.cash.toFixed(2)} available).`;
    if (o.type === "sell" && (state.positions.find((p) => p.symbol === o.symbol)?.shares || 0) + 1e-9 < o.shares) why = `You no longer hold ${o.shares} shares of ${o.symbol}.`;
    const verb = o.type === "buy" ? "Bought" : "Sold";
    if (why) {
      db.prepare("UPDATE paper_trades SET status = 'cancelled', cancelReason = ? WHERE id = ?").run(why, o.id);
      notify([o.memberId], { type: "paperOrder", title: `Paper order cancelled: ${o.type} ${+o.shares.toFixed(4)} ${o.symbol}`, body: why, link: "#/paper" });
      cancelled++;
    } else {
      // 14:30 UTC is 9:30 or 10:30 AM in New York, so the fill lands on the right trading day.
      db.prepare("UPDATE paper_trades SET status = 'filled', price = ?, fee = ?, filledAt = ? WHERE id = ?").run(price, fee, `${bar.date} 14:30:00`, o.id);
      notify([o.memberId], { type: "paperOrder", title: `Paper order filled: ${verb} ${+o.shares.toFixed(4)} ${o.symbol} at $${price.toFixed(2)}`, body: `Filled at the ${bar.date} open.`, link: "#/paper" });
      filled++;
    }
  }
  return { filled, cancelled };
}

function cancelOrder(memberId, id) {
  const o = db.prepare("SELECT * FROM paper_trades WHERE id = ? AND memberId = ?").get(id, memberId);
  if (!o) throw Object.assign(new Error("Order not found."), { status: 404 });
  if (o.status !== "pending") throw Object.assign(new Error("Only orders waiting to fill can be cancelled."), { status: 409 });
  db.prepare("UPDATE paper_trades SET status = 'cancelled', cancelReason = 'Cancelled by you.' WHERE id = ?").run(o.id);
}

// Benchmark return since the season started, plus its daily closes (the trading calendar).
async function benchmarkSince(startDay, bench, end) {
  try {
    const series = (await benchmarks.series(bench, "5y")).filter((p) => p.date <= end);
    const since = series.filter((p) => p.date >= startDay);
    // A season that started today has no later bar yet; measure from the latest close (0%).
    const start = since[0] || series.at(-1);
    const last = series.at(-1);
    return { label: benchmarks.shortName(bench), returnPct: last.close / start.close - 1, series: since.length ? since : [last] };
  } catch {
    return null;
  }
}

// Everything the Paper page and profiles need for one season.
async function standings(season, { viewerId = null, bench }) {
  const rules = P.rulesFor(season);
  const startDay = P.nyDate(season.startedAt);
  const traders = db.prepare(`SELECT m.id, m.name, COUNT(t.id) AS tradeCount FROM paper_trades t JOIN members m ON m.id = t.memberId
    WHERE t.seasonId = ? AND t.status = 'filled' GROUP BY m.id`).all(season.id);
  const ids = traders.map((m) => m.id);
  if (viewerId && !ids.includes(viewerId)) ids.push(viewerId);
  const tradesBy = new Map(ids.map((id) => [id, filledTrades(season.id, id)]));
  const symbols = [...new Set([...tradesBy.values()].flat().map((t) => t.symbol))];
  const end = season.endedAt ? P.nyDate(season.endedAt) : today();
  const [actions, quotes, bm, hist] = await Promise.all([
    corporateActions(symbols),
    symbols.length ? latestPrices(symbols) : {},
    benchmarkSince(startDay, bench, end),
    symbols.length ? histories(symbols, "1y") : {},
  ]);
  const prices = Object.fromEntries(Object.entries(quotes).map(([s, q]) => [s, q.price]));
  const dates = (bm?.series || []).map((p) => p.date).filter((d) => d <= end);

  const rows = new Map();
  for (const id of ids) {
    const trades = tradesBy.get(id);
    const state = P.replayLedger(trades, season.startingCash, actions, { until: end });
    const v = P.valuePortfolio(state, season.endedAt ? {} : prices, season.startingCash);
    const curve = trades.length && dates.length ? P.equityCurve(trades, season.startingCash, actions, hist, dates) : [];
    // An ended season is valued at its last close, not today's prices.
    if (season.endedAt && curve.length) { v.totalValue = curve.at(-1).value; v.returnPct = v.totalValue / season.startingCash - 1; }
    const risk = P.riskStats(curve);
    const biggest = v.positions.reduce((m, p) => Math.max(m, v.totalValue > 0 ? p.marketValue / v.totalValue : 0), 0);
    rows.set(id, { v, curve, risk, biggestPositionPct: biggest });
  }

  const board = P.rankLeaderboard(traders.map((m) => {
    const r = rows.get(m.id);
    return {
      memberId: m.id, name: m.name, tradeCount: m.tradeCount, totalValue: r.v.totalValue, returnPct: r.v.returnPct,
      excessPct: bm && r.v.returnPct != null ? r.v.returnPct - bm.returnPct : null,
      positions: r.v.positions.length, sharpe: r.risk.sharpe, maxDrawdown: r.risk.maxDrawdown, riskDays: r.risk.days,
      biggestPositionPct: r.biggestPositionPct,
    };
  }), rules);

  let mine = null;
  if (viewerId) {
    const r = rows.get(viewerId);
    const trades = tradesBy.get(viewerId);
    // Your reasons for each position you still hold (shown when you sell).
    const theses = {};
    for (const t of trades) if (t.type === "buy") theses[t.symbol] = { reason: t.reason, targetPrice: t.targetPrice, stopPrice: t.stopPrice, horizon: t.horizon, at: t.filledAt || t.createdAt, price: t.price };
    const recent = db.prepare("SELECT * FROM paper_trades WHERE seasonId = ? AND memberId = ? ORDER BY id DESC LIMIT 30").all(season.id, viewerId);
    mine = {
      ...r.v, risk: r.risk, biggestPositionPct: r.biggestPositionPct,
      positions: r.v.positions.map((p) => ({ ...p, thesis: theses[p.symbol] || null, weight: r.v.totalValue > 0 ? p.marketValue / r.v.totalValue : 0 })),
      pending: pendingOrders(season.id, viewerId), recent,
      curve: r.curve,
      rank: board.find((b) => b.memberId === viewerId) || null,
    };
  }
  const benchCurve = bm && bm.series.length ? bm.series.map((p) => ({ date: p.date, value: season.startingCash * (p.close / bm.series[0].close) })) : [];
  return { rules, leaderboard: board, mine, benchmark: bm ? { label: bm.label, returnPct: bm.returnPct } : null, benchCurve };
}

module.exports = { semesterName, currentSeason, placeOrder, fillPending, cancelOrder, standings, filledTrades };
