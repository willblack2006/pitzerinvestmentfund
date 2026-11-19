// Fund cockpit math: period returns, contribution (what moved the fund), daily return
// calendars, rolling stats, drawdowns, return distributions and Brinson attribution.
// Pure functions over daily close series ([{ date, close }], oldest first) so every number
// on the cockpit is unit-testable without a network. The route (routes/cockpit.js) gathers data.
//
// Basis: like the Performance page, period returns are measured on today's holdings ("what we
// own now"), because the fund's own ledger is short. Cash is part of the fund and earns zero,
// so it dilutes returns the way it really does. When the NAV ledger covers a period, the route
// can report the ledger number alongside.

const PERIOD_KEYS = ["1d", "5d", "mtd", "1m", "3m", "ytd", "1y"];
const PERIOD_LABELS = { "1d": "Today", "5d": "5 days", mtd: "Month to date", "1m": "1 month", "3m": "3 months", ytd: "Year to date", "1y": "1 year" };

const isoMinusMonths = (iso, months) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

const clean = (series) => (series || []).filter((p) => p && p.date && Number.isFinite(p.close) && p.close > 0);

// The date each period is measured FROM (the base is the last close on or before this date,
// except mtd/ytd which use the last close strictly before the month/year starts).
function periodStart(period, latest) {
  switch (period) {
    case "mtd": return { date: `${latest.slice(0, 7)}-01`, strict: true };
    case "ytd": return { date: `${latest.slice(0, 4)}-01-01`, strict: true };
    case "1m": return { date: isoMinusMonths(latest, 1), strict: false };
    case "3m": return { date: isoMinusMonths(latest, 3), strict: false };
    case "1y": return { date: isoMinusMonths(latest, 12), strict: false };
    default: return null;
  }
}

// Last close on/before `date` (or strictly before when `strict`). null when the series starts later.
function closeOn(series, date, strict = false) {
  let hit = null;
  for (const p of series) {
    if (strict ? p.date < date : p.date <= date) hit = p;
    else break;
  }
  return hit;
}

// Base close for one series and period. "1d" is the previous close; "5d" five sessions back.
function baseFor(series, period, latest) {
  const s = clean(series);
  if (!s.length) return null;
  latest = latest || s.at(-1).date;
  const upto = s.filter((p) => p.date <= latest);
  if (period === "1d") return upto.length > 1 ? upto.at(-2) : null;
  if (period === "5d") return upto.length > 5 ? upto.at(-6) : null;
  if (period === "custom") return null;
  const start = periodStart(period, latest);
  return start ? closeOn(upto, start.date, start.strict) : null;
}

// Per-period return for a series, ending at its latest close (or `endPrice` when a live
// price is newer than the last daily bar).
function periodReturns(series, { endPrice = null, latest = null } = {}) {
  const s = clean(series);
  const out = Object.fromEntries(PERIOD_KEYS.map((k) => [k, null]));
  if (!s.length) return out;
  const end = Number.isFinite(endPrice) && endPrice > 0 ? endPrice : s.at(-1).close;
  for (const k of PERIOD_KEYS) {
    const b = baseFor(s, k, latest);
    out[k] = b ? end / b.close - 1 : null;
  }
  return out;
}

