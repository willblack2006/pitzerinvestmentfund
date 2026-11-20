// Time-series line chart with a crosshair tooltip, optional shaded area (drawdowns), a
// reference line (100 or 0), and event markers along the top (trades, pitches, votes,
// tripwires, agent alerts). One y-axis only; two measures of different scale get two charts.
import { esc, fmt, linear, ticks, extent, toTime, dateTicks, mountChart, pointer, tip, legend, shape, dataTable } from "./core.js";

export const EVENT_STYLE = {
  trade_buy: { shape: "up", color: "var(--viz-pos)", label: "Buy" },
  trade_sell: { shape: "down", color: "var(--viz-neg)", label: "Sell" },
  trade_flow: { shape: "circle", color: "var(--text-2)", label: "Cash in or out" },
  pitch: { shape: "circle", color: "var(--viz-s1)", label: "Pitch opened" },
  vote: { shape: "square", color: "var(--viz-s1)", label: "Vote decided" },
  tripwire: { shape: "diamond", color: "var(--viz-warn)", label: "Tripwire" },
  agent: { shape: "star", color: "var(--viz-s2)", label: "Agent alert" },
};
export const eventStyle = (e) => EVENT_STYLE[e.kind === "trade" ? (e.sub === "buy" ? "trade_buy" : e.sub === "sell" ? "trade_sell" : "trade_flow") : e.kind] || EVENT_STYLE.pitch;

