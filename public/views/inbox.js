import { esc, api, can, pageHead, lockedHint, skeleton, emptyState, errorState, bindRetry } from "../shared.js";
import { itemHtml, markRead, markAllRead } from "../inbox.js";

export const title = "Notifications";

export async function mount(container) {
  if (!can("member")) {
    container.innerHTML = pageHead("Notifications") + `<div class="toolbar">${lockedHint("Sign in to see your notifications.")}</div>`;
    return;
  }
  container.innerHTML = pageHead("Notifications", "Votes opening, results of pitches you wrote or voted on, fund trades, your price alerts, paper orders and chat mentions.",
    `<button type="button" class="btn btn-ghost" id="readAll">Mark all read</button> <a class="btn btn-ghost" href="#/account/notify">Choose what you get</a>`) + `<div class="page-pad" id="inboxBody">${skeleton("rows", { rows: 5, label: "Loading" })}</div>`;
  let items = [], hasMore = false;
  const body = container.querySelector("#inboxBody");
  const draw = () => {
    body.innerHTML = items.length
      ? `<ul class="inbox-list inbox-page">${items.map(itemHtml).join("")}</ul>${hasMore ? `<button type="button" class="btn btn-ghost btn-sm" id="older">Older</button>` : ""}`
      : emptyState({ icon: "bell", title: "No notifications yet", body: "Set a price alert on any Research page, or follow pitches, and they'll show up here.", action: { label: "Open Research", href: "#/research" } });
  };
  const fetchPage = async (before) => {
    const r = await api(`/api/notifications?limit=50${before ? `&before=${before}` : ""}`);
    items = before ? [...items, ...r.items] : r.items;
    hasMore = r.hasMore;
    draw();
  };
  const firstLoad = async () => {
    try { await fetchPage(); } catch (err) {
      body.innerHTML = errorState({ title: "Couldn't load notifications.", detail: err.message, retryId: "load" });
      bindRetry(body, "load", firstLoad);
      return false;
    }
    return true;
  };
  if (!(await firstLoad())) return;
  body.addEventListener("click", (e) => {
    if (e.target.closest("#older")) { fetchPage(items.at(-1).id); return; }
    const a = e.target.closest("[data-open]");
    if (a) markRead(Number(a.dataset.open));
  });
  container.querySelector("#readAll").addEventListener("click", async () => { await markAllRead(); items.forEach((n) => { n.readAt ||= "x"; }); draw(); });
  const onChange = () => { if (!container.isConnected) { window.removeEventListener("pif:inbox-changed", onChange); return; } fetchPage().catch(() => {}); };
  window.addEventListener("pif:inbox-changed", onChange);
}
