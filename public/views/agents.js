// Research agents: briefs, the approval queue, every run with its cost, and the event feed the
// rules router saw. Members with AI access only (an admin grants it in Settings).
import { esc, api, can, pageHead, lockedHint, skeleton, emptyState, errorState, bindRetry, tabNav, toast, safeUrl, fmtUSD } from "../shared.js";

export const title = "Research agents";

const TABS = [["briefs", "#/agents", "Briefs &amp; reports"], ["ask", "#/agents/ask", "Ask PIF"], ["approvals", "#/agents/approvals", "Approvals"], ["activity", "#/agents/activity", "Activity"], ["events", "#/agents/events", "Events"]];
const WORKFLOW_LABEL = {
  filing_flash: "Filing flash", earnings_flash: "Earnings flash", ask_pif: "Ask PIF", red_team: "Red team", pitch_primer: "Pitch primer",
  earnings_preview: "Earnings preview", thesis_check: "Thesis check", weekly_memo: "Weekly memo", data_qa: "Data check", macro_brief: "Macro brief",
  ownership_watch: "Ownership watch", policy_watch: "Policy watch", filing_brief: "Filing brief (Research)", filing_change_brief: "Change brief (Research)",
  news_triage: "News triage", today_recap: "Today recap", app: "Other AI",
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
    ${b.points?.length ? `<ul class="agent-points">${b.points.map((p) => `<li><p>${esc(p.text)}</p><blockquote>“${esc(p.quote)}” ${verifiedBadge(p.verified)}</blockquote></li>`).join("")}</ul>` : ""}
    ${b.kpis?.length ? `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Reported figures</caption><thead><tr><th scope="col" class="left">Figure</th><th scope="col" class="num">As filed</th><th scope="col" class="left">Check</th></tr></thead>
      <tbody>${b.kpis.map((k) => `<tr><th scope="row" class="left">${esc(k.name)}</th><td class="num">${esc(k.value)}</td><td class="left">${verifiedBadge(k.verified)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${b.questions?.length ? `<p class="pf-sub">Look into next</p><ul class="small">${b.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
    ${b.unbackedNumbers?.length ? `<p class="notice small">These numbers in the text don't match the filing or the app's data, so check them: ${b.unbackedNumbers.map(esc).join(", ")}</p>` : ""}
    ${b.sourceTruncated ? `<p class="muted small">The filing was long, so only its first part was read.</p>` : ""}
    <footer class="agent-brief-foot">
      <span class="muted small">AI-written research aid, not advice. <a href="#/agents/runs/${runId}">How it was made</a></span>
      ${feedbackButtons(runId, fb)}
    </footer>
  </article>`;
}

export function feedbackButtons(runId, fb = {}) {
  const btn = (v, label) => `<button type="button" class="btn btn-ghost btn-sm" data-feedback="${v}" data-run="${runId}" aria-pressed="${fb.mine === v}">${label}${fb[v] ? ` <span class="muted">${fb[v]}</span>` : ""}</button>`;
  return `<span class="agent-feedback" role="group" aria-label="Was this useful?">${btn("useful", "Useful")}${btn("not_useful", "Not useful")}${btn("wrong", "Wrong")}</span>`;
}

export function bindFeedback(container) {
  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-feedback]");
    if (!b) return;
    const verdict = b.dataset.feedback;
    try {
      const fb = await api(`/api/agents/runs/${b.dataset.run}/feedback`, { method: "POST", body: JSON.stringify({ verdict }) });
      b.closest(".agent-feedback").outerHTML = feedbackButtons(b.dataset.run, fb);
      toast("Thanks, noted.", { type: "success" });
    } catch (err) { toast(err.message, { type: "error" }); }
  });
}

const srcLink = (u) => (!u ? "" : u.startsWith("#") ? `<a href="${esc(u)}">${esc(u.replace(/^#\//, ""))}</a>` : `<a href="${safeUrl(u)}" target="_blank" rel="noopener">sec.gov</a>`);

export function answerCard(o, runId) {
  return `<article class="panel agent-answer">
    <p class="muted small">You asked: ${esc(o.question)}</p>
    <div>${o.answer.split(/\n{2,}/).map((para) => /^\s*- /m.test(para) ? `<ul>${para.split(/\n/).filter(Boolean).map((l) => `<li>${esc(l.replace(/^\s*- /, ""))}</li>`).join("")}</ul>` : `<p>${esc(para)}</p>`).join("")}</div>
    ${o.claims?.length ? `<details><summary class="small">Sources (${o.claims.length})</summary><ul class="small">${o.claims.map((c) => `<li>${esc(c.text)} ${srcLink(c.source_url)}${c.sourced ? "" : ` <span class="badge badge-warn">source not read</span>`}${c.quote ? `<blockquote>“${esc(c.quote)}” ${c.verified ? `<span class="badge badge-owned">Verified quote</span>` : `<span class="badge badge-warn">Quote not found</span>`}</blockquote>` : ""}</li>`).join("")}</ul></details>` : ""}
    ${o.unbackedNumbers?.length ? `<p class="notice small">Check these numbers, no tool result backs them: ${o.unbackedNumbers.map(esc).join(", ")}</p>` : ""}
    <p class="agent-tools">Looked at: ${o.toolsUsed?.length ? o.toolsUsed.map((t) => esc(t.name.replace(/^get_/, "").replace(/_/g, " ")) + (t.args?.symbol ? ` ${esc(t.args.symbol)}` : "")).join(", ") : "nothing"}</p>
    ${o.followUps?.length ? `<p class="small muted">Try next: ${o.followUps.map(esc).join(" · ")}</p>` : ""}
    <footer class="agent-brief-foot"><span class="muted small">AI-written research aid, not advice. <a href="#/agents/runs/${runId}">How it was made</a></span>${feedbackButtons(runId)}</footer>
  </article>`;
}

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
  if (o.kind === "ask_pif") return answerCard(o, runId);
  if (o.sections || o.kind === "data_qa") return reportCard(o, runId, fb);
  return "";
}

