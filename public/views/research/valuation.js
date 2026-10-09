import { el, esc, api, fmtUSD, fmtMoneyCompact, fmtRatio, loading, signed, fmtPct } from "../../shared.js";
import { term } from "../../glossary.js";

// ---- Peer comparison ----

// [key, label, format, higherIsCheaper?] — for valuation multiples, lower = cheaper.
const COLS = [
  ["marketCap", "Mkt cap", (v) => fmtMoneyCompact(v)],
  ["peTTM", "P/E", (v) => mult(v), true],
  ["forwardPE", "Fwd P/E", (v) => mult(v), true],
  ["evEbitda", "EV/EBITDA", (v) => mult(v), true],
  ["psTTM", "P/S", (v) => mult(v), true],
  ["pfcf", "P/FCF", (v) => mult(v), true],
  ["grossMargin", "Gross margin", (v) => pctPts(v)],
  ["operatingMargin", "Op margin", (v) => pctPts(v)],
  ["roe", "ROE", (v) => pctPts(v)],
  ["revenueGrowth", "Rev growth", (v) => pctPts(v)],
  ["return1Y", "1Y return", (v) => pctPts(v)],
];
// Glossary entry for each column header, where one exists.
const COL_TERM = { peTTM: "peRatio", forwardPE: "peRatio", evEbitda: "evEbitda", psTTM: "priceToSales", pfcf: "pfcf", roe: "roe" };
const mult = (v) => (v === null || v === undefined || !Number.isFinite(v) || v <= 0 ? "—" : `${v.toFixed(1)}×`);
const pctPts = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`);

let extraPeers = [];

async function loadComps(symbol) {
  const box = el("compsBody");
  box.innerHTML = loading("Pulling peer metrics…");
  let data;
  try {
    data = await api(`/api/research/${encodeURIComponent(symbol)}/comps${extraPeers.length ? `?add=${extraPeers.join(",")}` : ""}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load comparisons: ${esc(err.message)}</p>`;
    return;
  }
  if (data.keyMissing) {
    box.innerHTML = `<p class="muted">Peer comparisons need a Finnhub API key on the server.</p>`;
    return;
  }
  const self = data.rows.find((r) => r.symbol === symbol);
  const vsMedian = (key, cheap) => {
    const a = self?.[key], m = data.peerMedian[key];
    if (!Number.isFinite(a) || !Number.isFinite(m) || m === 0 || (cheap && (a <= 0 || m <= 0))) return "—";
    const d = (a / m - 1) * 100;
    if (cheap) return `<span>${d > 0 ? "+" : ""}${d.toFixed(0)}% ${d > 0 ? "premium" : "discount"}</span>`;
    return `${(a - m) >= 0 ? "+" : ""}${(a - m).toFixed(1)} pts`;
  };
  box.innerHTML = `
    <div class="table-scroll">
      <table class="comps-table">
        <caption class="sr-only">${esc(symbol)} compared with peers (trailing twelve months)</caption>
        <thead><tr><th scope="col" class="left sticky-col">Company</th>${COLS.map(([k, l]) => `<th scope="col" class="num">${COL_TERM[k] ? term(COL_TERM[k], l) : l}</th>`).join("")}</tr></thead>
        <tbody>
          ${data.rows.map((r) => `
            <tr class="${r.symbol === symbol ? "row-self" : ""}">
              <th scope="row" class="left sticky-col"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}/valuation">${esc(r.symbol)}</a></th>
              ${COLS.map(([k, , f]) => `<td class="num">${r.error ? "—" : f(r[k])}</td>`).join("")}
            </tr>`).join("")}
          <tr class="row-median"><th scope="row" class="left sticky-col">Peer median</th>${COLS.map(([k, , f]) => `<td class="num">${f(data.peerMedian[k])}</td>`).join("")}</tr>
          <tr class="row-vs"><th scope="row" class="left sticky-col">${esc(symbol)} vs median</th>${COLS.map(([k, , , cheap]) => `<td class="num small">${k === "marketCap" ? "" : vsMedian(k, cheap)}</td>`).join("")}</tr>
        </tbody>
      </table>
    </div>
    <form class="inline-form" id="addPeerForm">
      <label for="addPeer">Add a company to compare</label>
      <input id="addPeer" placeholder="Ticker" maxlength="10" autocomplete="off" />
      <button class="btn btn-ghost btn-sm">Add</button>
      ${extraPeers.length ? `<button type="button" class="btn-link small" id="resetPeers">Reset to default peers</button>` : ""}
    </form>
    <p class="muted small">A premium can be justified by faster growth or higher margins — compare the right-hand columns before calling it expensive.</p>`;
  el("addPeerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = el("addPeer").value.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,10}$/.test(s) && !extraPeers.includes(s)) {
      extraPeers.push(s);
      loadComps(symbol);
    }
  });
  el("resetPeers")?.addEventListener("click", () => { extraPeers = []; loadComps(symbol); });
}

// ---- DCF workbench ----

// Two-stage DCF: `g` for years 1–5, linear fade to terminal growth over years 6–10.
function dcfValue({ fcf, g, gT, r, shares, netCash }) {
  if (!(r > gT) || !fcf || !shares) return null;
  let pv = 0, cf = fcf;
  for (let t = 1; t <= 10; t++) {
    const gt = t <= 5 ? g : g + ((gT - g) * (t - 5)) / 5;
    cf *= 1 + gt;
    pv += cf / Math.pow(1 + r, t);
  }
  const tv = (cf * (1 + gT)) / (r - gT);
  pv += tv / Math.pow(1 + r, 10);
  return { perShare: (pv + netCash) / shares, terminalShare: tv / Math.pow(1 + r, 10) / pv };
}

// Reverse DCF: what years-1–5 growth does today's price imply?
function impliedGrowth(params, price) {
  let lo = -0.5, hi = 1.5;
  const f = (g) => dcfValue({ ...params, g })?.perShare ?? NaN;
  if (!(f(lo) < price && f(hi) > price)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < price) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function dcfPanel(symbol, data, price) {
  const d = data.analysis?.dcf;
  if (!d || !d.fcf) return `<p class="muted">Not enough cash-flow history in SEC filings to build a DCF for ${esc(symbol)}.</p>`;
  const analystGrowth = data.street?.estimates?.find((e) => e.period === "+1y")?.growth;
  const defaultG = Math.max(-0.05, Math.min(0.25, analystGrowth ?? d.revenueCagr ?? 0.06));
  const netCash = (d.cash || 0) - (d.debt || 0);
  return `
    <form id="dcfForm" class="dcf-grid" novalidate>
      <fieldset>
        <legend>Assumptions</legend>
        <label>Starting free cash flow
          <select id="dcfBase">
            <option value="${d.fcf}">Last fiscal year: ${fmtMoneyCompact(d.fcf)}</option>
            ${d.fcfAvg3 ? `<option value="${d.fcfAvg3}">3-year average: ${fmtMoneyCompact(d.fcfAvg3)}</option>` : ""}
          </select>
        </label>
        <label>Growth, years 1–5 (%)
          <input id="dcfG" type="number" step="0.5" value="${(defaultG * 100).toFixed(1)}" inputmode="decimal" />
          <span class="field-hint">${analystGrowth != null ? `Analysts expect ${(analystGrowth * 100).toFixed(1)}% EPS growth next year. ` : ""}${d.revenueCagr != null ? `Revenue grew ${(d.revenueCagr * 100).toFixed(1)}%/yr historically.` : ""}</span>
        </label>
        <label for="dcfGT"><span>${term("terminalGrowth", "Terminal growth (%)")}</span>
          <input id="dcfGT" type="number" step="0.25" value="2.5" inputmode="decimal" />
          <span class="field-hint">Long-run growth after year 10; usually 2–3% (≈ GDP).</span>
        </label>
        <label for="dcfR"><span>${term("wacc", "Discount rate / WACC (%)")}</span>
          <input id="dcfR" type="number" step="0.25" value="9" inputmode="decimal" />
          <span class="field-hint">Your required return. ~8–10% for large caps, higher for small or risky firms.</span>
        </label>
        <p class="muted small">Net cash ${fmtMoneyCompact(netCash)} · ${fmtMoneyCompact(d.shares).replace("$", "")} shares · FY ending ${esc(d.fiscalYearEnd)}</p>
      </fieldset>
      <div class="dcf-out" aria-live="polite">
        <div class="dcf-result">
          <span class="muted small">Intrinsic value per share</span>
          <strong id="dcfValue">—</strong>
          <span id="dcfUpside" class="small"></span>
        </div>
        <div class="dcf-result">
          <span class="muted small">Growth the market is pricing in (${term("reverseDcf", "reverse DCF")})</span>
          <strong id="dcfImplied">—</strong>
          <span class="small muted">per year for 5 years, at your discount rate</span>
        </div>
        <p id="dcfTerminal" class="muted small"></p>
        <div class="table-scroll">
          <table class="mini-table sens-table" id="dcfSens"><caption class="cap">Sensitivity: value per share</caption></table>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="dcfToPitch">Use this value as a pitch target</button>
      </div>
    </form>`;
}

function wireDcf(symbol, data, price) {
  const d = data.analysis?.dcf;
  if (!d || !el("dcfForm")) return;
  const netCash = (d.cash || 0) - (d.debt || 0);
  const params = () => ({
    fcf: Number(el("dcfBase").value),
    g: Number(el("dcfG").value) / 100,
    gT: Number(el("dcfGT").value) / 100,
    r: Number(el("dcfR").value) / 100,
    shares: d.shares,
    netCash,
  });
  let last = null;
  const update = () => {
    const p = params();
    const v = dcfValue(p);
    last = v?.perShare ?? null;
    el("dcfValue").textContent = v ? fmtUSD(v.perShare) : "Check inputs (discount rate must exceed terminal growth)";
    el("dcfUpside").innerHTML = v && price ? `${signed((v.perShare / price - 1) * 100, fmtPct((v.perShare / price - 1) * 100), { neutral: true })} vs ${fmtUSD(price)} today` : "";
    el("dcfTerminal").textContent = v ? `Terminal value is ${(v.terminalShare * 100).toFixed(0)}% of the total — ${v.terminalShare > 0.75 ? "the valuation rests heavily on the far future; be skeptical of precision." : "a reasonable share."}` : "";
    const ig = price ? impliedGrowth(p, price) : null;
    el("dcfImplied").textContent = ig === null ? "—" : `${(ig * 100).toFixed(1)}%`;
    const rs = [p.r - 0.02, p.r - 0.01, p.r, p.r + 0.01, p.r + 0.02];
    const gs = [p.gT - 0.01, p.gT - 0.005, p.gT, p.gT + 0.005, p.gT + 0.01];
    el("dcfSens").innerHTML = `<caption class="cap">Sensitivity: value per share (rows = discount rate, columns = terminal growth). ▲ / ▼ = more than 15% above / below today's price.</caption>
      <thead><tr><th scope="col">WACC \\ g</th>${gs.map((g) => `<th scope="col" class="num">${(g * 100).toFixed(1)}%</th>`).join("")}</tr></thead>
      <tbody>${rs.map((r) => `<tr><th scope="row">${(r * 100).toFixed(1)}%</th>${gs.map((g) => {
        const val = dcfValue({ ...p, r, gT: g })?.perShare;
        // Neutral marks, not green/red: a model value above the price isn't a buy call.
        const mark = val && price ? (val > price * 1.15 ? "above" : val < price * 0.85 ? "below" : "") : "";
        const center = r === p.r && g === p.gT ? " sens-center" : "";
        return `<td class="num${mark ? ` sens-${mark}` : ""}${center}">${val ? fmtUSD(val).replace(/\.\d+$/, "") : "—"}${mark ? ` <span aria-hidden="true">${mark === "above" ? "▲" : "▼"}</span><span class="sr-only">(${mark} today's price)</span>` : ""}</td>`;
      }).join("")}</tr>`).join("")}</tbody>`;
  };
  el("dcfForm").addEventListener("input", update);
  update();
  el("dcfToPitch").addEventListener("click", () => {
    try { sessionStorage.setItem("pif_pitch_prefill", JSON.stringify({ symbol, basePrice: last ? Number(last.toFixed(2)) : null, valuation: `DCF: ${el("dcfG").value}% growth yrs 1–5, ${el("dcfGT").value}% terminal, ${el("dcfR").value}% WACC → ${last ? fmtUSD(last) : "n/a"}/share.` })); } catch { /* ignore */ }
    location.hash = `#/pitches/new/${encodeURIComponent(symbol)}`;
  });
}

