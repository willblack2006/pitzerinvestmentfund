import { esc, api, safeUrl, pageHead, loading, errorBox, subTabs } from "../shared.js";
import { MARKET_TABS } from "./insiders.js";

export const title = "Congress trades";

const tone = (type) => (type === "Purchase" ? "tone-good" : /sale/i.test(type) ? "tone-bad" : "");

export function tradeRows(trades, { showTicker = true } = {}) {
  return trades.map((t) => `
    <tr>
      <td>${esc(t.tradeDate || "—")}</td>
      ${showTicker ? `<th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(t.ticker)}/ownership">${esc(t.ticker)}</a>${t.owned === false ? ` <span class="badge badge-watch">Watch</span>` : ""}</th>` : ""}
      <td>${esc(t.member)} <span class="muted small">${esc(t.district || "")}</span></td>
      <td><span class="${tone(t.type)}">${esc(t.type)}</span>${t.assetType === "option" ? ` <span class="muted small">(option)</span>` : ""}</td>
      <td class="num">${esc(t.amount)}</td>
      <td><a href="${safeUrl(t.url)}" target="_blank" rel="noopener">Filed ${esc(t.filingDate || "")}<span class="sr-only"> (opens the PDF on house.gov in a new tab)</span></a></td>
    </tr>`).join("");
}

export const EVIDENCE_NOTE = `Weak evidence: studies of trades after the 2012 STOCK Act find no average edge in members' trades. Members report trades up to 45 days after they happen, and only in value ranges. House only (the Senate site requires accepting its terms). Rows are read from the electronically filed PDFs, so a few with unusual layouts can be missed.`;

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/congress") + loading("Reading recent House transaction reports… the first load downloads each PDF and can take a minute.");
  let r;
  try {
    r = await api("/api/congress-trades");
  } catch (err) {
    container.innerHTML = subTabs(MARKET_TABS, "#/congress") + pageHead("Congress trades") + errorBox(`Could not load congressional trades: ${err.message}`);
    return;
  }
  if (r.error) {
    container.innerHTML = subTabs(MARKET_TABS, "#/congress") + pageHead("Congress trades") + errorBox(`The House disclosure site couldn't be read: ${r.error}`);
    return;
  }
  container.innerHTML = `
    ${subTabs(MARKET_TABS, "#/congress")}
    ${pageHead("Congress trades", `Trades reported by House members in the last ${r.days} days of filings, in names the fund owns or watches.`)}
    <section class="panel page-pad-panel" aria-labelledby="ct-h">
      <div class="panel-head"><h3 id="ct-h">In our holdings &amp; watchlist</h3><span class="muted small">${r.filingCount} reports, ${r.tradeCount} stock and option trades read</span></div>
      ${r.matched.length ? `
        <div class="table-scroll"><table class="mini-table">
          <caption class="sr-only">House members' trades in fund holdings and watchlist names, newest first</caption>
          <thead><tr><th scope="col">Trade date</th><th scope="col">Ticker</th><th scope="col">Member</th><th scope="col">Type</th><th scope="col" class="num">Amount</th><th scope="col">Report</th></tr></thead>
          <tbody>${tradeRows(r.matched)}</tbody>
        </table></div>` : `<p class="muted small">No reported House trades in the fund's holdings or watchlist in this window.</p>`}
    </section>
    <section class="panel page-pad-panel" aria-labelledby="mt-h">
      <h3 id="mt-h">Most-traded tickers (all members)</h3>
      ${r.mostTraded.length ? `<p class="small">${r.mostTraded.map((m) => `<a class="symbol-cell" href="#/research/${encodeURIComponent(m.ticker)}">${esc(m.ticker)}</a> (${m.n})`).join(" · ")}</p>` : `<p class="muted small">None.</p>`}
      ${r.paperCount ? `<p class="muted small">${r.paperCount} paper-filed report(s) in this window are scanned images and can't be read.</p>` : ""}
      ${r.unreadable ? `<p class="muted small">${r.unreadable} report(s) couldn't be downloaded this time.</p>` : ""}
    </section>
    <p class="muted small page-pad">${EVIDENCE_NOTE}</p>`;
}
