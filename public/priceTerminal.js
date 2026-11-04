// The Research → Overview price chart: timeframes, chart types, log scale, indicators, compare,
// drawing tools and the fund's own marks (cost basis, buys/sells, target, alerts), on
// lightweight-charts. Settings follow the member (prefs `chartSettings`, `chartDrawings`).
//
// Keyboard: focus the chart, then ←/→ move bar by bar (read out by a live region), +/− zoom,
// Home/End jump, Delete removes the selected drawing, Escape cancels a drawing or leaves full
// screen. The chart also has a text summary and a "View data" table.
//
// Menus (More, chart type, Display, Indicators, Compare, indicator settings) use the shared
// popover in public/ui/popover.js; the Indicators and Compare lists use public/ui/pickList.js.
import { esc, api, fmtUSD, fmtNum, getPref, setPref, icon } from "./shared.js";
import { ensureLW, themeOptions, css, dataTable, fitOnResize, SERIES } from "./tvchart.js";
import { togglePopover } from "./ui/popover.js";
import { pickList } from "./ui/pickList.js";
import { term } from "./glossary.js";
import * as I from "./indicators.js";

const FRAMES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y"];
const MORE_FRAMES = [["3M", "3 months"], ["2Y", "2 years"], ["MAX", "All history"]];
const TYPES = [["area", "Area"], ["line", "Line"], ["candles", "Candles"], ["bars", "Bars"], ["heikin", "Heikin Ashi"]];
const TOOLS = [
  ["cursor", "Select", "crosshair"], ["hline", "Horizontal line", "hline"], ["trend", "Trend line", "trend-line"], ["ray", "Ray", "ray"],
  ["rect", "Rectangle", "rectangle"], ["text", "Text note", "text"], ["measure", "Measure", "measure"],
];
const TOOL_HINT = {
  hline: "Click a price to place a horizontal line. Esc to cancel.",
  trend: "Click two points to draw a trend line. Esc to cancel.",
  ray: "Click two points to draw a ray. Esc to cancel.",
  rect: "Click two corners to draw a rectangle. Esc to cancel.",
  text: "Click where the note should go. Esc to cancel.",
  measure: "Click two points to measure the change between them. Esc to cancel.",
};
const TWO_POINT = new Set(["trend", "ray", "rect", "measure"]);
const MAX_COMPARE = 4;
const MAX_INDICATORS = 8; // lib/prefs.js keeps at most 8

const DEFAULTS = { frame: "1Y", type: "area", log: false, marks: true, indicators: [{ id: "sma", params: { n: 50 } }, { id: "sma", params: { n: 200 } }] };

// SMA and EMA can be on the chart more than once. Each new one takes the next common length
// that isn't already shown.
const REPEAT_LENGTHS = { sma: [50, 200, 20, 100], ema: [21, 9, 50, 200] };
export const PRESETS = [
  { id: "preset-trend", label: "Long-term trend: SMA 50 + SMA 200", description: "The two averages most often used to judge the long-term trend.", parts: [{ id: "sma", params: { n: 50 } }, { id: "sma", params: { n: 200 } }] },
  { id: "preset-momentum", label: "Momentum: RSI 14 + MACD", description: "Two momentum readings, each in its own pane below the price.", parts: [{ id: "rsi", params: { n: 14 } }, { id: "macd", params: { fast: 12, slow: 26, signal: 9 } }] },
];

const barCache = new Map(); // `${symbol}|${frame}` → response
async function loadBars(symbol, frame) {
  const key = `${symbol}|${frame}`;
  if (!barCache.has(key)) barCache.set(key, api(`/api/research/${encodeURIComponent(symbol)}/bars?frame=${frame}`).catch((e) => { barCache.delete(key); throw e; }));
  return barCache.get(key);
}
const sectorCache = new Map(); // symbol → Promise<{ sectorEtf, benchmark }>

const hexToRgba = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const localShift = (t) => t - new Date(t * 1000).getTimezoneOffset() * 60; // show local clock time
const compact = (v) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0));
const priceFmt = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3));

// ---- Pure helpers (unit-tested in test/chart.test.js) ----
export const param = (ind, key) => ind.params?.[key] ?? I.INDICATORS[ind.id].params.find((p) => p.key === key)?.def;
export function indicatorLabel(ind) {
  const def = I.INDICATORS[ind.id];
  const p = def.params.map((x) => param(ind, x.key));
  return p.length ? `${def.short} ${p.join(", ")}` : def.short;
}
const sameParams = (a, b) => indicatorLabel(a) === indicatorLabel(b);
export const countOf = (indicators, id) => indicators.filter((x) => x.id === id).length;

// Params for a new indicator of this id, given what's already on the chart.
export function defaultParamsFor(id, indicators) {
  const def = I.INDICATORS[id];
  const base = Object.fromEntries(def.params.map((p) => [p.key, p.def]));
  const lengths = REPEAT_LENGTHS[id];
  if (!lengths) return base;
  const used = new Set(indicators.filter((x) => x.id === id).map((x) => param(x, "n")));
  const n = lengths.find((v) => !used.has(v)) ?? lengths[0];
  return { ...base, n };
}

// Adds `toAdd` ([{ id, params }]) to `indicators`, skipping exact duplicates and dropping the
// oldest once there are MAX_INDICATORS. Returns the new list plus labels of what changed.
export function addIndicators(indicators, toAdd, max = MAX_INDICATORS) {
  const list = indicators.slice();
  const added = [], dropped = [];
  for (const ind of toAdd) {
    if (list.some((x) => sameParams(x, ind))) continue;
    if (list.length >= max) dropped.push(indicatorLabel(list.shift()));
    list.push({ id: ind.id, params: { ...ind.params } });
    added.push(indicatorLabel(ind));
  }
  return { list, added, dropped };
}

// Reads raw form values into params, inside each param's range. Returns { params } or { error }.
export function readParams(id, raw) {
  const def = I.INDICATORS[id];
  const params = {};
  for (const p of def.params) {
    const v = Number(raw[p.key]);
    if (raw[p.key] === "" || raw[p.key] == null || !Number.isFinite(v)) return { error: `${p.label} needs a number.` };
    if (v < p.min || v > p.max) return { error: `${p.label} must be from ${p.min} to ${p.max}.` };
    params[p.key] = v;
  }
  if (id === "macd" && params.fast >= params.slow) return { error: "Fast must be shorter than Slow." };
  return { params };
}

export const isMoreFrame = (f) => MORE_FRAMES.some(([k]) => k === f);

