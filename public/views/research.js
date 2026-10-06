import {
  el, esc, safeUrl, fmtUSD, fmtPct, fmtCompact, fmtNum, fmtRatio, api, isUnlocked, toast, lockedHint, signed,
  loading, errorBox, fundContext, invalidateContext, pushRecent, statusBadge, tabNav,
} from "../shared.js";
import { lineChart, destroyAll } from "../charts.js";

const TABS = [
  ["overview", "Overview"],
  ["financials", "Financials"],
  ["valuation", "Valuation"],
  ["street", "Street"],
  ["risk", "Risk"],
  ["ownership", "Ownership"],
  ["options", "Options"],
  ["filings", "Filings"],
  ["thesis", "Thesis"],
];
// Loaded on demand — most visits only ever look at Overview, so the other tabs (each with
// its own charts/tables) shouldn't cost anything until a reader actually clicks one.
const TAB_LOADERS = {
  financials: () => import("./research/financials.js"),
  valuation: () => import("./research/valuation.js"),
  street: () => import("./research/street.js"),
  risk: () => import("./research/risk.js"),
  ownership: () => import("./research/ownership.js"),
  options: () => import("./research/options.js"),
  filings: () => import("./research/filings.js"),
};

export const title = (params) => {
  const tab = TABS.find(([k]) => k === params.tab);
  return `${(params.symbol || "").toUpperCase()}${tab && tab[0] !== "overview" ? ` · ${tab[1]}` : ""}`;
};

// One fetch per ticker; switching tabs reuses it (5-minute freshness).
let cache = null;
async function loadData(symbol, force = false) {
  // Reuse across tab switches for a minute, so the price stays near-live.
  if (!force && cache?.symbol === symbol && Date.now() - cache.at < 60 * 1000) return cache;
  const [data, fund] = await Promise.all([api(`/api/research/${encodeURIComponent(symbol)}`), fundContext()]);
  cache = { symbol, data, fund, at: Date.now() };
  return cache;
}
export function invalidateResearch() { cache = null; }
// Holdings/watchlist changes elsewhere make the cached Owned/Watching state stale.
window.addEventListener("pif:context-changed", () => { cache = null; });

// Yahoo values arrive as { raw } objects, sometimes as strings like "Infinity" or {} when
// missing; only finite numbers get through.
const num = (v) => { const x = v && typeof v === "object" ? v.raw : v; return typeof x === "number" && Number.isFinite(x) ? x : null; };

function stat(label, value, sub = "") {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function rangeStat(lo, hi, price) {
  if (!lo || !hi) return stat("52-week range", "—");
  const pos = price ? Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100)) : null;
  return stat("52-week range", `<span class="range-val">${fmtUSD(lo)} – ${fmtUSD(hi)}</span>`,
    pos === null ? "" : `${pos.toFixed(0)}% of range<span class="range-track" aria-hidden="true"><span class="range-dot" style="left:${pos}%"></span></span>`);
}

function chartSummary(points) {
  if (!points?.length) return null;
  const first = points[0], last = points[points.length - 1];
  const closes = points.map((p) => p.close);
  return { first, last, hi: Math.max(...closes), lo: Math.min(...closes), chg: ((last.close - first.close) / first.close) * 100 };
}

export function analystConsensus(trend) {
  const t = trend?.[0];
  if (!t) return null;
  const buy = (t.strongBuy || 0) + (t.buy || 0), hold = t.hold || 0, sell = (t.sell || 0) + (t.strongSell || 0);
  const total = buy + hold + sell;
  if (!total) return null;
  const score = (buy - sell) / total;
  const label = score >= 0.6 ? "Strong buy" : score >= 0.25 ? "Buy" : score > -0.25 ? "Hold" : score > -0.6 ? "Sell" : "Strong sell";
  return { buy, hold, sell, total, label };
}

const isFinancialSector = (data) => /financial/i.test(data.profile?.sector || "");

// ---- Overview tab ----

