import { el, esc, api, fmtUSD, pageHead, loading, errorBox, subTabs, isUnlocked } from "../shared.js";
import { barChart, destroyAll } from "../charts.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";

export const title = "Allocation & policy";

export async function mount(container) {
  destroyAll();
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/allocation") + loading("Classifying holdings by sector…");
  let a;
  try {
    a = await api("/api/portfolio/allocation");
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/allocation") + pageHead("Allocation & policy") + errorBox(`Could not load allocation: ${err.message}`);
    return;
  }
  const s = a.settings;
  const breaches = a.checks.filter((c) => c.level === "breach");
  const watches = a.checks.filter((c) => c.level === "watch");
  const sectors = a.sectors.filter((r) => r.weight > 0 || (r.benchmarkWeight ?? 0) > 0);

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/allocation")}
    ${pageHead("Allocation & policy", `Where the fund's money sits by sector versus ${esc(a.sectorBenchmarkLabel)}, and whether it complies with the investment policy statement (IPS).`,
      isUnlocked() ? `<a class="btn btn-ghost" href="#/settings">Edit policy limits</a>` : "")}

    <section class="compliance ${breaches.length ? "has-breach" : "ok"}" aria-labelledby="ips-h">
      <h3 id="ips-h">${breaches.length ? `<span aria-hidden="true">⚠</span> ${breaches.length} policy breach${breaches.length > 1 ? "es" : ""}` : [s.maxPositionPct, s.maxSectorPct, s.minPositions, s.maxPositions, s.minCashPct].every((v) => v == null) ? "Policy limits not set" : `<span aria-hidden="true">✓</span> Within policy`}</h3>
      ${a.checks.length ? `<ul class="check-list">
        ${[...breaches, ...watches].map((c) => `<li class="check-${c.level}"><strong>${esc(c.rule)}:</strong> ${esc(c.detail)}${c.symbol ? ` <a href="#/research/${encodeURIComponent(c.symbol)}">Research ${esc(c.symbol)}</a>` : ""}</li>`).join("")}
      </ul>` : ""}
      <p class="muted small">${(() => {
        const parts = [
          s.maxPositionPct != null && `≤${s.maxPositionPct}% per position`,
          s.maxSectorPct != null && `≤${s.maxSectorPct}% per sector`,
          (s.minPositions != null || s.maxPositions != null) && `${s.minPositions ?? "any"}–${s.maxPositions ?? "any"} holdings`,
          s.minCashPct != null && `≥${s.minCashPct}% cash`,
        ].filter(Boolean);
        return parts.length ? `Limits: ${parts.join(" · ")}.` : `No policy limits set yet — <a href="#/settings">add your IPS limits in Settings</a> to enable compliance checks.`;
      })()}</p>
    </section>

    <section class="summary" aria-label="Allocation summary">
      <div class="stat"><div class="label">Total fund value</div><div class="value">${fmtUSD(a.total)}</div></div>
      <div class="stat"><div class="label">Invested</div><div class="value">${fmtUSD(a.invested)}</div></div>
      <div class="stat"><div class="label">Cash</div><div class="value">${fmtUSD(a.cash)}</div><div class="sub">${a.cashPct.toFixed(1)}% of fund${a.cash === 0 ? " · record deposits under Transactions" : ""}</div></div>
      <div class="stat"><div class="label">Sectors held</div><div class="value">${a.sectors.filter((r) => r.weight > 0).length}</div><div class="sub">of 11 GICS sectors</div></div>
    </section>

    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="sec-h">
        <div class="panel-head"><h3 id="sec-h">Sector weights vs ${esc(a.sectorBenchmarkLabel)}</h3><span class="muted small">${a.sectorBenchmark !== a.benchmark ? `Fund benchmark (${esc(a.benchmarkLabel)}) has no sector breakdown, so the S&amp;P 500 is shown. ` : ""}${a.sectorCoverage > 0 && a.sectorCoverage < 0.999 ? `Sectors of the blend's equity part (${(a.sectorCoverage * 100).toFixed(0)}% of it), scaled to 100%. ` : ""}<a href="#/settings">Change benchmark</a></span></div>
        <div class="chart-box chart-tall"><canvas id="secChart" role="img" aria-label="${esc(sectors.map((r) => `${r.sector}: fund ${r.weight.toFixed(1)}%, benchmark ${r.benchmarkWeight?.toFixed(1) ?? "n/a"}%`).join("; "))}"></canvas></div>
      </section>
      <section class="panel span-full" aria-labelledby="sectbl-h">
        <h3 id="sectbl-h">Over- and underweights</h3>
        <div class="table-scroll">
          <table class="mini-table">
            <caption class="sr-only">Sector weights, benchmark weights and active weight</caption>
            <thead><tr><th scope="col">Sector</th><th scope="col" class="num">Fund</th><th scope="col" class="num">${esc(a.sectorBenchmark)}</th><th scope="col" class="num">Active</th><th scope="col">Holdings</th></tr></thead>
            <tbody>${sectors.map((r) => `<tr>
              <th scope="row">${esc(r.sector)}</th>
              <td class="num">${r.weight.toFixed(1)}%</td>
              <td class="num">${r.benchmarkWeight != null ? r.benchmarkWeight.toFixed(1) + "%" : "—"}</td>
              <td class="num">${r.active == null ? "—" : `<span class="${Math.abs(r.active) > 10 ? (r.active > 0 ? "tone-bad" : "tone-warn") : ""}">${r.active > 0 ? "+" : ""}${r.active.toFixed(1)} pts</span>`}</td>
              <td class="small">${r.symbols.map((sym) => `<a href="#/research/${encodeURIComponent(sym)}">${esc(sym)}</a>`).join(", ") || `<span class="muted">none — <a href="#/screener">find ideas</a></span>`}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
        <p class="muted small">Active weight = fund minus benchmark. Big overweights are concentrated bets; zero exposure to a large sector is a bet too.</p>
      </section>
    </div>`;

  barChart(el("secChart"), {
    labels: sectors.map((r) => r.sector),
    datasets: [
      { label: "Fund", data: sectors.map((r) => r.weight), color: "--s1" },
      { label: a.sectorBenchmark, data: sectors.map((r) => r.benchmarkWeight ?? 0), color: "--s2" },
    ],
    yFormat: (v) => `${Number(v).toFixed(0)}%`,
    horizontal: true,
  });
}
