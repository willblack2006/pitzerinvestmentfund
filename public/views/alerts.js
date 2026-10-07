import { esc, api, isUnlocked, toast, pageHead, loading, errorBox, subTabs, fmtMoneyCompact } from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";

export const title = "Alerts";

const ICON = { price: "◎", target: "◎", policy: "⚠", earnings: "📅", insider: "👤", vote: "🗳" };

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`;
}

export function alertItem(a) {
  const href = a.pitchId ? `#/pitches/${a.pitchId}` : a.type === "policy" ? "#/allocation" : a.symbol ? `#/research/${encodeURIComponent(a.symbol)}${a.type === "earnings" ? "/street" : a.type === "insider" ? "/ownership" : a.type === "target" ? "/thesis" : ""}` : null;
  return `<li class="alert-item alert-${esc(a.level)}">
    <span class="alert-icon" aria-hidden="true">${ICON[a.type] || "•"}</span>
    <div><div class="alert-title">${href ? `<a href="${href}">${esc(a.title)}</a>` : esc(a.title)}</div>
    <div class="muted small">${esc(a.detail || "")}</div></div>
    <span class="sr-only">${a.level === "action" ? "Needs action" : "For awareness"}</span>
  </li>`;
}

export async function mount(container) {
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/alerts") + loading("Checking prices, policy limits, earnings dates and insider filings…");
  let alerts, earnings;
  try {
    [alerts, earnings] = await Promise.all([api("/api/alerts"), api("/api/portfolio/earnings")]);
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/alerts") + pageHead("Alerts") + errorBox(`Could not load alerts: ${err.message}`);
    return;
  }
  const action = alerts.alerts.filter((a) => a.level === "action");
  const watch = alerts.alerts.filter((a) => a.level === "watch");

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/alerts")}
    ${pageHead("Alerts", "Everything that needs the fund's attention: price targets hit, policy breaches, open votes, upcoming earnings and insider buying.")}
    <p class="small muted page-pad" id="signalsStatus">
      Insider, short-interest, filing, revision and attention signals: ${alerts.signalsAsOf ? `updated ${esc(timeAgo(alerts.signalsAsOf))}` : "not computed yet"}.
      ${isUnlocked() ? `<button type="button" class="btn btn-ghost btn-sm" id="refreshSignalsBtn">Refresh signals</button>` : ""}
    </p>
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
        <div class="panel-head"><h3 id="news-h">AI news triage</h3>${isUnlocked() && alerts.aiEnabled !== false ? `<button type="button" class="btn btn-ghost btn-sm" id="runTriageBtn">Run today's triage</button>` : ""}</div>
        <div id="triageBody" class="small muted">${alerts.aiEnabled === false
          ? "AI news triage isn't available yet (coming soon)."
          : `Click "Run today's triage" to score each holding's recent headlines for materiality with Claude (one batched call per stock; costs a little API credit).`}</div>
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

  document.getElementById("runTriageBtn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Scoring headlines…";
    const body = document.getElementById("triageBody");
    body.innerHTML = loading("Triaging news for every holding — this can take a minute.");
    try {
      const r = await api("/api/news-triage/run", { method: "POST" });
      const withTop = r.bySymbol.filter((s) => s.top?.length);
      body.innerHTML = withTop.length ? `<ul class="link-list small">${withTop.flatMap((s) => s.top.map((t) => `
        <li><a class="symbol-cell" href="#/research/${encodeURIComponent(s.symbol)}">${esc(s.symbol)}</a> — materiality ${t.materiality}/10, ${esc(t.direction)}: ${esc(t.reason)}</li>`)).join("")}</ul>`
        : `<p class="muted small">No material news found across holdings today.</p>`;
    } catch (err) {
      body.innerHTML = `<p class="error small">${esc(err.message)}</p>`;
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Run today's triage";
    }
  });
}
