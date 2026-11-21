// Small shared pieces for the research and market charts (WS10): scales, ticks, a hover/focus
// tooltip, responsive SVG and number formats. Plain SVG/HTML, no library. Colours always come
// from the theme tokens (style.css: --s1..--s5 categorical, --positive/--negative for gains and
// losses, --warn for caution), so light and dark both work.
//
// If WS9's primitives in public/viz/ (axis, tooltip, colour scale) land, these can be swapped
// for them; the components only use the exports below.

export const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  const f = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  f.invert = (y) => d0 + ((y - r0) / (r1 - r0 || 1)) * span;
  return f;
}

// "Nice" round ticks covering [min, max]: about `count` of them, on 1/2/5 × 10^k steps.
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out.filter((v) => v >= min - step * 1e-9);
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const fmtPrice = (v) => (!Number.isFinite(v) ? "—" : v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
export const fmtSignedPct = (v, d = 1) => (!Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);

// One floating tooltip per container. Any descendant with data-tip (already-escaped HTML) shows
// it on hover and on keyboard focus; Escape hides it.
export function tooltip(container) {
  if (!container || container.dataset.rvTip) return;
  container.dataset.rvTip = "1";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "rv-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  container.appendChild(tip);
  const show = (target, x, y) => {
    tip.innerHTML = target.dataset.tip;
    tip.hidden = false;
    const box = container.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x - box.left + 12, top = y - box.top - h - 10;
    if (left + w > box.width) left = Math.max(0, x - box.left - w - 12);
    if (top < 0) top = y - box.top + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  container.addEventListener("pointermove", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t && container.contains(t)) show(t, e.clientX, e.clientY); else tip.hidden = true;
  });
  container.addEventListener("pointerleave", () => { tip.hidden = true; });
  container.addEventListener("focusin", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) return;
    const r = t.getBoundingClientRect();
    show(t, r.left + r.width / 2, r.top);
  });
  container.addEventListener("focusout", () => { tip.hidden = true; });
  container.addEventListener("keydown", (e) => { if (e.key === "Escape") tip.hidden = true; });
}

// Draw an SVG that fits its host's width, redrawn when the width changes. draw(width) returns
// the SVG's inner markup and height: { html, height }.
export function responsiveSvg(host, label, draw) {
  if (!host) return null;
  let w = 0;
  const render = () => {
    const width = Math.max(240, Math.round(host.clientWidth || 600));
    if (width === w) return;
    w = width;
    const { html, height } = draw(width);
    host.innerHTML = `<svg class="rv-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escHtml(label)}">${html}</svg>`;
  };
  render();
  const ro = new ResizeObserver(() => { if (!host.isConnected) return ro.disconnect(); render(); });
  ro.observe(host);
  return { redraw() { w = 0; render(); } };
}

// A "View data" disclosure after `host` (same look as the existing chart tables).
export function dataToggle(host, caption, columns, rows) {
  if (!host) return;
  host.parentElement?.querySelector(`:scope > details.chart-data[data-for="${host.id}"]`)?.remove();
  const d = document.createElement("details");
  d.className = "chart-data";
  d.dataset.for = host.id || "";
  d.innerHTML = `<summary>View data</summary>`;
  d.addEventListener("toggle", () => {
    if (!d.open || d.querySelector("table")) return;
    const body = typeof rows === "function" ? rows() : rows;
    d.insertAdjacentHTML("beforeend", `<div class="table-scroll chart-data-scroll"><table class="data-table small">
      <caption class="sr-only">${escHtml(caption)}</caption>
      <thead><tr>${columns.map((c) => `<th scope="col">${escHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body.map((r) => `<tr>${r.map((v, i) => (i === 0 ? `<th scope="row">${escHtml(v)}</th>` : `<td>${escHtml(v)}</td>`)).join("")}</tr>`).join("")}</tbody>
    </table></div>`);
  });
  host.after(d);
  return d;
}

// Diverging colour for a score in [-1, 1]: negative → --negative, positive → --positive, with
// a neutral grey middle (never a hue at zero). Returns a CSS color-mix() expression.
export function divergingFill(score, { strength = 0.85 } = {}) {
  if (!Number.isFinite(score)) return "var(--panel-2)";
  const s = clamp(score, -1, 1);
  const pct = Math.round(Math.abs(s) * strength * 100);
  if (pct < 6) return "var(--rv-neutral)";
  return `color-mix(in srgb, var(${s > 0 ? "--positive" : "--negative"}) ${pct}%, var(--rv-neutral))`;
}
// Ink that stays readable on a divergingFill cell.
export const divergingInk = (score) => (Number.isFinite(score) && Math.abs(score) > 0.6 ? "var(--rv-ink-strong)" : "var(--text)");
