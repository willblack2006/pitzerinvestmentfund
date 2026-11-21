// #/compare/:symbols (WS10): 2 to 5 tickers side by side. Normalised price (all start at 100),
// key metrics as small multiples, and revenue growth against operating margin. Each ticker
// keeps its colour (by position in the list, never by rank).
import { api, esc, pageHead, skeleton, errorState, bindRetry, fmtMoneyCompact, icon } from "../shared.js";
import { timeChart } from "../tvchart.js";
import { linear, niceTicks, responsiveSvg, tooltip, dataToggle, fmtPrice, fmtSignedPct } from "../viz/rv.js";

export const title = (p) => `Compare ${String(p.symbols || "").toUpperCase().split(",").filter(Boolean).join(", ")}`.trim();

const COLORS = ["--s1", "--s2", "--s3", "--s4", "--s5"];
const FRAMES = ["6M", "1Y", "2Y", "5Y"];
let frame = "1Y";

// [key, label, format, better] better: "high" | "low" | null (no judgement)
const GROUPS = [
  ["Valuation", [["pe", "P/E", "x", "low"], ["forwardPe", "Forward P/E", "x", "low"], ["evEbitda", "EV/EBITDA", "x", "low"]]],
  ["Growth", [["revenueGrowth", "Revenue growth", "%", "high"], ["earningsGrowth", "Earnings growth", "%", "high"]]],
  ["Profitability", [["grossMargin", "Gross margin", "%", "high"], ["operatingMargin", "Operating margin", "%", "high"], ["roe", "Return on equity", "%", "high"]]],
  ["Risk and return", [["change", "Return over period", "%", "high"], ["maxDrawdown", "Worst drop from a peak", "%", "high"], ["vol", "Volatility (annual)", "%", "low"], ["beta", "Beta", "n", null]]],
];
const fmtVal = (v, f) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : f === "x" ? `${v.toFixed(1)}×` : f === "%" ? `${v.toFixed(1)}%` : v.toFixed(2));

const parse = (s) => [...new Set(String(s || "").toUpperCase().split(",").map((x) => x.trim()).filter((x) => /^[A-Z0-9.\-^=]{1,12}$/.test(x)))].slice(0, 5);

export async function mount(c, params) {
  const symbols = parse(params.symbols);
  c.innerHTML = `${pageHead("Compare", "Two to five companies side by side: price since the same start, valuation, growth, profitability and risk.")}
    <form class="cmp-pick" id="cmpForm" aria-label="Tickers to compare">
      <ul class="cmp-chips">${symbols.map((s, i) => `<li class="cmp-chip" style="--c:var(${COLORS[i]})"><i aria-hidden="true"></i><a href="#/research/${encodeURIComponent(s)}">${esc(s)}</a><button type="button" class="ct-chip-x" data-rm="${esc(s)}" aria-label="Remove ${esc(s)}">${icon("x", { size: 14 })}</button></li>`).join("")}</ul>
      ${symbols.length < 5 ? `<label class="sr-only" for="cmpAdd">Add a ticker</label><input id="cmpAdd" data-ticker placeholder="Add ticker" maxlength="12" autocomplete="off" /><button class="btn btn-ghost btn-sm">Add</button>` : `<span class="muted small">Five is the most.</span>`}
    </form>
    <div id="cmpBody">${symbols.length < 2 ? `<p class="muted">Add at least two tickers. Try <a href="#/compare/NVDA,AMD,AVGO">NVDA, AMD, AVGO</a>.</p>` : skeleton("cards", { rows: 3, label: "Loading prices and metrics" })}</div>`;
  const go = (list) => { location.hash = `#/compare/${list.join(",")}`; };
  c.querySelector("#cmpForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const add = parse(c.querySelector("#cmpAdd")?.value);
    if (add.length) go([...new Set([...symbols, ...add])].slice(0, 5));
  });
  c.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => go(symbols.filter((s) => s !== b.dataset.rm))));
  if (symbols.length >= 2) await load(c, symbols);
}

