import { esc, api, fmtPct, fmtUSD, signed, pageHead, subTabs, errorState, bindRetry, skeleton, emptyState, can } from "../shared.js";
import { lineChart } from "../charts.js";
import { IDEAS_TABS } from "./screener.js";
import { term } from "../glossary.js";

const ciText = (ci) => (ci ? `${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%` : "—");
const sgn = (v) => (v == null ? "—" : signed(v * 100, fmtPct(v * 100)));
const fmtRound = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function groupTable(title, groups) {
  const keys = Object.keys(groups);
  if (!keys.length) return "";
  return `
    <section class="panel" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <div class="table-scroll"><table class="mini-table">
        <thead><tr><th scope="col">Group</th><th scope="col" class="num">Calls</th><th scope="col" class="num">Hit rate</th><th scope="col" class="num">Plausible range</th><th scope="col" class="num">Brier</th></tr></thead>
        <tbody>${keys.map((k) => `<tr><th scope="row">${esc(k)}</th><td class="num">${groups[k].n}</td><td class="num">${groups[k].hitRate != null ? fmtPct(groups[k].hitRate * 100) : "—"}</td><td class="num muted">${ciText(groups[k].ci)}</td><td class="num">${fmtRound(groups[k].brier, 3)}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

export const title = "Track record";

export async function mount(container) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/track-record") + skeleton("rows", { label: "Grading past pitches against what actually happened" });
  let r;
  try {
    r = await api("/api/track-record");
  } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/track-record") + pageHead("Track record") + errorState({ title: "Couldn't load the track record.", detail: err.message, retryId: "page" });
    bindRetry(container, "page", () => mount(container));
    return;
  }
  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/track-record")}
    ${pageHead("Track record", "How often the fund's calls play out, graded against stated confidence and the base-case target. Only decided pitches (approved, rejected or executed) with a confidence %, horizon and base-case target are scored.")}
    ${!r.rows.length ? `<div class="page-pad">${emptyState({ icon: "target", title: "No graded calls yet", body: "Add a confidence % and time horizon when writing a pitch. Once its horizon passes it will show up here.", action: can("member") ? { label: "Write a pitch", href: "#/pitches/new" } : null })}</div>` : `
      ${r.rows.length < 20 ? `<p class="notice small page-pad" role="note">Only ${r.rows.length} graded call${r.rows.length === 1 ? "" : "s"} so far. With this few, the hit rate and Brier score mostly reflect luck; read them as a running log, not a verdict.</p>` : ""}
      <section class="summary page-pad" aria-label="Calibration summary">
        <div class="stat"><div class="label">Calls graded</div><div class="value">${r.rows.length}</div><div class="sub">${r.pending.length} still pending (horizon not reached)</div></div>
        <div class="stat"><div class="label">${term("hitRate")}</div><div class="value">${r.hitRate != null ? fmtPct(r.hitRate * 100) : "—"}</div><div class="sub">Target reached by the horizon${r.hitRateCi ? ` · plausible range ${ciText(r.hitRateCi)}` : ""}</div></div>
        <div class="stat"><div class="label">${term("brier")}</div><div class="value">${fmtRound(r.brier, 3)}</div><div class="sub">0 = perfect, 0.25 = coin-flip-at-50%, lower is better</div></div>
      </section>
      <div class="tab-grid page-pad">
        <section class="panel span-full" aria-labelledby="cal-h">
          <div class="panel-head"><h3 id="cal-h">Calibration: predicted vs actual</h3><span class="muted small">Dots on the diagonal are well-calibrated</span></div>
          <div class="chart-box"><canvas id="calChart" role="img" aria-label="${esc(`Calibration chart: ${r.buckets.map((b) => `confidence ~${Math.round(b.avgPredicted * 100)}% actually hit ${Math.round(b.actualHitRate * 100)}% of the time (${b.n} calls)`).join("; ")}`)}"></canvas></div>
        </section>
        <section class="panel span-full" aria-labelledby="read-h">
          <div class="panel-head"><h3 id="read-h">What the score is telling us</h3><span class="muted small">${r.rows.length < 30 ? "Provisional: too few calls to be sure" : "Enough calls to start trusting this"}</span></div>
          <div class="read-grid small">
            ${r.murphy ? `<div><strong>Calibrated or just cautious?</strong><p class="muted">Miscalibration (lower is better): <strong>${fmtRound(r.murphy.reliability, 3)}</strong> · Separating likely from unlikely calls (higher is better): <strong>${fmtRound(r.murphy.resolution, 3)}</strong> · How hard the calls were: ${fmtRound(r.murphy.uncertainty, 3)}. ${r.murphy.resolution < 0.01 ? "Confidence barely varies with how things turned out, so a high or low number says little about who is good at this." : ""}</p></div>` : ""}
            ${r.payoff ? `<div><strong>Wins vs losses</strong><p class="muted">${fmtPct(r.payoff.beatBenchmark * 100)} of calls beat the benchmark by the horizon (${r.payoff.n} with data). Average win ${sgn(r.payoff.avgWin)}, average loss ${sgn(r.payoff.avgLoss)}${r.payoff.ratio != null ? `, so wins pay ${r.payoff.ratio.toFixed(1)}× what losses cost` : ""}. A hit rate under 50% can still be fine when this ratio is high.</p></div>` : ""}
            ${r.committee && r.committee.approved.n + r.committee.rejected.n ? `<div><strong>Did the committee add value?</strong><p class="muted">Approved calls (${r.committee.approved.n}) averaged ${sgn(r.committee.approved.avgEdge)} vs the benchmark; rejected calls (${r.committee.rejected.n}) averaged ${sgn(r.committee.rejected.avgEdge)}. Voting helps if the first number is higher.</p></div>` : ""}
            ${r.learning ? `<div><strong>Getting better?</strong><p class="muted">Brier on the earlier ${r.learning.nEarlier} calls: ${fmtRound(r.learning.earlier, 3)}; on the later ${r.learning.nLater}: ${fmtRound(r.learning.later, 3)}. ${r.learning.later < r.learning.earlier ? "Improving." : "Not improving yet."}</p></div>` : ""}
          </div>
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
          <ul class="link-list small">${r.pending.map((p) => `<li><a href="#/pitches/${p.id}">${esc(p.symbol)}</a>: ${p.confidencePct}% confidence, target ${fmtUSD(p.basePrice)} by ${esc(p.horizonDate)}</li>`).join("")}</ul>
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
