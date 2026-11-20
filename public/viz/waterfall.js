// Contribution waterfall, drawn sideways so long lists of tickers stay readable on a phone.
// Each bar starts where the previous one ended; the last bar is the fund's total. The biggest
// movers are shown by name and the rest fold into "Everything else".
import { esc, fmt, arrow, linear, ticks, extent, mountChart, wireMarks, dataTable } from "./core.js";

// rows: [{ symbol, contribution, return, startWeight }] (sum = fundReturn)
export function waterfall(container, rows, { fundReturn, benchReturn = null, benchName = "Benchmark", periodLabel = "", maxBars = 12 } = {}) {
  const sorted = [...rows].sort((a, b) => b.contribution - a.contribution);
  let shown = sorted;
  let rest = null;
  if (sorted.length > maxBars) {
    const byAbs = [...sorted].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const keep = new Set(byAbs.slice(0, maxBars - 1).map((r) => r.symbol));
    shown = sorted.filter((r) => keep.has(r.symbol));
    const others = sorted.filter((r) => !keep.has(r.symbol));
    rest = { symbol: `Everything else (${others.length})`, contribution: others.reduce((s, r) => s + r.contribution, 0), others };
  }
  const steps = [...shown.filter((r) => r.contribution >= 0), ...(rest ? [rest] : []), ...shown.filter((r) => r.contribution < 0)];
  let run = 0;
  const bars = steps.map((r) => { const a = run; run += r.contribution; return { ...r, a, b: run }; });
  const total = Number.isFinite(fundReturn) ? fundReturn : run;
  const table = dataTable(`Contribution to fund return ${periodLabel}`, ["Holding", "Return", "Weight at start", "Contribution"],
    sorted.map((r) => [r.symbol, { html: `${arrow(r.return)}${fmt.spct(r.return, 1)}` }, fmt.pct(r.startWeight, 1), fmt.pts(r.contribution)]));
  const rowH = 22;
  const height = (bars.length + 1) * rowH + 30;
  const best = sorted[0], worst = sorted.at(-1);
  const label = `Contribution waterfall ${periodLabel}: fund ${fmt.spct(total, 2)}${Number.isFinite(benchReturn) ? ` vs ${benchName} ${fmt.spct(benchReturn, 2)}` : ""}. Biggest help ${best?.symbol || "none"} ${fmt.pts(best?.contribution)}, biggest drag ${worst?.symbol || "none"} ${fmt.pts(worst?.contribution)}.`;
  return mountChart(container, {
    label, height, table,
    draw(w) {
      const labelW = Math.min(150, Math.max(70, w * 0.26)), valW = 70;
      const x0 = labelW, x1 = w - valW;
      const [lo, hi] = extent([0, total, benchReturn, ...bars.flatMap((b) => [b.a, b.b])]);
      const pad = (hi - lo) * 0.04 || 0.001;
      const x = linear(lo - pad, hi + pad, x0, x1);
      const tks = ticks(lo - pad, hi + pad, Math.max(2, Math.floor((x1 - x0) / 80)));
      let out = tks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="4" y2="${height - 22}" class="${t === 0 ? "viz-zero" : "viz-grid"}"/><text x="${x(t)}" y="${height - 6}" text-anchor="middle" class="viz-axis-label">${esc(fmt.spct(t, Math.abs(hi - lo) < 0.02 ? 1 : 0))}</text>`).join("");
      bars.forEach((b, i) => {
        const y = 6 + i * rowH;
        const xa = x(Math.min(b.a, b.b)), xb = x(Math.max(b.a, b.b));
        const pos = b.contribution >= 0;
        const tipHtml = b.others
          ? `<strong>${esc(b.symbol)}</strong><div>Together <b>${fmt.pts(b.contribution)}</b></div><div class="muted">${esc(b.others.slice(0, 12).map((o) => o.symbol).join(", "))}${b.others.length > 12 ? "…" : ""}</div>`
          : `<strong>${esc(b.symbol)}</strong><div>Return <b>${arrow(b.return)}${fmt.spct(b.return, 2)}</b></div><div>Weight at start ${fmt.pct(b.startWeight, 1)}</div><div>Contribution <b>${fmt.pts(b.contribution)}</b></div>`;
        const link = !b.others;
        out += `<${link ? `a href="#/research/${encodeURIComponent(b.symbol)}"` : 'g tabindex="0"'} class="viz-wf-bar" aria-label="${esc(`${b.symbol}: ${fmt.pts(b.contribution)}`)}" data-tip="${esc(tipHtml)}">
          <rect x="0" y="${y}" width="${w}" height="${rowH}" class="viz-hit"/>
          <text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" class="viz-wf-label">${esc(b.symbol.length > 22 && labelW < 140 ? b.symbol.replace("Everything else", "Others") : b.symbol)}</text>
          <rect x="${xa}" y="${y + 4}" width="${Math.max(2, xb - xa)}" height="${rowH - 8}" rx="3" class="${b.others ? "viz-wf-rest" : pos ? "viz-wf-pos" : "viz-wf-neg"}"/>
          ${i < bars.length - 1 ? `<line x1="${x(b.b)}" x2="${x(b.b)}" y1="${y + rowH - 4}" y2="${y + rowH + 4}" class="viz-wf-link"/>` : ""}
          <text x="${w - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" class="viz-wf-val">${esc(fmt.pts(b.contribution))}</text>
        </${link ? "a" : "g"}>`;
      });
      const ty = 6 + bars.length * rowH;
      out += `<g class="viz-wf-total"><text x="${labelW - 8}" y="${ty + rowH / 2 + 4}" text-anchor="end" class="viz-wf-label strong">Fund</text>
        <rect x="${Math.min(x(0), x(total))}" y="${ty + 3}" width="${Math.max(2, Math.abs(x(total) - x(0)))}" height="${rowH - 6}" rx="3" class="viz-wf-sum"/>
        ${Number.isFinite(benchReturn) ? `<line x1="${x(benchReturn)}" x2="${x(benchReturn)}" y1="${ty}" y2="${ty + rowH}" class="viz-wf-bench"/>` : ""}
        <text x="${w - 4}" y="${ty + rowH / 2 + 4}" text-anchor="end" class="viz-wf-val strong">${esc(fmt.spct(total, 2))}</text></g>`;
      return { svg: `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" class="viz-svg" role="presentation">${out}</svg>`, after: (svg, fig) => wireMarks(svg, fig, ".viz-wf-bar") };
    },
  });
}
