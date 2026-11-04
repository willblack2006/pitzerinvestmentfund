import { el, esc, api, fmtUSD, fmtPct, fmtRatio, fmtX, signed, benchmarkPresets, benchmarkPicker, wireBenchmarkPicker, setPref, benchParam, skeleton, errorState, bindRetry } from "../../shared.js";
import { lineChart, barChart } from "../../charts.js";
import { timeChart } from "../../tvchart.js";
import { shortBadge, shortMeter } from "../shortSignal.js";
import { term } from "../../glossary.js";

// Server stats can be null (e.g. a flat price series has no volatility); never call toFixed on them.
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

const pct = (v) => (v === null || v === undefined ? "—" : signed(v * 100, fmtPct(v * 100)));


async function loadShortPressure(symbol) {
  const box = el("shortPressureBody");
  if (!box) return;
  let sp;
  try {
    sp = await api(`/api/short-pressure/${encodeURIComponent(symbol)}`);
  } catch (err) {
    if (el("shortPressureBody")) {
      box.innerHTML = errorState({ title: "Couldn't score short pressure.", detail: err.message, retryId: "load" });
      bindRetry(box, "load", () => { box.innerHTML = skeleton("text", { rows: 3, label: "Trying again" }); loadShortPressure(symbol); });
    }
    return;
  }
  if (!el("shortPressureBody")) return;
  if (sp.error) {
    box.innerHTML = `<p class="muted">Short-pressure data unavailable: ${esc(sp.error)}</p>`;
    return;
  }
  box.innerHTML = `
    <div class="sig-head">
      ${shortBadge(sp.score, sp.label)}
      ${shortMeter(sp.score)}
      <span class="muted small">${sp.score} / 100 · 20+ elevated · 45+ crowded · 70+ heavily crowded</span>
    </div>
    <ul class="sig-reasons">${sp.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="kv-grid kv-4">
      <div><span class="muted small">${term("daysToCover")}</span><strong>${Number.isFinite(sp.daysToCover) ? `${sp.daysToCover.toFixed(1)} days` : "—"}</strong></div>
      <div><span class="muted small">${term("shortFloat")}</span><strong>${fmtRatio(sp.shortPctFloat)}</strong></div>
      <div><span class="muted small">Short interest vs prior month</span><strong>${sp.shortChangePct === null ? "—" : signed(sp.shortChangePct * 100, fmtPct(sp.shortChangePct * 100), { invert: true })}</strong></div>
      <div><span class="muted small">As of</span><strong>${esc(sp.asOf || "—")}</strong></div>
    </div>
    ${sp.finra.length >= 5 ? `
      <p class="small" style="margin:12px 0 0">${term("finraShortVolume", "FINRA daily short-volume ratio")} (secondary; see note below)</p>
      <div class="chart-box"><canvas id="finraChart" role="img" aria-label="FINRA daily short-volume ratio, ${esc(symbol)}, over the last ${sp.finra.length} trading days."></canvas></div>
    ` : `<p class="muted small">Not enough recent FINRA short-volume data for a trend chart.</p>`}
    <details class="explainer small">
      <summary>How this score works</summary>
      <p>Combines days-to-cover (short interest ÷ average daily volume) and short interest as a share of the float, both from Yahoo, plus whether short interest is rising or falling vs the prior month. A crowded short (high days-to-cover and rising short interest) has historically predicted underperformance (Hong, Li, Ni, Scheinkman &amp; Wang, NBER w21166); a long-only fund that simply avoids or trims these names can capture that without paying a short-seller's borrow fees (Muravyev, Pearson &amp; Pollet, <em>Journal of Financial Economics</em>, 2025).
      The FINRA daily short-volume line is <strong>not</strong> the same thing as short interest: it's mostly market-maker and arbitrage order flow required to be marked "short," not a bet against the stock, so it's shown only as a secondary trend, not scored heavily. A statistical tendency across many stocks, not a prediction for this one.</p>
    </details>`;
  if (sp.finra.length >= 5) {
    lineChart(el("finraChart"), {
      labels: sp.finra.map((p) => p.date),
      datasets: [{ label: "Short-volume ratio", data: sp.finra.map((p) => p.ratio * 100), color: "--s1" }],
      yFormat: (v) => `${Number(v).toFixed(0)}%`,
    });
  }
}

