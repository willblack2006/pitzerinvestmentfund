// Agents → Approvals (moved from views/agents.js unchanged, WS11).
import { api, toast } from "../../shared.js";
import { proposalsList } from "../agents.js";

export default {
  key: "approvals", label: "Approvals", order: 60,
  async render(el, ctx) {
    const r = await api("/api/agents/proposals");
    el.innerHTML = proposalsList(r.proposals);
    if (el.dataset.decideBound) return;
    el.dataset.decideBound = "1";
    el.addEventListener("click", async (e) => {
      const d = e.target.closest("[data-decide]");
      if (!d) return;
      d.disabled = true;
      try {
        await api(`/api/agents/proposals/${d.dataset.decide}/decide`, { method: "POST", body: JSON.stringify({ approve: d.dataset.approve === "1" }) });
        toast(d.dataset.approve === "1" ? "Approved and applied." : "Rejected.", { type: "success" });
        ctx.reload();
      } catch (err) { d.disabled = false; toast(err.message, { type: "error" }); }
    });
  },
};
