import { el, esc, api, fmtPct, fmtRatio, fmtUSD, signed, pageHead, loading, errorBox, subTabs, benchmarkPresets, benchmarkPicker, wireBenchmarkPicker, setPref, benchParam } from "../shared.js";
import { lineChart, barChart, destroyAll } from "../charts.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";
import { term } from "../glossary.js";

// Server stats can be null (e.g. a flat price series has no volatility); never call toFixed on them.
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export const title = "Performance";

const pct = (v) => (v === null || v === undefined ? "—" : signed(v * 100, fmtPct(v * 100)));

// Correlation heatmap as an accessible table (color + the number itself).
function heatmap(corr) {
  if (!corr) return `<p class="muted">Not enough overlapping price history.</p>`;
  const color = (v) => {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `color-mix(in srgb, var(--heat-pos) ${Math.round(a * 85)}%, transparent)` : `color-mix(in srgb, var(--heat-neg) ${Math.round(a * 85)}%, transparent)`;
  };
  return `
    <div class="table-scroll">
      <table class="heatmap">
        <caption class="sr-only">Correlation of daily returns between the largest holdings, ${esc(corr.start)} to ${esc(corr.end)}</caption>
        <thead><tr><th scope="col"><span class="sr-only">Holding</span></th>${corr.symbols.map((s) => `<th scope="col">${esc(s)}</th>`).join("")}</tr></thead>
        <tbody>${corr.symbols.map((a, i) => `<tr><th scope="row">${esc(a)}</th>${corr.matrix[i].map((v, j) => `<td style="background:${i === j ? "transparent" : color(v)}" class="${i === j ? "diag" : ""}">${i === j ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    <p class="muted small">Values near 1 move together (less diversification). Pairs above 0.7 are effectively the same bet.</p>`;
}


export async function mount(container) {
  destroyAll();
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/performance") + loading("Rebuilding a year of portfolio history… (first load can take ~20 seconds)");
  let d, presets;
  try {
    [d, presets] = await Promise.all([
      api(`/api/portfolio/performance${benchParam()}`),
      benchmarkPresets(),
    ]);
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/performance") + pageHead("Performance") + errorBox(`Could not load performance: ${err.message}`);
    return;
  }
  const b = d.backtest;
  const twr = d.ledger.twr;
  const highCorr = [];
  if (d.correlation) d.correlation.symbols.forEach((a, i) => d.correlation.symbols.forEach((s, j) => { if (j > i && d.correlation.matrix[i][j] > 0.7) highCorr.push(`${a}/${s}`); }));

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/performance")}
    ${pageHead("Performance & risk", `How the fund's current holdings have performed against <strong>${esc(d.benchmarkLabel)}</strong>, and where the risk is concentrated.`,
      `${benchmarkPicker("perfBench", d.benchmarkValue, presets, { label: "Compare with" })}
       ${d.benchmarkValue !== d.fundBenchmark ? `<button type="button" class="btn-link small" id="resetBench">Use the fund's benchmark</button>` : ""}`)}

    ${b ? `
    <section class="summary" aria-label="One-year statistics">
      <div class="stat stat-lg"><div class="label">Holdings, past year</div><div class="value">${pct(b.totalReturn)}</div><div class="sub">${esc(d.benchmark)} ${pct(b.benchReturn)} · <strong>${pct(b.totalReturn - b.benchReturn)}</strong> vs benchmark</div></div>
      <div class="stat"><div class="label">${term("beta")}</div><div class="value">${f2(b.beta, 2)}</div><div class="sub">${b.beta > 1.1 ? "More volatile than the market" : b.beta < 0.9 ? "Less volatile than the market" : "In line with the market"}</div></div>
      <div class="stat"><div class="label">${term("volatility")}</div><div class="value">${fmtRatio(b.volatility, 0)}</div><div class="sub">${esc(d.benchmark)} ${fmtRatio(b.benchVolatility, 0)}</div></div>
      <div class="stat"><div class="label">${term("sharpe", "Sharpe")}</div><div class="value">${f2(b.sharpe, 2)}</div><div class="sub">${term("informationRatio", "Info ratio")} ${f2(b.informationRatio, 2)}</div></div>
      <div class="stat"><div class="label">${term("maxDrawdown")}</div><div class="value">${pct(b.maxDrawdown)}</div><div class="sub">${esc(b.drawdownPeak)} → ${esc(b.drawdownTrough)}</div></div>
    </section>` : ""}

    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="bt-h">
        <div class="panel-head"><h3 id="bt-h">Current holdings vs ${esc(d.benchmark)}</h3><span class="muted small">Today's share counts priced over the past year, rebased to 100</span></div>
        ${b ? `<div class="chart-box"><canvas id="btChart" role="img" aria-label="${esc(`Current holdings returned ${(b.totalReturn * 100).toFixed(1)}% vs ${d.benchmark} ${(b.benchReturn * 100).toFixed(1)}% from ${b.start} to ${b.end}.`)}"></canvas></div>
          <p class="muted small">This shows how what we own <em>now</em> has behaved — not the fund's actual historical return, which depends on when trades happened. ${d.holdingsCovered < d.holdingsTotal ? `${d.holdingsTotal - d.holdingsCovered} holdings without price history are excluded.` : ""}</p>`
          : `<p class="muted">Not enough price history.</p>`}
      </section>

      <section class="panel span-full" aria-labelledby="twr-h">
        <div class="panel-head"><h3 id="twr-h">Fund return (time-weighted)</h3><span class="muted small">From daily valuation snapshots + the transaction ledger</span></div>
        ${twr ? `
          <div class="kv-grid kv-4">
            <div><span class="muted small">${term("twr", "Fund (TWR)")}</span><strong>${pct(twr.totalReturn)}</strong></div>
            <div><span class="muted small">${esc(d.benchmark)}</span><strong>${pct(twr.benchReturn)}</strong></div>
            <div><span class="muted small">Realized gains</span><strong>${fmtUSD(d.ledger.realizedGains)}</strong></div>
            <div><span class="muted small">Dividends received</span><strong>${fmtUSD(d.ledger.dividends)}</strong></div>
          </div>
          <div class="chart-box chart-sm"><canvas id="twrChart" role="img" aria-label="${esc(`Fund time-weighted return ${(twr.totalReturn * 100).toFixed(1)}% since ${twr.series[0].date}.`)}"></canvas></div>`
          : `<p class="muted">Building history: ${d.ledger.snapshots} daily snapshot${d.ledger.snapshots === 1 ? "" : "s"} so far. The server records one each weekday after the close; real time-weighted returns (the number to report to the board) appear once two exist. Record trades and cash movements under <a href="#/transactions">Transactions</a> so deposits don't count as gains.</p>`}
      </section>

      <section class="panel span-2" aria-labelledby="contrib-h">
        <div class="panel-head"><h3 id="contrib-h">What drove the return</h3><span class="muted small">${term("contribution")} = 1Y return × starting weight</span></div>
        <div class="chart-box chart-tall"><canvas id="contribChart" role="img" aria-label="${esc(`Top contributors: ${d.contributions.slice(0, 3).map((c) => `${c.symbol} ${(c.contribution * 100).toFixed(1)} points`).join(", ")}. Biggest detractors: ${d.contributions.slice(-3).reverse().map((c) => `${c.symbol} ${(c.contribution * 100).toFixed(1)} points`).join(", ")}.`)}"></canvas></div>
      </section>
      <section class="panel" aria-labelledby="corr-sum-h">
        <h3 id="corr-sum-h">Diversification check</h3>
        ${highCorr.length ? `<p class="small">These pairs among the largest holdings move almost in lockstep (correlation &gt; 0.7):</p><ul class="link-list small">${highCorr.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="small">No pair among the 12 largest holdings has a correlation above 0.7 — reasonably diversified.</p>`}
        <p class="muted small">Beta ${b ? f2(b.beta, 2) : "—"} means a 10% market drop would typically move the portfolio about ${b ? f2(b.beta * 10, 0) : "—"}%.</p>
      </section>

      <section class="panel span-full" aria-labelledby="corr-h">
        <div class="panel-head"><h3 id="corr-h">${term("correlation")} between the 12 largest holdings</h3></div>
        ${heatmap(d.correlation)}
      </section>
    </div>`;

  // Your pick is saved as your default "Compare with" everywhere (Allocation, Risk, Backtester…).
  wireBenchmarkPicker("perfBench", async (v) => { await setPref("benchmark", v); mount(container); });
  el("resetBench")?.addEventListener("click", async () => { await setPref("benchmark", null); mount(container); });

  if (b) {
    lineChart(el("btChart"), {
      labels: b.series.dates,
      datasets: [
        { label: "Current holdings", data: b.series.asset, color: "--s1" },
        { label: d.benchmark, data: b.series.bench, color: "--s2", dash: [5, 4] },
      ],
      yFormat: (v) => Number(v).toFixed(0),
    });
  }
  if (twr) {
    lineChart(el("twrChart"), {
      labels: twr.series.map((s) => s.date),
      datasets: [
        { label: "Fund", data: twr.series.map((s) => s.index), color: "--s1" },
        { label: d.benchmark, data: twr.series.map((s) => s.bench), color: "--s2", dash: [5, 4] },
      ],
      yFormat: (v) => Number(v).toFixed(1),
    });
  }
  const contrib = [...d.contributions.slice(0, 8), ...d.contributions.slice(-6)].filter((x, i, a) => a.indexOf(x) === i);
  barChart(el("contribChart"), {
    labels: contrib.map((x) => x.symbol),
    datasets: [{ label: "Contribution (pts)", data: contrib.map((x) => x.contribution * 100), colors: contrib.map((x) => (x.contribution >= 0 ? "--green" : "--red")) }],
    yFormat: (v) => `${Number(v).toFixed(1)}`,
    legend: false,
    horizontal: true,
  });
}