export async function render(c, ctx) {
  const { symbol, data, price } = ctx;
  const t = data.technicals;
  c.innerHTML = skeleton("chart", { label: "Comparing with the market" });
  let r, presets;
  try {
    [r, presets] = await Promise.all([
      api(`/api/research/${encodeURIComponent(symbol)}/risk${benchParam()}`),
      benchmarkPresets(),
    ]);
  } catch (err) {
    c.innerHTML = errorState({ title: "Couldn't load risk data.", detail: err.message, retryId: "load" });
    bindRetry(c, "load", () => render(c, ctx));
    return;
  }
  const p = r.profile;
  if (!p) {
    c.innerHTML = `<p class="muted page-pad">${esc(r.error || "Not enough price history to measure risk.")}</p>`;
    return;
  }
  const trendLabel = t?.sma50 && t?.sma200
    ? (t.sma50 > t.sma200 ? (price > t.sma50 ? "Uptrend: price above both averages, 50-day above 200-day" : "Pulling back within an uptrend (50-day above 200-day)") : (price < t.sma50 ? "Downtrend: price below both averages, 50-day below 200-day" : "Recovering within a downtrend (50-day below 200-day)"))
    : null;

  c.innerHTML = `
    <div class="toolbar">
      <span class="muted small">Measured against <strong>${esc(r.benchmarkLabel)}</strong></span>
      ${benchmarkPicker("riskBench", r.benchmarkValue, presets, { label: "Compare with" })}
    </div>
    <section class="summary" aria-label="Risk statistics (2 years, daily)">
      <div class="stat"><div class="label">${term("beta", `Beta vs ${r.benchmark}`)}</div><div class="value">${f2(p.beta, 2)}</div><div class="sub">${p.beta > 1.2 ? "Amplifies market moves" : p.beta < 0.8 ? "Dampens market moves" : "Moves roughly with the market"}</div></div>
      <div class="stat"><div class="label">${term("volatility")}</div><div class="value">${fmtRatio(p.volatility, 0)}</div><div class="sub">${esc(r.benchmark)} ${fmtRatio(p.benchVolatility, 0)} · annualized</div></div>
      <div class="stat"><div class="label">${term("maxDrawdown")}</div><div class="value">${pct(p.maxDrawdown)}</div><div class="sub">${esc(p.drawdownPeak)} → ${esc(p.drawdownTrough)}</div></div>
      <div class="stat"><div class="label">${term("sharpe")}</div><div class="value">${f2(p.sharpe, 2)}</div><div class="sub">Return per unit of risk (4% risk-free)</div></div>
      <div class="stat"><div class="label">${term("correlation")}</div><div class="value">${f2(p.correlation, 2)}</div><div class="sub">with ${esc(r.benchmark)}; lower = more diversifying</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="rel-h">
        <div class="panel-head"><h3 id="rel-h">Relative performance, 2 years</h3><span class="muted small">Rebased to 100 on ${esc(p.start)}</span></div>
        <div class="chart-box"><canvas id="relChart" role="img" aria-label="${esc(`${symbol} returned ${(p.totalReturn * 100).toFixed(1)}% vs ${r.benchmark} ${(p.benchReturn * 100).toFixed(1)}%${r.sectorEtf ? ` and its sector (${r.sectorEtf}) ${(p.sectorReturn * 100).toFixed(1)}%` : ""} from ${p.start} to ${p.end}.`)}"></canvas></div>
        <div class="kv-grid kv-4">
          <div><span class="muted small">${esc(symbol)}</span><strong>${pct(p.totalReturn)}</strong></div>
          <div><span class="muted small">${esc(r.benchmark)} (benchmark)</span><strong>${pct(p.benchReturn)}</strong></div>
          ${r.sectorEtf ? `<div><span class="muted small">${esc(r.sectorEtf)} (${esc(r.sector)})</span><strong>${pct(p.sectorReturn)}</strong></div>` : ""}
          <div><span class="muted small">${term("informationRatio")}</span><strong>${f2(p.informationRatio, 2)}</strong></div>
        </div>
      </section>
      <section class="panel span-full" aria-labelledby="roll-h">
        <div class="panel-head">
          <h3 id="roll-h">Beta and correlation over time</h3>
          <div class="seg" role="group" aria-label="Rolling window">
            <button type="button" class="seg-btn" data-win="63" aria-pressed="false">3 months</button>
            <button type="button" class="seg-btn" data-win="126" aria-pressed="true">6 months</button>
          </div>
        </div>
        <div id="rollBody"></div>
      </section>
      <section class="panel" aria-labelledby="tech-h">
        <h3 id="tech-h">Trend</h3>
        ${t?.sma50 ? `
          <dl class="facts">
            <dt>Price</dt><dd>${fmtUSD(price)}</dd>
            <dt>50-day average</dt><dd>${fmtUSD(t.sma50)} <span class="small">(${signed((price / t.sma50 - 1) * 100, fmtPct((price / t.sma50 - 1) * 100))})</span></dd>
            ${t.sma200 ? `<dt>200-day average</dt><dd>${fmtUSD(t.sma200)} <span class="small">(${signed((price / t.sma200 - 1) * 100, fmtPct((price / t.sma200 - 1) * 100))})</span></dd>` : ""}
          </dl>
          ${trendLabel ? `<p class="small">${esc(trendLabel)}.</p>` : ""}` : `<p class="muted">Not enough history.</p>`}
      </section>
      <section class="panel span-full" aria-labelledby="sp-h">
        <div class="panel-head"><h3 id="sp-h">Short interest &amp; crowding score</h3><span class="muted small"><a href="#/short-interest">compare across holdings →</a></span></div>
        <div id="shortPressureBody">${skeleton("cards", { rows: 3, label: "Scoring short pressure" })}</div>
      </section>
      <section class="panel span-full" aria-labelledby="br-h">
        <div class="panel-head"><h3 id="br-h">Base rate: stocks like this one</h3><span class="muted small">1-year forward returns for similar sector/size/valuation names</span></div>
        <div id="baseRateBody">${skeleton("cards", { rows: 3, label: "Finding comparable stocks and pooling their history" })}</div>
      </section>
      <section class="panel" aria-labelledby="te-h">
        <h3 id="te-h">Vs the benchmark</h3>
        <dl class="facts">
          <dt>${term("trackingError")}</dt><dd>${fmtRatio(p.trackingError, 0)}</dd>
          <dt>Annualized return</dt><dd>${pct(p.annualizedReturn)}</dd>
        </dl>
        <p class="muted small">High beta plus high correlation means adding it increases the fund's market risk; low correlation means it diversifies. See <a href="#/performance">Portfolio → Performance</a> for how holdings move together.</p>
      </section>
    </div>`;

  wireBenchmarkPicker("riskBench", async (v) => { await setPref("benchmark", v); render(c, ctx); });
  const ds = [
    { label: symbol, data: p.series.asset, color: "--s1" },
    { label: `${r.benchmark} (benchmark)`, data: p.series.bench, color: "--s2", dash: [5, 4] },
  ];
  if (p.series.sector) ds.push({ label: `${r.sectorEtf} (sector)`, data: p.series.sector, color: "--s3", dash: [2, 3] });
  lineChart(el("relChart"), { labels: p.series.dates, datasets: ds, yFormat: (v) => Number(v).toFixed(0) });
  const showRolling = (win) => {
    c.querySelectorAll("[data-win]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.win === String(win))));
    renderRolling(symbol, r, p, win);
  };
  c.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", () => showRolling(b.dataset.win)));
  showRolling(126);
  loadShortPressure(symbol);
  loadBaseRate(symbol);
}

// Rolling beta (top pane) and correlation (bottom pane) against the benchmark, with the
// full two-year values as dashed reference lines and a one-line verdict on the trend.
function renderRolling(symbol, r, p, win) {
  const box = el("rollBody");
  if (!box) return;
  const roll = r.rolling?.[win];
  if (!roll?.dates?.length) {
    box.innerHTML = `<p class="muted small">Not enough overlapping history with ${esc(r.benchmark)} for a ${win === "63" || win === 63 ? "3" : "6"}-month window.</p>`;
    return;
  }
  const t = roll.trend;
  const months = Number(win) === 63 ? 3 : 6;
  const label = `${symbol}'s ${months}-month rolling beta and correlation with ${r.benchmark} from ${roll.dates[0]} to ${roll.dates.at(-1)}. Beta now ${f2(roll.beta.at(-1))} (two-year ${f2(p.beta)}); correlation now ${f2(roll.correlation.at(-1))} (two-year ${f2(p.correlation)}).${t ? ` ${t.text}` : ""}`;
  box.innerHTML = `
    ${t ? `<p class="roll-verdict tone-${t.direction === "up" ? "warn" : t.direction === "down" ? "good" : "neutral"}"><span aria-hidden="true">${t.direction === "up" ? "▲" : t.direction === "down" ? "▼" : "■"}</span> ${esc(t.text)}</p>` : ""}
    <div class="kv-grid kv-4">
      <div><span class="muted small">${term("rollingBeta", "Beta")} now</span><strong>${f2(roll.beta.at(-1))}</strong></div>
      <div><span class="muted small">Beta a year ago</span><strong>${t ? f2(t.betaThen) : "—"}</strong></div>
      <div><span class="muted small">${term("rollingCorrelation", "Correlation")} now</span><strong>${f2(roll.correlation.at(-1))}</strong></div>
      <div><span class="muted small">Correlation a year ago</span><strong>${t ? f2(t.corrThen) : "—"}</strong></div>
    </div>
    <div class="chart-box chart-box-tall"><div id="rollChart" role="img" aria-label="${esc(label)}"></div></div>
    <p class="muted small">Each point uses the ${months} months of daily returns before it. Beta above 1 means it has amplified ${esc(r.benchmark)}'s moves over that window; correlation near 1 means it moves in step with it (less diversification for the fund). Dashed lines are the full two-year values.</p>`;
  timeChart(el("rollChart"), {
    series: [
      { label: `Beta vs ${r.benchmark}`, times: roll.dates, values: roll.beta, color: "--s1" },
      { label: "Correlation", times: roll.dates, values: roll.correlation, color: "--s3", pane: 1 },
    ],
    refLines: [
      { series: 0, price: p.beta, label: "2y beta" },
      { series: 1, price: p.correlation, label: "2y corr" },
    ],
    yFormat: (v) => v.toFixed(2),
    legend: true,
    panes: [{ stretch: 1 }, { stretch: 1 }],
    caption: label,
  });
}

async function loadBaseRate(symbol) {
  const box = el("baseRateBody");
  if (!box) return;
  let r;
  try {
    r = await api(`/api/research/${encodeURIComponent(symbol)}/base-rate`);
  } catch (err) {
    if (el("baseRateBody")) {
      box.innerHTML = errorState({ title: "Couldn't build a base rate.", detail: err.message, retryId: "load" });
      bindRetry(box, "load", () => { box.innerHTML = skeleton("text", { rows: 3, label: "Trying again" }); loadBaseRate(symbol); });
    }
    return;
  }
  if (!el("baseRateBody")) return;
  if (!r.available || !r.stats) { box.innerHTML = `<p class="muted small">${esc(r.reason || "Not enough comparable stocks with 5-year price history to build a base rate.")}</p>`; return; }
  const s = r.stats;
  const few = r.companies < 8;
  box.innerHTML = `
    ${few ? `<p class="notice small" role="note">Only ${r.companies} comparable compan${r.companies === 1 ? "y" : "ies"} in the fund's universe, so treat this as a rough sketch, not a base rate.</p>` : ""}
    <div class="kv-grid kv-4">
      <div><span class="muted small">Median 1-year return</span><strong>${fmtPct(s.median * 100)}</strong></div>
      <div><span class="muted small">Share of years positive</span><strong>${fmtRatio(s.pctPositive, 0)}</strong></div>
      <div><span class="muted small">Typical range (10th to 90th pct)</span><strong>${fmtPct(s.p10 * 100)} to ${fmtPct(s.p90 * 100)}</strong></div>
      <div><span class="muted small">Sample</span><strong>${r.companies} companies × up to 5 years</strong></div>
    </div>
    <div class="chart-box"><canvas id="baseRateChart" role="img" aria-label="${esc(`Distribution of 1-year returns for ${r.companies} comparable companies: median ${fmtPct(s.median * 100)}, 10th percentile ${fmtPct(s.p10 * 100)}, 90th percentile ${fmtPct(s.p90 * 100)}.`)}"></canvas></div>
    <p class="muted small">Comparables (${esc(r.target.sector)}, ${esc(r.target.sizeBucket)}-cap, ${esc(r.target.valuationBucket || "any valuation")}): ${r.matchedSymbols.map(esc).join(", ") || "none"}. Drawn from the fund's holdings, watchlist and peers, all companies that still exist (${term("survivorship", "survivorship bias")}), so the picture is likely rosier than reality. For calibration only, not a forecast for ${esc(symbol)}.</p>`;
  if (r.histogram?.length) {
    barChart(el("baseRateChart"), {
      labels: r.histogram.map((h) => `${h.openLow ? "<" : ""}${Math.round((h.openLow ? h.hi : h.lo) * 100)}%${h.openHigh ? "+" : ""}`),
      datasets: [{ label: "1-year windows", data: r.histogram.map((h) => h.n), color: "--s1" }],
      legend: false,
    });
  }
}
