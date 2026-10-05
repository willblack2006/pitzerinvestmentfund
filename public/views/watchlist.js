import {
  esc, api, isUnlocked, toast, confirmAction, lockedHint, pageHead, loading, errorBox, subTabs, invalidateContext,
} from "../shared.js";
import { IDEAS_TABS } from "./screener.js";
import { openPositionDialog } from "./holdings.js";

export const title = "Watchlist";

let rows = [];

function renderRows(container) {
  const unlocked = isUnlocked();
  const tbody = container.querySelector("#wlTbody");
  tbody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></th>
      <td class="left muted small">${esc(r.sourcedFrom || "—")}</td>
      <td class="left">${esc(r.addedAt?.slice(0, 10) || "—")}</td>
      <td>
        <div class="row-actions">
          <a class="btn btn-ghost btn-sm" href="#/research/${encodeURIComponent(r.symbol)}" aria-label="Research ${esc(r.symbol)}">Research</a>
          ${unlocked ? `
            <button class="btn btn-ghost btn-sm" data-buy="${r.id}" aria-label="Add ${esc(r.symbol)} to holdings">Add to holdings</button>
            <button class="btn btn-danger btn-sm" data-remove="${r.id}" aria-label="Remove ${esc(r.symbol)} from watchlist">Remove</button>` : ""}
        </div>
      </td>
    </tr>`).join("");
  container.querySelector("#wlTable").classList.toggle("hidden", !rows.length);
  container.querySelector("#wlEmpty").innerHTML = rows.length
    ? ""
    : `<div class="empty-state">
        <p class="empty-title">Nothing on the watchlist yet</p>
        <p class="muted">Add candidates from Discovery or from any research page, then build the thesis before pitching.</p>
        <p><a class="btn btn-primary" href="#/screener">Find ideas in Discovery</a></p>
        <p class="muted small">Tip: press <kbd>/</kbd> anywhere to research a ticker.</p>
      </div>`;
}

async function removeItem(container, item) {
  const ok = await confirmAction({
    title: `Remove ${item.symbol}?`,
    body: `${item.symbol} will be taken off the watchlist. Its research page and thesis are kept.`,
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/watchlist/${item.id}`, { method: "DELETE" });
    rows = rows.filter((r) => r.id !== item.id);
    invalidateContext();
    renderRows(container);
    container.querySelector("h2")?.focus();
    toast(`${item.symbol} removed.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await api("/api/watchlist", {
            method: "POST",
            body: JSON.stringify({ symbol: item.symbol, note: item.note, sourcedFrom: item.sourcedFrom }),
          });
          rows = [restored, ...rows];
          invalidateContext();
          if (container.querySelector("#wlTbody")) renderRows(container);
        },
      },
    });
  } catch (err) {
    toast(err.message, { type: "error" });
  }
}

export async function mount(container) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/watchlist") + loading("Loading watchlist…");
  try {
    rows = await api("/api/watchlist");
  } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/watchlist") + pageHead("Watchlist") + errorBox(`Could not load watchlist: ${err.message}`);
    return;
  }

  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/watchlist")}
    ${pageHead("Watchlist", "Companies the fund is tracking but doesn't own yet. Research them, write a thesis, and add them to holdings once the fund buys.")}
    ${isUnlocked() ? "" : `<section class="toolbar">${lockedHint("Unlock to add, remove, or buy watchlist names.")}</section>`}
    <section class="table-wrap">
      <table id="wlTable">
        <caption class="sr-only">Watchlist</caption>
        <thead><tr>
          <th scope="col" class="left">Ticker</th><th scope="col" class="left">Where it came from</th>
          <th scope="col" class="left">Added</th><th scope="col"><span class="sr-only">Actions</span></th>
        </tr></thead>
        <tbody id="wlTbody"></tbody>
      </table>
      <div id="wlEmpty"></div>
    </section>
  `;
  renderRows(container);

  container.querySelector("#wlTbody").addEventListener("click", (e) => {
    const removeId = e.target.closest("[data-remove]")?.dataset.remove;
    const buyId = e.target.closest("[data-buy]")?.dataset.buy;
    const item = rows.find((r) => String(r.id) === (removeId || buyId));
    if (!item) return;
    if (removeId) removeItem(container, item);
    if (buyId) openPositionDialog(null, { symbol: item.symbol, notes: item.note || "" });
  });
}
