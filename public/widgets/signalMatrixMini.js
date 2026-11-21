// Cockpit widget (WS10): signal matrix mini (holdings × signals heatmap, no labels in cells) and
// the biggest moves today measured against each stock's own volatility. Both read
// GET /api/signal-matrix (cached 20 minutes server-side).
import { api, esc } from "../shared.js";
import { divergingFill, tooltip } from "../viz/rv.js";

export default {
  key: "signal-matrix",
  title: "Signal matrix",
  description: "Every holding against every signal, at a glance",
  size: "m",
  defaultOn: true,
  async render(body) {
    const d = await api("/api/signal-matrix?scope=holdings");
    const rows = d.rows.slice().sort((a, b) => (a.summary ?? 0) - (b.summary ?? 0)).slice(0, 12);
    if (!rows.length) { body.innerHTML = `<p class="muted small">No holdings to score.</p>`; return; }
    body.innerHTML = `<table class="rv-w-mini"><caption class="sr-only">Weakest holdings first; each cell from strong warning to strongly supportive</caption>
      <thead><tr><th scope="col"><span class="sr-only">Ticker</span></th>${d.signals.map((s) => `<th scope="col" title="${esc(s.label)}"><span class="sr-only">${esc(s.label)}</span></th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr><th scope="row"><a href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></th>${d.signals.map((s) => {
        const c = r.cells[s.key];
        return `<td style="--fill:${divergingFill(c.score)}" data-tip="${esc(`<strong>${esc(r.symbol)} · ${esc(s.label)}</strong><br>${esc(c.text || "No data")}`)}"><span class="sr-only">${esc(s.label)} ${c.score === null ? "no data" : Math.round(c.score * 100)}</span></td>`;
      }).join("")}</tr>`).join("")}</tbody></table>
      <p class="small"><a href="#/signals/matrix">Full matrix →</a></p>`;
    tooltip(body);
  },
};