function renderOverview(c, { symbol, data, fund, price }) {
  const sd = data.stats.summaryDetail || {};
  const ks = data.stats.defaultKeyStatistics || {};
  const st = data.street;
  const an = data.analysis;
  const cs = chartSummary(data.chart);
  const consensus = analystConsensus(st?.trend);
  const lastFy = an?.annual?.at(-1);
  const profile = data.profile || {};
  const next = st?.nextEarnings?.dates?.[0];
  const daysToEarnings = next ? Math.ceil((new Date(next) - new Date()) / 864e5) : null;

  // Snapshot: the handful of numbers an analyst checks first, each linking to its tab.
  const snap = [
    ["Upside to target", st?.targets?.upside != null ? signed(st.targets.upside * 100, fmtPct(st.targets.upside * 100)) : "—", "street", st?.targets?.mean ? `Mean target ${fmtUSD(st.targets.mean)} · ${st.targets.analysts} analysts` : ""],
    ["Piotroski F-score", an?.piotroski && !isFinancialSector(data) ? `${an.piotroski.score}/${an.piotroski.outOf}` : "—", "financials", an?.piotroski && !isFinancialSector(data) ? an.piotroski.verdict : isFinancialSector(data) ? "Not meaningful for financials" : ""],
    isFinancialSector(data)
      ? ["ROE (last FY)", fmtRatio(lastFy?.roe), "financials", "Key return metric for financials"]
      : ["ROIC (last FY)", fmtRatio(lastFy?.roic), "financials", lastFy ? `FCF margin ${fmtRatio(lastFy.fcfMargin)}` : ""],
    ["Beta", st?.keyStats?.beta != null ? st.keyStats.beta.toFixed(2) : "—", "risk", st?.shortInterest?.pctFloat != null ? `Short interest ${fmtRatio(st.shortInterest.pctFloat)} of float` : ""],
    ["Next earnings", next ? esc(next) : "—", "street", daysToEarnings !== null ? `${daysToEarnings >= 0 ? `in ${daysToEarnings} days` : "date passed"}${st.nextEarnings.estimated ? " (estimated)" : ""}` : ""],
  ];

  c.innerHTML = `
    <section class="summary" aria-label="Key statistics">
      ${stat("Market cap", fmtCompact(num(sd.marketCap)))}
      ${stat("P/E", num(sd.trailingPE)?.toFixed(1) ?? "—", num(ks.forwardPE) ? `Forward ${num(ks.forwardPE).toFixed(1)}` : "")}
      ${rangeStat(num(sd.fiftyTwoWeekLow), num(sd.fiftyTwoWeekHigh), price)}
      ${stat("Dividend yield", num(sd.dividendYield) ? `${(num(sd.dividendYield) * 100).toFixed(2)}%` : "—", st?.exDividendDate ? `Ex-div ${esc(st.exDividendDate)}` : "")}
      ${stat("Analyst consensus", consensus ? consensus.label : "—",
        consensus ? `${consensus.buy} buy · ${consensus.hold} hold · ${consensus.sell} sell<span class="consensus-bar" aria-hidden="true"><span style="flex:${consensus.buy}" class="c-buy"></span><span style="flex:${consensus.hold}" class="c-hold"></span><span style="flex:${consensus.sell}" class="c-sell"></span></span>` : "")}
    </section>

    <section class="snapshot" aria-label="Analyst snapshot">
      ${snap.map(([label, value, tab, sub]) => `
        <a class="snap" href="#/research/${encodeURIComponent(symbol)}/${tab}">
          <span class="snap-label">${label}</span>
          <span class="snap-value">${value}</span>
          ${sub ? `<span class="snap-sub">${sub}</span>` : ""}
        </a>`).join("")}
    </section>

    <div class="research-layout">
      <div class="research-main">
        ${data.position ? renderPosition(data.position, price) : ""}
        <section class="panel" aria-labelledby="exec-h">
          <h3 id="exec-h">Execution helper</h3>
          <div class="form-row">
            <label class="field-inline">Direction
              <select id="execDir"><option value="buy">Buy</option><option value="sell">Sell</option></select>
            </label>
            <label class="field-inline">Order size (shares) <input id="execShares" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 100" /></label>
          </div>
          <div id="execBody" class="small">${loading("Loading live bid/ask…")}</div>
        </section>
        <section class="panel" aria-labelledby="chart-h">
          <div class="panel-head"><h3 id="chart-h">Price, past year</h3>
            <a class="small" href="#/research/${encodeURIComponent(symbol)}/risk">Compare with the market →</a></div>
          <div class="chart-box">
            <canvas id="priceChart" role="img" aria-label="${cs ? esc(`${symbol} closing price over the past year: from ${fmtUSD(cs.first.close)} on ${cs.first.date} to ${fmtUSD(cs.last.close)} on ${cs.last.date}, ${fmtPct(cs.chg)}. High ${fmtUSD(cs.hi)}, low ${fmtUSD(cs.lo)}.`) : "No price data"}"></canvas>
          </div>
          ${data.technicals?.sma50 ? `<p class="muted small chart-note">50-day avg ${fmtUSD(data.technicals.sma50)}${data.technicals.sma200 ? ` · 200-day avg ${fmtUSD(data.technicals.sma200)}` : ""}</p>` : ""}
        </section>
        <section class="panel" aria-labelledby="news-h">
          <div class="panel-head"><h3 id="news-h">News</h3><div id="newsTriageActions"></div></div>
          <div id="newsBody">${renderNews(data.news, !!data.errors?.news)}</div>
        </section>
      </div>
      <aside class="research-side" aria-label="Company context">
        <section class="panel" aria-labelledby="about-h">
          <h3 id="about-h">About</h3>
          ${profile.longBusinessSummary ? `
            <details class="about">
              <summary>${esc(profile.longBusinessSummary.slice(0, 280))}${profile.longBusinessSummary.length > 280 ? "… <span class=\"btn-link\">Read more</span>" : ""}</summary>
              <p class="small">${esc(profile.longBusinessSummary.slice(280))}</p>
            </details>` : `<p class="muted">No company profile available.</p>`}
          <dl class="facts small">
            ${profile.fullTimeEmployees ? `<dt>Employees</dt><dd>${fmtNum(profile.fullTimeEmployees)}</dd>` : ""}
            ${profile.city ? `<dt>HQ</dt><dd>${esc([profile.city, profile.state, profile.country].filter(Boolean).join(", "))}</dd>` : ""}
          </dl>
          ${profile.website ? `<p class="small"><a href="${safeUrl(profile.website)}" target="_blank" rel="noopener">Company website<span class="sr-only"> (opens in new tab)</span></a></p>` : ""}
        </section>
        <section class="panel" aria-labelledby="peers-h">
          <h3 id="peers-h">Peers &amp; competitors</h3>
          ${renderPeers(data.peers, fund, symbol)}
        </section>
        <section class="panel" aria-labelledby="supply-h">
          <h3 id="supply-h">Supply chain</h3>
          <div id="supplyBody">${loading("Checking the latest 10-K for major customers…")}</div>
        </section>
        <section class="panel" aria-labelledby="factor-h">
          <div class="panel-head"><h3 id="factor-h">Factor profile</h3><a class="small" href="#/factors">Fund scorecard →</a></div>
          <div id="factorBody">${loading("Scoring factors…")}</div>
        </section>
      </aside>
    </div>`;

  lineChart(el("priceChart"), {
    labels: data.chart.map((p) => p.date),
    datasets: [{ label: symbol, data: data.chart.map((p) => p.close), color: "--chart-line" }],
    yFormat: (v) => `$${Number(v).toFixed(0)}`,
    legend: false,
    fill: true,
  });
  loadFactorProfile(symbol);
  loadExecution(symbol);
  loadNewsTriage(symbol, data.news, !!data.errors?.news);
  loadSupplyChain(symbol);
  el("execDir")?.addEventListener("change", () => loadExecution(symbol));
  el("execShares")?.addEventListener("input", () => loadExecution(symbol));
}