// Contribution of each holding to the fund's return between two dates, on today's share
// counts. Each holding's contribution = shares × price change / fund value at the start
// (cash included at zero return). They sum exactly to the fund's return, which is what a
// waterfall needs. `prices` overrides the end price (live quote) per symbol.
// positions: [{ symbol, shares }], histories: { SYM: series }, cash: number.
function contribution({ positions, histories, cash = 0, from, to = null, prices = {} }) {
  const rows = [];
  let startTotal = cash, endTotal = cash;
  const missing = [];
  const isPeriod = PERIOD_KEYS.includes(from);
  // One "latest" date for every holding, so a stock with a stale last bar uses the same frame.
  const latest = to || positions.map((p) => clean(histories[p.symbol]).at(-1)?.date).filter(Boolean).sort().at(-1);
  for (const p of positions) {
    const s = clean(histories[p.symbol]);
    // A period key uses the period's own base rule; a custom date means "from the close before that day".
    const base = s.length ? (isPeriod ? baseFor(s, from, latest) : closeOn(s, from, true)) : null;
    const endBar = to ? closeOn(s, to) : s.at(-1);
    const endPrice = !to && Number.isFinite(prices[p.symbol]) ? prices[p.symbol] : endBar?.close;
    if (!base || !Number.isFinite(endPrice)) { missing.push(p.symbol); continue; }
    const startValue = base.close * p.shares, endValue = endPrice * p.shares;
    startTotal += startValue; endTotal += endValue;
    rows.push({ symbol: p.symbol, startValue, endValue, return: endPrice / base.close - 1, baseDate: base.date });
  }
  for (const r of rows) {
    r.startWeight = startTotal ? r.startValue / startTotal : 0;
    r.contribution = startTotal ? (r.endValue - r.startValue) / startTotal : 0;
  }
  rows.sort((a, b) => b.contribution - a.contribution);
  const fundReturn = startTotal ? endTotal / startTotal - 1 : null;
  const cashWeight = startTotal ? cash / startTotal : 0;
  return { rows, fundReturn, startTotal, endTotal, cashWeight, missing };
}

// Daily value of today's holdings (+ cash) over time, on dates where every covered holding
// has a close. Returns [{ date, close }] (close = fund value in dollars).
function holdingsValueSeries(positions, histories, cash = 0) {
  const covered = positions.filter((p) => clean(histories[p.symbol]).length);
  if (!covered.length) return { series: [], covered: [] };
  const byDate = new Map(), counts = new Map();
  for (const p of covered) {
    for (const pt of clean(histories[p.symbol])) {
      byDate.set(pt.date, (byDate.get(pt.date) || 0) + pt.close * p.shares);
      counts.set(pt.date, (counts.get(pt.date) || 0) + 1);
    }
  }
  const series = [...byDate.entries()]
    .filter(([d]) => counts.get(d) === covered.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, close: v + cash }));
  return { series, covered: covered.map((p) => p.symbol) };
}

// Daily returns keyed by the date the move lands on.
function dailyReturns(series) {
  const s = clean(series);
  const out = [];
  for (let i = 1; i < s.length; i++) out.push({ date: s[i].date, ret: s[i].close / s[i - 1].close - 1 });
  return out;
}

// Fund and benchmark daily returns side by side, for the calendar heatmap.
function dailyCalendar(fundSeries, benchSeries) {
  const bench = new Map(dailyReturns(benchSeries).map((r) => [r.date, r.ret]));
  return dailyReturns(fundSeries).map((r) => ({ date: r.date, ret: r.ret, bench: bench.has(r.date) ? bench.get(r.date) : null }));
}

// Calendar-month returns (compounded daily) for a year × month grid.
function monthlyReturns(series) {
  const s = clean(series);
  const out = [];
  let prevClose = null, cur = null;
  for (const p of s) {
    const m = p.date.slice(0, 7);
    if (!cur || cur.month !== m) {
      if (cur) out.push(cur);
      cur = { month: m, startClose: prevClose ?? p.close, endClose: p.close, partial: prevClose === null };
    }
    cur.endClose = p.close;
    prevClose = p.close;
  }
  if (cur) out.push(cur);
  return out.map((m) => ({ month: m.month, ret: m.endClose / m.startClose - 1, partial: m.partial }));
}

// Align two series on common dates.
function alignPair(a, b) {
  const mb = new Map(clean(b).map((p) => [p.date, p.close]));
  const dates = [], va = [], vb = [];
  for (const p of clean(a)) if (mb.has(p.date)) { dates.push(p.date); va.push(p.close); vb.push(mb.get(p.date)); }
  return { dates, a: va, b: vb };
}

// Rebase both to 100 on their first common date; plus fund relative to benchmark (ratio - 1).
function rebased(fundSeries, benchSeries) {
  const { dates, a, b } = alignPair(fundSeries, benchSeries);
  if (dates.length < 2) {
    const s = clean(fundSeries);
    return { dates: s.map((p) => p.date), fund: s.map((p) => (p.close / s[0].close) * 100), bench: s.map(() => null), relative: s.map(() => null) };
  }
  const fund = a.map((v) => (v / a[0]) * 100), bench = b.map((v) => (v / b[0]) * 100);
  return { dates, fund, bench, relative: fund.map((v, i) => v / bench[i] - 1) };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };

