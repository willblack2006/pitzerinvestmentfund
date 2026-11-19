// Team feed and agent profiles (WS7).
export default [
  { pattern: "feed/:tab?", load: () => import("../views/feed.js"), section: "agents" },
  { pattern: "feed/item/:id", load: () => import("../views/feed.js"), section: "agents" },
  { pattern: "feed/t/:symbol", load: () => import("../views/feed.js"), section: "agents" },
  { pattern: "agents/a/:slug", load: () => import("../views/agents/profile.js"), section: "agents" },
];
