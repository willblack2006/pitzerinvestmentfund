// Fund cockpit (#/cockpit): KPI row + a dashboard of widgets members can turn on/off, reorder
// (drag on desktop, move buttons everywhere) and resize. Layout is saved in the member's
// prefs (dashboardLayout), or in this browser when signed out. Widgets come from the
// registry in public/widgets/index.js, so other features can add their own.
//
// Widget ctx: { data, period, periodLabel, benchmark, narrow, setting(name, default),
//   seg(name, [[value, label]], current) -> HTML, tools(html), foot(text, isHtml), empty(title, body, action),
//   loading(text), get(path, { bench = true }) -> cached JSON, contribution() -> period contribution }
import { el, esc, api, pageHead, subTabs, getPref, setPref, benchParam, benchmarkPresets, benchmarkPicker, wireBenchmarkPicker, errorState, bindRetry, skeleton, emptyState, toast, signed } from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";
import { WIDGETS } from "../widgets/index.js";
import { fmt } from "../viz/core.js";

export const title = "Cockpit";

const PERIODS = [["1d", "1D"], ["5d", "5D"], ["mtd", "MTD"], ["1m", "1M"], ["3m", "3M"], ["ytd", "YTD"], ["1y", "1Y"]];
const CACHE_KEY = "pif_cockpit_last";
const SIZES = ["s", "m", "l", "full"];
const SIZE_NAMES = { s: "Small", m: "Medium", l: "Large", full: "Full width" };

let defs = null;     // loaded widget definitions, in registry order
async function loadDefs() {
  if (defs) return defs;
  const loaded = await Promise.all(WIDGETS.map(async (w) => {
    try { const m = await w.load(); return { ...m.default, key: w.key }; } catch (e) { console.warn(`[cockpit] widget ${w.key} failed to load`, e); return null; }
  }));
  defs = loaded.filter(Boolean);
  return defs;
}

function readLayout() {
  const saved = getPref("dashboardLayout");
  const byKey = new Map(defs.map((d) => [d.key, d]));
  if (saved && Array.isArray(saved.widgets)) {
    const list = saved.widgets.filter((w) => byKey.has(w.key));
    return { period: PERIODS.some(([p]) => p === saved.period) ? saved.period : "1d", widgets: list };
  }
  return { period: "1d", widgets: defs.filter((d) => d.defaultOn).map((d) => ({ key: d.key })) };
}

let layout = null;
let saveTimer = null;
function saveLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => setPref("dashboardLayout", { v: 1, period: layout.period, widgets: layout.widgets }), 400);
}

function cacheRead() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; } }
function cacheWrite(d) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* full or blocked */ } }

const pct = (v, d = 2) => signed(v, fmt.spct(v, d).replace(/^[+−]/, ""));

function kpis(d) {
  const k = d.kpis;
  const vs = (p) => (Number.isFinite(p?.fund) && Number.isFinite(p?.bench) ? `${d.benchmark} ${fmt.spct(p.bench, 2)} · <b>${fmt.pts(p.fund - p.bench, 2)}</b>` : `${esc(d.benchmark)} —`);
  const ips = k.ips?.tightest;
  const ipsBar = ips ? Math.min(100, Math.max(2, (ips.current / ips.limit) * 100)) : 0;
  const ipsCls = k.ips?.breaches ? "is-breach" : ips && ips.headroom / (ips.limit || 1) < 0.15 ? "is-tight" : "";
  return `<section class="cockpit-kpis" aria-label="Fund at a glance">
    <div class="kpi kpi-hero"><div class="kpi-label">Fund value</div><div class="kpi-value">${fmt.usd(k.nav)}</div>
      <div class="kpi-sub">${k.holdings} holdings · as of ${esc(fmt.date(d.asOf))}</div></div>
    <div class="kpi"><div class="kpi-label">Today</div><div class="kpi-value">${pct(k.day?.fund)}</div><div class="kpi-sub">${vs(k.day)}</div></div>
    <div class="kpi"><div class="kpi-label">Month to date</div><div class="kpi-value">${pct(k.mtd?.fund)}</div><div class="kpi-sub">${vs(k.mtd)}</div></div>
    <div class="kpi"><div class="kpi-label">Year to date</div><div class="kpi-value">${pct(k.ytd?.fund)}</div><div class="kpi-sub">${vs(k.ytd)}</div></div>
    <div class="kpi"><div class="kpi-label">Cash</div><div class="kpi-value">${fmt.pct(k.cashPct, 1)}</div><div class="kpi-sub">${fmt.usd(k.cash)}</div></div>
    <div class="kpi"><div class="kpi-label">Active share</div><div class="kpi-value">${fmt.pct(k.activeShare, 0)}</div>
      <div class="kpi-sub">Sector mix vs ${esc(d.sectorBenchmark || d.benchmark)}</div></div>
    <div class="kpi"><div class="kpi-label">Policy headroom</div>
      ${ips ? `<div class="kpi-value">${ips.headroom >= 0 ? `${ips.headroom.toFixed(1)}${ips.unit === "%" ? " pts" : ""}` : `<span class="gain-neg">Over by ${Math.abs(ips.headroom).toFixed(1)}</span>`}</div>
        <div class="kpi-sub">${esc(ips.rule)}${ips.symbol ? ` (${esc(ips.symbol)})` : ips.sector ? ` (${esc(ips.sector)})` : ""}: ${ips.unit === "%" ? `${ips.current.toFixed(1)}% of ${ips.limit}%` : `${ips.current} of ${ips.limit}`}</div>
        <div class="kpi-bar ${ipsCls}" aria-hidden="true"><span style="width:${ipsBar.toFixed(0)}%"></span></div>`
      : `<div class="kpi-value">—</div><div class="kpi-sub"><a href="#/settings">Set policy limits</a></div>`}</div>
  </section>`;
}

