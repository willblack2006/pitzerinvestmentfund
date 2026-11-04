import { esc, api, can, toast, pageHead, loading, subTabs, fmtMoneyCompact, fmtPct, signed, icon, errorState, bindRetry, skeleton } from "../shared.js";

// lastMeeting is the date typed into the box last time; briefSince is what the brief shows now.
let lastMeeting = null;
try { lastMeeting = localStorage.getItem("pif_meeting_since"); } catch { /* ignore */ }
let briefSince = lastMeeting;
const isoDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const STALE_HOURS = 36;

async function loadBrief() {
  const box = document.getElementById("briefBody");
  if (!box) return;
  box.innerHTML = skeleton("rows", { rows: 4, label: "Comparing each holding with its price on that date" });
  let b;
  try {
    b = await api(`/api/meeting-brief${briefSince ? `?since=${briefSince}` : ""}`);
  } catch (err) {
    box.innerHTML = errorState({ title: "Couldn't build the brief.", detail: err.message, retryId: "load" });
    bindRetry(box, "load", () => { box.innerHTML = skeleton("text", { rows: 3, label: "Trying again" }); loadBrief(); });
    return;
  }
  if (!document.getElementById("briefBody")) return;
  document.getElementById("briefSince").value = b.since;
  document.querySelectorAll("[data-brief]").forEach((btn) => {
    const k = btn.dataset.brief;
    btn.setAttribute("aria-pressed", String(b.since === (k === "meeting" ? lastMeeting : isoDaysAgo(Number(k)))));
  });
  const pct = (v) => (v == null ? "—" : signed(v * 100, fmtPct(v * 100)));
  const movers = b.moves.filter((m) => m.changePct != null).slice(0, 6);
  const pitchLink = (p) => `<a href="#/pitches/${p.id}">${esc(p.direction.toUpperCase())} ${esc(p.symbol)}</a>`;
  box.innerHTML = `
    <p class="small">Current holdings since ${esc(b.since)}: <strong>${pct(b.holdingsChangePct)}</strong> <span class="muted">(today's positions; ignores trades made in between)</span></p>
    <div class="table-scroll"><table class="mini-table">
      <caption class="cap">Biggest effects on the fund since then</caption>
      <thead><tr><th scope="col">Ticker</th><th scope="col" class="num">Price move</th><th scope="col" class="num">Effect on fund</th></tr></thead>
      <tbody>${movers.map((m) => `<tr><th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(m.symbol)}">${esc(m.symbol)}</a></th><td class="num">${pct(m.changePct)}</td><td class="num">${pct(m.contributionPct)}</td></tr>`).join("")}</tbody>
    </table></div>
    <ul class="link-list small">
      <li><strong>Open votes:</strong> ${b.voting.map(pitchLink).join(", ") || "none"}</li>
      <li><strong>Approved, not yet executed:</strong> ${b.awaitingExecution.map(pitchLink).join(", ") || "none"}</li>
      <li><strong>Decided since then:</strong> ${b.decidedSince.map((p) => `${pitchLink(p)} (${esc(p.status)})`).join(", ") || "none"}</li>
      <li><strong>Earnings in the next 2 weeks:</strong> ${b.earnings.map((e) => `<a href="#/research/${encodeURIComponent(e.symbol)}/street">${esc(e.symbol)}</a> ${esc(e.date.slice(5))}`).join(", ") || "none"}</li>
    </ul>`;
}
import { PORTFOLIO_TABS } from "./portfolioTabs.js";

export const title = "Alerts";

const ICON_NAME = { price: "target", target: "target", policy: "alert", earnings: "calendar", insider: "user", vote: "vote", short: "arrow-down", revision: "pencil", filingchange: "doc", redflag: "flag", activist: "percent", crowding: "megaphone" };
// Icon HTML per alert type (callers drop these straight into markup).
export const ICON = Object.fromEntries(Object.entries(ICON_NAME).map(([k, n]) => [k, icon(n, { size: 16 })]));
// Each alert opens the research tab whose panel explains it.
export const TAB = { earnings: "/street", revision: "/street", insider: "/ownership", activist: "/ownership", target: "/thesis", short: "/risk", filingchange: "/filings", redflag: "/filings" };

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`;
}

