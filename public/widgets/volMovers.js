// Cockpit widget (WS10): today's biggest moves in units of each holding's own daily volatility,
// so a 3% day in a utility stands out and a 3% day in a small-cap biotech doesn't.
import { api, esc } from "../shared.js";

export default {
  key: "vol-movers",
  title: "Unusual moves today",
  description: "Biggest moves against each stock's own volatility",
  size: "s",
  defaultOn: true,
  async render(body) {
    const d = await api("/api/signal-matrix?scope=holdings");
    const m = d.movers || [];
    if (!m.length) { body.innerHTML = `<p class="muted small">No price data yet today.</p>`; return; }
    body.innerHTML = `<ul class="rv-w-list">${m.map((x) => `<li><a href="#/research/${encodeURIComponent(x.symbol)}"><strong>${esc(x.symbol)}</strong></a><span class="muted">${esc(x.text)}</span><span class="${x.sigmas >= 0 ? "tone-good" : "tone-bad"}">${x.sigmas >= 0 ? "+" : "−"}${Math.abs(x.sigmas).toFixed(1)}σ</span></li>`).join("")}</ul>`;
  },
};
