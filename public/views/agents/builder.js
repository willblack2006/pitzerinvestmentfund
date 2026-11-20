// Agents → Build tab (plan 3.6 tab registry). Key "new", so #/agents/new opens it.
export default {
  key: "new", label: "Build", order: 80,
  async render(el) { (await import("../../agentBuilder/builder.js")).mountBuilder(el, { embedded: true }); },
};
