import { esc, api, fmtMoneyCompact, fmtPct, signed, pageHead, loading, subTabs } from "../shared.js";
import { MARKET_TABS } from "./insiders.js";

const state = { cik: null };

function weightCell(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
}

async function loadManager(container) {
  const box = document.getElementById("13fBody");
  if (!box || !state.cik) return;
  box.innerHTML = loading("Fetching the latest 13F information table from EDGAR…");
  let r;
  try {
    r = await api(`/api/13f/${state.cik}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load this manager's 13F: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById("13fBody")) return;
  if (!r.available) { box.innerHTML = `<p class="muted">${esc(r.reason || r.error || "No data available.")}</p>`; return; }
  const latest = r.filings[0];
  box.innerHTML = `
    <p class="muted small">${esc(r.companyName || "")} — period ${esc(latest.periodOfReport)}, filed ${esc(latest.filingDate)}. 13F filings lag reality by up to ~45 days.</p>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="conv-h">
        <div class="panel-head"><h3 id="conv-h">Highest-conviction positions</h3><span class="muted small">By weight within this manager's own 13F book</span></div>
        <div class="table-scroll"><table class="mini-table">
          <thead><tr><th scope="col">Issuer</th><th scope="col">CUSIP</th><th scope="col" class="num">Value</th><th scope="col" class="num">Weight</th></tr></thead>
          <tbody>${r.conviction.map((h) => `<tr><td>${esc(h.nameOfIssuer)}</td><td class="muted small">${esc(h.cusip)}</td><td class="num">${fmtMoneyCompact(h.value)}</td><td class="num">${weightCell(h.weightPct)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No holdings parsed.</td></tr>`}</tbody>
        </table></div>
        <p class="muted small">A true "overweight vs the market" measure (Cohen, Polk &amp; Silli) needs each stock's market-cap weight too, which free EDGAR data doesn't provide — this instead shows where the manager is concentrated within their own reported portfolio.</p>
      </section>
      <section class="panel span-full" aria-labelledby="ovl-h">
        <h3 id="ovl-h">Overlap with our holdings &amp; watchlist</h3>
        ${r.overlaps.length ? `
          <ul class="link-list">${r.overlaps.map((h) => `<li><a class="symbol-cell" href="#/research/${encodeURIComponent(h.matchedSymbol)}">${esc(h.matchedSymbol)}</a> — ${esc(h.nameOfIssuer)}, ${weightCell(h.weightPct)} of this manager's book ${h.owned ? `<span class="badge badge-owned">Owned</span>` : h.watching ? `<span class="badge badge-watch">Watching</span>` : ""}</li>`).join("")}</ul>`
          : `<p class="muted small">No overlap with the fund's holdings or watchlist by company name.</p>`}
      </section>
      ${r.changes ? `
      <section class="panel span-full" aria-labelledby="chg-h">
        <h3 id="chg-h">Biggest quarter-over-quarter changes</h3>
        <div class="table-scroll"><table class="mini-table">
          <thead><tr><th scope="col">Issuer</th><th scope="col" class="num">Weight now</th><th scope="col" class="num">Weight prior qtr</th><th scope="col" class="num">Change</th></tr></thead>
          <tbody>${r.changes.map((h) => `<tr><td>${esc(h.nameOfIssuer)}${h.isNew ? ` <span class="badge badge-watch">New</span>` : ""}</td><td class="num">${weightCell(h.weightPct)}</td><td class="num">${h.priorWeightPct != null ? weightCell(h.priorWeightPct) : "—"}</td><td class="num">${signed(h.weightChangePct * 100, fmtPct(h.weightChangePct * 100))}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>` : `<p class="muted page-pad small">Only one 13F-HR on file — no quarter-over-quarter comparison yet.</p>`}
    </div>`;
}

export const title = "13F tracker";

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/13f") +
    pageHead("13F \"best ideas\" tracker", "Quarterly equity holdings of managers the fund follows (from EDGAR 13F-HR filings), with ~45-day reporting lag.");
  let managers;
  try {
    managers = await api("/api/13f/managers");
  } catch (err) {
    container.innerHTML += `<p class="muted page-pad">Couldn't load followed managers: ${esc(err.message)}</p>`;
    return;
  }
  if (!managers.length) {
    container.innerHTML += `<p class="muted page-pad">No managers followed yet. Add one by CIK on the <a href="#/settings">Settings</a> page.</p>`;
    return;
  }
  state.cik = state.cik && managers.some((m) => m.cik === state.cik) ? state.cik : managers[0].cik;
  container.innerHTML += `
    <section class="panel page-pad-panel" aria-labelledby="mgr-h">
      <div class="panel-head">
        <h3 id="mgr-h">Manager</h3>
        <label class="sr-only" for="mgrSelect">Choose a manager</label>
        <select id="mgrSelect">${managers.map((m) => `<option value="${esc(m.cik)}" ${m.cik === state.cik ? "selected" : ""}>${esc(m.name || m.cik)}</option>`).join("")}</select>
      </div>
      <div id="13fBody"></div>
    </section>`;
  loadManager(container);
  document.getElementById("mgrSelect").addEventListener("change", (e) => { state.cik = e.target.value; loadManager(container); });
}
