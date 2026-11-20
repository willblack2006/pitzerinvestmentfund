// WS8: run trace, agent stats and the admins' AI spend page. Importing feedbackReasons.js here
// adds reason chips to every run card's feedback buttons app-wide.
import "../feedbackReasons.js";

export default [
  { pattern: "agents/trace/:id", load: () => import("../views/agents/trace.js"), section: "agents" },
  { pattern: "agents/stats/:key", load: () => import("../views/agents/stats.js"), section: "agents" },
  { pattern: "ai-spend", load: () => import("../views/aiSpend.js"), section: "settings" },
];
