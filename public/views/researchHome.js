import { esc, fundContext, recentTickers, pageHead, loading } from "../shared.js";

export const title = "Research";

const chip = (s, extra = "") =>
  `<a class="chip" href="#/research/${encodeURIComponent(s)}">${esc(s)}${extra}</a>`;

export async function mount(container) {
  container.innerHTML = loading("Loading…");
  const ctx = await fundContext(true);
  const recent = recentTickers();

  container.innerHTML = `
    ${pageHead("Research", "Look up any ticker: price, fundamentals from SEC filings, peers, news, insider trades, and the team's thesis.")}
    <form class="hero-search" id="heroSearch" role="search">
      <label for="heroInput" class="hero-label">Which company are you researching?</label>
      <div class="hero-row">
        <input id="heroInput" type="search" list="tickerOptions" placeholder="e.g. AAPL, MSFT, BRK.B" autocomplete="off" spellcheck="false" maxlength="10" />
        <button class="btn btn-primary" type="submit">Research</button>
      </div>
    </form>

    ${recent.length ? `
      <section class="panel page-pad-panel" aria-labelledby="recent-h">
        <h3 id="recent-h">Recently viewed</h3>
        <div class="chip-list">${recent.map((s) => chip(s)).join("")}</div>
      </section>` : ""}

    <section class="panel page-pad-panel" aria-labelledby="owned-h">
      <h3 id="owned-h">Our holdings <span class="muted small">(${ctx.positions.length})</span></h3>
      <div class="chip-list">${ctx.positions.map((p) => chip(p.symbol)).join("") || `<p class="muted">No holdings yet.</p>`}</div>
    </section>

    <section class="panel page-pad-panel" aria-labelledby="watch-h">
      <h3 id="watch-h">On the watchlist <span class="muted small">(${ctx.watchlist.length})</span></h3>
      <div class="chip-list">${ctx.watchlist.map((w) => chip(w.symbol)).join("") || `<p class="muted">Nothing yet — <a href="#/screener">find ideas</a>.</p>`}</div>
    </section>
  `;

  container.querySelector("#heroSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = container.querySelector("#heroInput").value.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
    if (s) location.hash = `#/research/${encodeURIComponent(s)}`;
  });
}
