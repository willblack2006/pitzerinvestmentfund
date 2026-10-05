import { el, esc, fmtRatio, fmtMoneyCompact, fmtPct, signed, fmtX } from "../../shared.js";
import { barChart } from "../../charts.js";

const growth = (cur, prev) => (cur !== null && prev ? (cur - prev) / Math.abs(prev) : null);

function annualTable(rows) {
  const ys = rows.slice(-5);
  const fy = (r) => `FY ${esc(r.end.slice(0, 4))}<span class="sr-only"> (ended ${esc(r.end)})</span>`;
  const line = (label, f, opts = {}) => `<tr class="${opts.cls || ""}"><th scope="row">${label}${opts.hint ? ` <span class="hint" title="${esc(opts.hint)}" aria-label="${esc(opts.hint)}">?</span>` : ""}</th>${ys.map((r, i) => `<td class="num">${f(r, i)}</td>`).join("")}</tr>`;
  const pct = (key) => (r) => fmtRatio(r[key]);
  return `
    <div class="table-scroll">
      <table class="fin-table">
        <caption class="sr-only">Annual financials from 10-K filings, oldest to newest</caption>
        <thead><tr><th scope="col">Fiscal year</th>${ys.map((r) => `<th scope="col" class="num">${fy(r)}</th>`).join("")}</tr></thead>
        <tbody>
          <tr class="group"><th colspan="${ys.length + 1}" scope="rowgroup">Growth &amp; profitability</th></tr>
          ${line("Revenue", (r) => fmtMoneyCompact(r.revenue))}
          ${line("Revenue growth", (r, i) => { const g = growth(r.revenue, (ys[i - 1] || rows[rows.length - ys.length - 1])?.revenue); return g === null ? "—" : signed(g * 100, fmtPct(g * 100)); })}
          ${line("Gross margin", pct("grossMargin"))}
          ${line("Operating margin", pct("operatingMargin"))}
          ${line("Net margin", pct("netMargin"))}
          <tr class="group"><th colspan="${ys.length + 1}" scope="rowgroup">Cash generation</th></tr>
          ${line("Free cash flow", (r) => fmtMoneyCompact(r.fcf), { hint: "Operating cash flow minus capital expenditures" })}
          ${line("FCF margin", pct("fcfMargin"))}
          <tr class="group"><th colspan="${ys.length + 1}" scope="rowgroup">Returns on capital</th></tr>
          ${line("ROE", pct("roe"), { hint: "Net income / shareholders' equity. Inflated when buybacks shrink equity." })}
          ${line("ROIC", pct("roic"), { hint: "After-tax operating income / (debt + equity − cash). Above ~10–12% usually beats the cost of capital." })}
          <tr class="group"><th colspan="${ys.length + 1}" scope="rowgroup">Balance sheet</th></tr>
          ${line("Net debt", (r) => (r.netDebt === null ? "—" : r.netDebt < 0 ? `<span class="gain-pos">${fmtMoneyCompact(-r.netDebt)} net cash</span>` : fmtMoneyCompact(r.netDebt)))}
          ${line("Net debt / EBITDA", (r) => (r.netDebtToEbitda === null ? "—" : r.netDebtToEbitda < 0 ? "Net cash" : fmtX(r.netDebtToEbitda)))}
          ${line("Current ratio", (r) => fmtX(r.currentRatio, 2))}
          ${line("Interest coverage", (r) => (r.interestCoverage === null ? "—" : fmtX(r.interestCoverage)))}
          <tr class="group"><th colspan="${ys.length + 1}" scope="rowgroup">Per share</th></tr>
          ${line("Diluted shares", (r) => (r.dilutedShares ? fmtMoneyCompact(r.dilutedShares).replace("$", "") : "—"))}
          ${line("Share count change", (r, i) => { const g = growth(r.dilutedShares, (ys[i - 1] || rows[rows.length - ys.length - 1])?.dilutedShares); return g === null ? "—" : `${g > 0 ? "+" : ""}${(g * 100).toFixed(1)}% ${g < -0.005 ? '<span class="muted small">buybacks</span>' : g > 0.02 ? '<span class="muted small">dilution</span>' : ""}`; })}
          ${line("Shareholder yield", (r, i) => (i === ys.length - 1 ? fmtRatio(r.shareholderYield) : "—"), { hint: "(Dividends + buybacks) / market cap, latest year" })}
        </tbody>
      </table>
    </div>`;
}

function scoreCard({ title, value, verdict, tone, children, note, id }) {
  return `
    <section class="panel score-card" aria-labelledby="${id}">
      <div class="panel-head"><h3 id="${id}">${title}</h3><span class="score-verdict tone-${tone}">${esc(verdict)}</span></div>
      <div class="score-value">${value}</div>
      ${children}
      ${note ? `<p class="muted small">${note}</p>` : ""}
    </section>`;
}

function piotroskiCard(p) {
  if (!p) return scoreCard({ id: "pio-h", title: "Piotroski F-score", value: "—", verdict: "No data", tone: "neutral", children: "", note: "Needs two fiscal years of filings." });
  const tone = p.verdict === "Strong" ? "good" : p.verdict === "Weak" ? "bad" : "neutral";
  return scoreCard({
    id: "pio-h", title: "Piotroski F-score", value: `${p.score}<span class="score-of">/${p.outOf}</span>`, verdict: p.verdict, tone,
    children: `<ul class="checklist">${p.tests.map((t) => `<li class="${t.pass === null ? "na" : t.pass ? "pass" : "fail"}"><span aria-hidden="true">${t.pass === null ? "–" : t.pass ? "✓" : "✗"}</span> <span class="sr-only">${t.pass === null ? "No data:" : t.pass ? "Pass:" : "Fail:"}</span>${esc(t.name)}</li>`).join("")}</ul>`,
    note: "Nine pass/fail tests of profitability, balance-sheet health and efficiency (Piotroski 2000). 7–9 = strong, 0–3 = weak.",
  });
}

