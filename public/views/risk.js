import { el, esc, api, pageHead, loading, subTabs, errorState, bindRetry, signed, emptyState } from "../shared.js";
import { lineChart, destroyAll } from "../charts.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";
import { term } from "../glossary.js";

export const title = "Risk";

const p1 = (v) => (Number.isFinite(v) ? `${Math.abs(v) < 0.0005 ? "0.0" : (v * 100).toFixed(1)}%` : "—");
const sp = (v) => (Number.isFinite(v) ? signed(v * 100, `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`) : "—");
const usd = (v) => (Number.isFinite(v) ? `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}` : "—");
const loss = (v) => (Number.isFinite(v) ? `−${p1(v)}` : "—");
const range = (w) => (w ? `${esc(w.start)} → ${esc(w.end)}` : "");

function riskTable(rows) {
  return `<div class="table-scroll"><table class="data-table">
    <caption class="sr-only">Each holding's share of the fund's value compared with its share of the fund's risk</caption>
    <thead><tr><th scope="col">Holding</th><th scope="col" class="num">Share of fund</th><th scope="col" class="num">Share of risk</th><th scope="col" class="num">Risk ÷ size</th><th scope="col" class="num">Volatility</th><th scope="col" class="num">Beta</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <th scope="row"><a href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></th>
      <td class="num">${p1(r.weight)}</td>
      <td class="num"><strong>${p1(r.riskShare)}</strong> <span class="risk-bar" aria-hidden="true" style="display:inline-block;height:6px;width:${Math.round(Math.max(0, r.riskShare) * 160)}px;background:var(--s1);border-radius:3px;vertical-align:middle"></span></td>
      <td class="num">${Number.isFinite(r.riskVsWeight) ? `${r.riskVsWeight.toFixed(1)}×` : "—"}</td>
      <td class="num">${p1(r.volatility)}</td>
      <td class="num">${Number.isFinite(r.beta) ? r.beta.toFixed(2) : "—"}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function scenarioTable(list, withName) {
  return `<div class="table-scroll"><table class="data-table">
    <thead><tr><th scope="col">${withName ? "Episode" : "Market falls"}</th><th scope="col" class="num">Fund</th><th scope="col" class="num">Dollars</th><th scope="col">Hit hardest</th></tr></thead>
    <tbody>${list.map((s) => `<tr>
      <th scope="row">${withName ? `${esc(s.name)} <span class="muted small">(${esc(s.from.slice(0, 7))}, S&amp;P ${sp(s.spyMove)})</span>` : p1(s.marketMove).replace("-", "−")}</th>
      <td class="num">${sp(s.changePct)}</td><td class="num">${usd(s.change)}</td>
      <td class="small">${s.worst.map((w) => `${esc(w.symbol)} ${usd(w.change)}`).join(", ")}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function liquidityPanel(q) {
  const top = q.rows.filter((x) => x.days !== null && x.days >= 0.1).slice(0, 8);
  return `<section class="panel span-full" aria-labelledby="lq-h">
    <div class="panel-head"><h3 id="lq-h">How fast we could sell</h3><span class="muted small">Selling at ${Math.round(q.participation * 100)}% of typical daily volume</span></div>
    <div class="kv-grid kv-4">
      <div><span class="muted small">Sellable in 1 day</span><strong>${p1(q.withinDay)}</strong></div>
      <div><span class="muted small">Sellable in 1 week</span><strong>${p1(q.withinWeek)}</strong></div>
    </div>
    ${top.length ? "" : `<p class="small">Every position with volume data could be sold in well under a day.</p>`}
    ${top.length ? `<div class="table-scroll"><table class="data-table">
      <thead><tr><th scope="col">Slowest to sell</th><th scope="col" class="num">Position</th><th scope="col" class="num">Typical daily $ volume</th><th scope="col" class="num">Days to sell</th></tr></thead>
      <tbody>${top.map((x) => `<tr><th scope="row"><a href="#/research/${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a></th><td class="num">${usd(x.value)}</td><td class="num">${usd(x.adv)}</td><td class="num">${x.days < 0.05 ? "<0.1" : x.days.toFixed(1)}</td></tr>`).join("")}</tbody>
    </table></div>` : ""}
    <p class="muted small">Uses the median dollar volume of the last ${q.window} sessions. A rough guide: it ignores price impact and doesn't cover the fund's own cash needs.${q.unknown.length ? ` No volume data for ${q.unknown.map(esc).join(", ")}.` : ""}</p>
  </section>`;
}

export async function mount(container) {
  destroyAll();
  const head = subTabs(PORTFOLIO_TABS, "#/risk");
  container.innerHTML = head + loading("Measuring portfolio risk…");
  let d;
  try { d = await api("/api/portfolio/risk"); } catch (err) {
    container.innerHTML = head + pageHead("Risk") + errorState({ title: "Couldn't load risk.", detail: err.message, retryId: "page" });
    bindRetry(container, "page", () => mount(container));
    return;
  }
  const r = d.risk;
  if (!r) {
    container.innerHTML = head + pageHead("Risk", "Where the fund's risk comes from and what a sell-off would cost.") + `<div class="page-pad">${emptyState({ icon: "trending-up", title: "Risk appears once there is price history", body: d.reason || "No data yet." })}</div>`;
    return;
  }
  const L = r.loss, dd = r.drawdown;
  container.innerHTML = `
    ${head}
    ${pageHead("Risk", `Where the fund's risk actually comes from, how bad bad days have been, and what a market sell-off would cost. Based on what we own today over ${r.days} trading days to ${esc(r.asOf)}.`)}

    ${r.notes.length ? `<section class="panel page-pad-panel" aria-label="What stands out"><ul class="link-list takeaways">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>` : ""}

    <section class="summary" aria-label="Risk summary">
      ${L ? `<div class="stat"><div class="label">${term("var", "Bad-day loss")}</div><div class="value">${loss(L.oneDayVar)}</div><div class="sub">about ${usd(L.oneDayVarUsd)} on 1 day in 20</div></div>
      <div class="stat"><div class="label">${term("expectedShortfall", "Average of the worst days")}</div><div class="value">${loss(L.expectedShortfall)}</div><div class="sub">${usd(L.expectedShortfallUsd)} · worst day ${loss(L.worstDay)}</div></div>` : ""}
      <div class="stat"><div class="label">${term("currentDrawdown", "Below peak")}</div><div class="value">${sp(dd.current)}</div><div class="sub">${dd.current < -0.001 ? `peak ${esc(dd.peakDate)}, ${dd.daysSincePeak} days ago` : "at a new high"}</div></div>
      <div class="stat"><div class="label">${term("effectiveBets", "Independent bets")}</div><div class="value">${r.effectiveBets.toFixed(1)}</div><div class="sub">across ${r.rows.length} holdings</div></div>
      <div class="stat"><div class="label">${term("beta")} vs S&amp;P 500</div><div class="value">${Number.isFinite(r.beta) ? r.beta.toFixed(2) : "—"}</div><div class="sub">${p1(r.fund.cashPct)} in cash</div></div>
    </section>

    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="rc-h">
        <div class="panel-head"><h3 id="rc-h">Where the risk comes from</h3><span class="muted small">${term("riskContribution", "Share of risk")} vs share of the fund</span></div>
        ${riskTable(r.rows.slice(0, 15))}${r.rows.length > 15 ? `<details class="small"><summary>Show the other ${r.rows.length - 15} holdings</summary>${riskTable(r.rows.slice(15))}</details>` : ""}
        <p class="muted small">A holding with Risk ÷ size above 1 adds more risk than its dollars suggest (volatile, or moves with everything else). Below 1 it dampens the fund. Shares of risk add to 100%.${r.dropped.length ? ` Not enough price history for ${r.dropped.map(esc).join(", ")}, so ${r.dropped.length === 1 ? "it is" : "they are"} left out of these numbers.` : ""}</p>
      </section>

      ${L ? `<section class="panel span-2" aria-labelledby="dd-h">
        <div class="panel-head"><h3 id="dd-h">Distance from peak</h3><span class="muted small">Today's holdings, past year</span></div>
        <div class="chart-box chart-sm"><canvas id="ddChart" role="img" aria-label="${esc(`Holdings are ${(Math.abs(dd.current) * 100).toFixed(1)}% below their one-year peak; the deepest fall was ${(Math.abs(dd.max) * 100).toFixed(1)}%.`)}"></canvas></div>
        <p class="muted small">Deepest fall ${sp(dd.max)} (${esc(dd.maxPeak)} → ${esc(dd.maxTrough)}).</p>
      </section>
      <section class="panel" aria-labelledby="bad-h">
        <h3 id="bad-h">How bad it has been</h3>
        <div class="kv-grid">
          <div><span class="muted small">Worst day</span><strong>${loss(L.worstDay)}</strong></div>
          <div><span class="muted small">Worst 5 days</span><strong>${L.worst5 ? loss(-L.worst5.ret) : "—"}</strong><span class="muted small">${range(L.worst5)}</span></div>
          <div><span class="muted small">Worst 21 days</span><strong>${L.worst21 ? loss(-L.worst21.ret) : "—"}</strong><span class="muted small">${range(L.worst21)}</span></div>
          <div><span class="muted small">Volatility</span><strong>${p1(r.volatility)}</strong></div>
        </div>
        <p class="muted small">Measured on the past year only, so a worse stretch than any of these can happen. Cash counts as no risk.</p>
      </section>` : ""}

      <section class="panel span-full" aria-labelledby="sc-h">
        <div class="panel-head"><h3 id="sc-h">If the market falls</h3><span class="muted small">Each holding moves by its beta × the S&amp;P 500's fall</span></div>
        ${scenarioTable(r.shocks, false)}
        ${r.growthShocks?.length ? `<h4>Growth sell-off (Nasdaq-100 falls, each holding moves by its beta to it; fund beta ${r.growthBeta.toFixed(2)})</h4>${scenarioTable(r.growthShocks, false)}` : ""}
        ${r.episodes.length ? `<h4>Past sell-offs, applied to today's holdings</h4>${scenarioTable(r.episodes, true)}` : ""}
        <p class="muted small">A rough guide, not a forecast: betas come from one year of calm-to-normal data, and in real crashes stocks fall together, so high-beta names often lose more than this shows.</p>
      </section>
      ${r.liquidity ? liquidityPanel(r.liquidity) : ""}
    </div>`;

  if (L) {
    const s = dd.series;
    lineChart(el("ddChart"), {
      labels: s.map((x) => x.date),
      datasets: [{ label: "Below peak (%)", data: s.map((x) => x.dd * 100), color: "--red" }],
      yFormat: (v) => `${Number(v).toFixed(0)}%`,
      legend: false,
    });
  }
}
