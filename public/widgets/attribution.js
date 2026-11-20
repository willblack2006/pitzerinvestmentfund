// Brinson attribution: was the return from picking sectors (allocation) or picking stocks within them (selection)?
import { divergingBars } from "../viz/bars.js";
import { esc, fmt } from "../viz/core.js";

export default {
  key: "attribution", title: "Allocation vs selection", size: "m", defaultOn: true,
  description: "Brinson attribution by sector: how much came from sector bets vs stock picks.",
  async render(body, ctx) {
    const period = ["1d", "5d"].includes(ctx.period) ? "1m" : ctx.period;
    const a = await ctx.get(`/api/cockpit/attribution?period=${period}`);
    if (!a?.ready) { body.innerHTML = ctx.empty("Attribution isn't ready", a?.reason || "Needs benchmark and sector history."); return; }
    const rows = a.rows.filter((r) => Math.abs(r.total) > 0.0002).slice(0, 10);
    body.innerHTML = `<p class="small" style="margin:0 0 8px">${esc(a.label)}: fund ${esc(fmt.spct(a.fundReturn, 1))} vs ${esc(a.benchmark)} ${esc(fmt.spct(a.benchReturn, 1))}.
      Sector bets <b>${esc(fmt.pts(a.allocation, 1))}</b>, stock picks <b>${esc(fmt.pts(a.selection, 1))}</b>, interaction ${esc(fmt.pts(a.interaction, 1))}.</p><div class="attr-chart"></div>`;
    divergingBars(body.querySelector(".attr-chart"), rows.map((r) => ({ label: r.sector, value: r.total,
      note: `Allocation ${fmt.pts(r.allocation)}, selection ${fmt.pts(r.selection)}. Fund ${fmt.pct(r.fundWeight, 1)} vs ${fmt.pct(r.benchWeight, 1)} weight.` })),
      { label: `Active return by sector, ${a.label}`, format: (v) => fmt.pts(v, 1), posLabel: "helped", negLabel: "hurt" });
    ctx.foot(`${period !== ctx.period ? "Shown for 1 month (shorter periods are too noisy). " : ""}Benchmark sector returns use the SPDR sector ETFs as a stand-in, and weights are today's, so treat this as a guide.`);
  },
};