// ---- Small inline pictures for the chart type menu (no matching icon in icons.svg) ----
const TYPE_SVG = {
  area: '<path d="M2 14l4-5 3 3 4-6 5 5v5H2z" fill="currentColor" opacity=".25"/><path d="M2 14l4-5 3 3 4-6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>',
  line: '<path d="M2 14l4-5 3 3 4-6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>',
  candles: '<path d="M5 3v14M13 2v14" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="6" width="4" height="7" rx="1" fill="currentColor"/><rect x="11" y="4" width="4" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  bars: '<path d="M6 3v14M3 6h3M6 13h3M13 2v14M10 12h3M13 5h3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  heikin: '<path d="M5 2v15M13 4v12" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="5" width="4" height="9" rx="1" fill="currentColor"/><rect x="11" y="6" width="4" height="7" rx="1" fill="currentColor" opacity=".5"/>',
};
const typeSvg = (t) => `<svg class="icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">${TYPE_SVG[t] || TYPE_SVG.area}</svg>`;
const chev = () => icon("chevron-down", { size: 14 });

export function priceTerminalHtml(symbol) {
  return `
    <section class="panel ct-panel" id="ctPanel" aria-labelledby="chart-h">
      <div class="panel-head ct-head">
        <h3 id="chart-h">Price chart</h3>
      </div>
      <div class="ct-toolbar" role="group" aria-label="Chart controls">
        <div class="ct-seg" role="group" aria-label="Timeframe">
          ${FRAMES.map((f) => `<button type="button" class="ct-seg-btn" data-frame="${f}" aria-pressed="false">${f}</button>`).join("")}
          <button type="button" class="ct-seg-btn ct-more" id="ctMore" aria-haspopup="dialog" aria-expanded="false" aria-pressed="false" aria-label="More timeframes"><span id="ctMoreLabel">More</span>${chev()}</button>
        </div>
        <button type="button" class="ct-icon-btn ct-type-btn" id="ctType" aria-haspopup="dialog" aria-expanded="false" title="Chart type"><span id="ctTypeIcon">${typeSvg("area")}</span>${chev()}</button>
        <button type="button" class="btn btn-ghost btn-sm ct-menu-btn" id="ctDisplay" aria-haspopup="dialog" aria-expanded="false">Display${chev()}</button>
        <button type="button" class="btn btn-ghost btn-sm ct-menu-btn" id="ctIndBtn" aria-haspopup="dialog" aria-expanded="false">${icon("plus", { size: 14 })}Indicators</button>
        <button type="button" class="btn btn-ghost btn-sm ct-menu-btn" id="ctCmpBtn" aria-haspopup="dialog" aria-expanded="false">${icon("plus", { size: 14 })}Compare</button>
        <span class="ct-toolbar-end">
          <button type="button" class="ct-icon-btn" id="ctMax" aria-pressed="false" aria-label="Full screen" title="Full screen">${icon("maximize")}</button>
          <a class="ct-icon-btn" href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}" target="_blank" rel="noopener" aria-label="Open on TradingView (opens in a new tab)" title="Open on TradingView">${icon("external-link")}</a>
        </span>
      </div>
      <div class="ct-chips" id="ctChips"></div>
      <div class="ct-body">
        <div class="ct-draw" role="group" aria-label="Drawing tools">
          ${TOOLS.map(([t, label, ic]) => `<button type="button" class="ct-tool" data-tool="${t}" aria-pressed="${t === "cursor"}" aria-label="${label}" title="${label}">${icon(ic)}</button>`).join("")}
          <button type="button" class="ct-tool" id="ctDel" aria-label="Delete selected drawing" title="Delete selected drawing" disabled>${icon("trash")}</button>
          <button type="button" class="ct-tool" id="ctClear" aria-label="Remove all drawings" title="Remove all drawings">${icon("x")}</button>
        </div>
        <div class="ct-stage">
          <div class="ct-legend" id="ctLegend" aria-hidden="true"></div>
          <div class="ct-chart" id="ctChart" role="img" tabindex="0" aria-describedby="ctHelp"></div>
          <div class="ct-float hidden" id="ctFloat" role="group" aria-label="Selected drawing">
            <button type="button" class="btn btn-ghost btn-sm" id="ctFloatDel">${icon("trash", { size: 14 })}Delete</button>
          </div>
          <div class="ct-status muted small" id="ctStatus"></div>
        </div>
      </div>
      <p class="ct-hint small" id="ctHint" aria-live="polite"></p>
      <p id="ctHelp" class="sr-only">Use left and right arrow keys to move between bars, plus and minus to zoom, Home and End to jump.</p>
      <p class="sr-only" aria-live="polite" id="ctLive"></p>
    </section>`;
}

