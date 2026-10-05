import { el, api } from "../shared.js";

const chartInstances = [];

function sparkline(canvas, observations, color) {
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: observations.map((o) => o.date),
      datasets: [{
        data: observations.map((o) => o.value),
        borderColor: color,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
  chartInstances.push(chart);
}

function card(key, series) {
  if (!series) {
    return `
      <div class="panel macro-card">
        <h3>${key}</h3>
        <p class="muted small">Not available — needs a FRED API key configured on the server.</p>
      </div>
    `;
  }
  const latest = series.observations[series.observations.length - 1];
  const prev = series.observations[series.observations.length - 2];
  const delta = prev ? latest.value - prev.value : null;
  return `
    <div class="panel macro-card">
      <h3>${series.label}</h3>
      <div class="value">${latest.value.toFixed(2)}${series.unit}</div>
      ${delta !== null ? `<div class="${delta >= 0 ? "gain-pos" : "gain-neg"} small">${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs prior reading</div>` : ""}
      <canvas id="spark-${key}" height="60"></canvas>
      <div class="muted small">As of ${latest.date}</div>
    </div>
  `;
}

export async function mount(container) {
  container.innerHTML = `<p class="muted">Loading macro data...</p>`;

  chartInstances.splice(0).forEach((c) => c.destroy());

  let series;
  try {
    series = await api("/api/macro");
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load macro data: ${err.message}</p>`;
    return;
  }

  container.innerHTML = `
    <h2>Macro Backdrop</h2>
    <p class="muted">Context from the Federal Reserve Economic Data (FRED) series.</p>
    <section class="macro-grid">
      ${Object.entries(series).map(([key, s]) => card(key, s)).join("")}
    </section>
  `;

  const colors = ["#4f8cff", "#2ecc71", "#ff5c5c", "#f5a623"];
  Object.entries(series).forEach(([key, s], i) => {
    if (s) sparkline(el(`spark-${key}`), s.observations, colors[i % colors.length]);
  });
}
