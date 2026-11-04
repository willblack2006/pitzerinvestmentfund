// Time-series charts on TradingView's open-source lightweight-charts (Apache 2.0; its small
// attribution logo stays on, as the license asks). Category charts (bars by sector, histograms)
// stay on Chart.js in charts.js.
//
// The library (~170KB) is fetched on first use only. Colors come from the CSS theme tokens and
// are re-applied when the theme changes. Every chart keeps a text alternative (role="img" +
// aria-label from the caller) and a "View data" table for screen readers and keyboard users.
const LW_SRC = "https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js";
let lwReady = null;
export function ensureLW() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (!lwReady) {
    lwReady = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = LW_SRC;
      s.onload = () => resolve(window.LightweightCharts || null);
      s.onerror = () => { lwReady = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return lwReady;
}

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Chart-wide options from the theme tokens.
export function themeOptions() {
  const font = getComputedStyle(document.body).fontFamily;
  return {
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: css("--muted"),
      fontFamily: font,
      fontSize: 12,
      attributionLogo: true,
      panes: { separatorColor: css("--border"), separatorHoverColor: css("--border-strong"), enableResize: true },
    },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--grid") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: {
      vertLine: { color: css("--border-strong"), labelBackgroundColor: css("--panel-2") },
      horzLine: { color: css("--border-strong"), labelBackgroundColor: css("--panel-2") },
    },
  };
}

// autoSize sizes a chart from a ResizeObserver after creation, and the first resize (or a
// phone rotating) leaves the default bar spacing instead of the whole series. Refit on resize.
export function fitOnResize(chart, host) {
  let w = 0;
  const ro = new ResizeObserver(() => {
    if (!host.isConnected) return ro.disconnect();
    if (host.clientWidth === w) return;
    w = host.clientWidth;
    setTimeout(() => { try { chart.timeScale().fitContent(); } catch { /* removed */ } }, 0);
  });
  ro.observe(host);
  return ro;
}

// Live charts, so theme changes and page navigation reach them.
const live = new Set();
// Charts whose page was replaced are dropped here (views don't all clean up on navigation).
export function track(handle) {
  for (const h of live) if (h.host && !h.host.isConnected) h.remove();
  live.add(handle);
  return handle;
}
export function destroyAllTv() {
  for (const h of live) h.remove();
  live.clear();
}
let themeWatch = false;
function watchTheme() {
  if (themeWatch) return;
  themeWatch = true;
  const rerun = () => setTimeout(() => { for (const h of live) (h.host?.isConnected === false ? h.remove() : h.retheme?.()); });
  new MutationObserver(rerun).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerun);
}

// "2026-10-08" stays a business day; "2026-10" (monthly series) becomes the 1st; numbers are
// epoch seconds (intraday bars).
export function toTime(label) {
  if (typeof label === "number") return label;
  const s = String(label);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return null;
}
export const isTimeLabels = (labels) => labels?.length > 0 && labels.every((l) => toTime(l) !== null);

