// Team feed UI (WS7): the stream, item cards, comment threads with @mentions, reactions,
// follow-ups on shared answers, "Running now" chips and live updates. Used by the #/feed page,
// the Agents hub Feed tab and agent profiles. All text from members, agents and models is escaped.
import { esc, api, can, icon, toast, safeUrl, emptyState, errorState, bindRetry, skeleton, currentMember, renderMarkdown } from "../shared.js";

export const KIND_LABEL = {
  agent_brief: "Brief", agent_alert: "Alert", thesis_change: "Thesis", memory_added: "Memory", handoff: "Handoff",
  ask_shared: "Shared answer", pitch_opened: "Pitch", vote_closed: "Vote", trade_executed: "Trade",
  tripwire_tripped: "Tripwire", note_shared: "Note", agent_created: "New agent", agent_edited: "Agent update", digest: "Digest",
};
export const FILTERS = [
  ["all", "All"], ["holdings", "Holdings"], ["followed", "Followed agents"], ["mine", "Mine"], ["members", "Members"], ["agents", "Agents"], ["high", "Important"],
];
const KIND_ICON = { trade_executed: "briefcase", pitch_opened: "vote", vote_closed: "vote", tripwire_tripped: "alert", note_shared: "doc", ask_shared: "chat", thesis_change: "target", memory_added: "star", handoff: "users", digest: "inbox" };

let reactionsCache = null;
const reactionList = async () => (reactionsCache ||= api("/api/feed/reactions").catch(() => ["👍", "👀", "🔥", "❓", "✅", "😂"]));

