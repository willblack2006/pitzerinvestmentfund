import { esc, api, fmtPct, signed, pageHead, loading, errorBox, subTabs } from "../shared.js";
import { IDEAS_TABS } from "./screener.js";

export const title = "Forced sellers";

export async function mount(container) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/forced-sellers") + loading("Checking year-to-date returns and recent 8-K filings across holdings and watchlist…");
  let r;
  try {
    r = await api("/api/forced-sellers");
  } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/forced-sellers") + pageHead("Forced sellers") + errorBox(`Could not load this feed: ${err.message}`);
    return;
  }
  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/forced-sellers")}
    ${pageHead("Forced-seller opportunities", "Mechanical selling pressure unrelated to fundamentals, across holdings and the watchlist. A watchlist feed, not a recommendation.")}
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="tl-h">
        <div class="panel-head"><h3 id="tl-h">Tax-loss candidates</h3><span class="muted small">Down ≥20% YTD, screened only in November/December</span></div>
        ${!r.inSeason ? `<p class="muted small">Not currently screened — this list only runs in November and December, when tax-loss selling actually happens.</p>` : r.taxLoss.length ? `
          <ul class="link-list">${r.taxLoss.map((t) => `<li><a class="symbol-cell" href="#/research/${encodeURIComponent(t.symbol)}">${esc(t.symbol)}</a> ${t.owned ? `<span class="badge badge-owned">Owned</span>` : `<span class="badge badge-watch">Watching</span>`} — ${signed(t.ytdReturnPct, fmtPct(t.ytdReturnPct))} YTD</li>`).join("")}</ul>`
          : `<p class="muted small">No holdings or watchlist names are down 20%+ YTD right now.</p>`}
        <p class="muted small">Names sold for tax-loss harvesting in December have a documented tendency to rebound in January (the "January effect") — not a guarantee, and this isn't advice to buy or hold through the drop.</p>
      </section>
      <section class="panel span-full" aria-labelledby="so-h">
        <h3 id="so-h">Recent spin-offs</h3>
        ${r.spinoffs.length ? `
          <ul class="link-list">${r.spinoffs.map((s) => `<li><a class="symbol-cell" href="#/research/${encodeURIComponent(s.symbol)}">${esc(s.symbol)}</a> ${s.owned ? `<span class="badge badge-owned">Owned</span>` : `<span class="badge badge-watch">Watching</span>`} — ${esc(s.description)} (filed ${esc(s.filingDate)})</li>`).join("")}</ul>`
          : `<p class="muted small">No recent 8-K spin-off disclosures found among holdings/watchlist.</p>`}
        <p class="muted small">Spin-offs can create mechanical selling in the new shares as index funds and mandate-mismatched holders dump a security they weren't built to hold.</p>
      </section>
      <section class="panel span-full" aria-labelledby="id-h">
        <h3 id="id-h">Index deletions</h3>
        <p class="muted small">${esc(r.indexDeletions.reason)}</p>
      </section>
    </div>`;
}
