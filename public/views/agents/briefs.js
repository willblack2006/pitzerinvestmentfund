// Agents → Briefs & reports (moved from views/agents.js unchanged, WS11).
import { api, emptyState } from "../../shared.js";
import { outputCard } from "../agents.js";

export default {
  key: "briefs", label: "Briefs & reports", order: 30,
  async render(el) {
    const r = await api("/api/agents/briefs");
    el.innerHTML = r.briefs.length ? r.briefs.map((x) => outputCard(x.brief, x.runId, x.feedback)).join("")
      : emptyState({ icon: "doc", title: "No briefs yet", body: "When a holding files an 8-K, 10-Q or 10-K, its brief appears here. You can also brief any filing from a stock's Filings tab." });
  },
};
