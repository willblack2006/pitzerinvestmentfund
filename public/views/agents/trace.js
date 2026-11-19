// Run trace (plan WS8): what one agent run did, step by step, with time, tokens and cost.
// Route #/agents/runs/:id. A waterfall of model turns, tool calls, memory reads and writes,
// handoffs and child runs; each row opens to show the exact input and a preview of the output.
import { esc, api, can, pageHead, lockedHint, skeleton, errorState, safeUrl, fmtUSD } from "../../shared.js";
import { bindFeedback, feedbackButtons, localTime } from "../../ai.js";
import { toolLabel } from "../../aiFormat.js";
import { reasonChips } from "../../feedbackReasons.js";
import { ensureCss } from "./cssLoader.js";

export const title = "Agent run";

const STATUS = { done: "badge-owned", failed: "badge-danger", refused: "badge-warn", running: "badge-watch" };
const KIND = { model: "Model", tool: "Tool", source: "Source", review: "Check", memory_read: "Memory", memory_write: "Memory", handoff: "Handoff", rule: "Rule", child: "Sub-run" };
const kindClass = (k) => (k === "model" ? "is-model" : k === "tool" || k === "source" ? "is-tool" : "is-other");

export const money = (v) => (v == null ? "—" : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : fmtUSD(v));
export const dur = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`);
const num = (n) => (n || 0).toLocaleString("en-US");

function workflowName(w) {
  return String(w || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function argsText(a) {
  if (a == null) return "";
  try { return JSON.stringify(a, null, 2); } catch { return String(a); }
}
function previewText(p) {
  if (!p) return "";
  try { return JSON.stringify(JSON.parse(p), null, 2); } catch { return String(p); }
}
const link = (u, text) => (u ? (u.startsWith("#") ? `<a href="${esc(u)}">${esc(text)}</a>` : `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(text)}<span class="sr-only"> (opens in a new tab)</span></a>`) : "");

function spanTitle(s) {
  if (s.kind === "tool") return toolLabel(s.name, s.args || {});
  return s.label || KIND[s.kind] || s.kind;
}

function spanMeta(s) {
  if (s.kind === "model") return `${num(s.tokens.input)} in${s.tokens.cached ? ` (${num(s.tokens.cached)} cached)` : ""} · ${num(s.tokens.output)} out`;
  if (s.kind === "tool") return s.ok ? (s.fromCache ? "from cache" : "") : "error";
  if (s.kind === "source") return `${num(s.chars)} chars${s.truncated ? ", cut to fit" : ""}`;
  return "";
}

function spanDetail(s) {
  const parts = [];
  if (s.kind === "model") {
    parts.push(`<dl class="trace-kv"><dt>Model</dt><dd>${esc(s.model || "—")}${s.tier ? ` <span class="muted">(${esc(s.tier)} tier)</span>` : ""}</dd>
      <dt>Tokens</dt><dd>${num(s.tokens.input)} in, ${num(s.tokens.cached)} of them cached, ${num(s.tokens.output)} out</dd>
      <dt>Cost</dt><dd>${money(s.costUsd)}${s.estimated ? ` <span class="muted">(time estimated: older run)</span>` : ""}</dd>
      ${s.toolCalls?.length ? `<dt>Asked for</dt><dd>${s.toolCalls.map((n) => esc(toolLabel(n))).join(", ")}</dd>` : ""}
      ${s.webSearches?.length ? `<dt>Web searches</dt><dd>${s.webSearches.map(esc).join("; ")}</dd>` : ""}
      ${s.incomplete ? `<dt>Note</dt><dd>Cut off (${esc(s.incomplete)}), retried with more room</dd>` : ""}</dl>`);
  } else if (s.kind === "tool") {
    parts.push(`<dl class="trace-kv"><dt>Tool</dt><dd><code>${esc(s.name)}</code></dd>
      ${s.asOf ? `<dt>Data as of</dt><dd>${esc(String(s.asOf).slice(0, 16).replace("T", " "))}</dd>` : ""}
      ${s.sourceUrl ? `<dt>Source</dt><dd>${link(s.sourceUrl, s.title || s.sourceUrl)}</dd>` : ""}
      ${s.error ? `<dt>Error</dt><dd class="trace-err">${esc(s.error)}</dd>` : ""}</dl>`);
    if (s.args && Object.keys(s.args).length) parts.push(`<p class="pf-sub">Input</p><pre class="trace-pre">${esc(argsText(s.args))}</pre>`);
    if (s.preview) parts.push(`<p class="pf-sub">Output <span class="muted small">(first part, as the agent saw it)</span></p><pre class="trace-pre">${esc(previewText(s.preview))}</pre>`);
  } else if (s.kind === "source") {
    parts.push(`<p>${link(s.sourceUrl, "Open the source")}</p>`);
  } else if (s.kind === "review") {
    parts.push(`<p class="small">The run's own check sent the draft back to the model with this note:</p><blockquote class="small">${esc(s.note)}</blockquote>`);
  } else {
    if (s.childRunId) parts.push(`<p><a href="#/agents/runs/${encodeURIComponent(s.childRunId)}">Open run #${esc(s.childRunId)}</a></p>`);
    if (s.detail && Object.keys(s.detail).length) parts.push(`<pre class="trace-pre">${esc(argsText(s.detail))}</pre>`);
  }
  return parts.join("") || `<p class="muted small">Nothing else was recorded for this step.</p>`;
}

