// Research agents: briefs, the approval queue, every run with its cost, and the event feed the
// rules router saw. Members with AI access only (an admin grants it in Settings).
import { esc, api, can, pageHead, lockedHint, skeleton, emptyState, errorState, bindRetry, tabNav, toast, safeUrl, fmtUSD, icon } from "../shared.js";
import { answerCard, feedbackButtons, bindFeedback, sourceLink, withProgress, aiErrorHtml, suggestionsFor, localTime } from "../ai.js";

export { answerCard, feedbackButtons, bindFeedback, money };

export const title = "Agents";

const TABS = [["briefs", "#/agents", "Briefs &amp; reports"], ["ask", "#/agents/ask", "Ask PIF"], ["desk", "#/agents/desk", "Research desk"], ["approvals", "#/agents/approvals", "Approvals"], ["activity", "#/agents/activity", "Activity"], ["events", "#/agents/events", "Events"]];
const WORKFLOW_LABEL = {
  filing_flash: "Filing flash", earnings_flash: "Earnings flash", ask_pif: "Ask PIF", red_team: "Red team", pitch_primer: "Pitch primer",
  earnings_preview: "Earnings preview", thesis_check: "Thesis check", weekly_memo: "Weekly memo", data_qa: "Data check", macro_brief: "Macro brief",
  ownership_watch: "Ownership watch", policy_watch: "Policy watch", filing_brief: "Filing brief (Research)", filing_change_brief: "Change brief (Research)",
  compare: "Compare", what_if: "What-if", meeting_prep: "Meeting prep", ideas: "Idea hunt", news_triage: "News triage", today_recap: "Today recap", app: "Other AI",
};
export const workflowLabel = (w) => WORKFLOW_LABEL[w] || w;
const money = (v) => (v == null ? "—" : v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : fmtUSD(v));
const TONE = { positive: "badge-owned", negative: "badge-danger", mixed: "badge-warn", neutral: "" };
const STATUS = { done: "badge-owned", failed: "badge-danger", refused: "badge-warn", running: "badge-watch" };

export function budgetBar(b) {
  const pct = b.monthlyCapUsd > 0 ? Math.min(100, (b.monthSpentUsd / b.monthlyCapUsd) * 100) : 100;
  const tone = pct >= 90 ? "is-bad" : pct >= 70 ? "is-warn" : "";
  return `<div class="agent-budget">
    <div class="agent-budget-row"><span><strong>${money(b.monthSpentUsd)}</strong> of ${money(b.monthlyCapUsd)} AI budget used this month</span>
      ${b.memberRemainingUsd != null ? `<span class="muted small">You have ${money(b.memberRemainingUsd)} left today</span>` : ""}</div>
    <div class="agent-meter ${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}" aria-label="AI budget used this month"><span style="width:${pct.toFixed(1)}%"></span></div>
  </div>`;
}

const verifiedBadge = (v) => v ? `<span class="badge badge-owned" title="This quote was found word for word in the filing">Verified quote</span>`
  : `<span class="badge badge-warn" title="This quote could not be found in the filing. Check it before relying on it.">Quote not found</span>`;

const repairedBadge = (x) => x?.repaired ? ` <span class="badge" title="The agent paraphrased; the quote shown is the exact filing sentence it matched.">Matched to filing text</span>` : "";

