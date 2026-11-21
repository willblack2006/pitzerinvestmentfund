// Research data as pictures (WS10): the event layers on the annotated price chart, valuation
// multiple bands, and the football field. Pure functions here; routes/researchViz.js fetches
// the inputs (SEC, Yahoo, Finnhub, the fund's own tables) and hands them in.
const DAY = 864e5;
const FILING_LAG_DAYS = 40; // a quarter's numbers count from about when the 10-Q/10-K is filed

// ---- Annotation layers ----

// 8-K item codes worth a marker, with a short label. Anything else shows as "8-K".
const ITEM_LABEL = {
  "1.01": "Material agreement", "1.02": "Agreement ended", "1.03": "Bankruptcy", "1.05": "Cybersecurity incident",
  "2.01": "Acquisition or sale", "2.02": "Earnings release", "2.03": "New debt", "2.05": "Restructuring", "2.06": "Impairment",
  "3.01": "Listing notice", "3.02": "Unregistered share sale", "4.01": "Auditor change", "4.02": "Restatement",
  "5.01": "Change in control", "5.02": "Officer or director change", "5.03": "Charter or bylaw change", "5.07": "Shareholder vote",
  "7.01": "Reg FD disclosure", "8.01": "Other event",
};
// Items that a reader should never miss (drawn larger and listed first).
const SERIOUS = new Set(["1.03", "1.05", "2.05", "2.06", "3.01", "4.01", "4.02", "5.01"]);
const ROUTINE = new Set(["9.01"]); // financial-statement exhibits: on almost every 8-K, says nothing

function filingLayer(filings = [], from) {
  const out = [];
  for (const f of filings) {
    if (!f?.filingDate || f.filingDate < from) continue;
    if (f.form === "8-K") {
      const items = String(f.items || "").split(",").map((s) => s.trim()).filter((s) => s && !ROUTINE.has(s));
      if (!items.length) continue;
      const labels = items.map((i) => ITEM_LABEL[i] || `Item ${i}`);
      out.push({
        date: f.filingDate, form: "8-K", items, label: labels.join(", "),
        serious: items.some((i) => SERIOUS.has(i)), earnings: items.includes("2.02"), url: f.url || null,
      });
    } else if (f.form === "10-K" || f.form === "10-Q") {
      out.push({ date: f.filingDate, form: f.form, items: [], label: f.form === "10-K" ? "Annual report" : "Quarterly report", serious: false, earnings: false, url: f.url || null, period: f.reportDate || null });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Earnings: the 8-K Item 2.02 dates (when results were actually released), plus the next
// scheduled date from Yahoo. Beat/miss is matched by the closest quarter end before the release.
function earningsLayer(filings = [], history = [], nextDates = [], from) {
  const releases = filings.filter((f) => f.form === "8-K" && /\b2\.02\b/.test(f.items || "") && f.filingDate >= from)
    .map((f) => f.filingDate).sort();
  const out = releases.map((date) => {
    // Yahoo's earningsHistory has quarter labels like "4Q2025" or dates; match within 100 days before.
    const h = history.find((x) => x.quarterEnd && x.quarterEnd < date && (new Date(date) - new Date(x.quarterEnd)) / DAY < 100);
    return { date, upcoming: false, surprisePct: h?.surprisePct ?? null, actual: h?.actual ?? null, estimate: h?.estimate ?? null };
  });
  const today = new Date().toISOString().slice(0, 10);
  for (const d of nextDates || []) if (d && d >= today) { out.push({ date: d, upcoming: true }); break; }
  return out;
}

// Form 4 open-market buys (P) and sales (S), grouped by day and direction. A "cluster" is
// three or more different insiders buying within 30 days (the classic strong signal).
function insiderLayer(rows = [], from) {
  const byKey = new Map();
  for (const t of rows) {
    if (!t?.transactionDate || t.transactionDate < from || t.isDerivative) continue;
    if (t.transactionCode !== "P" && t.transactionCode !== "S") continue;
    const key = `${t.transactionDate}|${t.transactionCode}`;
    const g = byKey.get(key) || { date: t.transactionDate, side: t.transactionCode === "P" ? "buy" : "sell", names: [], shares: 0, value: 0 };
    if (t.name && !g.names.includes(t.name)) g.names.push(t.name);
    const sh = Math.abs(Number(t.change) || 0);
    g.shares += sh;
    if (Number.isFinite(t.transactionPrice) && t.transactionPrice > 0) g.value += sh * t.transactionPrice;
    byKey.set(key, g);
  }
  const out = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  const buys = out.filter((g) => g.side === "buy");
  for (const g of buys) {
    const t = new Date(g.date).getTime();
    const names = new Set();
    for (const h of buys) {
      const dt = (t - new Date(h.date).getTime()) / DAY;
      if (dt >= 0 && dt <= 30) h.names.forEach((n) => names.add(n));
    }
    g.cluster = names.size >= 3;
  }
  for (const g of out) { g.shares = Math.round(g.shares); g.value = Math.round(g.value); if (g.side === "sell") g.cluster = false; }
  return out;
}

function pitchLayer(pitches = []) {
  return pitches.map((p) => ({
    id: p.id, date: String(p.createdAt || "").slice(0, 10), status: p.status, direction: p.direction, title: p.title || "",
    author: p.author || "", decidedAt: p.decidedAt ? String(p.decidedAt).slice(0, 10) : null,
    bull: num(p.bullPrice), base: num(p.basePrice), bear: num(p.bearPrice), priceAtPitch: num(p.priceAtPitch),
  })).filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
}

// Bull / base / bear lines: the newest pitch that is live (voting, approved, executed) with
// at least one case price, else the newest pitch with prices at all.
function scenarioLines(pitches) {
  const priced = pitches.filter((p) => p.bull || p.base || p.bear);
  const live = priced.filter((p) => ["voting", "approved", "executed"].includes(p.status));
  const pick = (live.length ? live : priced).at(-1);
  if (!pick) return null;
  return { pitchId: pick.id, date: pick.date, status: pick.status, bull: pick.bull, base: pick.base, bear: pick.bear };
}

function agentLayer(runs = []) {
  return runs.map((r) => {
    let out = null;
    try { out = r.output ? JSON.parse(r.output) : null; } catch { /* plain text */ }
    const title = r.summary || out?.headline || out?.title || out?.summary || out?.verdict || out?.answer || "";
    return { date: String(r.createdAt || "").slice(0, 10), runId: r.id, workflow: r.workflow, title: String(title).replace(/\s+/g, " ").slice(0, 160) };
  }).filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date));
}

function tripwireLayer(rows = []) {
  return rows.filter((t) => (t.kind === "price_below" || t.kind === "price_above") && Number.isFinite(t.value) && t.status !== "resolved")
    .map((t) => ({ id: t.id, kind: t.kind, value: t.value, status: t.status, note: t.note || "" }));
}

function tradeLayer(rows = [], from) {
  return rows.filter((t) => t.date >= from && (t.type === "buy" || t.type === "sell"))
    .map((t) => ({ date: t.date, side: t.type, shares: Number(t.shares), price: Number(t.price) }));
}

function dividendLayer(rows = [], from) {
  return rows.filter((d) => d.exDate >= from).map((d) => ({ date: d.exDate, amount: d.amount }));
}

const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);

