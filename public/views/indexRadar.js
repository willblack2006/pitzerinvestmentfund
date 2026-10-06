import { esc, api, fmtMoneyCompact, fmtRatio, pageHead, loading, errorBox, subTabs } from "../shared.js";
import { MARKET_TABS } from "./insiders.js";

export const title = "Index radar";

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/index-radar") + loading("Screening holdings and watchlist against S&P 500 eligibility criteria…");
  let r;
  try {
    r = await api("/api/index-radar");
  } catch (err) {
    container.innerHTML = subTabs(MARKET_TABS, "#/index-radar") + pageHead("Index radar") + errorBox(`Could not load the index radar: ${err.message}`);
    return;
  }
  const eligible = r.rows.filter((x) => x.eligible);
  container.innerHTML = `
    ${subTabs(MARKET_TABS, "#/index-radar")}
    ${pageHead("Index event radar", "An approximate S&P 500 addition screen for holdings and watchlist names, plus Russell reconstitution dates.")}
    <section class="panel page-pad-panel" aria-labelledby="russ-h">
      <h3 id="russ-h">Russell reconstitution</h3>
      <p class="small">${r.russellReconstitution.map(esc).join(" · ") || "No upcoming date computed."} — effective the last Friday of June each year.</p>
    </section>
    <section class="panel page-pad-panel" aria-labelledby="sp-h">
      <div class="panel-head"><h3 id="sp-h">S&amp;P 500 addition screen</h3><span class="muted small">${eligible.length} of ${r.rows.length} pass the screen</span></div>
      <div class="table-scroll"><table class="mini-table">
        <thead><tr><th scope="col">Ticker</th><th scope="col" class="num">Market cap</th><th scope="col" class="num">Public float</th><th scope="col">Screen</th><th scope="col">Why</th></tr></thead>
        <tbody>${r.rows.map((x) => x.error ? `
          <tr><th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a></th><td colspan="4" class="muted small">No data</td></tr>` : `
          <tr>
            <th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a></th>
            <td class="num">${fmtMoneyCompact(x.marketCap)}</td>
            <td class="num">${x.publicFloatPct != null ? fmtRatio(x.publicFloatPct) : "—"}</td>
            <td>${x.eligible ? `<span class="tone-good">Passes</span>` : `<span class="muted">Fails</span>`}</td>
            <td class="small muted">${esc(x.reasons[0] || "")}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <p class="muted small">Approximate criteria only — S&P's index committee also weighs sector balance, liquidity and judgment calls this screen can't replicate. Research on the index-inclusion effect finds most of the historical price "pop" has moved to the pre-announcement run-up window, since the original effect became well known and arbitraged.</p>
    </section>`;
}
