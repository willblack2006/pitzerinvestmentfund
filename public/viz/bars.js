// Bar charts: paired horizontal bars (fund vs benchmark per category), diverging bars
// around a center (active weights, factor tilts, attribution) and a return histogram.
import { esc, fmt, linear, ticks, extent, mountChart, wireMarks, legend, dataTable } from "./core.js";

// rows: [{ label, a, b, href? }] → fund (a) and benchmark (b) side by side per category.
export function pairedBars(container, rows, { label, aName = "Fund", bName = "Benchmark", format = (v) => fmt.pct(v / 100, 1), unitMax = null } = {}) {
  const rowH = 30;
  const height = rows.length * rowH + 24;
  const top = legend([{ label: aName, color: "var(--viz-s1)" }, { label: bName, color: "var(--viz-s2)" }]);
  const table = dataTable(label, ["Category", aName, bName, "Difference"], rows.map((r) => [r.label, format(r.a), r.b === null || r.b === undefined ? "—" : format(r.b), r.b === null || r.b === undefined ? "—" : `${r.a - r.b >= 0 ? "+" : "−"}${format(Math.abs(r.a - r.b))}`]));
  return mountChart(container, {
    label, height, top, table,
    draw(w) {
      const labelW = Math.min(170, Math.max(84, w * 0.3)), valW = 92;
      const max = unitMax || Math.max(1e-9, ...rows.flatMap((r) => [r.a || 0, r.b || 0]));
      const x = linear(0, max, labelW, w - valW);
      let out = ticks(0, max, Math.max(2, Math.floor((w - labelW - valW) / 90))).map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="2" y2="${height - 20}" class="viz-grid"/><text x="${x(t)}" y="${height - 6}" text-anchor="middle" class="viz-axis-label">${esc(format(t))}</text>`).join("");
      rows.forEach((r, i) => {
        const y = 4 + i * rowH;
        const diff = r.b === null || r.b === undefined ? null : r.a - r.b;
        const tipHtml = `<strong>${esc(r.label)}</strong><div>${esc(aName)} <b>${esc(format(r.a))}</b></div><div>${esc(bName)} ${r.b === null || r.b === undefined ? "—" : esc(format(r.b))}</div>${diff !== null ? `<div>Difference <b>${diff >= 0 ? "+" : "−"}${esc(format(Math.abs(diff)))}</b></div>` : ""}`;
        out += `<g class="viz-pair" tabindex="0" aria-label="${esc(`${r.label}: ${aName} ${format(r.a)}, ${bName} ${r.b === null || r.b === undefined ? "none" : format(r.b)}`)}" data-tip="${esc(tipHtml)}">
          <rect x="0" y="${y}" width="${w}" height="${rowH}" class="viz-hit"/>
          <text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" class="viz-wf-label">${esc(r.label.length * 6.6 > labelW - 10 ? r.label.slice(0, Math.floor((labelW - 10) / 6.6) - 1) + "…" : r.label)}</text>
          <rect x="${labelW}" y="${y + 5}" width="${Math.max(r.a > 0 ? 2 : 0, x(r.a || 0) - labelW)}" height="9" rx="2" style="fill:var(--viz-s1)"/>
          ${r.b === null || r.b === undefined ? "" : `<rect x="${labelW}" y="${y + 16}" width="${Math.max(r.b > 0 ? 2 : 0, x(r.b) - labelW)}" height="9" rx="2" style="fill:var(--viz-s2)"/>`}
          <text x="${w - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" class="viz-wf-val">${esc(format(r.a))}${diff !== null ? ` <tspan class="viz-diff">${diff >= 0 ? "+" : "−"}${esc(format(Math.abs(diff)))}</tspan>` : ""}</text></g>`;
      });
      return { svg: `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" class="viz-svg" role="presentation">${out}</svg>`, after: (svg, fig) => wireMarks(svg, fig, ".viz-pair") };
    },
  });
}

