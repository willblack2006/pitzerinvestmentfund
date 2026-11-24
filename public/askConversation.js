// Ask PIF conversations (WS11): one live conversation view, used by the side panel and the
// Agents → Ask tab. Each question is a turn: it starts a run on the server, the page follows it
// live (steps as they happen, the answer as it is written), then shows the checked answer card.
// Threads are stored (GET/POST /api/ask/threads), so a conversation can be continued later,
// shared with the team, and a teammate can continue a shared one as their own.
// @slug at the start of a question addresses a team agent.
import { esc, api, icon, toast, fmtUSD } from "./shared.js";
import { answerCard, aiErrorHtml, suggestionsFor, withProgress, bindFeedback } from "./ai.js";
import { liveSteps, nowLine, watchRun } from "./ui/runCard.js";
import { agentAvatar } from "./ui/agentChip.js";

let agentsCache = null;
export async function addressableAgents() {
  if (agentsCache) return agentsCache;
  try { agentsCache = (await api("/api/ask/agents")).agents || []; } catch { agentsCache = []; }
  return agentsCache;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let seq = 0;

// container: an empty element. opts: { compact, threadId, onChange(state), placeholder, empty: html }
// Returns { ask(q), load(threadId), reset(), state, focus() }.
export function mountConversation(container, { compact = false, threadId = null, onChange = () => {}, placeholder = "Ask about the fund or a ticker. Type @ for a team agent." } = {}) {
  const uid = `cv${++seq}`;
  const state = { thread: null, turns: [], busy: false, legacy: false };
  container.classList.add("ask-convo");
  container.innerHTML = `<div class="ask-list" id="${uid}-list" role="log" aria-live="polite" aria-relevant="additions"></div>
    <form class="ask-compose" id="${uid}-form">
      <div class="ask-addressed hidden" id="${uid}-to"></div>
      <label for="${uid}-input" class="sr-only">Your question</label>
      <div class="ask-field"><textarea id="${uid}-input" rows="1" maxlength="1000" placeholder="${esc(placeholder)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${uid}-mention"></textarea>
      <button class="ask-send" id="${uid}-send" aria-label="Ask" disabled>${icon("arrow-up", { size: 16 })}</button></div>
      <ul class="ask-mention hidden" id="${uid}-mention" role="listbox" aria-label="Team agents"></ul>
      <p class="muted small ask-hint"><span>Enter to ask · Shift+Enter for a new line · @ for an agent</span><span class="ask-budget" data-ask-budget></span></p>
    </form>`;
  const list = container.querySelector(`#${uid}-list`);
  const form = container.querySelector(`#${uid}-form`);
  const input = container.querySelector(`#${uid}-input`);
  const send = container.querySelector(`#${uid}-send`);
  const menu = container.querySelector(`#${uid}-mention`);
  bindFeedback(list);

  const readOnly = () => state.thread && !state.thread.mine;
  const changed = () => { onChange(state); syncSend(); };

  function syncSend() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    send.disabled = state.busy || !input.value.trim();
    send.setAttribute("aria-label", readOnly() ? "Continue as your own conversation" : "Ask");
  }

  // ---- Rendering ----
  const turnHtml = (t, i) => {
    const q = `<p class="agent-q">${icon("chat", { size: 14 })}<span>${t.agentSlug ? `<span class="ask-to">@${esc(t.agentSlug)}</span> ` : ""}${esc(t.q)}</span></p>`;
    if (t.output) return `<div data-turn="${i}">${answerCard(t.output, t.runId, { compact, fresh: t.fresh, feedback: t.feedback })}</div>`;
    if (t.error) return `<div data-turn="${i}" class="panel agent-answer is-compact">${q}${aiErrorHtml(t.error)}${!readOnly() ? `<div><button type="button" class="btn btn-ghost btn-sm" data-ask-retry="${i}">Try again</button></div>` : ""}</div>`;
    return `<div data-turn="${i}" class="panel agent-answer is-compact is-live">${q}<div class="ask-live">${liveHtml(t)}</div></div>`;
  };
  const liveHtml = (t) => t.legacyBox ? "" : `${t.text ? "" : liveSteps(t.steps || [], { now: nowLine(t.steps || []) })}${t.text ? `<div class="agent-answer-text is-streaming">${textHtml(t.text)}</div><p class="muted small ask-live-meta">${esc(nowLine(t.steps || []).replace("Writing…", "Writing the answer…"))}</p>` : ""}`;
  const textHtml = (text) => String(text).split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");

  function emptyHtml() {
    if (readOnly()) return "";
    return `<div class="ask-empty"><p class="ask-empty-title">Ask about the fund or a company</p>
      <p class="muted small">Answers cite the filing or page each fact came from. Follow-ups remember the conversation.</p>
      <div class="ask-suggest">${suggestionsFor().map((q) => `<button type="button" class="btn btn-ghost btn-sm agent-chip" data-ask-fill="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <div class="ask-agents" data-ask-agents></div></div>`;
  }

  async function paintAgents() {
    const box = list.querySelector("[data-ask-agents]");
    if (!box) return;
    const agents = (await addressableAgents()).filter((a) => a.kind === "custom").slice(0, 4);
    if (!agents.length || !box.isConnected) return;
    box.innerHTML = `<p class="small muted">Or ask a team agent</p><div class="ask-agent-row">${agents.map((a) => `<button type="button" class="btn btn-ghost btn-sm ask-agent-btn" data-ask-agent="${esc(a.slug)}">${agentAvatar(a, { size: 18 })}<span>@${esc(a.slug)}</span></button>`).join("")}</div>`;
  }

  function render() {
    const banner = state.thread && !state.thread.mine
      ? `<p class="notice small ask-shared-note">${icon("users", { size: 14 })} ${esc(state.thread.owner?.name || "A teammate")} shared this conversation. Ask a follow-up to continue it as your own.</p>` : "";
    list.innerHTML = state.turns.length ? banner + state.turns.map(turnHtml).join("") : banner + emptyHtml();
    if (!state.turns.length) paintAgents();
    changed();
  }

  function paintTurn(i) {
    const node = list.querySelector(`[data-turn="${i}"]`);
    const t = state.turns[i];
    if (!node || !t) return render();
    if (!t.output && !t.error) {
      const live = node.querySelector(".ask-live");
      if (live && !t.legacyBox) { live.innerHTML = liveHtml(t); return; }
    }
    node.outerHTML = turnHtml(t, i);
  }

  const scrollToTurn = (i, block = "end") => list.querySelector(`[data-turn="${i}"]`)?.scrollIntoView({ block, behavior: reduceMotion() ? "auto" : "smooth" });

  // ---- Asking ----
  async function follow(i, runId) {
    const t = state.turns[i];
    t.runId = runId;
    let lastPaint = 0, pending = null;
    const throttled = () => {
      const now = performance.now();
      if (now - lastPaint > 60) { lastPaint = now; paintTurn(i); return; }
      clearTimeout(pending); pending = setTimeout(() => { lastPaint = performance.now(); paintTurn(i); }, 60);
    };
    await new Promise((resolve) => {
      t.stop = watchRun(runId, {
        onStep: (s, steps) => { t.steps = steps; throttled(); },
        onTurn: () => { t.text = ""; throttled(); },
        onText: (text) => { t.text = text; throttled(); },
        onDone: (output) => { clearTimeout(pending); Object.assign(t, { output, fresh: true }); resolve(); },
        onError: (msg, ev) => { clearTimeout(pending); t.error = { message: msg, runId, code: ev?.status === "refused" ? "ai_member_cap" : undefined }; resolve(); },
      });
    });
  }

  async function ask(raw, { agentSlug = null } = {}) {
    let q = String(raw || "").trim();
    if (!q || state.busy) return;
    const mention = /^@([a-z0-9][a-z0-9-]*)\s*/i.exec(q);
    const slug = mention ? mention[1].toLowerCase() : agentSlug || state.thread?.agentSlug || null;
    if (mention) q = q.slice(mention[0].length).trim() || q;
    state.busy = true;
    const i = state.turns.push({ q, agentSlug: slug, steps: [], text: "" }) - 1;
    render();
    scrollToTurn(i);
    const t = state.turns[i];
    try {
      if (state.legacy) throw Object.assign(new Error("legacy"), { legacy: true });
      const body = JSON.stringify({ question: q, ...(slug ? { agentSlug: slug } : {}) });
      const r = state.thread && state.thread.mine
        ? await api(`/api/ask/threads/${state.thread.id}/messages`, { method: "POST", body })
        : await api("/api/ask/threads", { method: "POST", body: JSON.stringify({ question: q, ...(slug ? { agentSlug: slug } : {}), ...(state.thread ? { forkOf: state.thread.id } : {}) }) });
      if (state.thread && !state.thread.mine) toast("Continued as your own conversation.", { type: "success" });
      state.thread = r.thread;
      changed();
      await follow(i, r.runId);
    } catch (err) {
      // Before the conversation API existed (or if it's unreachable), ask the old one-shot way.
      if (err.legacy || err.status === 404 && /endpoint/i.test(err.message)) {
        state.legacy = true;
        t.legacyBox = true;
        paintTurn(i);
        const box = list.querySelector(`[data-turn="${i}"] .ask-live`);
        try {
          const r = await withProgress(box, api("/api/agents/ask", { method: "POST", body: JSON.stringify({ question: q }) }), { workflow: "ask_pif", intro: "Reading your question", expect: "Usually 10 to 40 seconds" });
          Object.assign(t, { output: r.output, runId: r.runId, fresh: true });
        } catch (e2) { t.error = e2; }
      } else t.error = err;
    }
    state.busy = false;
    paintTurn(i);
    t.fresh = false;
    scrollToTurn(i, "start");
    changed();
    refreshBudget(container);
    if (!document.activeElement?.closest?.("a, button, summary")) input.focus({ preventScroll: true });
  }

  async function load(id) {
    if (state.busy) return;
    if (!id) return reset();
    list.innerHTML = `<p class="muted small ask-loading">Loading the conversation…</p>`;
    try {
      const t = await api(`/api/ask/threads/${Number(id)}`);
      state.thread = t;
      state.turns = t.messages.map((m) => ({ q: m.question, agentSlug: m.agentSlug, runId: m.runId, output: m.output, feedback: m.feedback, error: m.status === "done" ? null : m.status === "running" ? null : { message: m.error || "This question didn't get an answer.", runId: m.runId }, steps: [], text: "" }));
      render();
      // A turn still running (opened from another tab, or the page reloaded): follow it.
      state.turns.forEach((tt, i) => { if (!tt.output && !tt.error && tt.runId) { state.busy = true; follow(i, tt.runId).then(() => { state.busy = false; paintTurn(i); changed(); }); } });
      scrollToTurn(state.turns.length - 1, "start");
    } catch (err) {
      list.innerHTML = `<p class="error small">Couldn't open that conversation: ${esc(err.message)}</p>`;
    }
  }

  function reset() {
    if (state.busy) return;
    state.turns.forEach((t) => t.stop?.());
    state.thread = null; state.turns = [];
    render();
    input.focus();
  }

  // ---- @agent picker ----
  let options = [], active = 0;
  const closeMenu = () => { menu.classList.add("hidden"); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); options = []; };
  async function syncMenu() {
    const m = /^@([a-z0-9-]*)$/i.exec(input.value.slice(0, input.selectionStart).trimStart());
    if (!m || input.value.slice(0, input.selectionStart).includes(" ")) return closeMenu();
    const all = await addressableAgents();
    const term = m[1].toLowerCase();
    options = all.filter((a) => a.slug.includes(term) || a.name.toLowerCase().includes(term)).slice(0, 7);
    if (!options.length) return closeMenu();
    active = Math.min(active, options.length - 1);
    menu.innerHTML = options.map((a, i) => `<li id="${uid}-opt${i}" role="option" aria-selected="${i === active}" data-pick="${i}">${agentAvatar(a, { size: 20 })}<span><strong>@${esc(a.slug)}</strong> <span class="muted small">${esc(a.name)}${a.kind === "builtin" ? " · built-in" : a.mine ? " · yours" : ""}</span></span></li>`).join("");
    menu.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", `${uid}-opt${active}`);
  }
  const pick = (i) => {
    const a = options[i];
    if (!a) return;
    input.value = `@${a.slug} ${input.value.replace(/^\s*@[a-z0-9-]*\s*/i, "")}`;
    closeMenu(); syncSend(); input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  menu.addEventListener("mousedown", (e) => { const li = e.target.closest("[data-pick]"); if (li) { e.preventDefault(); pick(Number(li.dataset.pick)); } });

  // ---- Events ----
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; closeMenu(); syncSend(); ask(q); });
  input.addEventListener("input", () => { syncSend(); active = 0; syncMenu(); });
  input.addEventListener("blur", () => setTimeout(closeMenu, 150));
  input.addEventListener("keydown", (e) => {
    if (options.length && !menu.classList.contains("hidden")) {
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % options.length; syncMenu(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + options.length) % options.length; syncMenu(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(active); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === "ArrowUp" && !input.value) { const last = [...state.turns].reverse().find((c) => c.q); if (last) { e.preventDefault(); input.value = (last.agentSlug ? `@${last.agentSlug} ` : "") + last.q; syncSend(); } }
  });
  list.addEventListener("click", (e) => {
    const f = e.target.closest("[data-ask-fill]");
    if (f) { input.value = f.dataset.askFill; syncSend(); input.focus(); return; }
    const ag = e.target.closest("[data-ask-agent]");
    if (ag) { input.value = `@${ag.dataset.askAgent} `; syncSend(); input.focus(); return; }
    const retry = e.target.closest("[data-ask-retry]");
    if (retry) { const t = state.turns[Number(retry.dataset.askRetry)]; if (t) { state.turns.splice(Number(retry.dataset.askRetry), 1); render(); ask(t.q, { agentSlug: t.agentSlug }); } return; }
    // Follow-up chips inside this conversation continue it instead of opening the side panel.
    const b = e.target.closest("[data-ask]");
    if (b && !e.defaultPrevented) { e.preventDefault(); ask(b.dataset.ask); }
  });

  render();
  if (threadId) load(threadId);
  refreshBudget(container);
  return { ask, load, reset, state, focus: () => input.focus(), input };
}

