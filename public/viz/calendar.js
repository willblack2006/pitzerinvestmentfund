// Calendar heatmap of daily fund returns: one column per week, Monday to Friday down the
// side, color = that day's return (diverging around zero). When the card is too narrow for
// the whole range it shows the most recent weeks that fit and says so.
import { esc, fmt, arrow, toTime, divStep, divFill, colorScale, divLegend, mountChart, wireMarks, dataTable } from "./core.js";

const DAY = 864e5;
const mondayOf = (t) => { const d = new Date(t); const wd = (d.getUTCDay() + 6) % 7; return t - wd * DAY; };

// days: [{ date, ret, bench }]
export function returnCalendar(container, days, { benchName = "Benchmark", label = "Daily fund return" } = {}) {
  const rows = days.filter((d) => Number.isFinite(d.ret));
  const scale = colorScale(rows.map((d) => d.ret), 0.008);
  const up = rows.filter((d) => d.ret > 0).length;
  const beat = rows.filter((d) => Number.isFinite(d.bench) && d.ret > d.bench).length;
  const withBench = rows.filter((d) => Number.isFinite(d.bench)).length;
  const summary = rows.length
    ? `${up} of ${rows.length} days up (${fmt.pct(up / rows.length, 0)})${withBench ? `; beat ${benchName} on ${beat} of ${withBench} (${fmt.pct(beat / withBench, 0)})` : ""}.`
    : "No daily returns yet.";
  const table = dataTable(label, ["Date", "Fund", benchName, "Difference"], [...rows].reverse().map((d) => [fmt.date(d.date),
    { html: `${arrow(d.ret)}${fmt.spct(d.ret, 2)}` }, fmt.spct(d.bench, 2), Number.isFinite(d.bench) ? fmt.pts(d.ret - d.bench) : "—"]));
  const byDate = new Map(rows.map((d) => [d.date, d]));
  const weeksAll = [];
  if (rows.length) {
    for (let t = mondayOf(toTime(rows[0].date)); t <= toTime(rows.at(-1).date); t += 7 * DAY) weeksAll.push(t);
  }
  const height = 5 * 16 + 28;
  return mountChart(container, {
    label: `${label}. ${summary}`, height,
    top: `<div class="viz-cal-top"><p class="viz-note">${esc(summary)}</p>${divLegend(scale, { label: "Day" })}</div>`,
    table,
    draw(w) {
      const left = 26, topPad = 16;
      const cell = Math.max(10, Math.min(24, Math.floor((w - left) / Math.max(1, weeksAll.length))));
      const fitWeeks = Math.max(1, Math.floor((w - left) / cell));
      const weeks = weeksAll.slice(-fitWeeks);
      const h = topPad + 5 * cell + 6;
      let months = "", cells = "", lastMonth = "", lastLabelX = -99;
      weeks.forEach((wk, i) => {
        const x = left + i * cell;
        const m = new Date(wk + 4 * DAY).toISOString().slice(0, 7);
        if (m !== lastMonth) {
          if (x - lastLabelX >= 44 && x < w - 30) { months += `<text x="${x}" y="11" class="viz-axis-label">${esc(fmt.monthYear(m))}</text>`; lastLabelX = x; }
          lastMonth = m;
        }
        for (let d = 0; d < 5; d++) {
          const iso = new Date(wk + d * DAY).toISOString().slice(0, 10);
          const r = byDate.get(iso);
          if (!r) continue;
          const s = divStep(r.ret, scale);
          const tipHtml = `<strong>${esc(fmt.date(iso))}</strong><div>Fund <b>${arrow(r.ret)}${fmt.spct(r.ret, 2)}</b></div>${Number.isFinite(r.bench) ? `<div>${esc(benchName)} ${fmt.spct(r.bench, 2)}</div><div>Difference <b>${fmt.pts(r.ret - r.bench)}</b></div>` : ""}`;
          cells += `<rect class="viz-cal-cell" x="${x + 1}" y="${topPad + d * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="2" style="fill:${divFill(s)}" data-tip="${esc(tipHtml)}"/>`;
        }
      });
      const dayLabels = ["M", "", "W", "", "F"].map((l, d) => (l ? `<text x="4" y="${topPad + d * cell + cell * 0.72}" class="viz-axis-label">${l}</text>` : "")).join("");
      const clipped = weeks.length < weeksAll.length;
      return {
        svg: `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="viz-svg" role="presentation">${months}${dayLabels}${cells}</svg>${clipped ? `<p class="viz-note small">Showing the last ${weeks.length} weeks. The data table has every day.</p>` : ""}`,
        after: (svg, fig) => wireMarks(svg, fig, ".viz-cal-cell"),
      };
    },
  });
}
