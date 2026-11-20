import { riskScatter } from "../viz/scatter.js";
import { fmt } from "../viz/core.js";

export default {
  key: "risk-scatter", title: "Risk vs weight", size: "m", defaultOn: true,
  description: "Which holdings carry more of the fund's risk than their size (from the Risk page).",
  async render(body, ctx) {
    const r = await ctx.get("/api/portfolio/risk", { bench: false });
    const risk = r?.risk;
    if (!risk?.rows?.length) { body.innerHTML = ctx.empty("Not enough history", r?.reason || "Needs about six months of overlapping prices."); return; }
    const tw = risk.rows.reduce((s, x) => s + x.weight, 0) || 1;
    riskScatter(body, risk.rows.map((x) => ({ label: x.symbol, x: x.weight / tw, y: x.riskShare, href: `#/research/${encodeURIComponent(x.symbol)}` })), { height: ctx.narrow ? 260 : 300 });
    ctx.foot(`Shares of the invested part of the fund. ${fmt.num(risk.effectiveBets, 1)} independent bets across ${risk.rows.length} holdings. <a href="#/risk">Open Risk</a>`, true);
  },
};
