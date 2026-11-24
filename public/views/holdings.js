import { el, esc, fmtUSD, fmtPct, api, can, toast, getPref, setPref, confirmAction, lockedHint, signed, sortHeader, sortRows, bindSort, pageHead, invalidateContext, subTabs, icon, errorState, bindRetry, skeleton } from "../shared.js";
import { askChips, suggestionsFor } from "../ai.js";
import { openPopover } from "../ui/popover.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";
import { alertHref, ICON, TAB } from "./alerts.js";
import { crowdingPanelHtml, loadCrowdingPanel } from "./crowdingPanel.js";
import { noteCounts, noteMarker } from "../notes.js";

export const title = "Portfolio";

const state = { positions: [], quotes: {}, market: null, sort: { key: "marketValue", dir: -1 }, filter: "", signals: {}, signalsLoaded: false, period: "all", bases: null, basesError: null, cash: null, dividends: null, selected: null, bars: {}, theses: {} };

// Time frames for the gain columns and summary. "all" = since purchase (vs cost basis);
// "1d" = live day change; the rest compare the live price with the close before the frame
// started (bases from /api/portfolio/period-bases), at today's share counts.
const PERIODS = [["1d", "1D", "today"], ["5d", "5D", "last 5 days"], ["1m", "1M", "last month"], ["3m", "3M", "last 3 months"], ["ytd", "YTD", "year to date"], ["1y", "1Y", "last year"], ["all", "All", "since purchase"]];
const periodLabel = (k) => PERIODS.find(([p]) => p === k)?.[2] || "";

async function loadBases() {
  if (state.bases || ["all", "1d"].includes(state.period)) return;
  try {
    state.bases = await api("/api/portfolio/period-bases");
    state.basesError = null;
  } catch (err) {
    state.basesError = err.message;
  }
  if (el("tbody")) renderTable();
}

// Gain for the selected frame: { gain, gainPct, baseValue } (nulls when unknown).
function periodFigures(p) {
  if (state.period === "all") return { gain: p.marketValue - p.totalCost, gainPct: p.totalCost ? ((p.marketValue - p.totalCost) / p.totalCost) * 100 : null, baseValue: p.totalCost };
  if (state.period === "1d") return { gain: p.dayChange, gainPct: p.dayChangePct, baseValue: p.prevValue ?? null };
  const base = state.bases?.bySymbol?.[p.symbol]?.[state.period]?.close;
  if (!Number.isFinite(base) || base <= 0) return { gain: null, gainPct: null, baseValue: null };
  return { gain: (p.lastPrice - base) * p.shares, gainPct: (p.lastPrice / base - 1) * 100, baseValue: base * p.shares };
}

// Small badges summarizing the background-computed signals for one holding (insider,
// short-pressure, estimate revisions, red flags, filing changes, activist filings), each
// linking to the research tab that explains it. Dot color follows alert level.
function signalBadges(symbol) {
  const sig = state.signals[symbol];
  if (!sig?.badges?.length) return "";
  const seen = new Set();
  const badges = sig.badges.filter((b) => (seen.has(b.type) ? false : (seen.add(b.type), true)));
  // Attention spikes are explained by the panel further down this page; the rest by a research tab.
  const chip = (b, attrs) => `<a class="sig-chip sig-chip-${esc(b.level)}" ${attrs} aria-label="${esc(b.title)}" data-tip="${esc(b.title)}" title="${esc(b.title)}">${ICON[b.type] || icon("flag", { size: 16 })}</a>`;
  return badges.map((b) => b.type === "crowding"
    ? chip(b, `href="#crowdPanel-h" data-scroll-to="crowdPanel-h"`)
    : chip(b, `href="#/research/${encodeURIComponent(symbol)}${TAB[b.type] || ""}"`)).join("");
}

// Overlay live quotes on the stored positions: price, market value and today's move. The
// stored price/value remain the fallback when a quote is unavailable.
function withLive(positions) {
  return positions.map((p) => {
    const q = state.quotes[p.symbol];
    if (!q) return { ...p, live: false, dayChange: null, dayChangePct: null };
    return {
      ...p,
      live: true,
      lastPrice: q.price,
      marketValue: q.price * p.shares,
      dayChange: q.change != null ? q.change * p.shares : null,
      dayChangePct: q.changePct ?? null,
      prevValue: q.previousClose != null ? q.previousClose * p.shares : null,
    };
  });
}

function withDerived(positions) {
  positions = withLive(positions);
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  return positions.map((p) => ({
    ...p,
    ...periodFigures(p),
    weight: totalValue ? (p.marketValue / totalValue) * 100 : 0,
  }));
}

