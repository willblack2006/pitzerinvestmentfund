// AI across the app: the Ask PIF side panel (header button, "a" key, and any [data-ask] button
// anywhere), live progress while an agent works, and the shared answer card with its sources.
// Members with AI access only; everything here is hidden for everyone else.
import { el, esc, api, can, icon, toast, safeUrl, fmtUSD } from "./shared.js";
import { toolLabel, sourceLabel, progressLines, suggestedQuestions } from "./aiFormat.js";

export { toolLabel, sourceLabel, progressLines };

export const sourceLink = (u, label = sourceLabel(u)) => !u ? ""
  : u.startsWith("#") ? `<a class="agent-src" href="${esc(u)}">${esc(label)}</a>`
  : `<a class="agent-src" href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(label)}<span class="sr-only"> (opens in a new tab)</span></a>`;

// Run times are stored in UTC ("2026-11-19 02:14:27"); show them in the member's own time zone.
export function localTime(utc, { date = true } = {}) {
  const d = new Date(`${String(utc || "").replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return String(utc || "");
  return d.toLocaleString("en-US", date ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
}

// ---- Feedback buttons (shared by every AI card) ----

export function feedbackButtons(runId, fb = {}) {
  const btn = (v, label) => `<button type="button" class="btn btn-ghost btn-sm" data-feedback="${v}" data-run="${runId}" aria-pressed="${fb.mine === v}">${label}${fb[v] ? ` <span class="muted">${fb[v]}</span>` : ""}</button>`;
  return `<span class="agent-feedback" role="group" aria-label="Was this useful?">${btn("useful", "Useful")}${btn("not_useful", "Not useful")}${btn("wrong", "Wrong")}</span>`;
}

export function bindFeedback(container) {
  if (!container || container.dataset.feedbackBound) return;
  container.dataset.feedbackBound = "1";
  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-feedback]");
    if (!b) return;
    try {
      const fb = await api(`/api/agents/runs/${b.dataset.run}/feedback`, { method: "POST", body: JSON.stringify({ verdict: b.dataset.feedback }) });
      b.closest(".agent-feedback").outerHTML = feedbackButtons(b.dataset.run, fb);
      toast("Thanks, noted.", { type: "success" });
    } catch (err) { toast(err.message, { type: "error" }); }
  });
}

// ---- The answer card (Ask PIF) ----

function answerBody(text) {
  return String(text || "").split(/\n{2,}/).map((para) => /^\s*- /m.test(para)
    ? `<ul>${para.split(/\n/).filter(Boolean).map((l) => `<li>${esc(l.replace(/^\s*- /, ""))}</li>`).join("")}</ul>`
    : `<p>${esc(para)}</p>`).join("");
}

export function answerCard(o, runId, { feedback, compact = false } = {}) {
  if (!o) return "";
  const claims = o.claims || [];
  const quotes = claims.filter((c) => c.quote);
  const verified = quotes.filter((c) => c.verified).length;
  const unsourced = claims.filter((c) => !c.sourced).length;
  const nums = o.unbackedNumbers || [];
  const checks = [
    claims.length ? `<span class="badge">${claims.length} source${claims.length === 1 ? "" : "s"}</span>` : `<span class="badge badge-warn">No sources given</span>`,
    quotes.length ? `<span class="badge ${verified === quotes.length ? "badge-owned" : "badge-warn"}">${verified} of ${quotes.length} quote${quotes.length === 1 ? "" : "s"} verified</span>` : "",
    unsourced ? `<span class="badge badge-warn">${unsourced} source${unsourced === 1 ? "" : "s"} not read</span>` : "",
    nums.length ? `<span class="badge badge-warn">${nums.length} number${nums.length === 1 ? "" : "s"} to check</span>` : "",
    o.selfChecked && !nums.length ? `<span class="badge" title="The agent re-checked its numbers against the data once before answering.">Numbers re-checked</span>` : "",
  ].join("");
  const claimLi = (c, i) => `<li><span class="agent-src-n" aria-hidden="true">${i + 1}</span><div>
      <p>${esc(c.text)} ${sourceLink(c.source_url)}${c.sourced ? "" : ` <span class="badge badge-warn" title="The agent named this source but never opened it in this run.">not read</span>`}</p>
      ${c.quote ? `<blockquote>“${esc(c.quote)}” ${c.verified ? `<span class="badge badge-owned" title="Found word for word in the source">Verified quote</span>${c.repaired ? ` <span class="badge" title="The agent paraphrased; this is the exact filing sentence it matched.">Matched to filing text</span>` : ""}` : `<span class="badge badge-warn" title="Not found in the source. Check it before relying on it.">Quote not found</span>`}</blockquote>` : ""}
    </div></li>`;
  const tools = (o.toolsUsed || []);
  return `<article class="panel agent-answer${compact ? " is-compact" : ""}" data-run="${runId}">
    <p class="agent-q">${icon("chat", { size: 14 })}<span>${esc(o.question)}</span></p>
    <div class="agent-answer-text">${answerBody(o.answer)}</div>
    <div class="agent-checks" aria-label="Checks on this answer">${checks}</div>
    ${claims.length ? `<div class="agent-sources"><p class="pf-sub">Where this comes from</p>
      <ol class="agent-src-list">${claims.slice(0, 4).map(claimLi).join("")}</ol>
      ${claims.length > 4 ? `<details><summary class="small">${claims.length - 4} more</summary><ol class="agent-src-list" start="5">${claims.slice(4).map((c, i) => claimLi(c, i + 4)).join("")}</ol></details>` : ""}</div>` : ""}
    ${nums.length ? `<p class="notice small">These numbers didn't match anything the agent looked up, so check them before using them: ${nums.map((n) => `<strong>${esc(n)}</strong>`).join(", ")}</p>` : ""}
    ${tools.length ? `<details class="agent-looked"><summary class="small">Looked at ${tools.length} thing${tools.length === 1 ? "" : "s"}</summary>
      <ul class="chip-list">${tools.map((t) => `<li class="chip${t.ok === false ? " is-bad" : ""}">${t.source_url ? `<a href="${t.source_url.startsWith("#") ? esc(t.source_url) : safeUrl(t.source_url)}">${esc(toolLabel(t.name, t.args))}</a>` : esc(toolLabel(t.name, t.args))}${t.ok === false ? " (failed)" : ""}</li>`).join("")}</ul></details>` : ""}
    ${o.followUps?.length ? `<div class="agent-followups"><span class="small muted">Ask next</span>${o.followUps.map((q) => `<button type="button" class="btn btn-ghost btn-sm agent-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
    <footer class="agent-brief-foot"><span class="muted small">AI-written research aid, not advice. <a href="#/agents/runs/${runId}">How it was made</a> · <button type="button" class="btn-link small" data-copy-answer>Copy</button></span>${feedbackButtons(runId, feedback)}</footer>
  </article>`;
}

// Copy an answer as plain text with its sources (for chat, notes or a pitch).
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy-answer]");
  if (!b) return;
  const card = b.closest(".agent-answer");
  const text = [card.querySelector(".agent-q")?.innerText, card.querySelector(".agent-answer-text")?.innerText,
    ...[...card.querySelectorAll(".agent-src-list li")].map((li, i) => `[${i + 1}] ${li.innerText.replace(/^\d+\s*/, "").trim()}`)].filter(Boolean).join("\n\n");
  try { await navigator.clipboard.writeText(text); toast("Answer copied.", { type: "success" }); } catch { toast("Couldn't copy here. Select the text instead.", { type: "error" }); }
});

// ---- Live progress while an agent works ----

export function progressHtml({ steps = [], intro = "Starting", elapsed = 0, expect = "" } = {}) {
  const lines = progressLines(steps);
  const lastModel = [...steps].reverse().find((s) => s.kind === "model");
  const next = !steps.length ? intro
    : lastModel?.toolCalls?.length && steps[steps.length - 1].kind === "model" ? `Looking up ${lastModel.toolCalls.map((n) => toolLabel(n)).join(", ")}`
    : steps[steps.length - 1].kind === "tool" || steps[steps.length - 1].kind === "source" ? "Reading what it found"
    : "Checking sources and numbers";
  return `<div class="agent-progress" role="status" aria-live="polite">
    <ol class="agent-progress-list">
      ${lines.map((l) => `<li class="${l.bad ? "is-bad" : "is-done"}">${icon(l.bad ? "x" : "check", { size: 14 })}<span>${esc(l.text)}</span></li>`).join("")}
      <li class="is-now"><span class="spinner" aria-hidden="true"></span><span>${esc(next)}…</span></li>
    </ol>
    <p class="muted small">${elapsed ? `${elapsed}s` : ""}${expect ? `${elapsed ? " · " : ""}${esc(expect)}` : ""}</p>
  </div>`;
}

// Runs `promise` (a POST that starts an agent) while showing its steps in `box`. Returns the
// promise's result. `match` narrows which of the member's running runs to follow.
export async function withProgress(box, promise, { workflow, symbol, intro = "Starting", expect = "" } = {}) {
  const started = Date.now();
  let steps = [], stopped = false;
  const paint = () => { if (!stopped && box?.isConnected) box.innerHTML = progressHtml({ steps, intro, expect, elapsed: Math.round((Date.now() - started) / 1000) }); };
  paint();
  const qs = new URLSearchParams({ ...(workflow ? { workflow } : {}), ...(symbol ? { symbol } : {}) });
  const tick = async () => {
    if (stopped || !box?.isConnected) return;
    try { const r = await api(`/api/agents/runs-live?${qs}`); if (r.run) steps = r.run.steps || []; } catch { /* progress is optional */ }
    paint();
    if (!stopped) timer = setTimeout(tick, 1200);
  };
  let timer = setTimeout(tick, 700);
  try { return await promise; } finally { stopped = true; clearTimeout(timer); }
}

// An AI error with the next step a member can take.
export function aiErrorHtml(err) {
  const msg = esc(err?.message || "Something went wrong.");
  const run = err?.runId ? ` <a href="#/agents/runs/${err.runId}">What happened</a>` : "";
  if (err?.code === "ai_member_cap" || err?.code === "ai_month_cap") return `<p class="notice small" role="alert">${msg} <a href="#/agents/activity">See AI spending</a></p>`;
  if (err?.code === "ai_required") return `<p class="notice small" role="alert">${msg}</p>`;
  return `<p class="error small" role="alert">${msg}${run}</p>`;
}

// ---- Suggested questions for where the member is ----

export const suggestionsFor = (symbol) => suggestedQuestions({ symbol, hash: location.hash });

// A row of question buttons; clicking one opens Ask PIF and asks it.
export function askChips(questions, { label = "Ask PIF" } = {}) {
  if (!can("ai") || !questions?.length) return "";
  return `<div class="agent-followups ask-chips"><span class="small muted">${icon("sparkle", { size: 14 })} ${esc(label)}</span>${questions.map((q) => `<button type="button" class="btn btn-ghost btn-sm agent-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
}

// ---- Ask PIF side panel ----

let panel = null;
const convo = []; // this visit's questions and answers in the panel: { q, runId, output, error }
let busy = false;

function panelHtml() {
  return `<div class="ask">
    <header class="chat-head"><div><h2 id="askTitle">${icon("sparkle")} Ask PIF</h2></div>
      <div><a class="small" href="#/agents/ask">All questions</a><button type="button" class="icon-btn" id="askClose" aria-label="Close Ask PIF">${icon("x")}</button></div></header>
    <div class="ask-list" id="askList"></div>
    <form class="ask-compose" id="askPanelForm">
      <label for="askPanelInput" class="sr-only">Your question</label>
      <div class="chat-input-row"><textarea id="askPanelInput" rows="2" maxlength="1000" placeholder="Ask about the fund, a holding or any ticker"></textarea>
      <button class="btn btn-primary" id="askPanelSend">Ask</button></div>
      <p class="muted small ask-hint">Answers use the app's data and SEC filings, and the web only when those don't cover it. Enter to ask, Shift+Enter for a new line. <span id="askBudget"></span></p>
    </form>
  </div>`;
}

function renderList() {
  const list = panel?.querySelector("#askList");
  if (!list) return;
  if (!convo.length) {
    list.innerHTML = `<div class="ask-empty"><p class="ask-empty-title">Ask a question about the fund</p>
      <p class="muted small">PIF looks things up in the app (holdings, filings, insiders, valuation, macro) and shows where every fact came from.</p>
      <div class="ask-suggest">${suggestionsFor().map((q) => `<button type="button" class="btn btn-ghost btn-sm agent-chip" data-ask-fill="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>`;
    return;
  }
  list.innerHTML = convo.map((c, i) => c.output ? answerCard(c.output, c.runId, { compact: true })
    : c.error ? `<div class="panel agent-answer is-compact"><p class="agent-q">${icon("chat", { size: 14 })}<span>${esc(c.q)}</span></p>${aiErrorHtml(c.error)}<button type="button" class="btn btn-ghost btn-sm" data-ask="${esc(c.q)}">Try again</button></div>`
    : `<div class="panel agent-answer is-compact"><p class="agent-q">${icon("chat", { size: 14 })}<span>${esc(c.q)}</span></p><div id="askProgress${i}"></div></div>`).join("");
}

async function refreshBudget() {
  try {
    const o = await api("/api/agents/overview");
    const b = o.budget;
    const node = panel?.querySelector("#askBudget");
    if (node && b?.memberRemainingUsd != null) node.textContent = `${fmtUSD(b.memberRemainingUsd)} of your daily AI budget left.`;
    if (node && !o.aiConfigured) node.textContent = "AI is off on the server right now.";
  } catch { /* optional */ }
}

export async function ask(question) {
  const q = String(question || "").trim();
  if (!q || busy) return;
  busy = true;
  const item = { q };
  convo.push(item);
  renderList();
  const list = panel.querySelector("#askList");
  list.scrollTop = list.scrollHeight;
  const send = panel.querySelector("#askPanelSend");
  send.disabled = true;
  const box = panel.querySelector(`#askProgress${convo.length - 1}`);
  try {
    const r = await withProgress(box, api("/api/agents/ask", { method: "POST", body: JSON.stringify({ question: q }) }), { workflow: "ask_pif", intro: "Reading your question", expect: "Usually 10 to 40 seconds" });
    Object.assign(item, { output: r.output, runId: r.runId });
  } catch (err) { item.error = err; }
  busy = false;
  send.disabled = false;
  renderList();
  const cards = list.querySelectorAll(".agent-answer");
  cards[cards.length - 1]?.scrollIntoView({ block: "start" });
  refreshBudget();
}

function closeAsk() {
  panel?.close();
  el("askBtn")?.focus();
}

export function openAsk({ question = "", autoSubmit = false } = {}) {
  if (!can("ai")) return;
  if (!panel) {
    panel = document.createElement("dialog");
    panel.className = "chat-panel ask-panel";
    panel.setAttribute("aria-labelledby", "askTitle");
    panel.innerHTML = panelHtml();
    document.body.append(panel);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeAsk(); } });
    panel.querySelector("#askClose").addEventListener("click", closeAsk);
    const input = panel.querySelector("#askPanelInput");
    panel.querySelector("#askPanelForm").addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); panel.querySelector("#askPanelForm").requestSubmit(); } });
    panel.addEventListener("click", (e) => {
      const f = e.target.closest("[data-ask-fill]");
      if (f) { input.value = f.dataset.askFill; input.focus(); }
      if (e.target.closest("a[href^='#/']") && window.matchMedia("(max-width: 720px)").matches) closeAsk();
    });
    bindFeedback(panel);
    renderList();
  }
  if (!panel.open) { panel.show(); refreshBudget(); if (!convo.length) renderList(); }
  el("chatBtn") && document.querySelector(".chat-panel:not(.ask-panel)[open]")?.close();
  const input = panel.querySelector("#askPanelInput");
  if (question && autoSubmit) ask(question);
  else { if (question) input.value = question; input.focus(); }
}

