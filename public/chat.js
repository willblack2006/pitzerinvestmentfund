// Club chat (members only): a side panel on every page (a full page on phones at #/chat), live
// over the /api/events stream. Members can send a highlighted quote or a snapshot of any panel
// with a comment, so others land on exactly what they're talking about.
import { el, esc, api, toast, can, currentMember, safeUrl } from "./shared.js";
import { pageContext } from "./notes.js";

const state = {
  messages: [], hasMore: false, loaded: false, members: [], reactions: ["👍", "👀", "🔥", "❓", "✅", "😂"],
  unread: 0, mentions: 0, online: [], attachment: null, image: null, replyTo: null, open: false,
};
let root = null;      // element currently showing the chat (panel body or #view on phones)
let panel = null;     // the desktop side panel <dialog>

const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const time = (iso) => new Date(`${iso.replace(" ", "T")}Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (iso) => new Date(`${iso.replace(" ", "T")}Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

// esc first, then add links: in-app (#/…) and http(s) URLs, $TICKER, and @mentions.
function richText(s) {
  let h = esc(s);
  h = h.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${u}</a>`);
  h = h.replace(/(^|\s)(#\/[\w\-./%=&?]+)/g, (_, pre, ref) => `${pre}<a href="${ref}">${ref}</a>`);
  h = h.replace(/\$([A-Z][A-Z0-9.\-]{0,9})\b/g, (_, t) => `<a href="#/research/${encodeURIComponent(t)}">$${t}</a>`);
  const me = currentMember();
  for (const m of state.members) {
    const first = m.name.split(/\s+/)[0];
    for (const label of [m.name, first]) {
      const re = new RegExp(`(^|\\s)@${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s,.!?:;]|$)`, "gi");
      h = h.replace(re, (_, pre) => `${pre}<span class="mention ${me && m.id === me.id ? "mention-me" : ""}">@${esc(label)}</span>`);
    }
  }
  return h.replace(/\n/g, "<br>");
}

function attachmentHtml(a, image) {
  const link = a?.pageRef ? `<a class="att-link" href="${esc(a.pageRef)}">View in app${a.pageTitle ? `: ${esc(a.pageTitle)}` : ""} →</a>` : "";
  if (image) return `<figure class="att att-snap"><a href="${esc(image)}" target="_blank" rel="noopener"><img src="${esc(image)}" alt="Snapshot${a?.pageTitle ? ` of ${esc(a.pageTitle)}` : ""}" loading="lazy" /></a>${link ? `<figcaption>${link}</figcaption>` : ""}</figure>`;
  if (!a) return "";
  if (a.kind === "quote") return `<div class="att att-quote"><blockquote>${esc(a.quote)}</blockquote>${link}</div>`;
  return `<div class="att">${link}</div>`;
}

function messageHtml(m, prev) {
  const me = currentMember();
  const mine = me && m.memberId === me.id;
  const grouped = prev && prev.memberId === m.memberId && !prev.deleted && Date.parse(`${m.createdAt.replace(" ", "T")}Z`) - Date.parse(`${prev.createdAt.replace(" ", "T")}Z`) < 5 * 60e3;
  const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
  const canEdit = mine && !m.deleted && Date.now() - Date.parse(`${m.createdAt.replace(" ", "T")}Z`) < 15 * 60e3;
  const canDelete = !m.deleted && (mine || me?.isAdmin);
  const mentionsMe = me && m.mentions?.includes(me.id);
  return `${newDay ? `<div class="chat-day" role="separator"><span>${esc(dayKey(m.createdAt))}</span></div>` : ""}
  <article class="chat-msg ${grouped && !newDay ? "grouped" : ""} ${mentionsMe ? "mentions-me" : ""}" data-msg="${m.id}" aria-label="${esc(m.authorName)} at ${esc(time(m.createdAt))}">
    <span class="chat-avatar" aria-hidden="true">${grouped && !newDay ? "" : esc(initials(m.authorName))}</span>
    <div class="chat-main">
      ${grouped && !newDay ? "" : `<div class="chat-meta"><a class="chat-author" href="#/members/${m.memberId}"><strong>${esc(m.authorName)}</strong></a> <span class="muted small">${esc(time(m.createdAt))}${m.editedAt ? " · edited" : ""}</span></div>`}
      ${m.reply ? `<div class="chat-reply-ref small muted">↪ ${esc(m.reply.authorName)}: ${esc(m.reply.snippet)}</div>` : ""}
      ${m.deleted ? `<p class="muted small chat-deleted">Message deleted</p>` : `${m.body ? `<div class="chat-body">${richText(m.body)}</div>` : ""}${attachmentHtml(m.attachment, m.image)}`}
      ${m.reactions?.length ? `<div class="chat-reacts">${m.reactions.map((r) => `<button type="button" class="react ${r.mine ? "mine" : ""}" data-react="${esc(r.emoji)}" aria-pressed="${r.mine}" aria-label="${esc(r.emoji)} ${r.count}">${esc(r.emoji)} ${r.count}</button>`).join("")}</div>` : ""}
    </div>
    ${m.deleted ? "" : `<div class="chat-tools">
      <button type="button" data-reply aria-label="Reply">↪</button>
      <button type="button" data-react-menu aria-label="React">☺</button>
      ${canEdit ? `<button type="button" data-edit aria-label="Edit">✎</button>` : ""}
      ${canDelete ? `<button type="button" data-del aria-label="Delete">🗑</button>` : ""}
    </div>`}
  </article>`;
}

// ---- Rendering ----

function shellHtml(mode) {
  return `<div class="chat ${mode === "page" ? "chat-page" : ""}">
    <div class="chat-head">
      <div><h2 id="chatTitle">Club chat</h2><span class="muted small" id="chatOnline"></span></div>
      ${mode === "panel" ? `<button type="button" class="btn-link" id="chatClose" aria-label="Close chat">✕</button>` : ""}
    </div>
    <div class="chat-list" id="chatList" role="log" aria-live="polite" aria-labelledby="chatTitle" tabindex="0"></div>
    <form class="chat-compose" id="chatForm">
      <div id="chatPending"></div>
      <div class="chat-input-row">
        <label class="sr-only" for="chatInput">Message</label>
        <textarea id="chatInput" rows="1" maxlength="2000" placeholder="Message the club…" title="Type @name to mention someone, $TICKER to link a company"></textarea>
        <button type="button" class="btn btn-ghost btn-sm" id="chatSnap" title="Snapshot part of the page">📷<span class="sr-only"> Snapshot part of the page</span></button>
        <button class="btn btn-primary btn-sm" id="chatSend">Send</button>
      </div>
      <div id="chatSuggest" class="chat-suggest hidden" role="listbox" aria-label="Mention a member"></div>
    </form>
  </div>`;
}

function renderList({ keepScroll = false } = {}) {
  const list = root?.querySelector("#chatList");
  if (!list) return;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const prevHeight = list.scrollHeight, prevTop = list.scrollTop;
  list.innerHTML = (state.hasMore ? `<button type="button" class="btn-link small chat-older" id="chatOlder">Load earlier messages</button>` : "") +
    (state.messages.length ? state.messages.map((m, i) => messageHtml(m, state.messages[i - 1])).join("")
      : `<div class="empty-state"><p class="empty-title">Start the conversation</p><p class="muted small">Highlight text on any page and choose "Share to chat", or use 📷 to snapshot a chart or table.</p></div>`);
  if (keepScroll) list.scrollTop = list.scrollHeight - prevHeight + prevTop;
  else if (atBottom || !state.loaded) list.scrollTop = list.scrollHeight;
  root.querySelector("#chatOnline").textContent = state.online.length ? `${state.online.length} online` : "";
}

function renderPending() {
  const box = root?.querySelector("#chatPending");
  if (!box) return;
  const parts = [];
  if (state.replyTo) parts.push(`<div class="pending">↪ Replying to <strong>${esc(state.replyTo.authorName)}</strong>: ${esc(state.replyTo.body.slice(0, 80))} <button type="button" class="btn-link small" data-clear="reply">Cancel</button></div>`);
  if (state.image) parts.push(`<div class="pending pending-img"><img src="${esc(state.image.preview)}" alt="Snapshot to send" /> <span class="small">${esc(state.attachment?.pageTitle || "Snapshot")}</span> <button type="button" class="btn-link small" data-clear="image">Remove</button></div>`);
  else if (state.attachment?.kind === "quote") parts.push(`<div class="pending"><blockquote>${esc(state.attachment.quote)}</blockquote><span class="small muted">${esc(state.attachment.pageTitle || "")}</span> <button type="button" class="btn-link small" data-clear="attachment">Remove</button></div>`);
  box.innerHTML = parts.join("");
}

// ---- Data ----

async function load() {
  try {
    const [r, members, unread] = await Promise.all([api("/api/chat/messages?limit=50"), state.members.length ? state.members : api("/api/members"), api("/api/chat/unread")]);
    state.messages = r.messages; state.hasMore = r.hasMore; state.members = members.filter((m) => m.active); state.online = unread.online || [];
    state.loaded = true;
    renderList();
    markRead();
  } catch (err) {
    if (root) root.querySelector("#chatList").innerHTML = `<p class="muted page-pad">${esc(err.message)}</p>`;
  }
}

async function loadOlder() {
  if (!state.messages.length) return;
  const r = await api(`/api/chat/messages?limit=50&before=${state.messages[0].id}`);
  state.messages = [...r.messages, ...state.messages];
  state.hasMore = r.hasMore;
  renderList({ keepScroll: true });
}

function markRead() {
  const last = state.messages.at(-1)?.id;
  if (!last || !state.open || document.hidden) return;
  state.unread = 0; state.mentions = 0;
  updateBadge();
  api("/api/chat/read", { method: "POST", body: JSON.stringify({ lastReadId: last }) }).catch(() => {});
}

function updateBadge() {
  const b = el("chatCount");
  if (!b) return;
  const n = state.unread;
  b.textContent = state.mentions ? "@" : n > 9 ? "9+" : String(n);
  b.classList.toggle("hidden", !n && !state.mentions);
  b.classList.toggle("icon-badge-mention", !!state.mentions);
  el("chatBtn").setAttribute("aria-label", n ? `Club chat: ${n} unread${state.mentions ? ", you were mentioned" : ""}` : "Club chat");
}

async function refreshUnread() {
  if (!can("member")) return;
  try { const u = await api("/api/chat/unread"); state.unread = u.unread; state.mentions = u.mentions; state.online = u.online || []; updateBadge(); } catch { /* best effort */ }
}

// ---- Sending ----

async function send() {
  const input = root.querySelector("#chatInput");
  const body = input.value.trim();
  if (!body && !state.attachment && !state.image) return;
  const sendBtn = root.querySelector("#chatSend");
  sendBtn.disabled = true;
  try {
    let imageId = null;
    if (state.image) {
      const res = await fetch("/api/chat/images", { method: "POST", headers: { "Content-Type": state.image.blob.type, "x-pif-app": "1" }, body: state.image.blob, credentials: "same-origin" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't upload the snapshot.");
      imageId = j.id;
    }
    const m = await api("/api/chat/messages", { method: "POST", body: JSON.stringify({ body, attachment: state.attachment, imageId, replyTo: state.replyTo?.id ?? null }) });
    input.value = "";
    autosize(input);
    state.attachment = null; state.image = null; state.replyTo = null;
    renderPending();
    upsert(m);
    renderList();
    root.querySelector("#chatList").scrollTop = root.querySelector("#chatList").scrollHeight;
  } catch (err) {
    toast(err.message, { type: "error" });
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function upsert(m) {
  const i = state.messages.findIndex((x) => x.id === m.id);
  if (i >= 0) state.messages[i] = { ...state.messages[i], ...m };
  else { state.messages.push(m); state.messages.sort((a, b) => a.id - b.id); }
}

function autosize(t) { t.style.height = "auto"; t.style.height = `${Math.min(160, t.scrollHeight)}px`; }

// @mention suggestions while typing "@an…"
function suggest(input) {
  const box = root.querySelector("#chatSuggest");
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/(^|\s)@([A-Za-z]*)$/);
  if (!m) { box.classList.add("hidden"); return; }
  const q = m[2].toLowerCase();
  const me = currentMember();
  const hits = state.members.filter((x) => x.id !== me?.id && x.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, 6);
  if (!hits.length) { box.classList.add("hidden"); return; }
  const firstCounts = {};
  state.members.forEach((x) => { const f = x.name.split(/\s+/)[0]; firstCounts[f] = (firstCounts[f] || 0) + 1; });
  box.innerHTML = hits.map((x, i) => `<button type="button" role="option" data-mention="${esc(firstCounts[x.name.split(/\s+/)[0]] > 1 ? x.name : x.name.split(/\s+/)[0])}" ${i === 0 ? 'aria-selected="true"' : ""}>${esc(x.name)} <span class="muted small">${esc(x.title || "")}</span></button>`).join("");
  box.classList.remove("hidden");
}

function insertMention(input, label) {
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos).replace(/@([A-Za-z]*)$/, `@${label} `);
  input.value = before + input.value.slice(pos);
  input.setSelectionRange(before.length, before.length);
  root.querySelector("#chatSuggest").classList.add("hidden");
  input.focus();
}

// ---- Snapshots ----

let htmlToImageLoading = null;
function loadHtmlToImage() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  return (htmlToImageLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js";
    s.onload = () => resolve(window.htmlToImage);
    s.onerror = () => { htmlToImageLoading = null; reject(new Error("Couldn't load the snapshot tool.")); };
    document.head.append(s);
  }));
}

// Captures one panel as a JPEG (≤ ~550 KB) and attaches it to the composer.
export async function snapshotPanel(node) {
  if (!can("member")) { window.dispatchEvent(new CustomEvent("pif:request-signin")); return; }
  const status = toastStatus("Taking snapshot…");
  try {
    const lib = await loadHtmlToImage();
    const bg = getComputedStyle(document.body).getPropertyValue("--panel").trim() || "#ffffff";
    const width = node.getBoundingClientRect().width;
    const canvas = await lib.toCanvas(node, {
      backgroundColor: bg,
      pixelRatio: Math.min(2, 1400 / Math.max(1, width)),
      // Images from other sites (news photos, logos) can block capture; leave them out.
      filter: (n) => !(n.classList?.contains("snap-btn")) && !(n.tagName === "IMG" && !n.src.startsWith(location.origin) && !n.src.startsWith("data:")),
      imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
    });
    let quality = 0.85, blob;
    do { blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality)); quality -= 0.15; } while (blob && blob.size > 550 * 1024 && quality > 0.3);
    if (!blob) throw new Error("Snapshot failed.");
    const ctx = pageContext();
    const heading = node.querySelector("h2, h3")?.textContent.trim();
    state.image = { blob, preview: URL.createObjectURL(blob) };
    state.attachment = { kind: "snapshot", pageRef: ctx.pageRef, pageTitle: heading ? `${ctx.pageTitle} · ${heading}` : ctx.pageTitle, symbol: ctx.symbol };
    await openChat();
    renderPending();
    root.querySelector("#chatInput").focus();
  } catch (err) {
    toast(err.message, { type: "error" });
  } finally { status(); }
}

function toastStatus(msg) {
  const n = document.createElement("div");
  n.className = "toast";
  n.setAttribute("role", "status");
  n.textContent = msg;
  el("toasts").append(n);
  return () => n.remove();
}

// "Pick a panel" mode from the 📷 button in the chat box.
function pickPanel() {
  if (isPhone()) { toast("Tap the 📷 on any section to snapshot it."); return; }
  document.body.classList.add("snap-picking");
  toast("Click any section of the page to snapshot it (Esc to cancel).");
  const done = () => { document.body.classList.remove("snap-picking"); document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey, true); };
  const onClick = (e) => {
    const p = e.target.closest("#view .panel, #view .stat, #view .tile, #view .story-lead, #view section");
    if (!p) return;
    e.preventDefault(); e.stopPropagation();
    done();
    snapshotPanel(p);
  };
  const onKey = (e) => { if (e.key === "Escape") { done(); } };
  setTimeout(() => { document.addEventListener("click", onClick, true); document.addEventListener("keydown", onKey, true); }, 0);
}

// A 📷 button on every panel (members only), added as pages render.
function addSnapButtons() {
  if (!can("member")) return;
  document.querySelectorAll("#view .panel:not([data-snap])").forEach((p) => {
    p.dataset.snap = "1";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "snap-btn";
    b.title = "Snapshot this and share it in the club chat";
    b.setAttribute("aria-label", `Snapshot "${(p.querySelector("h2, h3")?.textContent || "this section").trim()}" to chat`);
    b.textContent = "📷";
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); snapshotPanel(p); });
    if (getComputedStyle(p).position === "static") p.style.position = "relative";
    p.append(b);
  });
}

// ---- Wiring a chat surface (panel or page) ----

function wire(container) {
  const list = container.querySelector("#chatList");
  const input = container.querySelector("#chatInput");
  container.querySelector("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    const sug = container.querySelector("#chatSuggest");
    if (!sug.classList.contains("hidden") && (e.key === "Enter" || e.key === "Tab")) {
      const first = sug.querySelector("[data-mention]");
      if (first) { e.preventDefault(); insertMention(input, first.dataset.mention); return; }
    }
    if (e.key === "Escape") sug.classList.add("hidden");
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", () => { autosize(input); suggest(input); });
  container.querySelector("#chatSuggest").addEventListener("click", (e) => { const b = e.target.closest("[data-mention]"); if (b) insertMention(input, b.dataset.mention); });
  container.querySelector("#chatSnap").addEventListener("click", pickPanel);
  container.querySelector("#chatPending").addEventListener("click", (e) => {
    const c = e.target.closest("[data-clear]")?.dataset.clear;
    if (c === "reply") state.replyTo = null;
    if (c === "image") { state.image = null; state.attachment = null; }
    if (c === "attachment") state.attachment = null;
    renderPending();
  });
  list.addEventListener("scroll", () => { if (list.scrollHeight - list.scrollTop - list.clientHeight < 40) markRead(); });
  list.addEventListener("click", async (e) => {
    if (e.target.closest("#chatOlder")) { loadOlder(); return; }
    const art = e.target.closest("[data-msg]");
    if (!art) return;
    const m = state.messages.find((x) => String(x.id) === art.dataset.msg);
    try {
      if (e.target.closest("[data-reply]")) { state.replyTo = m; renderPending(); input.focus(); }
      const reactBtn = e.target.closest("[data-react]");
      if (reactBtn) { upsert(await api(`/api/chat/messages/${m.id}/react`, { method: "POST", body: JSON.stringify({ emoji: reactBtn.dataset.react }) })); renderList(); }
      if (e.target.closest("[data-react-menu]")) {
        const tools = art.querySelector(".chat-tools");
        if (!tools.querySelector(".react-menu")) {
          tools.insertAdjacentHTML("beforeend", `<div class="react-menu" role="group" aria-label="Pick a reaction">${state.reactions.map((r) => `<button type="button" data-react="${esc(r)}">${esc(r)}</button>`).join("")}</div>`);
        }
      }
      if (e.target.closest("[data-edit]")) {
        const body = art.querySelector(".chat-body");
        body.innerHTML = `<form class="chat-edit"><textarea rows="2" maxlength="2000">${esc(m.body)}</textarea><button class="btn btn-primary btn-sm">Save</button> <button type="button" class="btn-link small" data-cancel-edit>Cancel</button></form>`;
        const f = body.querySelector("form");
        f.querySelector("textarea").focus();
        f.querySelector("[data-cancel-edit]").addEventListener("click", () => renderList());
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try { upsert(await api(`/api/chat/messages/${m.id}`, { method: "PUT", body: JSON.stringify({ body: f.querySelector("textarea").value }) })); renderList(); } catch (err) { toast(err.message, { type: "error" }); }
        });
      }
      if (e.target.closest("[data-del]")) {
        await api(`/api/chat/messages/${m.id}`, { method: "DELETE" });
        upsert({ id: m.id, deleted: true, body: "", attachment: null, image: null, reactions: [] });
        renderList();
      }
    } catch (err) { toast(err.message, { type: "error" }); }
  });
}

function closePanel() {
  state.open = false;
  panel?.close();
  el("chatBtn")?.focus();
}

export async function openChat() {
  if (!can("member")) { window.dispatchEvent(new CustomEvent("pif:request-signin")); return; }
  if (isPhone()) {
    if (!location.hash.startsWith("#/chat")) location.hash = "#/chat";
    return;
  }
  if (!panel) {
    panel = document.createElement("dialog");
    panel.className = "chat-panel";
    panel.setAttribute("aria-labelledby", "chatTitle");
    document.body.append(panel);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closePanel(); } });
  }
  if (!panel.open) {
    panel.innerHTML = shellHtml("panel");
    root = panel;
    wire(panel);
    panel.querySelector("#chatClose").addEventListener("click", closePanel);
    panel.show();
    state.open = true;
    renderPending();
    if (!state.loaded) await load(); else { renderList(); markRead(); }
  }
}

// #/chat page (phones; also works on desktop).
export async function mountChatPage(container) {
  if (!can("member")) {
    container.innerHTML = `<div class="page-head"><h2 tabindex="-1">Club chat</h2></div><p class="page-pad">The club chat is for signed-in members. <button type="button" class="btn-link" data-signin>Sign in</button></p>`;
    return;
  }
  panel?.close();
  container.innerHTML = shellHtml("page");
  root = container;
  wire(container);
  state.open = true;
  renderPending();
  await load();
  const off = () => { if (!location.hash.startsWith("#/chat")) { state.open = false; window.removeEventListener("hashchange", off); } };
  window.addEventListener("hashchange", off);
}

// ---- Live events (forwarded from app.js's EventSource) ----

function onLive(type, data) {
  const me = currentMember();
  // (Re)connected: catch up on anything missed while the stream was down.
  if (type === "hello") { state.online = data.online || []; if (state.loaded && state.open) load(); else refreshUnread(); return; }
  if (type === "presence") { state.online = data.online || []; if (root?.isConnected) root.querySelector("#chatOnline").textContent = state.online.length ? `${state.online.length} online` : ""; return; }
  if (type === "chat.mention") {
    if (!state.open) toast(`${data.by} mentioned you in the club chat: "${data.snippet}"`, { action: { label: "Open chat", onClick: openChat } });
    return;
  }
  const fromMe = me && data.memberId === me.id;
  if (state.loaded) {
    const existing = state.messages.find((x) => x.id === data.id);
    // Broadcasts don't know which reactions are yours; keep your own flags.
    if (type === "chat.reaction" && existing) {
      api(`/api/chat/messages/${data.id}`).then((m) => { upsert(m); if (root?.isConnected) renderList(); }).catch(() => {});
      return;
    }
    upsert(data);
    if (root?.isConnected && state.open) { renderList(); markRead(); }
  }
  if (type === "chat.message" && !fromMe && (!state.open || document.hidden)) {
    state.unread += 1;
    if (me && data.mentions?.includes(me.id)) state.mentions += 1;
    updateBadge();
  }
}

export function initChat() {
  window.__pifChatReady = true;
  const btn = el("chatBtn");
  btn.addEventListener("click", () => (state.open && panel?.open ? closePanel() : openChat()));
  const sync = () => {
    const on = can("member");
    // Always shown so people know the chat exists; visitors get the sign-in box.
    btn.classList.remove("hidden");
    btn.title = on ? "Club chat" : "Club chat (sign in to join)";
    if (!on) { state.loaded = false; state.messages = []; state.members = []; state.open = false; panel?.close(); }
    else refreshUnread();
  };
  window.addEventListener("pif:session-changed", sync);
  sync();
  window.addEventListener("pif:live", (e) => onLive(e.detail.type, e.detail.data));
  // Highlight → "Share to chat"
  window.addEventListener("pif:share-to-chat", (e) => {
    const d = e.detail;
    state.attachment = { kind: "quote", quote: d.quote, pageRef: d.pageRef, pageTitle: d.pageTitle, symbol: d.symbol };
    state.image = null;
    openChat().then(() => { renderPending(); root?.querySelector("#chatInput")?.focus(); });
  });
  // 📷 buttons on panels as pages render.
  const view = document.getElementById("view");
  new MutationObserver(() => addSnapButtons()).observe(view, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) markRead(); });
}
