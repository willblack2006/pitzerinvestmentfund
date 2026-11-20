// Agents page tab registry (agent platform, plan 3.6). Each tab is a module in this folder:
//
//   // public/views/agents/feed.js
//   export default { key: "feed", label: "Feed", order: 20, render(el, ctx) { ... } };
//
// and appends its file name to TAB_FILES below (append-only, one line each). WS11's Agents shell
// calls loadTabs(); a tab file that fails to import is skipped with a console warning.
export const TAB_FILES = [
  "home.js",
  "ask.js",
  "briefs.js",
  "desk.js",
  "approvals.js",
  "activity.js",
  "events.js",
  "teams.js",
  "stats.js",
  "memory.js",
  "gallery.js",
  "builder.js",
];

export async function loadTabs() {
  const loaded = await Promise.allSettled(TAB_FILES.map((f) => import(`./${f}`)));
  const tabs = [];
  loaded.forEach((r, i) => {
    if (r.status !== "fulfilled") { console.warn(`[agents] tab ${TAB_FILES[i]} failed to load`, r.reason); return; }
    const t = r.value.default || r.value;
    if (t && t.key && typeof t.render === "function") tabs.push(t);
    else console.warn(`[agents] tab ${TAB_FILES[i]} has no key/render`);
  });
  return tabs.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || String(a.label).localeCompare(String(b.label)));
}
