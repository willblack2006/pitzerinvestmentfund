import { pairedBars } from "../viz/bars.js";

export default {
  key: "sectors", title: "Sector exposure", size: "m", defaultOn: true,
  description: "The fund's sector weights next to the benchmark's.",
  render(body, ctx) {
    const rows = (ctx.data.sectors || []).filter((s) => s.weight > 0 || (s.benchmarkWeight || 0) > 0.5)
      .sort((a, b) => Math.max(b.weight, b.benchmarkWeight || 0) - Math.max(a.weight, a.benchmarkWeight || 0));
    if (!rows.length) { body.innerHTML = ctx.empty("No sector data", "Sectors come from Yahoo and fill in once it answers."); return; }
    const cash = ctx.data.kpis.cashPct * 100;
    pairedBars(body, [...rows.map((s) => ({ label: s.sector, a: s.weight, b: s.benchmarkWeight })), ...(cash > 0.5 ? [{ label: "Cash", a: cash, b: 0 }] : [])], {
      label: `Sector weights, fund vs ${ctx.data.sectorBenchmark || ctx.data.benchmark}`, aName: "Fund", bName: ctx.data.sectorBenchmark || ctx.data.benchmark,
      format: (v) => `${Number(v).toFixed(1)}%`,
    });
  },
};
