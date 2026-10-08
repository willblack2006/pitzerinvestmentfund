import { el, esc, api, fmtUSD, fmtPct, signed, pageHead, loading, errorBox, subTabs, toast, getMember, isUnlocked, requestMemberSignIn, confirmAction } from "../shared.js";
import { IDEAS_TABS } from "./screener.js";

export const title = "Paper trading";

let seasonId = null;
const pct = (v) => (Number.isFinite(v) ? signed(v * 100, fmtPct(v * 100)) : "—");

function portfolioPanel(r) {
  const m = r.mine;
  if (!m) {
    return `<p class="small">Sign in as a member to get a virtual ${fmtUSD(r.season.startingCash)} portfolio for this season.
      <button type="button" class="btn btn-ghost btn-sm" id="paperSignIn">Sign in</button></p>`;
  }
  return `
    <section class="summary" aria-label="Your paper portfolio">
      <div class="stat"><div class="label">Total value</div><div class="value">${fmtUSD(m.totalValue)}</div><div class="sub">Return ${pct(m.returnPct)}</div></div>
      <div class="stat"><div class="label">Cash</div><div class="value">${fmtUSD(m.cash)}</div></div>
      <div class="stat"><div class="label">Realized gain</div><div class="value">${signed(m.realizedGain, fmtUSD(m.realizedGain))}</div></div>
    </section>
    ${r.isOpen ? `
      <form id="paperForm" class="toolbar" novalidate>
        <label class="field-inline">Ticker <input name="symbol" required maxlength="10" autocapitalize="characters" autocomplete="off" /></label>
        <label class="field-inline">Action
          <select name="type"><option value="buy">Buy</option><option value="sell">Sell</option></select>
        </label>
        <label class="field-inline">Shares <input name="shares" type="number" min="0" step="any" required inputmode="decimal" /></label>
        <button class="btn btn-primary">Place order</button>
        <span class="muted small">Fills at the latest price (the last close when the market is shut).</span>
      </form>` : `<p class="muted small">This season has ended; trading is closed.</p>`}
    ${m.positions.length ? `
      <div class="table-scroll"><table class="mini-table">
        <caption class="sr-only">Your paper positions</caption>
        <thead><tr><th scope="col">Ticker</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Avg cost</th><th scope="col" class="num">Price</th><th scope="col" class="num">Value</th><th scope="col" class="num">Gain</th></tr></thead>
        <tbody>${m.positions.map((p) => `<tr>
          <th scope="row"><a class="symbol-cell" href="#/research/${encodeURIComponent(p.symbol)}">${esc(p.symbol)}</a></th>
          <td class="num">${p.shares.toLocaleString()}</td><td class="num">${fmtUSD(p.avgCost)}</td>
          <td class="num">${p.price != null ? fmtUSD(p.price) : `<span class="muted" title="No live price; valued at cost">—</span>`}</td>
          <td class="num">${fmtUSD(p.marketValue)}</td><td class="num">${signed(p.gain, fmtUSD(p.gain))}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="muted small">No positions yet.</p>`}
    ${m.trades.length ? `<details class="explainer small"><summary>Recent orders</summary><ul class="link-list">${m.trades.map((t) => `<li>${esc(t.createdAt.slice(0, 10))}: ${t.type === "buy" ? "Bought" : "Sold"} ${t.shares} ${esc(t.symbol)} at ${fmtUSD(t.price)}</li>`).join("")}</ul></details>` : ""}`;
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
      ${isUnlocked() && r.isOpen ? `<button type="button" class="btn btn-ghost btn-sm" id="newSeasonBtn">Start a new semester</button>` : ""}
    </div>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="mine-h">
        <h3 id="mine-h">${r.mine ? `${esc(r.mine.member)}'s portfolio` : "Your portfolio"}</h3>
        ${portfolioPanel(r)}
      </section>
      <section class="panel span-full" aria-labelledby="lb-h">
        <h3 id="lb-h">Leaderboard</h3>
        ${r.leaderboard.length ? `
          <div class="table-scroll"><table class="mini-table">
            <caption class="sr-only">Members ranked by return this season</caption>
            <thead><tr><th scope="col" class="num">Rank</th><th scope="col">Member</th><th scope="col" class="num">Value</th><th scope="col" class="num">Return</th><th scope="col" class="num">Vs ${esc(r.benchmark?.label || "benchmark")}</th><th scope="col" class="num">Trades</th></tr></thead>
            <tbody>${r.leaderboard.map((x) => `<tr>
              <td class="num">${x.rank}</td><th scope="row">${esc(x.name)}</th><td class="num">${fmtUSD(x.totalValue)}</td>
              <td class="num">${pct(x.returnPct)}</td><td class="num">${r.benchmark ? pct(x.returnPct - r.benchmark.returnPct) : "—"}</td><td class="num">${x.tradeCount}</td></tr>`).join("")}</tbody>
          </table></div>` : `<p class="muted small">Nobody has traded this season yet.</p>`}
        <p class="muted small">Practice only: no real money, no fees, and fills at the latest price, so results flatter real trading. A short season is mostly luck.</p>
      </section>
    </div>`;

  el("seasonSelect").addEventListener("change", (e) => { seasonId = Number(e.target.value); load(container); });
  el("paperSignIn")?.addEventListener("click", () => requestMemberSignIn());
  el("newSeasonBtn")?.addEventListener("click", async () => {
    const ok = await confirmAction({ title: "Start a new semester?", body: "The current season ends and everyone starts over with fresh cash. The old leaderboard stays viewable.", confirmLabel: "Start new season" });
    if (!ok) return;
    try {
      await api("/api/paper/seasons", { method: "POST", body: JSON.stringify({}) });
      seasonId = null;
      toast("New season started.", { type: "success" });
      load(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  el("paperForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const t = await api("/api/paper/trades", { method: "POST", body: JSON.stringify({ symbol: f.symbol.trim().toUpperCase(), type: f.type, shares: Number(f.shares) }) });
      toast(`${t.type === "buy" ? "Bought" : "Sold"} ${t.shares} ${t.symbol} at ${fmtUSD(t.price)}.`, { type: "success" });
      load(container);
    } catch (err) {
      if (err.code === "member_required") requestMemberSignIn();
      toast(err.message, { type: "error" });
      btn.disabled = false;
    }
  });
}

export async function mount(container) {
  container.innerHTML = `${subTabs(IDEAS_TABS, "#/paper")}
    ${pageHead("Paper trading", `Each member gets a virtual portfolio per semester. ${getMember() ? "" : "Sign in as a member to trade."}`)}
    <div id="paperBody">${loading("Loading the leaderboard…")}</div>`;
  load(container);
}
