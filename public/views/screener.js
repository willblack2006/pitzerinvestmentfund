import {
  esc, fmtCompact, fmtPct, api, isUnlocked, toast, lockedHint, signed,
  sortHeader, sortRows, bindSort, pageHead, loading, errorBox, subTabs, invalidateContext,
} from "../shared.js";

export const title = "Discovery";
export const IDEAS_TABS = [["#/screener", "Discovery"], ["#/watchlist", "Watchlist"], ["#/pitches", "Pitches"]];

const state = { rows: [], sort: { key: "suggestedBy", dir: -1 } };

const tickerLink = (s) => `<a href="#/research/${encodeURIComponent(s)}">${esc(s)}</a>`;

function renderTable() {
  const unlocked = isUnlocked();
  const s = state.sort;
  document.getElementById("scrThead").innerHTML = `<tr>
    ${sortHeader("symbol", "Ticker", s, { align: "left sticky-col" })}
    ${sortHeader("suggestedBy", "Peer of", s, { align: "left" })}
    ${sortHeader("peTTM", "P/E (TTM)", s)}
    ${sortHeader("marketCap", "Market cap", s)}
    ${sortHeader("revenueGrowthTTM", "Revenue growth", s)}
    ${sortHeader("priceChange1Y", "1Y return", s)}
    <th scope="col"><span class="sr-only">Watchlist</span></th>
  </tr>`;
  document.getElementById("scrTbody").innerHTML = sortRows(state.rows, s).map((r) => `
    <tr>
      <th scope="row" class="left sticky-col"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></th>
      <td class="left small"><span class="count-pill" title="Suggested by ${r.suggestedBy} holdings">${r.suggestedBy}</span> ${r.sourcedFrom.map(tickerLink).join(", ")}</td>
      <td>${r.peTTM?.toFixed(1) ?? `<span class="muted">—</span>`}</td>
      <td>${r.marketCap ? fmtCompact(r.marketCap * 1e6) : `<span class="muted">—</span>`}</td>
      <td>${r.revenueGrowthTTM === null ? `<span class="muted">—</span>` : signed(r.revenueGrowthTTM, fmtPct(r.revenueGrowthTTM))}</td>
      <td>${r.priceChange1Y === null ? `<span class="muted">—</span>` : signed(r.priceChange1Y, fmtPct(r.priceChange1Y))}</td>
      <td class="watch-cell">${r.watched
        ? `<span class="badge badge-watch">Watching</span>`
        : unlocked ? `<button class="btn btn-ghost btn-sm" data-watch="${esc(r.symbol)}" aria-label="Add ${esc(r.symbol)} to watchlist">+ Watch</button>` : ""}</td>
    </tr>`).join("");
}

async function addToWatchlist(btn) {
  const row = state.rows.find((r) => r.symbol === btn.dataset.watch);
  btn.disabled = true;
  try {
    await api("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol: row.symbol, sourcedFrom: `Discovery: peer of ${row.sourcedFrom.join(", ")}` }),
    });
    row.watched = true;
    invalidateContext();
    // Update just this cell so scroll position and focus are preserved.
    const cell = btn.closest(".watch-cell");
    cell.innerHTML = `<span class="badge badge-watch" tabindex="-1">Watching</span>`;
    cell.firstElementChild.focus();
    toast(`${row.symbol} added to the watchlist.`, {
      type: "success",
      action: { label: "View watchlist", onClick: () => (location.hash = "#/watchlist") },
    });
  } catch (err) {
    btn.disabled = false;
    toast(err.message, { type: "error" });
  }
}

export async function mount(container) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/screener") +
    loading("Scanning competitors of every holding for new ideas… the first scan can take ~30 seconds; results are cached after that.");

  let data;
  try {
    data = await api("/api/screener");
  } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/screener") + pageHead("Discovery") + errorBox(`Could not load ideas: ${err.message}`);
    return;
  }
  state.rows = data.candidates.map((r) => ({ ...r, suggestedBy: r.sourcedFrom.length }));

  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/screener")}
    ${pageHead("Discovery", `Companies that show up as competitors of our ${data.holdingsCount} holdings but that we don't own. The more holdings that point to a company, the higher it ranks.`)}
    <section class="toolbar">
      <span class="muted small">${state.rows.length} candidates · click any ticker for full research</span>
      ${isUnlocked() ? "" : lockedHint("Unlock to add ideas to the watchlist.")}
    </section>
    <section class="table-wrap">
      <table id="scrTable">
        <caption class="sr-only">Idea candidates. Column headers are buttons that sort the table.</caption>
        <thead id="scrThead"></thead>
        <tbody id="scrTbody"></tbody>
      </table>
      ${state.rows.length ? "" : `<p class="empty">No new candidates found — every peer is already owned or watched.</p>`}
    </section>
  `;

  renderTable();
  bindSort(document.getElementById("scrTable"), state.sort, renderTable);
  document.getElementById("scrTbody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-watch]");
    if (btn) addToWatchlist(btn);
  });
}