function renderSummary(rows) {
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
  const cash = Number.isFinite(state.cash) ? state.cash : 0;
  const portfolioTotal = totalValue + cash;
  const share = (v) => (portfolioTotal ? `${((v / portfolioTotal) * 100).toFixed(1)}% of portfolio` : "");
  const div = state.dividends;
  // Gain for the selected frame, over the positions that have a figure for it.
  const known = rows.filter((r) => r.gain != null && r.baseValue);
  const totalGain = known.reduce((s, r) => s + r.gain, 0);
  const totalBase = known.reduce((s, r) => s + r.baseValue, 0);
  const totalGainPct = totalBase ? (totalGain / totalBase) * 100 : 0;
  const winners = known.filter((r) => r.gain > 0).length;
  const losers = known.filter((r) => r.gain < 0).length;
  const pending = !["all", "1d"].includes(state.period) && !state.bases;
  const since = state.bases?.starts?.[state.period];
  const gainSub = state.period === "all"
    ? `${signed(totalGainPct, fmtPct(totalGainPct))} on ${fmtUSD(totalCost)} cost`
    : `${signed(totalGainPct, fmtPct(totalGainPct))}${since ? ` since the ${since} close` : ""} · today's shares, price only${known.length < rows.length ? ` · ${rows.length - known.length} without data` : ""}`;
  const liveRows = rows.filter((r) => r.dayChange != null && r.prevValue);
  const dayChange = liveRows.reduce((s, r) => s + r.dayChange, 0);
  const dayBase = liveRows.reduce((s, r) => s + r.prevValue, 0);
  // Day change as a share of the whole portfolio (cash included), the way Schwab reports it.
  const dayPct = dayBase ? (dayChange / (dayBase + cash)) * 100 : null;

  const topFive = [...rows].sort((a, b) => b.weight - a.weight).slice(0, 5).reduce((t, r) => t + r.weight, 0);

  const fig = (label, value, sub = "") => `<div class="hold-fig"><div class="hold-fig-label">${label}</div><div class="hold-fig-value">${value}</div>${sub ? `<div class="hold-fig-sub">${sub}</div>` : ""}</div>`;
  el("summary").innerHTML =
    fig("Net asset value", fmtUSD(portfolioTotal), liveRows.length ? `${dayLabel()} ${signed(dayChange, fmtUSD(dayChange))} (${fmtPct(dayPct)})` : "Invested + cash") +
    fig(state.period === "all" ? "Total gain" : `Gain, ${esc(periodLabel(state.period))}`,
      pending ? `<span class="muted">${state.basesError ? "Unavailable" : "…"}</span>` : signed(totalGain, fmtUSD(totalGain)),
      pending ? (state.basesError ? esc(state.basesError) : "Fetching price history") : gainSub) +
    fig("Cash", state.cash == null ? "…" : fmtUSD(cash), share(cash)) +
    fig("Dividends, next 12 months", div ? fmtUSD(div.totals.annualIncome) : `<span class="muted">…</span>`, div ? `<a href="#/dividends">${fmtUSD(div.totals.receivedSinceStart)} received so far</a>` : "");
  el("summaryMore").innerHTML = `
    <span>${rows.length} positions · ${share(totalValue).replace(" of portfolio", "")} invested</span>
    <span>${pending ? "…" : `${winners} up, ${losers} down`} ${state.period === "all" ? "vs cost" : esc(periodLabel(state.period))}</span>
    <span>Top 5 are ${topFive.toFixed(1)}% of invested</span>`;
}

// Concentration view: the biggest weights as labelled bars (a list, so it reads fine
// without the visual), with a gentle flag on any single name above 10%.
function renderConcentration(rows) {
  const top = [...rows].sort((a, b) => b.weight - a.weight).slice(0, 8);
  const max = top[0]?.weight || 1;
  if (!el("concentration")) return;
  el("concentration").innerHTML = `
    <h3 class="hold-aside-title">Largest positions</h3>
    <ol class="bar-list">
      ${top.map((r) => `
        <li>
          <a href="#/research/${encodeURIComponent(r.symbol)}" class="bar-label">${esc(r.symbol)}</a>
          <span class="bar-track" aria-hidden="true"><span class="bar-fill ${r.weight > 10 ? "bar-warn" : ""}" style="width:${(r.weight / max) * 100}%"></span></span>
          <span class="bar-value">${r.weight.toFixed(1)}%</span>
        </li>`).join("")}
    </ol>`;
}

