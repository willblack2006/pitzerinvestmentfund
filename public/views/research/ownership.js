import { el, esc, api, fmtMoneyCompact, fmtRatio, fmtNum, signed, fmtPct, loading } from "../../shared.js";
import { insiderCodeLabel, insiderShares } from "../insiders.js";

export async function render(c, { symbol, data }) {
  const o = data.street?.ownership;
  c.innerHTML = `
    <section class="summary" aria-label="Ownership summary">
      <div class="stat"><div class="label">Institutions own</div><div class="value">${fmtRatio(o?.institutionsPct)}</div><div class="sub">${o?.institutionsCount ? `${fmtNum(o.institutionsCount)} institutions` : ""}</div></div>
      <div class="stat"><div class="label">Insiders own</div><div class="value">${fmtRatio(o?.insidersPct)}</div><div class="sub">Officers, directors, founders</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="inst-h">
        <div class="panel-head"><h3 id="inst-h">Largest institutional holders</h3><span class="muted small">From 13F filings (quarterly, ~45-day lag)</span></div>
        ${o?.holders?.length ? `
          <div class="table-scroll"><table class="mini-table">
            <caption class="sr-only">Top institutional holders of ${esc(symbol)}</caption>
            <thead><tr><th scope="col">Holder</th><th scope="col" class="num">% held</th><th scope="col" class="num">Value</th><th scope="col" class="num">Change last qtr</th><th scope="col">As of</th></tr></thead>
            <tbody>${o.holders.map((h) => `<tr><td>${esc(h.name)}</td><td class="num">${fmtRatio(h.pctHeld, 2)}</td><td class="num">${fmtMoneyCompact(h.value)}</td>
              <td class="num">${h.pctChange != null ? signed(h.pctChange * 100, fmtPct(h.pctChange * 100)) : "—"}</td><td>${esc(h.reportDate || "")}</td></tr>`).join("")}</tbody>
          </table></div>
          <p class="muted small">Big index funds (Vanguard, BlackRock, State Street) hold nearly everything; changes by active managers are more telling.</p>` : `<p class="muted">No institutional ownership data.</p>`}
      </section>
      <section class="panel span-full" aria-labelledby="ins-h">
        <div class="panel-head"><h3 id="ins-h">Insider transactions</h3><span class="muted small">SEC Form 4 · <a href="#/insiders">all holdings →</a></span></div>
        <div id="insiderBody">${loading("Loading Form 4 filings…")}</div>
      </section>
    </div>`;

  try {
    const res = await api(`/api/insiders/${encodeURIComponent(symbol)}`);
    const tx = res.transactions || [];
    const target = el("insiderBody");
    if (!target) return;
    if (!tx.length) {
      target.innerHTML = `<p class="muted">${res.error ? "Insider data unavailable (needs a Finnhub API key)." : "No recent Form 4 filings."}</p>`;
      return;
    }
    const buys = tx.filter((t) => t.transactionCode === "P"), sells = tx.filter((t) => t.transactionCode === "S");
    target.innerHTML = `
      <p class="small">${buys.length} open-market buy${buys.length === 1 ? "" : "s"} and ${sells.length} sale${sells.length === 1 ? "" : "s"} in the recent window. ${buys.length ? "<strong>Insider buying is a meaningful signal</strong> — they rarely buy without conviction." : ""}</p>
      <div class="table-scroll"><table class="mini-table">
        <caption class="sr-only">Recent insider transactions for ${esc(symbol)}</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Insider</th><th scope="col">Type</th><th scope="col" class="num">Shares</th></tr></thead>
        <tbody>${tx.slice(0, 15).map((t) => `
          <tr><td>${esc(t.transactionDate || "—")}</td><td>${esc(t.name || "—")}</td>
          <td><span class="code-pill code-${esc(t.transactionCode || "x")}">${esc(t.transactionCode || "—")}</span> ${esc(insiderCodeLabel(t.transactionCode))}</td>
          <td class="num">${insiderShares(t)}</td></tr>`).join("")}
        </tbody></table></div>`;
  } catch (err) {
    const target = el("insiderBody");
    if (target) target.innerHTML = `<p class="muted">Could not load insider data: ${esc(err.message)}</p>`;
  }
}
