import { esc, api, fmtMoneyCompact, fmtPct, fmtNum, signed, pageHead, subTabs, skeleton, errorState, bindRetry, can, toast } from "../shared.js";
import { MARKET_TABS } from "./insiders.js";
import { lineChart } from "../charts.js";

const state = { cik: null };

function weightCell(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(iso, plusDays = 0) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export function quarterLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return `Q${Math.ceil(m / 3)} '${String(y).slice(2)}`;
}

// Net buyers = (filers that added − filers that cut) ÷ (both), among filers that reported both
// quarters. Under 20 filers changing their position, the reading is dimmed: too few to mean much.
const MIN_FILERS = 20;
export function netCell(b) {
  if (!b || b.netPct == null) return `<span class="muted">—</span>`;
  const n = b.buyers + b.sellers;
  const v = Math.round(b.netPct * 100);
  const txt = signed(v, `${v > 0 ? "+" : ""}${v}%`);
  return n < MIN_FILERS ? `<span class="thin-sample" title="Only ${n} filers changed their position">${txt}</span>` : txt;
}

export const BREADTH_NOTE = `Net buyers counts filers, not dollars: (filers that added shares − filers that cut) ÷ (both), using only filers that reported both quarters. A change within ±1% counts as unchanged, and stock splits are adjusted for. Size is each filer's total 13F value: small under $1B, mid $1B to $20B, large $20B and up. Dimmed readings rest on fewer than ${MIN_FILERS} filers. Early filers are mostly small advisers, and there's no evidence yet that their read predicts what the big funds report later.`;

async function renderSeason(container) {
  const box = document.getElementById("seasonBody");
  if (!box) return;
  let s;
  try {
    s = await api("/api/13f/season");
  } catch (err) {
    box.innerHTML = errorState({ title: "Couldn't load the filing season.", detail: err.message, retryId: "season" });
    bindRetry(box, "season", () => renderSeason(container));
    return;
  }
  if (!document.getElementById("seasonBody")) return;
  const se = s.season;
  const left = se.daysToDeadline > 1 ? `${se.daysToDeadline} days left` : se.daysToDeadline === 1 ? "Tomorrow" : se.daysToDeadline === 0 ? "Today" : "Passed; late filings still arrive";
  const lastCheck = s.ingest.lastRunAt ? `Last checked ${new Date(s.ingest.lastRunAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Background check hasn't run yet";
  box.innerHTML = `
    <section class="summary" aria-label="Filing season summary">
      <div class="stat"><div class="label">Quarter being filed</div><div class="value">${esc(se.label)}</div><div class="sub">Positions as of ${esc(dayLabel(se.period))}</div></div>
      <div class="stat"><div class="label">Deadline</div><div class="value">${esc(dayLabel(se.deadline))}</div><div class="sub">${esc(left)}</div></div>
      <div class="stat"><div class="label">Filers read so far</div><div class="value">${fmtNum(s.filed)}</div><div class="sub">vs ${fmtNum(s.priorTotal)} for ${esc(quarterLabel(se.prior))}</div></div>
      <div class="stat"><div class="label">Waiting to be read</div><div class="value">${fmtNum(s.queue.pending)}</div><div class="sub">${esc(lastCheck)}</div></div>
    </section>
    <div class="chart-box"><canvas id="seasonChart" role="img" aria-label="${esc(`Cumulative 13F filers by day after quarter end: ${fmtNum(s.filed)} so far for ${se.label}, against ${fmtNum(s.priorTotal)} in total for ${quarterLabel(se.prior)}.`)}"></canvas></div>
    <p class="muted small">Dates are for ${esc(se.label)}; last quarter's line is shifted to the same number of days after its quarter end. Most big managers file in the last few days before the deadline.</p>
    <h4>Managers the fund follows</h4>
    ${s.following.length ? `<ul class="link-list small">${s.following.map((m) => `<li>${esc(m.name || m.cik)}: ${m.filing ? `filed ${esc(dayLabel(m.filing.filedAt))}, ${fmtMoneyCompact(m.filing.totalValue)} reported` : `<span class="muted">not filed yet</span>`}</li>`).join("")}</ul>`
      : `<p class="muted small">None yet. Follow a manager below or on the <a href="#/settings">Settings</a> page and members get a notification the moment its 13F is read.</p>`}
    <h4>Largest filers in so far</h4>
    ${s.biggest.length ? `<div class="table-scroll"><table class="mini-table">
      <caption class="sr-only">Largest 13F filers read so far for ${esc(se.label)}</caption>
      <thead><tr><th scope="col">Manager</th><th scope="col" class="num">Reported</th><th scope="col">Filed</th><th scope="col" class="num">Our names held</th><th scope="col"><span class="sr-only">Follow</span></th></tr></thead>
      <tbody>${s.biggest.map((f) => `<tr><td>${esc(f.name || f.cik)}</td><td class="num">${fmtMoneyCompact(f.totalValue)}</td><td>${esc(dayLabel(f.filedAt))}</td><td class="num">${f.holdsOurs}</td>
        <td>${f.following ? `<span class="badge badge-owned">Following</span>` : can("member") ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-cik="${esc(f.cik)}" data-follow-name="${esc(f.name)}">Follow</button>` : ""}</td></tr>`).join("")}</tbody>
    </table></div>` : `<p class="muted small">No ${esc(se.label)} filings read yet.</p>`}`;

  lineChart(document.getElementById("seasonChart"), {
    labels: s.curve.days.map((d) => dayLabel(se.period, d)),
    datasets: [
      { label: `${se.label} (read so far)`, data: s.curve.current },
      { label: `${quarterLabel(se.prior)} (all filers)`, data: s.curve.prior, color: "--muted", dash: [4, 4] },
    ],
    yFormat: (v) => fmtNum(Math.round(v)),
    legend: true,
  });
  box.querySelectorAll("[data-follow-cik]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await api("/api/13f/managers", { method: "POST", body: JSON.stringify({ cik: b.dataset.followCik, name: b.dataset.followName }) });
      toast(`Following ${b.dataset.followName}.`, { type: "success" });
      mount(container);
    } catch (err) {
      b.disabled = false;
      toast(err.message, { type: "error" });
    }
  }));
}

