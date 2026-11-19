// Portfolio-level risk: where the fund's risk actually comes from, how bad a bad day or month
// has been, and what a market sell-off would do. Pure math over daily close series
// ({ date, close }); the route does the data gathering. Everything is measured on today's
// holdings and weights (a "what we own now" view, like the Performance page).

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Daily returns keyed by date, so series with different start dates can be aligned.
function returnsByDate(series) {
  const out = new Map();
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1].close > 0) out.set(series[i].date, series[i].close / series[i - 1].close - 1);
  }
  return out;
}

// Aligned return matrix for the holdings. A holding with too little history (a recent IPO)
// would shrink the shared window for everyone, so holdings are dropped, newest first, until
// the shared window reaches `minDays`. Dropped ones are reported, never silently ignored.
function returnMatrix(histories, { minDays = 120, floorDays = 40 } = {}) {
  const byDate = Object.entries(histories).filter(([, h]) => h?.length > 1).map(([s, h]) => [s, returnsByDate(h)]);
  const used = byDate.slice();
  const dropped = [];
  const common = (list) => {
    if (!list.length) return [];
    return [...list[0][1].keys()].filter((d) => list.every(([, m]) => m.has(d))).sort();
  };
  let dates = common(used);
  while (dates.length < minDays && used.length > 1) {
    // Drop the holding with the fewest returns.
    let k = 0;
    used.forEach(([, m], i) => { if (m.size < used[k][1].size) k = i; });
    dropped.push(used.splice(k, 1)[0][0]);
    dates = common(used);
  }
  if (dates.length < floorDays) return null;
  const symbols = used.map(([s]) => s);
  const rows = dates.map((d) => used.map(([, m]) => m.get(d)));
  return { symbols, dates, rows, dropped };
}

// Sample covariance matrix of the columns of `rows`.
function covMatrix(rows) {
  const n = rows.length, k = rows[0].length;
  const mu = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j])));
  const cov = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const r of rows) {
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) cov[a][b] += (r[a] - mu[a]) * (r[b] - mu[b]);
  }
  for (let a = 0; a < k; a++) for (let b = a; b < k; b++) { cov[a][b] /= n - 1; cov[b][a] = cov[a][b]; }
  return cov;
}

// Share of portfolio variance each holding is responsible for (they sum to 1):
// w_i * (Cov w)_i / (w' Cov w). A small, volatile or highly correlated position can carry far
// more risk than its weight suggests, and a diversifier can carry less.
function riskContributions(weights, cov) {
  const k = weights.length;
  const cw = cov.map((row) => row.reduce((s, c, j) => s + c * weights[j], 0));
  const variance = weights.reduce((s, w, i) => s + w * cw[i], 0);
  if (!(variance > 0)) return null;
  return { variance, shares: weights.map((w, i) => (w * cw[i]) / variance), k };
}

// Historical (non-parametric) loss measures from daily portfolio returns.
// VaR = the loss that was exceeded on only (1 - level) of days; expected shortfall = the average
// loss on those days. Both returned as positive loss fractions.
function lossStats(returns, level = 0.95) {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * (1 - level)));
  const tail = sorted.slice(0, cut);
  return { var: -sorted[cut - 1], expectedShortfall: -mean(tail), worstDay: -sorted[0], days: returns.length, tailDays: cut };
}

// Worst compounded return over any `window` consecutive days.
function worstWindow(dates, returns, window) {
  if (returns.length < window) return null;
  let worst = Infinity, at = 0;
  const logs = returns.map((r) => Math.log1p(r));
  let sum = 0;
  for (let i = 0; i < returns.length; i++) {
    sum += logs[i];
    if (i >= window) sum -= logs[i - window];
    if (i >= window - 1 && sum < worst) { worst = sum; at = i; }
  }
  return { ret: Math.expm1(worst), start: dates[at - window + 1], end: dates[at] };
}

