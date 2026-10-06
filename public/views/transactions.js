import { el, esc, api, fmtUSD, isUnlocked, toast, confirmAction, lockedHint, pageHead, loading, errorBox, subTabs, invalidateContext, signed } from "../shared.js";
import { PORTFOLIO_TABS } from "./portfolioTabs.js";

export const title = "Transactions";

const TYPES = {
  buy: "Buy", sell: "Sell", dividend: "Dividend", deposit: "Deposit", withdrawal: "Withdrawal", fee: "Fee",
};

function formFields(type) {
  const trade = type === "buy" || type === "sell";
  return `
    ${trade || type === "dividend" ? `<label>Ticker <input name="symbol" required maxlength="10" autocapitalize="characters" /></label>` : ""}
    ${trade ? `<label>Shares <input name="shares" type="number" step="any" min="0" required inputmode="decimal" /></label>
      <label>Price per share ($) <input name="price" type="number" step="any" min="0" required inputmode="decimal" /></label>
      <label>Commission / fees ($) <input name="amount" type="number" step="any" min="0" value="0" inputmode="decimal" /></label>
      <div id="execHint" class="field-block small muted"></div>`
      : `<label>Amount ($) <input name="amount" type="number" step="any" min="0" required inputmode="decimal" /></label>`}
  `;
}

let execTimer = null;
function refreshExecHint(form) {
  const hint = el("execHint");
  if (!hint) return;
  const symbol = form.symbol?.value?.trim().toUpperCase();
  const shares = form.shares?.value;
  const direction = form.type.value;
  if (!symbol || !["buy", "sell"].includes(direction)) { hint.innerHTML = ""; return; }
  clearTimeout(execTimer);
  execTimer = setTimeout(async () => {
    hint.textContent = "Checking spread and volume…";
    try {
      const r = await api(`/api/execution/${encodeURIComponent(symbol)}?direction=${direction}${shares ? `&shares=${encodeURIComponent(shares)}` : ""}`);
      if (!el("execHint")) return;
      if (r.error || r.mid === null) { hint.innerHTML = ""; return; }
      hint.innerHTML = `Bid/ask ${fmtUSD(r.bid)} / ${fmtUSD(r.ask)}${r.suggestedLimitPrice ? ` · suggested limit ${fmtUSD(r.suggestedLimitPrice)}` : ""}${r.warnings?.length ? `<br>${r.warnings.map((w) => `⚠ ${esc(w)}`).join("<br>")}` : ""}`;
    } catch { if (el("execHint")) hint.innerHTML = ""; }
  }, 350);
}

