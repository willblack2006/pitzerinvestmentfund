// "What moved the fund": a rule-based paragraph (no AI) for the selected period, plus chips
// for the names that drove it. Today's version comes with the cockpit; other periods ask
// the contribution endpoint, which the waterfall shares.
import { esc } from "../viz/core.js";

export default {
  key: "explain", title: "What moved the fund", size: "m", defaultOn: true,
  description: "A plain-English summary of the period's biggest movers (no AI).",
  async render(body, ctx) {
    const c = ctx.period === "1d" ? { explain: ctx.data.explain } : await ctx.contribution();
    const ex = c?.explain;
    if (!ex) { body.innerHTML = ctx.empty("Nothing to explain yet", "Needs at least two days of prices for the holdings."); return; }
    const chip = (s, kind) => `<a class="chip" href="#/research/${encodeURIComponent(s)}">${esc(s)} ${kind === "up" ? "up" : "down"}</a>`;
    const fundUp = (ctx.period === "1d" ? ctx.data.periods["1d"].fund : c.fundReturn) >= 0;
    body.innerHTML = `<p class="explain-text">${ex.lines.map((l) => esc(l)).join(" ")}</p>
      <div class="explain-chips" aria-label="Names that drove it">${ex.top.map((s) => chip(s, fundUp ? "up" : "down")).join("")}${ex.offset.map((s) => chip(s, fundUp ? "down" : "up")).join("")}</div>`;
  },
};
