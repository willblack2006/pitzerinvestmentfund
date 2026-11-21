import { returnCalendar } from "../viz/calendar.js";

export default {
  key: "calendar", title: "Daily returns", size: "m", defaultOn: true,
  description: "Calendar heatmap of the fund's daily returns (today's holdings).",
  render(body, ctx) {
    const days = ctx.data.calendar || [];
    if (days.length < 2) { body.innerHTML = ctx.empty("No daily returns yet", "Needs a few days of prices."); return; }
    const range = ctx.setting("range", "6m");
    ctx.tools(ctx.seg("range", [["3m", "3M"], ["6m", "6M"], ["1y", "1Y"]], range));
    const n = { "3m": 63, "6m": 126, "1y": 252 }[range] || 126;
    returnCalendar(body, days.slice(-n), { benchName: ctx.data.benchmark });
  },
};
