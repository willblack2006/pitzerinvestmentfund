import { monthHeatmap } from "../viz/heatmap.js";

export default {
  key: "monthly", title: "Monthly returns", size: "m", defaultOn: true,
  description: "Year by month grid of the fund's returns.",
  render(body, ctx) {
    const m = ctx.data.monthly || [];
    if (!m.length) { body.innerHTML = ctx.empty("No monthly returns yet", "Needs a month of prices."); return; }
    monthHeatmap(body, m, { label: "Fund monthly return (today's holdings)" });
    ctx.foot("Partial months at the start of the history are marked in the table.");
  },
};