let execTimer = null;
async function loadExecution(symbol) {
  clearTimeout(execTimer);
  execTimer = setTimeout(async () => {
    const box = el("execBody");
    if (!box) return;
    const dir = el("execDir")?.value || "buy";
    const shares = el("execShares")?.value;
    let r;
    try {
      r = await api(`/api/execution/${encodeURIComponent(symbol)}?direction=${dir}${shares ? `&shares=${encodeURIComponent(shares)}` : ""}`);
    } catch (err) {
      if (el("execBody")) box.innerHTML = `<p class="muted">Couldn't load execution data: ${esc(err.message)}</p>`;
      return;
    }
    if (!el("execBody")) return;
    if (r.error || r.mid === null) { box.innerHTML = `<p class="muted">${esc(r.error || "No bid/ask quote available for this ticker.")}</p>`; return; }
    box.innerHTML = `
      <dl class="facts">
        <dt>Bid / Ask</dt><dd>${fmtUSD(r.bid)} / ${fmtUSD(r.ask)}</dd>
        <dt>Spread</dt><dd>${r.spreadPct != null ? fmtRatio(r.spreadPct, 2) : "—"}</dd>
        <dt>Avg daily volume</dt><dd>${r.avgDailyVolume ? fmtNum(r.avgDailyVolume) : "—"}</dd>
        ${r.participationPct != null ? `<dt>Order vs avg volume</dt><dd>${fmtRatio(r.participationPct, 2)}</dd>` : ""}
        ${r.estimatedCostBps != null ? `<dt>Est. cost</dt><dd>~${r.estimatedCostBps.toFixed(0)} bps</dd>` : ""}
        ${r.suggestedLimitPrice != null ? `<dt>Suggested limit</dt><dd>${fmtUSD(r.suggestedLimitPrice)}</dd>` : ""}
      </dl>
      ${r.warnings?.length ? `<ul class="link-list small">${r.warnings.map((w) => `<li class="tone-bad">${esc(w)}</li>`).join("")}</ul>` : `<p class="muted small">No execution warnings right now.</p>`}
      <p class="muted small">A rough estimate from the current bid/ask and 3-month average volume — not a guaranteed fill price.</p>`;
  }, 300);
}

