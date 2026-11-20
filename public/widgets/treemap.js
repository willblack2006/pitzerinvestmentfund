import { treemap } from "../viz/treemap.js";

export default {
  key: "treemap", title: "Holdings map", size: "l", defaultOn: true,
  description: "Every holding sized by weight and colored by its return (or thesis health).",
  render(body, ctx) {
    const hasThesis = ctx.data.holdings.some((h) => h.thesis);
    const colorBy = hasThesis ? ctx.setting("colorBy", "return") : "return";
    const group = ctx.setting("group", true);
    ctx.tools(`${hasThesis ? ctx.seg("colorBy", [["return", "Return"], ["thesis", "Thesis"]], colorBy) : ""}
      ${ctx.seg("group", [[true, "By sector"], [false, "Flat"]], group)}`);
    if (!ctx.data.holdings.length) { body.innerHTML = ctx.empty("No holdings yet", "Holdings appear here once the fund owns something."); return; }
    treemap(body, ctx.data.holdings, { period: ctx.period, periodLabel: ctx.periodLabel, colorBy, group, height: ctx.narrow ? 300 : 380 });
  },
};