async function renderBreadth() {
  const box = document.getElementById("breadthBody");
  if (!box) return;
  let r;
  try {
    r = await api("/api/13f/breadth");
  } catch (err) {
    box.innerHTML = errorState({ title: "Couldn't load 13F breadth.", detail: err.message, retryId: "breadth" });
    bindRetry(box, "breadth", renderBreadth);
    return;
  }
  if (!document.getElementById("breadthBody")) return;
  const se = r.season;
  const tracked = r.rows.filter((x) => x.tracked).sort((a, b) => (b.now?.netPct ?? -2) - (a.now?.netPct ?? -2) || (b.last?.netPct ?? -2) - (a.last?.netPct ?? -2));
  const untracked = r.rows.filter((x) => !x.tracked);
  const compared = (b) => (b ? b.buyers + b.sellers + b.unchanged : 0);
  box.innerHTML = `
    <div class="table-scroll"><table class="mini-table">
      <caption class="sr-only">Net 13F buyers of the fund's holdings and watchlist, ${esc(se.label)} so far and ${esc(quarterLabel(se.prior))}</caption>
      <thead>
        <tr><th scope="col" rowspan="2">Ticker</th><th scope="colgroup" colspan="6">${esc(se.label)} so far</th><th scope="col" rowspan="2" class="num">${esc(quarterLabel(se.prior))} net (all filers)</th></tr>
        <tr><th scope="col" class="num">Filers compared</th><th scope="col" class="num">Added / cut</th><th scope="col" class="num">Net buyers</th><th scope="col" class="num">Small</th><th scope="col" class="num">Mid</th><th scope="col" class="num">Large</th></tr>
      </thead>
      <tbody>${tracked.map((x) => `<tr>
        <td><a class="symbol-cell" href="#/research/${encodeURIComponent(x.symbol)}/ownership">${esc(x.symbol)}</a> ${x.owned ? `<span class="badge badge-owned">Owned</span>` : `<span class="badge badge-watch">Watching</span>`}</td>
        <td class="num">${x.now ? fmtNum(compared(x.now)) : "—"}</td>
        <td class="num">${x.now ? `${fmtNum(x.now.buyers)} / ${fmtNum(x.now.sellers)}` : "—"}</td>
        <td class="num">${netCell(x.now)}</td>
        <td class="num">${netCell(x.now?.bySize.small)}</td><td class="num">${netCell(x.now?.bySize.mid)}</td><td class="num">${netCell(x.now?.bySize.large)}</td>
        <td class="num">${netCell(x.last)}</td></tr>`).join("")}
      ${untracked.map((x) => `<tr class="row-dim"><td>${esc(x.symbol)}</td><td colspan="7" class="small">No CUSIP on file yet (add it to lib/seed/13fCusips.json)</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small">${BREADTH_NOTE}</p>`;
}