async function loadSupplyChain(symbol) {
  const box = el("supplyBody");
  if (!box) return;
  let r;
  try {
    r = await api(`/api/research/${encodeURIComponent(symbol)}/supply-chain`);
  } catch (err) {
    if (el("supplyBody")) box.innerHTML = `<p class="muted">Couldn't check the supply chain: ${esc(err.message)}</p>`;
    return;
  }
  if (!el("supplyBody")) return;
  if (!r.customers?.length) { box.innerHTML = `<p class="muted small">No major-customer disclosure (≥10% of revenue) found in the latest 10-K.</p>`; return; }
  box.innerHTML = `
    <ul class="link-list small">${r.customers.map((c) => `
      <li>${c.ticker ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(c.ticker)}">${esc(c.ticker)}</a>` : esc(c.customer)} — ${c.pct}% of revenue
        ${c.gap != null ? `<div class="muted">Customer's 3-month return ${signed(c.customerReturn * 100, fmtPct(c.customerReturn * 100))} vs ${esc(symbol)}'s ${signed(c.supplierReturn * 100, fmtPct(c.supplierReturn * 100))}</div>` : ""}</li>`).join("")}</ul>
    <p class="muted small">From the ${esc(r.filing?.filingDate || "")} 10-K. A big customer's recent return can lead a supplier's (Cohen &amp; Frazzini, 2008) — not a signal by itself.</p>`;
}

const FACTOR_LABEL = [["value", "Value"], ["momentum", "Momentum"], ["quality", "Quality"], ["lowVol", "Low volatility"], ["size", "Size"]];
async function loadFactorProfile(symbol) {
  const box = el("factorBody");
  if (!box) return;
  let f;
  try {
    f = await api(`/api/factors/${encodeURIComponent(symbol)}`);
  } catch (err) {
    if (el("factorBody")) box.innerHTML = `<p class="muted">Couldn't score factors: ${esc(err.message)}</p>`;
    return;
  }
  if (!el("factorBody")) return;
  if (f.error) { box.innerHTML = `<p class="muted">No factor data available.</p>`; return; }
  box.innerHTML = `
    <dl class="facts">${FACTOR_LABEL.map(([k, label]) => `<dt>${label}</dt><dd>${Number.isFinite(f[k]) ? `${Math.round(f[k])}<span class="small muted">/100</span>` : "—"}</dd>`).join("")}</dl>
    <p class="muted small">Percentile vs the fund's holdings + watchlist (100 = best in the group, 50 = neutral).</p>`;
}