// Points in ascending, unique time order (the library rejects anything else). Null values
// become whitespace so the series keep their shared time axis.
export function toPoints(times, values) {
  const byTime = new Map();
  times.forEach((t, i) => {
    const time = toTime(t);
    if (time === null) return;
    const v = values[i];
    byTime.set(time, Number.isFinite(v) ? { time, value: v } : { time });
  });
  return [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

const timeText = (t) => (typeof t === "number" ? new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : t);

// Swap a <canvas> placeholder (what views render for Chart.js) for a div the library can use,
// keeping its id, role and label.
function hostFor(target) {
  if (target.tagName !== "CANVAS") return target;
  const div = document.createElement("div");
  for (const a of ["id", "role", "aria-label", "class"]) if (target.hasAttribute(a)) div.setAttribute(a, target.getAttribute(a));
  if (!div.hasAttribute("role")) div.setAttribute("role", "img");
  target.replaceWith(div);
  return div;
}

// A shared "View data" disclosure under a chart, built only when opened.
export function dataTable(host, caption, columns, rowsFn) {
  const box = host.closest(".chart-box, .ct-body") || host;
  box.parentElement?.querySelector(`:scope > details.chart-data[data-for="${host.id}"]`)?.remove();
  const d = document.createElement("details");
  d.className = "chart-data";
  d.dataset.for = host.id || "";
  d.innerHTML = `<summary>View data</summary>`;
  d.addEventListener("toggle", () => {
    if (!d.open || d.querySelector("table")) return;
    const rows = rowsFn();
    d.insertAdjacentHTML("beforeend", `
      <div class="table-scroll chart-data-scroll"><table class="data-table small">
        <caption class="sr-only">${esc(caption)}</caption>
        <thead><tr>${columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((v, i) => (i === 0 ? `<th scope="row">${esc(v)}</th>` : `<td>${esc(v)}</td>`)).join("")}</tr>`).join("")}</tbody>
      </table></div>`);
  });
  box.after(d);
  return d;
}

/**
 * Line/area chart over time.
 *   series: [{ label, times, values, color: "--s1", dash: true, type: "line"|"area"|"histogram", pane: 0 }]
 *   yFormat: value → text (axis, legend, data table)
 *   refLines: [{ series: 0, price, label, color }] dashed horizontal reference lines
 *   panes: [{ stretch: 1 }] relative pane heights when series use pane > 0
 */
export async function timeChart(target, { series, yFormat, legend = series.length > 1, refLines = [], panes = [], caption } = {}) {
  if (!target) return null;
  const LW = await ensureLW();
  if (!LW || !target.isConnected) return null;
  const host = hostFor(target);
  host.classList.add("tv-chart");
  host.innerHTML = "";
  watchTheme();
  const fmt = yFormat || ((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));
  const chart = LW.createChart(host, {
    ...themeOptions(),
    autoSize: true,
    localization: { priceFormatter: fmt },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
  });
  const made = series.map((s, i) => {
    const color = css(s.color || SERIES[i % SERIES.length]);
    const priceFormat = { type: "custom", formatter: fmt, minMove: 0.0001 };
    const common = { priceFormat, lastValueVisible: false, priceLineVisible: false, title: "" };
    let api;
    if (s.type === "area") {
      api = chart.addSeries(LW.AreaSeries, { ...common, lineColor: color, topColor: css("--chart-fill"), bottomColor: "rgba(0,0,0,0)", lineWidth: 2 }, s.pane || 0);
    } else if (s.type === "histogram") {
      api = chart.addSeries(LW.HistogramSeries, { ...common, color }, s.pane || 0);
    } else {
      api = chart.addSeries(LW.LineSeries, { ...common, color, lineWidth: i === 0 ? 2 : 1.5, lineStyle: s.dash ? LW.LineStyle.Dashed : LW.LineStyle.Solid, crosshairMarkerRadius: 3 }, s.pane || 0);
    }
    api.setData(toPoints(s.times, s.values));
    return { api, spec: s };
  });
  for (const r of refLines) {
    made[r.series || 0]?.api.createPriceLine({ price: r.price, color: css(r.color || "--muted"), lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: r.label || "" });
  }
  chart.panes().forEach((p, i) => { if (panes[i]?.stretch) p.setStretchFactor(panes[i].stretch); });
  chart.timeScale().fitContent();
  const ro = fitOnResize(chart, host);

  // Legend: series names with their value under the crosshair (or the latest value).
  let legendEl = null;
  if (legend) {
    legendEl = document.createElement("div");
    legendEl.className = "tv-legend";
    legendEl.setAttribute("aria-hidden", "true"); // the chart's label and data table carry this
    host.appendChild(legendEl);
    const lastOf = (m) => [...m.api.data()].reverse().find((p) => Number.isFinite(p.value))?.value;
    const draw = (param) => {
      legendEl.innerHTML = made.map((m, i) => {
        const v = param?.seriesData?.get(m.api)?.value ?? lastOf(m);
        return `<span class="tv-legend-item"><i style="--c:${css(m.spec.color || SERIES[i % SERIES.length])}"${m.spec.dash ? ' class="dash"' : ""}></i>${esc(m.spec.label)}${Number.isFinite(v) ? ` <b>${esc(fmt(v))}</b>` : ""}</span>`;
      }).join("");
    };
    draw(null);
    chart.subscribeCrosshairMove((p) => draw(p.time ? p : null));
  }

  const times = [...new Set(series.flatMap((s) => s.times.map(toTime)))].filter((t) => t !== null).sort();
  if (series.length && times.length) {
    dataTable(host, caption || host.getAttribute("aria-label") || "Chart data", ["Date", ...series.map((s) => s.label)], () => {
      const maps = series.map((s) => new Map(s.times.map((t, i) => [toTime(t), s.values[i]])));
      return [...times].reverse().map((t) => [timeText(t), ...maps.map((m) => (Number.isFinite(m.get(t)) ? fmt(m.get(t)) : "—"))]);
    });
  }

  const handle = {
    chart,
    host,
    series: made.map((m) => m.api),
    retheme() {
      chart.applyOptions(themeOptions());
      made.forEach((m, i) => {
        const color = css(m.spec.color || SERIES[i % SERIES.length]);
        if (m.spec.type === "area") m.api.applyOptions({ lineColor: color, topColor: css("--chart-fill") });
        else m.api.applyOptions({ color });
      });
    },
    remove() { live.delete(handle); ro.disconnect(); try { chart.remove(); } catch { /* already gone */ } },
  };
  return track(handle);
}

// Tiny inline trend line (no axes, no interaction).
export async function sparkline(target, { times, values, color = "--chart-line" }) {
  const LW = await ensureLW();
  if (!LW || !target?.isConnected) return null;
  const host = hostFor(target);
  host.classList.add("tv-chart");
  watchTheme();
  const opts = () => ({
    ...themeOptions(),
    autoSize: true,
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { visible: false },
    timeScale: { visible: false },
    crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
    handleScroll: false,
    handleScale: false,
    layout: { ...themeOptions().layout, attributionLogo: false },
  });
  const chart = LW.createChart(host, opts());
  const s = chart.addSeries(LW.AreaSeries, { lineColor: css(color), topColor: css("--chart-fill"), bottomColor: "rgba(0,0,0,0)", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
  s.setData(toPoints(times, values));
  chart.timeScale().fitContent();
  const ro = fitOnResize(chart, host);
  const handle = {
    chart,
    host,
    retheme() { chart.applyOptions(opts()); s.applyOptions({ lineColor: css(color), topColor: css("--chart-fill") }); },
    remove() { live.delete(handle); ro.disconnect(); try { chart.remove(); } catch { /* already gone */ } },
  };
  return track(handle);
}
