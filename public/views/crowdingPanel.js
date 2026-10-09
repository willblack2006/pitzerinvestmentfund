// Shared "attention spike" panel for the Holdings, Watchlist and Discovery pages: volume
// z-score, opening gap and a news-coverage spike. Barber, Huang, Odean & Schwarz find
// attention-driven buying tends to underperform ~3% over the following week.
import { esc, api, loading } from "../shared.js";

export function crowdingPanelHtml(id) {
  return `
    <section class="panel page-pad-panel" aria-labelledby="${id}-h">
      <div class="panel-head"><h3 id="${id}-h">Attention spikes</h3><span class="muted small">Volume z-score, opening gap &amp; news-coverage spikes</span></div>
      <div id="${id}">${loading("Checking volume, gaps and news coverage…")}</div>
    </section>`;
}

// `scopeOrSymbols` is either "holdings"/"watchlist"/"all", or an array of tickers (e.g. the
// Discovery page's peer-suggested candidates, which aren't on the watchlist yet).
export async function loadCrowdingPanel(id, scopeOrSymbols) {
  const box = document.getElementById(id);
  if (!box) return;
  const query = Array.isArray(scopeOrSymbols) ? `symbols=${encodeURIComponent(scopeOrSymbols.join(","))}` : `scope=${scopeOrSymbols}`;
  let r;
  try {
    r = await api(`/api/crowding?${query}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load attention data: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById(id)) return;
  const spikes = r.rows.filter((x) => x.score >= 30 && !x.error);
  if (!r.rows.length) { box.innerHTML = `<p class="small muted">No stocks to check yet.</p>`; return; }
  if (!spikes.length) { box.innerHTML = `<p class="small muted">No attention spikes across these ${r.rows.length} stocks right now.</p>`; return; }
  box.innerHTML = `
    <ul class="link-list small">${spikes.map((x) => `
      <li><a class="symbol-cell" href="#/research/${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a>
        <span class="badge ${x.score >= 60 ? "badge-danger" : "badge-warn"}">${esc(x.label)}</span>
        <div class="muted">${esc(x.reasons[0])}</div></li>`).join("")}</ul>
    <p class="muted small">A statistical tendency across many stocks, not a prediction for any one of these.</p>`;
}