function renderPosition(p, price) {
  const mv = price ? p.shares * price : p.marketValue;
  const gain = mv - p.totalCost;
  const gainPct = p.totalCost ? (gain / p.totalCost) * 100 : null;
  return `
    <section class="panel position-panel" aria-labelledby="pos-h">
      <h3 id="pos-h">The fund's position</h3>
      <div class="kv-grid kv-4">
        <div><span class="muted small">Shares</span><strong>${p.shares.toLocaleString()}</strong></div>
        <div><span class="muted small">Avg cost</span><strong>${fmtUSD(p.avgCost)}</strong></div>
        <div><span class="muted small">Value${price ? " (live)" : ""}</span><strong>${fmtUSD(mv)}</strong></div>
        <div><span class="muted small">Gain</span><strong>${signed(gain, fmtUSD(gain))}${gainPct !== null ? ` <span class="small">(${fmtPct(gainPct)})</span>` : ""}</strong></div>
      </div>
      ${p.notes ? `<p class="muted small">Note: ${esc(p.notes)}</p>` : ""}
    </section>`;
}

const TRIAGE_TONE = { positive: "tone-good", negative: "tone-bad", neutral: "" };
function renderNews(news, errored, triageBySymbolUrl = {}) {
  if (!news || !news.length) {
    return `<p class="muted">${errored ? "News is unavailable right now (needs a Finnhub API key on the server)." : "No news in the last two weeks."}</p>`;
  }
  return `<ul class="news-list">${news.slice(0, 8).map((n) => {
    const t = triageBySymbolUrl[n.url];
    return `
    <li>
      <a href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}<span class="sr-only"> (opens in new tab)</span></a>
      ${t?.materiality != null ? `<span class="badge ${t.materiality >= 7 ? "badge-danger" : t.materiality >= 4 ? "badge-warn" : ""}" title="${esc(t.reason || "")}">Materiality ${t.materiality}/10 <span class="${TRIAGE_TONE[t.direction] || ""}">${esc(t.direction || "")}</span></span>` : ""}
      <div class="muted small">${esc(n.source || "")}${n.datetime ? ` · ${new Date(n.datetime).toLocaleDateString()}` : ""}${t?.reason ? ` — ${esc(t.reason)}` : ""}</div>
    </li>`;
  }).join("")}</ul>`;
}

async function loadNewsTriage(symbol, newsList, errored) {
  const actions = el("newsTriageActions");
  if (!actions) return;
  let r;
  try { r = await api(`/api/research/${encodeURIComponent(symbol)}/news-triage`); } catch { return; }
  if (!el("newsTriageActions")) return;
  const byUrl = Object.fromEntries((r.items || []).map((n) => [n.url, n]));
  const body = el("newsBody");
  if (body) body.innerHTML = renderNews(newsList, errored, byUrl);
  if (isUnlocked() && r.aiEnabled) {
    actions.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" id="triageBtn">Score with Claude</button>`;
    el("triageBtn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Scoring…";
      try {
        const res = await api(`/api/research/${encodeURIComponent(symbol)}/news-triage`, { method: "POST" });
        const byUrl2 = Object.fromEntries((res.items || []).map((n) => [n.url, n]));
        if (el("newsBody")) el("newsBody").innerHTML = renderNews(newsList, errored, byUrl2);
        actions.innerHTML = "";
      } catch (err) {
        toast(err.message, { type: "error" });
        e.target.disabled = false;
        e.target.textContent = "Score with Claude";
      }
    });
  }
}

function renderPeers(peers, fund, symbol) {
  if (!peers || !peers.length) return `<p class="muted">No peer data available.</p>`;
  return `<div class="chip-list">${peers.map((p) => `
    <a class="chip" href="#/research/${encodeURIComponent(p)}">${esc(p)}${statusBadge(p, fund)}</a>`).join("")}</div>
    <p class="muted small"><a href="#/research/${encodeURIComponent(symbol)}/valuation">Compare valuations side by side →</a></p>`;
}

// ---- Thesis tab: team thesis + target, price alerts, pitches ----

let dirty = false;
function onBeforeUnload(e) {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
}

const thesisMeta = (t) =>
  t?.updatedAt ? `Last edited${t.author ? ` by <strong>${esc(t.author)}</strong>` : ""} on ${esc(t.updatedAt.slice(0, 10))}` : "No thesis written yet.";