// Attention spikes are explained by the "Attention spikes" panel on Holdings.
export function alertHref(a) {
  return a.pitchId ? `#/pitches/${a.pitchId}` : a.type === "policy" ? "#/allocation" : a.type === "crowding" ? "#/" : a.symbol ? `#/research/${encodeURIComponent(a.symbol)}${TAB[a.type] || ""}` : null;
}

export function alertItem(a) {
  const href = alertHref(a);
  return `<li class="alert-item alert-${esc(a.level)}">
    <span class="alert-icon" aria-hidden="true">${ICON[a.type] || "•"}</span>
    <div><div class="alert-title">${href ? `<a href="${href}">${esc(a.title)}</a>` : esc(a.title)}</div>
    <div class="muted small">${esc(a.detail || "")}</div></div>
    <span class="sr-only">${a.level === "action" ? "Needs action" : "For awareness"}</span>
  </li>`;
}

function signalsStatus(asOf) {
  const refresh = can("member") ? ` <button type="button" class="btn btn-ghost btn-sm" id="refreshSignalsBtn">Refresh signals</button>` : "";
  const ageHours = asOf ? (Date.now() - new Date(asOf).getTime()) / 36e5 : Infinity;
  if (asOf && ageHours <= STALE_HOURS) {
    return `<p class="small muted page-pad" id="signalsStatus">Insider, short-interest, filing, revision and attention signals: updated ${esc(timeAgo(asOf))}.${refresh}</p>`;
  }
  const when = asOf ? `were last updated ${esc(timeAgo(asOf))}` : "have not been computed yet";
  return `<div class="signals-stale" id="signalsStatus" role="status">
    <span class="signals-stale-icon">${icon("alert", { size: 18 })}</span>
    <div><strong>Signals may be out of date.</strong> Insider, short-interest, filing, revision and attention signals ${when}. They refresh when the server's background job runs, so they go stale if the server was off.${refresh}</div>
  </div>`;
}

