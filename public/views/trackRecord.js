import { esc, api, fmtPct, fmtUSD, signed, pageHead, loading, errorBox, subTabs } from "../shared.js";
import { lineChart } from "../charts.js";
import { IDEAS_TABS } from "./screener.js";
import { term } from "../glossary.js";

const fmtRound = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function groupTable(title, groups) {
  const keys = Object.keys(groups);
  if (!keys.length) return "";
  return `
    <section class="panel" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <div class="table-scroll"><table class="mini-table">
        <thead><tr><th scope="col">Group</th><th scope="col" class="num">Calls</th><th scope="col" class="num">Hit rate</th><th scope="col" class="num">Brier</th></tr></thead>
        <tbody>${keys.map((k) => `<tr><th scope="row">${esc(k)}</th><td class="num">${groups[k].n}</td><td class="num">${groups[k].hitRate != null ? fmtPct(groups[k].hitRate * 100) : "—"}</td><td class="num">${fmtRound(groups[k].brier, 3)}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

export const title = "Track record";

export async function mount(container) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/track-record") + loading("Grading past pitches against what actually happened…");
  let r;
  try {
    r = await api("/api/track-record");
  } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/track-record") + pageHead("Track record") + errorBox(`Could not load the track record: ${err.message}`);
    return;
  }
  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/track-record")}
    ${pageHead("Track record", "How often the fund's calls play out, graded against stated confidence and the base-case target. Only decided pitches (approved, rejected or executed) with a confidence %, horizon and base-case target are scored.")}
    ${!r.rows.length ? `<p class="muted page-pad">No graded calls yet — add a confidence % and time horizon when writing a pitch, and once its horizon passes it'll show up here.</p>` : `
      ${r.rows.length < 20 ? `<p class="notice small page-pad" role="note">Only ${r.rows.length} graded call${r.rows.length === 1 ? "" : "s"} so far. With this few, the hit rate and Brier score mostly reflect luck; read them as a running log, not a verdict.</p>` : ""}
      <section class="summary page-pad" aria-label="Calibration summary">
        <div class="stat"><div class="label">Calls graded</div><div class="value">${r.rows.length}</div><div class="sub">${r.pending.length} still pending (horizon not reached)</div></div>
        <div class="stat"><div class="label">${term("hitRate")}</div><div class="value">${r.hitRate != null ? fmtPct(r.hitRate * 100) : "—"}</div><div class="sub">Target reached by the horizon</div></div>
        <div class="stat"><div class="label">${term("brier")}</div><div class="value">${fmtRound(r.brier, 3)}</div><div class="sub">0 = perfect, 0.25 = coin-flip-at-50%, lower is better</div></div>
      </section>
      <div class="tab-grid page-pad">
        <section class="panel span-full" aria-labelledby="cal-h">
          <div class="panel-head"><h3 id="cal-h">Calibration: predicted vs actual</h3><span class="muted small">Dots on the diagonal are well-calibrated</span></div>
          <div class="chart-box"><canvas id="calChart" role="img" aria-label="${esc(`Calibration chart: ${r.buckets.map((b) => `confidence ~${Math.round(b.avgPredicted * 100)}% actually hit ${Math.round(b.actualHitRate * 100)}% of the time (${b.n} calls)`).join("; ")}`)}"></canvas></div>
        </section>
        ${groupTable("By analyst", r.byAnalyst)}
        ${groupTable("By sector", r.bySector)}
        ${groupTable("By direction", r.byDirection)}
        <section class="panel span-full" aria-labelledby="rows-h">
          <h3 id="rows-h">Graded calls</h3>
          <div class="table-scroll"><table class="mini-table">
            <thead><tr><th scope="col">Ticker</th><th scope="col">Analyst</th><th scope="col">Confidence</th><th scope="col">Horizon</th><th scope="col">Target hit?</th><th scope="col" class="num">Return</th><th scope="col" class="num">Vs benchmark</th></tr></thead>
            <tbody>${r.rows.map((row) => `
              <tr>
                <th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(row.symbol)}">${esc(row.symbol)}</a></th>
                <td>${esc(row.author || "—")}</td>
                <td>${row.confidencePct}%</td>
                <td>${esc(row.horizonDate)}</td>
                <td>${row.outcome ? `<span class="tone-good">Yes</span>` : `<span class="tone-bad">No</span>`}</td>
                <td class="num">${row.return != null ? signed(row.return * 100, fmtPct(row.return * 100)) : "—"}</td>
                <td class="num">${row.excessReturn != null ? signed(row.excessReturn * 100, fmtPct(row.excessReturn * 100)) : "—"}</td>
              </tr>`).join("")}</tbody>
          </table></div>
        </section>
        ${r.pending.length ? `
        <section class="panel span-full" aria-labelledby="pend-h">
          <h3 id="pend-h">Pending (horizon not yet reached)</h3>
          <ul class="link-list small">${r.pending.map((p) => `<li><a href="#/pitches/${p.id}">${esc(p.symbol)}</a> — ${p.confidencePct}% confidence, target ${fmtUSD(p.basePrice)} by ${esc(p.horizonDate)}</li>`).join("")}</ul>
        </section>` : ""}
      </div>`}`;

  if (r.rows.length) {
    lineChart(document.getElementById("calChart"), {
      labels: r.buckets.map((b) => `${Math.round(b.avgPredicted * 100)}%`),
      datasets: [
        { label: "Actual hit rate", data: r.buckets.map((b) => b.actualHitRate * 100), color: "--s1" },
        { label: "Perfectly calibrated", data: r.buckets.map((b) => b.avgPredicted * 100), color: "--muted", dash: [4, 4] },
      ],
      yFormat: (v) => `${Number(v).toFixed(0)}%`,
    });
  }
}
