import { el, esc, api, fmtUSD, can, toast, pageHead, loading, errorBox, subTabs, lockedHint } from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";

export const title = "Dividends";

const longDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const shortDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "—");
const STATUS = { expected: ["Owed", "badge-warn"], received: ["Received", "badge-owned"], skipped: ["Not owed", ""] };

function logTable(rows, unlocked) {
  if (!rows.length) return `<p class="muted">Nothing logged yet. The first row appears automatically on a holding's next ex-dividend date.</p>`;
  return `<div class="table-scroll"><table class="mini-table">
    <caption class="sr-only">Dividends owed or received since tracking began</caption>
    <thead><tr><th scope="col" class="left">Ex-date</th><th scope="col" class="left">Ticker</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Per share</th><th scope="col" class="num">Amount</th><th scope="col" class="left">Pays</th><th scope="col" class="left">Status</th>${unlocked ? `<th scope="col"><span class="sr-only">Actions</span></th>` : ""}</tr></thead>
    <tbody>${rows.map((r) => {
      const [label, cls] = STATUS[r.status];
      const actions = !unlocked ? "" : r.status === "expected"
        ? `<td class="row-actions"><button class="btn btn-ghost btn-sm" data-receive="${esc(r.symbol)}|${esc(r.exDate)}|${r.amount}">Mark received</button> <button class="btn-link small" data-skip="${esc(r.symbol)}|${esc(r.exDate)}">Not owed</button></td>`
        : r.status === "skipped" ? `<td><button class="btn-link small" data-unskip="${esc(r.symbol)}|${esc(r.exDate)}">Undo</button></td>` : `<td></td>`;
      return `<tr>
        <td class="left">${esc(longDate(r.exDate))}</td>
        <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></th>
        <td class="num">${r.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
        <td class="num">$${r.perShare.toFixed(4).replace(/0{1,2}$/, "")}</td>
        <td class="num"><strong>${fmtUSD(r.amount)}</strong></td>
        <td class="left">${esc(r.payDate ? longDate(r.payDate) : "Not announced")}</td>
        <td class="left"><span class="badge ${cls}">${label}</span></td>
        ${actions}
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

function render(container, d) {
  const unlocked = can("trade");
  const t = d.totals;
  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/dividends")}
    ${pageHead("Dividends", `Tracked exactly from ${esc(longDate(d.trackingStart))}, when holdings were matched to Schwab: on each ex-dividend date the fund's share count is known, so the amount owed is shares × the declared dividend. Earlier dividends aren't shown, because past share counts aren't known without Schwab's account history.`)}
    <section class="summary" aria-label="Dividend summary">
      <div class="stat stat-lg"><div class="label">Projected, next 12 months</div><div class="value">${fmtUSD(t.annualIncome)}</div><div class="sub">${t.payers} of the fund's holdings pay dividends · at today's shares and current rates</div></div>
      <div class="stat"><div class="label">Received since tracking began</div><div class="value">${fmtUSD(t.receivedSinceStart)}</div><div class="sub">Confirmed payments (also added to cash)</div></div>
      <div class="stat"><div class="label">Owed, not yet confirmed</div><div class="value">${fmtUSD(t.owed)}</div><div class="sub">Ex-date passed; mark received when it posts at Schwab</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel" aria-labelledby="up-h">
        <h3 id="up-h">Coming up (60 days)</h3>
        ${d.upcoming.length ? `<ul class="deck-list">${d.upcoming.map((u) => `<li><span class="deck-when">${esc(shortDate(u.date))}</span><span><a href="#/research/${encodeURIComponent(u.symbol)}">${esc(u.symbol)}</a> ${u.kind === "ex" ? `goes ex-dividend${u.estAmount ? ` · about ${fmtUSD(u.estAmount)}` : ""}${u.payDate ? ` · pays ${esc(shortDate(u.payDate))}` : ""}` : `pays (went ex ${esc(shortDate(u.exDate))})`}</span></li>`).join("")}</ul>
          <p class="muted small">To receive a dividend the fund must own the shares before the ex-date. Amounts use today's share count and the latest dividend per share.</p>`
          : `<p class="muted">No declared ex-dividend or payment dates in the next 60 days.</p>`}
      </section>
      <section class="panel span-2" aria-labelledby="log-h">
        <div class="panel-head"><h3 id="log-h">Owed &amp; received</h3>${unlocked ? "" : lockedHint("Sign in to confirm payments.", "trade")}</div>
        ${logTable(d.rows, unlocked)}
        <p class="muted small">"Mark received" records a dividend transaction for the amount Schwab actually paid, which adds it to cash and to the holding's total. Foreign stocks (like CJPRY) can pay less than shown because of tax withholding.</p>
      </section>
      <section class="panel span-full" aria-labelledby="bh-h">
        <h3 id="bh-h">By holding</h3>
        <div class="table-scroll"><table class="mini-table">
          <caption class="sr-only">Projected dividend income by holding</caption>
          <thead><tr><th scope="col" class="left">Ticker</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Annual per share</th><th scope="col" class="num">Payments / yr</th><th scope="col" class="num">Projected / yr</th><th scope="col" class="num">Yield</th><th scope="col" class="num">Yield on cost</th><th scope="col" class="num">Received</th></tr></thead>
          <tbody>${d.byHolding.map((h) => `<tr>
            <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(h.symbol)}">${esc(h.symbol)}</a></th>
            <td class="num">${h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
            <td class="num">$${h.rate.toFixed(2)}<div class="muted small">${esc(h.basis || "")}</div></td>
            <td class="num">${h.perYear || "—"}</td>
            <td class="num"><strong>${fmtUSD(h.annualIncome)}</strong></td>
            <td class="num">${pct(h.yieldOnPrice)}</td>
            <td class="num">${pct(h.yieldOnCost)}</td>
            <td class="num">${fmtUSD(h.receivedTotal)}</td>
          </tr>`).join("")}</tbody>
          <tfoot><tr><th scope="row" class="left">Total</th><td></td><td></td><td></td><td class="num"><strong>${fmtUSD(t.annualIncome)}</strong></td><td></td><td></td><td class="num">${fmtUSD(d.byHolding.reduce((s, h) => s + h.receivedTotal, 0))}</td></tr></tfoot>
        </table></div>
        <p class="muted small">"Declared" = the company's current annual dividend; "trailing 12 months" = what it paid in the past year (used for ETFs and irregular payers). Yield = annual dividend ÷ price; yield on cost = projected income ÷ what the fund paid. Holdings that don't pay dividends aren't listed.</p>
      </section>
    </div>`;

  // "Mark received" turns the row's action cell into an amount field (prefilled with the
  // expected amount) so the actual Schwab figure can be entered before saving.
  container.querySelectorAll("[data-receive]").forEach((b) => b.addEventListener("click", () => {
    const [symbol, exDate, expected] = b.dataset.receive.split("|");
    const cell = b.closest("td");
    cell.innerHTML = `<form class="inline-form receive-form">
        <label class="sr-only" for="amt-${esc(symbol)}">Amount ${esc(symbol)} paid</label>
        <input id="amt-${esc(symbol)}" type="number" step="0.01" min="0.01" inputmode="decimal" value="${Number(expected).toFixed(2)}" required />
        <button class="btn btn-primary btn-sm">Save</button><button type="button" class="btn-link small" data-cancel>Cancel</button>
      </form>`;
    const form = cell.querySelector("form");
    form.querySelector("input").focus();
    form.querySelector("[data-cancel]").addEventListener("click", () => mount(container));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/api/dividends/received", { method: "POST", body: JSON.stringify({ symbol, exDate, amount: Number(form.querySelector("input").value) }) });
        toast(`${symbol} dividend recorded and added to cash.`, { type: "success" });
        mount(container);
      } catch (err) { toast(err.message, { type: "error" }); }
    });
  }));
  const skip = (attr, skipped) => container.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener("click", async () => {
    const [symbol, exDate] = b.getAttribute(attr).split("|");
    try { await api("/api/dividends/skip", { method: "POST", body: JSON.stringify({ symbol, exDate, skipped }) }); mount(container); } catch (err) { toast(err.message, { type: "error" }); }
  }));
  skip("data-skip", true);
  skip("data-unskip", false);
}

export async function mount(container) {
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/dividends") + loading("Checking dividend rates and dates for each holding…");
  let d;
  try {
    d = await api("/api/dividends");
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/dividends") + pageHead("Dividends") + errorBox(`Could not load dividends: ${err.message}`);
    return;
  }
  if (!location.hash.startsWith("#/dividends")) return;
  render(container, d);
}
