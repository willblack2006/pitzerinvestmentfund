// Transactions page additions (WS9): a timeline view of the ledger and, per holding, its
// price against the fund's average cost with every buy and sell marked.
import { esc, api, getPref, setPref, errorState, bindRetry, skeleton, emptyState } from "../shared.js";
import { lineChart } from "../viz/line.js";
import { fmt } from "../viz/core.js";

const TYPES = { buy: "Bought", sell: "Sold", dividend: "Dividend", deposit: "Deposit", withdrawal: "Withdrawal", fee: "Fee" };

function timeline(rows) {
  if (!rows.length) return emptyState({ icon: "calendar", title: "Nothing on the timeline yet", body: "Recorded trades and cash movements appear here by month." });
  let month = "", out = "";
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (m !== month) { out += `<li class="tx-month" aria-hidden="true">${esc(new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }))}</li>`; month = m; }
    const trade = r.type === "buy" || r.type === "sell";
    const amount = trade ? r.shares * r.price : r.amount;
    out += `<li class="tx-item" data-type="${esc(r.type)}">
      <div class="tx-item-head"><span>${esc(TYPES[r.type] || r.type)}${r.symbol ? ` <a href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a>` : ""}</span><span class="num">${fmt.usd(amount)}</span></div>
      <div class="tx-item-meta">${esc(fmt.date(r.date))}${trade ? ` · ${esc(String(+r.shares.toFixed(4)))} shares at ${fmt.usd(r.price)}` : ""}${r.realizedGain != null ? ` · realized ${r.realizedGain >= 0 ? "+" : "−"}${fmt.usd(Math.abs(r.realizedGain))}` : ""}${r.createdBy ? ` · ${esc(r.createdBy)}` : ""}</div>
      ${r.note ? `<div class="tx-item-note">${esc(r.note)}</div>` : ""}</li>`;
  }
  return `<ol class="tx-timeline" aria-label="Ledger timeline, newest first">${out}</ol>`;
}

async function costChart(box, symbol) {
  box.innerHTML = skeleton("chart", { label: `Loading ${symbol}` });
  let d;
  try { d = await api(`/api/cockpit/position/${encodeURIComponent(symbol)}`); }
  catch (err) { box.innerHTML = errorState({ title: `Couldn't load ${symbol}.`, detail: err.message, retryId: "cost" }); bindRetry(box, "cost", () => costChart(box, symbol)); return; }
  if (!box.isConnected) return;
  if (d.history.length < 2) { box.innerHTML = emptyState({ title: "No price history", body: `Prices for ${symbol} aren't available right now.` }); return; }
  const dates = d.history.map((p) => p.date);
  const path = d.costPath.filter((c) => c.date);
  const costAt = (iso) => { let v = null; for (const c of path) { if (c.date <= iso) v = c.avgCost; else break; } return v; };
  const last = d.history.at(-1).close;
  const gain = d.avgCost ? last / d.avgCost - 1 : null;
  const events = d.trades.map((t) => ({ date: t.date, kind: "trade", sub: t.type, title: `${t.type === "buy" ? "Bought" : "Sold"} ${+t.shares.toFixed(4)} at ${fmt.usd(t.price)}${t.realizedGain != null ? ` (realized ${fmt.usd(t.realizedGain)})` : ""}` }));
  const note = d.heldBeforeLedger && d.ledgerStarts && d.ledgerStarts > dates[0]
    ? `The cost line starts at the first recorded trade (${esc(fmt.date(d.ledgerStarts))}); earlier shares came in before the ledger.`
    : !d.trades.length ? "No trades recorded for it, so the cost line is today's average cost." : "";
  box.innerHTML = `<p class="small">${esc(symbol)} ${fmt.usd(last)} vs average cost ${fmt.usd(d.avgCost)}${gain !== null ? `: <b class="${gain >= 0 ? "gain-pos" : "gain-neg"}">${gain >= 0 ? "+" : "−"}${fmt.pct(Math.abs(gain), 1)}</b>` : ""} on ${esc(String(+d.shares.toFixed(4)))} shares. ${note}</p><div class="cost-chart"></div>`;
  lineChart(box.querySelector(".cost-chart"), {
    dates, label: `${symbol} price against the fund's average cost, with trades marked`, height: 260, events,
    series: [
      { label: "Price", values: d.history.map((p) => p.close), color: "var(--viz-s1)" },
      { label: "Average cost", values: path.length ? dates.map(costAt) : dates.map(() => d.avgCost), color: "var(--viz-s2)", dash: true, width: 1.5 },
    ],
    yFormat: (v) => `$${v >= 1000 ? Math.round(v).toLocaleString("en-US") : Number(v).toFixed(v < 10 ? 2 : 0)}`, tipFormat: (v) => fmt.usd(v),
  });
}

// host: an empty element above the ledger table; tableSection: the existing table to toggle.
export async function mountTransactionsViz(host, tableSection, rows) {
  if (!host) return;
  const view = getPref("txView", "table") === "timeline" ? "timeline" : "table";
  let positions = [];
  try { positions = (await api("/api/positions")).map((p) => p.symbol).sort(); } catch { /* picker shows traded names only */ }
  if (!host.isConnected) return;
  const traded = [...new Set(rows.filter((r) => r.type === "buy" || r.type === "sell").map((r) => r.symbol))];
  const symbols = [...new Set([...traded, ...positions])];
  host.innerHTML = `
    <section class="panel page-pad-panel" aria-labelledby="cost-h">
      <div class="panel-head"><h3 id="cost-h">Price vs our cost</h3>
        <label class="small">Holding <select id="costSym">${symbols.map((s) => `<option ${s === traded[0] ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label></div>
      <div id="costBox">${symbols.length ? "" : emptyState({ title: "No holdings yet" })}</div>
    </section>
    <div class="tx-view-toggle"><div class="seg" role="group" aria-label="Ledger view">
      <button type="button" class="seg-btn" data-txview="table" aria-pressed="${view === "table"}">Table</button>
      <button type="button" class="seg-btn" data-txview="timeline" aria-pressed="${view === "timeline"}">Timeline</button></div></div>
    <section class="panel page-pad-panel" id="txTimeline" ${view === "timeline" ? "" : "hidden"}>${timeline(rows)}</section>`;
  if (tableSection) tableSection.hidden = view === "timeline";
  const sel = host.querySelector("#costSym");
  if (sel && symbols.length) {
    costChart(host.querySelector("#costBox"), sel.value);
    sel.addEventListener("change", () => costChart(host.querySelector("#costBox"), sel.value));
  }
  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-txview]");
    if (!b) return;
    const v = b.dataset.txview;
    host.querySelectorAll("[data-txview]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    host.querySelector("#txTimeline").hidden = v !== "timeline";
    if (tableSection) tableSection.hidden = v === "timeline";
    setPref("txView", v);
  });
}