export async function refreshBudget(root) {
  const node = root?.querySelector?.("[data-ask-budget]");
  if (!node) return;
  try {
    const o = await api("/api/agents/overview");
    if (!o.aiConfigured) node.textContent = "AI is off on the server right now.";
    else if (o.budget?.memberRemainingUsd != null) node.textContent = `${fmtUSD(o.budget.memberRemainingUsd)} left today`;
  } catch { /* optional */ }
}

// Past conversations: mine or the team's shared ones.
export async function threadList(scope = "mine", { q = "", limit = 30 } = {}) {
  try { return (await api(`/api/ask/threads?scope=${scope}&limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ""}`)).threads || []; } catch { return null; }
}

export function threadListHtml(threads, { activeId = null } = {}) {
  if (!threads?.length) return `<p class="muted small ask-threads-empty">No conversations yet.</p>`;
  return `<ul class="ask-threads">${threads.map((t) => `<li><button type="button" class="ask-thread${t.id === activeId ? " is-active" : ""}" data-thread="${t.id}" aria-current="${t.id === activeId}">
    <span class="ask-thread-title">${t.agentSlug ? `<span class="ask-to">@${esc(t.agentSlug)}</span> ` : ""}${esc(t.title || "Untitled")}</span>
    <span class="ask-thread-meta small muted">${t.mine ? "" : `${esc(t.owner?.name || "Teammate")} · `}${t.turns} question${t.turns === 1 ? "" : "s"}${t.visibility === "team" ? ` · ${icon("users", { size: 12 })} shared` : ""}</span></button></li>`).join("")}</ul>`;
}

export async function shareThread(thread, on = true) {
  const t = await api(`/api/ask/threads/${thread.id}/share`, { method: "POST", body: JSON.stringify({ share: on }) });
  toast(on ? "Shared with the team. It's on the feed and in the team's Ask tab." : "Only you can see this conversation now.", { type: "success" });
  return t;
}