// Table columns the member can show or hide (the ticker always shows). A column with
// nothing in it (no signals, no dividends) starts hidden unless the member chose otherwise.
const periodShort = () => PERIODS.find(([p]) => p === state.period)[1];
const COLS = [
  { key: "signals", label: "Signals", plain: true, empty: (rows) => state.signalsLoaded && !rows.some((r) => state.signals[r.symbol]?.badges?.length),
    cell: (r) => `<td class="signals-cell">${signalBadges(r.symbol)}</td>` },
  { key: "weight", label: "Weight", cell: (r) => `<td>${r.weight.toFixed(1)}%</td>` },
  { key: "shares", label: "Shares", cell: (r) => `<td>${r.shares.toLocaleString()}</td>` },
  { key: "lastPrice", label: "Price", cell: (r) => `<td>${fmtUSD(r.lastPrice)}${r.live ? "" : `<span class="stale-dot" title="Live price unavailable, showing the last saved price" aria-label="saved price, not live">*</span>`}</td>` },
  { key: "dayChangePct", label: "Day", cell: (r) => `<td>${r.dayChangePct == null ? `<span class="muted">—</span>` : signed(r.dayChangePct, fmtPct(r.dayChangePct))}</td>` },
  { key: "avgCost", label: "Avg cost", cell: (r) => `<td>${fmtUSD(r.avgCost)}</td>` },
  { key: "marketValue", label: "Market value", cell: (r) => `<td>${fmtUSD(r.marketValue)}</td>` },
  { key: "gain", label: () => (state.period === "all" ? "Gain $" : `Gain $ (${periodShort()})`), cell: (r) => `<td>${r.gain == null ? `<span class="muted">—</span>` : signed(r.gain, fmtUSD(r.gain))}</td>` },
  { key: "gainPct", label: () => (state.period === "all" ? "Gain %" : `Gain % (${periodShort()})`), cell: (r) => `<td>${r.gainPct == null ? `<span class="muted">—</span>` : signed(r.gainPct, fmtPct(r.gainPct))}</td>` },
  { key: "divIncome", label: "Div. received", empty: (rows) => !rows.some((r) => r.divIncome), cell: (r) => `<td>${fmtUSD(r.divIncome)}</td>` },
];
const colLabel = (c) => (typeof c.label === "function" ? c.label() : c.label);
const savedCols = () => { const v = getPref("holdingsColumns", {}); return v && typeof v === "object" ? v : {}; };
// Why a column is hidden: "chosen" (member turned it off), "empty" (nothing in it), or null (shown).
function hiddenReason(c, all) {
  const chosen = savedCols()[c.key];
  if (chosen === true) return null;
  if (chosen === false) return "chosen";
  return c.empty?.(all) ? "empty" : null;
}

function renderColumnsButton(all) {
  const btn = el("columnsBtn");
  if (!btn) return;
  const n = COLS.filter((c) => hiddenReason(c, all)).length;
  btn.innerHTML = `${icon("sliders", { size: 16 })} Columns${n ? ` <span class="cols-count">${n} hidden</span>` : ""}`;
}

function openColumnsMenu(anchor) {
  const box = document.createElement("div");
  box.className = "cols-menu";
  const draw = () => {
    const all = withDerived(state.positions);
    box.innerHTML = `<p class="small muted">Choose which columns to show. Ticker always shows.</p>
      ${COLS.map((c) => `<label class="check cols-row"><input type="checkbox" data-col="${c.key}" ${hiddenReason(c, all) ? "" : "checked"} /> ${esc(colLabel(c))}${hiddenReason(c, all) === "empty" ? ` <span class="muted small">(empty)</span>` : ""}</label>`).join("")}
      <button type="button" class="btn-link small" data-cols-reset>Reset to default</button>`;
  };
  draw();
  box.addEventListener("change", (e) => {
    const k = e.target.dataset?.col;
    if (!k) return;
    setPref("holdingsColumns", { ...savedCols(), [k]: e.target.checked });
    renderTable();
  });
  box.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cols-reset]")) return;
    setPref("holdingsColumns", {});
    renderTable();
    draw();
  });
  openPopover({ anchor, content: box, label: "Table columns", placement: "bottom-end", width: 260 });
}

