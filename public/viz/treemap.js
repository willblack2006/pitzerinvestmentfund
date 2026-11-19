// Holdings treemap: area = weight in the fund, color = return over the chosen period (or
// thesis health). Grouped by sector, squarified layout, every tile is a link to Research.
import { esc, fmt, arrow, divStep, divFill, divInk, colorScale, divLegend, mountChart, wireMarks, dataTable, fit } from "./core.js";

// Squarified treemap (Bruls et al.): items [{ value }] sorted desc, into rect {x,y,w,h}.
export function squarify(items, rect) {
  const out = [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const nodes = items.map((i) => ({ item: i, area: i.value * scale }));
  let { x, y, w, h } = rect;
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    let mx = 0, mn = Infinity;
    for (const n of r) { mx = Math.max(mx, n.area); mn = Math.min(mn, n.area); }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layRow = (r) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const n of r) { const ch = n.area / cw; out.push({ ...n.item, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      for (const n of r) { const cw = n.area / ch; out.push({ ...n.item, x: cx, y, w: cw, h: ch }); cx += cw; }
      y += ch; h -= ch;
    }
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layRow(row); row = [n]; }
  }
  if (row.length) layRow(row);
  return out;
}

const THESIS = {
  intact: { fill: "var(--viz-good)", ink: "var(--viz-on-good)", label: "Intact" },
  watch: { fill: "var(--viz-warn)", ink: "var(--viz-on-warn)", label: "Watch" },
  weakened: { fill: "var(--viz-serious)", ink: "var(--viz-on-serious)", label: "Weakened" },
  broken: { fill: "var(--viz-critical)", ink: "var(--viz-on-critical)", label: "Broken" },
  unknown: { fill: "var(--viz-missing)", ink: "var(--text-2)", label: "No check yet" },
};

// holdings: [{ symbol, name, sector, weight, value, ret: {period: v}, contribution: {period: v}, thesis }]
// opts: { period, periodLabel, colorBy: "return" | "thesis", height, group: true, cash }
export function treemap(container, holdings, opts = {}) {
  const { period = "1d", periodLabel = "Today", colorBy = "return", height = 360, group = true, cash = 0 } = opts;
  const rows = holdings.filter((h) => h.value > 0);
  const rets = rows.map((h) => h.ret?.[period]);
  const scale = colorScale(rets, period === "1d" ? 0.01 : 0.03);
  const colorOf = (h) => {
    if (colorBy === "thesis") { const t = THESIS[h.thesis?.status] || THESIS.unknown; return { fill: t.fill, ink: t.ink }; }
    const s = divStep(h.ret?.[period], scale);
    return { fill: divFill(s), ink: divInk(s) };
  };
  const tipFor = (h) => `<strong>${esc(h.symbol)}</strong>${h.name ? ` <span class="muted">${esc(h.name)}</span>` : ""}
    <div>${esc(h.sector)}</div>
    <div>Weight <b>${fmt.pct(h.weight, 1)}</b> · ${fmt.usd(h.value)}</div>
    <div>${esc(periodLabel)} <b>${arrow(h.ret?.[period])}${fmt.spct(h.ret?.[period], 2)}</b></div>
    <div>Contribution <b>${fmt.pts(h.contribution?.[period])}</b></div>
    ${h.thesis ? `<div>Thesis <b>${esc((THESIS[h.thesis.status] || THESIS.unknown).label)}</b></div>` : ""}`;

  const sectors = {};
  for (const h of rows) (sectors[h.sector] = sectors[h.sector] || { sector: h.sector, value: 0, items: [] }).items.push(h);
  for (const s of Object.values(sectors)) { s.value = s.items.reduce((a, h) => a + h.value, 0); s.items.sort((a, b) => b.value - a.value); }
  const groups = Object.values(sectors).sort((a, b) => b.value - a.value);

  const label = `Holdings map: tile size is each holding's weight, color is its ${colorBy === "thesis" ? "thesis health" : `${periodLabel.toLowerCase()} return`}. ${rows.length} holdings in ${groups.length} sectors.`;
  const table = dataTable("Holdings by weight", ["Holding", "Sector", "Weight", periodLabel, "Contribution"],
    [...rows].sort((a, b) => b.weight - a.weight).map((h) => [h.symbol, h.sector, fmt.pct(h.weight, 1), { html: `${arrow(h.ret?.[period])}${fmt.spct(h.ret?.[period], 2)}` }, fmt.pts(h.contribution?.[period])]));
  const legendHtml = colorBy === "thesis"
    ? `<div class="viz-scale" aria-hidden="true"><span class="viz-scale-label">Thesis</span>${Object.values(THESIS).map((t) => `<span class="viz-chip"><i style="background:${t.fill}"></i>${t.label}</span>`).join("")}</div>`
    : divLegend(scale, { label: periodLabel });

  return mountChart(container, {
    label, height, table, top: legendHtml,
    draw(w) {
      const h = height;
      const gap = 2;
      let tiles = [];
      const headers = [];
      if (group && groups.length > 1) {
        const boxes = squarify(groups, { x: 0, y: 0, w, h });
        for (const b of boxes) {
          const head = b.w > 70 && b.h > 44 ? 16 : 0;
          if (head) headers.push(`<text class="viz-tm-sector" x="${b.x + 4}" y="${b.y + 12}">${esc(fit(b.sector, b.w - 8, 6.4))}</text>`);
          tiles.push(...squarify(b.items, { x: b.x + 1, y: b.y + head + 1, w: b.w - 2, h: b.h - head - 2 }).map((t) => ({ ...t, sectorBox: b })));
        }
      } else {
        tiles = squarify([...rows].sort((a, b) => b.value - a.value), { x: 0, y: 0, w, h });
      }
      const body = tiles.map((t) => {
        const c = colorOf(t);
        const tw = Math.max(0, t.w - gap), th = Math.max(0, t.h - gap);
        const big = tw > 46 && th > 30, mid = tw > 30 && th > 16;
        const sym = esc(fit(t.symbol, tw - 8, 7.5));
        const sub = colorBy === "thesis" ? (THESIS[t.thesis?.status] || THESIS.unknown).label : fmt.spct(t.ret?.[period], 1);
        const aria = `${t.symbol}, ${fmt.pct(t.weight, 1)} of fund, ${periodLabel} ${fmt.spct(t.ret?.[period], 2)}`;
        return `<a href="#/research/${encodeURIComponent(t.symbol)}" class="viz-tm-tile" aria-label="${esc(aria)}" data-tip="${esc(tipFor(t))}">
          <rect x="${(t.x + gap / 2).toFixed(1)}" y="${(t.y + gap / 2).toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="4" style="fill:${c.fill}"/>
          ${mid ? `<text x="${(t.x + 6).toFixed(1)}" y="${(t.y + (big ? 17 : 13)).toFixed(1)}" class="viz-tm-sym" style="fill:${c.ink}">${sym}</text>` : ""}
          ${big ? `<text x="${(t.x + 6).toFixed(1)}" y="${(t.y + 31).toFixed(1)}" class="viz-tm-sub" style="fill:${c.ink}">${esc(fit(sub, tw - 8, 6.5))}</text>` : ""}
        </a>`;
      }).join("");
      return {
        svg: `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="viz-svg" role="presentation">${body}${headers.join("")}</svg>`,
        after: (svg, fig) => wireMarks(svg, fig, ".viz-tm-tile"),
      };
    },
  });
}