function renderThesisTab(c, { symbol, data, price, unlocked }) {
  const t = data.thesis;
  let author = "";
  try { author = localStorage.getItem("pif_author") || ""; } catch { /* ignore */ }
  const sinceThesis = t?.priceAtThesis && price ? price / t.priceAtThesis - 1 : null;
  const toTarget = t?.targetPrice && price ? t.targetPrice / price - 1 : null;

  c.innerHTML = `
    <div class="research-layout">
      <div class="research-main">
        <section class="panel" aria-labelledby="thesis-h">
          <div class="panel-head"><h3 id="thesis-h">Team thesis</h3><span class="muted small" id="thesisMeta">${thesisMeta(t)}</span></div>
          ${t?.targetPrice ? `
            <div class="kv-grid kv-4 thesis-kpis">
              <div><span class="muted small">Team target</span><strong>${fmtUSD(t.targetPrice)}</strong></div>
              <div><span class="muted small">Upside from here</span><strong>${toTarget !== null ? signed(toTarget * 100, fmtPct(toTarget * 100)) : "—"}</strong></div>
              <div><span class="muted small">Price when set</span><strong>${t.priceAtThesis ? fmtUSD(t.priceAtThesis) : "—"}</strong></div>
              <div><span class="muted small">Move since</span><strong>${sinceThesis !== null ? signed(sinceThesis * 100, fmtPct(sinceThesis * 100)) : "—"}</strong></div>
            </div>` : ""}
          ${unlocked ? `
            <label for="thesisInput" class="field-label">Thesis</label>
            <textarea id="thesisInput" rows="10" placeholder="Why own it? Key risks, catalysts, valuation, and what would make us sell…"></textarea>
            <div class="thesis-actions">
              <label class="inline-label">Target price ($) <input id="thesisTarget" type="number" step="any" min="0" inputmode="decimal" value="${t?.targetPrice ?? ""}" /></label>
              <label class="inline-label">Your name <input id="thesisAuthor" value="${esc(author)}" autocomplete="name" /></label>
              <button id="saveThesisBtn" class="btn btn-primary">Save thesis</button>
              <span id="thesisStatus" class="muted small" role="status"></span>
            </div>
            <p class="muted small">Setting a target locks in today's price so the call can be graded later. Price alerts and the Portfolio alerts feed flag when it's reached.</p>` : `
            <div id="thesisRead" class="thesis-read">${t?.thesis ? "" : `<p class="muted">No thesis yet.</p>`}</div>
            ${lockedHint("Unlock to write or edit the thesis.")}`}
        </section>
      </div>
      <aside class="research-side">
        <section class="panel" aria-labelledby="pitch-h">
          <h3 id="pitch-h">Pitches</h3>
          ${data.pitches.length ? `<ul class="link-list">${data.pitches.map((p) => `
            <li><a href="#/pitches/${p.id}">${esc(p.direction.toUpperCase())} ${esc(symbol)}</a>
              <span class="status-pill status-${esc(p.status)}">${esc(p.status)}</span>
              <div class="muted small">${esc(p.author)} · ${esc(p.createdAt.slice(0, 10))}${p.basePrice ? ` · base ${fmtUSD(p.basePrice)}` : ""}</div></li>`).join("")}</ul>`
            : `<p class="muted">No pitches yet.</p>`}
          <p><a class="btn btn-ghost btn-sm" href="#/pitches/new/${encodeURIComponent(symbol)}">+ Start a pitch</a></p>
        </section>
        <section class="panel" aria-labelledby="alerts-h">
          <h3 id="alerts-h">Price alerts</h3>
          <ul class="link-list" id="alertList">
            ${data.priceAlerts.map((a) => `<li>${a.direction === "above" ? "Rises above" : "Falls below"} <strong>${fmtUSD(a.price)}</strong>${a.note ? ` <span class="muted small">— ${esc(a.note)}</span>` : ""}
              ${unlocked ? `<button class="btn-link small" data-del-alert="${a.id}" aria-label="Delete alert at ${fmtUSD(a.price)}">Remove</button>` : ""}</li>`).join("") || `<li class="muted">No alerts set.</li>`}
          </ul>
          ${unlocked ? `
            <form id="alertForm" class="alert-form">
              <label class="sr-only" for="alertDir">Direction</label>
              <select id="alertDir"><option value="above">Above</option><option value="below">Below</option></select>
              <label class="sr-only" for="alertPrice">Price</label>
              <input id="alertPrice" type="number" step="any" min="0" placeholder="Price" required inputmode="decimal" />
              <button class="btn btn-ghost btn-sm">Add alert</button>
            </form>` : lockedHint("Unlock to set alerts.")}
        </section>
      </aside>
    </div>`;

  if (unlocked) {
    let draft = null;
    try { draft = localStorage.getItem(`pif_draft_${symbol}`); } catch { /* ignore */ }
    el("thesisInput").value = draft ?? (t?.thesis || "");
    if (draft !== null && draft !== (t?.thesis || "")) {
      dirty = true;
      el("thesisStatus").textContent = "Restored your unsaved draft";
    }
    el("thesisInput").addEventListener("input", (e) => {
      dirty = true;
      el("thesisStatus").textContent = "Unsaved changes";
      try { localStorage.setItem(`pif_draft_${symbol}`, e.target.value); } catch { /* ignore */ }
    });
    el("saveThesisBtn").addEventListener("click", () => saveThesis(symbol, price));
    window.addEventListener("beforeunload", onBeforeUnload);

    el("alertForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/api/price-alerts", { method: "POST", body: JSON.stringify({ symbol, direction: el("alertDir").value, price: Number(el("alertPrice").value) }) });
        toast("Alert added.", { type: "success" });
        rerender(true);
      } catch (err) { toast(err.message, { type: "error" }); }
    });
    c.querySelectorAll("[data-del-alert]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await api(`/api/price-alerts/${b.dataset.delAlert}`, { method: "DELETE" });
        rerender(true);
      } catch (err) { toast(err.message, { type: "error" }); }
    }));
  } else if (t?.thesis) {
    el("thesisRead").textContent = t.thesis;
  }
}