function renderTable() {
  const unlocked = can("trade");
  const all = withDerived(state.positions);
  let rows = all;
  if (state.filter) {
    const f = state.filter.toUpperCase();
    rows = rows.filter((r) => r.symbol.toUpperCase().includes(f) || (r.notes || "").toUpperCase().includes(f));
  }
  rows = sortRows(rows, state.sort);

  renderSummary(all);
  renderConcentration(all);

  const s = state.sort;
  const cols = COLS.filter((c) => !hiddenReason(c, all));
  renderColumnsButton(all);
  el("thead").innerHTML = `<tr>
    ${sortHeader("symbol", "Ticker", s, { align: "left sticky-col" })}
    ${cols.map((c) => c.plain ? `<th scope="col">${esc(colLabel(c))}</th>` : sortHeader(c.key, esc(colLabel(c)), s)).join("")}
  </tr>`;

  el("tbody").innerHTML = rows.map((r) => `
    <tr data-id="${r.id}" data-symbol="${esc(r.symbol)}" class="${state.selected === r.symbol ? "is-selected" : ""}" aria-selected="${state.selected === r.symbol}">
      <th scope="row" class="left sticky-col">
        <button type="button" class="symbol-cell symbol-btn" data-inspect="${esc(r.symbol)}" aria-label="Show details for ${esc(r.symbol)}">${esc(r.symbol)}</button>${noteMarker(r.symbol, state.noteCounts)}
        ${r.notes ? `<div class="muted small cell-note">${esc(r.notes)}</div>` : ""}
      </th>
      ${cols.map((c) => c.cell(r)).join("")}
    </tr>
  `).join("");

  el("tableEmpty").innerHTML = rows.length
    ? ""
    : `<p class="empty">No positions match “${esc(state.filter)}”.
        <button type="button" class="btn-link" id="clearFilter">Clear filter</button>
        or <a href="#/research/${encodeURIComponent(state.filter.toUpperCase())}">research ${esc(state.filter.toUpperCase())}</a></p>`;
  el("clearFilter")?.addEventListener("click", () => {
    el("search").value = "";
    state.filter = "";
    renderTable();
    el("search").focus();
  });
  el("filterCount").textContent = state.filter ? `${rows.length} of ${all.length} positions shown` : "";
  if (state.selected) renderInspector();
}

