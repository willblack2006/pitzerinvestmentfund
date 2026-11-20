// Small shared toolkit for the fund's SVG charts (no chart library, nothing from a CDN, so
// they draw offline and from cache). Each chart is a <figure class="viz"> holding an SVG that
// re-draws when its width changes, one tooltip, and a "Data table" toggle (the text
// alternative). Colors are CSS custom properties from css/viz.css, so light and dark themes
// are chosen there, not here.

export const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const fmt = {
  pct: (v, d = 1) => (finite(v) ? `${(v * 100).toFixed(d)}%` : "—"),
  spct: (v, d = 1) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%` : "—"),
  pts: (v, d = 2) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)} pts` : "—"),
  num: (v, d = 2) => (finite(v) ? v.toFixed(d) : "—"),
  usd: (v) => (finite(v) ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 1000 ? 0 : 2 }) : "—"),
  usdc: (v) => (finite(v) ? `${v < 0 ? "−" : ""}$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(v))}` : "—"),
  date: (iso) => {
    if (!iso) return "—";
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  },
  monthYear: (iso) => new Date(`${iso.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
};

// Up/down said in words and a shape, never by color alone.
export const arrow = (v) => (finite(v) ? (v > 0 ? "▲ " : v < 0 ? "▼ " : "") : "");

export const linear = (d0, d1, r0, r1) => {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (px) => (k ? d0 + (px - r0) / k : d0);
  return f;
};

// "Nice" tick values covering [min, max].
export function ticks(min, max, count = 5) {
  if (!finite(min) || !finite(max)) return [];
  if (min === max) { const pad = Math.abs(min) * 0.05 || 1; min -= pad; max += pad; }
  const span = max - min, step0 = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(12));
  return out;
}

export const extent = (vals) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (finite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo === Infinity ? [0, 1] : [lo, hi];
};

export const toTime = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

// Date ticks: month starts (or quarter/year starts when the span is long).
export function dateTicks(t0, t1, maxTicks = 6) {
  const months = (t1 - t0) / (30.4 * 864e5);
  const every = [1, 2, 3, 6, 12, 24].find((m) => months / m <= maxTicks) || 24;
  const out = [];
  const d = new Date(t0);
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  if (d.getTime() < t0) d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getUTCMonth() % every !== 0 && every <= 12) d.setUTCMonth(d.getUTCMonth() + 1);
  for (; d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + every)) {
    out.push({ t: d.getTime(), label: d.getUTCMonth() === 0 || every >= 12 ? String(d.getUTCFullYear()) : d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
  }
  return out;
}

// Diverging step for a return: -3..3, scaled so `scale` (a typical big move) is step 3.
export function divStep(v, scale) {
  if (!finite(v) || !(scale > 0)) return null;
  const a = Math.abs(v) / scale;
  const s = a < 0.12 ? 0 : a < 0.4 ? 1 : a < 0.75 ? 2 : 3;
  return v < 0 ? -s : s;
}
const STEP_NAME = { "-3": "n3", "-2": "n2", "-1": "n1", 0: "z", 1: "p1", 2: "p2", 3: "p3" };
export const divFill = (step) => (step === null ? "var(--viz-missing)" : `var(--viz-${STEP_NAME[step]})`);
export const divInk = (step) => (step === null ? "var(--text-2)" : `var(--viz-on-${STEP_NAME[step]})`);

// A robust scale for colors: the 90th percentile of |v| (so one outlier doesn't wash out the rest).
export function colorScale(vals, floor = 0.005) {
  const a = vals.filter(finite).map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return floor;
  return Math.max(floor, a[Math.floor(0.9 * (a.length - 1))]);
}

// Legend for a diverging scale: 7 swatches with the values they stand for.
export function divLegend(scale, { label = "Return", format = (v) => fmt.spct(v, 1) } = {}) {
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  const mid = { 0: 0, 1: 0.26, 2: 0.58, 3: 1 };
  return `<div class="viz-scale" aria-hidden="true"><span class="viz-scale-label">${esc(label)}</span>
    <span class="viz-scale-end">${esc(format(-scale))}</span>
    ${steps.map((s) => `<i style="background:${divFill(s)}" title="${esc(format(Math.sign(s) * mid[Math.abs(s)] * scale))}"></i>`).join("")}
    <span class="viz-scale-end">${esc(format(scale))}</span></div>`;
}

// Series legend (HTML, above the plot). items: [{ label, color, dash, shape }]
export function legend(items) {
  return `<div class="viz-legend">${items.map((i) => `<span class="viz-legend-item">${i.shape
    ? `<svg width="12" height="12" aria-hidden="true">${shape(i.shape, 6, 6, 5, i.color)}</svg>`
    : `<i class="${i.dash ? "dash" : ""}" style="--c:${i.color}"></i>`}${esc(i.label)}</span>`).join("")}</div>`;
}

// Marker shapes (events). Distinct shapes so kinds never rely on color alone.
export function shape(kind, x, y, r, color, extra = "") {
  const f = `fill="${color}" stroke="var(--surface-1)" stroke-width="1.5" ${extra}`;
  switch (kind) {
    case "up": return `<path d="M${x} ${y - r}L${x + r} ${y + r * 0.8}L${x - r} ${y + r * 0.8}Z" ${f}/>`;
    case "down": return `<path d="M${x} ${y + r}L${x + r} ${y - r * 0.8}L${x - r} ${y - r * 0.8}Z" ${f}/>`;
    case "square": return `<rect x="${x - r * 0.85}" y="${y - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" rx="1.5" ${f}/>`;
    case "diamond": return `<path d="M${x} ${y - r * 1.15}L${x + r * 1.15} ${y}L${x} ${y + r * 1.15}L${x - r * 1.15} ${y}Z" ${f}/>`;
    case "star": {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.5 : r * 1.2; pts.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`); }
      return `<polygon points="${pts.join(" ")}" ${f}/>`;
    }
    default: return `<circle cx="${x}" cy="${y}" r="${r}" ${f}/>`;
  }
}

