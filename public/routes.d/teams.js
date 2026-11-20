// Agent teams (WS6): a team run's page. The Teams tab itself is in public/views/agents/teams.js.
export default { pattern: "agents/teams/:id", load: () => import("../views/teamRun.js"), section: "agents" };