function runsTable(runs) {
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

function eventsTable(events) {
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

function proposalsList(list) {
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

export async function mount(container, params = {}) {
  if (!can("ai")) {
    container.innerHTML = pageHead("Research agents") + `<div class="toolbar">${lockedHint("Sign in to use the research agents.", "ai")}</div>`;
    return;
  }
  if (params.id) return mountRun(container, params.id);
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : "briefs";
  container.innerHTML = pageHead("Research agents", "Agents read new filings on holdings and write cited briefs. Every quote is checked against the filing, every run and its cost is logged, and nothing changes in the app without a member's approval.")
    + `<div class="page-pad" id="agentTop">${skeleton("text", { rows: 2 })}</div>${tabNav(TABS, tab, "Agent sections")}<div class="page-pad" id="agentBody">${skeleton("cards", { rows: 3 })}</div>`;
  const top = container.querySelector("#agentTop"), body = container.querySelector("#agentBody");
  const load = async () => {
    let o;
    try { o = await api("/api/agents/overview"); } catch (err) { body.innerHTML = errorState({ title: "Couldn't load the agents.", detail: err.message, retryId: "agents" }); bindRetry(body, "agents", load); return; }
    top.innerHTML = budgetBar(o.budget) + (o.aiConfigured ? "" : `<p class="notice small">AI is off on the server (no OpenAI key is set), so agents record events but don't run.</p>`)
      + (o.pendingProposals ? `<p class="small"><a href="#/agents/approvals">${o.pendingProposals} change${o.pendingProposals === 1 ? "" : "s"} waiting for approval</a></p>` : "");
    if (tab === "activity") {
      const spend = o.monthByFeature.length ? `<p class="pf-sub">This month by feature</p><ul class="chip-list">${o.monthByFeature.map((f) => `<li class="chip">${esc(workflowLabel(f.workflow))}: ${f.runs} run${f.runs === 1 ? "" : "s"}, ${money(f.costUsd)}</li>`).join("")}</ul>` : "";
      const acc = o.acceptance.length ? `<p class="pf-sub">Member verdicts</p><ul class="chip-list">${o.acceptance.map((a) => `<li class="chip">${esc(workflowLabel(a.workflow))}: ${a.useful} useful, ${a.notUseful} not useful, ${a.wrong} wrong</li>`).join("")}</ul>` : "";
      body.innerHTML = spend + acc + runsTable(o.runs);
    } else if (tab === "events") {
      body.innerHTML = `<p class="muted small">Plain rules, no AI, decide what each filing deserves: <strong>push</strong> (bankruptcy, impairment, restatement and similar), <strong>inbox</strong> (results, executive changes, material agreements) or <strong>digest</strong> (routine).</p>` + eventsTable(o.events);
    } else if (tab === "ask") {
      body.innerHTML = `<form class="agent-ask" id="askForm"><label class="field-block" style="flex:1 1 320px">Ask about the fund, a holding or any ticker
          <textarea name="q" maxlength="1000" placeholder="e.g. Which holdings have the most insider selling this quarter? What did MU say about guidance in its last 10-Q?"></textarea></label>
        <button class="btn btn-primary">Ask</button></form>
        <p class="muted small">Answers come only from the app's data and SEC filings, with the sources and every tool call shown. Each question costs a few cents from your daily AI budget.</p>
        <div id="askOut"></div><div id="askHistory"></div>`;
      const hist = await api("/api/agents/asks");
      container.querySelector("#askHistory").innerHTML = hist.asks.length ? `<p class="pf-sub">Your recent questions</p>${hist.asks.map((a) => a.output ? answerCard(a.output, a.runId) : `<p class="muted small">${esc(a.createdAt)}: ${esc(a.error || a.status)}</p>`).join("")}` : "";
      container.querySelector("#askForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const q = e.target.q.value.trim();
        if (!q) return;
        const out = container.querySelector("#askOut"), btn = e.target.querySelector("button");
        btn.disabled = true;
        out.innerHTML = `<p class="muted small" role="status">Looking it up in the app's data…</p>`;
        try { const r = await api("/api/agents/ask", { method: "POST", body: JSON.stringify({ question: q }) }); out.innerHTML = answerCard(r.output, r.runId); e.target.q.value = ""; }
        catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
        finally { btn.disabled = false; }
      });
    } else if (tab === "approvals") {
      const r = await api("/api/agents/proposals");
      body.innerHTML = proposalsList(r.proposals);
    } else {
      const r = await api("/api/agents/briefs");
      body.innerHTML = r.briefs.length ? r.briefs.map((x) => outputCard(x.brief, x.runId, x.feedback)).join("")
        : emptyState({ icon: "doc", title: "No briefs yet", body: "When a holding files an 8-K, 10-Q or 10-K, a brief appears here. You can also brief any filing from a stock's Research → Filings tab." });
    }
  };
  await load();
  bindFeedback(body);
  body.addEventListener("click", async (e) => {
    const d = e.target.closest("[data-decide]");
    if (!d) return;
    d.disabled = true;
    try {
      await api(`/api/agents/proposals/${d.dataset.decide}/decide`, { method: "POST", body: JSON.stringify({ approve: d.dataset.approve === "1" }) });
      toast(d.dataset.approve === "1" ? "Approved and applied." : "Rejected.", { type: "success" });
      load();
    } catch (err) { d.disabled = false; toast(err.message, { type: "error" }); }
  });
}