// Accessible data table (collapsed by default). rows are arrays of already-escaped cell HTML
// or plain values (escaped here).
export function dataTable(caption, headers, rows, { open = false } = {}) {
  const cell = (v) => (v && typeof v === "object" && "html" in v ? v.html : esc(v));
  return `<details class="chart-data viz-data"${open ? " open" : ""}><summary>Data table</summary>
    <div class="chart-data-scroll table-scroll"><table class="viz-table"><caption class="sr-only">${esc(caption)}</caption>
      <thead><tr>${headers.map((h, i) => `<th scope="col"${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v, i) => (i ? `<td class="num">${cell(v)}</td>` : `<th scope="row">${cell(v)}</th>`)).join("")}</tr>`).join("")}</tbody>
    </table></div></details>`;
}

// Mount a chart: `draw(width)` returns { svg, after? } and is re-run when the width changes.
// `table` is HTML placed after the plot. Returns { redraw, fig }.
export function mountChart(container, { label, height, draw, table = "", top = "", minWidth = 240 }) {
  if (!container) return null;
  container.innerHTML = `<figure class="viz" role="group" aria-label="${esc(label)}">${top}<div class="viz-plot" style="height:${height}px"></div><div class="viz-tip" role="status" hidden></div>${table}</figure>`;
  const fig = container.firstElementChild;
  const plot = fig.querySelector(".viz-plot");
  let lastW = 0;
  const render = () => {
    const w = Math.max(minWidth, Math.floor(plot.clientWidth || container.clientWidth || 600));
    if (w === lastW) return;
    lastW = w;
    const out = draw(w);
    plot.innerHTML = out.svg;
    out.after?.(plot.querySelector("svg"), fig);
  };
  render();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => { if (!fig.isConnected) { ro.disconnect(); return; } render(); });
    ro.observe(plot);
  }
  return { fig, redraw: () => { lastW = 0; render(); } };
}

// Tooltip inside a figure, positioned near (x, y) in the plot's coordinates.
export function tip(fig) {
  const el = fig.querySelector(".viz-tip");
  const plot = fig.querySelector(".viz-plot");
  return {
    show(html, x, y) {
      el.innerHTML = html;
      el.hidden = false;
      const pw = plot.clientWidth, tw = el.offsetWidth, th = el.offsetHeight;
      let left = x + 14;
      if (left + tw > pw) left = Math.max(0, x - tw - 14);
      let topPx = y - th - 10;
      if (topPx < 0) topPx = y + 14;
      el.style.left = `${left}px`;
      el.style.top = `${plot.offsetTop + topPx}px`;
    },
    hide() { el.hidden = true; },
  };
}

// Pointer position relative to an SVG's viewBox (works when CSS scales the SVG).
export function pointer(svg, e) {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return { x: ((e.clientX - r.left) / r.width) * vb.width, y: ((e.clientY - r.top) / r.height) * vb.height };
}

// Hover + focus wiring for marks that carry data-tip (pre-escaped HTML in data attributes).
export function wireMarks(svg, fig, selector = "[data-tip]") {
  const t = tip(fig);
  const show = (m) => {
    const b = m.getBBox?.();
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
    const sx = r.width / vb.width, sy = r.height / vb.height;
    t.show(m.dataset.tip, b ? (b.x + b.width / 2) * sx : 0, b ? b.y * sy : 0);
  };
  svg.querySelectorAll(selector).forEach((m) => {
    m.addEventListener("pointerenter", () => { m.classList.add("is-hot"); show(m); });
    m.addEventListener("pointerleave", () => { m.classList.remove("is-hot"); t.hide(); });
    m.addEventListener("focus", () => { m.classList.add("is-hot"); show(m); });
    m.addEventListener("blur", () => { m.classList.remove("is-hot"); t.hide(); });
  });
  return t;
}

// Truncate a label to fit `px` at ~`charPx` per character.
export function fit(text, px, charPx = 7) {
  const n = Math.floor(px / charPx);
  if (n <= 1) return "";
  return text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`;
}