async function saveThesis(symbol, price) {
  const author = el("thesisAuthor").value.trim();
  if (!author) {
    el("thesisAuthor").setAttribute("aria-invalid", "true");
    el("thesisStatus").textContent = "Add your name so the team knows who wrote this.";
    el("thesisAuthor").focus();
    return;
  }
  el("thesisAuthor").removeAttribute("aria-invalid");
  try { localStorage.setItem("pif_author", author); } catch { /* ignore */ }
  const btn = el("saveThesisBtn");
  btn.disabled = true;
  try {
    await api(`/api/research/${encodeURIComponent(symbol)}/thesis`, {
      method: "PUT",
      body: JSON.stringify({ author, thesis: el("thesisInput").value, targetPrice: el("thesisTarget").value, priceAtThesis: price }),
    });
    dirty = false;
    try { localStorage.removeItem(`pif_draft_${symbol}`); } catch { /* ignore */ }
    toast(`Thesis for ${symbol} saved.`, { type: "success" });
    rerender(true);
  } catch (err) {
    el("thesisStatus").textContent = `Not saved: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function rerender(force) {
  if (force) cache = null;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// ---- Page shell ----

export async function mount(container, params) {
  const symbol = (params.symbol || "").toUpperCase();
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : "overview";
  window.removeEventListener("beforeunload", onBeforeUnload);
  dirty = false;
  destroyAll();

  if (!cache || cache.symbol !== symbol) container.innerHTML = loading(`Loading research on ${symbol}…`);
  let ctx;
  try {
    ctx = await loadData(symbol);
  } catch (err) {
    container.innerHTML = `<div class="page-head"><h2>${esc(symbol)}</h2></div>${errorBox(`Could not load research for ${symbol}: ${err.message}`)}`;
    return;
  }
  const { data, fund } = ctx;

  if (data.notFound) {
    container.innerHTML = `
      <div class="page-head"><h2>No results for “${esc(symbol)}”</h2></div>
      <div class="page-pad">
        <p>We couldn't find price or company data for that ticker. Check the spelling, or try the share-class format (e.g. <code>BRK-B</code> or <code>BRK.B</code>).</p>
        <p class="muted">Not a stock? ETFs and funds have price data but no SEC fundamentals.</p>
        <p><a href="#/research">← Back to Research</a></p>
      </div>`;
    return;
  }

  pushRecent(symbol);
  const profile = data.profile || {};
  const price = data.technicals?.price ?? null;
  const unlocked = isUnlocked();
  const cs = chartSummary(data.chart);
  const owned = !!data.position, watched = !!data.watch;
  const base = `#/research/${encodeURIComponent(symbol)}`;

  const actions = [];
  if (data.redFlags?.length) actions.push(`<a class="badge badge-danger" href="#/research/${encodeURIComponent(symbol)}/filings" title="${esc(data.redFlags.map((f) => f.detail).join(" · "))}">${data.redFlags.length} red flag${data.redFlags.length > 1 ? "s" : ""}</a>`);
  if (owned) actions.push(`<span class="badge badge-owned">Owned</span>`);
  else if (watched) actions.push(`<span class="badge badge-watch">Watching</span>`);
  else if (unlocked) actions.push(`<button id="watchBtn" class="btn btn-ghost">+ Watch</button>`);
  if (!owned && unlocked) actions.push(`<button id="addPosBtn" class="btn btn-ghost">+ Add to holdings</button>`);
  actions.push(`<a class="btn btn-ghost" href="#/pitches/new/${encodeURIComponent(symbol)}">Pitch it</a>`);
  actions.push(`<button id="copyLinkBtn" class="btn btn-ghost" aria-label="Copy link to this page">Copy link</button>`);

  const partial = Object.entries(data.errors || {}).filter(([, v]) => v).map(([k]) => k);

  container.innerHTML = `
    <div class="page-head research-head">
      <div>
        <h2>${esc(symbol)}${data.name ? ` <span class="company-name">${esc(data.name)}</span>` : ""}</h2>
        <p class="muted page-desc">${[profile.sector, profile.industry].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</p>
      </div>
      <div class="research-price">
        <div class="price-tag">${price !== null ? fmtUSD(price) : "—"}</div>
        <div class="small">
          ${data.quote?.changePct != null ? `${signed(data.quote.changePct, fmtPct(data.quote.changePct))} <span class="muted">${["REGULAR", "POST"].includes(data.quote.marketState) ? "today" : "last session"}</span>` : ""}
          ${cs ? `${data.quote?.changePct != null ? " · " : ""}${signed(cs.chg, fmtPct(cs.chg))} <span class="muted">1Y</span>` : ""}
        </div>
        ${data.quote?.time ? `<div class="muted small">${{ REGULAR: "Live", PRE: "Pre-market", POST: "After hours" }[data.quote.marketState] || "At close"} · ${esc(new Date(data.quote.time).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }))} ET</div>` : ""}
      </div>
      <div class="page-actions">${actions.join("")}</div>
    </div>
    ${tabNav(TABS.map(([k, label]) => [k, k === "overview" ? base : `${base}/${k}`, label]), tab, `${symbol} research sections`)}
    ${partial.length && tab === "overview" ? `<p class="notice" role="note">Some data couldn't be loaded (${partial.map(esc).join(", ")}). The rest of the page is still accurate.</p>` : ""}
    <div id="tabBody"></div>`;

  const body = el("tabBody");
  const tctx = { symbol, data, fund, price, unlocked, isFinancial: isFinancialSector(data) };
  if (tab === "overview") renderOverview(body, tctx);
  else if (tab === "thesis") renderThesisTab(body, tctx);
  else {
    body.innerHTML = loading(`Loading ${tab}…`);
    const mod = await TAB_LOADERS[tab]();
    if (el("tabBody") !== body) return; // navigated away while the tab's code was loading
    await mod.render(body, tctx);
  }

  el("copyLinkBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied.");
    } catch {
      toast("Couldn't copy — use the address bar.", { type: "error" });
    }
  });
  // Pulls in holdings.js (the biggest view file) only on the rare click that needs its
  // dialog, instead of every Research page visit paying for it.
  el("addPosBtn")?.addEventListener("click", async () => {
    const { openPositionDialog } = await import("./holdings.js");
    openPositionDialog(null, { symbol, lastPrice: price ?? "" });
  });
  el("watchBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api("/api/watchlist", { method: "POST", body: JSON.stringify({ symbol, sourcedFrom: "research page" }) });
      invalidateContext(); // also clears this page's cache, so the next visit shows "Watching"
      btn.outerHTML = `<span class="badge badge-watch" tabindex="-1" id="watchBadge">Watching</span>`;
      el("watchBadge").focus();
      toast(`${symbol} added to the watchlist.`, { type: "success" });
    } catch (err) {
      btn.disabled = false;
      toast(err.message, { type: "error" });
    }
  });
}
