import { el, esc, api, fmtNum } from "../../shared.js";
import { barChart } from "../../charts.js";
import { netCell, quarterLabel, BREADTH_NOTE } from "../thirteenF.js";

// Research → Ownership: quarter-by-quarter 13F breadth for one ticker (all filers, from SEC's
// data sets plus the live ingest). The quarter being filed now is marked "so far".
export const breadthPanelHtml = (loading) => `
  <section class="panel span-full" aria-labelledby="breadth-h">
    <div class="panel-head"><h3 id="breadth-h">13F buyers and sellers</h3><span class="muted small">Every 13F filer, by quarter · <a href="#/13f">all holdings →</a></span></div>
    <div id="breadthHistBody">${loading("Counting 13F buyers and sellers…")}</div>
  </section>`;

export async function renderBreadthPanel(symbol) {
  const box = el("breadthHistBody");
  if (!box) return;
  let r;
  try {
    r = await api(`/api/13f/breadth/${encodeURIComponent(symbol)}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load 13F breadth: ${esc(err.message)}</p>`;
    return;
  }
  if (!el("breadthHistBody")) return;
  if (!r.tracked) { box.innerHTML = `<p class="muted small">${esc(symbol)} isn't in the 13F tracker. Only the fund's holdings and watchlist are tracked; a new ticker needs its CUSIP added to lib/seed/13fCusips.json.</p>`; return; }
  const label = (row) => `${quarterLabel(row.period)}${row.live && row.period === r.season.period && r.season.inProgress ? " (so far)" : ""}`;
  const withNet = r.rows.filter((row) => row.netPct != null);
  box.innerHTML = `
    ${withNet.length ? `<div class="chart-box"><canvas id="breadthChart" role="img" aria-label="${esc(`Net 13F buyers of ${symbol} by quarter: ${withNet.map((row) => `${label(row)} ${Math.round(row.netPct * 100)}%`).join(", ")}.`)}"></canvas></div>` : ""}
    <div class="table-scroll"><table class="mini-table">
      <caption class="sr-only">13F filers holding, adding to and cutting ${esc(symbol)} by quarter</caption>
      <thead><tr><th scope="col">Quarter</th><th scope="col" class="num">Filers holding</th><th scope="col" class="num">Added</th><th scope="col" class="num">Cut</th><th scope="col" class="num">New</th><th scope="col" class="num">Sold out</th><th scope="col" class="num">Net buyers</th><th scope="col" class="num">Small</th><th scope="col" class="num">Mid</th><th scope="col" class="num">Large</th></tr></thead>
      <tbody>${[...r.rows].reverse().map((row) => `<tr>
        <td>${esc(label(row))}${row.live ? ` <span class="muted small">${fmtNum(row.reported)} filers in</span>` : ""}</td>
        <td class="num">${fmtNum(row.holders)}</td>
        <td class="num">${row.buyers == null ? "—" : fmtNum(row.buyers)}</td><td class="num">${row.sellers == null ? "—" : fmtNum(row.sellers)}</td>
        <td class="num">${row.newPositions == null ? "—" : fmtNum(row.newPositions)}</td><td class="num">${row.exits == null ? "—" : fmtNum(row.exits)}</td>
        <td class="num">${netCell(row)}</td>
        <td class="num">${row.netPct == null ? "—" : netCell(row.bySize.small)}</td><td class="num">${row.netPct == null ? "—" : netCell(row.bySize.mid)}</td><td class="num">${row.netPct == null ? "—" : netCell(row.bySize.large)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small">"Filers holding" for a quarter still being filed only counts the filers in so far. The oldest quarter has no buyer/seller counts (the quarter before it isn't loaded). ${BREADTH_NOTE}</p>`;
  if (withNet.length) {
    barChart(el("breadthChart"), {
      labels: withNet.map(label),
      datasets: [{ label: "Net buyers", data: withNet.map((row) => row.netPct * 100), colors: withNet.map((row) => (row.netPct >= 0 ? "--green" : "--red")) }],
      yFormat: (v) => `${Math.round(v)}%`,
      legend: false,
    });
  }
}
