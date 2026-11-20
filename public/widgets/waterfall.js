import { waterfall } from "../viz/waterfall.js";
import { fmt } from "../viz/core.js";

export default {
  key: "waterfall", title: "What drove the return", size: "m", defaultOn: true,
  description: "Contribution waterfall: each holding's share of the period's return, adding up to the fund's.",
  async render(body, ctx) {
    const c = await ctx.contribution();
    if (!c?.rows?.length) { body.innerHTML = ctx.empty("No contribution data", "Needs prices at the start and end of the period."); return; }
    waterfall(body, c.rows, { fundReturn: c.fundReturn, benchReturn: c.benchReturn, benchName: c.benchmark, periodLabel: ctx.periodLabel.toLowerCase(), maxBars: ctx.narrow ? 9 : 12 });
    ctx.foot(`From the close on ${fmt.date(c.from)}. Orange tick on the Fund bar: ${c.benchmark} ${fmt.spct(c.benchReturn, 2)}. Cash (${fmt.pct(c.cashWeight, 0)}) earns zero here.${c.missing?.length ? ` No price at the start for ${c.missing.join(", ")}.` : ""}`);
  },
};