// ---- Inspector: the selected holding's details beside the table (a bottom sheet on phones) ----
const THESIS_LABEL = { intact: "On track", watch: "Watch", weakened: "Weakened", broken: "Broken", unknown: "No checks yet" };
const THESIS_DOT = { intact: "is-done", watch: "is-watch", weakened: "is-watch", broken: "is-error" };
function sparkline(bars) {
  const c = (bars || []).map((b) => b.close).filter(Number.isFinite);
  if (c.length < 2) return `<div class="hold-spark-empty muted small">No price history</div>`;
  const lo = Math.min(...c), hi = Math.max(...c), w = 288, h = 64;
  const d = c.map((v, i) => `${i ? "L" : "M"}${((i / (c.length - 1)) * w).toFixed(1)},${(4 + (1 - (v - lo) / (hi - lo || 1)) * (h - 8)).toFixed(1)}`).join("");
  return `<svg class="hold-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderInspector() {
  const box = el("holdInspector");
  if (!box) return;
  const all = withDerived(state.positions);
  const r = all.find((x) => x.symbol === state.selected);
  document.querySelector(".hold-layout")?.classList.toggle("has-selection", !!r);
  if (!r) { box.innerHTML = ""; box.hidden = true; return; }
  box.hidden = false;
  const s = r.symbol, enc = encodeURIComponent(s);
  const th = state.theses[s];
  const bars = state.bars[s];
  box.innerHTML = `
    <div class="hold-insp-head"><span class="hold-insp-sym">${esc(s)}</span>
      <a class="btn btn-ghost btn-sm" href="#/research/${enc}">Research</a>
      <button type="button" class="icon-btn" data-inspect-close aria-label="Close details">${icon("x", { size: 16 })}</button></div>
    <div class="hold-insp-sec">
      <div class="hold-insp-price num">${fmtUSD(r.lastPrice)} ${r.dayChangePct == null ? "" : `<span class="small">${signed(r.dayChangePct, fmtPct(r.dayChangePct))}</span>`}</div>
      ${bars === undefined ? `<div class="hold-spark-empty muted small">Loading chart…</div>` : sparkline(bars)}
      <div class="muted small">3 months</div>
    </div>
    <div class="hold-insp-sec"><dl class="hold-kv">
      <dt>Shares</dt><dd>${r.shares.toLocaleString()}</dd>
      <dt>Value</dt><dd>${fmtUSD(r.marketValue)}</dd>
      <dt>Avg cost</dt><dd>${fmtUSD(r.avgCost)}</dd>
      <dt>Weight</dt><dd>${r.weight.toFixed(1)}%${r.weight > 10 ? ` <span class="hold-cap">above 10% cap</span>` : ""}</dd>
      <dt>${state.period === "all" ? "Gain" : `Gain, ${esc(periodLabel(state.period))}`}</dt><dd>${r.gain == null ? "—" : `${signed(r.gain, fmtUSD(r.gain))} <span class="small">${signed(r.gainPct, fmtPct(r.gainPct))}</span>`}</dd>
    </dl></div>
    ${th ? `<div class="hold-insp-sec"><div class="hold-aside-title">Thesis</div>
      <div><span class="status-dot ${THESIS_DOT[th.status] || ""}"></span> ${esc(THESIS_LABEL[th.status] || th.status)}</div>
      ${th.catalysts?.next?.[0] ? `<div class="muted small">Next: ${esc(th.catalysts.next[0].title || th.catalysts.next[0].text || "")}</div>` : ""}
      <a class="small" href="#/research/${enc}/thesis">Open thesis</a></div>` : ""}
    ${r.notes ? `<div class="hold-insp-sec"><div class="hold-aside-title">Note</div><div class="small">${esc(r.notes)}</div></div>` : ""}
    <div class="hold-insp-actions">
      ${can("ai") ? `<button type="button" class="btn btn-sm" data-ask="What's the latest on ${esc(s)}, and does it change our thesis?">Ask about ${esc(s)}</button>` : ""}
      ${can("trade") ? `<button type="button" class="btn btn-sm" data-edit="${r.id}">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-delete="${r.id}">Delete</button>` : ""}
    </div>`;
}
async function inspect(symbol) {
  state.selected = state.selected === symbol ? null : symbol;
  document.querySelectorAll("#tbody tr[data-symbol]").forEach((tr) => {
    const on = tr.dataset.symbol === state.selected;
    tr.classList.toggle("is-selected", on); tr.setAttribute("aria-selected", String(on));
  });
  renderInspector();
  if (!state.selected) return;
  const s = state.selected;
  if (state.bars[s] === undefined) api(`/api/research/${encodeURIComponent(s)}/bars?frame=3M`).then((r) => { state.bars[s] = r.bars || []; }).catch(() => { state.bars[s] = []; }).then(() => state.selected === s && renderInspector());
  if (can("ai") && !(s in state.theses)) api(`/api/theses/${encodeURIComponent(s)}`).then((r) => { state.theses[s] = r?.summary || null; }).catch(() => { state.theses[s] = null; }).then(() => state.selected === s && renderInspector());
}

async function loadPositions() {
  state.positions = await api("/api/positions");
  state.bases = null; // a new or removed position changes the symbol list
  renderTable();
  loadBases();
}

// ---- Live prices ----

// The quote's daily change is today's move only while the regular session is running or just
// closed; before the open it still describes the previous session.
function dayLabel() {
  return ["REGULAR", "POST"].includes(state.market?.marketState) ? "today" : "last session";
}

const LIVE_STATES = new Set(["REGULAR", "PRE", "POST"]);
const STATE_LABEL = { REGULAR: "Market open", PRE: "Pre-market", POST: "After hours", CLOSED: "Market closed", PREPRE: "Market closed", POSTPOST: "Market closed" };

function marketLine() {
  const m = state.market;
  if (!m) return "Loading live prices…";
  if (m.error) return `<span class="live-dot" aria-hidden="true"></span>Showing last saved prices (live feed unavailable). <button type="button" class="btn-link" id="retryQuotes">Retry</button>`;
  const t = m.asOf ? new Date(m.asOf).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) : null;
  const live = LIVE_STATES.has(m.marketState);
  return `<span class="live-dot ${live ? "on" : ""}" aria-hidden="true"></span>${STATE_LABEL[m.marketState] || "Live prices"}${t ? ` · prices as of ${t} ET` : ""}${live ? " · updates every minute" : ""}`;
}

async function refreshQuotes() {
  const symbols = state.positions.map((p) => p.symbol);
  if (!symbols.length) return;
  try {
    const r = await api(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    state.quotes = r.quotes;
    state.market = { marketState: r.marketState, asOf: r.asOf };
  } catch (err) {
    state.market = { error: err.message };
  }
  if (!el("tbody")) return; // navigated away
  // Re-render without losing the user's place: keep focus on the same control.
  const active = document.activeElement;
  const key = active?.closest?.("#table") ? (active.dataset.edit && `[data-edit="${active.dataset.edit}"]`) || (active.dataset.delete && `[data-delete="${active.dataset.delete}"]`) || (active.dataset.sort && `.sort-btn[data-sort="${active.dataset.sort}"]`) || (active.getAttribute("href") && `a[href="${active.getAttribute("href")}"]`) : null;
  renderTable();
  if (key) document.querySelector(`#table ${key}`)?.focus();
  el("marketLine").innerHTML = marketLine();
  el("retryQuotes")?.addEventListener("click", refreshQuotes);
}

