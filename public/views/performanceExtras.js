// Performance page, second half (WS9): rolling 3/6/12-month return, beta and Sharpe; drawdown
// underwater chart; daily return distribution; benchmark-relative cumulative return. On
// today's holdings over two years (GET /api/cockpit/performance), drawn with the SVG charts
// in public/viz/ so it works offline.
import { esc, api, benchParam, errorState, bindRetry, skeleton, emptyState } from "../shared.js";
import { lineChart } from "../viz/line.js";
import { histogram } from "../viz/bars.js";
import { fmt } from "../viz/core.js";

const WINDOWS = [["63", "3M"], ["126", "6M"], ["252", "12M"]];
const METRICS = [["ret", "Return"], ["beta", "Beta"], ["sharpe", "Sharpe"]];
const seg = (name, opts, cur, label) => `<div class="seg" role="group" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button type="button" class="seg-btn" data-pseg="${name}" data-value="${v}" aria-pressed="${v === cur}">${l}</button>`).join("")}</div>`;

export async function mountPerformanceExtras(host) {
  if (!host) return;
  host.innerHTML = `<section class="panel span-full">${skeleton("chart", { label: "Loading rolling performance" })}</section>`;
  let d;
  try { d = await api(`/api/cockpit/performance${benchParam()}`); }
  catch (err) {
    host.innerHTML = `<section class="panel span-full">${errorState({ title: "Couldn't load rolling performance.", detail: err.message, retryId: "perfx" })}</section>`;
    bindRetry(host, "perfx", () => mountPerformanceExtras(host));
    return;
  }
  if (!host.isConnected) return;
  if (!d.ready) { host.innerHTML = `<section class="panel span-full">${emptyState({ title: "Not enough history yet", body: d.reason })}</section>`; return; }
  const state = { win: "126", metric: "ret" };
  const B = esc(d.benchmark);
  host.innerHTML = `
    <section class="panel span-full" aria-labelledby="roll-h">
      <div class="panel-head"><h3 id="roll-h">Rolling ${"performance"}</h3>
        <div class="widget-tools">${seg("metric", METRICS, state.metric, "Measure")}${seg("win", WINDOWS, state.win, "Window")}</div></div>
      <p class="muted small" id="rollNote"></p><div id="rollChart"></div>
    </section>
    <section class="panel span-full" aria-labelledby="dd-h">
      <div class="panel-head"><h3 id="dd-h">Drawdown (underwater)</h3><span class="muted small">How far below its last peak, every day</span></div>
      <p class="small">${esc(ddSummary(d))}</p><div id="ddChart"></div>
    </section>
    <section class="panel span-2" aria-labelledby="rel-h">
      <div class="panel-head"><h3 id="rel-h">Ahead of or behind ${B}</h3><span class="muted small">Cumulative, since ${esc(fmt.date(d.start))}</span></div>
      <div id="relChart"></div>
    </section>
    <section class="panel" aria-labelledby="hist-h">
      <div class="panel-head"><h3 id="hist-h">Daily return spread</h3></div>
      <p class="small">${esc(histSummary(d))}</p><div id="histChart"></div>
    </section>
    <p class="muted small span-full">${d.covered < d.total ? `${d.total - d.covered} holdings without price history are left out. ` : ""}All on today's holdings and cash, ${esc(fmt.date(d.start))} to ${esc(fmt.date(d.end))}. Sharpe uses a 4% risk-free rate.</p>`;

  const drawRolling = () => {
    const r = d.rolling[state.win];
    const box = host.querySelector("#rollChart");
    const name = WINDOWS.find(([v]) => v === state.win)[1];
    if (!r?.dates?.length) { box.innerHTML = emptyState({ title: `Not enough history for ${name} windows`, body: "Try a shorter window." }); host.querySelector("#rollNote").textContent = ""; return; }
    const note = host.querySelector("#rollNote");
    if (state.metric === "ret") {
      const beat = r.fund.filter((v, i) => v > r.bench[i]).length;
      note.textContent = `Trailing ${name} return at each date. The fund beat ${d.benchmark} in ${beat} of ${r.fund.length} windows (${fmt.pct(beat / r.fund.length, 0)}).`;
      lineChart(box, { dates: r.dates, label: `Rolling ${name} return, fund vs ${d.benchmark}`, baseline: 0, height: 260,
        series: [{ label: "Fund", values: r.fund, color: "var(--viz-s1)" }, { label: d.benchmark, values: r.bench, color: "var(--viz-s2)", dash: true, width: 1.5 }],
        yFormat: (v) => fmt.spct(v, 0), tipFormat: (v) => fmt.spct(v, 1) });
    } else {
      const vals = r[state.metric];
      const last = vals.at(-1);
      note.textContent = state.metric === "beta"
        ? `Trailing ${name} beta to ${d.benchmark}: now ${fmt.num(last, 2)}. Above 1 means the fund swings more than ${d.benchmark}.`
        : `Trailing ${name} Sharpe ratio (return per unit of risk, annualized): now ${fmt.num(last, 2)}. Above 1 is good, below 0 lost money after the risk-free rate.`;
      lineChart(box, { dates: r.dates, label: `Rolling ${name} ${state.metric}`, baseline: state.metric === "beta" ? 1 : 0, height: 240,
        series: [{ label: state.metric === "beta" ? "Beta" : "Sharpe", values: vals, color: "var(--viz-s1)" }], yFormat: (v) => fmt.num(v, 1), tipFormat: (v) => fmt.num(v, 2) });
    }
  };
  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pseg]");
    if (!b) return;
    state[b.dataset.pseg] = b.dataset.value;
    host.querySelectorAll(`[data-pseg="${b.dataset.pseg}"]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    drawRolling();
  });
  drawRolling();

  const fd = d.drawdown.fund.points;
  const bmap = new Map((d.drawdown.benchPoints || []).map((p) => [p.date, p.dd]));
  lineChart(host.querySelector("#ddChart"), { dates: fd.map((p) => p.date), label: `Drawdown: ${ddSummary(d)}`, baseline: 0, height: 220,
    series: [{ label: "Fund", values: fd.map((p) => p.dd), color: "var(--viz-neg)", area: true }, { label: d.benchmark, values: fd.map((p) => bmap.get(p.date) ?? null), color: "var(--viz-s2)", dash: true, width: 1.5 }],
    yFormat: (v) => fmt.pct(v, 0), tipFormat: (v) => fmt.spct(v, 1), yDomain: [Math.min(-0.01, ...fd.map((p) => p.dd), ...[...bmap.values()]) * 1.08, 0.005] });
  const rb = d.rebased;
  lineChart(host.querySelector("#relChart"), { dates: rb.dates, label: `Fund relative to ${d.benchmark}: ${fmt.spct(rb.relative.at(-1), 1)} since ${fmt.date(d.start)}`, baseline: 0, height: 220,
    series: [{ label: `Fund vs ${d.benchmark}`, values: rb.relative, color: "var(--viz-s1)", area: true }], yFormat: (v) => fmt.spct(v, 0), tipFormat: (v) => fmt.spct(v, 2) });
  histogram(host.querySelector("#histChart"), d.histogram, { label: "Distribution of daily returns", bName: d.benchmark });
}

function ddSummary(d) {
  const f = d.drawdown.fund;
  if (!Number.isFinite(f.maxDrawdown) || f.maxDrawdown === 0) return "No drawdown in this window.";
  return `Worst: ${fmt.spct(f.maxDrawdown, 1)} from ${fmt.date(f.peakDate)} to ${fmt.date(f.troughDate)}, ${f.recoveredDate ? `recovered by ${fmt.date(f.recoveredDate)}` : "not yet recovered"}. Now ${fmt.spct(f.current, 1)} from the peak (${d.benchmark} worst ${fmt.spct(d.drawdown.bench.maxDrawdown, 1)}).`;
}
function histSummary(d) {
  const f = d.histogram.fund, b = d.histogram.bench;
  if (!f) return "";
  return `Up on ${fmt.pct(f.upDays, 0)} of days. A typical day moves ±${fmt.pct(f.stdev, 1)}${b ? ` (${d.benchmark} ±${fmt.pct(b.stdev, 1)})` : ""}; 1 day in 20 is worse than ${fmt.spct(f.p5, 1)}. Best ${fmt.spct(f.best, 1)}, worst ${fmt.spct(f.worst, 1)}.`;
}