export async function mount(container) {
  container.innerHTML = subTabs(PORTFOLIO_TABS, "#/transactions") + loading("Loading the ledger…");
  let rows, settings;
  try {
    [rows, settings] = await Promise.all([api("/api/transactions"), api("/api/settings")]);
  } catch (err) {
    container.innerHTML = subTabs(PORTFOLIO_TABS, "#/transactions") + pageHead("Transactions") + errorBox(`Could not load transactions: ${err.message}`);
    return;
  }
  const unlocked = isUnlocked();
  const realized = rows.filter((r) => r.type === "sell").reduce((s, r) => s + (r.realizedGain || 0), 0);

  container.innerHTML = `
    ${subTabs(PORTFOLIO_TABS, "#/transactions")}
    ${pageHead("Transactions", "The fund's ledger. Recording trades here updates holdings, cost basis and cash automatically, and lets performance exclude deposits and withdrawals.")}
    <section class="summary" aria-label="Ledger summary">
      <div class="stat"><div class="label">Cash balance</div><div class="value">${fmtUSD(settings.cash)}</div></div>
      <div class="stat"><div class="label">Realized gains</div><div class="value">${signed(realized, fmtUSD(realized))}</div><div class="sub">From recorded sells</div></div>
      <div class="stat"><div class="label">Entries</div><div class="value">${rows.length}</div></div>
    </section>

    ${unlocked ? `
    <section class="panel page-pad-panel" aria-labelledby="new-h">
      <h3 id="new-h">Record a transaction</h3>
      <form id="txForm" class="tx-form" novalidate>
        <label>Type
          <select name="type" id="txType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        </label>
        <label>Date <input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
        <div id="txFields" class="tx-fields">${formFields("buy")}</div>
        <label class="tx-note">Note <input name="note" maxlength="500" placeholder="e.g. Approved pitch #4, Q3 rebalance" /></label>
        <div class="tx-submit"><button class="btn btn-primary">Record</button></div>
      </form>
      <p class="muted small">Sells use average cost basis. Deleting an entry reverses its effect on holdings and cash.</p>
    </section>` : `<section class="toolbar">${lockedHint("Unlock to record trades, dividends and cash movements.")}</section>`}

    <section class="table-wrap">
      ${rows.length ? `
      <table>
        <caption class="sr-only">Transaction ledger, newest first</caption>
        <thead><tr><th scope="col" class="left">Date</th><th scope="col" class="left">Type</th><th scope="col" class="left">Ticker</th>
          <th scope="col">Shares</th><th scope="col">Price</th><th scope="col">Cash effect</th><th scope="col">Realized</th><th scope="col" class="left">Note</th>
          ${unlocked ? `<th scope="col"><span class="sr-only">Actions</span></th>` : ""}</tr></thead>
        <tbody>${rows.map((r) => {
          const cash = r.type === "buy" ? -(r.shares * r.price + r.amount) : r.type === "sell" ? r.shares * r.price - r.amount : r.type === "withdrawal" || r.type === "fee" ? -r.amount : r.amount;
          return `<tr>
            <td class="left">${esc(r.date)}</td>
            <td class="left"><span class="tx-type tx-${esc(r.type)}">${TYPES[r.type]}</span></td>
            <td class="left">${r.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a>` : ""}</td>
            <td>${r.shares ? r.shares.toLocaleString() : ""}</td>
            <td>${r.price ? fmtUSD(r.price) : ""}</td>
            <td>${signed(cash, fmtUSD(cash))}</td>
            <td>${r.realizedGain != null ? signed(r.realizedGain, fmtUSD(r.realizedGain)) : ""}</td>
            <td class="left small muted">${esc(r.note)}${r.createdBy ? ` <span>— ${esc(r.createdBy)}</span>` : ""}</td>
            ${unlocked ? `<td><button class="btn btn-danger btn-sm" data-del="${r.id}" aria-label="Delete ${TYPES[r.type]} ${esc(r.symbol)} on ${esc(r.date)}">Delete</button></td>` : ""}
          </tr>`;
        }).join("")}</tbody>
      </table>` : `<div class="empty-state"><p class="empty-title">No transactions yet</p>
        <p class="muted">Start with a <strong>deposit</strong> for the fund's current cash, then record trades as they happen. Existing holdings stay as they are.</p></div>`}
    </section>`;

  if (!unlocked) return;

  el("txType").addEventListener("change", (e) => { el("txFields").innerHTML = formFields(e.target.value); });
  el("txFields").addEventListener("input", (e) => {
    if (e.target.name === "symbol" || e.target.name === "shares") refreshExecHint(el("txForm"));
  });
  el("txForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    for (const k of ["shares", "price", "amount"]) if (body[k] !== undefined) body[k] = Number(body[k]);
    if (body.symbol) body.symbol = body.symbol.trim().toUpperCase();
    const invalid = [...e.target.querySelectorAll("input[required]")].find((i) => !i.value || (i.type === "number" && !(Number(i.value) > 0)));
    if (invalid) {
      invalid.setAttribute("aria-invalid", "true");
      invalid.focus();
      toast("Fill in the highlighted field with a positive value.", { type: "error" });
      return;
    }
    try {
      await api("/api/transactions", { method: "POST", body: JSON.stringify(body) });
      invalidateContext();
      toast(`${TYPES[body.type]} recorded.`, { type: "success" });
      mount(container);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  });
  container.querySelector("tbody")?.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del]")?.dataset.del;
    if (!id) return;
    const r = rows.find((x) => String(x.id) === id);
    const ok = await confirmAction({
      title: "Delete this transaction?",
      body: `${TYPES[r.type]} ${r.symbol || ""} on ${r.date}. Its effect on holdings and cash will be reversed.`,
      confirmLabel: "Delete and reverse",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/transactions/${id}`, { method: "DELETE" });
      invalidateContext();
      toast("Transaction deleted and reversed.");
      mount(container);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  });
}
