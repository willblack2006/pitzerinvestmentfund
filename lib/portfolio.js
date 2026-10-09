const db = require("../db");
const yahoo = require("./sources/yahoo");
const { latestPrices } = require("./prices");
const { getSettings, setSettings } = require("./settings");
const benchmarks = require("./benchmarks");

// ---- Transaction ledger: every buy/sell/dividend/cash movement updates positions + cash ----

function applyTransaction(t, direction = 1) {
  const s = getSettings();
  let cash = s.cash;
  const pos = t.symbol ? db.prepare("SELECT * FROM positions WHERE symbol = ?").get(t.symbol) : null;
  const gross = t.shares * t.price;

  if (t.type === "buy") {
    if (direction === 1) {
      if (pos) {
        const shares = pos.shares + t.shares;
        const totalCost = pos.totalCost + gross;
        db.prepare("UPDATE positions SET shares=?, totalCost=?, avgCost=?, lastPrice=?, marketValue=?, updatedAt=datetime('now') WHERE id=?")
          .run(shares, totalCost, totalCost / shares, t.price, shares * t.price, pos.id);
      } else {
        db.prepare("INSERT INTO positions (symbol, shares, lastPrice, avgCost, totalCost, marketValue) VALUES (?, ?, ?, ?, ?, ?)")
          .run(t.symbol, t.shares, t.price, t.price, gross, gross);
      }
    } else if (pos) {
      const shares = pos.shares - t.shares;
      if (shares <= 1e-9) db.prepare("DELETE FROM positions WHERE id = ?").run(pos.id);
      else {
        const totalCost = Math.max(0, pos.totalCost - gross);
        db.prepare("UPDATE positions SET shares=?, totalCost=?, avgCost=?, marketValue=?, updatedAt=datetime('now') WHERE id=?")
          .run(shares, totalCost, totalCost / shares, shares * pos.lastPrice, pos.id);
      }
    }
    cash -= direction * (gross + (t.amount || 0)); // amount on a buy = commission/fees
  } else if (t.type === "sell") {
    if (direction === 1) {
      if (!pos || pos.shares + 1e-9 < t.shares) throw Object.assign(new Error(`The fund doesn't hold ${t.shares} shares of ${t.symbol}.`), { status: 400 });
      const shares = pos.shares - t.shares;
      if (shares <= 1e-9) db.prepare("DELETE FROM positions WHERE id = ?").run(pos.id);
      else {
        const totalCost = pos.totalCost - t.costBasis;
        db.prepare("UPDATE positions SET shares=?, totalCost=?, lastPrice=?, marketValue=?, updatedAt=datetime('now') WHERE id=?")
          .run(shares, totalCost, t.price, shares * t.price, pos.id);
      }
    } else {
      // Reverse a sell: restore the shares at their original cost basis.
      if (pos) {
        const shares = pos.shares + t.shares, totalCost = pos.totalCost + t.costBasis;
        db.prepare("UPDATE positions SET shares=?, totalCost=?, avgCost=?, marketValue=?, updatedAt=datetime('now') WHERE id=?")
          .run(shares, totalCost, totalCost / shares, shares * pos.lastPrice, pos.id);
      } else {
        db.prepare("INSERT INTO positions (symbol, shares, lastPrice, avgCost, totalCost, marketValue) VALUES (?, ?, ?, ?, ?, ?)")
          .run(t.symbol, t.shares, t.price, t.costBasis / t.shares, t.costBasis, t.shares * t.price);
      }
    }
    cash += direction * (gross - (t.amount || 0));
  } else if (t.type === "dividend") {
    if (pos) db.prepare("UPDATE positions SET divIncome = divIncome + ? WHERE id = ?").run(direction * t.amount, pos.id);
    cash += direction * t.amount;
  } else if (t.type === "deposit") {
    cash += direction * t.amount;
  } else if (t.type === "withdrawal" || t.type === "fee") {
    cash -= direction * t.amount;
  }
  setSettings({ cash: Math.round(cash * 100) / 100 });
}

