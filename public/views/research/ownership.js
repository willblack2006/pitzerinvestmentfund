import { el, esc, api, safeUrl, fmtMoneyCompact, fmtRatio, fmtNum, signed, fmtPct, loading } from "../../shared.js";
import { insiderCodeLabel, insiderShares } from "../insiders.js";
import { scoreMeter, signalBadge, kindTag } from "../insiderSignal.js";

async function renderSignal(symbol) {
  const box = el("signalBody");
  let r;
  try {
    r = await api(`/api/insiders/${encodeURIComponent(symbol)}/signal`);
  } catch (err) {
    if (box) box.innerHTML = `<p class="muted">Couldn't compute the insider signal: ${esc(err.message)}</p>`;
    return;
  }
  if (!el("signalBody")) return;
  if (r.error) {
    box.innerHTML = `<p class="muted">${/FINNHUB/.test(r.error) ? "Insider data needs a Finnhub API key on the server." : `Insider data unavailable: ${esc(r.error)}`}</p>`;
    return;
  }
  const trades = r.recent.filter((t) => t.kind);
  box.innerHTML = `
    <div class="sig-head">
      ${signalBadge(r.score, r.label)}
      ${scoreMeter(r.score)}
      <span class="muted small">−100 heavy informed selling · +100 strong informed buying</span>
    </div>
    <ul class="sig-reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${trades.length ? `
      <div class="table-scroll"><table class="mini-table">
        <caption class="cap">Open-market trades, last ${r.windowDays} days, classified by each insider's history</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Insider</th><th scope="col">Pattern</th><th scope="col">Type</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Price</th></tr></thead>
        <tbody>${trades.map((t) => `<tr class="${t.kind === "routine" ? "row-dim" : ""}">
          <td>${esc(t.transactionDate)}</td><td>${esc(t.name)}</td><td>${kindTag(t.kind)}</td>
          <td><span class="code-pill code-${esc(t.transactionCode)}">${esc(t.transactionCode)}</span> ${t.transactionCode === "P" ? "Buy" : "Sale"}</td>
          <td class="num">${insiderShares(t)}</td><td class="num">${t.transactionPrice ? "$" + t.transactionPrice.toFixed(2) : "—"}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}
    <details class="explainer small">
      <summary>How this score works</summary>
      <p>Based on Cohen, Malloy &amp; Pomorski (<em>Journal of Finance</em>, 2012). Insiders who trade in the same calendar month every year are <strong>routine</strong> — their trades are scheduled (bonuses, taxes, 10b5-1 plans) and predict nothing, so they're ignored.
      Everyone else is <strong>opportunistic</strong>; a portfolio of opportunistic trades earned about 0.8% a month of abnormal return in their study, while routine trades earned ~0%.
      Open-market <strong>buys</strong> count far more than sales, bigger stake increases count more, recent trades count more (45-day half-life), and <strong>several insiders buying within 30 days</strong> (a cluster) boosts the score.
      Insiders with under 3 years of history are counted at reduced weight. A statistical tendency across many stocks — not a prediction for this one.</p>
    </details>`;
}

async function renderActivist(symbol) {
  const box = el("activistBody");
  if (!box) return;
  let r;
  try {
    r = await api(`/api/research/${encodeURIComponent(symbol)}/activist-filings`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load activist filings: ${esc(err.message)}</p>`;
    return;
  }
  if (!el("activistBody")) return;
  if (!r.filings.length) { box.innerHTML = `<p class="small muted">No 13D/13G filings in the last year.</p>`; return; }
  box.innerHTML = `
    <ul class="link-list small">${r.filings.map((f) => `
      <li><a href="${safeUrl(f.url)}" target="_blank" rel="noopener">${esc(f.form)}${f.isAmendment ? " (amendment)" : ""}<span class="sr-only"> (opens SEC.gov in new tab)</span></a>
        ${f.reportingPerson ? ` — ${esc(f.reportingPerson)}` : ""}${f.stakePct != null ? ` (${f.stakePct}% stake)` : ""}
        <div class="muted">${esc(f.filingDate)}</div></li>`).join("")}</ul>`;
}

export async function render(c, { symbol, data }) {
  const o = data.street?.ownership;
  c.innerHTML = `
    <section class="summary" aria-label="Ownership summary">
      <div class="stat"><div class="label">Institutions own</div><div class="value">${fmtRatio(o?.institutionsPct)}</div><div class="sub">${o?.institutionsCount ? `${fmtNum(o.institutionsCount)} institutions` : ""}</div></div>
      <div class="stat"><div class="label">Insiders own</div><div class="value">${fmtRatio(o?.insidersPct)}</div><div class="sub">Officers, directors, founders</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="sig-h">
        <div class="panel-head"><h3 id="sig-h">Insider signal</h3><span class="muted small">SEC Form 4 since 2018 · <a href="#/insiders">compare across holdings →</a></span></div>
        <div id="signalBody">${loading("Classifying insider trading history…")}</div>
      </section>
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
      <section class="panel span-full" aria-labelledby="activist-h">
        <div class="panel-head"><h3 id="activist-h">Activist / 5%-owner filings</h3><span class="muted small">New SC 13D / 13G filings, last 12 months</span></div>
        <div id="activistBody">${loading("Checking EDGAR for 13D/13G filings…")}</div>
      </section>
      <section class="panel span-full" aria-labelledby="ins-h">
        <div class="panel-head"><h3 id="ins-h">All recent insider filings</h3><span class="muted small">Includes grants, option exercises and tax withholding</span></div>
        <div id="insiderBody">${loading("Loading Form 4 filings…")}</div>
      </section>
    </div>`;

  renderSignal(symbol);
  renderActivist(symbol);
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
