// Route registry (agent platform, plan 3.6). Each workstream adds one file next to this one:
//
//   // public/routes.d/feed.js
//   export default { pattern: "feed/:tab?", load: () => import("../views/feed.js"), section: "agents" };
//
// and appends its file name to ROUTE_FILES below (append-only, one line each). A trailing "?"
// makes a segment optional. `section` is the top nav item to highlight. A file that fails to
// load is skipped with a console warning, so one broken route can't take down the app.
// A file may also export an array of entries.
export const ROUTE_FILES = [
  "theses.js",
  "cockpit.js",
  "teams.js",
  "observability.js",
  "memory.js",
  "agentBuilder.js",
];
