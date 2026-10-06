import {
  el, esc, fmtUSD, fmtPct, api, isUnlocked, toast, confirmAction, lockedHint, signed,
  sortHeader, sortRows, bindSort, pageHead, loading, errorBox, invalidateContext, subTabs,
} from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";
import { alertItem } from "./alerts.js";
import { crowdingPanelHtml, loadCrowdingPanel } from "./crowdingPanel.js";

export const title = "Portfolio";

const state = { positions: [], quotes: {}, market: null, sort: { key: "marketValue", dir: -1 }, filter: "" };

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
  return positions.map((p) => {
    const gain = p.marketValue - p.totalCost;
    return {
      ...p,
      gain,
      gainPct: p.totalCost ? (gain / p.totalCost) * 100 : null,
      weight: totalValue ? (p.marketValue / totalValue) * 100 : 0,
    };
  });
}

function renderSummary(rows) {
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost ? (totalGain / totalCost) * 100 : 0;
  const totalDiv = rows.reduce((s, r) => s + (r.divIncome || 0), 0);
  const winners = rows.filter((r) => r.gain > 0).length;
  const liveRows = rows.filter((r) => r.dayChange != null && r.prevValue);
  const dayChange = liveRows.reduce((s, r) => s + r.dayChange, 0);
  const dayBase = liveRows.reduce((s, r) => s + r.prevValue, 0);
  const dayPct = dayBase ? (dayChange / dayBase) * 100 : null;

  el("summary").innerHTML = `
    <div class="stat stat-lg"><div class="label">Market value</div><div class="value">${fmtUSD(totalValue)}</div>
      <div class="sub">${rows.length} positions${liveRows.length ? ` · <span class="nowrap">${dayLabel()} ${signed(dayChange, fmtUSD(dayChange))} (${fmtPct(dayPct)})</span>` : ""}</div></div>
    <div class="stat"><div class="label">Total gain</div><div class="value">${signed(totalGain, fmtUSD(totalGain))}</div>
      <div class="sub">${signed(totalGainPct, fmtPct(totalGainPct))} on ${fmtUSD(totalCost)} cost</div></div>
    <div class="stat"><div class="label">Dividend income</div><div class="value">${fmtUSD(totalDiv)}</div>
      <div class="sub">${totalValue ? ((totalDiv / totalValue) * 100).toFixed(2) : "0.00"}% of value</div></div>
    <div class="stat"><div class="label">Winners / losers</div><div class="value">${winners} / ${rows.length - winners}</div>
      <div class="sub">positions above / below cost</div></div>
  `;
}

// Concentration view: the biggest weights as labelled bars (a list, so it reads fine
// without the visual), with a gentle flag on any single name above 10%.
function renderConcentration(rows) {
  const top = [...rows].sort((a, b) => b.weight - a.weight).slice(0, 8);
  const max = top[0]?.weight || 1;
  const topFive = top.slice(0, 5).reduce((s, r) => s + r.weight, 0);
  el("concentration").innerHTML = `
    <div class="panel-head"><h3>Largest positions</h3><span class="muted small">Top 5 = ${topFive.toFixed(1)}% of fund</span></div>
    <ol class="bar-list">
      ${top.map((r) => `
        <li>
          <a href="#/research/${encodeURIComponent(r.symbol)}" class="bar-label">${esc(r.symbol)}</a>
          <span class="bar-track" aria-hidden="true"><span class="bar-fill ${r.weight > 10 ? "bar-warn" : ""}" style="width:${(r.weight / max) * 100}%"></span></span>
          <span class="bar-value">${r.weight.toFixed(1)}%${r.weight > 10 ? ` <span class="badge badge-warn" title="Above 10% of the fund">&gt;10%</span>` : ""}</span>
        </li>`).join("")}
    </ol>`;
}