// rows: [{ label, value, note? }] drawn as bars left/right of `center` (0 by default).
export function divergingBars(container, rows, { label, format = (v) => fmt.pts(v), center = 0, domain = null, posLabel = "", negLabel = "" } = {}) {
  const rowH = 26;
  const height = rows.length * rowH + 26 + (posLabel ? 14 : 0);
  const table = dataTable(label, ["Item", "Value"], rows.map((r) => [r.label, format(r.value)]));
  return mountChart(container, {
    label, height, table,
    draw(w) {
      const labelW = Math.min(170, Math.max(80, w * 0.3)), valW = 78;
      const [lo, hi] = domain || extent([center, ...rows.map((r) => r.value)]);
      const span = Math.max(Math.abs(hi - center), Math.abs(center - lo)) || 1;
      const x = linear(center - span * 1.05, center + span * 1.05, labelW, w - valW);
      const head = posLabel ? 14 : 0;
      let out = posLabel ? `<text x="${x(center) - 6}" y="10" text-anchor="end" class="viz-axis-label">← ${esc(negLabel)}</text><text x="${x(center) + 6}" y="10" class="viz-axis-label">${esc(posLabel)} →</text>` : "";
      out += ticks(center - span, center + span, 4).map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${head}" y2="${height - 20}" class="${t === center ? "viz-zero" : "viz-grid"}"/><text x="${x(t)}" y="${height - 6}" text-anchor="middle" class="viz-axis-label">${esc(format(t))}</text>`).join("");
      rows.forEach((r, i) => {
        const y = head + 4 + i * rowH;
        const v = Number.isFinite(r.value) ? r.value : center;
        const a = x(Math.min(v, center)), b = x(Math.max(v, center));
        const tipHtml = `<strong>${esc(r.label)}</strong><div><b>${esc(format(r.value))}</b></div>${r.note ? `<div class="muted">${esc(r.note)}</div>` : ""}`;
        out += `<g class="viz-pair" tabindex="0" aria-label="${esc(`${r.label}: ${format(r.value)}`)}" data-tip="${esc(tipHtml)}">
          <rect x="0" y="${y}" width="${w}" height="${rowH}" class="viz-hit"/>
          <text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" class="viz-wf-label">${esc(r.label.length * 6.6 > labelW - 10 ? r.label.slice(0, Math.floor((labelW - 10) / 6.6) - 1) + "…" : r.label)}</text>
          <rect x="${a}" y="${y + 6}" width="${Math.max(Number.isFinite(r.value) ? 2 : 0, b - a)}" height="${rowH - 12}" rx="3" class="${v >= center ? "viz-wf-pos" : "viz-wf-neg"}"/>
          <text x="${w - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" class="viz-wf-val">${esc(format(r.value))}</text></g>`;
      });
      return { svg: `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" class="viz-svg" role="presentation">${out}</svg>`, after: (svg, fig) => wireMarks(svg, fig, ".viz-pair") };
    },
  });
}

// hist: { bins: [{ lo, hi, fund, bench }], fund: stats, bench: stats }
export function histogram(container, hist, { label = "Daily returns", aName = "Fund", bName = "Benchmark", height = 220 } = {}) {
  const nf = hist.fund?.n || 1, nb = hist.bench?.n || 1;
  const bins = hist.bins.map((b) => ({ ...b, fa: b.fund / nf, ba: b.bench / nb }));
  const top = legend([{ label: `${aName} (bars)`, color: "var(--viz-s1)" }, { label: `${bName} (outline)`, color: "var(--viz-s2)" }]);
  const table = dataTable(label, ["Daily return", aName, bName], bins.filter((b) => b.fund || b.bench).map((b) => [`${fmt.spct(b.lo, 1)} to ${fmt.spct(b.hi, 1)}`, `${b.fund} days`, `${b.bench} days`]));
  return mountChart(container, {
    label, height, top, table,
    draw(w) {
      const padL = 34, padB = 22, padT = 6;
      const max = Math.max(...bins.map((b) => Math.max(b.fa, b.ba)), 0.01);
      const x = linear(-hist.clip, hist.clip, padL, w - 6);
      const y = linear(0, max * 1.08, height - padB, padT);
      const bw = x(hist.width) - x(0);
      let out = ticks(0, max, 3).map((v) => `<line x1="${padL}" x2="${w - 6}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${padL - 4}" y="${y(v) + 4}" text-anchor="end" class="viz-axis-label">${esc(fmt.pct(v, 0))}</text>`).join("");
      out += ticks(-hist.clip, hist.clip, 5).map((v) => `<text x="${x(v)}" y="${height - 6}" text-anchor="middle" class="viz-axis-label">${esc(fmt.spct(v, 0))}</text>`).join("");
      out += `<line x1="${x(0)}" x2="${x(0)}" y1="${padT}" y2="${height - padB}" class="viz-zero"/>`;
      let step = "";
      bins.forEach((b, i) => {
        const bx = x(b.lo);
        const tipHtml = `<strong>${esc(fmt.spct(b.lo, 1))} to ${esc(fmt.spct(b.hi, 1))}</strong><div>${esc(aName)} <b>${b.fund}</b> days (${fmt.pct(b.fa, 1)})</div><div>${esc(bName)} ${b.bench} days (${fmt.pct(b.ba, 1)})</div>`;
        out += `<g class="viz-bin" data-tip="${esc(tipHtml)}"><rect x="${bx}" y="${padT}" width="${bw}" height="${height - padB - padT}" class="viz-hit"/>
          ${b.fa ? `<rect x="${bx + 1}" y="${y(b.fa)}" width="${Math.max(1, bw - 2)}" height="${y(0) - y(b.fa)}" rx="2" style="fill:var(--viz-s1)"/>` : ""}</g>`;
        step += `${i ? "L" : "M"}${bx.toFixed(1)} ${y(b.ba).toFixed(1)}L${(bx + bw).toFixed(1)} ${y(b.ba).toFixed(1)}`;
      });
      out += `<path d="${step}" fill="none" stroke="var(--viz-s2)" stroke-width="2" pointer-events="none"/>`;
      return { svg: `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" class="viz-svg" role="presentation">${out}</svg>`, after: (svg, fig) => wireMarks(svg, fig, ".viz-bin") };
    },
  });
}