let pollTimer = null;
function startPolling() {
  clearTimeout(pollTimer);
  const tick = async () => {
    if (!el("tbody")) return; // stop once the user leaves the page
    const dialogOpen = document.querySelector("dialog[open]");
    if (document.visibilityState === "visible" && !dialogOpen) await refreshQuotes();
    const live = LIVE_STATES.has(state.market?.marketState);
    pollTimer = setTimeout(tick, live ? 60 * 1000 : 10 * 60 * 1000);
  };
  pollTimer = setTimeout(tick, 60 * 1000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && el("tbody")) refreshQuotes();
});

// "Needs attention": grouped by type, one compact line each, the suggested action once per group.
const ATT_GROUPS = {
  earnings: { head: "Earnings this week", icon: "calendar", action: "Assign someone to cover each call." },
  crowding: { head: "Attention spikes", icon: "megaphone", action: "Check the Attention spikes panel below." },
  insider: { head: "Insider activity", icon: "user" },
  policy: { head: "Policy", icon: "alert" },
  vote: { head: "Open votes", icon: "vote", action: "Cast your vote on each pitch page." },
  tripwire: { head: "Exit tripwires", icon: "flag" },
  price: { head: "Price alerts", icon: "target" },
  target: { head: "Price targets", icon: "target" },
  short: { head: "Short pressure", icon: "arrow-down" },
  revision: { head: "Estimate revisions", icon: "pencil" },
  filingchange: { head: "Filing changes", icon: "doc" },
  redflag: { head: "Red flags", icon: "flag" },
  activist: { head: "Activist filings", icon: "percent" },
};
const ATT_SHOW = 3;

function attentionHtml(alerts) {
  const groups = new Map();
  for (const a of alerts) {
    if (!groups.has(a.type)) groups.set(a.type, []);
    groups.get(a.type).push(a);
  }
  // Groups with something that needs action first.
  const order = [...groups.entries()].sort((x, y) => (y[1].some((a) => a.level === "action") - x[1].some((a) => a.level === "action")));
  return order.map(([type, items], i) => {
    const g = ATT_GROUPS[type] || { head: type, icon: "flag" };
    const line = (a) => {
      const href = alertHref(a);
      const detail = (a.detail || "").replace(/\s*Assign someone to cover the call\.?/, "").trim();
      return `<li class="att-item att-${esc(a.level)}">
        <span class="att-icon">${icon(g.icon, { size: 16 })}</span>
        <span class="att-text">${href ? `<a href="${href}">${esc(a.title)}</a>` : esc(a.title)}${detail ? ` <span class="muted small">${esc(detail)}</span>` : ""}</span>
        <span class="sr-only">${a.level === "action" ? "Needs action" : "For awareness"}</span>
      </li>`;
    };
    return `<details class="att-group"${i < 1 || items.some((a) => a.level === "action") ? " open" : ""}>
      <summary><span class="att-head">${esc(g.head)}</span> <span class="count-pill">${items.length}</span></summary>
      ${g.action ? `<p class="att-action small muted">${esc(g.action)}</p>` : ""}
      <ul class="att-list">${items.slice(0, ATT_SHOW).map(line).join("")}</ul>
      ${items.length > ATT_SHOW ? `<p class="small att-more"><a href="#/alerts">${items.length - ATT_SHOW} more…</a></p>` : ""}
    </details>`;
  }).join("");
}

async function loadAlertPreview() {
  const box = el("alertPreview");
  try {
    const { alerts } = await api("/api/alerts");
    if (!el("alertPreview")) return;
    box.innerHTML = alerts.length
      ? attentionHtml(alerts)
      : `<p class="muted small">Nothing needs attention. <a href="#/screener">Find new ideas →</a></p>`;
  } catch {
    if (el("alertPreview")) box.innerHTML = `<p class="muted small">Alerts unavailable right now.</p>`;
  }
}

// ---- Add / edit dialog ----

export function openPositionDialog(position, prefill = {}) {
  wireGlobalOnce();
  const form = el("posForm");
  form.reset();
  clearErrors(form);
  el("dialogTitle").textContent = position ? `Edit ${position.symbol}` : "Add position";
  form.id.value = position?.id || "";
  const src = position || prefill;
  for (const key of ["symbol", "shares", "lastPrice", "avgCost", "totalCost", "marketValue", "divIncome", "notes"]) {
    if (form[key] && src[key] !== undefined && src[key] !== null) form[key].value = src[key];
  }
  el("dialog").showModal();
  (position ? form.shares : form.symbol.value ? form.shares : form.symbol).focus();
}

