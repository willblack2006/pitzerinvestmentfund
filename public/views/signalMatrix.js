// #/signals/matrix (WS10): every holding (or watchlist name) against every signal the app
// computes, as one heatmap. Green leans supportive, red is a warning, grey is neutral, blank is
// no data. Sort by any column; a cell opens the Research tab that explains it.
import { api, esc, pageHead, skeleton, errorState, bindRetry } from "../shared.js";
import { divergingFill, tooltip } from "../viz/rv.js";

export const title = "Signal matrix";

// Which Research tab explains each signal.
const TAB = { momentum: "", vsVol: "", revisions: "street", insider: "ownership", short: "risk", crowding: "risk", valuation: "valuation", thesis: "thesis" };
let state = { scope: "holdings", sort: "summary", dir: -1 };
try { Object.assign(state, JSON.parse(sessionStorage.getItem("pif_signal_matrix") || "{}")); } catch { /* defaults */ }
const save = () => { try { sessionStorage.setItem("pif_signal_matrix", JSON.stringify(state)); } catch { /* private mode */ } };

const cellText = (c) => (c.score === null ? "—" : `${c.score > 0.05 ? "▲" : c.score < -0.05 ? "▼" : "•"} ${Math.round(Math.abs(c.score) * 100)}`);
const word = (s) => (s === null ? "no data" : s >= 0.5 ? "strongly supportive" : s >= 0.15 ? "supportive" : s > -0.15 ? "neutral" : s > -0.5 ? "a warning" : "a strong warning");

export async function mount(c) {
  c.innerHTML = `${pageHead("Signal matrix", "Every holding against every signal the app tracks. Green leans supportive, red is a warning, grey is neutral. Hover or focus a cell for the reason; click it to open the detail.")}
    <div id="smBody">${skeleton("rows", { rows: 8, label: "Scoring signals across holdings" })}</div>`;
  await load(c);
}

async function load(c) {
  const box = c.querySelector("#smBody");
  let d;
  try {
    d = await api(`/api/signal-matrix?scope=${state.scope}`);
  } catch (err) {
    box.innerHTML = errorState({ title: "Couldn't load the signal matrix.", detail: err.message, retryId: "sm" });
    bindRetry(box, "sm", () => load(c));
    return;
  }
  render(box, d, c);
}

function render(box, d, c) {
  const sigs = d.signals;
  const rows = d.rows.slice().sort((a, b) => {
    const va = state.sort === "symbol" ? a.symbol : state.sort === "summary" ? a.summary : a.cells[state.sort]?.score;
    const vb = state.sort === "symbol" ? b.symbol : state.sort === "summary" ? b.summary : b.cells[state.sort]?.score;
    if (va === vb) return a.symbol.localeCompare(b.symbol);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va < vb ? -1 : 1) * (state.sort === "symbol" ? 1 : state.dir);
  });
  const warn = d.rows.filter((r) => r.warnings.length >= 2).map((r) => r.symbol);
  const sortBtn = (key, label, help = "") => {
    const on = state.sort === key;
    return `<th scope="col" class="${key === "symbol" ? "left" : "num"}" aria-sort="${on ? (state.dir < 0 && key !== "symbol" ? "descending" : "ascending") : "none"}"><button type="button" class="sort-btn" data-sort="${key}" title="${esc(help)}">${esc(label)}${on ? (state.dir < 0 && key !== "symbol" ? " ↓" : " ↑") : ""}</button></th>`;
  };
  box.innerHTML = `
    <div class="sm-controls">
      <div class="rv-seg" role="group" aria-label="Which names">
        ${[["holdings", "Holdings"], ["watchlist", "Watchlist"], ["all", "Both"]].map(([k, l]) => `<button type="button" class="rv-seg-btn" data-scope="${k}" aria-pressed="${state.scope === k}">${l}</button>`).join("")}
      </div>
      <div class="rv-scale" aria-hidden="true"><span>Warning</span><i style="background:${divergingFill(-1)}"></i><i style="background:${divergingFill(-0.5)}"></i><i style="background:${divergingFill(0)}"></i><i style="background:${divergingFill(0.5)}"></i><i style="background:${divergingFill(1)}"></i><span>Supportive</span></div>
      <span class="muted small">Updated ${esc(new Date(d.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span>
    </div>
    ${warn.length ? `<p class="notice small">Two or more strong warnings: ${warn.map((s) => `<a href="#/research/${encodeURIComponent(s)}">${esc(s)}</a>`).join(", ")}.</p>` : ""}
    ${rows.length ? `<div class="table-scroll sm-scroll" id="smGrid">
      <table class="sm-table table-sticky-first">
        <caption class="sr-only">Signals by ${state.scope === "watchlist" ? "watchlist name" : "holding"}. Each cell is a score from −100 (strong warning) to +100 (strongly supportive).</caption>
        <thead><tr>${sortBtn("symbol", "Ticker")}${sortBtn("summary", "Overall", "Weighted average of the signals with data")}${sigs.map((s) => sortBtn(s.key, s.label, s.help)).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a>${r.owned && state.scope !== "holdings" ? ` <span class="muted small">owned</span>` : ""}</th>
          ${cell(r.symbol, "summary", { score: r.summary, text: `Overall: ${word(r.summary)} (${Math.round(r.coverage * sigs.length)} of ${sigs.length} signals have data)` }, "Overall")}
          ${sigs.map((s) => cell(r.symbol, s.key, r.cells[s.key], s.label)).join("")}
        </tr>`).join("")}</tbody>
      </table>
    </div>` : `<p class="muted">No ${state.scope === "watchlist" ? "watchlist names" : "holdings"} to score yet.</p>`}
    <details class="explainer small"><summary>How each signal is scored</summary><ul>${sigs.map((s) => `<li><strong>${esc(s.label)}</strong>: ${esc(s.help)}.</li>`).join("")}</ul>
    <p>Overall weights thesis health, revisions and momentum more than one-day reads. These are prompts for a closer look, not buy or sell calls.</p></details>`;
  box.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { state.scope = b.dataset.scope; save(); box.innerHTML = skeleton("rows", { rows: 8, label: "Scoring signals" }); load(c); }));
  box.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.sort;
    if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
    save();
    render(box, d, c);
    box.querySelector(`[data-sort="${k}"]`)?.focus();
  }));
  tooltip(box.querySelector("#smGrid"));
}

function cell(symbol, key, c, label) {
  const tab = key === "summary" ? "" : TAB[key];
  const href = `#/research/${encodeURIComponent(symbol)}${tab ? `/${tab}` : ""}`;
  const tip = `<strong>${esc(symbol)} · ${esc(label)}</strong><br>${c.score === null ? "No data" : `${word(c.score)} (${c.score > 0 ? "+" : ""}${Math.round(c.score * 100)})`}${c.text ? `<br>${esc(c.text)}` : ""}`;
  return `<td class="sm-cell${c.score === null ? " sm-na" : ""}${key === "summary" ? " sm-summary" : ""}" style="--fill:${divergingFill(c.score)}">
    <a href="${href}" data-tip="${esc(tip)}" aria-label="${esc(`${symbol} ${label}: ${c.score === null ? "no data" : `${word(c.score)}, ${Math.round(c.score * 100)}`}. ${c.text || ""}`)}">${cellText(c)}</a></td>`;
}
