import { esc, api, can, pageHead, lockedHint, skeleton, emptyState, errorState, bindRetry, toast } from "../shared.js";
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
  // Agent notifications are grouped by agent, each group with a Mute button (WS11).
  const agentName = (n) => (/^agent/.test(n.type) && /^#\/agents\/runs\/\d+$/.test(n.link || "") ? String(n.title).split(/[:(]/)[0].trim() : null);
  const listHtml = () => {
    const out = [], groups = new Map();
    for (const n of items) {
      const a = agentName(n);
      if (!a) { out.push(itemHtml(n)); continue; }
      if (!groups.has(a)) { groups.set(a, []); out.push({ group: a }); }
      groups.get(a).push(n);
    }
    return out.map((x) => typeof x === "string" ? x : `<li class="inbox-group"><div class="inbox-group-head"><strong>${esc(x.group)}</strong><span class="small muted">${groups.get(x.group).length} update${groups.get(x.group).length === 1 ? "" : "s"}</span>
      <button type="button" class="btn-link small" data-mute-run="${esc(groups.get(x.group)[0].link.split("/").pop())}">Mute this agent</button></div>
      <ul class="inbox-list">${groups.get(x.group).map(itemHtml).join("")}</ul></li>`).join("");
  };
  const draw = () => {
    body.innerHTML = items.length
      ? `<ul class="inbox-list inbox-page">${listHtml()}</ul>${hasMore ? `<button type="button" class="btn btn-ghost btn-sm" id="older">Older</button>` : ""}`
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
    const m = e.target.closest("[data-mute-run]");
    if (m) {
      m.disabled = true;
      api("/api/agents-hub/mute", { method: "POST", body: JSON.stringify({ runId: Number(m.dataset.muteRun) }) })
        .then((r) => { m.textContent = "Muted"; toast(`${r.agent.name} won't notify you any more. Unmute it from its page.`, { type: "success" }); })
        .catch((err) => { m.disabled = false; toast(err.message, { type: "error" }); });
      return;
    }
    const a = e.target.closest("[data-open]");
    if (a) markRead(Number(a.dataset.open));
  });
  container.querySelector("#readAll").addEventListener("click", async () => { await markAllRead(); items.forEach((n) => { n.readAt ||= "x"; }); draw(); });
  const onChange = () => { if (!container.isConnected) { window.removeEventListener("pif:inbox-changed", onChange); return; } fetchPage().catch(() => {}); };
  window.addEventListener("pif:inbox-changed", onChange);
}