function clearErrors(form) {
  form.querySelectorAll(".field-error").forEach((n) => (n.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
}

function fieldError(form, name, message) {
  form[name].setAttribute("aria-invalid", "true");
  el(`err-${name}`).textContent = message;
}

const num = (v) => (v === "" || v === null ? null : parseFloat(v));

let wired = false;

// Wires listeners on elements OUTSIDE #view (the dialog lives in index.html and persists
// across route changes), so this only needs to run once per page load.
function wireGlobalOnce() {
  if (wired) return;
  wired = true;

  el("cancelBtn").addEventListener("click", () => el("dialog").close());

  el("posForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const id = form.id.value;
    const symbol = form.symbol.value.trim().toUpperCase();
    const shares = num(form.shares.value);
    const avgCost = num(form.avgCost.value) ?? 0;
    const lastPrice = num(form.lastPrice.value) ?? 0;

    let bad = false;
    if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) { fieldError(form, "symbol", "Enter a ticker like AAPL or BRK.B."); bad = true; }
    if (shares === null || !(shares > 0)) { fieldError(form, "shares", "Shares must be greater than 0."); bad = true; }
    if (bad) {
      form.querySelector("[aria-invalid]").focus();
      return;
    }

    const payload = {
      symbol,
      shares,
      lastPrice,
      avgCost,
      totalCost: num(form.totalCost.value) ?? +(shares * avgCost).toFixed(2),
      marketValue: num(form.marketValue.value) ?? +(shares * lastPrice).toFixed(2),
      divIncome: num(form.divIncome.value) ?? 0,
      notes: form.notes.value.trim(),
    };
    try {
      if (id) {
        await api(`/api/positions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/positions", { method: "POST", body: JSON.stringify(payload) });
      }
      el("dialog").close();
      invalidateContext();
      toast(`${symbol} ${id ? "updated" : "added"}.`, { type: "success" });
      if (document.getElementById("tbody")) {
        await loadPositions();
        document.querySelector(`tr[data-id] .symbol-cell[href$="/${symbol}"]`)?.focus();
      } else {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    } catch (err) {
      if (/exists/i.test(err.message)) fieldError(form, "symbol", err.message);
      else toast(err.message, { type: "error" });
    }
  });
}

async function deletePosition(p) {
  const ok = await confirmAction({
    title: `Delete ${p.symbol}?`,
    body: `This removes the ${p.symbol} position (${p.shares.toLocaleString()} shares, ${fmtUSD(p.marketValue)}) from the fund's holdings.`,
    confirmLabel: "Delete position",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/positions/${p.id}`, { method: "DELETE" });
    invalidateContext();
    await loadPositions();
    el("search").focus();
    const { id, updatedAt, ...restore } = p;
    toast(`${p.symbol} deleted.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await api("/api/positions", { method: "POST", body: JSON.stringify(restore) });
          invalidateContext();
          if (document.getElementById("tbody")) await loadPositions();
          toast(`${p.symbol} restored.`, { type: "success" });
        },
      },
    });
  } catch (err) {
    toast(err.message, { type: "error" });
  }
}

