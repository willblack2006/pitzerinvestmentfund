import { el, esc, fmtUSD, fmtPct, fmtMoneyCompact, signed } from "../../shared.js";
import { barChart } from "../../charts.js";
import { scoreMeter, signalBadge } from "../insiderSignal.js";
import { term } from "../../glossary.js";

const PERIOD = { "0q": "This quarter", "+1q": "Next quarter", "0y": "This fiscal year", "+1y": "Next fiscal year" };

function targetRange(t, price) {
  if (!t?.mean || !t.low || !t.high) return `<p class="muted">No analyst price targets available.</p>`;
  const lo = Math.min(t.low, price ?? t.low), hi = Math.max(t.high, price ?? t.high);
  const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  return `
    <div class="target-range" role="img" aria-label="${esc(`Analyst targets range from ${fmtUSD(t.low)} to ${fmtUSD(t.high)}, mean ${fmtUSD(t.mean)}; current price ${price ? fmtUSD(price) : "unknown"}.`)}">
      <div class="tr-track"><span class="tr-band" style="left:${pos(t.low)}%;width:${pos(t.high) - pos(t.low)}%"></span>
        <span class="tr-mark tr-mean" style="left:${pos(t.mean)}%"><span>Mean ${fmtUSD(t.mean)}</span></span>
        ${price ? `<span class="tr-mark tr-price" style="left:${pos(price)}%"><span>Now ${fmtUSD(price)}</span></span>` : ""}
      </div>
      <div class="tr-ends small muted"><span>Low ${fmtUSD(t.low)}</span><span>High ${fmtUSD(t.high)}</span></div>
    </div>
    <div class="kv-grid kv-4">
      <div><span class="muted small">Upside to mean ${term("priceTarget", "target")}</span><strong>${t.upside != null ? signed(t.upside * 100, fmtPct(t.upside * 100), { neutral: true }) : "—"}</strong></div>
      <div><span class="muted small">Median target</span><strong>${t.median ? fmtUSD(t.median) : "—"}</strong></div>
      <div><span class="muted small">Analysts</span><strong>${t.analysts ?? "—"}</strong></div>
      <div><span class="muted small">Avg rating</span><strong>${Number.isFinite(t.recommendationMean) ? `${t.recommendationMean.toFixed(2)} <span class="small muted">(1 = strong buy, 5 = sell)</span>` : "—"}</strong></div>
    </div>`;
}

