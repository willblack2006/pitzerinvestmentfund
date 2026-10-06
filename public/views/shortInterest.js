import { esc, fmtRatio, fmtX, api, signed, fmtPct, pageHead, loading, errorBox, subTabs } from "../shared.js";
import { shortBadge, shortMeter } from "./shortSignal.js";
import { MARKET_TABS } from "./insiders.js";

export const title = "Short interest";

let scope = "all";

async function loadRanking() {
  const box = document.getElementById("spBody");
  if (!box) return;
  box.innerHTML = loading("Scoring short pressure for each stock — the FINRA trend lookup can take a while on first load.");
  let r;
  try {
    r = await api(`/api/short-pressure?scope=${scope}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load short-pressure data: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById("spBody")) return;
  const crowded = r.rows.filter((x) => x.score !== undefined && x.score >= 45).length;
  box.innerHTML = `
    <p class="small">${crowded ? `<strong>${crowded}</strong> of ${r.rows.length} stocks look like crowded shorts.` : `No crowded shorts across these ${r.rows.length} stocks right now.`} Ranked from most to least crowded.</p>
    <div class="table-scroll"><table class="mini-table sig-table">
      <caption class="sr-only">Short-pressure score by stock, most crowded first</caption>
      <thead><tr><th scope="col">Ticker</th><th scope="col">Pressure</th><th scope="col" class="num">Days to cover</th><th scope="col" class="num">Short % of float</th><th scope="col" class="num">Change vs prior mo.</th><th scope="col">Why</th></tr></thead>
      <tbody>${r.rows.map((x) => x.error ? `
        <tr><th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(x.symbol)}/risk">${esc(x.symbol)}</a></th><td colspan="5" class="muted small">No short-interest data</td></tr>` : `
        <tr>
          <th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(x.symbol)}/risk">${esc(x.symbol)}</a>${x.owned ? "" : ` <span class="badge badge-watch">Watch</span>`}</th>
          <td class="nowrap">${shortBadge(x.score, x.label)} ${shortMeter(x.score)}</td>
          <td class="num">${fmtX(x.daysToCover, 1)}</td>
          <td class="num">${fmtRatio(x.shortPctFloat)}</td>
          <td class="num">${x.shortChangePct === null || x.shortChangePct === undefined ? "—" : signed(x.shortChangePct * 100, fmtPct(x.shortChangePct * 100))}</td>
          <td class="small muted">${esc(x.topReason || "")}</td>
        </tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small">Pressure: 0 (low short interest) to 100 (heavily crowded short). Crowded shorts have historically underperformed; a long-only fund can avoid the effect without paying borrow fees. Click a ticker for the full breakdown and the FINRA short-volume trend.</p>`;
}

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/short-interest") + pageHead("Short interest", "Which holdings and watchlist names look like crowded shorts — high days-to-cover and rising short interest, which research links to underperformance.");
  container.innerHTML += `
    <section class="panel page-pad-panel" aria-labelledby="sp-h">
      <div class="panel-head">
        <h3 id="sp-h">Short-pressure ranking</h3>
        <div class="seg seg-sm" role="group" aria-label="Which stocks">
          ${[["all", "Holdings + watchlist"], ["holdings", "Holdings"], ["watchlist", "Watchlist"]].map(([v, l]) => `<button type="button" class="seg-btn" data-scope="${v}" aria-pressed="${scope === v}">${l}</button>`).join("")}
        </div>
      </div>
      <div id="spBody"></div>
    </section>
    <details class="explainer page-pad">
      <summary>How to read this page</summary>
      <p class="small">Days-to-cover (short interest ÷ average daily volume) and short interest as a share of the float, from Yahoo's short-interest data (updated roughly twice a month). A FINRA daily short-volume trend is shown on each stock's Risk tab — that figure is mostly market-maker order flow, not bearish bets, so it's only a secondary signal here. Not a buy/sell recommendation.</p>
    </details>`;
  loadRanking();
  container.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
    scope = b.dataset.scope;
    container.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    loadRanking();
  }));
}
