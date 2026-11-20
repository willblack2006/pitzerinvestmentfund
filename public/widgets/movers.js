import { esc, fmt, arrow } from "../viz/core.js";

export default {
  key: "movers", title: "Biggest movers", size: "s", defaultOn: true,
  description: "Top and bottom holdings by return for the period.",
  render(body, ctx) {
    const p = ctx.period;
    const rows = ctx.data.holdings.filter((h) => Number.isFinite(h.ret?.[p])).sort((a, b) => b.ret[p] - a.ret[p]);
    if (!rows.length) { body.innerHTML = ctx.empty("No returns yet", "Needs prices for the period."); return; }
    const n = Math.min(4, Math.ceil(rows.length / 2));
    const li = (h) => `<li><a href="#/research/${encodeURIComponent(h.symbol)}">${esc(h.symbol)}</a><span class="num ${h.ret[p] >= 0 ? "gain-pos" : "gain-neg"}">${arrow(h.ret[p])}${fmt.spct(h.ret[p], 1)}</span></li>`;
    body.innerHTML = `<h4 class="small muted">Best</h4><ul class="mini-list">${rows.slice(0, n).map(li).join("")}</ul>
      <h4 class="small muted">Worst</h4><ul class="mini-list">${rows.slice(-n).reverse().map(li).join("")}</ul>`;
  },
};