export async function mount(container) {
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/alerts") + skeleton("rows", { rows: 5, label: "Checking prices, policy limits, earnings dates and insider filings" });
  let alerts, earnings;
  try {
    [alerts, earnings] = await Promise.all([api("/api/alerts"), api("/api/portfolio/earnings")]);
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/alerts") + pageHead("Alerts") + errorState({ title: "Couldn't load alerts.", detail: err.message, retryId: "page" });
    bindRetry(container, "page", () => mount(container));
    return;
  }
  const action = alerts.alerts.filter((a) => a.level === "action");
  const watch = alerts.alerts.filter((a) => a.level === "watch");

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/alerts")}
    ${pageHead("Alerts", "Everything that needs the fund's attention: price targets hit, policy breaches, open votes, upcoming earnings and insider buying.")}
    ${signalsStatus(alerts.signalsAsOf)}
    <section class="panel page-pad-panel" aria-labelledby="brief-h">
      <div class="panel-head"><h3 id="brief-h">Meeting brief</h3>
        <div class="brief-controls">
          <div class="seg seg-sm" role="group" aria-label="Brief period">
            <button type="button" class="seg-btn" data-brief="meeting"${lastMeeting ? "" : ` disabled title="Pick a meeting date once and it is saved here"`}>Since last meeting</button>
            <button type="button" class="seg-btn" data-brief="7">1 week</button>
            <button type="button" class="seg-btn" data-brief="30">1 month</button>
          </div>
          <label class="field-inline small">From <input type="date" id="briefSince" /></label>
        </div></div>
      <div id="briefBody"></div>
    </section>
    <div class="tab-grid">
      <section class="panel" aria-labelledby="act-h">
        <h3 id="act-h">Needs action <span class="count-pill">${action.length}</span></h3>
        ${action.length ? `<ul class="alert-list">${action.map(alertItem).join("")}</ul>` : `<p class="muted">Nothing needs action right now.</p>`}
      </section>
      <section class="panel" aria-labelledby="watch-h">
        <h3 id="watch-h">Keep an eye on <span class="count-pill">${watch.length}</span></h3>
        ${watch.length ? `<ul class="alert-list">${watch.map(alertItem).join("")}</ul>` : `<p class="muted">Nothing to watch.</p>`}
      </section>
      <section class="panel span-full" aria-labelledby="cal-h">
        <div class="panel-head"><h3 id="cal-h">Earnings calendar</h3><span class="muted small">Holdings and watchlist, next 45 days</span></div>
        ${earnings.events.length ? `
          <div class="table-scroll"><table class="mini-table">
            <caption class="sr-only">Upcoming earnings reports</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Ticker</th><th scope="col">When</th><th scope="col" class="num">EPS est.</th><th scope="col" class="num">Revenue est.</th><th scope="col">Status</th></tr></thead>
            <tbody>${earnings.events.map((e) => `<tr>
              <td>${esc(e.date)}</td>
              <td><a class="symbol-cell" href="#/research/${encodeURIComponent(e.symbol)}/street">${esc(e.symbol)}</a></td>
              <td>${e.hour === "bmo" ? "Before open" : e.hour === "amc" ? "After close" : "—"}</td>
              <td class="num">${e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : "—"}</td>
              <td class="num">${fmtMoneyCompact(e.revenueEstimate)}</td>
              <td>${e.owned ? `<span class="badge badge-owned">Owned</span>` : `<span class="badge badge-watch">Watching</span>`}</td>
            </tr>`).join("")}</tbody>
          </table></div>` : `<p class="muted">${earnings.error ? "The earnings calendar needs a Finnhub API key." : "No reports scheduled in the next 45 days."}</p>`}
      </section>
      <section class="panel span-full" aria-labelledby="news-h">
        <div class="panel-head"><h3 id="news-h">AI news triage</h3>${can("member") && alerts.aiEnabled !== false ? `<button type="button" class="btn btn-ghost btn-sm" id="runTriageBtn">Run today's triage</button>` : ""}</div>
        <div id="triageBody" class="small muted">${alerts.aiEnabled === false
          ? "AI news triage isn't available yet (coming soon)."
          : `Click "Run today's triage" to score each holding's recent headlines for materiality with AI (one batched call per stock; costs a little API credit).`}</div>
      </section>
    </div>`;

  document.getElementById("refreshSignalsBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const since = Date.now();
    try {
      for (;;) {
        const r = await api("/api/signals/refresh", { method: "POST", body: JSON.stringify({ since }) });
        if (!btn.isConnected) return;
        const total = r.refreshed + r.remaining + (btn.dataset.done ? Number(btn.dataset.done) : 0);
        btn.dataset.done = String((Number(btn.dataset.done) || 0) + r.refreshed);
        btn.textContent = `Refreshing… ${btn.dataset.done} / ${total}`;
        if (!r.remaining) break;
      }
      toast("Signals refreshed.", { type: "success" });
      mount(container);
    } catch (err) {
      toast(`Couldn't refresh signals: ${err.message}`, { type: "error" });
      btn.disabled = false;
      btn.textContent = "Refresh signals";
    }
  });

  loadBrief();
  document.getElementById("briefSince").addEventListener("change", (e) => {
    if (!e.target.value) return;
    briefSince = e.target.value;
    lastMeeting = briefSince;
    try { localStorage.setItem("pif_meeting_since", briefSince); } catch { /* ignore */ }
    const m = document.querySelector('[data-brief="meeting"]');
    if (m) { m.disabled = false; m.removeAttribute("title"); }
    loadBrief();
  });
  document.querySelectorAll("[data-brief]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.brief;
    briefSince = k === "meeting" ? lastMeeting : isoDaysAgo(Number(k));
    if (briefSince) loadBrief();
  }));
  document.getElementById("runTriageBtn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Scoring headlines…";
    const body = document.getElementById("triageBody");
    body.innerHTML = loading("Triaging news for every holding. This can take a minute.");
    try {
      const r = await api("/api/news-triage/run", { method: "POST" });
      const withTop = r.bySymbol.filter((s) => s.top?.length);
      body.innerHTML = withTop.length ? `<ul class="link-list small">${withTop.flatMap((s) => s.top.map((t) => `
        <li><a class="symbol-cell" href="#/research/${encodeURIComponent(s.symbol)}">${esc(s.symbol)}</a> (materiality ${t.materiality}/10, ${esc(t.direction)}): ${esc(t.reason)}</li>`)).join("")}</ul>`
        : `<p class="muted small">No material news found across holdings today.</p>`;
    } catch (err) {
      body.innerHTML = `<p class="error small">${esc(err.message)}</p>`;
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Run today's triage";
    }
  });
}