function seg(name, options, current, label) {
  return `<div class="seg" role="group" aria-label="${esc(label || name)}">${options.map(([v, l]) => `<button type="button" class="seg-btn" data-seg="${esc(name)}" data-value="${esc(JSON.stringify(v))}" aria-pressed="${String(v) === String(current)}">${esc(l)}</button>`).join("")}</div>`;
}

export async function mount(container) {
  const head = () => `${subTabs(PORTFOLIO_TABS, "#/cockpit")}${pageHead("Fund cockpit", "The whole fund at a glance. Hover any chart for detail, click a holding to research it, or customize which panels you see.",
    `<span id="cpBenchSlot"></span><button type="button" class="btn btn-ghost btn-sm" id="cpCustomize" aria-pressed="false">Customize</button>`)}`;
  container.innerHTML = head() + `<div class="cockpit-kpis">${skeleton("cards", { rows: 6, label: "Loading the cockpit" })}</div>`;
  await loadDefs();
  layout = readLayout();

  let data, stale = false;
  try {
    data = await api(`/api/cockpit${benchParam()}`);
    cacheWrite({ at: new Date().toISOString(), bench: benchParam(), data });
  } catch (err) {
    const c = cacheRead();
    if (c?.data && c.bench === benchParam()) { data = c.data; stale = c.at; }
    else {
      container.innerHTML = head() + errorState({ title: "Couldn't load the cockpit.", detail: err.message, retryId: "cockpit" });
      bindRetry(container, "cockpit", () => mount(container));
      return;
    }
  }
  if (!container.isConnected) return;

  const cache = new Map();
  const get = (path, { bench = true } = {}) => {
    const full = bench ? `${path}${path.includes("?") ? benchParam("&") : benchParam()}` : path;
    if (!cache.has(full)) cache.set(full, api(full).catch((e) => { cache.delete(full); throw e; }));
    return cache.get(full);
  };
  const contribution = () => get(`/api/cockpit/contribution?period=${layout.period}`);
  let editing = false;

  container.innerHTML = `${head()}
    ${stale ? `<p class="basis-note" role="status">Offline: showing the cockpit as of ${esc(new Date(stale).toLocaleString())}.</p>` : ""}
    ${kpis(data)}
    <div class="cockpit-toolbar">
      ${seg("period", PERIODS, layout.period, "Period for the map, movers and waterfall")}
      <span class="muted small">Returns are on today's holdings, cash included. <a href="#/performance">Full performance</a></span>
    </div>
    <div id="cpPicker" hidden></div>
    <div class="cockpit-grid" id="cpGrid" aria-live="off"></div>`;

  // Benchmark picker in the header (your pick is saved for every page, like Performance).
  benchmarkPresets().then((presets) => {
    const slot = el("cpBenchSlot");
    if (!slot) return;
    slot.innerHTML = benchmarkPicker("cpBench", data.benchmarkValue, presets, { label: "Compare with" });
    wireBenchmarkPicker("cpBench", async (v) => { await setPref("benchmark", v); mount(container); });
  }).catch(() => {});

  const grid = el("cpGrid");
  const narrow = () => grid.clientWidth < 700;
  const defOf = (key) => defs.find((d) => d.key === key);

  function cardHtml(w, i) {
    const d = defOf(w.key);
    const size = SIZES.includes(w.size) ? w.size : d.size || "m";
    return `<section class="widget" data-key="${esc(w.key)}" data-size="${size}" aria-labelledby="w-${esc(w.key)}-h" draggable="${editing}">
      <div class="widget-head"><div><h3 id="w-${esc(w.key)}-h">${esc(d.title)}</h3></div>
        <div class="widget-tools"><span class="widget-tool-slot"></span>
          <span class="widget-edit">
            <button type="button" class="btn btn-ghost" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(d.title)} earlier">↑</button>
            <button type="button" class="btn btn-ghost" data-act="down" ${i === layout.widgets.length - 1 ? "disabled" : ""} aria-label="Move ${esc(d.title)} later">↓</button>
            <select data-act="size" aria-label="Size of ${esc(d.title)}">${SIZES.map((s) => `<option value="${s}" ${s === size ? "selected" : ""}>${SIZE_NAMES[s]}</option>`).join("")}</select>
            <button type="button" class="btn btn-ghost" data-act="remove" aria-label="Hide ${esc(d.title)}">Hide</button>
          </span></div></div>
      <div class="widget-body">${skeleton("chart", { label: `Loading ${d.title}` })}</div>
      <div class="widget-foot" hidden></div>
    </section>`;
  }

  async function renderWidget(card) {
    const w = layout.widgets.find((x) => x.key === card.dataset.key);
    const d = defOf(card.dataset.key);
    if (!w || !d) return;
    const body = card.querySelector(".widget-body"), foot = card.querySelector(".widget-foot"), slot = card.querySelector(".widget-tool-slot");
    foot.hidden = true; foot.innerHTML = ""; slot.innerHTML = "";
    const ctx = {
      data, period: layout.period, periodLabel: data.periods?.[layout.period]?.label || layout.period,
      benchmark: data.benchmark, narrow: narrow(),
      setting: (name, dflt) => (w.opts && name in w.opts ? w.opts[name] : dflt),
      seg: (name, opts, cur) => seg(`w:${name}`, opts, cur, name),
      tools: (html) => { slot.innerHTML = html; },
      foot: (text, isHtml = false) => { foot.innerHTML = isHtml ? text : esc(text); foot.hidden = !text; },
      empty: (title, bodyText, action) => emptyState({ title, body: bodyText, action }),
      loading: (text) => skeleton("chart", { label: text }),
      get, contribution,
    };
    try {
      await d.render(body, ctx);
    } catch (err) {
      body.innerHTML = errorState({ title: `Couldn't draw ${d.title}.`, detail: err.message, retryId: `w-${d.key}` });
      bindRetry(body, `w-${d.key}`, () => renderWidget(card));
    }
  }

  function renderGrid() {
    if (!layout.widgets.length) {
      grid.innerHTML = `<div class="widget" data-size="full">${emptyState({ icon: "sliders", title: "No panels on your cockpit", body: "Pick the charts you want to see.", action: { label: "Customize", id: "cpEmptyCustomize" } })}</div>`;
      el("cpEmptyCustomize")?.addEventListener("click", () => toggleEdit(true));
      return;
    }
    grid.innerHTML = layout.widgets.map(cardHtml).join("");
    grid.classList.toggle("is-editing", editing);
    grid.querySelectorAll(".widget").forEach((card) => renderWidget(card));
  }

  function renderPicker() {
    const p = el("cpPicker");
    p.hidden = !editing;
    if (!editing) { p.innerHTML = ""; return; }
    const on = new Set(layout.widgets.map((w) => w.key));
    p.innerHTML = `<div class="cockpit-picker"><h3>Panels on your cockpit</h3>
      <ul>${defs.map((d) => `<li><label><input type="checkbox" data-pick="${esc(d.key)}" ${on.has(d.key) ? "checked" : ""}/> <span>${esc(d.title)}<small>${esc(d.description || "")}</small></span></label></li>`).join("")}</ul>
      <div class="picker-actions"><button type="button" class="btn btn-primary btn-sm" id="cpDone">Done</button>
        <button type="button" class="btn btn-ghost btn-sm" id="cpReset">Reset to default</button>
        <span class="muted small">Drag cards to reorder on a computer, or use the arrows. Saved to your account.</span></div></div>`;
    p.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
      const key = cb.dataset.pick;
      if (cb.checked) layout.widgets.push({ key });
      else layout.widgets = layout.widgets.filter((w) => w.key !== key);
      saveLayout(); renderGrid();
    }));
    el("cpDone").addEventListener("click", () => toggleEdit(false));
    el("cpReset").addEventListener("click", () => {
      layout.widgets = defs.filter((d) => d.defaultOn).map((d) => ({ key: d.key }));
      saveLayout(); renderPicker(); renderGrid();
      toast("Cockpit reset to the default panels.");
    });
  }

  function toggleEdit(on) {
    editing = on;
    el("cpCustomize").setAttribute("aria-pressed", String(on));
    el("cpCustomize").textContent = on ? "Done" : "Customize";
    grid.classList.toggle("is-editing", on);
    grid.querySelectorAll(".widget").forEach((c) => c.setAttribute("draggable", String(on)));
    renderPicker();
    if (on) el("cpPicker").querySelector("input")?.focus();
  }
  el("cpCustomize").addEventListener("click", () => toggleEdit(!editing));

  // Segmented controls: the page period, or a widget setting (w:name).
  container.addEventListener("click", (e) => {
    const b = e.target.closest("[data-seg]");
    if (!b || !container.contains(b)) return;
    const name = b.dataset.seg, value = JSON.parse(b.dataset.value);
    if (name === "period") {
      if (value === layout.period) return;
      layout.period = value;
      container.querySelectorAll('[data-seg="period"]').forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      saveLayout();
      grid.querySelectorAll(".widget").forEach((card) => {
        if (["treemap", "movers", "waterfall", "explain", "attribution"].includes(card.dataset.key) || defOf(card.dataset.key)?.usesPeriod) renderWidget(card);
      });
      return;
    }
    const card = b.closest(".widget");
    const w = layout.widgets.find((x) => x.key === card?.dataset.key);
    if (!w) return;
    w.opts = { ...(w.opts || {}), [name.slice(2)]: value };
    saveLayout();
    renderWidget(card);
  });

  // Edit controls on each card.
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT") return;
    const key = b.closest(".widget").dataset.key;
    const i = layout.widgets.findIndex((w) => w.key === key);
    if (b.dataset.act === "remove") layout.widgets.splice(i, 1);
    else {
      const j = b.dataset.act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= layout.widgets.length) return;
      [layout.widgets[i], layout.widgets[j]] = [layout.widgets[j], layout.widgets[i]];
    }
    saveLayout(); renderGrid(); renderPicker();
    grid.querySelector(`.widget[data-key="${CSS.escape(key)}"] [data-act="${b.dataset.act}"]:not(:disabled)`)?.focus();
  });
  grid.addEventListener("change", (e) => {
    const s = e.target.closest('select[data-act="size"]');
    if (!s) return;
    const card = s.closest(".widget");
    const w = layout.widgets.find((x) => x.key === card.dataset.key);
    w.size = s.value;
    card.dataset.size = s.value;
    saveLayout();
    renderWidget(card);
  });

  // Drag to reorder (desktop). Cards keep their keyboard controls as the alternative.
  let dragKey = null;
  grid.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".widget");
    if (!editing || !card) return;
    dragKey = card.dataset.key;
    card.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragKey); } catch { /* old browsers */ }
  });
  grid.addEventListener("dragover", (e) => {
    if (!dragKey) return;
    const over = e.target.closest?.(".widget");
    if (!over || over.dataset.key === dragKey) return;
    e.preventDefault();
    grid.querySelectorAll(".is-drop-target").forEach((x) => x.classList.remove("is-drop-target"));
    over.classList.add("is-drop-target");
  });
  grid.addEventListener("drop", (e) => {
    const over = e.target.closest?.(".widget");
    if (!dragKey || !over) return;
    e.preventDefault();
    const from = layout.widgets.findIndex((w) => w.key === dragKey);
    const to = layout.widgets.findIndex((w) => w.key === over.dataset.key);
    const [moved] = layout.widgets.splice(from, 1);
    layout.widgets.splice(to, 0, moved);
    dragKey = null;
    saveLayout(); renderGrid();
  });
  grid.addEventListener("dragend", () => { dragKey = null; grid.querySelectorAll(".is-dragging, .is-drop-target").forEach((x) => x.classList.remove("is-dragging", "is-drop-target")); });

  renderGrid();
}
