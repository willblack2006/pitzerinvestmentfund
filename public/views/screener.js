import { esc, fmtCompact, fmtPct, api, can, toast, lockedHint, signed, sortHeader, sortRows, bindSort, pageHead, loading, subTabs, invalidateContext, errorState, bindRetry } from "../shared.js";
import { crowdingPanelHtml, loadCrowdingPanel } from "./crowdingPanel.js";

export const title = "Discovery";
export const IDEAS_TABS = [["#/screener", "Discovery"], ["#/watchlist", "Watchlist"], ["#/pitches", "Pitches"], ["#/track-record", "Track record"], ["#/forced-sellers", "Forced sellers"], ["#/paper", "Paper trading"]];

const state = { rows: [], sort: { key: "suggestedBy", dir: -1 }, peer: null, growthOnly: false };

const peerChip = (s) => `<a class="peer-chip" href="#/research/${encodeURIComponent(s)}">${esc(s)}</a>`;

// Filters: one holding they are a peer of, and positive revenue growth (the API has no sector).
const visibleRows = () => state.rows.filter((r) => (!state.peer || r.sourcedFrom.includes(state.peer)) && (!state.growthOnly || (r.revenueGrowthTTM !== null && r.revenueGrowthTTM > 0)));

function filtersHtml() {
  const counts = {};
  for (const r of state.rows) for (const h of r.sourcedFrom) counts[h] = (counts[h] || 0) + 1;
  const holdings = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const chip = (attrs, on, label, n) => `<button type="button" class="filter-chip" aria-pressed="${on}" ${attrs}>${label}${n != null ? ` <span class="filter-chip-n">${n}</span>` : ""}</button>`;
  return `<div class="filter-chips" role="group" aria-label="Filter candidates">
    <span class="filter-label">Peer of</span>
    ${chip('data-peer=""', !state.peer, "All", state.rows.length)}
    ${holdings.map((h) => chip(`data-peer="${esc(h)}"`, state.peer === h, esc(h), counts[h])).join("")}
    <span class="filter-sep" aria-hidden="true"></span>
    ${chip('data-growth="1"', state.growthOnly, "Only stocks with positive revenue growth")}
  </div>`;
}

function drawFilters() {
  const box = document.getElementById("scrFilters");
  if (box) box.innerHTML = filtersHtml();
  const n = document.getElementById("scrCount");
  if (n) n.textContent = `${visibleRows().length} of ${state.rows.length} candidates · click any ticker for full research`;
}

function renderTable() {
  const unlocked = can("member");
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
  const shown = sortRows(visibleRows(), s);
  document.getElementById("scrTbody").innerHTML = (shown.length || !state.rows.length ? "" : `<tr><td colspan="7" class="left muted">No candidates match these filters.</td></tr>`) + shown.map((r) => `
    <tr>
      <th scope="row" class="left sticky-col"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></th>
      <td class="left"><span class="count-pill" title="Suggested by ${r.suggestedBy} holdings">${r.suggestedBy}</span> <span class="peer-chips">${r.sourcedFrom.map(peerChip).join("")}</span></td>
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
    container.innerHTML = subTabs(IDEAS_TABS, "#/screener") + pageHead("Discovery") + errorState({ title: "Couldn't load ideas.", detail: err.message, retryId: "page" });
    bindRetry(container, "page", () => mount(container));
    return;
  }
  state.rows = data.candidates.map((r) => ({ ...r, suggestedBy: r.sourcedFrom.length }));

  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/screener")}
    ${pageHead("Discovery", `Companies that show up as competitors of our ${data.holdingsCount} holdings but that we don't own. The more holdings that point to a company, the higher it ranks.`)}
    <section class="toolbar">
      <span class="muted small" id="scrCount" aria-live="polite">${state.rows.length} candidates · click any ticker for full research</span>
      ${can("member") ? "" : lockedHint("Sign in to add ideas to the watchlist.")}
    </section>
    ${state.rows.length ? `<div id="scrFilters">${filtersHtml()}</div>` : ""}
    <section class="table-wrap">
      <table id="scrTable">
        <caption class="sr-only">Idea candidates. Column headers are buttons that sort the table.</caption>
        <thead id="scrThead"></thead>
        <tbody id="scrTbody"></tbody>
      </table>
      ${state.rows.length ? "" : `<p class="empty">No new candidates found. Every peer is already owned or watched.</p>`}
    </section>
    ${state.rows.length ? crowdingPanelHtml("crowdPanel") : ""}
  `;

  state.peer = null; state.growthOnly = false;
  renderTable();
  document.getElementById("scrFilters")?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.growth) state.growthOnly = !state.growthOnly;
    else if ("peer" in b.dataset) state.peer = b.dataset.peer && b.dataset.peer !== state.peer ? b.dataset.peer : null;
    else return;
    drawFilters();
    renderTable();
    document.querySelector(`#scrFilters [aria-pressed="true"]${b.dataset.growth ? "[data-growth]" : b.dataset.peer ? `[data-peer="${CSS.escape(b.dataset.peer)}"]` : '[data-peer=""]'}`)?.focus();
  });
  bindSort(document.getElementById("scrTable"), state.sort, renderTable);
  document.getElementById("scrTbody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-watch]");
    if (btn) addToWatchlist(btn);
  });
  if (state.rows.length) loadCrowdingPanel("crowdPanel", state.rows.slice(0, 20).map((r) => r.symbol));
}
