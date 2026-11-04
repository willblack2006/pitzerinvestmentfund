import { el, esc, api, pageHead, subTabs, errorState, bindRetry, skeleton } from "../shared.js";
import { MARKET_TABS } from "./insiders.js";
import { sparkline, destroyAllTv } from "../tvchart.js";

export const title = "Macro backdrop";

// Fallback labels for series the server couldn't load (it only sends labels with data).
const LABELS = {
  fedFundsRate: "Fed funds rate",
  cpi: "CPI (inflation)",
  unemployment: "Unemployment rate",
  treasury10y: "10-year Treasury yield",
};
const labelFor = (key) => LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

// CPI arrives as an index level (e.g. 334.1), which means nothing on its own. Convert it to
// year-over-year inflation, which is the number analysts actually quote.
function toYoY(series) {
  const obs = series.observations;
  const yoy = [];
  for (let i = 12; i < obs.length; i++) {
    yoy.push({ date: obs[i].date, value: ((obs[i].value / obs[i - 12].value) - 1) * 100 });
  }
  return yoy.length >= 2 ? { ...series, label: "CPI inflation (YoY)", unit: "%", observations: yoy, indexLevel: obs.at(-1).value } : series;
}

function card(key, series) {
  if (!series) {
    return `
      <section class="panel macro-card">
        <h3>${esc(labelFor(key))}</h3>
        <p class="muted small">Not available: the server needs a FRED API key.</p>
      </section>`;
  }
  const obs = series.observations;
  const latest = obs[obs.length - 1];
  const prev = obs[obs.length - 2];
  const first = obs[0];
  const delta = prev ? latest.value - prev.value : null;
  const unit = esc(series.unit);
  // Direction is shown neutrally: a rising rate or CPI isn't "good" or "bad" by itself.
  const dir = delta === null ? "" : delta > 0 ? "▲ up" : delta < 0 ? "▼ down" : "unchanged";
  return `
    <section class="panel macro-card" aria-labelledby="h-${key}">
      <h3 id="h-${key}">${esc(series.label)}</h3>
      <div class="value">${latest.value.toFixed(2)}${unit}</div>
      ${delta !== null ? `<div class="small muted">${dir}${delta ? ` ${Math.abs(delta).toFixed(2)}` : ""} vs prior reading (${esc(prev.date)})</div>` : ""}
      <div class="spark-box">
        <canvas id="spark-${key}" role="img"
          aria-label="${esc(`${series.label} from ${first.date} to ${latest.date}: ${first.value.toFixed(2)}${series.unit} to ${latest.value.toFixed(2)}${series.unit}. Range ${Math.min(...obs.map((o) => o.value)).toFixed(2)} to ${Math.max(...obs.map((o) => o.value)).toFixed(2)}.`)}"></canvas>
      </div>
      <div class="muted small">As of ${esc(latest.date)}${series.indexLevel ? ` · index ${series.indexLevel.toFixed(1)}` : ""}</div>
    </section>`;
}

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/macro") + skeleton("cards", { label: "Loading macro data" });
  destroyAllTv();

  let series;
  try {
    series = await api("/api/macro");
    if (series.cpi) series.cpi = toYoY(series.cpi);
  } catch (err) {
    container.innerHTML = subTabs(MARKET_TABS, "#/macro") + pageHead("Macro backdrop") + errorState({ title: "Couldn't load macro data.", detail: err.message, retryId: "page" });
    bindRetry(container, "page", () => mount(container));
    return;
  }

  container.innerHTML = `
    ${subTabs(MARKET_TABS, "#/macro")}
    ${pageHead("Macro backdrop", "The economic context for every pitch: rates, inflation, and jobs. Source: Federal Reserve Economic Data (FRED).")}
    <div class="macro-grid">
      ${Object.entries(series).map(([key, s]) => card(key, s)).join("")}
    </div>
    <p class="muted small page-pad">Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts<span class="sr-only"> (opens in a new tab)</span></a>.</p>
  `;

  Object.entries(series).forEach(([key, s]) => {
    if (s) sparkline(el(`spark-${key}`), { times: s.observations.map((o) => o.date), values: s.observations.map((o) => o.value) });
  });
}