export function initAsk() {
  const btn = el("askBtn");
  const sync = () => {
    const on = can("ai");
    btn?.classList.toggle("hidden", !on);
    if (!on) { panel?.close(); convo.length = 0; }
  };
  btn?.addEventListener("click", () => (panel?.open ? closeAsk() : openAsk()));
  window.addEventListener("pif:session-changed", sync);
  sync();
  // Any [data-ask] button anywhere asks that question in the panel (pages can handle it first).
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ask]");
    if (!b || e.defaultPrevented || !can("ai")) return;
    e.preventDefault();
    openAsk({ question: b.dataset.ask, autoSubmit: true });
  });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-ask-open]") && can("ai")) openAsk(); });
  // "a" opens Ask PIF from anywhere (unless typing).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "a" || e.metaKey || e.ctrlKey || e.altKey || !can("ai")) return;
    if (e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]:not(.ask-panel)")) return;
    e.preventDefault();
    openAsk();
  });
}

// ---- "From the research agents": latest briefs as a compact list (Research, Today) ----

const TONE_BADGE = { positive: "badge-owned", negative: "badge-danger", mixed: "badge-warn" };
const KIND_LABEL = { filing_flash: "Filing brief", earnings_flash: "Earnings brief", earnings_preview: "Earnings preview", weekly_memo: "Weekly memo",
  macro_brief: "Macro brief", ownership_watch: "Ownership watch", policy_watch: "Policy watch", data_qa: "Data check" };

