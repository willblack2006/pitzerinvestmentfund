import { el, esc, api, fmtUSD, fmtPct, signed, pageHead, loading, errorBox, subTabs, toast, currentMember, can, requestSignIn, confirmAction } from "../shared.js";
import { lineChart } from "../charts.js";
import { IDEAS_TABS } from "./screener.js";

export const title = "Paper trading";

let seasonId = null;
const pct = (v) => (Number.isFinite(v) ? signed(v * 100, fmtPct(v * 100)) : "—");
const plainPct = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—");
const big = (n) => (n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`);
const sharpeCell = (x) => (Number.isFinite(x) ? x.toFixed(2) : `<span class="muted" title="Needs 20 trading days of history">—</span>`);

function rulesText(rules) {
  return `Fee ${(rules.feeBps / 100).toFixed(2)}% a trade · at least ${rules.minHoldings} holdings to be ranked · no more than ${rules.maxPositionPct}% in one stock when you buy · stocks over $${rules.minPrice} and ${big(rules.minMarketCap)}`;
}

function thesisLine(t, horizons) {
  if (!t) return "";
  const bits = [t.targetPrice ? `target ${fmtUSD(t.targetPrice)}` : "", t.stopPrice ? `stop ${fmtUSD(t.stopPrice)}` : "", t.horizon ? horizons[t.horizon] : ""].filter(Boolean);
  return `${esc(t.reason || "")}${bits.length ? ` <span class="muted">(${esc(bits.join(" · "))})</span>` : ""}`;
}

function orderForm(r) {
  const h = r.horizons;
  return `
    <form id="paperForm" class="paper-form" novalidate>
      <div class="paper-form-row">
        <label class="field-inline">Ticker <input name="symbol" required maxlength="10" autocapitalize="characters" autocomplete="off" list="paperHeld" /></label>
        <datalist id="paperHeld">${r.mine.positions.map((p) => `<option value="${esc(p.symbol)}">`).join("")}</datalist>
        <div class="seg seg-sm" role="group" aria-label="Buy or sell">
          <button type="button" class="seg-btn" data-side="buy" aria-pressed="true">Buy</button><button type="button" class="seg-btn" data-side="sell" aria-pressed="false">Sell</button>
        </div>
        <label class="field-inline">Shares <input name="shares" type="number" min="0" step="any" required inputmode="decimal" style="width:100px" /></label>
      </div>
      <div id="sellThesis" class="sell-thesis hidden"></div>
      <label class="paper-reason"><span id="reasonLabel">Why are you buying? What would prove you wrong?</span>
        <textarea name="reason" rows="2" maxlength="1000" required placeholder="e.g. Membership renewals are holding up and the market is pricing in a slowdown that isn't showing."></textarea></label>
      <div class="paper-form-row" id="buyExtras">
        <label class="field-inline">Target $ <input name="targetPrice" type="number" min="0" step="any" inputmode="decimal" style="width:90px" /></label>
        <label class="field-inline">Stop $ <input name="stopPrice" type="number" min="0" step="any" inputmode="decimal" style="width:90px" /></label>
        <label class="field-inline">Time frame <select name="horizon"><option value="">—</option>${Object.entries(h).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
      </div>
      <div class="paper-form-row">
        <button class="btn btn-primary">Place order</button>
        <span class="muted small">While the market is open, orders fill at the live price. Otherwise they wait and fill at the next day's opening price.</span>
      </div>
    </form>`;
}

function portfolioPanel(r) {
  const m = r.mine;
  if (!m) {
    return `<p class="small">Sign in as a member to get a virtual ${fmtUSD(r.season.startingCash)} portfolio for this season.
      <button type="button" class="btn btn-ghost btn-sm" id="paperSignIn">Sign in</button></p>`;
  }
  const rank = m.rank;
  const rankLine = rank?.qualified ? `Ranked <strong>#${rank.rank}</strong> of ${r.leaderboard.filter((x) => x.qualified).length}` : `Not ranked yet: hold at least ${r.rules.minHoldings} stocks (you have ${m.positions.length}).`;
  const bench = r.benchmark;
  return `
    <p class="small">${rankLine}</p>
    <section class="summary" aria-label="Your paper portfolio">
      <div class="stat"><div class="label">Total value</div><div class="value">${fmtUSD(m.totalValue)}</div><div class="sub">Return ${pct(m.returnPct)}${bench ? ` · vs ${esc(bench.label)} ${pct(m.returnPct - bench.returnPct)}` : ""}</div></div>
      <div class="stat"><div class="label">Cash</div><div class="value">${fmtUSD(m.cash)}</div><div class="sub">Dividends ${fmtUSD(m.dividends)} · fees ${fmtUSD(m.fees)}</div></div>
      <div class="stat"><div class="label">Sharpe ratio</div><div class="value">${sharpeCell(m.risk.sharpe)}</div><div class="sub">${m.risk.days < 20 ? `After 20 trading days (${m.risk.days} so far)` : "Return per unit of risk"}</div></div>
      <div class="stat"><div class="label">Biggest drop</div><div class="value">${plainPct(m.risk.maxDrawdown)}</div><div class="sub">Largest peak-to-low fall</div></div>
    </section>
    ${m.curve.length > 1 ? `<div class="chart-box chart-sm"><canvas id="paperChart" role="img" aria-label="Your paper portfolio value compared with ${esc(bench?.label || "the benchmark")} since the season started"></canvas></div>` : ""}
    ${r.isOpen ? orderForm(r) : `<p class="muted small">This season has ended; trading is closed.</p>`}
    ${m.pending.length ? `<div class="pending-orders"><p class="pf-sub">Waiting for the next open</p><ul class="link-list small">${m.pending.map((o) => `<li>${o.type === "buy" ? "Buy" : "Sell"} ${+o.shares.toFixed(4)} ${esc(o.symbol)} <span class="muted">(about ${fmtUSD(o.price)} now)</span> <button type="button" class="btn-link small" data-cancel="${o.id}">Cancel</button></li>`).join("")}</ul></div>` : ""}
    ${m.positions.length ? `
      <div class="table-scroll"><table class="mini-table paper-positions">
        <caption class="sr-only">Your paper positions</caption>
        <thead><tr><th scope="col">Ticker</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Avg cost</th><th scope="col" class="num">Price</th><th scope="col" class="num">Value</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Gain</th><th scope="col">Your reason</th></tr></thead>
        <tbody>${m.positions.map((p) => `<tr>
          <th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(p.symbol)}">${esc(p.symbol)}</a></th>
          <td class="num">${(+p.shares.toFixed(4)).toLocaleString()}</td><td class="num">${fmtUSD(p.avgCost)}</td>
          <td class="num">${p.price != null ? fmtUSD(p.price) : `<span class="muted" title="No live price; valued at cost">—</span>`}</td>
          <td class="num">${fmtUSD(p.marketValue)}</td><td class="num">${plainPct(p.weight)}</td><td class="num">${signed(p.gain, fmtUSD(p.gain))}</td>
          <td class="small reason-cell">${thesisLine(p.thesis, r.horizons) || `<span class="muted">—</span>`}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="muted small">No positions yet.</p>`}
    ${m.recent.length ? `<details class="explainer small"><summary>Your orders</summary><ul class="link-list">${m.recent.map((t) => `<li>
      ${esc((t.filledAt || t.createdAt).slice(0, 10))}: ${t.type === "buy" ? "Buy" : "Sell"} ${+t.shares.toFixed(4)} ${esc(t.symbol)}
      ${t.status === "filled" ? `at ${fmtUSD(t.price)}${t.fee ? ` (fee ${fmtUSD(t.fee)})` : ""}` : t.status === "pending" ? "<em>waiting for the open</em>" : `<em>cancelled</em> <span class="muted">${esc(t.cancelReason)}</span>`}
      ${t.reason ? `<div class="muted">“${esc(t.reason)}”</div>` : ""}</li>`).join("")}</ul></details>` : ""}`;
}

function leaderboard(r) {
  if (!r.leaderboard.length) return `<p class="muted small">Nobody has traded this season yet.</p>`;
  const b = esc(r.benchmark?.label || "benchmark");
  return `
    <div class="table-scroll"><table class="mini-table">
      <caption class="sr-only">Members ranked by return this season; members with fewer than ${r.rules.minHoldings} holdings are listed unranked</caption>
      <thead><tr><th scope="col" class="num">Rank</th><th scope="col">Member</th><th scope="col" class="num">Return</th><th scope="col" class="num">Vs ${b}</th><th scope="col" class="num">Sharpe</th><th scope="col" class="num">Biggest drop</th><th scope="col" class="num">Holdings</th><th scope="col" class="num">Largest</th><th scope="col" class="num">Trades</th></tr></thead>
      <tbody>${r.leaderboard.map((x) => `<tr class="${x.qualified ? "" : "unranked"}">
        <td class="num">${x.qualified ? x.rank : `<span class="muted" title="${esc(x.why)}">—<span class="sr-only"> ${esc(x.why)}</span></span>`}</td>
        <th scope="row"><a href="#/members/${x.memberId}">${esc(x.name)}</a></th>
        <td class="num">${pct(x.returnPct)}</td><td class="num">${pct(x.excessPct)}</td><td class="num">${sharpeCell(x.sharpe)}</td>
        <td class="num">${plainPct(x.maxDrawdown)}</td><td class="num">${x.positions}</td><td class="num">${plainPct(x.biggestPositionPct, 0)}</td><td class="num">${x.tradeCount}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small">Ranked by return among members holding at least ${r.rules.minHoldings} stocks. One semester is far too short to tell skill from luck, so look at risk too: the Sharpe ratio (return per unit of ups and downs, 0% risk-free rate) and the biggest drop. Practice only: fills ignore bid/ask spreads and how big orders move prices.</p>`;
}

function newSeasonForm(r) {
  const d = r.rules;
  return `<details class="explainer small new-season"><summary>Start a new semester</summary>
    <form id="newSeasonForm" class="paper-form-row" novalidate>
      <label class="field-inline">Name <input name="name" maxlength="60" placeholder="e.g. Spring 2027" /></label>
      <label class="field-inline">Starting cash $ <input name="startingCash" type="number" min="1" step="any" value="${r.season.startingCash}" style="width:110px" /></label>
      <label class="field-inline">Fee (basis points) <input name="feeBps" type="number" min="0" max="500" step="any" value="${d.feeBps}" style="width:70px" /></label>
      <label class="field-inline">Min holdings <input name="minHoldings" type="number" min="0" max="30" value="${d.minHoldings}" style="width:60px" /></label>
      <label class="field-inline">Max % in one stock <input name="maxPositionPct" type="number" min="1" max="100" value="${d.maxPositionPct}" style="width:60px" /></label>
      <label class="field-inline">Min price $ <input name="minPrice" type="number" min="0" step="any" value="${d.minPrice}" style="width:70px" /></label>
      <label class="field-inline">Min market cap $M <input name="minMarketCapM" type="number" min="0" step="any" value="${d.minMarketCap / 1e6}" style="width:80px" /></label>
      <button class="btn btn-ghost btn-sm">Start new season</button>
    </form>
    <p class="muted">The current season ends (orders waiting to fill are cancelled) and everyone starts over. The old leaderboard stays viewable.</p></details>`;
}

async function load(container) {
  const box = el("paperBody");
  if (!box) return;
  let r, seasons;
  try {
    [r, seasons] = await Promise.all([api(`/api/paper${seasonId ? `?season=${seasonId}` : ""}`), api("/api/paper/seasons")]);
  } catch (err) {
    box.innerHTML = errorBox(`Could not load paper trading: ${err.message}`);
    return;
  }
  if (!el("paperBody")) return;
  seasonId = r.season.id;
  box.innerHTML = `
    <div class="toolbar">
      <label class="field-inline">Season
        <select id="seasonSelect">${seasons.map((s) => `<option value="${s.id}" ${s.id === r.season.id ? "selected" : ""}>${esc(s.name)}${s.endedAt ? " (ended)" : ""}</option>`).join("")}</select>
      </label>
      <span class="muted small">Started ${esc(r.season.startedAt.slice(0, 10))} with ${fmtUSD(r.season.startingCash)} each${r.benchmark ? ` · ${esc(r.benchmark.label)} since then ${pct(r.benchmark.returnPct)}` : ""}</span>
    </div>
    <p class="muted small page-pad rules-line">Rules: ${esc(rulesText(r.rules))}.</p>
    ${can("admin") && r.isOpen ? `<div class="page-pad">${newSeasonForm(r)}</div>` : ""}
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="mine-h">
        <h3 id="mine-h">${r.mine ? "Your portfolio" : "Your portfolio"}</h3>
        ${portfolioPanel(r)}
      </section>
      <section class="panel span-full" aria-labelledby="lb-h">
        <h3 id="lb-h">Leaderboard</h3>
        ${leaderboard(r)}
      </section>
    </div>`;

  if (r.mine?.curve.length > 1) {
    const benchByDate = new Map(r.benchCurve.map((p) => [p.date, p.value]));
    lineChart(el("paperChart"), {
      labels: r.mine.curve.map((p) => p.date),
      datasets: [
        { label: "You", data: r.mine.curve.map((p) => p.value) },
        { label: r.benchmark?.label || "Benchmark", data: r.mine.curve.map((p) => benchByDate.get(p.date) ?? null), dash: [4, 3] },
      ],
      yFormat: (v) => fmtUSD(v).replace(/\.\d\d$/, ""),
      legend: true,
    });
  }

  el("seasonSelect").addEventListener("change", (e) => { seasonId = Number(e.target.value); load(container); });
  el("paperSignIn")?.addEventListener("click", () => requestSignIn());
  el("newSeasonForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const ok = await confirmAction({ title: "Start a new semester?", body: "The current season ends and everyone starts over with fresh cash. The old leaderboard stays viewable.", confirmLabel: "Start new season" });
    if (!ok) return;
    try {
      const { minMarketCapM, ...rest } = f;
      await api("/api/paper/seasons", { method: "POST", body: JSON.stringify({ ...rest, minMarketCap: minMarketCapM === "" ? "" : Number(minMarketCapM) * 1e6 }) });
      seasonId = null;
      toast("New season started.", { type: "success" });
      load(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  box.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/api/paper/trades/${b.dataset.cancel}`, { method: "DELETE" }); toast("Order cancelled."); load(container); } catch (err) { toast(err.message, { type: "error" }); }
  }));

  const form = el("paperForm");
  if (!form) return;
  let side = "buy";
  const sym = form.querySelector("[name=symbol]");
  const showSide = () => {
    form.querySelectorAll("[data-side]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.side === side)));
    el("buyExtras").classList.toggle("hidden", side !== "buy");
    el("reasonLabel").textContent = side === "buy" ? "Why are you buying? What would prove you wrong?" : "Why sell now? What happened compared with your reason for buying?";
    const held = r.mine.positions.find((p) => p.symbol === sym.value.trim().toUpperCase());
    const box2 = el("sellThesis");
    box2.classList.toggle("hidden", !(side === "sell" && held?.thesis));
    if (side === "sell" && held?.thesis) box2.innerHTML = `<p class="pf-sub">When you bought ${esc(held.symbol)} at ${fmtUSD(held.thesis.price)}</p><p class="small">${thesisLine(held.thesis, r.horizons)}</p>`;
  };
  form.querySelectorAll("[data-side]").forEach((b) => b.addEventListener("click", () => { side = b.dataset.side; showSide(); }));
  sym.addEventListener("input", showSide);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector("button.btn-primary");
    btn.disabled = true;
    try {
      const body = { symbol: f.symbol.trim().toUpperCase(), type: side, shares: Number(f.shares), reason: f.reason };
      if (side === "buy") Object.assign(body, { targetPrice: f.targetPrice, stopPrice: f.stopPrice, horizon: f.horizon });
      const t = await api("/api/paper/trades", { method: "POST", body: JSON.stringify(body) });
      toast(t.status === "pending"
        ? `Order placed: ${t.type} ${t.shares} ${t.symbol}. The market is closed, so it fills at the next open.`
        : `${t.type === "buy" ? "Bought" : "Sold"} ${t.shares} ${t.symbol} at ${fmtUSD(t.price)} (fee ${fmtUSD(t.fee)}).`, { type: "success" });
      load(container);
    } catch (err) {
      if (err.code === "signin_required") requestSignIn();
      toast(err.message, { type: "error" });
      btn.disabled = false;
    }
  });
}

export async function mount(container) {
  container.innerHTML = `${subTabs(IDEAS_TABS, "#/paper")}
    ${pageHead("Paper trading", `Each member gets a virtual portfolio per semester. Every order needs a reason, so you can look back at what you expected. ${currentMember() ? "" : "Sign in to trade."}`)}
    <div id="paperBody">${loading("Loading the leaderboard…")}</div>`;
  load(container);
}
