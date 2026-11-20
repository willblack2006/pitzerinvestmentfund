// Agents → Events the rules router saw (moved from views/agents.js unchanged, WS11).
import { eventsTable } from "../agents.js";

export default {
  key: "events", label: "Events", order: 80,
  async render(el, ctx) {
    const o = await ctx.overview();
    el.innerHTML = `<p class="muted small">Plain rules, no AI, decide what each filing deserves: <strong>push</strong> (bankruptcy, impairment, restatement and similar), <strong>inbox</strong> (results, executive changes, material agreements) or <strong>digest</strong> (routine).</p>` + eventsTable(o.events);
  },
};