// Rolling trailing-window stats from aligned daily closes: total return over the window (fund
// and benchmark), beta to the benchmark and annualized Sharpe (risk-free `rf` per year).
// windows in trading days (63 ≈ 3 months, 126 ≈ 6, 252 ≈ 12). Each point is one window end.
function rollingWindows(fundSeries, benchSeries, windows = [63, 126, 252], rf = 0.04) {
  const { dates, a, b } = alignPair(fundSeries, benchSeries);
  const ra = a.slice(1).map((c, i) => c / a[i] - 1), rb = b.slice(1).map((c, i) => c / b[i] - 1);
  const out = {};
  const rfDaily = rf / 252;
  for (const w of windows) {
    const pts = { dates: [], fund: [], bench: [], beta: [], sharpe: [] };
    if (ra.length >= w) {
      for (let end = w; end <= ra.length; end++) {
        const xa = ra.slice(end - w, end), xb = rb.slice(end - w, end);
        const ma = mean(xa), mb = mean(xb);
        let cov = 0, vb = 0;
        for (let i = 0; i < w; i++) { cov += (xa[i] - ma) * (xb[i] - mb); vb += (xb[i] - mb) ** 2; }
        const sa = sd(xa);
        pts.dates.push(dates[end]);
        pts.fund.push(a[end] / a[end - w] - 1);
        pts.bench.push(b[end] / b[end - w] - 1);
        pts.beta.push(vb > 1e-12 ? cov / vb : null);
        pts.sharpe.push(sa > 1e-12 ? ((ma - rfDaily) / sa) * Math.sqrt(252) : null);
      }
    }
    out[w] = pts;
  }
  return out;
}

// Underwater curve: % below the running peak at each date, plus the worst point and the
// current distance from the peak.
function drawdownSeries(series) {
  const s = clean(series);
  let peak = -Infinity, peakDate = null, worst = 0, worstDate = null, worstPeak = null;
  const points = s.map((p) => {
    if (p.close > peak) { peak = p.close; peakDate = p.date; }
    const dd = p.close / peak - 1;
    if (dd < worst) { worst = dd; worstDate = p.date; worstPeak = peakDate; }
    return { date: p.date, dd };
  });
  const current = points.at(-1)?.dd ?? null;
  // Recovery: first date after the worst trough back at the old peak.
  let recovered = null;
  if (worstDate) {
    const peakClose = s.find((p) => p.date === worstPeak)?.close;
    recovered = s.find((p) => p.date > worstDate && p.close >= peakClose)?.date || null;
  }
  return { points, maxDrawdown: worst, troughDate: worstDate, peakDate: worstPeak, recoveredDate: recovered, current };
}

// Histogram of daily returns with shared bins for fund and benchmark, so the two shapes can
// be compared bar for bar. Bins are `width` wide (default 0.5%), clipped to ±`clip`.
function returnHistogram(fundRets, benchRets = [], { width = 0.005, clip = 0.05 } = {}) {
  const n = Math.round((2 * clip) / width);
  const bins = Array.from({ length: n }, (_, i) => ({ lo: -clip + i * width, hi: -clip + (i + 1) * width, fund: 0, bench: 0 }));
  const put = (r, key) => {
    if (!Number.isFinite(r)) return;
    const i = Math.min(n - 1, Math.max(0, Math.floor((r + clip) / width)));
    bins[i][key]++;
  };
  fundRets.forEach((r) => put(r, "fund"));
  benchRets.forEach((r) => put(r, "bench"));
  const stats = (xs) => {
    const v = xs.filter(Number.isFinite);
    if (v.length < 2) return null;
    const sorted = [...v].sort((x, y) => x - y);
    const m = mean(v), s = sd(v);
    const skew = s > 0 ? mean(v.map((x) => ((x - m) / s) ** 3)) : null;
    return { n: v.length, mean: m, stdev: s, skew, best: sorted.at(-1), worst: sorted[0], upDays: v.filter((x) => x > 0).length / v.length, p5: sorted[Math.floor(0.05 * (v.length - 1))] };
  };
  return { bins, width, clip, fund: stats(fundRets), bench: stats(benchRets) };
}