// Drawdown of a return stream: running peak of cumulative value, current depth, and the series.
function drawdownStats(dates, returns) {
  let value = 1, peak = 1, peakDate = dates[0], maxDd = 0, maxPeak = dates[0], maxTrough = dates[0];
  const series = [];
  returns.forEach((r, i) => {
    value *= 1 + r;
    if (value > peak) { peak = value; peakDate = dates[i]; }
    const dd = value / peak - 1;
    if (dd < maxDd) { maxDd = dd; maxPeak = peakDate; maxTrough = dates[i]; }
    series.push({ date: dates[i], dd });
  });
  const current = series.at(-1)?.dd ?? 0;
  const days = peakDate && dates.length ? Math.round((new Date(dates.at(-1)) - new Date(peakDate)) / 864e5) : 0;
  return { current, peakDate, daysSincePeak: days, max: maxDd, maxPeak, maxTrough, series };
}

// OLS beta of a stream on a benchmark stream (same length, same dates).
function betaOf(r, b) {
  const mr = mean(r), mb = mean(b);
  let c = 0, v = 0;
  for (let i = 0; i < r.length; i++) { c += (r[i] - mr) * (b[i] - mb); v += (b[i] - mb) ** 2; }
  return v > 0 ? c / v : null;
}

// Betas of each used holding (columns of mat) and the portfolio to a benchmark series.
function betasTo(mat, portRet, bench) {
  const out = { betas: {}, portBeta: null };
  const br = bench?.length > 1 ? returnsByDate(bench) : null;
  if (!br) return out;
  const idx = mat.dates.map((d, i) => (br.has(d) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 40) return out;
  const b = idx.map((i) => br.get(mat.dates[i]));
  mat.symbols.forEach((s, j) => { out.betas[s] = betaOf(idx.map((i) => mat.rows[i][j]), b); });
  out.portBeta = betaOf(idx.map((i) => portRet[i]), b);
  return out;
}

// Days to sell a position without being more than `participation` of the day's volume,
// from the median dollar volume of the last `window` sessions. Median, so one meme day or
// index-rebalance day doesn't make a thin stock look liquid.
function liquidity(histories, values, { participation = 0.2, window = 30 } = {}) {
  const rows = [];
  for (const [symbol, value] of Object.entries(values)) {
    const h = histories[symbol];
    const recent = (h || []).slice(-window).map((p) => p.close * p.volume).filter((x) => Number.isFinite(x) && x > 0);
    if (recent.length < 10 || !(value > 0)) { rows.push({ symbol, value, adv: null, days: null }); continue; }
    recent.sort((a, b) => a - b);
    const adv = recent[Math.floor(recent.length / 2)];
    rows.push({ symbol, value, adv, days: value / (participation * adv) });
  }
  const known = rows.filter((r) => r.days !== null);
  const total = known.reduce((s, r) => s + r.value, 0);
  const within = (d) => (total ? known.filter((r) => r.days <= d).reduce((s, r) => s + r.value, 0) / total : null);
  return {
    participation, window,
    rows: rows.sort((a, b) => (b.days ?? -1) - (a.days ?? -1)),
    withinDay: within(1), withinWeek: within(5),
    slowest: known.filter((r) => r.days > 1).sort((a, b) => b.days - a.days).slice(0, 3),
    unknown: rows.filter((r) => r.days === null).map((r) => r.symbol),
  };
}

// Historical equity sell-offs, applied through each holding's beta to SPY. Dates are the
// peak-to-trough window; the SPY move is measured from the data when it covers the window.
const EPISODES = [
  { id: "covid", name: "COVID crash", from: "2020-02-19", to: "2020-03-23" },
  { id: "bear2022", name: "2022 bear market", from: "2022-01-03", to: "2022-10-12" },
  { id: "q4-2018", name: "Late 2018 sell-off", from: "2018-09-20", to: "2018-12-24" },
  { id: "aug-2024", name: "Summer 2024 sell-off", from: "2024-07-16", to: "2024-08-05" },
];

function episodeMoves(spy10y) {
  if (!spy10y?.length) return [];
  const at = (date, dir) => (dir === "on_or_after" ? spy10y.find((p) => p.date >= date) : [...spy10y].reverse().find((p) => p.date <= date));
  const out = [];
  for (const e of EPISODES) {
    const a = at(e.from, "on_or_after"), b = at(e.to, "on_or_before");
    // Only when the history truly covers the window (both ends within a week of the dates).
    if (!a || !b || Math.abs(new Date(a.date) - new Date(e.from)) > 7 * 864e5 || Math.abs(new Date(b.date) - new Date(e.to)) > 7 * 864e5) continue;
    out.push({ ...e, spyMove: b.close / a.close - 1 });
  }
  return out;
}

// Scenario losses: each holding falls by beta x market move (a rough, linear stand-in; real
// crashes push correlations up, so treat it as a floor, not a forecast). `positions` are
// { symbol, value, beta }; value is dollars. Positions with no beta are assumed beta 1.
function scenario(positions, marketMove, fundTotal) {
  const rows = positions.map((p) => {
    const beta = Number.isFinite(p.beta) ? p.beta : 1;
    const loss = p.value * beta * marketMove;
    return { symbol: p.symbol, beta, change: loss };
  });
  const total = rows.reduce((s, r) => s + r.change, 0);
  return { marketMove, change: total, changePct: fundTotal ? total / fundTotal : null, worst: rows.sort((a, b) => a.change - b.change).slice(0, 3) };
}

// Plain-English read of the numbers, only what is worth saying (no padding).
function observations({ rows, effectiveBets, effectiveHoldings, loss, drawdown }) {
  const out = [];
  const top3 = [...rows].sort((a, b) => b.riskShare - a.riskShare).slice(0, 3);
  const top3Share = top3.reduce((s, r) => s + r.riskShare, 0);
  if (rows.length >= 6 && top3Share >= 0.4) out.push(`${top3.map((r) => r.symbol).join(", ")} account for ${Math.round(top3Share * 100)}% of the fund's risk.`);
  const hidden = rows.filter((r) => r.riskShare >= 0.08 && r.riskShare >= r.weight * 2).sort((a, b) => b.riskShare / b.weight - a.riskShare / a.weight)[0];
  if (hidden) out.push(`${hidden.symbol} is ${(hidden.weight * 100).toFixed(1)}% of the fund but ${(hidden.riskShare * 100).toFixed(1)}% of the risk: it's more volatile or more correlated with the rest than its size suggests.`);
  if (effectiveBets && effectiveHoldings && effectiveBets < effectiveHoldings * 0.5) {
    out.push(`${rows.length} holdings behave like about ${effectiveBets.toFixed(1)} independent bets once correlation and volatility are counted.`);
  }
  if (loss && drawdown && drawdown.current <= -0.1) out.push(`Holdings are ${(Math.abs(drawdown.current) * 100).toFixed(1)}% below their peak from ${drawdown.peakDate}.`);
  return out;
}

function liqNotes(liq) {
  const out = [];
  const slow = liq.slowest.filter((r) => r.days > 5);
  if (slow.length) out.push(`${slow.map((r) => `${r.symbol} (${r.days.toFixed(1)} days)`).join(", ")} would take more than a week to sell at ${Math.round(liq.participation * 100)}% of daily volume.`);
  return out;
}

// Everything in one call. `histories`: { SYMBOL: [{date, close}] } (1y daily), `spy`: SPY daily
// closes covering the same window (for betas), `spyLong`: SPY 10y (for the episodes, optional),
// `values`: { SYMBOL: dollars }, `cash`: dollars of cash.
function portfolioRisk({ histories, spy, spyLong = null, growth = null, values, cash = 0, limits = {} }) {
  const covered = Object.fromEntries(Object.entries(histories).filter(([s, h]) => h?.length > 1 && values[s] > 0));
  const mat = returnMatrix(covered);
  if (!mat) return null;
  const invested = Object.values(values).reduce((s, v) => s + (v || 0), 0);
  const fundTotal = invested + cash;
  const usedValue = mat.symbols.reduce((s, sym) => s + values[sym], 0);
  const w = mat.symbols.map((s) => values[s] / usedValue);          // weights within what we could measure
  const wFund = mat.symbols.map((s) => values[s] / fundTotal);      // weights of the whole fund (cash counts)

  const cov = covMatrix(mat.rows);
  const rc = riskContributions(w, cov);
  if (!rc) return null;
  const dailyVol = Math.sqrt(rc.variance);
  const portRet = mat.rows.map((r) => r.reduce((s, x, j) => s + x * w[j], 0));

  const { betas, portBeta } = betasTo(mat, portRet, spy);

  const rows = mat.symbols.map((s, j) => ({
    symbol: s,
    value: values[s],
    weight: wFund[j],
    riskShare: rc.shares[j],
    // >1 means the holding adds more risk than its size; <1 means it dampens risk.
    riskVsWeight: w[j] > 0 ? rc.shares[j] / w[j] : null,
    volatility: Math.sqrt(cov[j][j] * 252),
    beta: betas[s] ?? null,
  })).sort((a, b) => b.riskShare - a.riskShare);

  const effectiveBets = 1 / rc.shares.reduce((s, x) => s + x * x, 0);
  const effectiveHoldings = 1 / w.reduce((s, x) => s + x * x, 0);

  // Dollar loss measures use the whole fund (cash is risk-free here), so they scale by the
  // measured holdings' share of the fund.
  const scale = usedValue / fundTotal;
  const l95 = lossStats(portRet, 0.95);
  const loss = l95 && {
    level: 0.95,
    oneDayVar: l95.var * scale, oneDayVarUsd: l95.var * usedValue,
    expectedShortfall: l95.expectedShortfall * scale, expectedShortfallUsd: l95.expectedShortfall * usedValue,
    worstDay: l95.worstDay * scale, worstDayUsd: l95.worstDay * usedValue,
    days: l95.days,
    worst5: worstWindow(mat.dates, portRet, 5),
    worst21: worstWindow(mat.dates, portRet, 21),
  };
  if (loss) for (const k of ["worst5", "worst21"]) if (loss[k]) { loss[k].ret *= scale; loss[k].usd = loss[k].ret * fundTotal; }

  const drawdown = drawdownStats(mat.dates, portRet);

  // Scenarios: parallel market shocks, plus past episodes when long SPY history is available.
  const posBeta = mat.symbols.map((s) => ({ symbol: s, value: values[s], beta: betas[s] }));
  const shocks = [-0.1, -0.2, -0.3].map((m) => scenario(posBeta, m, fundTotal));
  const episodes = episodeMoves(spyLong).map((e) => ({ ...e, ...scenario(posBeta, e.spyMove, fundTotal) }));

  // Growth sell-off: the same idea through beta to a growth index (Nasdaq-100), which fits this
  // fund's tech-heavy book better than the S&P 500 alone.
  const g = betasTo(mat, portRet, growth);
  const growthShocks = growth && g.portBeta != null
    ? [-0.15, -0.25].map((m) => scenario(mat.symbols.map((s) => ({ symbol: s, value: values[s], beta: g.betas[s] })), m, fundTotal))
    : [];
  const liq = liquidity(histories, values);
  const policy = [];
  if (Number.isFinite(limits.maxPositionPct)) {
    for (const x of rows) if (x.riskShare * 100 > limits.maxPositionPct) policy.push(`${x.symbol} is ${(x.riskShare * 100).toFixed(1)}% of the fund's risk, above the ${limits.maxPositionPct}% single-position limit (it is ${(x.weight * 100).toFixed(1)}% of the fund by value).`);
  }

  return {
    asOf: mat.dates.at(-1), start: mat.dates[0], days: mat.dates.length,
    fund: { total: fundTotal, invested, cash, cashPct: fundTotal ? cash / fundTotal : 0, measuredPct: invested ? usedValue / invested : 0 },
    dropped: [...new Set([...mat.dropped, ...Object.keys(values).filter((s) => !covered[s])])],
    volatility: dailyVol * Math.sqrt(252) * scale,
    beta: portBeta != null ? portBeta * scale : null,
    effectiveBets, effectiveHoldings,
    rows, loss, drawdown: { ...drawdown, series: drawdown.series },
    shocks, episodes, growthShocks, growthBeta: g.portBeta != null ? g.portBeta * scale : null, liquidity: liq, policy,
    notes: [...policy, ...observations({ rows, effectiveBets, effectiveHoldings, loss, drawdown }), ...liqNotes(liq)],
  };
}

module.exports = { portfolioRisk, liquidity, returnMatrix, covMatrix, riskContributions, lossStats, worstWindow, drawdownStats, episodeMoves, scenario, betaOf };
