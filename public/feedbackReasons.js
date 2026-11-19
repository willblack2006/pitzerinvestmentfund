// Reason chips under the Useful / Not useful / Wrong buttons on every agent run card (plan WS8).
// After a member picks a verdict, a row of reasons appears ("Wrong number", "Already knew", ...);
// picking one saves it with POST /api/agents/runs/:id/reasons. Self-installing: importing this
// module once anywhere wires every card on every page.
import { api, esc, toast } from "./shared.js";

const REASONS = {
  useful: [["great_catch", "Great catch"], ["saved_time", "Saved me time"]],
  not_useful: [["not_relevant", "Not relevant"], ["already_knew", "Already knew"], ["too_long", "Too long"]],
  wrong: [["wrong_number", "Wrong number"], ["wrong_source", "Bad source"], ["not_relevant", "Not relevant"]],
};

export function reasonChips(runId, verdict, mine = []) {
  const list = REASONS[verdict];
  if (!list) return "";
  return `<span class="fb-reasons" role="group" aria-label="What made it ${verdict === "useful" ? "useful" : "miss"}?" data-reasons-run="${esc(runId)}" data-verdict="${esc(verdict)}">
    <span class="muted small">Why?</span>${list.map(([k, label]) => `<button type="button" class="chip fb-reason" data-reason="${k}" aria-pressed="${mine.includes(k)}">${esc(label)}</button>`).join("")}</span>`;
}

function install() {
  if (window.__pifFeedbackReasons) return;
  window.__pifFeedbackReasons = true;
  // After a verdict click, the existing handler swaps the button group; add chips next to it.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-feedback]");
    if (!b) return;
    const runId = b.dataset.run, verdict = b.dataset.feedback;
    const host = b.closest(".agent-brief-foot, .agent-feedback-host, footer") || b.parentElement?.parentElement;
    if (!host) return;
    setTimeout(() => {
      host.querySelector(`.fb-reasons[data-reasons-run="${CSS.escape(runId)}"]`)?.remove();
      host.insertAdjacentHTML("beforeend", reasonChips(runId, verdict));
    }, 400);
  });
  document.addEventListener("click", async (e) => {
    const c = e.target.closest(".fb-reason");
    if (!c) return;
    const group = c.closest(".fb-reasons");
    c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true"));
    const reasons = [...group.querySelectorAll('.fb-reason[aria-pressed="true"]')].map((x) => x.dataset.reason);
    if (!reasons.length) return;
    try {
      await api(`/api/agents/runs/${encodeURIComponent(group.dataset.reasonsRun)}/reasons`, { method: "POST", body: JSON.stringify({ verdict: group.dataset.verdict, reasons }) });
    } catch (err) { toast(err.message, { type: "error" }); }
  });
}
install();