const recordTransaction = db.transaction((input) => {
  const t = { amount: 0, shares: 0, price: 0, symbol: "", note: "", pitchId: null, createdBy: "", costBasis: null, realizedGain: null, ...input };
  if (t.type === "sell") {
    const pos = db.prepare("SELECT * FROM positions WHERE symbol = ?").get(t.symbol);
    if (pos) {
      t.costBasis = (pos.totalCost / pos.shares) * t.shares;
      t.realizedGain = t.shares * t.price - (t.amount || 0) - t.costBasis;
    }
  }
  applyTransaction(t, 1);
  const info = db.prepare(`
    INSERT INTO transactions (date, type, symbol, shares, price, amount, note, pitchId, costBasis, realizedGain, createdBy)
    VALUES (@date, @type, @symbol, @shares, @price, @amount, @note, @pitchId, @costBasis, @realizedGain, @createdBy)
  `).run(t);
  // Cash flows in/out of the fund are what time-weighted return must strip out.
  if (t.type === "deposit" || t.type === "withdrawal") {
    db.prepare(`INSERT INTO nav_history (date, totalValue, netFlow) VALUES (?, 0, ?)
      ON CONFLICT(date) DO UPDATE SET netFlow = netFlow + excluded.netFlow`).run(t.date, t.type === "deposit" ? t.amount : -t.amount);
  }
  return db.prepare("SELECT * FROM transactions WHERE id = ?").get(info.lastInsertRowid);
});

const deleteTransaction = db.transaction((id) => {
  const t = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  if (!t) return null;
  applyTransaction(t, -1);
  if (t.type === "deposit" || t.type === "withdrawal") {
    db.prepare("UPDATE nav_history SET netFlow = netFlow - ? WHERE date = ?").run(t.type === "deposit" ? t.amount : -t.amount, t.date);
  }
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return t;
});

// ---- Sectors / allocation / investment-policy compliance ----

async function sectorsFor(symbols) {
  const out = {};
  const queue = [...symbols];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      try { out[s] = await yahoo.getSector(s); } catch { out[s] = { sector: "", industry: "", name: "" }; }
    }
  }));
  return out;
}

