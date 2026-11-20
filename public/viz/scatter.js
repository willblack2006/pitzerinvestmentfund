// Risk contribution vs weight: each holding is a dot; the diagonal is "risk equals weight".
// Dots above it carry more of the fund's risk than their size suggests. The biggest gaps are
// labeled directly; every dot has a tooltip and the data table lists them all.
import { esc, fmt, linear, ticks, mountChart, wireMarks, dataTable } from "./core.js";

// points: [{ label, x, y, href? }] with x = weight share, y = risk share (fractions)
export function riskScatter(container, points, { label = "Share of risk vs share of fund", height = 300 } = {}) {
  const table = dataTable(label, ["Holding", "Share of fund", "Share of risk", "Risk minus weight"],
    [...points].sort((a, b) => (b.y - b.x) - (a.y - a.x)).map((p) => [p.label, fmt.pct(p.x, 1), fmt.pct(p.y, 1), fmt.pts(p.y - p.x, 1)]));
  const over = [...points].sort((a, b) => (b.y - b.x) - (a.y - a.x));
  const named = new Set([...over.slice(0, 3), ...over.slice(-2)].filter((p) => Math.abs(p.y - p.x) > 0.005).map((p) => p.label));
  return mountChart(container, {
    label: `${label}. Most risk for its size: ${over.slice(0, 3).map((p) => p.label).join(", ")}.`, height, table,
    draw(w) {
      const pad = { l: 44, r: 12, t: 10, b: 30 };
      const max = Math.max(0.02, ...points.flatMap((p) => [p.x, p.y])) * 1.1;
      const x = linear(0, max, pad.l, w - pad.r), y = linear(0, max, height - pad.b, pad.t);
      const tk = ticks(0, max, w < 420 ? 3 : 5);
      let out = tk.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="viz-axis-label">${esc(fmt.pct(v, 0))}</text>
        <text x="${x(v)}" y="${height - 14}" text-anchor="middle" class="viz-axis-label">${esc(fmt.pct(v, 0))}</text>`).join("");
      out += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(max)}" y2="${y(max)}" class="viz-diag"/>
        <text x="${x(max) - 4}" y="${y(max) + 14}" text-anchor="end" class="viz-axis-label">risk = weight</text>
        <text x="${(pad.l + w - pad.r) / 2}" y="${height - 1}" text-anchor="middle" class="viz-axis-label">Share of fund</text>
        <text transform="translate(10 ${(height - pad.b) / 2}) rotate(-90)" text-anchor="middle" class="viz-axis-label">Share of risk</text>`;
      out += points.map((p) => {
        const above = p.y > p.x;
        const tipHtml = `<strong>${esc(p.label)}</strong><div>Share of fund <b>${fmt.pct(p.x, 1)}</b></div><div>Share of risk <b>${fmt.pct(p.y, 1)}</b></div><div>${above ? "Carries more risk than its size" : "Carries less risk than its size"}</div>`;
        const tag = p.href ? `a href="${esc(p.href)}"` : 'g tabindex="0"';
        return `<${tag} class="viz-dot" aria-label="${esc(`${p.label}: ${fmt.pct(p.x, 1)} of fund, ${fmt.pct(p.y, 1)} of risk`)}" data-tip="${esc(tipHtml)}">
          <circle cx="${x(p.x)}" cy="${y(p.y)}" r="12" class="viz-hit"/>
          <circle cx="${x(p.x)}" cy="${y(p.y)}" r="5" class="${above ? "viz-dot-over" : "viz-dot-under"}"/>
          ${named.has(p.label) ? `<text x="${x(p.x) + 8}" y="${y(p.y) - 6}" class="viz-dot-label">${esc(p.label)}</text>` : ""}</${p.href ? "a" : "g"}>`;
      }).join("");
      return { svg: `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" class="viz-svg" role="presentation">${out}</svg>`, after: (svg, fig) => wireMarks(svg, fig, ".viz-dot") };
    },
  });
}
