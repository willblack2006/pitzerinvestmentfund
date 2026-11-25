import { esc, fmt } from "../viz/core.js";

export default {
  key: "ips", title: "Policy headroom", size: "s", defaultOn: true,
  description: "How close the fund is to each investment-policy limit.",
  render(body, ctx) {
    const items = ctx.data.ips || [];
    const breaches = (ctx.data.checks || []).filter((c) => c.level === "breach");
    if (!items.length) { body.innerHTML = ctx.empty("No limits set", "Set position, sector and cash limits in Settings to track headroom here.", { label: "Open Settings", href: "#/settings" }); return; }
    body.innerHTML = `${breaches.length ? `<p class="small gain-neg" role="alert">${breaches.length} breach${breaches.length === 1 ? "" : "es"}: ${esc(breaches[0].detail)}</p>` : ""}
      <ul class="mini-list">${items.map((i) => {
        const used = i.unit === "%" ? i.current / i.limit : i.current / i.limit;
        const tight = i.headroom < 0 ? "is-breach" : i.headroom / (i.limit || 1) < 0.15 ? "is-tight" : "";
        const what = i.symbol ? ` (${esc(i.symbol)})` : i.sector ? ` (${esc(i.sector)})` : "";
        return `<li style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(i.rule)}${what}</span>
          <span class="num">${i.unit === "%" ? `${i.current.toFixed(1)}% of ${i.limit}%` : `${i.current} of ${i.limit}`}</span></div>
          <div class="kpi-bar ${tight}" role="img" aria-label="${esc(`${i.rule}: ${i.headroom >= 0 ? `${i.headroom.toFixed(1)}${i.unit} of room` : `over by ${Math.abs(i.headroom).toFixed(1)}${i.unit}`}`)}"><span style="width:${Math.min(100, Math.max(2, used * 100)).toFixed(0)}%"></span></div></li>`;
      }).join("")}</ul>`;
    ctx.foot(`Limits from the fund's policy. <a href="#/allocation">Allocation &amp; policy</a>`, true);
  },
};