function estimatesTable(est) {
  if (!est?.length) return `<p class="muted">No consensus estimates available.</p>`;
  return `
    <div class="table-scroll">
      <table class="mini-table est-table">
        <caption class="sr-only">Consensus EPS and revenue estimates with revision trend</caption>
        <thead><tr><th scope="col">Period</th><th scope="col" class="num">${term("consensus", "EPS est.")}</th><th scope="col" class="num">Range</th><th scope="col" class="num">Growth</th><th scope="col" class="num">Revenue est.</th><th scope="col" class="num">${term("epsDrift", "EPS est. change, 90d")}</th><th scope="col" class="num">${term("revisionBreadth", "Revisions, 30d")}</th></tr></thead>
        <tbody>${est.map((e) => {
          const drift = e.epsTrend?.current && e.epsTrend?.d90 ? (e.epsTrend.current / e.epsTrend.d90 - 1) * 100 : null;
          const up = e.revisions?.up30 ?? 0, down = e.revisions?.down30 ?? 0;
          return `<tr>
            <th scope="row">${PERIOD[e.period] || esc(e.period)}<div class="muted small">ends ${esc(e.endDate || "")}</div></th>
            <td class="num">${e.epsAvg != null ? `$${e.epsAvg.toFixed(2)}` : "—"}</td>
            <td class="num small muted">${e.epsLow != null ? `$${e.epsLow.toFixed(2)}–$${e.epsHigh.toFixed(2)}` : "—"}</td>
            <td class="num">${e.growth != null ? signed(e.growth * 100, fmtPct(e.growth * 100)) : "—"}</td>
            <td class="num">${fmtMoneyCompact(e.revenueAvg)}</td>
            <td class="num">${drift === null ? "—" : signed(drift, fmtPct(drift))}</td>
            <td class="num">${up || down ? `<span class="tone-good">▲${up}</span> / <span class="tone-bad">▼${down}</span>` : "—"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>
    <p class="muted small">Rising estimates (more ▲ revisions, positive 90-day change) tend to support the stock; falling estimates are an early warning.</p>`;
}

function changesTable(changes) {
  if (!changes?.length) return `<p class="muted">No recent rating changes.</p>`;
  const label = { up: "Upgrade", down: "Downgrade", init: "Initiated", main: "Maintained", reit: "Reiterated" };
  return `
    <div class="table-scroll">
      <table class="mini-table">
        <caption class="sr-only">Recent analyst rating actions</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Firm</th><th scope="col">Action</th><th scope="col">Rating</th><th scope="col" class="num">Target</th></tr></thead>
        <tbody>${changes.map((c) => `<tr>
          <td>${esc(c.date)}</td><td>${esc(c.firm)}</td>
          <td><span class="${c.action === "up" ? "tone-good" : c.action === "down" ? "tone-bad" : ""}">${label[c.action] || esc(c.action)}</span></td>
          <td>${c.from && c.from !== c.to ? `${esc(c.from)} → ` : ""}${esc(c.to)}</td>
          <td class="num">${c.priceTarget ? `${c.priorTarget && c.priorTarget !== c.priceTarget ? `<span class="muted">${fmtUSD(c.priorTarget).replace(".00", "")} →</span> ` : ""}${fmtUSD(c.priceTarget).replace(".00", "")}` : "—"}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

export async function render(c, { symbol, data, price }) {
  const st = data.street;
  if (!st) {
    c.innerHTML = `<div class="page-pad"><p class="muted">No Wall Street coverage data for ${esc(symbol)}.</p></div>`;
    return;
  }
  const next = st.nextEarnings;
  const trend = [...(st.trend || [])].reverse(); // oldest → newest
  const monthLabel = (p) => (p === "0m" ? "Now" : `${p.replace("-", "").replace("m", "")} mo ago`);
  const beats = st.history.filter((h) => h.surprisePct > 0).length;

  c.innerHTML = `
    <div class="tab-grid">
      <section class="panel span-2" aria-labelledby="tgt-h">
        <h3 id="tgt-h">${term("priceTarget", "Price targets")}</h3>
        ${targetRange(st.targets, price)}
      </section>
      <section class="panel" aria-labelledby="next-h">
        <h3 id="next-h">Next earnings</h3>
        ${next?.dates?.length ? `
          <p class="big-date">${esc(next.dates[0])}${next.estimated ? ` <span class="muted small">(estimated)</span>` : ""}</p>
          <dl class="facts small">
            ${next.epsAvg != null ? `<dt>${term("consensus", "Consensus EPS")}</dt><dd>$${next.epsAvg.toFixed(2)}</dd>` : ""}
            ${next.revenueAvg ? `<dt>Consensus revenue</dt><dd>${fmtMoneyCompact(next.revenueAvg)}</dd>` : ""}
            ${st.history.length ? `<dt>Beat rate</dt><dd>${beats} of last ${st.history.length} quarters</dd>` : ""}
          </dl>` : `<p class="muted">No scheduled date yet.</p>`}
      </section>
      <section class="panel" aria-labelledby="trend-h">
        <h3 id="trend-h">Rating trend</h3>
        <div class="chart-box chart-sm"><canvas id="trendChart" role="img" aria-label="${esc(`Analyst ratings by month: ${trend.map((t) => `${monthLabel(t.period)} ${t.strongBuy + t.buy} buy, ${t.hold} hold, ${t.sell + t.strongSell} sell`).join("; ")}`)}"></canvas></div>
      </section>
      <section class="panel" aria-labelledby="surp-h">
        <h3 id="surp-h">${term("epsSurprise", "Earnings surprises")}</h3>
        <div class="chart-box chart-sm"><canvas id="surpChart" role="img" aria-label="${esc(`EPS surprise by quarter: ${st.history.map((h) => `${h.quarter} ${h.surprisePct != null ? (h.surprisePct * 100).toFixed(1) + "%" : "n/a"}`).join(", ")}`)}"></canvas></div>
        <p class="muted small">Actual EPS vs consensus, % above (beat) or below (miss).</p>
      </section>
      <section class="panel" aria-labelledby="sum-h">
        <h3 id="sum-h">What the Street expects</h3>
        <ul class="link-list small">
          ${st.targets?.upside != null ? `<li>Analysts see <strong>${fmtPct(st.targets.upside * 100)}</strong> to the mean target.</li>` : ""}
          ${(() => { const y = st.estimates.find((e) => e.period === "+1y"); return y?.growth != null ? `<li>EPS expected to grow <strong>${fmtPct(y.growth * 100)}</strong> next fiscal year.</li>` : ""; })()}
          ${(() => { const q = st.estimates.find((e) => e.period === "0q"); return q?.revisions ? `<li>${q.revisions.up30 ?? 0} upward vs ${q.revisions.down30 ?? 0} downward EPS revisions this month.</li>` : ""; })()}
          ${st.history.length ? `<li>Beat EPS estimates in ${beats} of the last ${st.history.length} quarters.</li>` : ""}
        </ul>
      </section>
      <section class="panel span-full" aria-labelledby="rev-h">
        <div class="panel-head"><h3 id="rev-h">${term("revisionScore")}</h3></div>
        <div class="sig-head">
          ${signalBadge(st.revisionScore.score, st.revisionScore.label)}
          ${scoreMeter(st.revisionScore.score)}
          <span class="muted small">−100 estimates falling · +100 estimates rising</span>
        </div>
        <ul class="sig-reasons">${st.revisionScore.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p class="muted small">Combines revision breadth (analysts raising vs cutting estimates, 7 &amp; 30 days) and EPS-estimate drift (current vs 30/90 days ago) across this and next quarter/year, weighted toward the nearer periods. A statistical tendency, not a forecast.</p>
      </section>
      <section class="panel span-full" aria-labelledby="est-h">
        <h3 id="est-h">Consensus estimates &amp; revisions</h3>
        ${estimatesTable(st.estimates)}
      </section>
      <section class="panel span-full" aria-labelledby="chg-h">
        <h3 id="chg-h">Recent analyst actions</h3>
        ${changesTable(st.changes)}
      </section>
    </div>`;

  barChart(el("trendChart"), {
    labels: trend.map((t) => monthLabel(t.period)),
    datasets: [
      { label: "Buy", data: trend.map((t) => t.strongBuy + t.buy), color: "--green" },
      { label: "Hold", data: trend.map((t) => t.hold), color: "--muted" },
      { label: "Sell", data: trend.map((t) => t.sell + t.strongSell), color: "--red" },
    ],
    stacked: true,
  });
  barChart(el("surpChart"), {
    labels: st.history.map((h) => h.quarter),
    datasets: [{ label: "Surprise", data: st.history.map((h) => (h.surprisePct ?? 0) * 100), colors: st.history.map((h) => ((h.surprisePct ?? 0) >= 0 ? "--green" : "--red")) }],
    yFormat: (v) => `${Number(v).toFixed(1)}%`,
    legend: false,
  });
}
