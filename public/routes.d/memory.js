// Shared memory page (WS5): #/memory and #/memory/:symbol. Also hooks the run page (#/agents/runs/:id)
// to add a "Why?" panel: agents.js fires pif:agent-run after it draws a run.
export default { pattern: "memory/:symbol?", load: () => import("../views/memory.js"), section: "agents" };

if (typeof window !== "undefined" && !window.__pifMemoryWhy) {
  window.__pifMemoryWhy = true;
  window.addEventListener("pif:agent-run", (e) => {
    import("../memoryWhy.js").then((m) => m.addWhy(e.detail)).catch((err) => console.warn("[memory] Why? panel failed", err));
  });
}