// `benchmark` overrides the fund's official one for the sector comparison (a member's own pick).
async function allocation(benchmark = null) {
  const s = { ...getSettings(), ...(benchmark ? { benchmark } : {}) };
  const stored = db.prepare("SELECT * FROM positions ORDER BY symbol").all();
  // Value holdings at live prices when available (the stored price is only a fallback).
  const [sectors, live] = await Promise.all([
    sectorsFor(stored.map((p) => p.symbol)),
    latestPrices(stored.map((p) => p.symbol)).catch(() => ({})),
  ]);
  const positions = stored.map((p) => (live[p.symbol]?.price ? { ...p, marketValue: p.shares * live[p.symbol].price } : p));
  // Compare with the fund's benchmark when it has a sector breakdown (equity ETFs and blends of
  // them); otherwise (bonds, single stocks, price indices) fall back to the S&P 500.
  let sectorSource = s.benchmark;
  let { weights: benchWeights, coverage } = await benchmarks.sectorWeights(s.benchmark).catch(() => ({ weights: {}, coverage: 0 }));
  if (!Object.keys(benchWeights).length) {
    sectorSource = "SPY";
    ({ weights: benchWeights, coverage } = await benchmarks.sectorWeights("SPY").catch(() => ({ weights: {}, coverage: 0 })));
  }

  const invested = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const total = invested + s.cash;
  const bySector = {};
  const rows = positions.map((p) => {
    const sector = sectors[p.symbol]?.sector || "Unclassified";
    // Rounded to the 0.1% shown in the UI, so "10.0% (limit 10%)" is never flagged as a breach.
    const weight = total ? Math.round((p.marketValue / total) * 1000) / 10 : 0;
    bySector[sector] = bySector[sector] || { sector, value: 0, weight: 0, symbols: [] };
    bySector[sector].value += p.marketValue;
    bySector[sector].weight += weight;
    bySector[sector].symbols.push(p.symbol);
    return { symbol: p.symbol, name: sectors[p.symbol]?.name || "", sector, industry: sectors[p.symbol]?.industry || "", value: p.marketValue, weight };
  });
  const sectorRows = Object.values(bySector)
    .map((r) => ({ ...r, benchmarkWeight: benchWeights[r.sector] ?? null, active: benchWeights[r.sector] !== undefined ? r.weight - benchWeights[r.sector] : null }))
    .sort((a, b) => b.weight - a.weight);
  // Benchmark sectors the fund has no exposure to at all.
  for (const [sector, w] of Object.entries(benchWeights)) {
    if (!bySector[sector]) sectorRows.push({ sector, value: 0, weight: 0, symbols: [], benchmarkWeight: w, active: -w });
  }

  const cashPct = total ? (s.cash / total) * 100 : 0;
  // Each rule only applies when its limit is set (null = not set).
  const has = (v) => v !== null && v !== undefined;
  const checks = [
    ...rows.filter((r) => has(s.maxPositionPct) && r.weight > s.maxPositionPct).map((r) => ({
      level: "breach", rule: "Max position size", detail: `${r.symbol} is ${r.weight.toFixed(1)}% of the fund (limit ${s.maxPositionPct}%).`, symbol: r.symbol,
    })),
    ...sectorRows.filter((r) => has(s.maxSectorPct) && r.weight > s.maxSectorPct).map((r) => ({
      level: "breach", rule: "Max sector weight", detail: `${r.sector} is ${r.weight.toFixed(1)}% of the fund (limit ${s.maxSectorPct}%).`,
    })),
    has(s.minPositions) && positions.length < s.minPositions && { level: "breach", rule: "Minimum holdings", detail: `${positions.length} positions (policy minimum ${s.minPositions}).` },
    has(s.maxPositions) && positions.length > s.maxPositions && { level: "breach", rule: "Maximum holdings", detail: `${positions.length} positions (policy maximum ${s.maxPositions}).` },
    has(s.minCashPct) && cashPct < s.minCashPct && { level: "breach", rule: "Minimum cash", detail: `Cash is ${cashPct.toFixed(1)}% (policy minimum ${s.minCashPct}%).` },
    ...rows.filter((r) => has(s.maxPositionPct) && r.weight > s.maxPositionPct * 0.85 && r.weight <= s.maxPositionPct).map((r) => ({
      level: "watch", rule: "Approaching position limit", detail: `${r.symbol} is ${r.weight.toFixed(1)}% (limit ${s.maxPositionPct}%).`, symbol: r.symbol,
    })),
  ].filter(Boolean);

  // Duplicate exposure: share classes of the same company (e.g. GOOG + GOOGL).
  const byName = {};
  rows.forEach((r) => { if (r.name) (byName[r.name] = byName[r.name] || []).push(r); });
  for (const group of Object.values(byName)) {
    if (group.length > 1) {
      const w = group.reduce((sum, r) => sum + r.weight, 0);
      checks.push({
        level: has(s.maxPositionPct) && w > s.maxPositionPct ? "breach" : "watch",
        rule: "Same company, multiple tickers",
        detail: `${group.map((r) => r.symbol).join(" + ")} are both ${group[0].name}: ${w.toFixed(1)}% combined${has(s.maxPositionPct) && w > s.maxPositionPct ? ` (limit ${s.maxPositionPct}%)` : ""}.`,
      });
    }
  }

  return { total, invested, cash: s.cash, cashPct, settings: s, positions: rows, sectors: sectorRows, checks, benchmark: s.benchmark, benchmarkLabel: benchmarks.label(s.benchmark),
    sectorBenchmark: sectorSource, sectorBenchmarkLabel: benchmarks.label(sectorSource), sectorCoverage: coverage };
}

