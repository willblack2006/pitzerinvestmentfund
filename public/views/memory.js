// Shared memory (WS5): browse, search, add, edit, retract and pin what the fund's agents and
// members know, plus the agents' blackboard (handoffs, requests and answers between agents).
// Mounted as its own page (#/memory, #/memory/:symbol) and as the Agents → Memory tab.
import { esc, api, can, pageHead, lockedHint, skeleton, emptyState, errorState, bindRetry, toast, safeUrl, icon, confirmAction } from "../shared.js";

export const title = (p = {}) => (p.symbol ? `${String(p.symbol).toUpperCase()} · Memory` : "Shared memory");

export const KIND_LABEL = { fact: "Fact", observation: "Observation", decision: "Decision", preference: "Preference", open_question: "Open question", prediction: "Prediction" };
const KIND_TONE = { fact: "badge-owned", decision: "badge-watch", open_question: "badge-warn", prediction: "mem-badge-pred", preference: "mem-badge-pref", observation: "" };
const KIND_FILTERS = [["", "All"], ["fact", "Facts"], ["observation", "Observations"], ["decision", "Decisions"], ["open_question", "Open questions"], ["prediction", "Predictions"], ["preference", "My preferences"]];
const STATUS_FILTERS = [["active", "Active"], ["proposed", "Waiting for approval"], ["retracted", "Retracted"]];
const TOPIC_LABEL = { thesis: "Thesis", valuation: "Valuation", risk: "Risk", catalyst: "Catalyst", question: "Question" };
const MSG_KIND = { handoff: "Handoff", finding: "Finding", request: "Request", answer: "Answer" };
const MSG_STATUS = { open: "badge-warn", claimed: "badge-watch", done: "badge-owned", dropped: "" };

const day = (s) => String(s || "").slice(0, 10);
const link = (u) => (!u ? "" : u.startsWith("#") ? esc(u) : safeUrl(u));

export function kindBadge(kind) {
  return `<span class="badge mem-kind ${KIND_TONE[kind] || ""}">${esc(KIND_LABEL[kind] || kind)}</span>`;
}

function byLine(m) {
  const who = m.by?.type === "agent" ? `${icon("sparkle", { size: 14 })} ${esc(m.by.name)}` : m.by?.type === "member" ? `${icon("user", { size: 14 })} ${esc(m.by.name)}` : esc(m.by?.name || "PIF");
  return `<span class="mem-by">${who}</span>`;
}