export async function mount(container) {
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/") + skeleton("rows", { label: "Loading holdings" });
  state.bases = null; // re-fetched per visit (server caches the histories for 6h)
  state.period = getPref("holdingsPeriod", "all");
  try {
    state.positions = await api("/api/positions");
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/") + pageHead("Portfolio") + errorState({ title: "Couldn't load holdings.", detail: err.message, retryId: "page" });
    bindRetry(container, "page", () => mount(container));
    return;
  }
  const unlocked = can("trade");

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/")}
    ${pageHead(
      "Portfolio",
      `The fund's current holdings, valued at live prices. <span id="marketLine" class="market-line" role="status">${marketLine()}</span>`,
      unlocked ? `<button id="addBtn" class="btn btn-primary">Add position</button>` : ""
    )}
    <div class="period-bar">
      <span class="muted small" id="periodLabel">Gains for</span>
      <div class="seg seg-sm" role="group" aria-labelledby="periodLabel">
        ${PERIODS.map(([k, short, long]) => `<button type="button" class="seg-btn" data-period="${k}" aria-pressed="${state.period === k}" title="${esc(long)}">${short}</button>`).join("")}
      </div>
    </div>
    <section class="hold-figs" id="summary" aria-label="Portfolio summary"></section>
    <p class="hold-figs-more small muted" id="summaryMore"></p>
    <div class="hold-layout">
      <div class="hold-main">
        <section class="toolbar hold-toolbar">
          <div class="field-inline">
            <label for="search" class="sr-only">Filter holdings</label>
            <input id="search" type="search" placeholder="Filter" autocomplete="off" />
            <span id="filterCount" class="muted small" role="status"></span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="columnsBtn" aria-haspopup="dialog" aria-expanded="false"></button>
          ${unlocked ? "" : lockedHint("Sign in to add, edit, or delete positions.", "trade")}
        </section>
        <section class="table-wrap">
          <table id="table">
            <caption class="sr-only">Fund holdings. Column headers are buttons that sort the table. Pick a ticker to see its details.</caption>
            <thead id="thead"></thead>
            <tbody id="tbody"></tbody>
          </table>
          <div id="tableEmpty"></div>
        </section>
      </div>
      <aside class="hold-aside" aria-label="Details">
        <section class="hold-inspector" id="holdInspector" hidden aria-live="polite"></section>
        <div class="hold-default">
          <section class="hold-aside-sec quick-links" aria-labelledby="ql-title">
            <div class="hold-aside-head"><h3 id="ql-title" class="hold-aside-title">Needs attention</h3><a class="small" href="#/alerts">All alerts</a></div>
            <div id="alertPreview">${skeleton("cards", { label: "Checking alerts" })}</div>
          </section>
          <section class="hold-aside-sec" id="concentration" aria-label="Largest positions"></section>
          ${askChips(suggestionsFor(null).slice(0, 3), { label: "Ask about the portfolio" })}
        </div>
      </aside>
    </div>
    ${crowdingPanelHtml("crowdPanel")}
  `;

  wireGlobalOnce();
  el("columnsBtn").addEventListener("click", (e) => openColumnsMenu(e.currentTarget));
  renderTable();
  loadAlertPreview();
  loadCrowdingPanel("crowdPanel", "holdings");
  refreshQuotes().then(startPolling);
  api("/api/signals").then((r) => { state.signals = r.bySymbol; state.signalsLoaded = true; if (el("tbody")) renderTable(); }).catch(() => { /* badges just stay blank */ });

  loadBases();
  // 📝 next to tickers you (or the club) have notes on.
  const loadNoteMarkers = () => noteCounts().then((m) => { state.noteCounts = m; if (el("tbody")) renderTable(); });
  loadNoteMarkers();
  window.addEventListener("pif:notes-changed", loadNoteMarkers, { once: true });
  api("/api/settings").then((s) => { state.cash = Number(s.cash) || 0; if (el("tbody")) renderTable(); }).catch(() => { /* cash card shows … */ });
  api("/api/dividends").then((d) => { state.dividends = d; if (el("tbody")) renderTable(); }).catch(() => { /* card stays loading */ });
  container.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => {
    state.period = b.dataset.period;
    setPref("holdingsPeriod", state.period); // remembered for your account (or this browser)
    container.querySelectorAll("[data-period]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTable();
    loadBases();
  }));
  el("addBtn")?.addEventListener("click", () => openPositionDialog(null));
  bindSort(el("table"), state.sort, renderTable);
  el("search").addEventListener("input", (e) => {
    state.filter = e.target.value.trim();
    renderTable();
  });
  const onInspectorClick = (e) => {
    if (e.target.closest("[data-inspect-close]")) { inspect(state.selected); return; }
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    const delId = e.target.closest("[data-delete]")?.dataset.delete;
    const p = state.positions.find((x) => String(x.id) === (editId || delId));
    if (p && editId) openPositionDialog(p);
    if (p && delId) deletePosition(p);
  };
  el("holdInspector").addEventListener("click", onInspectorClick);
  el("tbody").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-inspect]");
    if (pick) { inspect(pick.dataset.inspect); return; }
    if (!e.target.closest("a, button, input") && e.target.closest("tr[data-symbol]")) { inspect(e.target.closest("tr[data-symbol]").dataset.symbol); return; }
    const jump = e.target.closest("[data-scroll-to]");
    if (jump) { e.preventDefault(); document.getElementById(jump.dataset.scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    const deleteId = e.target.closest("[data-delete]")?.dataset.delete;
    const p = state.positions.find((x) => String(x.id) === (editId || deleteId));
    if (!p) return;
    if (editId) openPositionDialog(p);
    if (deleteId) deletePosition(p);
  });
}