// ---- Daily valuation snapshot (for time-weighted performance) ----

let lastPricePersist = 0;

// Dated by the market's latest close (not the wall clock), so it can run any time — weekends,
// after a sleeping host wakes up — and repeated runs on the same day just refresh that row.
async function snapshot(date) {
  const s = getSettings();
  const positions = db.prepare("SELECT symbol, shares, marketValue FROM positions").all();
  const comps = benchmarks.parse(s.benchmark);
  const prices = await latestPrices([...positions.map((p) => p.symbol), ...comps.map((c) => c.symbol), "SPY"]);
  date = date || prices.SPY?.date || new Date().toISOString().slice(0, 10);
  const detail = positions.map((p) => {
    const price = prices[p.symbol]?.price;
    return { symbol: p.symbol, shares: p.shares, value: price ? price * p.shares : p.marketValue };
  });
  const invested = detail.reduce((sum, p) => sum + p.value, 0);
  // Keep each holding's stored price current, so the fallback (used when live quotes are
  // unavailable) is never more than a day old.
  // Throttled to every 30 minutes, since snapshots also run when Performance is opened.
  if (Date.now() - lastPricePersist > 30 * 60 * 1000) {
    lastPricePersist = Date.now();
    const upd = db.prepare("UPDATE positions SET lastPrice = ?, marketValue = ?, updatedAt = datetime('now') WHERE symbol = ?");
    for (const p of positions) {
      const price = prices[p.symbol]?.price;
      if (price) upd.run(price, price * p.shares, p.symbol);
    }
  }
  db.prepare(`
    INSERT INTO nav_history (date, totalValue, cash, benchmarkClose, positions) VALUES (@date, @totalValue, @cash, @benchmarkClose, @positions)
    ON CONFLICT(date) DO UPDATE SET totalValue = excluded.totalValue, cash = excluded.cash,
      benchmarkClose = excluded.benchmarkClose, positions = excluded.positions
  `).run({ date, totalValue: invested + s.cash, cash: s.cash, benchmarkClose: comps.length === 1 ? prices[comps[0].symbol]?.price ?? null : null, positions: JSON.stringify(detail) });
  return { date, totalValue: invested + s.cash };
}

// Time-weighted return from snapshots: each day's return strips out that day's net flow.
// The benchmark line comes from its own price history (so any benchmark or blend works, and
// changing the benchmark later re-draws the comparison for the whole period).
function twr(history, benchSeries = []) {
  // Fold cash flows recorded on days without a valuation into the next valued day, so a
  // deposit is never mistaken for investment gains.
  const rows = [];
  let pendingFlow = 0;
  for (const h of history) {
    if (h.totalValue > 0) { rows.push({ ...h, netFlow: (h.netFlow || 0) + pendingFlow }); pendingFlow = 0; }
    else pendingFlow += h.netFlow || 0;
  }
  if (rows.length < 2) return null;
  const benchOn = (date) => {
    let v = null;
    for (const p of benchSeries) { if (p.date <= date) v = p.close; else break; }
    return v;
  };
  const b0 = benchOn(rows[0].date);
  const series = [{ date: rows[0].date, index: 100, bench: b0 ? 100 : null }];
  let idx = 100;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    idx *= (cur.totalValue - cur.netFlow) / prev.totalValue;
    const b = benchOn(cur.date);
    series.push({ date: cur.date, index: idx, bench: b0 && b ? (b / b0) * 100 : null });
  }
  const lastBench = series.at(-1).bench;
  return { series, totalReturn: idx / 100 - 1, benchReturn: lastBench !== null ? lastBench / 100 - 1 : null };
}

module.exports = { recordTransaction, deleteTransaction, allocation, snapshot, twr, sectorsFor };
