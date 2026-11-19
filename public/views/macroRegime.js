// Macro → regime dashboard (WS10): a plain read of the cycle (curve, inflation, credit, jobs,
// policy) and ten years of each series as small multiples with recession months shaded.
import { api, esc } from "../shared.js";
import { linear, niceTicks, responsiveSvg, tooltip, dataToggle } from "../viz/rv.js";

export const regimeHtml = () => `
  <section class="panel rv-regime" aria-labelledby="regime-h">
    <div class="panel-head"><h3 id="regime-h">Where the cycle is</h3><span class="muted small">Rule-based read of FRED data, ten years · grey bands are recessions</span></div>
    <div id="regimeBody"><p class="muted small">Loading ten years of macro data…</p></div>
  </section>`;

const STATUS = { good: ["Calm", "rv-st-good"], watch: ["Watch", "rv-st-watch"], warn: ["Warning", "rv-st-warn"], info: ["", "rv-st-info"] };
const ORDER = ["curve10y2y", "curve10y3m", "coreCpi", "corePce", "hySpread", "igSpread", "unemployment", "claims", "fedFunds", "breakeven5y", "vix"];

export async function loadRegime() {
  const box = document.getElementById("regimeBody");
  if (!box) return;
  let d;
  try { d = await api("/api/macro/regime"); } catch (err) { box.innerHTML = `<p class="muted">Couldn't load the macro regime: ${esc(err.message)}</p>`; return; }
  if (!document.getElementById("regimeBody")) return;
  if (!d.available) { box.innerHTML = `<p class="muted">${/FRED_API_KEY/.test(d.reason || "") ? "The macro regime needs a FRED API key on the server." : esc(d.reason || "Macro data unavailable.")}</p>`; return; }
  const keys = ORDER.filter((k) => d.series[k]);
  box.innerHTML = `
    <p class="rv-regime-call"><strong>${esc(d.regime)}.</strong> ${esc(d.regimeText)}</p>
    <ul class="rv-reads">${d.reads.map((r) => `<li class="${STATUS[r.status]?.[1] || ""}"><span class="rv-read-label">${esc(r.label)}${STATUS[r.status]?.[0] ? ` <span class="rv-st-pill">${STATUS[r.status][0]}</span>` : ""}</span><span class="rv-read-text">${esc(r.text)}</span></li>`).join("")}</ul>
    <div class="rv-multiples">${keys.map((k) => `<figure class="rv-mult"><figcaption>${esc(d.series[k].label)} <b>${fmt(d.series[k].latest?.value, d.series[k].unit)}</b></figcaption><div class="rv-mult-chart" id="mm-${k}"></div></figure>`).join("")}</div>
    <p class="muted small">Source: Federal Reserve Economic Data (FRED), monthly averages; recessions are NBER dates (USREC). The thresholds are common rules of thumb, not forecasts.</p>`;
  for (const k of keys) small(document.getElementById(`mm-${k}`), d.series[k], d.recessions);
  tooltip(box.querySelector(".rv-multiples"));
}

const fmt = (v, unit) => (v === null || v === undefined ? "—" : unit === "%" ? `${v.toFixed(2)}%` : unit === "pts" ? `${v.toFixed(2)}` : unit === "k" ? `${Math.round(v)}k` : v.toFixed(1));

function small(host, s, recessions) {
  const obs = s.observations;
  if (!host || obs.length < 2) return;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const vals = obs.map((o) => o.value);
  const zeroLine = s.unit === "pts";
  const yt = niceTicks(Math.min(...vals, zeroLine ? 0 : Infinity), Math.max(...vals), 3);
  const t0 = t(obs[0].date), t1 = t(obs.at(-1).date);
  responsiveSvg(host, `${s.label}, monthly since ${obs[0].date}: now ${fmt(obs.at(-1).value, s.unit)}, low ${fmt(Math.min(...vals), s.unit)}, high ${fmt(Math.max(...vals), s.unit)}.`, (W) => {
    const H = 110, P = { l: 34, r: 6, t: 6, b: 18 };
    const x = linear([t0, t1], [P.l, W - P.r]), y = linear([yt[0], yt.at(-1)], [H - P.b, P.t]);
    const path = obs.map((o, i) => `${i ? "L" : "M"}${x(t(o.date)).toFixed(1)},${y(o.value).toFixed(1)}`).join("");
    const years = [];
    for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr += 2) years.push(yr);
    // Invisible hover targets, one per month.
    const step = (W - P.l - P.r) / obs.length;
    const hits = obs.map((o) => `<rect x="${(x(t(o.date)) - step / 2).toFixed(1)}" y="${P.t}" width="${Math.max(1, step).toFixed(1)}" height="${H - P.t - P.b}" fill="transparent" data-tip="${esc(`<strong>${esc(o.date.slice(0, 7))}</strong><br>${esc(s.label)}: ${fmt(o.value, s.unit)}`)}"/>`).join("");
    return {
      height: H,
      html: `
        ${recessions.filter((r) => t(r.end) >= t0).map((r) => { const a = x(Math.max(t0, t(r.start))), b = x(Math.min(t1, t(r.end) + 30 * 864e5)); return `<rect x="${a}" y="${P.t}" width="${Math.max(2, b - a)}" height="${H - P.t - P.b}" fill="var(--rv-recession)"/>`; }).join("")}
        ${yt.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${P.l - 4}" y="${y(v) + 3}" text-anchor="end" class="rv-axis-text">${v}</text>`).join("")}
        ${zeroLine && yt[0] < 0 ? `<line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border-strong)"/>` : ""}
        ${years.map((yr) => `<text x="${x(Date.UTC(yr, 0, 1))}" y="${H - 4}" text-anchor="middle" class="rv-axis-text">’${String(yr).slice(2)}</text>`).join("")}
        <path d="${path}" fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="${x(t1)}" cy="${y(obs.at(-1).value)}" r="3" fill="var(--chart-line)"/>
        ${hits}`,
    };
  });
  dataToggle(host, s.label, ["Month", s.label], obs.slice().reverse().map((o) => [o.date.slice(0, 7), fmt(o.value, s.unit)]));
}