// One memory as a card. `actions` false for read-only places (the dossier card, Why?).
export function memoryItem(m, { actions = true, showSymbol = true, cited = null } = {}) {
  const src = m.sourceUrl ? ` · <a href="${link(m.sourceUrl)}"${m.sourceUrl.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>source</a>` : "";
  const run = m.sourceRunId ? ` · <a href="#/agents/runs/${m.sourceRunId}">run #${m.sourceRunId}</a>` : "";
  return `<li class="mem-item${m.pinned ? " is-pinned" : ""}${m.status !== "active" ? ` is-${esc(m.status)}` : ""}" data-mem="${m.id}">
    <div class="mem-top">
      ${kindBadge(m.kind)}
      ${showSymbol && m.scope === "symbol" ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(m.scopeKey)}">${esc(m.scopeKey)}</a>` : m.scope === "fund" ? `<span class="muted small">Fund-wide</span>` : m.scope === "member" ? `<span class="muted small">Only you</span>` : ""}
      ${m.pinned ? `<span class="mem-pin" title="Pinned: always near the top of what agents recall">${icon("star-filled", { size: 14, label: "Pinned" })}</span>` : ""}
      ${cited === true ? `<span class="badge badge-owned">Cited</span>` : cited === false ? `<span class="badge">Given, not cited</span>` : ""}
      ${m.status === "proposed" ? `<a class="badge badge-warn" href="#/agents/approvals">Waiting for approval</a>` : m.status === "retracted" ? `<span class="badge badge-danger">Retracted</span>` : ""}
      <span class="mem-id muted small">m${m.id}</span>
    </div>
    <p class="mem-text">${esc(m.text)}</p>
    <p class="mem-meta muted small">${byLine(m)} · ${esc(day(m.asOf || m.createdAt))}${m.confidence != null ? ` · confidence ${Math.round(m.confidence * 100)}%` : ""}${m.seenCount > 1 ? ` · seen ${m.seenCount} times` : ""}${m.expiresAt ? ` · until ${esc(day(m.expiresAt))}` : ""}${src}${run}</p>
    ${actions ? `<div class="mem-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-mem-act="pin" aria-pressed="${m.pinned}">${m.pinned ? "Unpin" : "Pin"}</button>
      ${m.status === "active" ? `<button type="button" class="btn btn-ghost btn-sm" data-mem-act="edit">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-mem-act="retract">Retract</button>` : ""}
      ${m.supersedesId ? `<button type="button" class="btn btn-ghost btn-sm" data-mem-act="history">History</button>` : ""}
    </div>` : ""}
  </li>`;
}

function agentName(x) {
  if (!x) return "";
  return `${icon("sparkle", { size: 14 })} ${esc(x.name || x.workflow || "agent")}`;
}

export function messageItem(m) {
  const p = m.payload || {};
  const what = p.question || p.text || p.title || (p.briefRunId ? `Brief from run #${p.briefRunId}` : "");
  return `<li class="mem-msg">
    <div class="mem-top">
      <span class="badge ${m.kind === "request" ? "badge-warn" : m.kind === "answer" ? "badge-owned" : ""}">${esc(MSG_KIND[m.kind] || m.kind)}</span>
      <span class="mem-route">${agentName(m.from) || "Someone"} <span aria-hidden="true">→</span><span class="sr-only">to</span> ${m.to ? agentName(m.to) : `<span class="chip mem-topic">#${esc(TOPIC_LABEL[m.topic] || m.topic || "any")}</span>`}</span>
      ${m.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(m.symbol)}">${esc(m.symbol)}</a>` : ""}
      <span class="badge ${MSG_STATUS[m.status] || ""}">${esc(m.status)}</span>
      <span class="muted small mem-id">${esc(String(m.createdAt || "").slice(0, 16))}</span>
    </div>
    ${what ? `<p class="mem-text">${esc(what)}</p>` : ""}
    ${m.answer ? `<p class="mem-answer small">${icon("check", { size: 14 })} ${esc(m.answer)}</p>` : ""}
    <p class="muted small">${m.fromRunId ? `<a href="#/agents/runs/${m.fromRunId}">from run #${m.fromRunId}</a>` : ""}${m.claimedBy?.runId ? ` · <a href="#/agents/runs/${m.claimedBy.runId}">picked up by run #${m.claimedBy.runId}</a>` : ""}</p>
  </li>`;
}

function addForm(symbol) {
  return `<form class="panel mem-form" id="memAdd" hidden>
    <h3>Add to the fund's memory</h3>
    <p class="muted small">Agents read this before they work on a ticker. Write one specific thing per memory. A preference only shapes your own Ask PIF answers.</p>
    <div class="mem-form-row">
      <label class="field-block">Kind
        <select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}"${k === "observation" ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field-block">Ticker <span class="muted small">(empty = fund-wide)</span>
        <input name="symbol" value="${esc(symbol || "")}" maxlength="12" autocomplete="off" spellcheck="false" placeholder="e.g. NVDA"></label>
    </div>
    <label class="field-block">What should agents remember?
      <textarea name="text" maxlength="600" required placeholder="e.g. Management said capex peaks in FY27 (Q3 call)."></textarea></label>
    <label class="field-block">Source link <span class="muted small">(optional)</span>
      <input name="sourceUrl" type="url" maxlength="500" placeholder="https://www.sec.gov/..."></label>
    <div class="row-actions"><button class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-ghost btn-sm" data-mem-cancel>Cancel</button></div>
  </form>`;
}

// The dossier summary on top of a ticker's memory (and the Research card uses dossierSummary too).
export function dossierSummary(d, { canRefresh = false } = {}) {
  if (!d?.summary) return canRefresh && (d?.observations?.length || 0) + (d?.facts?.length || 0) + (d?.decisions?.length || 0) >= 2
    ? `<p class="muted small">No summary yet. One is written overnight, or <button type="button" class="btn-link" data-dossier-refresh>write it now</button>.</p>` : "";
  const s = d.summary;
  return `<div class="mem-dossier">
    <p>${esc(s.text)}</p>
    ${s.points?.length ? `<ul class="mem-points">${s.points.map((p) => `<li>${esc(p.text)} ${p.memoryIds.map((i) => `<a class="mem-ref" href="#/memory/${encodeURIComponent(d.symbol)}?m=${i}">m${i}</a>`).join(" ")}</li>`).join("")}</ul>` : ""}
    <p class="muted small">Summarised from ${s.memoryCount} memories on ${esc(day(s.updatedAt))}${s.runId ? ` · <a href="#/agents/runs/${s.runId}">how</a>` : ""}${s.stale ? ` · newer memories since${canRefresh ? `, <button type="button" class="btn-link" data-dossier-refresh>refresh</button>` : ""}` : ""}</p>
  </div>`;
}

const state = { q: "", symbol: "", kind: "", status: "active", view: "memories" };

export async function render(container, { symbol = "", embedded = false } = {}) {
  if (!can("member")) {
    container.innerHTML = `<div class="toolbar">${lockedHint("Sign in to see what the fund's agents know.")}</div>`;
    return;
  }
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  state.symbol = String(symbol || qs.get("symbol") || "").toUpperCase();
  const focusId = Number(qs.get("m")) || null;
  if (qs.get("view") === "blackboard") state.view = "blackboard";
  container.innerHTML = `<div class="mem-wrap">
    <div class="mem-toolbar">
      <div class="seg seg-sm mem-seg" role="group" aria-label="Show">
        <button type="button" class="seg-btn" data-view="memories" aria-pressed="${state.view === "memories"}">Memories</button>
        <button type="button" class="seg-btn" data-view="blackboard" aria-pressed="${state.view === "blackboard"}">Blackboard</button>
      </div>
      <label class="mem-search"><span class="sr-only">Search memory</span>${icon("search", { size: 16 })}<input type="search" id="memQ" placeholder="Search what agents know" value="${esc(state.q)}" autocomplete="off"></label>
      <label class="mem-ticker"><span class="sr-only">Ticker</span><input id="memSym" placeholder="Ticker" value="${esc(state.symbol)}" maxlength="12" autocomplete="off" spellcheck="false"></label>
      <button type="button" class="btn btn-primary btn-sm" id="memAddBtn">${icon("plus", { size: 16 })} Add memory</button>
    </div>
    ${addForm(state.symbol)}
    <div id="memDossier"></div>
    <div id="memFilters"></div>
    <div id="memList" aria-live="polite">${skeleton("rows", { rows: 5, label: "Loading memory" })}</div>
  </div>`;
  const $ = (s) => container.querySelector(s);
  const listEl = $("#memList"), filtersEl = $("#memFilters"), dossierEl = $("#memDossier"), form = $("#memAdd");

  const loadDossier = async () => {
    if (!state.symbol || state.view !== "memories") { dossierEl.innerHTML = ""; return; }
    try {
      const d = await api(`/api/memory/dossier/${encodeURIComponent(state.symbol)}`);
      const body = dossierSummary(d, { canRefresh: can("ai") });
      dossierEl.innerHTML = body ? `<section class="panel mem-dossier-panel"><h3>What our agents know about <a href="#/research/${encodeURIComponent(state.symbol)}">${esc(state.symbol)}</a></h3>${body}</section>` : "";
    } catch { dossierEl.innerHTML = ""; }
  };

  const load = async () => {
    if (state.view === "blackboard") {
      filtersEl.innerHTML = `<p class="muted small mem-explain">Agents hand work to each other and ask each other questions here. A brief on a holding hands off to the thesis check; a request on a topic is picked up by whichever agent follows it.</p>`;
      try {
        const r = await api(`/api/memory/blackboard${state.symbol ? `?symbol=${encodeURIComponent(state.symbol)}` : ""}`);
        listEl.innerHTML = r.items.length ? `<ul class="mem-list">${r.items.map(messageItem).join("")}</ul>`
          : emptyState({ icon: "sparkle", title: "No messages between agents yet", body: "When an agent hands off work or asks another agent something, it shows up here." });
      } catch (err) { listEl.innerHTML = errorState({ title: "Couldn't load the blackboard.", detail: err.message, retryId: "mem" }); bindRetry(listEl, "mem", load); }
      return;
    }
    const p = new URLSearchParams({ status: state.status, limit: "100" });
    if (state.q) p.set("q", state.q);
    if (state.symbol) p.set("symbol", state.symbol);
    if (state.kind === "preference") p.set("scope", "member");
    else if (state.kind) p.set("kind", state.kind);
    let r;
    try { r = await api(`/api/memory?${p}`); } catch (err) { listEl.innerHTML = errorState({ title: "Couldn't load memory.", detail: err.message, retryId: "mem" }); bindRetry(listEl, "mem", load); return; }
    const counts = Object.fromEntries((r.facets.kinds || []).map((k) => [k.kind, k.c]));
    filtersEl.innerHTML = `<div class="mem-filters">
      <div class="chip-list" role="group" aria-label="Kind">${KIND_FILTERS.map(([k, l]) => `<button type="button" class="chip${state.kind === k ? " is-active" : ""}" data-kind="${k}" aria-pressed="${state.kind === k}">${l}${k && counts[k] ? ` <span class="muted">${counts[k]}</span>` : !k ? ` <span class="muted">${r.facets.total}</span>` : ""}</button>`).join("")}</div>
      <label class="mem-status"><span class="sr-only">Status</span><select id="memStatus">${STATUS_FILTERS.map(([k, l]) => `<option value="${k}"${state.status === k ? " selected" : ""}>${l}${k === "proposed" && r.facets.proposed ? ` (${r.facets.proposed})` : ""}</option>`).join("")}</select></label>
    </div>
    ${!state.symbol && r.facets.symbols?.length ? `<div class="mem-tickers chip-list" aria-label="Tickers with memory">${r.facets.symbols.slice(0, 16).map((s) => `<button type="button" class="chip chip-sm" data-sym="${esc(s.symbol)}">${esc(s.symbol)} <span class="muted">${s.c}</span></button>`).join("")}</div>` : ""}`;
    listEl.innerHTML = r.items.length
      ? `<p class="muted small">${r.total} ${r.total === 1 ? "memory" : "memories"}${state.symbol ? ` on ${esc(state.symbol)}` : ""}</p><ul class="mem-list">${r.items.map((m) => memoryItem(m)).join("")}</ul>`
      : emptyState({ icon: "sparkle", title: state.q || state.symbol || state.kind ? "Nothing matches" : "No shared memory yet", body: state.q || state.symbol || state.kind ? "Try fewer words or another ticker." : "Agents add what they learn as they read filings and check theses. You can add notes for them too." });
    if (focusId) container.querySelector(`[data-mem="${focusId}"]`)?.classList.add("is-focus");
  };
  const reload = () => Promise.all([load(), loadDossier()]);

  let t = null;
  $("#memQ").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });
  $("#memSym").addEventListener("change", (e) => { state.symbol = e.target.value.trim().toUpperCase(); e.target.value = state.symbol; form.symbol.value = state.symbol; reload(); });
  $("#memAddBtn").addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) form.text.focus(); });
  form.addEventListener("click", (e) => { if (e.target.closest("[data-mem-cancel]")) { form.hidden = true; form.reset(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button.btn-primary");
    btn.disabled = true;
    try {
      const body = { kind: form.kind.value, text: form.text.value, symbol: form.symbol.value.trim() || null, sourceUrl: form.sourceUrl.value.trim() || null };
      const r = await api("/api/memory", { method: "POST", body: JSON.stringify(body) });
      toast(r.duplicate ? "Agents already knew that; refreshed the existing memory." : "Saved. Agents will use it from their next run.", { type: "success" });
      form.reset(); form.symbol.value = state.symbol; form.hidden = true;
      reload();
    } catch (err) { toast(err.message, { type: "error" }); }
    finally { btn.disabled = false; }
  });

  container.addEventListener("change", (e) => { if (e.target.id === "memStatus") { state.status = e.target.value; load(); } });
  container.addEventListener("click", async (e) => {
    const v = e.target.closest("[data-view]");
    if (v) { state.view = v.dataset.view; container.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b === v))); reload(); return; }
    const k = e.target.closest("[data-kind]");
    if (k) { state.kind = k.dataset.kind; load(); return; }
    const s = e.target.closest("[data-sym]");
    if (s) { state.symbol = s.dataset.sym; $("#memSym").value = state.symbol; form.symbol.value = state.symbol; reload(); return; }
    if (e.target.closest("[data-dossier-refresh]")) {
      const b = e.target.closest("[data-dossier-refresh]");
      b.disabled = true; b.textContent = "Writing…";
      try { await api(`/api/memory/dossier/${encodeURIComponent(state.symbol)}/refresh`, { method: "POST" }); loadDossier(); } catch (err) { toast(err.message, { type: "error" }); b.disabled = false; b.textContent = "Try again"; }
      return;
    }
    const a = e.target.closest("[data-mem-act]");
    if (!a) return;
    const item = a.closest("[data-mem]"), id = item.dataset.mem;
    const act = a.dataset.memAct;
    try {
      if (act === "pin") {
        await api(`/api/memory/${id}/pin`, { method: "POST", body: JSON.stringify({ pinned: a.getAttribute("aria-pressed") !== "true" }) });
        load();
      } else if (act === "retract") {
        const ok = await confirmAction({ title: "Retract this memory?", body: "Agents stop using it. It stays in the history, marked retracted.", confirmLabel: "Retract", danger: true });
        if (!ok) return;
        await api(`/api/memory/${id}/retract`, { method: "POST", body: "{}" });
        toast("Retracted.", { type: "success" }); reload();
      } else if (act === "edit") {
        const text = item.querySelector(".mem-text").textContent;
        item.querySelector(".mem-text").outerHTML = `<form class="mem-edit"><label class="sr-only" for="memEdit${id}">Memory text</label><textarea id="memEdit${id}" maxlength="600">${esc(text)}</textarea>
          <div class="row-actions"><button class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-ghost btn-sm" data-mem-edit-cancel>Cancel</button></div>
          <p class="muted small">Saving keeps the old wording in this memory's history.</p></form>`;
        const f = item.querySelector(".mem-edit");
        f.querySelector("textarea").focus();
        f.addEventListener("click", (ev) => { if (ev.target.closest("[data-mem-edit-cancel]")) load(); });
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try { await api(`/api/memory/${id}`, { method: "PATCH", body: JSON.stringify({ text: f.querySelector("textarea").value }) }); toast("Updated.", { type: "success" }); load(); } catch (err) { toast(err.message, { type: "error" }); }
        });
      } else if (act === "history") {
        const r = await api(`/api/memory/${id}`);
        const box = document.createElement("div");
        box.className = "mem-history";
        box.innerHTML = `<p class="pf-sub">Earlier versions</p><ol class="small">${r.history.slice(1).map((h) => `<li><span class="muted">${esc(day(h.createdAt))} · ${esc(h.by?.name || "")}:</span> ${esc(h.text)}</li>`).join("")}</ol>`;
        item.querySelector(".mem-history")?.remove();
        item.append(box);
        a.remove();
      }
    } catch (err) { toast(err.message, { type: "error" }); }
  });

  await reload();
  if (embedded) return;
}

// Standalone page: #/memory and #/memory/:symbol.
export async function mount(container, params = {}) {
  container.innerHTML = pageHead("Shared memory", "What the fund's agents and members have learned, in one place. Agents read it before they work, cite it by id, and add to it as they go. Facts and decisions an agent writes wait for a member's approval.") + `<div class="page-pad" id="memPage"></div>`;
  await render(container.querySelector("#memPage"), { symbol: params.symbol || "" });
}

// Agents → Memory tab (public/views/agents/memory.js re-exports this).
export const tab = { key: "memory", label: "Memory", order: 45, render: (el, ctx = {}) => render(el, { symbol: ctx.symbol || "", embedded: true }) };