export function briefCard(b, { runId, feedback, showSymbol = true } = {}) {
  if (!b) return "";
  const fb = feedback || {};
  return `<article class="panel agent-brief" data-run="${runId}">
    <header class="agent-brief-head">
      <div>
        <p class="muted small">${showSymbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(b.symbol)}">${esc(b.symbol)}</a> · ` : ""}${esc(workflowLabel(b.kind))} · <a href="${safeUrl(b.sourceUrl)}" target="_blank" rel="noopener">${esc(b.form)}${b.items ? ` items ${esc(b.items)}` : ""} filed ${esc(b.filedAt || "")}<span class="sr-only"> (opens on sec.gov)</span></a></p>
        <h3>${esc(b.headline)}</h3>
      </div>
      ${b.tone ? `<span class="badge ${TONE[b.tone] || ""}">${esc(b.tone)}</span>` : ""}
    </header>
    <p>${esc(b.bottomLine)}</p>
    ${b.points?.length ? `<ul class="agent-points">${b.points.map((p) => `<li><p>${esc(p.text)}</p><blockquote>“${esc(p.quote)}” ${verifiedBadge(p.verified)}${repairedBadge(p)}</blockquote></li>`).join("")}</ul>` : ""}
    ${b.kpis?.length ? `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Reported figures</caption><thead><tr><th scope="col" class="left">Figure</th><th scope="col" class="num">As filed</th><th scope="col" class="left">Check</th></tr></thead>
      <tbody>${b.kpis.map((k) => `<tr><th scope="row" class="left">${esc(k.name)}</th><td class="num">${esc(k.value)}</td><td class="left">${verifiedBadge(k.verified)}${repairedBadge(k)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${b.questions?.length ? `<p class="pf-sub">Look into next</p><ul class="small">${b.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
    ${b.unbackedNumbers?.length ? `<p class="notice small">These numbers in the text don't match the filing or the app's data, so check them: ${b.unbackedNumbers.map(esc).join(", ")}</p>` : ""}
    ${b.sourceTruncated ? `<p class="muted small">The filing was long, so only its first part was read.</p>` : ""}
    <footer class="agent-brief-foot">
      <span class="muted small">AI-written research aid, not advice. <a href="#/agents/runs/${runId}">How it was made</a></span>
      ${feedbackButtons(runId, fb)}
    </footer>
  </article>`;
}

const srcLink = (u) => sourceLink(u);

export function reportCard(o, runId, fb) {
  const dataQa = o.kind === "data_qa";
  return `<article class="panel agent-brief">
    <header class="agent-brief-head"><div>
      <p class="muted small">${esc(workflowLabel(o.kind))}${o.symbol ? ` · <a class="symbol-cell" href="#/research/${encodeURIComponent(o.symbol)}">${esc(o.symbol)}</a>` : ""}${o.reportDate ? ` · reports ${esc(o.reportDate)}` : ""}${o.internalOnly ? ` · <span class="badge badge-warn">Internal research only</span>` : ""}${o.kind === "weekly_memo" ? ` · ${o.approved ? `<span class="badge badge-owned">Approved</span>` : `<span class="badge badge-watch">Draft, waiting for an editor</span>`}` : ""}</p>
      <h3>${esc(o.title)}</h3></div></header>
    <p>${esc(o.summary)}</p>
    ${(o.sections || []).map((sec) => `<section><p class="pf-sub">${esc(sec.heading)}</p><ul class="small">${sec.items.map((i) => `<li>${i.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(i.symbol)}">${esc(i.symbol)}</a> ` : ""}${esc(i.text)} ${srcLink(i.source_url)}${i.sourced ? "" : ` <span class="badge badge-warn">source not read</span>`}</li>`).join("")}</ul></section>`).join("")}
    ${dataQa && o.mismatches?.length ? `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Mismatches between SEC filings and Yahoo</caption>
      <thead><tr><th scope="col" class="left">Ticker</th><th scope="col" class="left">Field</th><th scope="col" class="num">As filed (SEC)</th><th scope="col" class="num">Shown (Yahoo)</th><th scope="col" class="num">Gap</th><th scope="col" class="left">Likely cause</th></tr></thead>
      <tbody>${o.mismatches.map((m) => `<tr><th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(m.symbol)}">${esc(m.symbol)}</a></th><td class="left">${esc(m.field)}</td><td class="num">${Number(m.filed).toLocaleString()}</td><td class="num">${Number(m.shown).toLocaleString()}</td><td class="num">${m.diffPct}%</td><td class="left small">${esc(m.likelyCause)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${o.unbackedNumbers?.length ? `<p class="notice small">Check these numbers, no source backs them: ${o.unbackedNumbers.map(esc).join(", ")}</p>` : ""}
    <footer class="agent-brief-foot"><span class="muted small">${dataQa ? "Computed by code from SEC and Yahoo data, no AI." : "AI-written research aid, not advice."} <a href="#/agents/runs/${runId}">How it was made</a></span>${feedbackButtons(runId, fb)}</footer>
  </article>`;
}

export function outputCard(o, runId, fb) {
  if (!o) return "";
  if (o.headline) return briefCard(o, { runId, feedback: fb });
  if (o.kind === "ask_pif") return answerCard(o, runId, { feedback: fb });
  if (o.sections || o.kind === "data_qa") return reportCard(o, runId, fb);
  return "";
}

export function runsTable(runs) {
  if (!runs.length) return emptyState({ icon: "inbox", title: "No AI runs yet", body: "Runs show up here as agents work and members use AI features." });
  return `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Agent and AI runs, newest first</caption>
    <thead><tr><th scope="col" class="left">When</th><th scope="col" class="left">What</th><th scope="col" class="left">Ticker</th><th scope="col" class="left">Status</th><th scope="col" class="left">Model</th><th scope="col" class="num">Cost</th></tr></thead>
    <tbody>${runs.map((r) => `<tr>
      <td class="left small">${esc((r.createdAt || "").slice(0, 16))}</td>
      <th scope="row" class="left"><a href="#/agents/runs/${r.id}">${esc(workflowLabel(r.workflow))}</a></th>
      <td class="left">${r.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a>` : "—"}</td>
      <td class="left"><span class="badge ${STATUS[r.status] || ""}">${esc(r.status)}</span>${r.error ? ` <span class="muted small">${esc(r.error.slice(0, 80))}</span>` : ""}</td>
      <td class="left small">${esc(r.model || "—")}</td>
      <td class="num">${money(r.costUsd)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function eventsTable(events) {
  if (!events.length) return emptyState({ icon: "inbox", title: "No events yet", body: "New filings on holdings appear here within about 10 minutes of hitting EDGAR." });
  const TIER = { push: "badge-danger", inbox: "badge-watch", digest: "", ignore: "" };
  return `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Events the agents saw, newest first</caption>
    <thead><tr><th scope="col" class="left">Filed</th><th scope="col" class="left">Event</th><th scope="col" class="left">Tier</th><th scope="col" class="left">Agent</th><th scope="col" class="left">Status</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td class="left small">${esc(e.asOf || e.createdAt.slice(0, 10))}</td>
      <th scope="row" class="left">${e.sourceUrl ? `<a href="${safeUrl(e.sourceUrl)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</th>
      <td class="left"><span class="badge ${TIER[e.tier] || ""}">${esc(e.tier)}</span></td>
      <td class="left small">${e.workflow ? esc(workflowLabel(e.workflow)) : "—"}</td>
      <td class="left small">${esc(e.status)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function proposalsList(list) {
  if (!list.length) return emptyState({ icon: "check", title: "Nothing waiting for approval", body: "When an agent suggests a change, like a thesis pillar status, it waits here for a member to approve it." });
  return `<ul class="agent-proposals">${list.map((p) => `<li class="panel">
    <p class="muted small">${esc(p.kindLabel)}${p.symbol ? ` · <a class="symbol-cell" href="#/research/${encodeURIComponent(p.symbol)}">${esc(p.symbol)}</a>` : ""} · ${esc(p.createdAt.slice(0, 16))}${p.runId ? ` · <a href="#/agents/runs/${p.runId}">Evidence</a>` : ""}</p>
    <p><strong>${esc(p.title)}</strong></p>
    ${p.payload?.evidence ? `<blockquote class="small">${esc(p.payload.evidence)}</blockquote>` : ""}
    <div class="row-actions"><button type="button" class="btn btn-primary btn-sm" data-decide="${p.id}" data-approve="1">Approve</button><button type="button" class="btn btn-ghost btn-sm" data-decide="${p.id}" data-approve="0">Reject</button></div>
  </li>`).join("")}</ul>`;
}

async function mountRun(container, id) {
  container.innerHTML = pageHead("Agent run") + `<div class="page-pad" id="runBody">${skeleton("text", { rows: 6 })}</div>`;
  const body = container.querySelector("#runBody");
  let r;
  try { r = await api(`/api/agents/runs/${encodeURIComponent(id)}`); } catch (err) { body.innerHTML = errorState({ title: "Couldn't load this run.", detail: err.message }); return; }
  const out = r.output;
  container.innerHTML = pageHead(`${esc(workflowLabel(r.workflow))}${r.symbol ? ` · ${esc(r.symbol)}` : ""}`, `Run #${r.id}, ${esc(r.createdAt)} UTC. <a href="#/agents/activity">All runs</a>`) + `<div class="page-pad agent-run">
    <dl class="panel agent-facts">
      <dt>Status</dt><dd><span class="badge ${STATUS[r.status] || ""}">${esc(r.status)}</span>${r.error ? ` ${esc(r.error)}` : ""}</dd>
      <dt>Model</dt><dd>${esc(r.model || "—")}</dd>
      <dt>Tokens</dt><dd>${(r.inputTokens || 0).toLocaleString()} in, ${(r.outputTokens || 0).toLocaleString()} out</dd>
      <dt>Cost</dt><dd>${money(r.costUsd)}</dd>
      ${r.event ? `<dt>Triggered by</dt><dd>${r.event.sourceUrl ? `<a href="${safeUrl(r.event.sourceUrl)}" target="_blank" rel="noopener">${esc(r.event.title)}</a>` : esc(r.event.title)}</dd>` : ""}
    </dl>
    <div id="runOutput">${outputCard(out, r.id, r.feedback)}</div>
    <section class="panel"><h3>Steps</h3>
      <ol class="agent-steps">${(r.steps || []).map((s) => `<li><span class="muted small">${esc(s.at.slice(11, 19))}</span> <strong>${esc(s.kind)}</strong> ${
        s.kind === "tool" ? `${esc(s.name)} ${s.args ? `<code>${esc(JSON.stringify(s.args)).slice(0, 200)}</code>` : ""} ${s.ok ? "" : `<span class="badge badge-danger">${esc(s.error || "error")}</span>`}${s.source_url ? ` <a href="${s.source_url.startsWith("#") ? esc(s.source_url) : safeUrl(s.source_url)}">source</a>` : ""}`
        : s.kind === "model" ? `${esc(s.model || "")} · ${s.input || 0} in / ${s.output || 0} out${s.toolCalls?.length ? ` · asked for ${s.toolCalls.map(esc).join(", ")}` : ""}`
        : s.kind === "source" ? `read <a href="${safeUrl(s.url)}" target="_blank" rel="noopener">the filing</a> (${(s.chars || 0).toLocaleString()} characters${s.truncated ? ", cut to fit" : ""})`
        : esc(JSON.stringify(s).slice(0, 200))}</li>`).join("") || "<li class=\"muted\">No steps recorded.</li>"}</ol>
    </section>
    ${out && !outputCard(out, r.id) ? `<details class="small"><summary>Raw output</summary><pre class="agent-raw">${esc(JSON.stringify(out, null, 2))}</pre></details>` : ""}
  </div>`;
  bindFeedback(container);
  window.dispatchEvent(new CustomEvent("pif:agent-run", { detail: { container, run: r } }));
}

// ---- The Agents hub shell (WS11) ----
// A thin shell over the tab registry (public/views/agents/index.js): each tab is its own module
// (home, ask, briefs, desk, approvals, activity, events, plus any other workstream's tab). Links
// to other agent-section pages (Feed, Theses, Cockpit) show once their route is registered.

const SECTION_LINKS = [["feed", "#/feed", "Feed", 15], ["theses", "#/theses", "Theses", 45], ["cockpit", "#/cockpit", "Cockpit", 95]];
let sectionLinksCache = null;
async function registeredSectionLinks() {
  if (sectionLinksCache) return sectionLinksCache;
  const firsts = new Set();
  try {
    const { ROUTE_FILES } = await import("../routes.d/index.js");
    const mods = await Promise.allSettled(ROUTE_FILES.map((f) => import(`../routes.d/${f}`)));
    for (const m of mods) if (m.status === "fulfilled") for (const e of [].concat(m.value.default || [])) firsts.add(String(e?.pattern || "").split("/").filter(Boolean)[0]);
  } catch { /* no registry */ }
  return (sectionLinksCache = SECTION_LINKS.filter(([k]) => firsts.has(k)));
}

// "#/agents/ask?thread=3" arrives as tab "ask?thread=3".
function splitTab(raw = "") {
  const [key, qs = ""] = String(raw).split("?");
  return { key, query: new URLSearchParams(qs) };
}

export async function mount(container, params = {}) {
  if (!can("ai")) {
    container.innerHTML = pageHead("Agents") + `<div class="toolbar">${lockedHint("Sign in to use the research agents.", "ai")}</div>`;
    return;
  }
  if (params.id) return mountRun(container, params.id);
  const { key: wanted, query } = splitTab(params.tab);
  const [{ loadTabs }, links] = await Promise.all([import("./agents/index.js"), registeredSectionLinks()]);
  const tabs = await loadTabs();
  // "#/agents/new" opens the builder tab when it's there (WS3).
  const alias = wanted === "new" ? tabs.find((t) => ["build", "builder"].includes(t.key)) : null;
  const tab = alias || tabs.find((t) => t.key === wanted) || tabs.find((t) => t.key === "home") || tabs[0];
  if (!tab) { container.innerHTML = pageHead("Agents") + errorState({ title: "Couldn't load the agents page." }); return; }
  const nav = [...tabs.map((t) => [t.key, t.key === "home" ? "#/agents" : `#/agents/${t.key}`, esc(t.label), t.order ?? 100]),
    ...links.map(([k, href, label, order]) => [k, href, label, order])].sort((a, b) => a[3] - b[3]);
  container.innerHTML = pageHead("Agents", "Your fund's research agents and the team's: what they found, what is running, what needs you. Every source is shown, every run and its cost is logged, and nothing changes in the app without a member's approval.",
    `<button type="button" class="btn btn-ghost btn-sm ask-open" data-ask-open>${icon("sparkle", { size: 16 })}<span>Ask PIF</span></button>`)
    + `<div class="page-pad agents-top" id="agentTop"></div>${tabNav(nav.map(([k, h, l]) => [k, h, l]), tab.key, "Agent sections")}<div class="page-pad agents-tab agents-tab-${esc(tab.key)}" id="agentBody">${skeleton("cards", { rows: 3 })}</div>`;
  const top = container.querySelector("#agentTop"), body = container.querySelector("#agentBody");
  let overview = null;
  const loadOverview = async () => {
    overview = await api("/api/agents/overview");
    top.innerHTML = tab.key === "home" || tab.key === "activity" ? budgetBar(overview.budget) + (overview.aiConfigured ? "" : `<p class="notice small">AI is off on the server (no OpenAI key is set), so agents record events but don't run.</p>`) : (overview.aiConfigured ? "" : `<p class="notice small">AI is off on the server (no OpenAI key is set), so agents record events but don't run.</p>`);
    return overview;
  };
  const ctx = {
    container, params, query, tab: tab.key,
    overview: () => overview ? Promise.resolve(overview) : loadOverview(),
    reload: () => { overview = null; return render(); },
  };
  async function render() {
    try { await tab.render(body, ctx); }
    catch (err) { body.innerHTML = errorState({ title: `Couldn't load ${tab.label}.`, detail: err.message, retryId: "agents" }); bindRetry(body, "agents", render); }
  }
  ctx.overview().catch(() => {});
  await render();
  bindFeedback(body);
}
