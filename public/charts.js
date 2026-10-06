// Thin Chart.js wrappers that read colors from the CSS theme tokens, respect reduced motion,
// and degrade to nothing if the CDN failed to load. Every canvas gets a text alternative
// from its caller (role="img" + aria-label).
//
// Chart.js (~200KB) is only fetched here, on first actual use, instead of via a <script> tag
// in index.html — most pages (holdings, transactions, screener, settings, …) never render a
// chart and shouldn't pay to download one.
let chartReady = null;
function ensureChart() {
  if (typeof Chart !== "undefined") return Promise.resolve();
  if (!chartReady) {
    chartReady = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
      script.onload = resolve;
      script.onerror = resolve; // callers already degrade gracefully when Chart is undefined
      document.head.appendChild(script);
    });
  }
  return chartReady;
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Categorical series colors (validated for contrast on both themes in style.css).
export const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5"];

const registry = new Map();
function track(canvas, chart) {
  registry.get(canvas)?.destroy();
  registry.set(canvas, chart);
  return chart;
}
export function destroyAll() {
  registry.forEach((c) => c.destroy());
  registry.clear();
}

function baseOptions({ yFormat, xTicks = 6, legend = false, stacked = false, horizontal = false } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduced() ? false : undefined,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: legend, labels: { color: css("--muted"), boxWidth: 12, usePointStyle: true } },
      tooltip: { callbacks: yFormat ? { label: (ctx) => `${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${yFormat(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } : {} },
    },
    scales: {
      x: { stacked, ticks: { maxTicksLimit: xTicks, color: css("--muted") }, grid: { display: false } },
      y: { stacked, ticks: { color: css("--muted"), callback: yFormat ? (v) => yFormat(v) : undefined }, grid: { color: css("--grid") } },
    },
  };
}

export async function lineChart(canvas, { labels, datasets, yFormat, legend, fill = false }) {
  if (!canvas) return null;
  await ensureChart();
  if (typeof Chart === "undefined" || !canvas.isConnected) return null;
  return track(canvas, new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        borderColor: css(d.color || SERIES[i]),
        backgroundColor: fill && i === 0 ? css("--chart-fill") : "transparent",
        fill: fill && i === 0,
        pointRadius: 0,
        borderWidth: i === 0 ? 2 : 1.5,
        borderDash: d.dash,
        tension: 0.15,
        ...d,
        color: undefined,
      })),
    },
    options: baseOptions({ yFormat, legend: legend ?? datasets.length > 1 }),
  }));
}

export async function barChart(canvas, { labels, datasets, yFormat, legend, stacked = false, horizontal = false }) {
  if (!canvas) return null;
  await ensureChart();
  if (typeof Chart === "undefined" || !canvas.isConnected) return null;
  const opts = baseOptions({ yFormat, legend: legend ?? datasets.length > 1, stacked, xTicks: 12, horizontal });
  if (horizontal) {
    opts.indexAxis = "y";
    [opts.scales.x, opts.scales.y] = [opts.scales.y, opts.scales.x];
    opts.scales.y.ticks.maxTicksLimit = 40;
  }
  return track(canvas, new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        backgroundColor: Array.isArray(d.colors) ? d.colors.map(css) : css(d.color || SERIES[i]),
        borderRadius: 3,
        maxBarThickness: 36,
        ...d,
        color: undefined,
        colors: undefined,
      })),
    },
    options: opts,
  }));
}