// The waterfall. Bars are placed on a shared time axis; a bar too short to see gets a minimum
// width so it can still be hovered and opened.
export function waterfall(spans, totalMs, children = []) {
  const total = Math.max(1, totalMs, ...spans.map((s) => s.start + s.ms), ...children.map((c) => c.start + c.ms));
  const pct = (v) => Math.max(0, Math.min(100, (v / total) * 100));
  const rows = [
    ...spans.map((s) => ({ ...s, title: spanTitle(s) })),
    ...children.map((c) => ({ kind: "child", start: c.start, ms: c.ms, title: `Sub-run: ${workflowName(c.workflow)}`, childRunId: c.id, costUsd: c.costUsd, ok: c.status !== "failed", detail: { status: c.status } })),
  ].sort((a, b) => a.start - b.start || (a.i ?? 1e9) - (b.i ?? 1e9));
  if (!rows.length) return `<p class="muted">No steps were recorded for this run.</p>`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${dur(total * f)}</span>`).join("");
  return `<div class="trace-legend" aria-hidden="true"><span class="trace-key is-model"></span>Model turn <span class="trace-key is-tool"></span>Tool or source <span class="trace-key is-other"></span>Check, memory, handoff</div>
  <div class="trace-axis" aria-hidden="true"><span class="trace-axis-label"></span><span class="trace-axis-track">${ticks}</span></div>
  <ol class="trace-rows">${rows.map((s) => {
    const failed = s.ok === false;
    const cost = s.kind === "model" || s.kind === "child" ? money(s.costUsd) : "";
    const tip = `${s.title}: starts at ${dur(s.start)}, takes ${dur(s.ms)}${cost ? `, ${cost}` : ""}${failed ? ", failed" : ""}`;
    return `<li class="trace-row ${failed ? "is-failed" : ""}">
      <details>
        <summary title="${esc(tip)}">
          <span class="trace-label"><span class="trace-kind">${esc(KIND[s.kind] || s.kind)}</span> <span class="trace-name">${esc(s.title)}</span>${failed ? ` <span class="badge badge-danger">failed</span>` : ""}</span>
          <span class="trace-track"><span class="trace-bar ${kindClass(s.kind)}${failed ? " is-failed" : ""}${s.estimated ? " is-estimated" : ""}" style="left:${pct(s.start).toFixed(2)}%;width:max(4px, ${pct(s.ms).toFixed(2)}%)"></span></span>
          <span class="trace-nums"><span>${dur(s.ms)}${s.estimated ? "*" : ""}</span><span>${cost}</span></span>
          <span class="trace-meta muted small">${esc(spanMeta(s))}</span>
        </summary>
        <div class="trace-detail">${s.kind === "child" ? `<p><a href="#/agents/runs/${encodeURIComponent(s.childRunId)}">Open run #${esc(s.childRunId)}</a> · ${esc(s.detail.status)}</p>` : spanDetail(s)}</div>
      </details>
    </li>`;
  }).join("")}</ol>
  ${rows.some((s) => s.estimated) ? `<p class="muted small">* This run was recorded before steps had their own timing, so model turn lengths are estimated from the gaps between steps.</p>` : ""}`;
}

function verificationPanel(v) {
  if (!v) return "";
  const items = [];
  if (v.quotesChecked) items.push(`<li><strong>${v.quotesVerified} of ${v.quotesChecked}</strong> quotes found word for word in their source</li>`);
  if (v.claims) items.push(`<li><strong>${v.claimsSourced} of ${v.claims}</strong> claims point to a source the run actually read</li>`);
  items.push(v.unbackedNumbers.length ? `<li class="trace-warn"><strong>${v.unbackedNumbers.length}</strong> number${v.unbackedNumbers.length === 1 ? "" : "s"} no tool backs: ${v.unbackedNumbers.map(esc).join(", ")}</li>` : `<li>Every number in the text matched a tool result</li>`);
  if (v.revised) items.push(`<li>The self-check sent a draft back for a fix${v.reviewNotes?.length ? `: <span class="muted">${esc(v.reviewNotes[0].slice(0, 160))}</span>` : ""}</li>`);
  return `<section class="panel trace-verify"><h3>Checks</h3><ul class="small">${items.join("")}</ul></section>`;
}

function statTiles(t, run) {
  const tile = (label, value, sub = "") => `<div class="trace-tile"><span class="muted small">${label}</span><strong>${value}</strong>${sub ? `<span class="muted small">${sub}</span>` : ""}</div>`;
  return `<div class="trace-tiles">
    ${tile("Cost", money(t.costUsd), run.model ? esc(run.model) : "")}
    ${tile("Time", dur(t.durationMs), `${dur(t.modelMs)} thinking · ${dur(t.toolMs)} in tools`)}
    ${tile("Tokens", num(t.tokens.input + t.tokens.output), `${num(t.tokens.input)} in · ${num(t.tokens.output)} out`)}
    ${tile("Cache hit", `${Math.round((t.cacheHit || 0) * 100)}%`, "of input tokens, billed at a tenth")}
    ${tile("Steps", `${t.modelTurns} model · ${t.toolCalls} tool`, t.toolErrors ? `${t.toolErrors} tool error${t.toolErrors === 1 ? "" : "s"}` : "no tool errors")}
  </div>`;
}

export async function mount(container, params = {}) {
  ensureCss("/css/trace.css");
  if (!can("ai")) { container.innerHTML = pageHead("Agent run") + `<div class="toolbar">${lockedHint("Sign in to see agent runs.", "ai")}</div>`; return; }
  const id = params.id;
  container.innerHTML = pageHead("Agent run") + `<div class="page-pad">${skeleton("text", { rows: 8 })}</div>`;
  let d;
  try { d = await api(`/api/agents/runs/${encodeURIComponent(id)}/trace`); }
  catch (err) { container.querySelector(".page-pad").innerHTML = errorState({ title: "Couldn't load this run.", detail: err.message }); return; }
  const r = d.run;
  const who = [
    r.agentId ? `<a href="#/agents/stats/a${encodeURIComponent(r.agentId)}">Agent stats</a>` : `<a href="#/agents/stats/w${encodeURIComponent(r.workflow)}">${esc(workflowName(r.workflow))} stats</a>`,
    d.member ? `asked by ${esc(d.member.name)}` : "",
    d.event ? `triggered by ${link(d.event.sourceUrl, d.event.title) || esc(d.event.title)}` : r.trigger ? `trigger: ${esc(r.trigger)}` : "",
    d.parent ? `part of <a href="#/agents/runs/${d.parent.id}">run #${d.parent.id}</a>` : "",
  ].filter(Boolean).join(" · ");
  container.innerHTML = pageHead(`${esc(workflowName(r.workflow))}${r.symbol ? ` · ${esc(r.symbol)}` : ""}`,
    `Run #${esc(r.id)}, ${esc(localTime(r.createdAt))}. <span class="badge ${STATUS[r.status] || ""}">${esc(r.status)}</span> ${who}`,
    `<a class="btn btn-ghost btn-sm" href="#/agents/activity">All runs</a>`) + `<div class="page-pad trace-page">
    ${r.error ? `<p class="notice small">${esc(r.error)}</p>` : ""}
    ${statTiles(d.totals, r)}
    <section class="panel"><h3>What it did</h3>${waterfall(d.spans, d.totals.durationMs, d.children)}</section>
    ${verificationPanel(d.verification)}
    <section class="panel trace-output"><h3>Result</h3><div id="traceOut"><p class="muted small">Loading the result…</p></div>
      <footer class="agent-brief-foot agent-feedback-host"><span class="muted small">Was this run useful?</span>${feedbackButtons(r.id, d.feedback)}${d.feedback.mine ? reasonChips(r.id, d.feedback.mine, d.feedback.myReasons) : ""}</footer>
    </section>
  </div>`;
  bindFeedback(container);
  // The result card comes from the Agents page's renderers (briefs, answers, reports).
  const out = container.querySelector("#traceOut");
  try {
    const { outputCard } = await import("../agents.js");
    const html = r.output ? outputCard(r.output, r.id, d.feedback) : "";
    out.innerHTML = html || (r.output ? `<pre class="trace-pre">${esc(JSON.stringify(r.output, null, 2))}</pre>` : `<p class="muted small">This run has no result${r.status === "failed" ? " because it failed" : ""}.</p>`);
    out.querySelectorAll(".agent-brief-foot .agent-feedback").forEach((x) => x.remove()); // one set of buttons per page
  } catch { out.innerHTML = `<pre class="trace-pre">${esc(JSON.stringify(r.output, null, 2))}</pre>`; }
}