async function loadManager(container) {
  const box = document.getElementById("13fBody");
  if (!box || !state.cik) return;
  box.innerHTML = skeleton("rows", { rows: 6, label: "Fetching the latest 13F information table from EDGAR" });
  let r;
  try {
    r = await api(`/api/13f/${state.cik}`);
  } catch (err) {
    box.innerHTML = errorState({ title: "Couldn't load this manager's 13F.", detail: err.message, retryId: "load" });
    bindRetry(box, "load", () => loadManager(container));
    return;
  }
  if (!document.getElementById("13fBody")) return;
  if (!r.available) { box.innerHTML = `<p class="muted">${esc(r.reason || r.error || "No data available.")}</p>`; return; }
  const latest = r.filings[0];
  box.innerHTML = `
    <p class="muted small">${esc(r.companyName || "")}: period ${esc(latest.periodOfReport)}, filed ${esc(latest.filingDate)}. 13F filings lag reality by up to ~45 days.</p>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="conv-h">
        <div class="panel-head"><h3 id="conv-h">Highest-conviction positions</h3><span class="muted small">By weight within this manager's own 13F book</span></div>
        <div class="table-scroll"><table class="mini-table">
          <thead><tr><th scope="col">Issuer</th><th scope="col">CUSIP</th><th scope="col" class="num">Value</th><th scope="col" class="num">Weight</th></tr></thead>
          <tbody>${r.conviction.map((h) => `<tr><td>${esc(h.nameOfIssuer)}</td><td class="muted small">${esc(h.cusip)}</td><td class="num">${fmtMoneyCompact(h.value)}</td><td class="num">${weightCell(h.weightPct)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No holdings parsed.</td></tr>`}</tbody>
        </table></div>
        <p class="muted small">A true "overweight vs the market" measure (Cohen, Polk &amp; Silli) needs each stock's market-cap weight too, which free EDGAR data doesn't provide. This instead shows where the manager is concentrated within their own reported portfolio.</p>
      </section>
      <section class="panel span-full" aria-labelledby="ovl-h">
        <h3 id="ovl-h">Overlap with our holdings &amp; watchlist</h3>
        ${r.overlaps.length ? `
          <ul class="link-list">${r.overlaps.map((h) => `<li><a class="symbol-cell" href="#/research/${encodeURIComponent(h.matchedSymbol)}">${esc(h.matchedSymbol)}</a>: ${esc(h.nameOfIssuer)}, ${weightCell(h.weightPct)} of this manager's book ${h.owned ? `<span class="badge badge-owned">Owned</span>` : h.watching ? `<span class="badge badge-watch">Watching</span>` : ""}</li>`).join("")}</ul>`
          : `<p class="muted small">No overlap with the fund's holdings or watchlist by company name.</p>`}
      </section>
      ${r.changes ? `
      <section class="panel span-full" aria-labelledby="chg-h">
        <h3 id="chg-h">Biggest quarter-over-quarter changes</h3>
        <div class="table-scroll"><table class="mini-table">
          <thead><tr><th scope="col">Issuer</th><th scope="col" class="num">Weight now</th><th scope="col" class="num">Weight prior qtr</th><th scope="col" class="num">Change</th></tr></thead>
          <tbody>${r.changes.map((h) => `<tr><td>${esc(h.nameOfIssuer)}${h.isNew ? ` <span class="badge badge-watch">New</span>` : ""}</td><td class="num">${weightCell(h.weightPct)}</td><td class="num">${h.priorWeightPct != null ? weightCell(h.priorWeightPct) : "—"}</td><td class="num">${signed(h.weightChangePct * 100, fmtPct(h.weightChangePct * 100))}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>` : `<p class="muted page-pad small">Only one 13F-HR on file. No quarter-over-quarter comparison yet.</p>`}
    </div>`;
}

async function renderManagers(container) {
  const area = document.getElementById("managerArea");
  if (!area) return;
  let managers;
  try {
    managers = await api("/api/13f/managers");
  } catch (err) {
    area.innerHTML = `<div class="page-pad">${errorState({ title: "Couldn't load followed managers.", detail: err.message, retryId: "page" })}</div>`;
    bindRetry(area, "page", () => renderManagers(container));
    return;
  }
  if (!document.getElementById("managerArea")) return;
  if (!managers.length) {
    area.innerHTML = `<p class="muted page-pad">No managers followed yet. Follow one from the list above, or add one by name or CIK on the <a href="#/settings">Settings</a> page.</p>`;
    return;
  }
  state.cik = state.cik && managers.some((m) => m.cik === state.cik) ? state.cik : managers[0].cik;
  area.innerHTML = `
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

export const title = "13F tracker";

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/13f") +
    pageHead("13F tracker", "Every 13F-HR filed on EDGAR, read within minutes of filing: how institutions as a group changed the fund's holdings this quarter, plus the full books of managers the fund follows. Positions are as of quarter end, filed up to 45 days later.") + `
    <section class="panel page-pad-panel" aria-labelledby="season-h">
      <div class="panel-head"><h3 id="season-h">Filing season</h3><span class="muted small">EDGAR checked every 5 minutes</span></div>
      <div id="seasonBody">${skeleton("rows", { rows: 4, label: "Loading the filing season" })}</div>
    </section>
    <section class="panel page-pad-panel" aria-labelledby="breadth-h">
      <div class="panel-head"><h3 id="breadth-h">Our holdings in the 13F crowd</h3><span class="muted small">Every filer, not just the ones we follow</span></div>
      <div id="breadthBody">${skeleton("rows", { rows: 8, label: "Counting 13F buyers and sellers" })}</div>
    </section>
    <div id="managerArea"></div>`;
  renderSeason(container);
  renderBreadth();
  renderManagers(container);
}
