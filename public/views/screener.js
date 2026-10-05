import { el, fmtCompact, fmtPct, api, isUnlocked } from "../shared.js";

async function addToWatchlist(symbol, sourcedFrom) {
  try {
    await api("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol, sourcedFrom: sourcedFrom.join(", ") }),
    });
    mount(document.getElementById("view"));
  } catch (err) {
    alert(err.message);
  }
}

export async function mount(container) {
  container.innerHTML = `<p class="muted">Scanning peers of your 32 holdings for adjacent candidates...</p>`;

  let data;
  try {
    data = await api("/api/screener");
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load screener: ${err.message}</p>`;
    return;
  }

  const unlocked = isUnlocked();
  const rows = data.candidates;

  container.innerHTML = `
    <h2>Discovery</h2>
    <p class="muted">Stocks that show up as peers/competitors across the fund's 32 holdings, not yet owned or watched. Ranked by how many holdings suggested them.</p>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Sourced From</th>
            <th>P/E (TTM)</th>
            <th>Market Cap</th>
            <th>Rev Growth (TTM)</th>
            <th>1Y Return</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><a class="symbol-cell" href="#/research/${r.symbol}">${r.symbol}</a></td>
              <td class="left muted small">${r.sourcedFrom.join(", ")}</td>
              <td>${r.peTTM?.toFixed(1) ?? "—"}</td>
              <td>${fmtCompact(r.marketCap ? r.marketCap * 1e6 : null)}</td>
              <td>${r.revenueGrowthTTM !== null ? fmtPct(r.revenueGrowthTTM) : "—"}</td>
              <td class="${(r.priceChange1Y ?? 0) >= 0 ? "gain-pos" : "gain-neg"}">${r.priceChange1Y !== null ? fmtPct(r.priceChange1Y) : "—"}</td>
              <td>${unlocked ? (r.watched ? `<span class="muted small">Watching</span>` : `<button class="btn btn-ghost" data-watch="${r.symbol}" data-from="${r.sourcedFrom.join("|")}">+ Watch</button>`) : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;

  container.querySelectorAll("[data-watch]").forEach((btn) => {
    btn.addEventListener("click", () => addToWatchlist(btn.dataset.watch, btn.dataset.from.split("|")));
  });
}
