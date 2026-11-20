// Fund value vs the benchmark with event markers (trades, pitches, votes, tripwires, agent alerts).
import { lineChart } from "../viz/line.js";
import { fmt } from "../viz/core.js";

const RANGES = [["3m", "3M", 63], ["6m", "6M", 126], ["1y", "1Y", 252], ["2y", "2Y", 9999]];

export default {
  key: "value", title: "Fund vs benchmark", size: "full", defaultOn: true,
  description: "Today's holdings over time against the benchmark, with trades, pitches and alerts marked.",
  render(body, ctx) {
    const d = ctx.data;
    const s = d.series;
    const range = ctx.setting("range", "1y");
    const mode = ctx.setting("mode", "growth");
    ctx.tools(`${ctx.seg("mode", [["growth", "Growth of 100"], ["relative", "Ahead / behind"]], mode)}${ctx.seg("range", RANGES.map(([k, l]) => [k, l]), range)}`);
    if (!s?.dates?.length || s.dates.length < 2) { body.innerHTML = ctx.empty("Not enough price history yet", "This chart fills in once the holdings have a few days of prices."); return; }
    const n = RANGES.find((r) => r[0] === range)?.[2] || 252;
    const start = Math.max(0, s.dates.length - 1 - n);
    const dates = s.dates.slice(start);
    const rebase = (arr) => { const b = arr[start]; return arr.slice(start).map((v) => (Number.isFinite(v) && b ? (v / b) * 100 : null)); };
    const fund = rebase(s.fund), bench = rebase(s.bench);
    const last = fund.at(-1) - 100, lastB = bench.at(-1) - 100;
    const label = `Today's holdings ${fmt.spct(last / 100, 1)} vs ${d.benchmark} ${fmt.spct(lastB / 100, 1)} from ${fmt.date(dates[0])} to ${fmt.date(dates.at(-1))}.`;
    if (mode === "relative") {
      const rel = fund.map((v, i) => (Number.isFinite(v) && Number.isFinite(bench[i]) ? v / bench[i] - 1 : null));
      lineChart(body, {
        dates, label: `Fund ahead of or behind ${d.benchmark}. ${label}`, height: ctx.narrow ? 220 : 280, baseline: 0, events: d.events,
        series: [{ label: `Fund minus ${d.benchmark}`, values: rel, color: "var(--viz-s1)", area: true }],
        yFormat: (v) => fmt.spct(v, 0), tipFormat: (v) => fmt.spct(v, 2),
      });
    } else {
      lineChart(body, {
        dates, label, height: ctx.narrow ? 240 : 300, baseline: 100, events: d.events,
        series: [{ label: "Fund (today's holdings)", values: fund, color: "var(--viz-s1)" }, { label: d.benchmark, values: bench, color: "var(--viz-s2)", dash: true, width: 1.5 }],
        yFormat: (v) => fmt.num(v, 0), tipFormat: (v) => (Number.isFinite(v) ? `${fmt.num(v, 1)} (${fmt.spct(v / 100 - 1, 1)})` : "—"),
      });
    }
    ctx.foot(`Today's share counts priced back in time, cash included at zero return. ${s.covered < s.total ? `${s.total - s.covered} holding${s.total - s.covered === 1 ? "" : "s"} without price history left out.` : ""} The recorded fund value is in the "Recorded fund value" widget.`);
  },
};