async function load(c, symbols) {
  const box = c.querySelector("#cmpBody");
  let d;
  try {
    d = await api(`/api/compare?symbols=${symbols.join(",")}&frame=${frame}`);
  } catch (err) {
    box.innerHTML = errorState({ title: "Couldn't load the comparison.", detail: err.message, retryId: "cmp" });
    bindRetry(box, "cmp", () => load(c, symbols));
    return;
  }
  const color = (s) => COLORS[symbols.indexOf(s)] || "--muted";
  const missing = Object.entries(d.errors || {}).filter(([, e]) => e).map(([s]) => s);
  const best = d.series.filter((s) => s.change !== null).sort((a, b) => b.change - a.change);
  box.innerHTML = `
    <section class="panel" aria-labelledby="cmpPx-h">
      <div class="panel-head"><h3 id="cmpPx-h">Price, all starting at 100</h3>
        <div class="rv-seg" role="group" aria-label="Timeframe">${FRAMES.map((f) => `<button type="button" class="rv-seg-btn" data-frame="${f}" aria-pressed="${f === frame}">${f}</button>`).join("")}</div></div>
      ${best.length ? `<p>${best.map((s) => `<strong>${esc(s.symbol)}</strong> ${fmtSignedPct(s.change)}`).join(" · ")}${best[0]?.from ? ` <span class="muted small">since ${esc(best[0].from)}</span>` : ""}</p>` : ""}
      ${missing.length ? `<p class="muted small">No prices for ${missing.map(esc).join(", ")}.</p>` : ""}
      <div class="chart-box"><div id="cmpChart" role="img" aria-label="${esc(`Price of ${symbols.join(", ")} rebased to 100: ${best.map((s) => `${s.symbol} ${fmtSignedPct(s.change)}`).join(", ")}.`)}"></div></div>
    </section>
    <div class="cmp-multiples">
      ${GROUPS.map(([g, metrics]) => `<section class="panel" aria-labelledby="cmp-${g.replace(/\W/g, "")}">
        <h3 id="cmp-${g.replace(/\W/g, "")}">${esc(g)}</h3>
        ${metrics.map(([k, label, f, better]) => smallMultiple(d.metrics, k, label, f, better, color)).join("")}
      </section>`).join("")}
    </div>
    <section class="panel" aria-labelledby="cmpSc-h">
      <div class="panel-head"><h3 id="cmpSc-h">Growth against profitability</h3><span class="muted small">Revenue growth (across) and operating margin (up); bubble size is market cap</span></div>
      <div id="cmpScatter" class="rv-chart"></div>
    </section>`;
  box.querySelectorAll("[data-frame]").forEach((b) => b.addEventListener("click", () => { frame = b.dataset.frame; box.innerHTML = skeleton("cards", { rows: 3, label: "Loading" }); load(c, symbols); }));
  timeChart(box.querySelector("#cmpChart"), {
    series: d.series.filter((s) => s.points.length).map((s) => ({ label: s.symbol, times: s.points.map((p) => p.date), values: s.points.map((p) => p.value), color: color(s.symbol) })),
    yFormat: (v) => v.toFixed(0),
    refLines: [{ series: 0, price: 100, label: "Start", color: "--muted" }],
    caption: `Prices rebased to 100, ${frame}`,
  });
  tooltip(box.querySelector(".cmp-multiples"));
  scatter(box.querySelector("#cmpScatter"), d.metrics, color);
}

