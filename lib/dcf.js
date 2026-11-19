// Two-stage DCF, the same math as the Research → Valuation workbench
// (public/views/research/valuation.js), so agents can quote the numbers members see there.
// Growth `g` for years 1 to 5, a linear fade to terminal growth `gT` over years 6 to 10, then a
// Gordon terminal value; discounted at `r`. Net cash = cash minus debt from SEC filings.

function dcfValue({ fcf, g, gT, r, shares, netCash = 0 }) {
  if (!(r > gT) || !fcf || !shares) return null;
  let pv = 0, cf = fcf;
  for (let t = 1; t <= 10; t++) {
    const gt = t <= 5 ? g : g + ((gT - g) * (t - 5)) / 5;
    cf *= 1 + gt;
    pv += cf / Math.pow(1 + r, t);
  }
  const tv = (cf * (1 + gT)) / (r - gT);
  pv += tv / Math.pow(1 + r, 10);
  return { perShare: (pv + netCash) / shares, terminalShare: tv / Math.pow(1 + r, 10) / pv };
}

// Reverse DCF: the years 1 to 5 growth rate today's price implies (bisection), or null.
function impliedGrowth(params, price) {
  let lo = -0.5, hi = 1.5;
  const f = (g) => dcfValue({ ...params, g })?.perShare ?? NaN;
  if (!(f(lo) < price && f(hi) > price)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < price) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);

// The workbench's defaults: growth = next year's analyst EPS growth, else historical revenue
// CAGR, else 6%, clamped to -5%..25%; terminal 2.5%; discount rate 9%.
function defaults(dcf, analystGrowth) {
  return { g: Math.max(-0.05, Math.min(0.25, analystGrowth ?? dcf?.revenueCagr ?? 0.06)), gT: 0.025, r: 0.09 };
}

// Everything the Valuation tab shows, for one set of assumptions.
function workbench(dcf, { price = null, g, gT, r, base = "last" } = {}) {
  if (!dcf?.fcf || !dcf?.shares) return null;
  const fcf = base === "avg3" && dcf.fcfAvg3 ? dcf.fcfAvg3 : dcf.fcf;
  const p = { fcf, g, gT, r, shares: dcf.shares, netCash: (dcf.cash || 0) - (dcf.debt || 0) };
  const v = dcfValue(p);
  const rs = [r - 0.02, r - 0.01, r, r + 0.01, r + 0.02];
  const gs = [gT - 0.01, gT - 0.005, gT, gT + 0.005, gT + 0.01];
  return {
    assumptions: { startingFcf: fcf, startingFcfBasis: fcf === dcf.fcf ? "last fiscal year" : "3-year average", growthYears1to5: r4(g), terminalGrowth: r4(gT), discountRate: r4(r), shares: dcf.shares, netCash: p.netCash, fiscalYearEnd: dcf.fiscalYearEnd },
    valuePerShare: v ? r2(v.perShare) : null,
    error: v ? undefined : "Discount rate must exceed terminal growth.",
    price, upsideVsPrice: v && price ? r4(v.perShare / price - 1) : null,
    terminalValueShare: v ? r4(v.terminalShare) : null,
    impliedGrowthAtPrice: price ? r4(impliedGrowth(p, price)) : null,
    sensitivity: { rows: "discount rate", columns: "terminal growth", discountRates: rs.map(r4), terminalGrowths: gs.map(r4), valuePerShare: rs.map((rr) => gs.map((gg) => r2(dcfValue({ ...p, r: rr, gT: gg })?.perShare))) },
  };
}

module.exports = { dcfValue, impliedGrowth, defaults, workbench };