export function aiPanelHtml({ id, title = "From the research agents", symbol = null } = {}) {
  if (!can("ai")) return "";
  return `<section class="panel ai-panel" aria-labelledby="${id}-h" id="${id}">
    <div class="panel-head"><h3 id="${id}-h">${icon("sparkle", { size: 16 })} ${esc(title)}</h3><a class="small" href="#/agents">All briefs →</a></div>
    <div class="ai-panel-body"><p class="muted small">Loading…</p></div>
    ${askChips(suggestionsFor(symbol).slice(0, symbol ? 3 : 2), { label: symbol ? `Ask about ${symbol}` : "Ask PIF" })}
  </section>`;
}

// Fills an aiPanelHtml() panel with the newest briefs (for one ticker, or fund-wide from the last
// `days` days). Quietly removes itself for members without AI access.
export async function loadAiPanel(id, { symbol = null, limit = 3, days = null } = {}) {
  const node = document.getElementById(id);
  if (!node) return;
  const body = node.querySelector(".ai-panel-body");
  let r;
  try { r = await api(`/api/agents/briefs?limit=${symbol ? limit : 20}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`); }
  catch (err) { if (err.code === "ai_required" || err.code === "signin_required") node.remove(); else body.innerHTML = `<p class="muted small">Couldn't load briefs: ${esc(err.message)}</p>`; return; }
  const since = days ? Date.now() - days * 864e5 : 0;
  const list = r.briefs.filter((b) => b.brief && (!since || Date.parse(`${b.createdAt.replace(" ", "T")}Z`) >= since)).slice(0, limit);
  body.innerHTML = list.length ? `<ul class="ai-brief-list">${list.map((b) => {
    const o = b.brief;
    const head = o.headline || o.title || KIND_LABEL[b.workflow] || "Brief";
    return `<li><a href="#/agents/runs/${b.runId}" class="ai-brief-link"><span class="ai-brief-meta small muted">${!symbol && b.symbol ? `<strong>${esc(b.symbol)}</strong> · ` : ""}${esc(KIND_LABEL[b.workflow] || b.workflow)} · ${esc(localTime(b.createdAt, { date: false }))}</span>
      <span class="ai-brief-head">${esc(head)}</span></a>${o.tone && TONE_BADGE[o.tone] ? ` <span class="badge ${TONE_BADGE[o.tone]}">${esc(o.tone)}</span>` : ""}</li>`;
  }).join("")}</ul>`
    : `<p class="muted small">${symbol ? `No AI briefs on ${esc(symbol)} yet. Brief any filing from the <a href="#/research/${encodeURIComponent(symbol)}/filings">Filings tab</a>.` : "No new briefs this week. Agents write one when a holding files an 8-K, 10-Q or 10-K."}</p>`;
}