// Yahoo's earnings history quarter ("4Q2025") to that quarter's calendar end date.
function quarterEndOf(label) {
  const m = /^([1-4])Q(\d{4})$/.exec(String(label || "").trim());
  if (m) return `${m[2]}-${["03-31", "06-30", "09-30", "12-31"][m[1] - 1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(label || "")) ? label : null;
}

function buildAnnotations({ from, filings, insiders, dividends, pitches, trades, runs, tripwires, history, nextEarnings }) {
  const p = pitchLayer(pitches);
  const hist = (history || []).map((h) => ({ ...h, quarterEnd: quarterEndOf(h.quarter) }));
  return {
    from,
    layers: {
      filings: filingLayer(filings, from).filter((f) => !f.earnings), // earnings releases have their own layer
      earnings: earningsLayer(filings || [], hist, nextEarnings, from),
      insiders: insiderLayer(insiders, from),
      dividends: dividendLayer(dividends || [], from),
      pitches: p,
      trades: tradeLayer(trades || [], from),
      agents: agentLayer(runs),
      tripwires: tripwireLayer(tripwires),
    },
    scenarios: scenarioLines(p),
  };
}

// ---- Valuation multiple bands ----

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Trailing-twelve-month sums of single quarters: [{ end, val }] where four consecutive quarters
// span about a year.
function ttm(quarters = []) {
  const q = quarters.filter((p) => p.form === "10-Q" && Number.isFinite(p.val));
  const out = [];
  for (let i = 3; i < q.length; i++) {
    const span = (new Date(q[i].end) - new Date(q[i - 3].end)) / DAY;
    if (span < 240 || span > 300) continue;
    out.push({ end: q[i].end, val: q[i].val + q[i - 1].val + q[i - 2].val + q[i - 3].val });
  }
  return out;
}

// Latest point-in-time value (balance-sheet items) known by date t.
function knownAt(series, t) {
  let v = null;
  for (const s of series) if (new Date(s.end).getTime() + FILING_LAG_DAYS * DAY <= t) v = s; else break;
  return v;
}

const sum2 = (a, b) => {
  const map = new Map(a.map((x) => [x.end, x.val]));
  return b.filter((x) => map.has(x.end)).map((x) => ({ end: x.end, val: map.get(x.end) + x.val }));
};

// One multiple's history and what the stock would be worth at its usual range:
//  points: [{ date, price, multiple, implied: { p10, p50, p90 } }]   (weekly)
//  summary: { current, p10, p25, p50, p75, p90, percentile, from }
// `metricAt(t)` returns the per-share fundamental (EPS) or a function of the multiple → price.
function bandSeries(bars, { valueAt, toPrice, maxMultiple }) {
  const raw = [];
  for (const b of bars || []) {
    if (!Number.isFinite(b.close) || !b.date) continue;
    const t = new Date(b.date).getTime();
    const v = valueAt(t, b.close);
    if (!v) continue;
    raw.push({ date: b.date, price: b.close, multiple: v.multiple > 0 && v.multiple <= maxMultiple ? v.multiple : null, ctx: v });
  }
  const valid = raw.filter((p) => p.multiple !== null);
  if (valid.length < 26) return null; // under half a year of weekly points isn't a history
  const sorted = valid.map((p) => p.multiple).sort((a, b) => a - b);
  const q = { p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9) };
  const r = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
  const points = raw.map((p) => {
    const implied = {};
    for (const k of ["p10", "p50", "p90"]) implied[k] = r(toPrice(q[k], p.ctx));
    return { date: p.date, price: r(p.price), multiple: p.multiple === null ? null : Math.round(p.multiple * 10) / 10, implied };
  });
  const current = raw.at(-1).multiple;
  return {
    points,
    summary: {
      from: valid[0].date, current: current === null ? null : Math.round(current * 10) / 10,
      ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      percentile: current === null ? null : Math.round((sorted.filter((x) => x <= current).length / sorted.length) * 100) / 100,
      coverage: Math.round((valid.length / raw.length) * 100) / 100,
    },
  };
}

// P/E and EV/EBITDA bands over (up to) five years of weekly prices.
// facts: lib/sources/sec getCompanyFacts output. bars: weekly [{ date, close }].
function multipleBands(facts, bars, { years = 5, now = Date.now() } = {}) {
  if (!facts || !bars?.length) return { pe: null, evEbitda: null };
  const since = new Date(now - years * 365.25 * DAY).toISOString().slice(0, 10);
  const window = bars.filter((b) => b.date >= since);
  const eps = ttm(facts.eps || []);
  const at = (series, t) => knownAt(series, t);

  const pe = eps.length ? bandSeries(window, {
    maxMultiple: 150,
    valueAt: (t, price) => { const e = at(eps, t); return e && e.val > 0 ? { multiple: price / e.val, eps: e.val } : e ? { multiple: null, eps: e.val } : null; },
    toPrice: (m, c) => (c.eps > 0 ? m * c.eps : null),
  }) : null;

  // EBITDA = operating income + depreciation & amortization (both TTM). EV = market cap +
  // debt - cash, all as known at the time. Shares: diluted weighted average of the latest quarter.
  const ebitda = sum2(ttm(facts.operatingIncome || []), ttm(facts.depreciation || []));
  const shares = (facts.dilutedShares || []).filter((x) => x.form === "10-Q" && x.val > 0);
  const debtOf = (t) => (at((facts.longTermDebt || []).filter((x) => x.form), t)?.val || 0) + (at((facts.shortTermDebt || []).filter((x) => x.form), t)?.val || 0);
  const cashOf = (t) => at(facts.cash || [], t)?.val || 0;
  const evEbitda = ebitda.length && shares.length ? bandSeries(window, {
    maxMultiple: 100,
    valueAt: (t, price) => {
      const e = at(ebitda, t), s = at(shares, t);
      if (!e || !s) return null;
      const netDebt = debtOf(t) - cashOf(t);
      const ev = price * s.val + netDebt;
      return { multiple: e.val > 0 ? ev / e.val : null, ebitda: e.val, shares: s.val, netDebt };
    },
    toPrice: (m, c) => (c.ebitda > 0 && c.shares > 0 ? Math.max(0, (m * c.ebitda - c.netDebt) / c.shares) : null),
  }) : null;

  return { pe, evEbitda };
}

// ---- Football field ----

// Each row is a range of per-share values from one method; the chart lines them up against
// today's price. Missing inputs drop their row rather than inventing one.
// inputs: { price, range52: {low, high}, targets: {low, high, mean, median}, dcf: {low, high, mid},
//           comps: {low, high, mid, basis}, bands: { pe, evEbitda } (multipleBands output),
//           pitch: { bear, base, bull, id, status } }
function footballField({ price, range52, targets, dcf, comps, bands, pitch } = {}) {
  const rows = [];
  const ok = (x) => Number.isFinite(x) && x > 0;
  const add = (key, label, low, high, mid, note, extra = {}) => {
    if (!ok(low) || !ok(high)) return;
    const [lo, hi] = low <= high ? [low, high] : [high, low];
    rows.push({ key, label, low: r2(lo), high: r2(hi), mid: ok(mid) ? r2(mid) : null, note, ...extra });
  };
  if (range52) add("range52", "52-week trading range", range52.low, range52.high, null, "Lowest to highest close over the past year");
  if (targets) add("analysts", "Analyst price targets", targets.low, targets.high, targets.mean ?? targets.median, "Lowest to highest Street target, mean marked");
  if (dcf) add("dcf", "Discounted cash flow", dcf.low, dcf.high, dcf.mid, dcf.note || "Two-stage DCF, discount rate ±1 pt and terminal growth ±0.5 pt");
  if (comps) add("comps", `Peer multiples (${comps.basis || "P/E"})`, comps.low, comps.high, comps.mid, "Peers' middle half applied to this company's own earnings");
  const pe = bands?.pe?.points?.at(-1)?.implied;
  if (pe) add("peBand", "Own P/E history", pe.p10, pe.p90, pe.p50, "10th to 90th percentile of its own five-year P/E, on today's earnings");
  const ev = bands?.evEbitda?.points?.at(-1)?.implied;
  if (ev) add("evBand", "Own EV/EBITDA history", ev.p10, ev.p90, ev.p50, "10th to 90th percentile of its own five-year EV/EBITDA, on today's EBITDA");
  if (pitch) {
    const cases = [pitch.bear, pitch.base, pitch.bull].filter(ok);
    if (cases.length >= 2) add("pitch", "Fund pitch cases", Math.min(...cases), Math.max(...cases), pitch.base, "Bear to bull case from the fund's pitch, base marked", { pitchId: pitch.id });
  }
  const all = rows.flatMap((r) => [r.low, r.high]).concat(ok(price) ? [price] : []);
  return { price: ok(price) ? r2(price) : null, rows, min: all.length ? r2(Math.min(...all)) : null, max: all.length ? r2(Math.max(...all)) : null };
}
const r2 = (x) => Math.round(x * 100) / 100;

// DCF low/mid/high from the same workbench defaults the Valuation tab uses.
function dcfRange(dcf, analystGrowth, dcfValue) {
  if (!dcf?.fcf || !dcf?.shares || !(dcf.fcf > 0)) return null;
  const g = Math.max(-0.05, Math.min(0.25, analystGrowth ?? dcf.revenueCagr ?? 0.06));
  const base = { fcf: dcf.fcf, g, shares: dcf.shares, netCash: (dcf.cash || 0) - (dcf.debt || 0) };
  const vals = [];
  for (const r of [0.08, 0.09, 0.1]) for (const gT of [0.02, 0.025, 0.03]) { const v = dcfValue({ ...base, r, gT })?.perShare; if (Number.isFinite(v) && v > 0) vals.push(v); }
  if (!vals.length) return null;
  const mid = dcfValue({ ...base, r: 0.09, gT: 0.025 })?.perShare;
  return { low: Math.min(...vals), high: Math.max(...vals), mid, note: `Two-stage DCF, ${(g * 100).toFixed(1)}% growth years 1 to 5, 8 to 10% discount rate, 2 to 3% terminal growth` };
}

// Peer P/E middle half applied to this company's EPS (price / own P/E).
function compsRange(rows, symbol, price) {
  const self = rows.find((r) => r.symbol === symbol);
  const ownPe = self?.peTTM;
  if (!(ownPe > 0) || !(price > 0)) return null;
  const eps = price / ownPe;
  const peers = rows.filter((r) => r.symbol !== symbol && r.peTTM > 0 && r.peTTM < 150).map((r) => r.peTTM).sort((a, b) => a - b);
  if (peers.length < 3) return null;
  return { low: quantile(peers, 0.25) * eps, high: quantile(peers, 0.75) * eps, mid: quantile(peers, 0.5) * eps, basis: "P/E", peers: peers.length };
}

module.exports = {
  ITEM_LABEL, filingLayer, earningsLayer, insiderLayer, pitchLayer, scenarioLines, agentLayer, tripwireLayer, buildAnnotations, quarterEndOf,
  ttm, multipleBands, footballField, dcfRange, compsRange, quantile,
};
