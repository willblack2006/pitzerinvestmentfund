import { esc, fmtUSD, fmtNum, api, signed, pageHead, loading, errorBox, subTabs } from "../shared.js";

export const title = "Insider activity";

// SEC Form 4 transaction codes — plain-language labels so members don't need to look them up.
const CODES = {
  P: "Open-market buy",
  S: "Open-market sale",
  M: "Option exercise",
  A: "Grant / award",
  F: "Tax withholding",
  G: "Gift",
  D: "Returned to company",
  C: "Conversion",
  X: "Option exercise",
  J: "Other",
};
export const insiderCodeLabel = (code) => CODES[code] || "Other";

// Only discretionary open-market trades get buy/sell coloring; grants, exercises and tax
// withholding are compensation mechanics and are shown neutrally.
export function insiderShares(t) {
  if (t.change === undefined || t.change === null) return `<span class="muted">—</span>`;
  if (t.transactionCode === "P" || t.transactionCode === "S") return signed(t.change, fmtNum(t.change));
  return `<span class="muted">${t.change > 0 ? "+" : ""}${fmtNum(t.change)}</span>`;
}

export const MARKET_TABS = [["#/macro", "Macro backdrop"], ["#/insiders", "Insider activity"]];

const state = { data: null, symbol: "", signalsOnly: true };

function renderRows() {
  const tbody = document.getElementById("insTbody");
  if (!tbody) return;
  let rows = state.data.recent;
  if (state.signalsOnly) rows = rows.filter((t) => t.transactionCode === "P" || t.transactionCode === "S");
  if (state.symbol) rows = rows.filter((t) => t.symbol === state.symbol);
  tbody.innerHTML = rows.map((t) => `
    <tr>
      <td class="left">${esc(t.transactionDate || "—")}</td>
      <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(t.symbol)}">${esc(t.symbol)}</a></th>
      <td class="left">${esc(t.name || "—")}</td>
      <td class="left"><span class="code-pill code-${esc(t.transactionCode || "x")}">${esc(t.transactionCode || "—")}</span> ${esc(insiderCodeLabel(t.transactionCode))}</td>
      <td>${insiderShares(t)}</td>
      <td>${t.transactionPrice ? fmtUSD(t.transactionPrice) : `<span class="muted">—</span>`}</td>
    </tr>`).join("");
  document.getElementById("insEmpty").innerHTML = rows.length
    ? ""
    : `<p class="empty">No ${state.signalsOnly ? "open-market buys or sales" : "transactions"}${state.symbol ? ` for ${esc(state.symbol)}` : ""} in the recent window.${state.signalsOnly ? ` <button type="button" class="btn-link" id="showAll">Show all transaction types</button>` : ""}</p>`;
  document.getElementById("showAll")?.addEventListener("click", () => {
    state.signalsOnly = false;
    document.getElementById("signalsOnly").checked = false;
    renderRows();
  });
  document.getElementById("insCount").textContent = `${rows.length} transactions shown`;
}

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/insiders") + loading("Pulling SEC Form 4 insider filings across the fund's holdings… this can take a few seconds the first time.");

  try {
    state.data = await api("/api/insiders");
  } catch (err) {
    container.innerHTML = subTabs(MARKET_TABS, "#/insiders") + pageHead("Insider activity") + errorBox(`Could not load insider activity: ${err.message}`);
    return;
  }
  const data = state.data;
  const errored = Object.entries(data.bySymbol).filter(([, v]) => v.error);
  const symbols = [...new Set(data.recent.map((t) => t.symbol))].sort();
  if (!symbols.includes(state.symbol)) state.symbol = "";

  container.innerHTML = `
    ${subTabs(MARKET_TABS, "#/insiders")}
    ${pageHead("Insider activity", `What officers and directors at our ${data.holdingsCount} holdings are doing with their own shares (SEC Form 4, via Finnhub).`)}

    <section class="summary" aria-label="Insider summary">
      <div class="stat"><div class="label">Open-market buys</div><div class="value">${data.buys}</div><div class="sub">code P — the strongest signal</div></div>
      <div class="stat"><div class="label">Open-market sales</div><div class="value">${data.sells}</div><div class="sub">code S — often routine (diversification, taxes)</div></div>
      <div class="stat"><div class="label">Net buy/sell value</div><div class="value">${signed(data.netValue, fmtUSD(data.netValue))}</div><div class="sub">buys minus sales only</div></div>
    </section>

    <details class="explainer page-pad">
      <summary>How to read this page</summary>
      <p class="small">Insiders <strong>buying</strong> on the open market (P) is rare and usually meaningful. Sales (S) are common and often pre-scheduled.
      Grants (A), option exercises (M) and tax withholding (F) are compensation mechanics, not opinions — they're hidden by default.</p>
    </details>

    <section class="toolbar">
      <div class="field-inline">
        <label for="insSymbol">Ticker</label>
        <select id="insSymbol">
          <option value="">All holdings</option>
          ${symbols.map((s) => `<option ${s === state.symbol ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
        <label class="check"><input type="checkbox" id="signalsOnly" ${state.signalsOnly ? "checked" : ""} /> Buys &amp; sales only</label>
        <span id="insCount" class="muted small" role="status"></span>
      </div>
    </section>

    ${errored.length ? `<p class="muted small page-pad">No data available for: ${errored.map(([s]) => esc(s)).join(", ")}</p>` : ""}

    <section class="table-wrap">
      <table>
        <caption class="sr-only">Recent insider transactions, newest first</caption>
        <thead>
          <tr><th scope="col" class="left">Date</th><th scope="col" class="left">Ticker</th><th scope="col" class="left">Insider</th><th scope="col" class="left">Type</th><th scope="col">Shares</th><th scope="col">Price</th></tr>
        </thead>
        <tbody id="insTbody"></tbody>
      </table>
      <div id="insEmpty"></div>
    </section>
  `;

  renderRows();
  document.getElementById("insSymbol").addEventListener("change", (e) => { state.symbol = e.target.value; renderRows(); });
  document.getElementById("signalsOnly").addEventListener("change", (e) => { state.signalsOnly = e.target.checked; renderRows(); });
}
