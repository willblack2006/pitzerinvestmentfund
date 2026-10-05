import { el, esc, api, fmtUSD, fmtPct, fmtRatio, loading, signed, benchmarkPresets, benchmarkPicker, wireBenchmarkPicker } from "../../shared.js";
import { lineChart } from "../../charts.js";

// Server stats can be null (e.g. a flat price series has no volatility); never call toFixed on them.
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

const pct = (v) => (v === null || v === undefined ? "—" : signed(v * 100, fmtPct(v * 100)));

let compareWith = null;

export async function render(c, ctx) {
  const { symbol, data, price } = ctx;
  const t = data.technicals;
  const si = data.street?.shortInterest;
  c.innerHTML = loading("Comparing with the market…");
  let r, presets;
  try {
    [r, presets] = await Promise.all([
      api(`/api/research/${encodeURIComponent(symbol)}/risk${compareWith ? `?benchmark=${encodeURIComponent(compareWith)}` : ""}`),
      benchmarkPresets(),
    ]);
  } catch (err) {
    c.innerHTML = `<p class="muted page-pad">Couldn't load risk data: ${esc(err.message)}</p>`;
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
  const siChange = si?.shares && si?.priorShares ? si.shares / si.priorShares - 1 : null;

  c.innerHTML = `
    <div class="toolbar">
      <span class="muted small">Measured against <strong>${esc(r.benchmarkLabel)}</strong></span>
      ${benchmarkPicker("riskBench", r.benchmarkValue, presets, { label: "Compare with" })}
    </div>
    <section class="summary" aria-label="Risk statistics (2 years, daily)">
      <div class="stat"><div class="label">Beta vs ${esc(r.benchmark)}</div><div class="value">${f2(p.beta, 2)}</div><div class="sub">${p.beta > 1.2 ? "Amplifies market moves" : p.beta < 0.8 ? "Dampens market moves" : "Moves roughly with the market"}</div></div>
      <div class="stat"><div class="label">Volatility</div><div class="value">${fmtRatio(p.volatility, 0)}</div><div class="sub">${esc(r.benchmark)} ${fmtRatio(p.benchVolatility, 0)} · annualized</div></div>
      <div class="stat"><div class="label">Max drawdown</div><div class="value">${pct(p.maxDrawdown)}</div><div class="sub">${esc(p.drawdownPeak)} → ${esc(p.drawdownTrough)}</div></div>
      <div class="stat"><div class="label">Sharpe ratio</div><div class="value">${f2(p.sharpe, 2)}</div><div class="sub">Return per unit of risk (4% risk-free)</div></div>
      <div class="stat"><div class="label">Correlation</div><div class="value">${f2(p.correlation, 2)}</div><div class="sub">with ${esc(r.benchmark)}; lower = more diversifying</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="rel-h">
        <div class="panel-head"><h3 id="rel-h">Relative performance, 2 years</h3><span class="muted small">Rebased to 100 on ${esc(p.start)}</span></div>
        <div class="chart-box"><canvas id="relChart" role="img" aria-label="${esc(`${symbol} returned ${(p.totalReturn * 100).toFixed(1)}% vs ${r.benchmark} ${(p.benchReturn * 100).toFixed(1)}%${r.sectorEtf ? ` and its sector (${r.sectorEtf}) ${(p.sectorReturn * 100).toFixed(1)}%` : ""} from ${p.start} to ${p.end}.`)}"></canvas></div>
        <div class="kv-grid kv-4">
          <div><span class="muted small">${esc(symbol)}</span><strong>${pct(p.totalReturn)}</strong></div>
          <div><span class="muted small">${esc(r.benchmark)} (benchmark)</span><strong>${pct(p.benchReturn)}</strong></div>
          ${r.sectorEtf ? `<div><span class="muted small">${esc(r.sectorEtf)} (${esc(r.sector)})</span><strong>${pct(p.sectorReturn)}</strong></div>` : ""}
          <div><span class="muted small">Information ratio</span><strong>${f2(p.informationRatio, 2)}</strong></div>
        </div>
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
      <section class="panel" aria-labelledby="si-h">
        <h3 id="si-h">Short interest</h3>
        ${si?.pctFloat != null ? `
          <dl class="facts">
            <dt>Short % of float</dt><dd>${fmtRatio(si.pctFloat)}</dd>
            ${si.ratio != null ? `<dt>Days to cover</dt><dd>${si.ratio.toFixed(1)}</dd>` : ""}
            ${siChange !== null ? `<dt>Change vs prior month</dt><dd>${signed(siChange * 100, fmtPct(siChange * 100))}</dd>` : ""}
          </dl>
          <p class="muted small">${si.pctFloat > 0.1 ? "Heavily shorted — many investors are betting against it; expect sharp moves either way." : "Normal level of short interest."}${si.asOf ? ` As of ${esc(si.asOf)}.` : ""}</p>` : `<p class="muted">No short-interest data.</p>`}
      </section>
      <section class="panel" aria-labelledby="te-h">
        <h3 id="te-h">How it fits the fund</h3>
        <dl class="facts">
          <dt>Tracking error</dt><dd>${fmtRatio(p.trackingError, 0)}</dd>
          <dt>Annualized return</dt><dd>${pct(p.annualizedReturn)}</dd>
        </dl>
        <p class="muted small">High beta plus high correlation means adding it increases the fund's market risk; low correlation means it diversifies. See <a href="#/performance">Portfolio → Performance</a> for how holdings move together.</p>
      </section>
    </div>`;

  wireBenchmarkPicker("riskBench", (v) => { compareWith = v; render(c, ctx); });
  const ds = [
    { label: symbol, data: p.series.asset, color: "--s1" },
    { label: `${r.benchmark} (benchmark)`, data: p.series.bench, color: "--s2", dash: [5, 4] },
  ];
  if (p.series.sector) ds.push({ label: `${r.sectorEtf} (sector)`, data: p.series.sector, color: "--s3", dash: [2, 3] });
  lineChart(el("relChart"), { labels: p.series.dates, datasets: ds, yFormat: (v) => Number(v).toFixed(0) });
}
