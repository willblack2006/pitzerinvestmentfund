import { divergingBars } from "../viz/bars.js";

const NAMES = { value: "Value", momentum: "Momentum", quality: "Quality", lowVol: "Low volatility", size: "Size (bigger)" };

export default {
  key: "factors", title: "Factor tilts", size: "s", defaultOn: false,
  description: "Weighted factor scores of the holdings vs neutral (slow: loads fundamentals for every holding).",
  async render(body, ctx) {
    body.innerHTML = ctx.loading("Scoring holdings (can take a minute the first time)…");
    const f = await ctx.get("/api/factors?scope=holdings", { bench: false });
    if (!f?.tilt) { body.innerHTML = ctx.empty("No factor data", "Needs holdings with fundamentals."); return; }
    divergingBars(body, Object.entries(NAMES).map(([k, label]) => ({ label, value: f.tilt[k] })), {
      label: "Fund factor tilts, 50 is neutral", center: 50, domain: [0, 100], format: (v) => (Number.isFinite(v) ? Math.round(v).toString() : "—"),
      posLabel: "more", negLabel: "less",
    });
    ctx.foot(`Percentile ranks within the fund's holdings and watchlist, weighted by value. <a href="#/factors">Open Factors</a>`, true);
  },
};
