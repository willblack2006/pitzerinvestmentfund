import { esc, api, pageHead, loading, errorBox, subTabs, sortHeader, sortRows, bindSort } from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";
import { barChart } from "../charts.js";
import { GLOSSARY, term } from "../glossary.js";

const DEF_KEY = { value: "valueFactor", momentum: "momentum121", quality: "qualityFactor", lowVol: "lowVolFactor", size: "sizeFactor" };

const FACTORS = [["value", "Value"], ["momentum", "Momentum"], ["quality", "Quality"], ["lowVol", "Low volatility"], ["size", "Size (bigger →)"]];

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
  // No green/red: a high percentile means "more of this trait", not "good".
  return `<td class="num">${v >= 70 || v <= 30 ? `<strong>${pct(v)}</strong>` : pct(v)}</td>`;
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
      <div class="chart-box chart-sm"><canvas id="tiltChart" role="img" aria-label="${esc(`Fund factor tilt, percentile minus 50: ${FACTORS.map(([k, l]) => `${l} ${pct(t[k])} (${tiltLabel(t[k]).toLowerCase()})`).join("; ")}.`)}"></canvas></div>
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
    <p class="muted small">Percentiles compare each stock with the fund's own ~${r.rows.length} holdings and watchlist names, not the whole market (fetching a market-wide universe live is too slow). 100 = the most of that trait in this group (cheapest, strongest momentum, highest quality, calmest, biggest), 50 = middle.</p>
    <details class="explainer small"><summary>What each factor measures</summary><dl class="glossary-list">${FACTORS.map(([k]) => `<dt>${esc(GLOSSARY[DEF_KEY[k]][0])}</dt><dd>${esc(GLOSSARY[DEF_KEY[k]][1])}</dd>`).join("")}</dl></details>`;
  if (t) {
    barChart(document.getElementById("tiltChart"), {
      labels: FACTORS.map(([, l]) => l),
      datasets: [{ label: "Tilt vs middle of group (percentile − 50)", data: FACTORS.map(([k]) => (Number.isFinite(t[k]) ? Math.round(t[k] - 50) : null)), color: "--s1" }],
      horizontal: true, legend: false,
    });
  }
  renderRows(r.rows);
}

function renderRows(rows) {
  const thead = document.getElementById("factorsThead");
  if (!thead) return;
  const s = state.sort;
  thead.innerHTML = `<tr>
    ${sortHeader("symbol", "Ticker", s, { align: "left" })}
    ${FACTORS.map(([k, label]) => sortHeader(k, label, s, { after: term(DEF_KEY[k], "") })).join("")}
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
