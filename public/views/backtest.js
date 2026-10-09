import { esc, api, fmtPct, signed, pageHead, loading, subTabs, benchmarkPresets, benchmarkPicker, wireBenchmarkPicker, setPref, getPref, benchParam } from "../shared.js";
import { lineChart } from "../charts.js";
import { MARKET_TABS } from "./insiders.js";

const SIGNALS = [
  ["momentum", "Momentum (12-1 month)", true],
  ["insider", "Insider signal score", false],
  ["revision", "Estimate revision score", false],
  ["shortpressure", "Days-to-cover / short pressure", false],
];

const state = { signal: "momentum", years: 7, costBps: 20 };

async function run(container) {
  const box = document.getElementById("btBody");
  if (!box) return;
  box.innerHTML = loading("Running the monthly-rebalance backtest over cached price history…");
  let r;
  try {
    r = await api(`/api/backtest?signal=${state.signal}&years=${state.years}&costBps=${state.costBps}${benchParam("&")}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't run the backtest: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById("btBody")) return;
  if (r.error) { box.innerHTML = `<p class="notice">${esc(r.error)}</p>`; return; }
  const s = r.summary;
  if (!s) { box.innerHTML = `<p class="muted">Not enough overlapping history to form monthly portfolios.</p>`; return; }
  box.innerHTML = `
    <section class="summary" aria-label="Backtest summary">
      <div class="stat"><div class="label">Top tercile (highest momentum)</div><div class="value">${signed(s.topTotalReturn * 100, fmtPct(s.topTotalReturn * 100))}</div><div class="sub">${s.months} months, ${r.universeSize} names, ${r.costBps}bps/rebalance</div></div>
      <div class="stat"><div class="label">Bottom tercile (lowest momentum)</div><div class="value">${signed(s.bottomTotalReturn * 100, fmtPct(s.bottomTotalReturn * 100))}</div></div>
      <div class="stat"><div class="label">Benchmark: ${esc(r.benchmark || "SPY")} (buy &amp; hold)</div><div class="value">${signed(s.benchTotalReturn * 100, fmtPct(s.benchTotalReturn * 100))}</div></div>
      <div class="stat"><div class="label">Top minus bottom</div><div class="value">${signed(s.longShortSpread * 100, fmtPct(s.longShortSpread * 100))}</div><div class="sub">Does the signal separate winners from losers?</div></div>
    </section>
    <section class="panel" aria-labelledby="bt-chart-h">
      <div class="panel-head"><h3 id="bt-chart-h">Growth of $100</h3></div>
      <div class="chart-box"><canvas id="btChart" role="img" aria-label="Backtest growth of $100: top tercile vs bottom tercile vs benchmark over ${r.rows.length} months."></canvas></div>
    </section>
    <div class="notice page-pad" role="note">
      <strong>Past ≠ future, small sample.</strong> This universe is today's holdings + watchlist (not a historical universe — names that would have been in it years ago but aren't today, or vice versa, are missing), so it carries <strong>survivorship bias</strong>: the result likely overstates how a real, point-in-time momentum strategy would have done. Treat this as a sanity check on the signal's direction, not a return estimate.
      ${r.excludedForHistory ? ` ${r.excludedForHistory} name(s) were excluded for too little price history.` : ""}
    </div>`;
  lineChart(document.getElementById("btChart"), {
    labels: r.rows.map((row) => row.month),
    datasets: [
      { label: "Top tercile", data: r.rows.map((row) => row.topValue), color: "--green" },
      { label: "Bottom tercile", data: r.rows.map((row) => row.bottomValue), color: "--red" },
      { label: "Benchmark", data: r.rows.map((row) => row.benchValue), color: "--muted", dash: [4, 4] },
    ],
    yFormat: (v) => `$${Number(v).toFixed(0)}`,
  });
}

export const title = "Backtester";

export async function mount(container) {
  const [presets, settings] = await Promise.all([benchmarkPresets(), api("/api/settings").catch(() => ({}))]);
  container.innerHTML = subTabs(MARKET_TABS, "#/backtest") +
    pageHead("Signal backtester", "A guardrail, not a forecast: monthly-rebalance long-only backtest of a signal across the fund's holdings + watchlist, net of an assumed trading cost.");
  container.innerHTML += `
    <section class="panel page-pad-panel" aria-labelledby="bt-h">
      <div class="panel-head"><h3 id="bt-h">Run a backtest</h3></div>
      <form id="btForm" class="toolbar">
        <label class="field-inline">Signal
          <select id="btSignal">${SIGNALS.filter(([, , enabled]) => enabled).map(([v, l]) => `<option value="${v}" ${v === state.signal ? "selected" : ""}>${l}</option>`).join("")}</select>
        </label>
        <label class="field-inline">Years <input id="btYears" type="number" min="1" max="10" value="${state.years}" inputmode="numeric" /></label>
        <label class="field-inline">Cost (bps/rebalance) <input id="btCost" type="number" min="0" max="200" value="${state.costBps}" inputmode="numeric" /></label>
        ${benchmarkPicker("btBench", getPref("benchmark") || settings.benchmark || "SPY", presets, { label: "Compare with" })}
        <button class="btn btn-primary">Run</button>
      </form>
      <p class="muted small">Insider, estimate-revision and short-pressure scores can't be backtested yet: the app only has their current values, not what they read in past months.</p>
      <div id="btBody"></div>
    </section>`;
  run(container);
  wireBenchmarkPicker("btBench", async (v) => { await setPref("benchmark", v); run(container); });
  document.getElementById("btForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.signal = document.getElementById("btSignal").value;
    state.years = Number(document.getElementById("btYears").value) || 7;
    state.costBps = Number(document.getElementById("btCost").value) || 0;
    run(container);
  });
}
