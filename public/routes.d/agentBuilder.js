// Agent builder pages (WS3). #/agents/new and #/agents/gallery are tabs of the Agents page.
const load = () => import("../views/agentBuilder.js");
export default [
  { pattern: "agents/:slug/edit", load, section: "agents" },
  { pattern: "agents/new/:template", load, section: "agents" },
];