// ctx: { symbol, position, thesis, priceAlerts, trades, peers? }
export async function mountPriceTerminal(ctx) {
  const panel = document.getElementById("ctPanel");
  if (!panel) return;
  const $ = (id) => document.getElementById(id);
  const saved = getPref("chartSettings") || null;
  const state = {
    ...DEFAULTS,
    ...(saved || {}),
    indicators: (saved?.indicators || DEFAULTS.indicators).filter((x) => I.INDICATORS[x.id]),
    compare: [],
    tool: "cursor",
    selected: -1,
    pending: null,
    drawings: (getPref("chartDrawings") || {})[ctx.symbol] || [],
  };
  let view = null; // the live chart and its data

  const persist = () => setPref("chartSettings", { frame: state.frame, type: state.type, log: state.log, marks: state.marks, indicators: state.indicators });
  const saveDrawings = () => {
    const all = { ...(getPref("chartDrawings") || {}) };
    if (state.drawings.length) all[ctx.symbol] = state.drawings; else delete all[ctx.symbol];
    setPref("chartDrawings", all);
  };

  // ---- Toolbar state ----
  const indColor = (k, id) => (id === "vol" ? css("--muted") : css(SERIES[(k + 2) % SERIES.length]));
  const syncToolbar = () => {
    panel.querySelectorAll("[data-frame]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.frame === state.frame)));
    const more = isMoreFrame(state.frame);
    $("ctMore").setAttribute("aria-pressed", String(more));
    $("ctMoreLabel").textContent = more ? state.frame : "More";
    $("ctMore").setAttribute("aria-label", more ? `Timeframe ${state.frame}, more timeframes` : "More timeframes");
    const typeName = TYPES.find(([v]) => v === state.type)?.[1] || "Area";
    $("ctTypeIcon").innerHTML = typeSvg(state.type);
    $("ctType").setAttribute("aria-label", `Chart type: ${typeName}`);
    $("ctType").title = `Chart type: ${typeName}`;
    panel.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === state.tool)));
    $("ctDel").disabled = state.selected < 0;
    if (state.selected < 0) $("ctFloat").classList.add("hidden");
    $("ctChart").classList.toggle("is-drawing", state.tool !== "cursor");
    syncHint();
    $("ctChips").innerHTML = [
      ...state.indicators.map((ind, i) => {
        const label = esc(indicatorLabel(ind));
        return `<span class="ct-chip"><button type="button" class="ct-chip-main" data-edit-ind="${i}" aria-haspopup="dialog" aria-expanded="false" aria-label="${label} settings" title="Change or remove"><i style="--c:${indColor(i, ind.id)}"></i>${label}</button><button type="button" class="ct-chip-x" data-rm-ind="${i}" aria-label="Remove ${label}" title="Remove">${icon("x", { size: 14 })}</button></span>`;
      }),
      ...state.compare.map((s, i) => `<span class="ct-chip ct-chip-cmp"><span class="ct-chip-main"><i style="--c:${css(SERIES[(i + 1) % SERIES.length])}"></i>${esc(s)}</span><button type="button" class="ct-chip-x" data-rm-cmp="${i}" aria-label="Stop comparing with ${esc(s)}" title="Stop comparing">${icon("x", { size: 14 })}</button></span>`),
    ].join("");
  };
  const syncHint = () => {
    const hint = $("ctHint");
    let text = "";
    if (state.tool !== "cursor") text = state.pending ? "Now click the second point. Esc to cancel." : TOOL_HINT[state.tool] || "";
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.toggle("is-empty", !text);
  };

  // A menu of buttons inside a popover. items: [{ label, sub, pressed, html, onSelect }].
  // Arrow keys move between items; picking closes the menu unless keepOpen.
  function openMenu(anchor, label, makeItems, { keepOpen = false, width = 220 } = {}) {
    const box = document.createElement("div");
    box.className = "ct-menu";
    const render = () => {
      const items = makeItems();
      box.innerHTML = items.map((it, i) => `<button type="button" class="ct-menu-item" data-i="${i}" aria-pressed="${it.pressed ? "true" : "false"}">
        ${it.html ? `<span class="ct-menu-pic">${it.html}</span>` : ""}<span class="ct-menu-text">${esc(it.label)}${it.sub ? `<span class="ct-menu-sub">${esc(it.sub)}</span>` : ""}</span>
        <span class="ct-menu-check">${it.pressed ? icon("check", { size: 16 }) : ""}</span></button>`).join("");
      return items;
    };
    let items = render();
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".ct-menu-item");
      if (!b) return;
      const i = Number(b.dataset.i);
      if (!keepOpen) pop.close();
      items[i].onSelect();
      if (keepOpen) { items = render(); box.querySelector(`[data-i="${i}"]`)?.focus(); }
    });
    box.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const bs = [...box.querySelectorAll(".ct-menu-item")];
      const at = bs.indexOf(document.activeElement);
      const to = e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length;
      bs[to]?.focus();
    });
    const pop = togglePopover({ anchor, content: box, label, width, placement: "bottom-start" });
    if (pop) (box.querySelector('[aria-pressed="true"]') || box.querySelector(".ct-menu-item"))?.focus();
    return pop;
  }

  // ---- Indicators ----
  const indItems = () => [
    ...PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description, group: "Presets" })), // no keywords: typing "sma" should land on SMA itself, not a preset
    ...Object.entries(I.INDICATORS).map(([id, def]) => ({ id, label: def.label, description: def.description, group: def.group, keywords: [def.short, id] })),
  ];
  const presetOn = (p) => p.parts.every((part) => state.indicators.some((x) => sameParams(x, part)));
  function openIndicators() {
    const anchor = $("ctIndBtn");
    const box = document.createElement("div");
    box.className = "ct-ind-pop";
    const note = document.createElement("p");
    note.className = "ct-pop-note";
    note.setAttribute("role", "status");
    const foot = document.createElement("p");
    foot.className = "ct-pop-foot";
    foot.textContent = "Click an indicator's chip above the chart to change its settings or remove it.";
    const list = pickList({
      items: indItems(),
      groups: ["Presets", "Trend", "Momentum", "Volatility", "Volume"],
      placeholder: "Search indicators",
      recentKey: "pif.chart.recentIndicators",
      emptyText: "No indicator matches",
      isSelected: (it) => (it.id.startsWith("preset-") ? presetOn(PRESETS.find((p) => p.id === it.id)) : countOf(state.indicators, it.id) > 0),
      renderRight: (it) => {
        const n = it.id.startsWith("preset-") ? 0 : countOf(state.indicators, it.id);
        const gl = I.INDICATORS[it.id]?.glossary;
        return `${n > 1 ? `<span class="ct-pick-count" aria-label="${n} on the chart">${n}</span>` : ""}${gl ? term(gl, "") : ""}`;
      },
      onPick: (it) => {
        let toAdd;
        if (it.id.startsWith("preset-")) toAdd = PRESETS.find((p) => p.id === it.id).parts;
        else if (REPEAT_LENGTHS[it.id] || !countOf(state.indicators, it.id)) toAdd = [{ id: it.id, params: defaultParamsFor(it.id, state.indicators) }];
        else { note.textContent = `${I.INDICATORS[it.id].short} is already on the chart. Click its chip to change it.`; return; }
        const r = addIndicators(state.indicators, toAdd);
        if (!r.added.length) { note.textContent = "Already on the chart."; return; }
        state.indicators = r.list;
        persist();
        draw();
        list.refresh();
        note.textContent = `Added ${r.added.join(" and ")}.${r.dropped.length ? ` Removed ${r.dropped.join(" and ")} (${MAX_INDICATORS} at most).` : ""}`;
      },
    });
    // A click on a row's "?" (glossary) must not count as picking the row.
    box.addEventListener("click", (e) => { if (e.target.closest("[data-term], .term-def")) e.stopPropagation(); }, true);
    box.append(list.el, note, foot);
    togglePopover({ anchor, content: box, label: "Add indicators", width: 380 });
  }

  // Settings for one indicator on the chart: its params, Apply, Remove.
  function openSettings(i) {
    const anchor = panel.querySelector(`[data-edit-ind="${i}"]`);
    const ind = state.indicators[i];
    if (!anchor || !ind) return;
    const def = I.INDICATORS[ind.id];
    const form = document.createElement("form");
    form.className = "ct-set";
    form.noValidate = true;
    form.innerHTML = `
      <p class="ct-set-title">${esc(def.label)}</p>
      ${def.params.length ? def.params.map((p) => `<label class="ct-set-field"><span>${esc(p.label)} <span class="ct-set-range">${p.min} to ${p.max}</span></span>
        <input type="number" name="${p.key}" value="${param(ind, p.key)}" min="${p.min}" max="${p.max}" step="${p.step || 1}" inputmode="decimal" required /></label>`).join("")
        : `<p class="ct-set-none">This indicator has no settings.</p>`}
      <p class="ct-set-err" role="alert"></p>
      <div class="ct-set-actions">
        ${def.params.length ? `<button class="btn btn-primary btn-sm">Apply</button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm" data-remove>${icon("trash", { size: 14 })}Remove</button>
      </div>`;
    const pop = togglePopover({ anchor, content: form, label: `${indicatorLabel(ind)} settings`, width: 260 });
    if (!pop) return;
    form.querySelector("input")?.select();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = Object.fromEntries(def.params.map((p) => [p.key, form.elements[p.key].value.trim()]));
      const r = readParams(ind.id, raw);
      if (r.error) { form.querySelector(".ct-set-err").textContent = r.error; return; }
      const next = { id: ind.id, params: r.params };
      const dup = state.indicators.findIndex((x, k) => k !== i && sameParams(x, next));
      if (dup >= 0) { form.querySelector(".ct-set-err").textContent = `${indicatorLabel(next)} is already on the chart.`; return; }
      state.indicators[i] = next;
      pop.close({ returnFocus: false });
      persist();
      draw();
      panel.querySelector(`[data-edit-ind="${i}"]`)?.focus();
      announce(`Changed to ${indicatorLabel(next)}.`);
    });
    form.querySelector("[data-remove]").addEventListener("click", () => {
      pop.close({ returnFocus: false });
      removeIndicator(i);
    });
  }
  function removeIndicator(i) {
    const label = indicatorLabel(state.indicators[i]);
    state.indicators.splice(i, 1);
    persist();
    draw();
    (panel.querySelector(`[data-edit-ind="${Math.min(i, state.indicators.length - 1)}"]`) || $("ctIndBtn")).focus();
    announce(`Removed ${label}.`);
  }

  // ---- Compare ----
  const TICKER_RE = /^[A-Z][A-Z0-9.\-^=]{0,9}$/;
  function suggestions(extra) {
    const out = [{ id: "SPY", label: "SPY", description: "S&P 500 index fund" }];
    if (extra?.benchmark && TICKER_RE.test(extra.benchmark) && extra.benchmark !== "SPY") out.push({ id: extra.benchmark, label: extra.benchmark, description: extra.benchmarkLabel ? `${extra.benchmarkLabel} (the fund's benchmark)` : "The fund's benchmark" });
    if (extra?.sectorEtf) out.push({ id: extra.sectorEtf, label: extra.sectorEtf, description: "Sector ETF for this company" });
    for (const p of ctx.peers || []) {
      const sym = String(typeof p === "string" ? p : p?.symbol || p?.ticker || "").toUpperCase();
      if (sym) out.push({ id: sym, label: sym, description: (typeof p === "object" && p?.name) || "Peer company" });
    }
    const seen = new Set([ctx.symbol]);
    return out.filter((x) => !seen.has(x.id) && seen.add(x.id)).map((x) => ({ ...x, group: "Suggestions" }));
  }
  function openCompare() {
    const anchor = $("ctCmpBtn");
    const items = suggestions(null);
    const box = document.createElement("div");
    box.className = "ct-cmp-pop";
    const note = document.createElement("p");
    note.className = "ct-pop-note";
    note.setAttribute("role", "status");
    const foot = document.createElement("p");
    foot.className = "ct-pop-foot";
    foot.textContent = `Compared lines show % change from the first day shown. Up to ${MAX_COMPARE}. Pick a ticker again to remove it.`;
    const list = pickList({
      items,
      groups: ["Suggestions", "Search results"],
      placeholder: "Ticker or company name",
      emptyText: "Type a ticker. No match for",
      isSelected: (it) => state.compare.includes(it.id),
      onPick: (it) => {
        const s = it.id;
        const at = state.compare.indexOf(s);
        if (at >= 0) { state.compare.splice(at, 1); note.textContent = `Stopped comparing with ${s}.`; }
        else {
          let dropped = "";
          if (state.compare.length >= MAX_COMPARE) dropped = state.compare.shift();
          state.compare.push(s);
          note.textContent = `Comparing with ${s}.${dropped ? ` Removed ${dropped} (${MAX_COMPARE} at most).` : ""}`;
        }
        draw();
        list.refresh();
      },
    });
    const replace = (next) => { items.splice(0, items.length, ...next); list.refresh(); };
    // Fill in the fund benchmark and sector ETF when the risk endpoint answers.
    if (!sectorCache.has(ctx.symbol)) sectorCache.set(ctx.symbol, api(`/api/research/${encodeURIComponent(ctx.symbol)}/risk`).then((r) => ({ sectorEtf: r.sectorEtf, benchmark: r.benchmark, benchmarkLabel: r.benchmarkLabel })).catch(() => null));
    let base = items.slice();
    sectorCache.get(ctx.symbol).then((extra) => {
      if (!extra || !box.isConnected) return;
      base = suggestions(extra);
      replace([...base, ...items.filter((x) => x.group !== "Suggestions")]);
    });
    // Live ticker search as you type.
    const input = list.el.querySelector("input");
    let timer = null, seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { replace(base); return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        let results = [];
        try { results = (await api(`/api/symbols/search?q=${encodeURIComponent(q)}`)).results || []; } catch { /* offline: typed ticker only */ }
        if (mine !== seq || !box.isConnected) return;
        const found = results.filter((r) => r.symbol && r.symbol !== ctx.symbol).slice(0, 8).map((r) => ({
          id: r.symbol.toUpperCase(), label: r.symbol.toUpperCase(),
          description: [r.name, r.exchange, r.owned ? "Owned" : r.watching ? "Watching" : ""].filter(Boolean).join(" · "),
          group: "Search results", keywords: [q],
        }));
        const typed = q.toUpperCase();
        // Offer the typed text as a ticker only when the search found nothing and it looks like one.
        if (!results.length && typed.length <= 6 && TICKER_RE.test(typed) && typed !== ctx.symbol && !found.some((r) => r.id === typed) && !base.some((r) => r.id === typed)) {
          found.push({ id: typed, label: typed, description: "Compare with this ticker", group: "Search results", keywords: [q] });
        }
        replace([...base, ...found]);
      }, 200);
    });
    box.append(list.el, note, foot);
    togglePopover({ anchor, content: box, label: "Compare with other tickers", width: 360 });
  }

  // ---- Wiring ----
  panel.querySelectorAll("[data-frame]").forEach((b) => b.addEventListener("click", () => { state.frame = b.dataset.frame; persist(); draw(); }));
  $("ctMore").addEventListener("click", () => openMenu($("ctMore"), "More timeframes", () => MORE_FRAMES.map(([f, sub]) => ({
    label: f, sub, pressed: state.frame === f, onSelect: () => { state.frame = f; persist(); draw(); },
  })), { width: 200 }));
  $("ctType").addEventListener("click", () => openMenu($("ctType"), "Chart type", () => TYPES.map(([v, l]) => ({
    label: l, html: typeSvg(v), pressed: state.type === v, onSelect: () => { state.type = v; persist(); draw(); },
  }))));
  $("ctDisplay").addEventListener("click", () => openMenu($("ctDisplay"), "Display", () => [
    { label: "Log scale", sub: "Equal % moves look the same size", pressed: state.log, onSelect: () => { state.log = !state.log; persist(); draw(); } },
    { label: "Fund marks", sub: "Cost basis, fund buys and sells, target, alerts", pressed: state.marks, onSelect: () => { state.marks = !state.marks; persist(); draw(); } },
  ], { keepOpen: true, width: 280 }));
  $("ctIndBtn").addEventListener("click", openIndicators);
  $("ctCmpBtn").addEventListener("click", openCompare);
  $("ctChips").addEventListener("click", (e) => {
    const ei = e.target.closest("[data-edit-ind]")?.dataset.editInd;
    const ri = e.target.closest("[data-rm-ind]")?.dataset.rmInd;
    const rc = e.target.closest("[data-rm-cmp]")?.dataset.rmCmp;
    if (ei != null) openSettings(Number(ei));
    if (ri != null) removeIndicator(Number(ri));
    if (rc != null) {
      const s = state.compare.splice(Number(rc), 1)[0];
      draw();
      (panel.querySelector(`[data-rm-cmp="${Math.min(Number(rc), state.compare.length - 1)}"]`) || $("ctCmpBtn")).focus();
      announce(`Stopped comparing with ${s}.`);
    }
  });
  // The indicator names in the legend open the same settings as the chips (mouse shortcut).
  $("ctLegend").addEventListener("click", (e) => {
    const k = e.target.closest("[data-ind]")?.dataset.ind;
    if (k != null) openSettings(Number(k));
  });
  panel.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
  $("ctDel").addEventListener("click", () => deleteSelected());
  $("ctFloatDel").addEventListener("click", () => { deleteSelected(); $("ctChart").focus(); });
  $("ctClear").addEventListener("click", () => {
    if (!state.drawings.length) return;
    state.drawings = [];
    state.selected = -1;
    saveDrawings();
    view?.requestUpdate();
    syncToolbar();
    announce("All drawings removed.");
  });
  $("ctMax").addEventListener("click", () => setMax(!panel.classList.contains("ct-max")));
  document.addEventListener("keydown", onDocKey);

  function onDocKey(e) {
    if (!panel.isConnected) { document.removeEventListener("keydown", onDocKey); return; }
    // Open popovers handle Escape themselves (public/ui/popover.js) and stop it there.
    if (e.key === "Escape") {
      if (state.pending || state.tool !== "cursor") { state.pending = null; setTool("cursor"); view?.requestUpdate(); return; }
      if (state.selected >= 0 && panel.contains(document.activeElement)) { state.selected = -1; syncToolbar(); view?.requestUpdate(); return; }
      if (panel.classList.contains("ct-max")) setMax(false);
    }
  }
  function setMax(on) {
    panel.classList.toggle("ct-max", on);
    document.body.classList.toggle("ct-max-open", on);
    const b = $("ctMax");
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    b.title = on ? "Exit full screen (Esc)" : "Full screen";
    b.innerHTML = icon(on ? "minimize" : "maximize");
  }
  function setTool(t) {
    state.tool = t;
    state.pending = null;
    if (t !== "cursor") state.selected = -1;
    view?.chart.applyOptions({ handleScroll: t === "cursor", handleScale: t === "cursor" });
    syncToolbar();
    view?.requestUpdate();
  }
  function deleteSelected() {
    if (state.selected < 0) return;
    state.drawings.splice(state.selected, 1);
    state.selected = -1;
    saveDrawings();
    view?.requestUpdate();
    syncToolbar();
    announce("Drawing deleted.");
  }
  let liveTimer = null;
  const announce = (msg) => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if ($("ctLive")) $("ctLive").textContent = msg; }, 250);
  };

  // ---- Chart ----
  async function draw() {
    syncToolbar();
    const status = $("ctStatus");
    status.textContent = "Loading…";
    let main, cmps;
    const [LW] = await Promise.all([ensureLW()]);
    try {
      [main, ...cmps] = await Promise.all([loadBars(ctx.symbol, state.frame), ...state.compare.map((s) => loadBars(s, state.frame).catch(() => ({ bars: [], error: "not found" })))]);
    } catch (err) {
      status.textContent = `Couldn't load prices: ${err.message}`;
      return;
    }
    if (!$("ctChart")) return;
    if (!LW) { status.textContent = "The chart library didn't load. Check your connection."; return; }
    const bars = (main.bars || []).filter((b) => Number.isFinite(b.close));
    if (!bars.length) { status.textContent = main.error ? `No price data: ${main.error}` : "No price data for this timeframe."; view?.remove(); view = null; return; }
    status.textContent = cmps.some((c) => !c.bars?.length) ? `No data for ${state.compare.filter((_, i) => !cmps[i].bars?.length).join(", ")}.` : "";
    view?.remove();
    view = build(LW, main, bars, cmps);
  }

  function build(LW, main, rawBars, cmps) {
    const host = $("ctChart");
    host.innerHTML = "";
    const intraday = !!main.intraday;
    // Unique, ascending times; OHLC filled in when Yahoo only sent a close.
    const seenAll = new Set();
    const all = [];
    for (const b of rawBars) {
      const t = intraday ? localShift(b.time) : b.date;
      if (seenAll.has(t)) { all[all.length - 1] = { ...b, t }; continue; }
      seenAll.add(t);
      all.push({ ...b, t, open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close });
    }
    // Daily frames arrive with extra history before the window (`visibleFrom`). Indicators use
    // all of it, so a 200-day average starts on the window's first day; only the window is drawn.
    const startIdx = main.visibleFrom ? all.findIndex((b) => b.date >= main.visibleFrom) : -1;
    const off = startIdx > 0 ? startIdx : 0;
    const bars = all.slice(off);
    const cut = (arr) => arr.slice(off);
    const seen = new Set(bars.map((b) => b.t));
    const up = css("--green"), down = css("--red"), line = css("--chart-line");
    const percent = state.compare.length > 0;
    const chart = LW.createChart(host, {
      ...themeOptions(),
      autoSize: true,
      timeScale: { borderVisible: false, timeVisible: intraday, secondsVisible: false, rightOffset: 4 },
      crosshair: { ...themeOptions().crosshair, mode: LW.CrosshairMode.Normal },
      handleScroll: state.tool === "cursor",
      handleScale: state.tool === "cursor",
    });
    const priceFormat = { type: "custom", formatter: priceFmt, minMove: 0.001 };
    const ohlc = state.type === "heikin" ? cut(I.heikinAshi(all)) : bars;
    let series;
    if (percent) {
      // Comparing: everything as lines on a % scale.
      series = chart.addSeries(LW.LineSeries, { color: line, lineWidth: 2, priceFormat });
      series.setData(bars.map((b) => ({ time: b.t, value: b.close })));
    } else if (state.type === "candles" || state.type === "heikin") {
      series = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat });
      series.setData(ohlc.map((b) => ({ time: b.t, open: b.open, high: b.high, low: b.low, close: b.close })));
    } else if (state.type === "bars") {
      series = chart.addSeries(LW.BarSeries, { upColor: up, downColor: down, thinBars: false, priceFormat });
      series.setData(bars.map((b) => ({ time: b.t, open: b.open, high: b.high, low: b.low, close: b.close })));
    } else if (state.type === "line") {
      series = chart.addSeries(LW.LineSeries, { color: line, lineWidth: 2, priceFormat });
      series.setData(bars.map((b) => ({ time: b.t, value: b.close })));
    } else {
      series = chart.addSeries(LW.AreaSeries, { lineColor: line, topColor: css("--chart-fill"), bottomColor: "rgba(0,0,0,0)", lineWidth: 2, priceFormat });
      series.setData(bars.map((b) => ({ time: b.t, value: b.close })));
    }

    // Compare lines share the price pane (percent mode).
    const cmpSeries = [];
    cmps.forEach((c, i) => {
      if (!c.bars?.length) return;
      const s = chart.addSeries(LW.LineSeries, { color: css(SERIES[(i + 1) % SERIES.length]), lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: state.compare[i] });
      const byT = new Map();
      for (const b of c.bars) if (Number.isFinite(b.close)) byT.set(intraday ? localShift(b.time) : b.date, b.close);
      s.setData([...byT].filter(([t]) => seen.has(t)).map(([time, value]) => ({ time, value })));
      cmpSeries.push({ s, label: state.compare[i] });
    });

    // Indicators.
    const closes = all.map((b) => b.close);
    const legendItems = [];
    let pane = 1;
    const lineOn = (values, color, p = 0, opts = {}) => {
      const s = chart.addSeries(LW.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts }, p);
      s.setData(values.map((v, i) => (v == null ? { time: bars[i].t } : { time: bars[i].t, value: v })));
      return s;
    };
    state.indicators.forEach((ind, k) => {
      const color = css(SERIES[(k + 2) % SERIES.length]);
      const label = indicatorLabel(ind);
      if (ind.id === "sma" || ind.id === "ema") {
        if (percent) return;
        const s = lineOn(cut((ind.id === "sma" ? I.sma : I.ema)(closes, param(ind, "n"))), color);
        legendItems.push({ k, label, color, series: [s] });
      } else if (ind.id === "bb") {
        if (percent) return;
        const b = I.bollinger(closes, param(ind, "n"), param(ind, "k"));
        const ss = [lineOn(cut(b.upper), color, 0, { lineStyle: LW.LineStyle.Dashed }), lineOn(cut(b.mid), color), lineOn(cut(b.lower), color, 0, { lineStyle: LW.LineStyle.Dashed })];
        legendItems.push({ k, label, color, series: ss });
      } else if (ind.id === "vwap") {
        if (!intraday || percent) return;
        legendItems.push({ k, label, color, series: [lineOn(cut(I.vwap(all)), color)] });
      } else if (ind.id === "vol") {
        const s = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "custom", formatter: compact, minMove: 1 }, priceLineVisible: false, lastValueVisible: false }, pane);
        s.setData(bars.map((b, i) => ({ time: b.t, value: b.volume || 0, color: hexToRgba(b.close >= (all[off + i - 1]?.close ?? b.open) ? up : down, 0.5) })));
        legendItems.push({ k, label, color: css("--muted"), series: [s], fmt: compact });
        pane++;
      } else if (ind.id === "rsi") {
        const s = lineOn(cut(I.rsi(closes, param(ind, "n"))), color, pane, { priceFormat: { type: "custom", formatter: (v) => v.toFixed(0), minMove: 1 } });
        for (const lvl of [70, 30]) s.createPriceLine({ price: lvl, color: css("--border-strong"), lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false });
        legendItems.push({ k, label, color, series: [s], fmt: (v) => v.toFixed(1) });
        pane++;
      } else if (ind.id === "macd") {
        const m = I.macd(closes, param(ind, "fast"), param(ind, "slow"), param(ind, "signal"));
        const h = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        h.setData(cut(m.hist).map((v, i) => (v == null ? { time: bars[i].t } : { time: bars[i].t, value: v, color: hexToRgba(v >= 0 ? up : down, 0.5) })));
        const a = lineOn(cut(m.macd), color, pane), b = lineOn(cut(m.signal), css("--s2"), pane);
        legendItems.push({ k, label, color, series: [a, b], fmt: (v) => v.toFixed(2) });
        pane++;
      } else if (ind.id === "atr") {
        legendItems.push({ k, label, color, series: [lineOn(cut(I.atr(all, param(ind, "n"))), color, pane)], fmt: (v) => v.toFixed(2) });
        pane++;
      }
    });
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
    // Percent (compare) and log modes are for the price pane only, not RSI/MACD/volume.
    chart.priceScale("right", 0).applyOptions({ mode: percent ? LW.PriceScaleMode.Percentage : state.log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal });

    // The fund's own marks.
    if (state.marks && !percent) {
      const pl = (price, title, color) => Number.isFinite(price) && price > 0 && series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title });
      pl(ctx.position?.avgCost, "Avg cost", css("--s3"));
      pl(ctx.thesis?.targetPrice, "Target", css("--s4"));
      for (const a of ctx.priceAlerts || []) pl(a.price, `Alert ${a.direction}`, css("--warn"));
      const markers = [];
      for (const tr of ctx.trades || []) {
        const bar = bars.find((b) => b.date >= tr.date);
        if (!bar || (intraday && bar.date !== tr.date)) continue;
        const buy = tr.type === "buy";
        markers.push({ time: bar.t, position: buy ? "belowBar" : "aboveBar", shape: buy ? "arrowUp" : "arrowDown", color: buy ? up : down, text: `${buy ? "Buy" : "Sell"} ${+Number(tr.shares).toFixed(2)}` });
      }
      if (markers.length) LW.createSeriesMarkers(series, markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)));
    }

    // ---- Drawings (one primitive draws them all) ----
    const epochs = bars.map((b) => b.time);
    const ts = chart.timeScale();
    const logicalOf = (epoch) => {
      const n = epochs.length;
      if (n === 1) return 0;
      if (epoch <= epochs[0]) return (epoch - epochs[0]) / (epochs[1] - epochs[0]);
      if (epoch >= epochs[n - 1]) return n - 1 + (epoch - epochs[n - 1]) / (epochs[n - 1] - epochs[n - 2]);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (epochs[mid] <= epoch) lo = mid; else hi = mid; }
      return lo + (epoch - epochs[lo]) / (epochs[hi] - epochs[lo]);
    };
    const epochOf = (logical) => {
      const n = epochs.length;
      if (n === 1) return epochs[0];
      const i = Math.max(0, Math.min(n - 2, Math.floor(logical)));
      return Math.round(epochs[i] + (logical - i) * (epochs[i + 1] - epochs[i]));
    };
    const xy = (pt) => {
      const x = ts.logicalToCoordinate(logicalOf(pt.time));
      const y = series.priceToCoordinate(pt.price);
      return x == null || y == null ? null : { x, y };
    };
    let requestUpdate = () => {};
    const accent = () => css("--accent");
    const shapeOf = (d) => {
      const a = xy(d.p[0]);
      const b = d.p[1] ? xy(d.p[1]) : null;
      return { a, b };
    };
    // The small toolbar (Delete) next to the selected drawing.
    const float = $("ctFloat");
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const placeFloat = (mediaSize) => {
      const d = state.drawings[state.selected];
      let x = null, y = null;
      if (d && state.tool === "cursor") {
        if (d.t === "hline") { y = series.priceToCoordinate(d.p[0].price); x = mediaSize.width / 2; }
        else {
          const { a, b } = shapeOf(d);
          if (a) { x = Math.max(a.x, b?.x ?? a.x); y = Math.min(a.y, b?.y ?? a.y) - (d.t === "text" ? 14 : 0); }
        }
      }
      if (x == null || y == null) { float.classList.add("hidden"); return; }
      float.classList.remove("hidden");
      const w = float.offsetWidth, h = float.offsetHeight;
      float.style.left = `${clamp(x + 8, 4, mediaSize.width - w - 4)}px`;
      float.style.top = `${clamp(y - h - 8, 4, mediaSize.height - h - 4)}px`;
    };
    const renderer = {
      draw(target) {
        target.useMediaCoordinateSpace(({ context: g, mediaSize }) => {
          const list = state.pending ? [...state.drawings, state.pending] : state.drawings;
          list.forEach((d, i) => {
            const sel = i === state.selected || d === state.pending;
            const col = accent();
            g.save();
            g.strokeStyle = col;
            g.fillStyle = col;
            g.lineWidth = sel ? 2.5 : 1.5;
            g.font = `12px ${getComputedStyle(document.body).fontFamily}`;
            const { a, b } = shapeOf(d);
            if (d.t === "hline") {
              const y = series.priceToCoordinate(d.p[0].price);
              if (y != null) {
                g.beginPath(); g.moveTo(0, y); g.lineTo(mediaSize.width, y); g.stroke();
                g.fillText(priceFmt(d.p[0].price), 6, y - 4);
              }
            } else if (d.t === "text" && a) {
              const pad = 4, w = g.measureText(d.text || "").width;
              g.globalAlpha = 0.15; g.fillRect(a.x - pad, a.y - 14, w + pad * 2, 20); g.globalAlpha = 1;
              g.fillStyle = css("--text");
              g.fillText(d.text || "", a.x, a.y);
            } else if (a && b) {
              if (d.t === "trend") { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
              if (d.t === "ray") {
                const dx = b.x - a.x, dy = b.y - a.y, k = dx === 0 ? 0 : (mediaSize.width - a.x) / dx;
                g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(dx >= 0 && dx !== 0 ? a.x + dx * k : b.x, dx >= 0 && dx !== 0 ? a.y + dy * k : b.y); g.stroke();
              }
              if (d.t === "rect" || d.t === "measure") {
                const up2 = d.p[1].price >= d.p[0].price;
                const tint = d.t === "measure" ? (up2 ? css("--green") : css("--red")) : col;
                g.globalAlpha = 0.12; g.fillStyle = tint; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.globalAlpha = 1;
                g.strokeStyle = tint; g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
                if (d.t === "measure") {
                  const chg = d.p[1].price - d.p[0].price, pct = (chg / d.p[0].price) * 100;
                  const n = Math.round(Math.abs(logicalOf(d.p[1].time) - logicalOf(d.p[0].time)));
                  const text = `${chg >= 0 ? "+" : ""}${priceFmt(chg)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%) · ${n} bars`;
                  const w = g.measureText(text).width + 12;
                  const lx = Math.min(a.x, b.x) + Math.abs(b.x - a.x) / 2 - w / 2, ly = Math.min(a.y, b.y) - 24;
                  g.fillStyle = tint; g.fillRect(lx, ly, w, 18);
                  g.fillStyle = "#fff"; g.fillText(text, lx + 6, ly + 13);
                }
              }
            }
            if (sel && a) {
              g.fillStyle = css("--panel");
              for (const p of [a, b].filter(Boolean)) { g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fill(); g.stroke(); }
            }
            g.restore();
          });
          placeFloat(mediaSize);
        });
      },
    };
    series.attachPrimitive({
      attached(p) { requestUpdate = p.requestUpdate; },
      detached() { requestUpdate = () => {}; },
      paneViews() { return [{ zOrder: () => "top", renderer: () => renderer }]; },
    });

    const pointFromParam = (p) => {
      if (!p.point) return null;
      const logical = ts.coordinateToLogical(p.point.x);
      const price = series.coordinateToPrice(p.point.y);
      if (logical == null || price == null) return null;
      return { time: epochOf(logical), price: Number(price) };
    };
    const distToSeg = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    const hit = (pt) => {
      for (let i = state.drawings.length - 1; i >= 0; i--) {
        const d = state.drawings[i];
        const { a, b } = shapeOf(d);
        if (d.t === "hline") { const y = series.priceToCoordinate(d.p[0].price); if (y != null && Math.abs(pt.y - y) < 6) return i; }
        else if (d.t === "text" && a) { if (pt.x >= a.x - 4 && pt.x <= a.x + 160 && Math.abs(pt.y - a.y + 4) < 12) return i; }
        else if (a && b) {
          if ((d.t === "trend" || d.t === "ray") && distToSeg(pt, a, b) < 6) return i;
          if ((d.t === "rect" || d.t === "measure") && pt.x >= Math.min(a.x, b.x) - 4 && pt.x <= Math.max(a.x, b.x) + 4 && pt.y >= Math.min(a.y, b.y) - 4 && pt.y <= Math.max(a.y, b.y) + 4) return i;
        }
      }
      return -1;
    };

    chart.subscribeClick((p) => {
      if (p.paneIndex && p.paneIndex > 0) return;
      const pt = pointFromParam(p);
      if (state.tool === "cursor") {
        state.selected = p.point ? hit(p.point) : -1;
        syncToolbar();
        requestUpdate();
        return;
      }
      if (!pt) return;
      if (state.tool === "hline") {
        state.drawings.push({ t: "hline", p: [pt] });
        finish(`Horizontal line at ${priceFmt(pt.price)}.`);
      } else if (state.tool === "text") {
        askText(p.point, (text) => { if (text) { state.drawings.push({ t: "text", p: [pt], text }); finish("Text note added."); } });
      } else if (TWO_POINT.has(state.tool)) {
        if (!state.pending) { state.pending = { t: state.tool, p: [pt, pt] }; syncHint(); }
        else {
          state.pending.p[1] = pt;
          state.drawings.push(state.pending);
          state.pending = null;
          finish(`${TOOLS.find((t) => t[0] === state.tool)[1]} added.`);
        }
      }
      requestUpdate();
    });
    function finish(msg) {
      saveDrawings();
      setTool("cursor");
      state.selected = state.drawings.length - 1; // select the new drawing so Delete undoes it
      syncToolbar();
      announce(msg);
    }
    function askText(point, done) {
      const box = document.createElement("form");
      box.className = "ct-textbox";
      box.style.left = `${Math.min(point.x, host.clientWidth - 200)}px`;
      box.style.top = `${point.y}px`;
      box.innerHTML = `<label class="sr-only" for="ctTextIn">Note text</label><input id="ctTextIn" maxlength="120" placeholder="Note, then Enter" />`;
      host.appendChild(box);
      const input = box.querySelector("input");
      input.focus();
      let doneOnce = false;
      const end = (v) => { if (doneOnce) return; doneOnce = true; box.remove(); done(v); host.focus(); };
      box.addEventListener("submit", (e) => { e.preventDefault(); end(input.value.trim()); });
      input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); end(""); } });
      input.addEventListener("blur", () => end(input.value.trim()));
    }

    // ---- Legend (OHLC + indicator values under the crosshair, else the latest bar) ----
    const legend = $("ctLegend");
    const byTime = new Map(bars.map((b, i) => [b.t, i]));
    const legendHtml = (i) => {
      const b = bars[i], prev = all[off + i - 1];
      const chg = prev ? (b.close / prev.close - 1) * 100 : null;
      const when = intraday ? new Date((b.time) * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : b.date;
      const val = (s) => { const d = s.dataByIndex?.(i); return d && Number.isFinite(d.value) ? d.value : null; };
      return `
        <span class="ct-lg-sym">${esc(ctx.symbol)}</span><span class="muted">${esc(when)}</span>
        ${state.type === "line" || state.type === "area" || percent ? `<span>Close <b>${priceFmt(b.close)}</b></span>` : `<span>O <b>${priceFmt(b.open)}</b></span><span>H <b>${priceFmt(b.high)}</b></span><span>L <b>${priceFmt(b.low)}</b></span><span>C <b>${priceFmt(b.close)}</b></span>`}
        ${chg != null ? `<span class="${chg >= 0 ? "tone-good" : "tone-bad"}">${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%</span>` : ""}
        ${legendItems.map((li) => { const vs = li.series.map(val).filter((v) => v != null); return vs.length ? `<span class="ct-lg-ind" data-ind="${li.k}" title="Change or remove ${esc(li.label)}"><i style="--c:${li.color}"></i>${esc(li.label)} <b>${vs.map((v) => (li.fmt || priceFmt)(v)).join(" / ")}</b></span>` : ""; }).join("")}
        ${cmpSeries.map(({ s, label }) => { const d = s.data().find((x) => x.time === b.t); return d ? `<span class="ct-lg-ind"><i style="--c:${s.options().color}"></i>${esc(label)} <b>${priceFmt(d.value)}</b></span>` : ""; }).join("")}`;
    };
    legend.innerHTML = legendHtml(bars.length - 1);
    chart.subscribeCrosshairMove((p) => {
      const i = p.time != null ? byTime.get(p.time) : undefined;
      legend.innerHTML = legendHtml(i ?? bars.length - 1);
      if (state.pending && p.point) {
        const pt = pointFromParam(p);
        if (pt) { state.pending.p[1] = pt; requestUpdate(); }
      }
    });

    // ---- Keyboard ----
    let cursor = bars.length - 1;
    const moveTo = (i) => {
      cursor = Math.max(0, Math.min(bars.length - 1, i));
      const b = bars[cursor];
      chart.setCrosshairPosition(b.close, b.t, series);
      legend.innerHTML = legendHtml(cursor);
      const vr = ts.getVisibleLogicalRange();
      if (vr && (cursor < vr.from || cursor > vr.to)) ts.scrollToPosition(cursor - (bars.length - 1) + (vr.to - vr.from) / 2, false);
      const prev = all[off + cursor - 1];
      announce(`${intraday ? new Date(b.time * 1000).toLocaleString() : b.date}: close ${fmtUSD(b.close)}${state.type === "line" || state.type === "area" ? "" : `, open ${fmtUSD(b.open)}, high ${fmtUSD(b.high)}, low ${fmtUSD(b.low)}`}${prev ? `, ${b.close >= prev.close ? "up" : "down"} ${Math.abs((b.close / prev.close - 1) * 100).toFixed(2)}%` : ""}.`);
    };
    const zoom = (f) => {
      const vr = ts.getVisibleLogicalRange();
      if (!vr) return;
      const mid = (vr.from + vr.to) / 2, half = Math.max(5, ((vr.to - vr.from) / 2) * f);
      ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
    };
    host.onkeydown = (e) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); moveTo(cursor + (k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
      else if (k === "Home") { e.preventDefault(); moveTo(0); }
      else if (k === "End") { e.preventDefault(); moveTo(bars.length - 1); }
      else if (k === "+" || k === "=") { e.preventDefault(); zoom(0.7); }
      else if (k === "-" || k === "_") { e.preventDefault(); zoom(1.4); }
      else if ((k === "Delete" || k === "Backspace") && state.selected >= 0) { e.preventDefault(); deleteSelected(); }
    };
    host.onblur = () => chart.clearCrosshairPosition();

    // ---- Text alternative + data table ----
    const shown = bars;
    const first = bars[0], last = bars[bars.length - 1];
    const hi = Math.max(...shown.map((b) => b.high)), lo = Math.min(...shown.map((b) => b.low));
    const pct = (last.close / first.close - 1) * 100;
    host.setAttribute("aria-label", `${ctx.symbol} price chart, ${state.frame}: from ${fmtUSD(first.close)} on ${first.date} to ${fmtUSD(last.close)} on ${last.date} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%). High ${fmtUSD(hi)}, low ${fmtUSD(lo)}.${state.compare.length ? ` Compared with ${state.compare.join(", ")}.` : ""}`);
    dataTable(host, `${ctx.symbol} prices, ${state.frame}`, ["Date", "Open", "High", "Low", "Close", "Volume"], () =>
      [...shown].reverse().map((b) => [intraday ? new Date(b.time * 1000).toLocaleString() : b.date, priceFmt(b.open), priceFmt(b.high), priceFmt(b.low), priceFmt(b.close), b.volume ? fmtNum(b.volume) : "—"]));

    ts.fitContent();
    const ro = fitOnResize(chart, host);
    return {
      chart,
      requestUpdate: () => requestUpdate(),
      remove() { ro.disconnect(); try { chart.remove(); } catch { /* gone */ } },
    };
  }

  // Theme changes: rebuild with the new colors.
  const mo = new MutationObserver(() => { if (!panel.isConnected) return mo.disconnect(); draw(); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => { if (!panel.isConnected) return mq.removeEventListener("change", onScheme); draw(); };
  mq.addEventListener("change", onScheme);

  await draw();
  return { destroy() { view?.remove(); mo.disconnect(); } };
}