function smallMultiple(metrics, k, label, f, better, color) {
  const vals = metrics.map((m) => m[k]).filter(Number.isFinite);
  if (!vals.length) return `<div class="cmp-sm"><div class="cmp-sm-label">${esc(label)}</div><p class="muted small">No data</p></div>`;
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const x = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const leader = better ? metrics.filter((m) => Number.isFinite(m[k])).sort((a, b) => (better === "high" ? b[k] - a[k] : a[k] - b[k]))[0]?.symbol : null;
  return `<div class="cmp-sm"><div class="cmp-sm-label">${esc(label)}${leader ? ` <span class="muted small">· ${better === "high" ? "highest" : "lowest"}: ${esc(leader)}</span>` : ""}</div>
    <ul class="cmp-bars">${metrics.map((m) => {
      const v = m[k];
      const ok = Number.isFinite(v);
      const left = ok ? Math.min(x(0), x(v)) : 0, width = ok ? Math.max(0.6, Math.abs(x(v) - x(0))) : 0;
      return `<li tabindex="0" data-tip="${esc(`<strong>${esc(m.symbol)}</strong> · ${esc(label)}: ${fmtVal(v, f)}`)}"><span class="cmp-bar-sym">${esc(m.symbol)}</span><span class="cmp-bar-track">${ok ? `<span class="cmp-bar" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;--c:var(${color(m.symbol)})"></span>` : ""}${lo < 0 ? `<span class="cmp-zero" style="left:${x(0).toFixed(1)}%"></span>` : ""}</span><span class="cmp-bar-val">${fmtVal(v, f)}</span></li>`;
    }).join("")}</ul></div>`;
}

function scatter(host, metrics, color) {
  const pts = metrics.filter((m) => Number.isFinite(m.revenueGrowth) && Number.isFinite(m.operatingMargin));
  if (pts.length < 2) { host.innerHTML = `<p class="muted">Needs revenue growth and operating margin for at least two of these.</p>`; return; }
  const xs = pts.map((m) => m.revenueGrowth), ys = pts.map((m) => m.operatingMargin);
  const xt = niceTicks(Math.min(0, ...xs), Math.max(...xs), 5), yt = niceTicks(Math.min(0, ...ys), Math.max(...ys), 4);
  const maxCap = Math.max(1, ...pts.map((m) => m.marketCap || 0));
  responsiveSvg(host, `Revenue growth against operating margin: ${pts.map((m) => `${m.symbol} ${m.revenueGrowth.toFixed(0)}% growth, ${m.operatingMargin.toFixed(0)}% margin`).join("; ")}.`, (W) => {
    const H = 260, P = { l: 44, r: 16, t: 12, b: 34 };
    const x = linear([xt[0], xt.at(-1)], [P.l, W - P.r]), y = linear([yt[0], yt.at(-1)], [H - P.b, P.t]);
    const r = (cap) => 6 + Math.sqrt((cap || 0) / maxCap) * 14;
    return {
      height: H,
      html: `
        ${xt.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--grid)"/><text x="${x(t)}" y="${H - P.b + 16}" text-anchor="middle" class="rv-axis-text">${t}%</text>`).join("")}
        ${yt.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end" class="rv-axis-text">${t}%</text>`).join("")}
        ${xt[0] < 0 ? `<line x1="${x(0)}" x2="${x(0)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--border-strong)"/>` : ""}
        <text x="${W - P.r}" y="${H - 4}" text-anchor="end" class="rv-axis-text">Revenue growth →</text>
        <text x="${P.l + 4}" y="${P.t + 10}" class="rv-axis-text">↑ Operating margin</text>
        ${pts.map((m) => `<g tabindex="0" data-tip="${esc(`<strong>${esc(m.symbol)}</strong><br>Revenue growth ${m.revenueGrowth.toFixed(1)}%<br>Operating margin ${m.operatingMargin.toFixed(1)}%<br>Market cap ${fmtMoneyCompact(m.marketCap)}`)}">
          <circle cx="${x(m.revenueGrowth)}" cy="${y(m.operatingMargin)}" r="${r(m.marketCap)}" fill="var(${color(m.symbol)})" fill-opacity=".75" stroke="var(--panel)" stroke-width="2"/>
          <text x="${x(m.revenueGrowth) + r(m.marketCap) + 4}" y="${y(m.operatingMargin) + 4}" class="rv-point-label">${esc(m.symbol)}</text></g>`).join("")}`,
    };
  });
  tooltip(host);
  dataToggle(host, "Revenue growth and operating margin", ["Ticker", "Revenue growth", "Operating margin", "Market cap", "Price"],
    pts.map((m) => [m.symbol, `${m.revenueGrowth.toFixed(1)}%`, `${m.operatingMargin.toFixed(1)}%`, fmtMoneyCompact(m.marketCap), fmtPrice(m.price)]));
}
