// Signal matrix (WS10): holdings (or watchlist) × signals, each cell a score in [-1, 1] where
// positive reads as supportive for the stock and negative as a warning, plus the raw value and
// a sentence. Pure scoring here; routes/signalMatrix.js gathers the inputs from the existing
// per-signal functions (all cached), so this adds no new external calls of its own.

const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// [key, label, what a positive score means]. Column order on the page.
const SIGNALS = [
  ["momentum", "Momentum", "12-month return excluding the last month, ranked against the other names"],
  ["vsVol", "Today vs usual", "Today's move in units of the stock's own daily volatility"],
  ["revisions", "Estimate revisions", "Analysts raising (positive) or cutting (negative) EPS estimates"],
  ["insider", "Insiders", "Opportunistic insider buying (positive) or broad selling (negative)"],
  ["short", "Short pressure", "Heavy or rising short interest scores negative"],
  ["crowding", "Crowding", "Unusual volume, gaps and news attention score negative"],
  ["valuation", "Valuation vs own history", "Cheap against its own five-year P/E scores positive"],
  ["thesis", "Thesis health", "The thesis status members approved (intact, watch, weakened, broken)"],
];

// 12-1 momentum and today's vol-scaled move from daily closes (oldest first).
function priceSignals(closes) {
  const c = (closes || []).filter(Number.isFinite);
  const out = { momentum: null, dayMove: null, sigma: null, vsVol: null };
  if (c.length >= 120) out.momentum = c[c.length - 22] / c[0] - 1; // ~6 months minimum; a year when available
  if (c.length >= 30) {
    const rets = [];
    for (let i = Math.max(1, c.length - 61); i < c.length - 1; i++) rets.push(c[i] / c[i - 1] - 1);
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    out.dayMove = c.at(-1) / c.at(-2) - 1;
    out.sigma = sd;
    out.vsVol = sd > 0 ? out.dayMove / sd : null;
  }
  return out;
}

// Percentile rank of each value among the finite values (0..1), for cross-sectional signals.
function ranks(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return values.map((v) => {
    if (!Number.isFinite(v) || finite.length < 2) return null;
    const below = finite.filter((x) => x < v).length, equal = finite.filter((x) => x === v).length;
    return (below + (equal - 1) / 2) / (finite.length - 1);
  });
}

const THESIS = { intact: 0.8, watch: 0, weakened: -0.5, broken: -1 };
const PILLAR = { intact: 1, watch: 0, weakened: -0.5, broken: -1 };

// inputs per symbol: { symbol, owned, weight, closes, revision: {score,label,reasons}, insider: {score,label,reasons},
//   short: {score,label,reasons}, crowding: {score,label,reasons}, pe: {percentile,current,median}, thesis: {status, pillars:[{status}]} }
function buildMatrix(inputs) {
  const price = inputs.map((x) => priceSignals(x.closes));
  const momRank = ranks(price.map((p) => p.momentum));
  const rows = inputs.map((x, i) => {
    const p = price[i];
    const cells = {};
    const set = (key, score, value, text) => { cells[key] = score === null || score === undefined || !Number.isFinite(score) ? { score: null, value: null, text: text || "No data" } : { score: r2(clamp(score)), value, text }; };
    set("momentum", momRank[i] === null ? null : momRank[i] * 2 - 1, r2(p.momentum), p.momentum === null ? "Under six months of prices" : `${p.momentum >= 0 ? "+" : ""}${(p.momentum * 100).toFixed(0)}% over 12 months to a month ago`);
    set("vsVol", p.vsVol === null ? null : p.vsVol / 3, r2(p.vsVol), p.vsVol === null ? "" : `${p.dayMove >= 0 ? "+" : ""}${(p.dayMove * 100).toFixed(1)}% today, ${Math.abs(p.vsVol).toFixed(1)}× a normal day`);
    const sc = (o, f, fallback) => (o && Number.isFinite(o.score) ? f(o.score) : fallback ?? null);
    set("revisions", sc(x.revision, (s) => s / 100), x.revision?.score ?? null, x.revision ? `${x.revision.label || ""}${x.revision.reasons?.[0] ? `: ${x.revision.reasons[0]}` : ""}` : "");
    set("insider", sc(x.insider, (s) => s / 100), x.insider?.score ?? null, x.insider ? `${x.insider.label || ""}${x.insider.reasons?.[0] ? `: ${x.insider.reasons[0]}` : ""}` : "");
    set("short", sc(x.short, (s) => -s / 100), x.short?.score ?? null, x.short ? `${x.short.label || ""}${x.short.reasons?.[0] ? `: ${x.short.reasons[0]}` : ""}` : "");
    set("crowding", sc(x.crowding, (s) => -s / 100), x.crowding?.score ?? null, x.crowding ? `${x.crowding.label || ""}${x.crowding.reasons?.[0] ? `: ${x.crowding.reasons[0]}` : ""}` : "");
    const pe = x.pe;
    set("valuation", pe && Number.isFinite(pe.percentile) ? 1 - 2 * pe.percentile : null, pe?.current ?? null,
      pe && Number.isFinite(pe.percentile) ? `P/E ${pe.current.toFixed(1)}×, cheaper than ${Math.round(pe.percentile * 100)}% of the past five years (median ${pe.median.toFixed(1)}×)` : pe?.reason || "");
    const th = x.thesis;
    let ts = null, tt = "";
    if (th?.pillars?.length) {
      const known = th.pillars.filter((pl) => pl.status in PILLAR);
      if (known.length) { ts = known.reduce((s, pl) => s + PILLAR[pl.status], 0) / known.length; tt = `${known.filter((pl) => pl.status === "intact").length} of ${known.length} pillars intact`; }
    }
    if (ts === null && th?.status in THESIS) { ts = THESIS[th.status]; tt = `Thesis ${th.status}`; }
    set("thesis", ts, th?.status ?? null, tt || (th ? "No thesis status yet" : "No written thesis"));
    const scored = Object.values(cells).filter((c) => c.score !== null);
    // Thesis and momentum carry more of the summary than one-off reads like today's move.
    const W = { thesis: 2, revisions: 1.5, momentum: 1.5, insider: 1, valuation: 1, short: 1, crowding: 0.75, vsVol: 0.5 };
    let num = 0, den = 0;
    for (const [k, c] of Object.entries(cells)) if (c.score !== null) { num += c.score * W[k]; den += W[k]; }
    return { symbol: x.symbol, owned: !!x.owned, weight: x.weight ?? null, cells, summary: den ? r2(num / den) : null, coverage: scored.length / SIGNALS.length, warnings: Object.entries(cells).filter(([, c]) => c.score !== null && c.score <= -0.5).map(([k]) => k) };
  });
  return { signals: SIGNALS.map(([key, label, help]) => ({ key, label, help })), rows };
}

// Biggest moves today against each stock's own volatility (dashboard widget).
function topMovers(rows, n = 6) {
  return rows.filter((r) => r.cells.vsVol.score !== null).sort((a, b) => Math.abs(b.cells.vsVol.value) - Math.abs(a.cells.vsVol.value)).slice(0, n)
    .map((r) => ({ symbol: r.symbol, sigmas: r.cells.vsVol.value, text: r.cells.vsVol.text }));
}

module.exports = { SIGNALS, priceSignals, ranks, buildMatrix, topMovers };
