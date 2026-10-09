// Personal notifications: the 🔔 for signed-in members opens this inbox (visitors keep the
// bell as a link to the fund's Alerts page). New ones arrive live over /api/events.
import { el, esc, api, toast, can } from "./shared.js";

const state = { items: [], unread: 0, hasMore: false, loaded: false, fundAlerts: 0 };
const ICON = { mention: "@", pitchVoting: "🗳", pitchResult: "✅", fundTrade: "💼", priceAlert: "📈", paperOrder: "🧪" };
// Types that have no other live toast of their own (chat mentions and fund trades already do).
const TOAST = new Set(["pitchVoting", "pitchResult", "priceAlert", "paperOrder"]);

const ago = (utc) => {
  const mins = Math.round((Date.now() - Date.parse(`${utc.replace(" ", "T")}Z`)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(`${utc.replace(" ", "T")}Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function itemHtml(n) {
  return `<li class="inbox-item ${n.readAt ? "" : "unread"}" data-note-id="${n.id}">
    <a href="${esc(n.link || "#/inbox")}" data-open="${n.id}">
      <span class="inbox-icon" aria-hidden="true">${ICON[n.type] || "•"}</span>
      <span class="inbox-text"><strong>${esc(n.title)}</strong>${n.body ? `<span class="small muted">${esc(n.body)}</span>` : ""}<span class="small muted">${esc(ago(n.createdAt))}${n.readAt ? "" : '<span class="sr-only"> (unread)</span>'}</span></span>
    </a>
  </li>`;
}

function updateBadge() {
  const b = el("inboxCount");
  b.textContent = state.unread > 9 ? "9+" : String(state.unread);
  b.classList.toggle("hidden", !state.unread);
  el("inboxBtn").setAttribute("aria-label", state.unread ? `Notifications: ${state.unread} unread` : "Notifications");
}

function renderMenu() {
  const menu = el("inboxMenu");
  menu.innerHTML = `
    <div class="inbox-head"><strong>Notifications</strong>
      ${state.unread ? `<button type="button" class="btn-link small" data-read-all>Mark all read</button>` : ""}</div>
    <a class="inbox-fund small" href="#/alerts">💡 Fund alerts${state.fundAlerts ? `: <strong>${state.fundAlerts} need action</strong>` : ""} →</a>
    ${state.items.length ? `<ul class="inbox-list">${state.items.slice(0, 12).map(itemHtml).join("")}</ul>`
      : `<p class="muted small inbox-empty">${state.loaded ? "Nothing yet. You'll hear about votes, results of your pitches, fund trades, your price alerts and mentions here." : "Loading…"}</p>`}
    <div class="inbox-foot"><a href="#/inbox" class="small">See all</a><a href="#/account/notify" class="small">Choose what you get</a></div>`;
}

async function load() {
  try {
    const r = await api("/api/notifications?limit=30");
    state.items = r.items; state.unread = r.unread; state.hasMore = r.hasMore; state.loaded = true;
    updateBadge();
    if (el("inboxMenu").matches(":popover-open")) renderMenu();
    window.dispatchEvent(new CustomEvent("pif:inbox-changed"));
  } catch { /* best effort */ }
}

export async function markRead(id) {
  const n = state.items.find((x) => x.id === id);
  if (n && !n.readAt) {
    n.readAt = new Date().toISOString();
    try { state.unread = (await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ id }) })).unread; } catch { /* ignore */ }
    updateBadge();
  }
}

export async function markAllRead() {
  try { await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }); } catch (err) { toast(err.message, { type: "error" }); return; }
  state.items.forEach((n) => { n.readAt ||= new Date().toISOString(); });
  state.unread = 0;
  updateBadge();
  window.dispatchEvent(new CustomEvent("pif:inbox-changed"));
}

export function inboxState() { return state; }

// The bell for members; the fund's action-needed count is passed in from app.js.
export function setFundAlertCount(n) { state.fundAlerts = n; }

export function initInbox() {
  const menu = el("inboxMenu");
  menu.addEventListener("toggle", (e) => { if (e.newState === "open") { renderMenu(); if (!state.loaded) load(); } });
  menu.addEventListener("click", async (e) => {
    if (e.target.closest("[data-read-all]")) { await markAllRead(); renderMenu(); return; }
    const a = e.target.closest("a");
    if (!a) return;
    const id = Number(a.dataset.open);
    if (id) markRead(id);
    menu.hidePopover();
  });
  const sync = () => {
    const on = can("member");
    el("inboxBtn").classList.toggle("hidden", !on);
    el("alertsLink").classList.toggle("hidden", on);
    if (on) load(); else { state.items = []; state.unread = 0; state.loaded = false; }
  };
  window.addEventListener("pif:session-changed", sync);
  sync();
  window.addEventListener("pif:live", (e) => {
    const { type, data } = e.detail;
    if (type === "hello" && can("member")) { load(); return; }
    if (type !== "notify") return;
    state.items.unshift(data);
    state.unread += 1;
    updateBadge();
    if (menu.matches(":popover-open")) renderMenu();
    window.dispatchEvent(new CustomEvent("pif:inbox-changed"));
    if (TOAST.has(data.type)) toast(data.title, data.link ? { action: { label: "View", onClick: () => { markRead(data.id); location.hash = data.link; } } } : {});
  });
}