function renderTable() {
  const unlocked = isUnlocked();
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
  el("thead").innerHTML = `<tr>
    ${sortHeader("symbol", "Ticker", s, { align: "left sticky-col" })}
    ${sortHeader("weight", "Weight", s)}
    ${sortHeader("shares", "Shares", s)}
    ${sortHeader("lastPrice", "Price", s)}
    ${sortHeader("dayChangePct", "Day", s)}
    ${sortHeader("avgCost", "Avg cost", s)}
    ${sortHeader("marketValue", "Market value", s)}
    ${sortHeader("gain", "Gain $", s)}
    ${sortHeader("gainPct", "Gain %", s)}
    ${sortHeader("divIncome", "Dividends", s)}
    ${unlocked ? `<th scope="col"><span class="sr-only">Actions</span></th>` : ""}
  </tr>`;

  el("tbody").innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <th scope="row" class="left sticky-col">
        <a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a>
        ${r.notes ? `<div class="muted small cell-note">${esc(r.notes)}</div>` : ""}
      </th>
      <td>${r.weight.toFixed(1)}%</td>
      <td>${r.shares.toLocaleString()}</td>
      <td>${fmtUSD(r.lastPrice)}${r.live ? "" : `<span class="stale-dot" title="Live price unavailable — showing the last saved price" aria-label="saved price, not live">*</span>`}</td>
      <td>${r.dayChangePct == null ? `<span class="muted">—</span>` : signed(r.dayChangePct, fmtPct(r.dayChangePct))}</td>
      <td>${fmtUSD(r.avgCost)}</td>
      <td>${fmtUSD(r.marketValue)}</td>
      <td>${signed(r.gain, fmtUSD(r.gain))}</td>
      <td>${r.gainPct === null ? `<span class="muted">—</span>` : signed(r.gainPct, fmtPct(r.gainPct))}</td>
      <td>${fmtUSD(r.divIncome)}</td>
      ${unlocked ? `<td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${r.id}" aria-label="Edit ${esc(r.symbol)}">Edit</button>
          <button class="btn btn-danger btn-sm" data-delete="${r.id}" aria-label="Delete ${esc(r.symbol)}">Delete</button>
        </div>
      </td>` : ""}
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
}

async function loadPositions() {
  state.positions = await api("/api/positions");
  renderTable();
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
  if (m.error) return `Live prices unavailable — showing last saved prices. <button type="button" class="btn-link" id="retryQuotes">Retry</button>`;
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

async function loadAlertPreview() {
  const box = el("alertPreview");
  try {
    const { alerts } = await api("/api/alerts");
    if (!el("alertPreview")) return;
    box.innerHTML = alerts.length
      ? `<ul class="alert-list compact">${alerts.slice(0, 5).map(alertItem).join("")}</ul>${alerts.length > 5 ? `<p class="small"><a href="#/alerts">${alerts.length - 5} more…</a></p>` : ""}`
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
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/") + loading("Loading holdings…");
  try {
    state.positions = await api("/api/positions");
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/") + pageHead("Portfolio") + errorBox(`Could not load holdings: ${err.message}`);
    return;
  }
  const unlocked = isUnlocked();

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/")}
    ${pageHead(
      "Portfolio",
      `The fund's current holdings, valued at live prices. <span id="marketLine" class="market-line" role="status">${marketLine()}</span>`,
      unlocked ? `<button id="addBtn" class="btn btn-primary">+ Add position</button>` : ""
    )}
    <section class="summary" id="summary" aria-label="Portfolio summary"></section>
    <div class="two-col">
      <section class="panel" id="concentration" aria-label="Largest positions"></section>
      <section class="panel quick-links" aria-labelledby="ql-title">
        <div class="panel-head"><h3 id="ql-title">Needs attention</h3><a class="small" href="#/alerts">All alerts →</a></div>
        <div id="alertPreview">${loading("Checking alerts…")}</div>
      </section>
    </div>
    <section class="toolbar">
      <div class="field-inline">
        <label for="search" class="sr-only">Filter holdings</label>
        <input id="search" type="search" placeholder="Filter by ticker or note…" autocomplete="off" />
        <span id="filterCount" class="muted small" role="status"></span>
      </div>
      ${unlocked ? "" : lockedHint("Unlock to add, edit, or delete positions.")}
    </section>
    <section class="table-wrap">
      <table id="table">
        <caption class="sr-only">Fund holdings. Column headers are buttons that sort the table.</caption>
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
      <div id="tableEmpty"></div>
    </section>
    ${crowdingPanelHtml("crowdPanel")}
  `;

  wireGlobalOnce();
  renderTable();
  loadAlertPreview();
  loadCrowdingPanel("crowdPanel", "holdings");
  refreshQuotes().then(startPolling);

  el("addBtn")?.addEventListener("click", () => openPositionDialog(null));
  bindSort(el("table"), state.sort, renderTable);
  el("search").addEventListener("input", (e) => {
    state.filter = e.target.value.trim();
    renderTable();
  });
  el("tbody").addEventListener("click", (e) => {
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    const deleteId = e.target.closest("[data-delete]")?.dataset.delete;
    const p = state.positions.find((x) => String(x.id) === (editId || deleteId));
    if (!p) return;
    if (editId) openPositionDialog(p);
    if (deleteId) deletePosition(p);
  });
}
