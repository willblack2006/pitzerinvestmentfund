import { el, esc, api, fmtUSD, fmtRatio, fmtNum, loading } from "../../shared.js";
import { barChart } from "../../charts.js";
import { term } from "../../glossary.js";

let state = { expiration: null };

async function load(c, symbol) {
  const box = el("optBody");
  if (!box) return;
  box.innerHTML = loading("Pulling the options chain…");
  let r;
  try {
    r = await api(`/api/research/${encodeURIComponent(symbol)}/options${state.expiration ? `?date=${state.expiration}` : ""}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load options data: ${esc(err.message)}</p>`;
    return;
  }
  if (!el("optBody")) return;
  if (r.error || !r.expiration) { box.innerHTML = `<p class="muted">${esc(r.error || "No listed options for this ticker.")}</p>`; return; }
  state.expiration = r.expiration;
  const daysOut = Math.round((r.expiration * 1000 - Date.now()) / 864e5);

  box.innerHTML = `
    <div class="toolbar">
      <label class="field-inline">Expiration
        <select id="expSelect">${r.expirationDates.map((d) => `<option value="${d}" ${d === r.expiration ? "selected" : ""}>${esc(new Date(d * 1000).toISOString().slice(0, 10))}</option>`).join("")}</select>
      </label>
      <span class="muted small">${daysOut} days out</span>
    </div>
    ${!r.quality?.hasOI || !r.quality?.hasIV || !r.quality?.hasQuotes ? `<p class="notice small" role="note">Yahoo is serving incomplete data for this chain right now (${[!r.quality?.hasOI && "no open interest", !r.quality?.hasIV && "placeholder implied volatilities", !r.quality?.hasQuotes && "no bid/ask quotes"].filter(Boolean).join(", ")}), which often happens outside market hours. Stats that depend on it are hidden rather than shown as zeros.</p>` : ""}
    <section class="summary" aria-label="Options positioning summary">
      <div class="stat"><div class="label">${term("putCallOI")}</div><div class="value">${r.pcRatio.oiRatio != null ? r.pcRatio.oiRatio.toFixed(2) : "—"}</div><div class="sub">${fmtNum(r.pcRatio.putOI)} put OI / ${fmtNum(r.pcRatio.callOI)} call OI</div></div>
      <div class="stat"><div class="label">${term("putCallVolume")}</div><div class="value">${r.pcRatio.volumeRatio != null ? r.pcRatio.volumeRatio.toFixed(2) : "—"}</div></div>
      <div class="stat"><div class="label">${term("maxPain")}</div><div class="value">${r.maxPainStrike != null ? fmtUSD(r.maxPainStrike) : "—"}</div><div class="sub">Spot ${fmtUSD(r.spot)}</div></div>
      <div class="stat"><div class="label">${term("expectedMove")}</div><div class="value">${r.expectedMovePct != null ? `±${(r.expectedMovePct * 100).toFixed(1)}%` : "—"}</div><div class="sub">From the ATM straddle (${fmtUSD(r.atmStrike)} strike)</div></div>
      <div class="stat"><div class="label">${term("ivSkew", "Skew (approx. 25-delta)")}</div><div class="value">${r.skew ? `${r.skew.skew >= 0 ? "+" : ""}${(r.skew.skew * 100).toFixed(1)} pts` : "—"}</div><div class="sub">${r.skew ? `Put IV ${fmtRatio(r.skew.putIV)} vs call IV ${fmtRatio(r.skew.callIV)}` : "Unavailable"}</div></div>
    </section>
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="oi-h">
        <div class="panel-head"><h3 id="oi-h">${term("openInterest", "Open interest by strike")}</h3></div>
        <div class="chart-box"><canvas id="oiChart" role="img" aria-label="Call and put open interest by strike price."></canvas></div>
      </section>
      <section class="panel span-full" aria-labelledby="gamma-h">
        <div class="panel-head"><h3 id="gamma-h">${term("dealerGamma", "Estimated dealer gamma by strike")}</h3><span class="muted small">Assumes dealers are long calls, short puts — a stated convention, not a fact about any dealer's book</span></div>
        <div class="chart-box"><canvas id="gammaChart" role="img" aria-label="Estimated dealer gamma exposure by strike, in dollars per 1% move of the underlying."></canvas></div>
      </section>
    </div>
    <details class="explainer page-pad">
      <summary>How to read this</summary>
      <p class="small">This is context for a trade, not a forecast. Max pain and dealer gamma are theoretical models with real disagreement in the literature about how much they actually influence price. The IV skew uses the strike nearest 10% out-of-the-money as a stand-in for true 25-delta (the free data here doesn't include delta directly).</p>
    </details>`;

  barChart(el("oiChart"), {
    labels: [...new Set([...r.callOI.map((x) => x.strike), ...r.putOI.map((x) => x.strike)])].sort((a, b) => a - b).map((s) => fmtUSD(s)),
    datasets: [
      { label: "Call OI", data: mergeByStrike(r.callOI, r.putOI, "call"), color: "--green" },
      { label: "Put OI", data: mergeByStrike(r.callOI, r.putOI, "put"), color: "--red" },
    ],
  });
  if (r.gammaByStrike.length) {
    barChart(el("gammaChart"), {
      labels: r.gammaByStrike.map((g) => fmtUSD(g.strike)),
      datasets: [{ label: "Dealer gamma ($/1% move)", data: r.gammaByStrike.map((g) => g.gammaExposure), color: "--s1" }],
    });
  }

  el("expSelect").addEventListener("change", (e) => { state.expiration = Number(e.target.value); load(c, symbol); });
}

function mergeByStrike(callOI, putOI, which) {
  const strikes = [...new Set([...callOI.map((x) => x.strike), ...putOI.map((x) => x.strike)])].sort((a, b) => a - b);
  const map = new Map((which === "call" ? callOI : putOI).map((x) => [x.strike, x.openInterest]));
  return strikes.map((s) => map.get(s) || 0);
}

export async function render(c, { symbol }) {
  state = { expiration: null };
  c.innerHTML = `<div id="optBody"></div>`;
  load(c, symbol);
}
