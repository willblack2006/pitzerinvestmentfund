import { esc, api, pageHead, loading, errorBox, subTabs, sortHeader, sortRows, bindSort } from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";

const FACTORS = [["value", "Value"], ["momentum", "Momentum"], ["quality", "Quality"], ["lowVol", "Low volatility"], ["size", "Size"]];

const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}` : "—");
const tiltLabel = (v) => {
  if (!Number.isFinite(v)) return "—";
  if (v >= 65) return "Strong tilt";
  if (v >= 55) return "Mild tilt";
  if (v <= 35) return "Strong tilt (low)";
  if (v <= 45) return "Mild tilt (low)";
  return "Neutral";
};

function cell(v) {
  if (!Number.isFinite(v)) return `<td class="num muted">—</td>`;
  const tone = v >= 70 ? "tone-good" : v <= 30 ? "tone-bad" : "";
  return `<td class="num"><span class="${tone}">${pct(v)}</span></td>`;
}

const state = { scope: "all", sort: { key: "value", dir: "desc" } };

async function load(container) {
  const box = document.getElementById("factorsBody");
  if (!box) return;
  box.innerHTML = loading("Scoring value, momentum, quality, low-volatility and size — this pulls fundamentals and price history for each stock, so first load can take a while.");
  let r;
  try {
    r = await api(`/api/factors?scope=${state.scope}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load factor scores: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById("factorsBody")) return;
  const t = r.tilt;
  box.innerHTML = `
    ${t ? `
      <section class="summary" aria-label="Fund factor tilt vs neutral">
        ${FACTORS.map(([k, label]) => `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${pct(t[k])}</div><div class="sub">${esc(tiltLabel(t[k]))}</div></div>`).join("")}
      </section>
      <p class="muted small">The fund's holdings, weighted by position size, averaged within each factor's percentile (50 = neutral vs the rest of this universe). ${(() => {
        const entries = FACTORS.filter(([k]) => Number.isFinite(t[k]));
        if (!entries.length) return "";
        const [topKey, topLabel] = entries.reduce((a, b) => (Math.abs(t[b[0]] - 50) > Math.abs(t[a[0]] - 50) ? b : a));
        const v = t[topKey];
        return Math.abs(v - 50) >= 10 ? `Biggest tilt: <strong>${esc(topLabel.toLowerCase())}</strong> (${v >= 50 ? "high" : "low"}) — the fund looks like a ${topLabel.toLowerCase()}${v < 50 ? "-avoiding" : ""} bet relative to its own universe.` : "No strong factor tilt right now.";
      })()}</p>` : ""}
    <div class="table-scroll"><table class="mini-table" id="factorsTable">
      <caption class="sr-only">Factor percentiles by stock, 0-100 within this universe</caption>
      <thead id="factorsThead"></thead>
      <tbody id="factorsTbody"></tbody>
    </table></div>
    <p class="muted small">Percentiles are ranked within the fund's holdings + watchlist (a full market universe is too costly to fetch live). 100 = best in this group for that factor, 0 = worst, 50 = neutral.</p>`;
  renderRows(r.rows);
}

function renderRows(rows) {
  const thead = document.getElementById("factorsThead");
  if (!thead) return;
  const s = state.sort;
  thead.innerHTML = `<tr>
    ${sortHeader("symbol", "Ticker", s, { align: "left" })}
    ${FACTORS.map(([k, label]) => sortHeader(k, label, s)).join("")}
  </tr>`;
  const sorted = sortRows(rows, s);
  document.getElementById("factorsTbody").innerHTML = sorted.map((r) => `
    <tr>
      <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}/valuation">${esc(r.symbol)}</a>${r.owned ? "" : ` <span class="badge badge-watch">Watch</span>`}</th>
      ${FACTORS.map(([k]) => cell(r[k])).join("")}
    </tr>`).join("") || `<tr><td colspan="${FACTORS.length + 1}" class="muted">No stocks in this scope.</td></tr>`;
  bindSort(document.getElementById("factorsTable"), state.sort, () => renderRows(rows));
}

export const title = "Factors";

export async function mount(container) {
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/factors") +
    pageHead("Factor scorecard", "Value, momentum, quality, low-volatility and size — each holding and watchlist name ranked against the rest of this group, plus the fund's overall tilt.");
  container.innerHTML += `
    <section class="panel page-pad-panel" aria-labelledby="fac-h">
      <div class="panel-head">
        <h3 id="fac-h">Percentile scores</h3>
        <div class="seg seg-sm" role="group" aria-label="Which stocks">
          ${[["all", "Holdings + watchlist"], ["holdings", "Holdings"], ["watchlist", "Watchlist"]].map(([v, l]) => `<button type="button" class="seg-btn" data-scope="${v}" aria-pressed="${state.scope === v}">${l}</button>`).join("")}
        </div>
      </div>
      <div id="factorsBody"></div>
    </section>`;
  load(container);
  container.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
    state.scope = b.dataset.scope;
    container.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load(container);
  }));
}