export async function render(c, { symbol, data, price, isFinancial }) {
  extraPeers = [];
  const ks = data.street?.keyStats || {};
  c.innerHTML = `
    <section class="summary" aria-label="Valuation multiples">
      <div class="stat"><div class="label">${term("evEbitda", "EV / EBITDA")}</div><div class="value">${mult(ks.evToEbitda)}</div></div>
      <div class="stat"><div class="label">${term("evRevenue", "EV / Revenue")}</div><div class="value">${mult(ks.evToRevenue)}</div></div>
      <div class="stat"><div class="label">${term("peg")}</div><div class="value">${Number.isFinite(ks.peg) ? ks.peg.toFixed(2) : "—"}</div><div class="sub">P/E ÷ expected growth (a rough comparison, not a fair-value line)</div></div>
      <div class="stat"><div class="label">${term("priceToBook", "Price / Book")}</div><div class="value">${mult(ks.priceToBook)}</div></div>
      <div class="stat"><div class="label">${term("fcfYield", "FCF yield")}</div><div class="value">${Number.isFinite(ks.freeCashflow) && Number.isFinite(data.stats.summaryDetail?.marketCap?.raw) ? fmtRatio(ks.freeCashflow / data.stats.summaryDetail.marketCap.raw) : "—"}</div><div class="sub">Free cash flow / market cap</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="comps-h">
        <div class="panel-head"><h3 id="comps-h">Peer comparison</h3><span class="muted small">Trailing twelve months · Finnhub</span></div>
        <div id="compsBody"></div>
      </section>
      <section class="panel span-full" aria-labelledby="dcf-h">
        <div class="panel-head"><h3 id="dcf-h">Discounted cash flow</h3><span class="muted small">Prefilled from SEC filings — change any assumption</span></div>
        ${isFinancial ? `<p class="notice small">DCFs on free cash flow don't work for banks and insurers (deposits and float distort cash flow). Use P/B and ROE from the peer table instead.</p>` : dcfPanel(symbol, data, price)}
      </section>
    </div>`;
  if (!isFinancial) wireDcf(symbol, data, price);
  await loadComps(symbol);
}
