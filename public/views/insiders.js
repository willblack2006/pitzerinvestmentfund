import { el, fmtUSD, fmtNum, api } from "../shared.js";

export async function mount(container) {
  container.innerHTML = `<p class="muted">Pulling SEC Form 4 insider activity across your 32 holdings...</p>`;

  let data;
  try {
    data = await api("/api/insiders");
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load insider activity: ${err.message}</p>`;
    return;
  }

  const errored = Object.entries(data.bySymbol).filter(([, v]) => v.error);

  container.innerHTML = `
    <h2>Insider Activity</h2>
    <p class="muted">Officer/director Form 4 transactions across the fund's holdings, last available window (Finnhub).</p>
    <section class="summary">
      <div class="stat">
        <div class="label">Net Insider Shares</div>
        <div class="value ${data.netShares >= 0 ? "gain-pos" : "gain-neg"}">${data.netShares >= 0 ? "+" : ""}${fmtNum(Math.round(data.netShares))}</div>
      </div>
      <div class="stat">
        <div class="label">Net Insider Value</div>
        <div class="value ${data.netValue >= 0 ? "gain-pos" : "gain-neg"}">${fmtUSD(data.netValue)}</div>
      </div>
    </section>

    ${errored.length ? `<p class="muted small" style="padding:0 28px">No data for: ${errored.map(([s]) => s).join(", ")}</p>` : ""}

    <section class="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Ticker</th><th class="left">Insider</th><th>Shares Δ</th><th>Price</th><th>Code</th></tr>
        </thead>
        <tbody>
          ${data.recent.map((t) => `
            <tr>
              <td>${t.transactionDate || "—"}</td>
              <td><a class="symbol-cell" href="#/research/${t.symbol}">${t.symbol}</a></td>
              <td class="left">${t.name || "—"}</td>
              <td class="${(t.change ?? 0) >= 0 ? "gain-pos" : "gain-neg"}">${t.change !== undefined ? (t.change >= 0 ? "+" : "") + fmtNum(t.change) : "—"}</td>
              <td>${t.transactionPrice ? fmtUSD(t.transactionPrice) : "—"}</td>
              <td>${t.transactionCode || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${!data.recent.length ? `<p class="muted">No insider transactions found in the cached window.</p>` : ""}
    </section>
  `;
}