// series: [{ label, values, color, dash, area, width }] aligned to `dates`.
export function lineChart(container, { dates, series, label, height = 280, yFormat = (v) => fmt.num(v, 0), tipFormat, baseline = null, events = [], tableRows = null, tableHeaders = null, directLabels = true, yDomain = null }) {
  const t = dates.map(toTime);
  const tf = tipFormat || yFormat;
  const evs = events.filter((e) => e.date >= dates[0] && e.date <= dates.at(-1));
  const kinds = [...new Map(evs.map((e) => { const s = eventStyle(e); return [s.label, s]; })).values()];
  const top = legend([
    ...(series.length > 1 ? series.map((s) => ({ label: s.label, color: s.color, dash: s.dash })) : []),
    ...kinds.map((k) => ({ label: k.label, color: k.color, shape: k.shape })),
  ]);
  const every = Math.max(1, Math.ceil(dates.length / 60));
  const rowsForTable = tableRows || dates.map((d, i) => [fmt.date(d), ...series.map((s) => tf(s.values[i]))]).filter((_, i) => i % every === 0 || i === dates.length - 1).reverse();
  const table = dataTable(label, tableHeaders || ["Date", ...series.map((s) => s.label)], rowsForTable)
    + (evs.length ? dataTable("Events on this chart", ["Date", "What happened"], [...evs].reverse().map((e) => [fmt.date(e.date), e.title])).replace("Data table", `Events (${evs.length})`) : "");

  return mountChart(container, {
    label, height, top, table,
    draw(w) {
      const narrow = w < 480;
      const lastVals = series.map((s) => s.values.at(-1));
      const showDirect = directLabels && series.length > 1 && series.length <= 4 && !narrow;
      const padL = 46, padR = showDirect ? 64 : 10, padT = evs.length ? 22 : 8, padB = 22;
      const all = series.flatMap((s) => s.values);
      let [lo, hi] = yDomain || extent(baseline !== null ? [...all, baseline] : all);
      const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
      if (!yDomain) { lo -= pad; hi += pad; }
      const x = linear(t[0], t.at(-1), padL, w - padR);
      const y = linear(lo, hi, height - padB, padT);
      const yt = ticks(lo, hi, narrow ? 3 : 5);
      let out = yt.map((v) => `<line x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="viz-axis-label">${esc(yFormat(v))}</text>`).join("");
      out += dateTicks(t[0], t.at(-1), narrow ? 3 : 6).map((d) => `<text x="${x(d.t)}" y="${height - 6}" text-anchor="middle" class="viz-axis-label">${esc(d.label)}</text>`).join("");
      if (baseline !== null && baseline >= lo && baseline <= hi) out += `<line x1="${padL}" x2="${w - padR}" y1="${y(baseline)}" y2="${y(baseline)}" class="viz-zero"/>`;
      series.forEach((s) => {
        let d = "", pen = false;
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) { pen = false; return; }
          d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)} ${y(v).toFixed(1)}`;
          pen = true;
        });
        if (s.area) {
          const base = y(baseline ?? lo);
          const pts = s.values.map((v, i) => (Number.isFinite(v) ? `${x(t[i]).toFixed(1)} ${y(v).toFixed(1)}` : null)).filter(Boolean);
          if (pts.length) out += `<path d="M${pts[0].split(" ")[0]} ${base}L${pts.join("L")}L${pts.at(-1).split(" ")[0]} ${base}Z" class="viz-area" style="fill:${s.color}"/>`;
        }
        out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
      });
      if (showDirect) {
        // Direct labels at the line ends, nudged apart so they never overlap.
        const lab = series.map((s, i) => ({ s, v: lastVals[i], y: y(lastVals[i]) })).filter((l) => Number.isFinite(l.v)).sort((a, b) => a.y - b.y);
        for (let i = 1; i < lab.length; i++) if (lab[i].y - lab[i - 1].y < 14) lab[i].y = lab[i - 1].y + 14;
        out += lab.map((l) => `<text x="${w - padR + 6}" y="${l.y + 4}" class="viz-direct">${esc(l.s.label.length > 9 ? l.s.label.slice(0, 8) + "…" : l.s.label)}</text>`).join("");
      }
      // Event markers along the top band; several on one day share a stack.
      const byDay = {};
      for (const e of evs) (byDay[e.date] = byDay[e.date] || []).push(e);
      out += Object.entries(byDay).map(([d, list]) => {
        const cx = x(toTime(d));
        const tipHtml = `<strong>${esc(fmt.date(d))}</strong>${list.map((e) => `<div>${esc(e.title)}</div>`).join("")}`;
        return `<g class="viz-event" tabindex="0" aria-label="${esc(`${fmt.date(d)}: ${list.map((e) => e.title).join("; ")}`)}" data-tip="${esc(tipHtml)}" data-href="${esc(list[0].href || "")}">
          <line x1="${cx}" x2="${cx}" y1="${padT - 4}" y2="${height - padB}" class="viz-event-rule"/>
          <rect x="${cx - 8}" y="0" width="16" height="${padT}" class="viz-hit"/>
          ${list.slice(0, 2).map((e, k) => { const st = eventStyle(e); return shape(st.shape, cx + k * 3, 9 + k * 2, 5, st.color); }).join("")}</g>`;
      }).join("");
      out += `<g class="viz-cross" visibility="hidden"><line class="viz-cross-line" y1="${padT}" y2="${height - padB}"/>${series.map((s) => `<circle r="4" fill="${s.color}" stroke="var(--surface-1)" stroke-width="2"/>`).join("")}</g>
        <rect class="viz-overlay" x="${padL}" y="${padT}" width="${w - padL - padR}" height="${height - padT - padB}" fill="transparent"/>`;
      return {
        svg: `<svg viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" class="viz-svg" role="presentation">${out}</svg>`,
        after(svg, fig) {
          const tt = tip(fig);
          const cross = svg.querySelector(".viz-cross"), line = cross.querySelector("line"), dots = cross.querySelectorAll("circle");
          const ov = svg.querySelector(".viz-overlay");
          const move = (e) => {
            const p = pointer(svg, e);
            const tm = x.invert(p.x);
            let i = 0, lo2 = 0, hi2 = t.length - 1;
            while (lo2 <= hi2) { const m = (lo2 + hi2) >> 1; if (t[m] < tm) lo2 = m + 1; else hi2 = m - 1; }
            i = Math.min(t.length - 1, Math.max(0, lo2));
            if (i > 0 && Math.abs(t[i - 1] - tm) < Math.abs(t[i] - tm)) i--;
            const cx = x(t[i]);
            line.setAttribute("x1", cx); line.setAttribute("x2", cx);
            series.forEach((s, k) => { const v = s.values[i]; dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", Number.isFinite(v) ? y(v) : -20); });
            cross.setAttribute("visibility", "visible");
            const r = svg.getBoundingClientRect(), sx = r.width / w;
            tt.show(`<strong>${esc(fmt.date(dates[i]))}</strong>${series.map((s) => `<div><i class="viz-key" style="--c:${s.color}"></i>${esc(s.label)} <b>${esc(tf(s.values[i]))}</b></div>`).join("")}`, cx * sx, p.y * sx);
          };
          ov.addEventListener("pointermove", move);
          ov.addEventListener("pointerdown", move);
          ov.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tt.hide(); });
          svg.querySelectorAll(".viz-event").forEach((m) => {
            const show = () => { const b = m.getBBox(); const r = svg.getBoundingClientRect(), sx = r.width / w; tt.show(m.dataset.tip, (b.x + b.width / 2) * sx, 18); };
            m.addEventListener("pointerenter", show); m.addEventListener("focus", show);
            m.addEventListener("pointerleave", () => tt.hide()); m.addEventListener("blur", () => tt.hide());
            const go = () => { if (m.dataset.href) location.hash = m.dataset.href; };
            m.addEventListener("click", go);
            m.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
          });
        },
      };
    },
  });
}