// Brinson-Fachler attribution by sector. fund/bench: { [sector]: { weight, return } } with
// weights as fractions. benchTotal: the benchmark's own total return over the period.
// allocation = (wf - wb)(rb - Rb); selection = wb(rf - rb); interaction = (wf - wb)(rf - rb).
function brinson(fund, bench, benchTotal) {
  const sectors = [...new Set([...Object.keys(fund), ...Object.keys(bench)])];
  const rows = sectors.map((sector) => {
    const wf = fund[sector]?.weight || 0, wb = bench[sector]?.weight || 0;
    const rf = fund[sector]?.return, rb = bench[sector]?.return;
    const rbx = Number.isFinite(rb) ? rb : benchTotal;     // no sector proxy: assume the index return
    const rfx = Number.isFinite(rf) ? rf : rbx;            // no fund holdings there: no selection effect
    return {
      sector, fundWeight: wf, benchWeight: wb, fundReturn: Number.isFinite(rf) ? rf : null, benchReturn: Number.isFinite(rb) ? rb : null,
      allocation: (wf - wb) * (rbx - benchTotal),
      selection: wb * (rfx - rbx),
      interaction: (wf - wb) * (rfx - rbx),
    };
  }).map((r) => ({ ...r, total: r.allocation + r.selection + r.interaction }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  return { rows, allocation: sum("allocation"), selection: sum("selection"), interaction: sum("interaction"), total: sum("total") };
}

// Sector-level active share: half the sum of absolute weight differences (0 = same sector mix
// as the benchmark, 1 = no overlap). Weights in percent or fractions (consistent per call).
function sectorActiveShare(fundWeights, benchWeights) {
  const keys = new Set([...Object.keys(fundWeights), ...Object.keys(benchWeights)]);
  if (!Object.keys(benchWeights).length) return null;
  const tf = Object.values(fundWeights).reduce((s, v) => s + v, 0) || 1;
  const tb = Object.values(benchWeights).reduce((s, v) => s + v, 0) || 1;
  let d = 0;
  for (const k of keys) d += Math.abs((fundWeights[k] || 0) / tf - (benchWeights[k] || 0) / tb);
  return d / 2;
}

// Market-cap buckets by weight. caps: { SYM: marketCap }, weights: { SYM: fraction }.
const CAP_BUCKETS = [
  { key: "mega", label: "Mega (over $200B)", min: 200e9 },
  { key: "large", label: "Large ($10B to $200B)", min: 10e9 },
  { key: "mid", label: "Mid ($2B to $10B)", min: 2e9 },
  { key: "small", label: "Small ($300M to $2B)", min: 300e6 },
  { key: "micro", label: "Micro (under $300M)", min: 0 },
];
function capBuckets(caps, weights) {
  const out = CAP_BUCKETS.map((b) => ({ ...b, weight: 0, symbols: [] }));
  const unknown = { key: "unknown", label: "Unknown", weight: 0, symbols: [] };
  for (const [sym, w] of Object.entries(weights)) {
    const c = caps[sym];
    const b = Number.isFinite(c) && c > 0 ? out.find((x) => c >= x.min) : unknown;
    b.weight += w; b.symbols.push(sym);
  }
  return [...out, ...(unknown.symbols.length ? [unknown] : [])].map(({ min, ...r }) => r);
}

// IPS headroom: for each limit that is set, how far the fund is from it (positive = room left).
// alloc: the result of portfolio.allocation().
function ipsHeadroom(alloc) {
  const s = alloc.settings || {};
  const has = (v) => v !== null && v !== undefined && v !== "";
  const items = [];
  const biggest = [...(alloc.positions || [])].sort((a, b) => b.weight - a.weight)[0];
  if (has(s.maxPositionPct) && biggest) items.push({ rule: "Largest position", limit: s.maxPositionPct, current: biggest.weight, headroom: s.maxPositionPct - biggest.weight, symbol: biggest.symbol, unit: "%" });
  const bigSector = [...(alloc.sectors || [])].sort((a, b) => b.weight - a.weight)[0];
  if (has(s.maxSectorPct) && bigSector) items.push({ rule: "Largest sector", limit: s.maxSectorPct, current: bigSector.weight, headroom: s.maxSectorPct - bigSector.weight, sector: bigSector.sector, unit: "%" });
  if (has(s.minCashPct)) items.push({ rule: "Cash floor", limit: s.minCashPct, current: alloc.cashPct, headroom: alloc.cashPct - s.minCashPct, unit: "%" });
  const n = (alloc.positions || []).length;
  if (has(s.maxPositions)) items.push({ rule: "Max holdings", limit: s.maxPositions, current: n, headroom: s.maxPositions - n, unit: "" });
  if (has(s.minPositions)) items.push({ rule: "Min holdings", limit: s.minPositions, current: n, headroom: n - s.minPositions, unit: "" });
  items.sort((a, b) => a.headroom / (a.limit || 1) - b.headroom / (b.limit || 1));
  return { items, tightest: items[0] || null, breaches: (alloc.checks || []).filter((c) => c.level === "breach").length };
}

// "What moved the fund" in plain words, from a contribution result (rule-based, no AI).
// holdings: [{ symbol, sector }] for sector grouping.
function explainMove(contrib, { benchReturn = null, benchName = "the benchmark", periodLabel = "today", sectors = {} } = {}) {
  if (!contrib || !Number.isFinite(contrib.fundReturn) || !contrib.rows.length) return null;
  const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`;
  const pts = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)} pts`;
  const fr = contrib.fundReturn;
  const up = contrib.rows.filter((r) => r.contribution > 0), down = contrib.rows.filter((r) => r.contribution < 0);
  const verb = fr > 0.0005 ? "rose" : fr < -0.0005 ? "fell" : "was about flat";
  const vs = Number.isFinite(benchReturn)
    ? ` while ${benchName} ${benchReturn >= 0 ? "rose" : "fell"} ${pct(benchReturn).replace(/^[+−]/, "")}, so the fund ${fr - benchReturn >= 0 ? "beat" : "trailed"} it by ${Math.abs((fr - benchReturn) * 100).toFixed(2)} points`
    : "";
  const lines = [`The fund ${verb}${verb === "was about flat" ? "" : ` ${pct(fr).replace(/^[+−]/, "")}`} ${periodLabel}${vs}.`];
  const top = (fr >= 0 ? up : down).slice(0, 3);
  const offset = (fr >= 0 ? down : up).slice(0, 2);
  if (top.length) {
    const share = top.reduce((s, r) => s + r.contribution, 0);
    const pctOfMove = Math.abs(fr) > 1e-6 ? Math.round((share / fr) * 100) : null;
    lines.push(`${top.map((r) => `${r.symbol} (${pts(r.contribution)})`).join(", ")} ${top.length > 1 ? "drove" : "drove"} ${pctOfMove !== null && pctOfMove > 0 && pctOfMove < 1000 ? `${pctOfMove}% of the move` : "most of the move"}.`);
  }
  if (offset.length) lines.push(`${offset.map((r) => `${r.symbol} (${pts(r.contribution)})`).join(" and ")} pulled the other way.`);
  // Sector that mattered most.
  const bySector = {};
  for (const r of contrib.rows) { const s = sectors[r.symbol] || "Other"; bySector[s] = (bySector[s] || 0) + r.contribution; }
  const sec = Object.entries(bySector).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (sec && Math.abs(sec[1]) > 0.0005) lines.push(`By sector, ${sec[0]} mattered most (${pts(sec[1])}).`);
  if (contrib.cashWeight > 0.05) lines.push(`Cash (${(contrib.cashWeight * 100).toFixed(0)}% of the fund) ${fr >= 0 ? "held the gain back" : "cushioned the drop"}.`);
  // Concentration flag: one name more than half the move.
  const one = contrib.rows.find((r) => Math.abs(fr) > 0.001 && r.contribution / fr > 0.5);
  if (one) lines.push(`Note: ${one.symbol} alone was more than half of it.`);
  return { text: lines.join(" "), lines, top: top.map((r) => r.symbol), offset: offset.map((r) => r.symbol) };
}

module.exports = {
  PERIOD_KEYS, PERIOD_LABELS, periodStart, baseFor, closeOn, periodReturns, contribution, holdingsValueSeries,
  dailyReturns, dailyCalendar, monthlyReturns, rebased, rollingWindows, drawdownSeries, returnHistogram,
  brinson, sectorActiveShare, capBuckets, CAP_BUCKETS, ipsHeadroom, explainMove, alignPair,
};