// ---- Time ----
const toDate = (utc) => new Date(`${String(utc || "").replace(" ", "T")}Z`);
export function ago(utc, now = Date.now()) {
  const d = toDate(utc);
  if (Number.isNaN(d.getTime())) return "";
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function dayLabel(utc, now = new Date()) {
  const d = toDate(utc);
  const key = (x) => x.toLocaleDateString("en-CA");
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key(d) === key(now)) return "Today";
  if (key(d) === key(y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
const fullTime = (utc) => { const d = toDate(utc); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(); };

const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
// Stable colour per agent/member from its name, from a small palette defined in feed.css.
const hue = (s) => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 8; return h; };

const inAppLink = (u) => (/^#\/[\w\-./%=&?]*$/.test(u || "") ? u : null);

// ---- Pieces ----
export function avatar(item) {
  if (item.agent) return `<span class="feed-avatar is-agent feed-tone-${hue(item.agent.slug)}" aria-hidden="true">${icon("sparkle", { size: 16 })}</span>`;
  if (item.actor?.type === "member") return `<span class="feed-avatar feed-tone-${hue(item.actor.name)}" aria-hidden="true">${esc(initials(item.actor.name))}</span>`;
  return `<span class="feed-avatar is-system" aria-hidden="true">${icon(KIND_ICON[item.kind] || "bell", { size: 16 })}</span>`;
}

function actorLink(item) {
  if (item.agent) return `<a class="feed-actor" href="#/agents/a/${encodeURIComponent(item.agent.slug)}">${esc(item.agent.name)}</a>${item.agent.visibility === "private" ? ` <span class="badge" title="Only its owner and admins see this agent's posts">Private</span>` : ""}`;
  if (item.actor?.type === "member" && item.actor.id) return `<a class="feed-actor" href="#/members/${item.actor.id}">${esc(item.actor.name)}</a>`;
  return `<span class="feed-actor">${esc(item.actor?.name || "PIF")}</span>`;
}

// The readable body of any item kind.
function bodyHtml(item) {
  const b = item.body && typeof item.body === "object" ? item.body : {};
  const parts = [];
  if (b.note) parts.push(`<p class="feed-note">${esc(b.note)}</p>`);
  const text = b.answer || b.summary || b.text || b.headline || b.verdict;
  if (typeof text === "string" && text.trim()) parts.push(`<div class="feed-text" data-clamp>${renderMarkdown(text)}</div>`);
  if (Array.isArray(b.bullets) && b.bullets.length) parts.push(`<ul class="feed-bullets">${b.bullets.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  if (b.quote) parts.push(`<blockquote class="feed-quote">${esc(b.quote)}</blockquote>`);
  if (Array.isArray(b.claims) && b.claims.length) {
    const srcs = b.claims.filter((c) => c.source_url).slice(0, 4);
    if (srcs.length) parts.push(`<p class="feed-sources small muted">Sources: ${srcs.map((c, i) => c.source_url.startsWith("#") ? `<a href="${esc(c.source_url)}">${i + 1}</a>` : `<a href="${safeUrl(c.source_url)}" target="_blank" rel="noopener">${i + 1}<span class="sr-only"> (opens in a new tab)</span></a>`).join(", ")}</p>`);
  }
  if (b.counts && typeof b.counts === "object") parts.push(`<p class="small muted">${Number(b.counts.yes) || 0} yes, ${Number(b.counts.no) || 0} no</p>`);
  return parts.join("");
}

function openLink(item) {
  const b = item.body && typeof item.body === "object" ? item.body : {};
  if (item.runId) return [`#/agents/runs/${item.runId}`, "Open run"];
  const l = inAppLink(b.link);
  if (l) return [l, item.pitchId ? "Open pitch" : "Open"];
  if (item.symbol) return [`#/research/${encodeURIComponent(item.symbol)}`, `Open ${item.symbol}`];
  return null;
}

export function reactionsHtml(item) {
  return `<span class="feed-reacts" data-reacts>${(item.reactions || []).map((r) => `<button type="button" class="react ${r.mine ? "mine" : ""}" data-react="${esc(r.emoji)}" aria-pressed="${!!r.mine}" aria-label="${esc(r.emoji)} ${r.count}">${esc(r.emoji)} ${r.count}</button>`).join("")}</span>`;
}

export function itemHtml(item, { open = false, showUnread = true } = {}) {
  const me = currentMember();
  const link = openLink(item);
  const canPin = me && (me.isAdmin || (item.actor?.type === "member" && item.actor.id === me.id));
  return `<article class="feed-item${item.importance === "high" ? " is-high" : ""}${item.unread && showUnread ? " is-unread" : ""}${item.pinned ? " is-pinned" : ""}" data-item="${item.id}" aria-labelledby="fi-${item.id}">
    ${avatar(item)}
    <div class="feed-main">
      <header class="feed-head">
        ${actorLink(item)}
        <span class="feed-kind">${esc(KIND_LABEL[item.kind] || item.kind)}</span>
        ${item.symbol ? `<a class="feed-sym" href="#/feed/t/${encodeURIComponent(item.symbol)}" title="Everything on ${esc(item.symbol)}">${esc(item.symbol)}</a>` : ""}
        ${item.importance === "high" ? `<span class="badge badge-warn">Important</span>` : ""}
        ${item.pinned ? `<span class="badge badge-watch">Pinned</span>` : ""}
        <time class="feed-time" datetime="${esc(String(item.createdAt).replace(" ", "T"))}Z" title="${esc(fullTime(item.createdAt))}">${esc(ago(item.createdAt))}</time>
        ${item.unread && showUnread ? `<span class="feed-dot" title="New since you last looked"><span class="sr-only">New</span></span>` : ""}
      </header>
      <h3 class="feed-title" id="fi-${item.id}">${esc(item.title || KIND_LABEL[item.kind] || "Update")}</h3>
      ${bodyHtml(item)}
      <footer class="feed-actions">
        ${reactionsHtml(item)}
        <button type="button" class="btn btn-ghost btn-sm feed-react-add" data-react-menu aria-label="Add a reaction">${icon("plus", { size: 14 })}<span aria-hidden="true">🙂</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-toggle-thread aria-expanded="${open}" aria-controls="ft-${item.id}">${icon("chat", { size: 14 })} ${item.commentCount ? `${item.commentCount} comment${item.commentCount === 1 ? "" : "s"}` : "Comment"}</button>
        ${item.kind === "ask_shared" && can("ai") ? `<button type="button" class="btn btn-ghost btn-sm" data-followup>${icon("sparkle", { size: 14 })} Ask a follow-up</button>` : ""}
        ${link ? `<a class="btn btn-ghost btn-sm" href="${esc(link[0])}">${esc(link[1])}</a>` : ""}
        ${canPin ? `<button type="button" class="btn btn-ghost btn-sm feed-quiet" data-pin aria-pressed="${!!item.pinned}">${item.pinned ? "Unpin" : "Pin"}</button>` : ""}
        <span class="feed-viewers small muted" data-viewers></span>
      </footer>
      <div class="feed-followup hidden" data-followup-box></div>
      <section class="feed-thread${open ? "" : " hidden"}" id="ft-${item.id}" data-thread aria-label="Comments"></section>
    </div>
  </article>`;
}

// ---- Thread ----
function commentHtml(c) {
  const by = c.agent ? `<a href="#/agents/a/${encodeURIComponent(c.agent.slug)}">${esc(c.agent.name)}</a>` : c.memberId ? `<a href="#/members/${c.memberId}">${esc(c.authorName)}</a>` : esc(c.authorName);
  return `<li class="feed-comment${c.byAgent ? " by-agent" : ""}${c.deleted ? " is-deleted" : ""}" data-comment="${c.id}">
    <span class="feed-avatar sm${c.byAgent ? " is-agent" : ""} feed-tone-${hue(c.agent?.slug || c.authorName)}" aria-hidden="true">${c.byAgent ? icon("sparkle", { size: 12 }) : esc(initials(c.authorName))}</span>
    <div class="feed-comment-body">
      <p class="feed-comment-head"><strong>${by}</strong> <time class="muted small" title="${esc(fullTime(c.createdAt))}">${esc(ago(c.createdAt))}</time>
        ${c.runId ? ` <a class="small" href="#/agents/runs/${c.runId}">run</a>` : ""}
        ${c.canDelete ? ` <button type="button" class="link-btn small muted" data-del-comment="${c.id}">Delete</button>` : ""}</p>
      ${c.deleted ? `<p class="muted small">(deleted)</p>` : c.byAgent ? `<div class="feed-comment-text">${renderMarkdown(c.text)}</div>` : `<p class="feed-comment-text">${highlightMentions(c.text)}</p>`}
    </div>
  </li>`;
}
const highlightMentions = (t) => esc(t).replace(/(^|[\s(])(@[\w-]+(?: [A-Z][\w-]*)?)/g, "$1<span class=\"feed-mention\">$2</span>");

function composerHtml(itemId) {
  return `<form class="feed-compose" data-compose autocomplete="off">
    <label class="sr-only" for="fc-${itemId}">Write a comment</label>
    <div class="feed-compose-field">
      <textarea id="fc-${itemId}" rows="1" maxlength="2000" placeholder="Comment, @mention a member, or @ an agent to ask it" aria-describedby="fch-${itemId}"></textarea>
      <ul class="feed-mention-list hidden" role="listbox" aria-label="Mention"></ul>
    </div>
    <button class="btn btn-primary btn-sm" type="submit">Send</button>
    <p class="small muted feed-compose-hint" id="fch-${itemId}">${can("ai") ? "Type @ and an agent's name (or @pif) to have it answer here. It runs on your AI budget." : "Type @ to mention a member."}</p>
  </form>`;
}

// ---- Mention autocomplete ----
let facetsCache = null;
const facets = () => (facetsCache ||= api("/api/feed/facets").catch(() => ({ members: [], agents: [], symbols: [] })));

function bindMentionPicker(form) {
  const ta = form.querySelector("textarea"), list = form.querySelector(".feed-mention-list");
  let options = [], active = 0;
  const close = () => { list.classList.add("hidden"); options = []; ta.removeAttribute("aria-activedescendant"); };
  const token = () => { const m = ta.value.slice(0, ta.selectionStart).match(/(^|[\s(])@([\w-]{0,30})$/); return m ? m[2] : null; };
  const render = () => {
    list.innerHTML = options.map((o, i) => `<li role="option" id="${form.querySelector("textarea").id}-o${i}" aria-selected="${i === active}" data-pick="${i}">${o.agent ? icon("sparkle", { size: 12 }) : ""} ${esc(o.label)} <span class="muted small">${esc(o.hint)}</span></li>`).join("");
    list.classList.toggle("hidden", !options.length);
    if (options.length) ta.setAttribute("aria-activedescendant", `${ta.id}-o${active}`);
  };
  const pick = (o) => {
    const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@([\w-]{0,30})$/, `@${o.insert} `);
    ta.value = before + ta.value.slice(pos);
    ta.setSelectionRange(before.length, before.length);
    close(); ta.focus();
  };
  ta.addEventListener("input", async () => {
    ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
    const t = token();
    if (t === null) return close();
    const f = await facets();
    const q = t.toLowerCase();
    const agents = can("ai") ? [{ slug: "pif", name: "Ask PIF" }, ...f.agents].filter((a) => a.slug.includes(q) || a.name.toLowerCase().includes(q)).slice(0, 5)
      .map((a) => ({ agent: true, label: a.name, hint: `@${a.slug}`, insert: a.slug })) : [];
    const members = f.members.filter((m) => m.name.toLowerCase().includes(q) && m.id !== currentMember()?.id).slice(0, 5)
      .map((m) => ({ agent: false, label: m.name, hint: "member", insert: m.name }));
    options = [...members, ...agents]; active = 0; render();
  });
  ta.addEventListener("keydown", (e) => {
    if (!options.length) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length; render(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(options[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("[data-pick]"); if (li) { e.preventDefault(); pick(options[Number(li.dataset.pick)]); } });
  ta.addEventListener("blur", () => setTimeout(close, 150));
}

// ---- Feed controller ----
// mountFeed(container, { query, compact, title }) renders a stream into `container` and keeps it
// live. query: { filter, symbol, member, agent }. Returns { destroy }.
export function mountFeed(container, { query = {}, compact = false, markRead = true, emptyText, single = false } = {}) {
  const state = { items: [], hasMore: false, lastReadId: 0, openThreads: new Set(), working: new Map(), pending: null };
  const params = (extra = {}) => new URLSearchParams(Object.entries({ ...query, ...extra }).filter(([, v]) => v != null && v !== "")).toString();
  container.classList.add("feed");
  container.innerHTML = `<div class="feed-newbar hidden" data-newbar><button type="button" class="btn btn-sm btn-primary" data-shownew></button></div>
    <div class="feed-pinned" data-pinned></div><div class="feed-list" data-list aria-live="polite" aria-busy="true">${skeleton("cards", { rows: 3, label: "Loading the team feed" })}</div>
    <div class="feed-more" data-more></div>`;
  const listEl = container.querySelector("[data-list]"), pinnedEl = container.querySelector("[data-pinned]"), moreEl = container.querySelector("[data-more]"), newbar = container.querySelector("[data-newbar]");

  const renderList = () => {
    if (!state.items.length) {
      listEl.innerHTML = emptyState({ icon: "users", title: emptyText?.title || "Nothing here yet", body: emptyText?.body || "Agent briefs, shared answers, pitches, votes and trades show up here as they happen." });
      return;
    }
    let html = "", lastDay = null;
    // "Seen up to here" sits between the newest unread item and the first one already seen.
    const seenAt = state.items.findIndex((x, j) => j > 0 && !x.unread && state.items[j - 1].unread);
    state.items.forEach((it, i) => {
      const day = dayLabel(it.createdAt);
      if (!compact && day !== lastDay) { html += `<h3 class="feed-day"><span>${esc(day)}</span></h3>`; lastDay = day; }
      if (i === seenAt) html += `<p class="feed-seen" role="separator"><span>Seen up to here</span></p>`;
      html += itemHtml(it, { open: state.openThreads.has(it.id) });
    });
    listEl.innerHTML = html;
    for (const id of state.openThreads) loadThread(id);
    for (const [itemId, names] of state.working) showWorking(itemId, names);
  };
  const renderMore = () => { moreEl.innerHTML = single ? "" : state.hasMore ? `<button type="button" class="btn btn-ghost" data-older>Show older</button>` : state.items.length > 8 ? `<p class="muted small feed-end">That's everything${query.symbol ? ` on ${esc(query.symbol)}` : ""}.</p>` : ""; };

  async function load() {
    listEl.setAttribute("aria-busy", "true");
    let r;
    try { r = await api(`/api/feed?${params()}`); } catch (err) {
      listEl.innerHTML = errorState({ title: "Couldn't load the team feed.", detail: err.message, retryId: "feed" }); bindRetry(listEl, "feed", load); return;
    }
    listEl.setAttribute("aria-busy", "false");
    state.items = r.items; state.hasMore = r.hasMore; state.lastReadId = r.lastReadId;
    pinnedEl.innerHTML = r.pinned?.length && !compact ? `<h3 class="feed-day"><span>Pinned</span></h3>${r.pinned.map((i) => itemHtml({ ...i, unread: false })).join("")}` : "";
    if (r.unavailable) { listEl.innerHTML = emptyState({ icon: "users", title: "The team feed isn't set up on this server yet." }); return; }
    renderList(); renderMore();
    const top = state.items[0]?.id;
    if (markRead && top && top > state.lastReadId) { api("/api/feed/read", { method: "POST", body: JSON.stringify({ lastReadId: top }) }).then(() => window.dispatchEvent(new Event("pif:feed-read"))).catch(() => {}); }
  }

  async function older() {
    const last = state.items.at(-1)?.id;
    if (!last) return;
    const r = await api(`/api/feed?${params({ before: last })}`);
    state.items.push(...r.items); state.hasMore = r.hasMore; renderList(); renderMore();
  }

  async function fetchNew({ reveal = false } = {}) {
    const top = state.items[0]?.id || 0;
    const r = await api(`/api/feed?${params({ after: top, limit: 50 })}`).catch(() => null);
    if (!r?.items.length) return;
    // Don't push content down under someone reading further down; offer a button instead.
    if (!reveal && window.scrollY > 300 && !compact) {
      state.pending = r.items; newbar.classList.remove("hidden");
      newbar.querySelector("[data-shownew]").textContent = `${r.items.length} new post${r.items.length === 1 ? "" : "s"}`;
      return;
    }
    state.items.unshift(...r.items.map((i) => ({ ...i, fresh: true })));
    renderList();
    for (const i of r.items) container.querySelector(`[data-item="${i.id}"]`)?.classList.add("is-new");
    if (markRead && document.visibilityState === "visible") api("/api/feed/read", { method: "POST", body: JSON.stringify({ lastReadId: r.items[0].id }) }).then(() => window.dispatchEvent(new Event("pif:feed-read"))).catch(() => {});
  }

  const itemOf = (id) => state.items.find((i) => i.id === id);

  async function loadThread(id) {
    const box = container.querySelector(`[data-item="${id}"] [data-thread]`);
    if (!box) return;
    if (!box.dataset.loaded) box.innerHTML = `<p class="muted small">Loading comments…</p>`;
    try {
      const r = await api(`/api/feed/${id}`);
      const focused = document.activeElement?.closest?.(`[data-item="${id}"] [data-compose]`);
      const draft = box.querySelector("textarea")?.value || "";
      box.innerHTML = `<ol class="feed-comments">${r.comments.map(commentHtml).join("")}</ol><div data-working></div>${composerHtml(id)}`;
      box.dataset.loaded = "1";
      const ta = box.querySelector("textarea"); ta.value = draft;
      bindMentionPicker(box.querySelector("[data-compose]"));
      if (focused) ta.focus();
      if (state.working.has(id)) showWorking(id, state.working.get(id));
      const it = itemOf(id); if (it) { it.commentCount = r.comments.filter((c) => !c.deleted).length; updateCount(id); }
    } catch (err) { box.innerHTML = errorState({ title: "Couldn't load comments.", detail: err.message }); }
  }

  const updateCount = (id) => {
    const it = itemOf(id), b = container.querySelector(`[data-item="${id}"] [data-toggle-thread]`);
    if (it && b) b.innerHTML = `${icon("chat", { size: 14 })} ${it.commentCount ? `${it.commentCount} comment${it.commentCount === 1 ? "" : "s"}` : "Comment"}`;
  };
  function showWorking(itemId, names) {
    const box = container.querySelector(`[data-item="${itemId}"] [data-working]`);
    if (box) box.innerHTML = names.size ? `<p class="feed-working small" role="status"><span class="agent-pulse" aria-hidden="true"></span> ${[...names].map(esc).join(" and ")} ${names.size === 1 ? "is" : "are"} working on an answer…</p>` : "";
  }

  // Presence on open threads: heartbeat every 30s while a thread is open.
  const beats = new Map();
  function watchPresence(id, on) {
    const target = `item:${id}`;
    if (on && !beats.has(id)) {
      const beat = () => api("/api/feed/presence", { method: "POST", body: JSON.stringify({ target }) }).then((r) => showViewers(id, r.viewers)).catch(() => {});
      beat(); beats.set(id, setInterval(beat, 30e3));
    } else if (!on && beats.has(id)) {
      clearInterval(beats.get(id)); beats.delete(id);
      api("/api/feed/presence", { method: "POST", body: JSON.stringify({ target, leave: true }) }).catch(() => {});
    }
  }
  function showViewers(id, viewers = []) {
    const el = container.querySelector(`[data-item="${id}"] [data-viewers]`);
    const others = viewers.filter((v) => v.id !== currentMember()?.id);
    if (el) el.textContent = others.length ? `${others.map((v) => v.name.split(" ")[0]).join(", ")} ${others.length === 1 ? "is" : "are"} here` : "";
  }

  // ---- Events ----
  container.addEventListener("click", async (e) => {
    const art = e.target.closest("[data-item]");
    const id = art ? Number(art.dataset.item) : null;
    if (e.target.closest("[data-older]")) { e.target.closest("[data-older]").disabled = true; older().catch((err) => toast(err.message, { type: "error" })); return; }
    if (e.target.closest("[data-shownew]")) {
      newbar.classList.add("hidden");
      if (state.pending) { state.items.unshift(...state.pending); state.pending = null; renderList(); }
      container.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    }
    if (!id) return;
    if (e.target.closest("[data-toggle-thread]")) {
      const btn = e.target.closest("[data-toggle-thread]"), box = art.querySelector("[data-thread]");
      const open = box.classList.toggle("hidden") === false;
      btn.setAttribute("aria-expanded", String(open));
      if (open) { state.openThreads.add(id); await loadThread(id); box.querySelector("textarea")?.focus(); } else state.openThreads.delete(id);
      watchPresence(id, open);
      return;
    }
    const react = e.target.closest("[data-react]");
    if (react) {
      try {
        const r = await api(`/api/feed/${id}/react`, { method: "POST", body: JSON.stringify({ emoji: react.dataset.react }) });
        const it = itemOf(id) || {}; it.reactions = r.reactions;
        art.querySelector("[data-reacts]").outerHTML = reactionsHtml({ reactions: r.reactions });
        art.querySelector(".feed-react-menu")?.remove();
      } catch (err) { toast(err.message, { type: "error" }); }
      return;
    }
    if (e.target.closest("[data-react-menu]")) {
      const existing = art.querySelector(".feed-react-menu");
      if (existing) { existing.remove(); return; }
      const list = await reactionList();
      e.target.closest("[data-react-menu]").insertAdjacentHTML("afterend", `<span class="feed-react-menu" role="group" aria-label="Pick a reaction">${list.map((r) => `<button type="button" class="react" data-react="${esc(r)}">${esc(r)}</button>`).join("")}</span>`);
      art.querySelector(".feed-react-menu button")?.focus();
      return;
    }
    if (e.target.closest("[data-pin]")) {
      try { const r = await api(`/api/feed/${id}/pin`, { method: "POST" }); toast(r.pinned ? "Pinned to the top of the feed." : "Unpinned."); load(); } catch (err) { toast(err.message, { type: "error" }); }
      return;
    }
    const del = e.target.closest("[data-del-comment]");
    if (del) {
      try { await api(`/api/feed/comments/${del.dataset.delComment}`, { method: "DELETE" }); loadThread(id); } catch (err) { toast(err.message, { type: "error" }); }
      return;
    }
    if (e.target.closest("[data-followup]")) {
      const box = art.querySelector("[data-followup-box]");
      box.classList.toggle("hidden");
      if (!box.innerHTML) {
        box.innerHTML = `<form class="feed-compose" data-followup-form><label class="sr-only" for="ff-${id}">Your follow-up question</label>
          <div class="feed-compose-field"><textarea id="ff-${id}" rows="1" maxlength="1000" placeholder="Ask your own follow-up. It runs as your question, with this answer as context."></textarea></div>
          <button class="btn btn-primary btn-sm">Ask</button></form><div data-followup-out></div>`;
      }
      box.querySelector("textarea")?.focus();
      return;
    }
    const shareBtn = e.target.closest("[data-share-run]");
    if (shareBtn) {
      shareBtn.disabled = true;
      try { await api(`/api/agents/runs/${shareBtn.dataset.shareRun}/share`, { method: "POST", body: JSON.stringify({}) }); shareBtn.textContent = "Shared"; fetchNew({ reveal: true }); } catch (err) { shareBtn.disabled = false; toast(err.message, { type: "error" }); }
    }
  });

  container.addEventListener("submit", async (e) => {
    const form = e.target;
    const art = form.closest("[data-item]");
    if (!art) return;
    e.preventDefault();
    const id = Number(art.dataset.item);
    const ta = form.querySelector("textarea"), btn = form.querySelector("button");
    const text = ta.value.trim();
    if (!text) return;
    btn.disabled = true;
    if (form.matches("[data-compose]")) {
      try {
        const r = await api(`/api/feed/${id}/comments`, { method: "POST", body: JSON.stringify({ text }) });
        ta.value = ""; ta.style.height = "auto";
        for (const n of r.notices || []) toast(n);
        if (r.agentRuns?.length) { state.working.set(id, new Set(r.agentRuns.map((a) => a.name))); }
        await loadThread(id);
      } catch (err) { toast(err.message, { type: "error" }); }
      btn.disabled = false;
    } else if (form.matches("[data-followup-form]")) {
      const out = art.querySelector("[data-followup-out]");
      out.innerHTML = `<p class="feed-working small" role="status"><span class="agent-pulse" aria-hidden="true"></span> Working on your follow-up…</p>`;
      try {
        const r = await api(`/api/feed/${id}/follow-up`, { method: "POST", body: JSON.stringify({ question: text }) });
        ta.value = "";
        out.innerHTML = `<div class="feed-followup-answer"><div class="feed-text">${renderMarkdown(r.output?.answer || "")}</div>
          <p class="small muted">Only you see this answer. <button type="button" class="btn btn-ghost btn-sm" data-share-run="${r.runId}">Share to feed</button> <a class="btn btn-ghost btn-sm" href="#/agents/runs/${r.runId}">Open run</a></p></div>`;
      } catch (err) { out.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
      btn.disabled = false;
    }
  });

  // Live events, forwarded by app.js as pif:live.
  const onLive = (e) => {
    const { type, data } = e.detail || {};
    if ((type === "feed" || type === "feed.removed") && single) return;
    if (type === "feed" || type === "feed.removed") { if (type === "feed.removed") { state.items = state.items.filter((i) => !data.ids?.includes(i.id)); renderList(); } else fetchNew(); return; }
    const id = data?.itemId;
    if (type === "feed.comment" && itemOf(id)) {
      if (data.byAgent) { const w = state.working.get(id); if (w) { w.delete(data.authorName); if (!w.size) state.working.delete(id); } }
      if (state.openThreads.has(id)) loadThread(id);
      else { itemOf(id).commentCount++; updateCount(id); }
    } else if (type === "feed.comment_deleted" && state.openThreads.has(id)) loadThread(id);
    else if (type === "feed.reaction" && itemOf(id)) {
      const it = itemOf(id), mine = new Set((it.reactions || []).filter((r) => r.mine).map((r) => r.emoji));
      it.reactions = data.reactions.map((r) => ({ ...r, mine: mine.has(r.emoji) }));
      const el = container.querySelector(`[data-item="${id}"] [data-reacts]`);
      if (el) el.outerHTML = reactionsHtml(it);
    } else if (type === "feed.agent_working" && itemOf(id)) {
      if (!state.working.has(id)) state.working.set(id, new Set());
      state.working.get(id).add(data.agent?.name || "An agent");
      showWorking(id, state.working.get(id));
    } else if (type === "feed.presence" && /^item:\d+$/.test(data?.target || "")) showViewers(Number(data.target.slice(5)), data.viewers);
  };
  window.addEventListener("pif:live", onLive);
  // Relative times stay fresh.
  const tick = setInterval(() => container.querySelectorAll(".feed-time").forEach((t) => {
    const it = itemOf(Number(t.closest("[data-item]")?.dataset.item)); if (it) t.textContent = ago(it.createdAt);
  }), 60e3);
  const onHash = () => destroy();
  function destroy() {
    window.removeEventListener("pif:live", onLive); window.removeEventListener("hashchange", onHash);
    clearInterval(tick); for (const id of [...beats.keys()]) watchPresence(id, false);
  }
  window.addEventListener("hashchange", onHash);

  load();
  return { destroy, reload: load, openThread: (id) => { state.openThreads.add(id); watchPresence(id, true); } };
}

// ---- Running now ----
// Chips for runs in progress; refreshes on run_finished/feed events and every 20s while shown.
export function mountRunning(el) {
  const draw = async () => {
    if (!el.isConnected) return stop();
    const r = await api("/api/feed/running").catch(() => ({ running: [] }));
    el.innerHTML = r.running.length ? `<span class="feed-running-label small muted">Running now</span>${r.running.map((x) => `<a class="feed-running-chip" href="${x.agent ? `#/agents/a/${encodeURIComponent(x.agent.slug)}` : `#/agents/runs/${x.runId}`}"><span class="agent-pulse" aria-hidden="true"></span>${esc(x.agent?.name || x.workflow)}${x.symbol ? ` · ${esc(x.symbol)}` : ""}</a>`).join("")}` : "";
    el.classList.toggle("hidden", !r.running.length);
  };
  const onLive = (e) => { if (["run_finished", "feed"].includes(e.detail?.type)) draw(); };
  const timer = setInterval(draw, 20e3);
  function stop() { clearInterval(timer); window.removeEventListener("pif:live", onLive); }
  window.addEventListener("pif:live", onLive);
  draw();
  return { stop, refresh: draw };
}

// Filter bar as links (deep-linkable) plus ticker and member pickers.
export function filterBar(active, { base = "#/feed", symbol = "", memberId = "", facetsData = null } = {}) {
  const f = facetsData || { symbols: [], members: [] };
  return `<div class="feed-filters">
    <nav class="feed-seg" aria-label="Filter the feed">${FILTERS.map(([k, label]) => `<a href="${k === "all" ? base : `${base}/${k}`}" class="feed-seg-item" ${k === active ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>
    <div class="feed-pickers">
      <label class="sr-only" for="feedSym">Ticker</label>
      <select id="feedSym" data-feed-symbol><option value="">Any ticker</option>${f.symbols.map((s) => `<option value="${esc(s.symbol)}" ${s.symbol === symbol ? "selected" : ""}>${esc(s.symbol)} (${s.n})</option>`).join("")}</select>
      <label class="sr-only" for="feedMember">Member</label>
      <select id="feedMember" data-feed-member><option value="">Anyone</option>${f.members.map((m) => `<option value="${m.id}" ${String(m.id) === String(memberId) ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
    </div>
  </div>`;
}
