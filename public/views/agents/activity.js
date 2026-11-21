// Agents → Activity: every run and its cost (moved from views/agents.js unchanged, WS11).
import { esc } from "../../shared.js";
import { runsTable, workflowLabel, money } from "../agents.js";

export default {
  key: "activity", label: "Activity", order: 70,
  async render(el, ctx) {
    const o = await ctx.overview();
    const spend = o.monthByFeature.length ? `<p class="pf-sub">This month by feature</p><ul class="chip-list">${o.monthByFeature.map((f) => `<li class="chip">${esc(workflowLabel(f.workflow))}: ${f.runs} run${f.runs === 1 ? "" : "s"}, ${money(f.costUsd)}</li>`).join("")}</ul>` : "";
    const acc = o.acceptance.length ? `<p class="pf-sub">Member verdicts</p><ul class="chip-list">${o.acceptance.map((a) => `<li class="chip">${esc(workflowLabel(a.workflow))}: ${a.useful} useful, ${a.notUseful} not useful, ${a.wrong} wrong</li>`).join("")}</ul>` : "";
    el.innerHTML = spend + acc + runsTable(o.runs);
  },
};