function altmanCard(a, isFinancial) {
  if (isFinancial) return scoreCard({ id: "alt-h", title: "Altman Z-score", value: "n/a", verdict: "Not applicable", tone: "neutral", children: "", note: "Designed for industrial companies; bank and insurer balance sheets make it meaningless." });
  if (!a || a.z === null) return scoreCard({ id: "alt-h", title: "Altman Z-score", value: "—", verdict: a?.zone || "No data", tone: "neutral", children: "", note: "Missing balance-sheet inputs." });
  const tone = a.zone === "Safe" ? "good" : a.zone === "Distress" ? "bad" : "neutral";
  const pos = Math.max(0, Math.min(100, (a.z / 6) * 100));
  return scoreCard({
    id: "alt-h", title: "Altman Z-score", value: a.z.toFixed(2), verdict: a.zone, tone,
    children: `<div class="zone-bar" aria-hidden="true"><span class="zone z-bad" style="flex:1.81"></span><span class="zone z-mid" style="flex:1.18"></span><span class="zone z-good" style="flex:3.01"></span><span class="zone-marker" style="left:${pos}%"></span></div>
      <div class="zone-labels small muted" aria-hidden="true"><span>Distress &lt;1.81</span><span>Grey</span><span>Safe &gt;2.99</span></div>`,
    note: "Bankruptcy-risk model from working capital, retained earnings, EBIT, market value and sales relative to assets (Altman 1968).",
  });
}

function beneishCard(b, isFinancial) {
  if (isFinancial) return scoreCard({ id: "ben-h", title: "Beneish M-score", value: "n/a", verdict: "Not applicable", tone: "neutral", children: "", note: "Not designed for financial companies." });
  if (!b) return scoreCard({ id: "ben-h", title: "Beneish M-score", value: "—", verdict: "No data", tone: "neutral", children: "", note: "" });
  const tone = b.verdict === "No red flag" ? "good" : b.verdict.startsWith("Possible") ? "bad" : "neutral";
  const names = { DSRI: "Receivables vs sales", GMI: "Gross margin decline", AQI: "Asset quality", SGI: "Sales growth", DEPI: "Depreciation slowdown", SGAI: "SG&A vs sales", LVGI: "Leverage increase", TATA: "Accruals vs assets" };
  return scoreCard({
    id: "ben-h", title: "Beneish M-score", value: b.m.toFixed(2), verdict: b.verdict, tone,
    children: `<details class="small"><summary>Index detail</summary><dl class="facts">${Object.entries(b.indices).map(([k, v]) => `<dt>${names[k]}${b.missing.includes(k) ? " (no data)" : ""}</dt><dd>${v.toFixed(2)}</dd>`).join("")}</dl></details>`,
    note: "Above −1.78 suggests earnings may be inflated (Beneish 1999). Big acquisitions or hyper-growth can trip it — read it as “dig into the accounting”, not proof.",
  });
}

export async function render(c, { symbol, data, isFinancial }) {
  const an = data.analysis;
  if (!an || !an.annual.length) {
    c.innerHTML = `<div class="page-pad"><p class="muted">No SEC financial statements for ${esc(symbol)}. Common for ETFs, funds and non-US companies that file 20-F/40-F reports.</p></div>`;
    return;
  }
  const q = an.quarterly;
  const qLabels = q.revenue.map((p) => p.end);
  const niByEnd = new Map(q.netIncome.map((p) => [p.end, p.val]));

  c.innerHTML = `
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="fy-h">
        <div class="panel-head"><h3 id="fy-h">Annual financials</h3><span class="muted small">Source: SEC 10-K filings (XBRL)</span></div>
        ${annualTable(an.annual)}
        ${isFinancial ? `<p class="notice small">Banks and insurers report revenue and cash flow differently; margins, FCF and ROIC above aren't comparable to industrial companies. Focus on ROE and book value.</p>` : ""}
      </section>
      <section class="panel span-full" aria-labelledby="q-h">
        <div class="panel-head"><h3 id="q-h">Quarterly revenue &amp; net income</h3><span class="muted small">Last ${qLabels.length} quarters (10-Q; fiscal Q4 is inside the 10-K)</span></div>
        <div class="chart-box chart-sm"><canvas id="qChart" role="img" aria-label="${esc(`Quarterly revenue for ${symbol}: ${q.revenue.map((p) => `${p.end} ${fmtMoneyCompact(p.val)}`).join(", ")}`)}"></canvas></div>
      </section>
      ${piotroskiCard(isFinancial ? null : an.piotroski)}
      ${altmanCard(an.altman, isFinancial)}
      ${beneishCard(an.beneish, isFinancial)}
    </div>`;

  barChart(el("qChart"), {
    labels: qLabels,
    datasets: [
      { label: "Revenue", data: q.revenue.map((p) => p.val) },
      { label: "Net income", data: qLabels.map((d) => niByEnd.get(d) ?? null) },
    ],
    yFormat: (v) => fmtMoneyCompact(v),
  });
}
