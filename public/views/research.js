import { el, fmtUSD, fmtPct, fmtCompact, api, isUnlocked } from "../shared.js";

let chartInstance = null;

function statRow(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function renderChart(canvas, points) {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  if (!points || !points.length || typeof Chart === "undefined") return;
  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => p.date),
      datasets: [{
        label: "Close",
        data: points.map((p) => p.close),
        borderColor: "#4f8cff",
        backgroundColor: "rgba(79,140,255,0.1)",
        pointRadius: 0,
        tension: 0.15,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: "#8d97ab" }, grid: { display: false } },
        y: { ticks: { color: "#8d97ab" }, grid: { color: "#1c2435" } },
      },
    },
  });
}

function renderNews(news) {
  if (!news || !news.length) return `<p class="muted">No recent news available (news requires a Finnhub API key).</p>`;
  return `<ul class="news-list">${news.map((n) => `
    <li>
      <a href="${n.url}" target="_blank" rel="noopener">${n.headline}</a>
      <div class="muted small">${n.source || ""} · ${n.datetime ? new Date(n.datetime).toLocaleDateString() : ""}</div>
    </li>
  `).join("")}</ul>`;
}

function renderPeers(peers) {
  if (!peers || !peers.length) return `<p class="muted">No peer data available.</p>`;
  return `<div class="chip-list">${peers.map((p) => `<a class="chip" href="#/research/${p}">${p}</a>`).join("")}</div>`;
}

function renderFinancials(financials) {
  if (!financials) return `<p class="muted">No SEC financial history available for this ticker.</p>`;
  const row = (label, series) => {
    if (!series || !series.length) return "";
    const latest = series[series.length - 1];
    return `<tr><td>${label}</td><td>${latest.end}</td><td>${fmtCompact(latest.val)}</td></tr>`;
  };
  return `
    <table class="mini-table">
      <thead><tr><th>Metric</th><th>As of</th><th>Value</th></tr></thead>
      <tbody>
        ${row("Revenue", financials.revenue)}
        ${row("Net Income", financials.netIncome)}
        ${row("EPS (diluted)", financials.eps)}
      </tbody>
    </table>
  `;
}

async function saveThesis(symbol) {
  const textarea = el("thesisInput");
  try {
    await api(`/api/research/${symbol}/thesis`, {
      method: "PUT",
      body: JSON.stringify({ author: "Fund member", thesis: textarea.value }),
    });
    el("thesisStatus").textContent = "Saved.";
    setTimeout(() => (el("thesisStatus").textContent = ""), 2000);
  } catch (err) {
    el("thesisStatus").textContent = `Error: ${err.message}`;
  }
}

export async function mount(container, params) {
  const symbol = (params.symbol || "").toUpperCase();
  container.innerHTML = `<p class="muted">Loading research on ${symbol}...</p>`;

  let data;
  try {
    data = await api(`/api/research/${symbol}`);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load research for ${symbol}: ${err.message}</p>`;
    return;
  }

  const profile = data.profile || {};
  const summaryDetail = data.stats.summaryDetail || {};
  const keyStats = data.stats.defaultKeyStatistics || {};
  const financialData = data.stats.financialData || {};

  const price = financialData.currentPrice?.raw ?? summaryDetail.previousClose?.raw ?? null;
  const unlocked = isUnlocked();

  container.innerHTML = `
    <section class="research-header">
      <div>
        <h2>${symbol} <span class="muted">${profile.sector ? `· ${profile.sector}` : ""}</span></h2>
        <p class="muted">${profile.industry || ""}</p>
      </div>
      <div class="price-tag">${price !== null ? fmtUSD(price) : "—"}</div>
    </section>

    <section class="summary">
      ${statRow("Market Cap", fmtCompact(summaryDetail.marketCap?.raw))}
      ${statRow("P/E (TTM)", summaryDetail.trailingPE?.raw?.toFixed(2) ?? "—")}
      ${statRow("52W Range", summaryDetail.fiftyTwoWeekLow?.raw && summaryDetail.fiftyTwoWeekHigh?.raw ? `${fmtUSD(summaryDetail.fiftyTwoWeekLow.raw)} – ${fmtUSD(summaryDetail.fiftyTwoWeekHigh.raw)}` : "—")}
      ${statRow("Dividend Yield", summaryDetail.dividendYield?.raw ? fmtPct(summaryDetail.dividendYield.raw * 100) : "—")}
      ${statRow("Analyst Rec.", data.stats.recommendationTrend?.trend?.[0]?.strongBuy !== undefined ? "See trend" : "—")}
    </section>

    <section class="research-grid">
      <div class="panel">
        <h3>Price (1Y)</h3>
        <canvas id="priceChart" height="220"></canvas>
      </div>
      <div class="panel">
        <h3>About</h3>
        <p class="muted small">${profile.longBusinessSummary ? profile.longBusinessSummary.slice(0, 500) + (profile.longBusinessSummary.length > 500 ? "…" : "") : "No company profile available."}</p>
      </div>
      <div class="panel">
        <h3>Fundamentals (SEC)</h3>
        ${renderFinancials(data.financials)}
      </div>
      <div class="panel">
        <h3>Peers / Competitors</h3>
        ${renderPeers(data.peers)}
      </div>
      <div class="panel">
        <h3>News</h3>
        ${renderNews(data.news)}
      </div>
      <div class="panel">
        <h3>Team Thesis</h3>
        <textarea id="thesisInput" rows="6" ${unlocked ? "" : "disabled"} placeholder="${unlocked ? "Write the fund's thesis, risks, and price target..." : "Unlock editing to write a thesis."}">${data.thesis?.thesis || ""}</textarea>
        ${unlocked ? `<button id="saveThesisBtn" class="btn btn-primary">Save thesis</button>` : ""}
        <span id="thesisStatus" class="muted small"></span>
      </div>
    </section>
  `;

  renderChart(el("priceChart"), data.chart);

  if (unlocked) {
    el("saveThesisBtn").addEventListener("click", () => saveThesis(symbol));
  }
}
