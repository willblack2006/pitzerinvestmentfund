// A small single-series column chart (runs or dollars per day) with a hover tooltip on each bar
// and a table view for screen readers. One series, so no legend: the heading names it.
import { esc } from "../../shared.js";

export function miniBars(points, { label, format = (v) => String(v), height = 96, cap = null, capLabel = "" } = {}) {
  if (!points.length) return "";
  const max = Math.max(cap || 0, ...points.map((p) => p.value), 1e-9);
  const step = Math.max(1, Math.ceil(points.length / 6));
  const capLine = cap ? `<span class="mb-cap" style="bottom:${((cap / max) * 100).toFixed(2)}%"><span>${esc(capLabel)}</span></span>` : "";
  return `<figure class="mb">
    <div class="mb-plot" style="height:${height}px" role="img" aria-label="${esc(label)}">
      ${capLine}
      ${points.map((p) => `<span class="mb-col" tabindex="-1" data-tip="${esc(`${p.label}: ${format(p.value)}${p.extra ? ` · ${p.extra}` : ""}`)}"><span class="mb-bar${p.value ? "" : " is-zero"}${p.tone ? ` is-${p.tone}` : ""}" style="height:${p.value ? Math.max(2, (p.value / max) * 100).toFixed(2) : 0}%"></span></span>`).join("")}
    </div>
    <div class="mb-x" aria-hidden="true">${points.map((p, i) => `<span>${i % step === 0 || i === points.length - 1 ? esc(p.short || p.label) : ""}</span>`).join("")}</div>
    <details class="mb-table small"><summary>Show as a table</summary>
      <table class="mini-table"><caption class="sr-only">${esc(label)}</caption><thead><tr><th scope="col" class="left">Day</th><th scope="col" class="num">Value</th></tr></thead>
      <tbody>${points.map((p) => `<tr><th scope="row" class="left">${esc(p.label)}</th><td class="num">${esc(format(p.value))}</td></tr>`).join("")}</tbody></table>
    </details>
  </figure>`;
}

// One floating tooltip for every mini chart on the page.
if (!window.__pifMiniBars) {
  window.__pifMiniBars = true;
  let tip;
  const show = (col) => {
    tip ||= Object.assign(document.createElement("div"), { className: "mb-tip", role: "status" });
    if (!tip.isConnected) document.body.appendChild(tip);
    tip.textContent = col.dataset.tip;
    const r = col.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - 8, Math.max(8, r.left + r.width / 2))}px`;
    tip.style.top = `${r.top + window.scrollY - 6}px`;
    tip.hidden = false;
  };
  document.addEventListener("pointerover", (e) => { const c = e.target.closest?.(".mb-col"); if (c) show(c); });
  document.addEventListener("pointerout", (e) => { if (tip && !e.relatedTarget?.closest?.(".mb-col")) tip.hidden = true; });
}

export const shortDay = (d) => { const [, m, day] = d.split("-"); return `${Number(m)}/${Number(day)}`; };
