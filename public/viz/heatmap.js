// Year × month grid of monthly returns (each cell shows its number, so color is never the
// only cue), with a year total column.
import { esc, fmt, arrow, divStep, divFill, divInk, colorScale, mountChart, wireMarks, dataTable } from "./core.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// months: [{ month: "2026-03", ret, partial }]
export function monthHeatmap(container, months, { label = "Monthly return" } = {}) {
  const byKey = new Map(months.map((m) => [m.month, m]));
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].sort().reverse();
  const yearRet = (y) => {
    const ms = months.filter((m) => m.month.startsWith(y));
    return ms.length ? ms.reduce((p, m) => p * (1 + m.ret), 1) - 1 : null;
  };
  const scale = colorScale(months.map((m) => m.ret), 0.02);
  const table = dataTable(label, ["Month", "Return"], [...months].reverse().map((m) => [m.month + (m.partial ? " (partial)" : ""), { html: `${arrow(m.ret)}${fmt.spct(m.ret, 1)}` }]));
  const rowH = 30;
  return mountChart(container, {
    label: `${label} by month for ${years.join(", ")}`, height: 22 + years.length * rowH, table,
    draw(w) {
      const left = 40, right = 52;
      const cw = (w - left - right) / 12;
      const narrow = cw < 30;
      let out = MONTHS.map((m, i) => `<text x="${left + i * cw + cw / 2}" y="14" text-anchor="middle" class="viz-axis-label">${narrow ? m[0] : m}</text>`).join("")
        + `<text x="${w - right / 2}" y="14" text-anchor="middle" class="viz-axis-label">Year</text>`;
      years.forEach((y, r) => {
        const yy = 22 + r * rowH;
        out += `<text x="0" y="${yy + rowH / 2 + 4}" class="viz-axis-label">${y}</text>`;
        MONTHS.forEach((_, i) => {
          const m = byKey.get(`${y}-${String(i + 1).padStart(2, "0")}`);
          if (!m) return;
          const s = divStep(m.ret, scale);
          const x = left + i * cw;
          const tipHtml = `<strong>${MONTHS[i]} ${y}</strong>${m.partial ? " <span class=\"muted\">(partial)</span>" : ""}<div><b>${arrow(m.ret)}${fmt.spct(m.ret, 2)}</b></div>`;
          out += `<g class="viz-hm-cell" tabindex="0" aria-label="${esc(`${MONTHS[i]} ${y}: ${fmt.spct(m.ret, 1)}`)}" data-tip="${esc(tipHtml)}">
            <rect x="${x + 1}" y="${yy + 1}" width="${cw - 2}" height="${rowH - 2}" rx="3" style="fill:${divFill(s)}"/>
            ${!narrow ? `<text x="${x + cw / 2}" y="${yy + rowH / 2 + 4}" text-anchor="middle" class="viz-hm-val" style="fill:${divInk(s)}">${esc(fmt.spct(m.ret, cw > 46 ? 1 : 0))}</text>` : ""}</g>`;
        });
        const yr = yearRet(y);
        out += `<text x="${w - right / 2}" y="${yy + rowH / 2 + 4}" text-anchor="middle" class="viz-hm-year">${esc(fmt.spct(yr, 1))}</text>`;
      });
      return { svg: `<svg viewBox="0 0 ${w} ${22 + years.length * rowH}" width="${w}" height="${22 + years.length * rowH}" class="viz-svg" role="presentation">${out}</svg>`, after: (svg, fig) => wireMarks(svg, fig, ".viz-hm-cell") };
    },
  });
}
