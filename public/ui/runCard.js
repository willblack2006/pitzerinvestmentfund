// One agent run as a card (WS11): who ran it, status, live steps and answer text while it works,
// cost, feedback, share and "Why?" (the run's trace). Plus watchRun(), the client side of
// GET /api/agents/runs/:id/stream, with a polling fallback.
import { esc, api, icon, fmtUSD } from "../shared.js";
import { progressLines, toolLabel } from "../aiFormat.js";
import { agentChip } from "./agentChip.js";

const STATUS = { done: ["Done", "badge-owned"], failed: ["Failed", "badge-danger"], refused: ["Over budget", "badge-warn"], running: ["Running", "badge-watch"] };
const money = (v) => (v == null ? "" : v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : fmtUSD(v));

export function ago(utc) {
  const s = String(utc || "");
  const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 36 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Steps as a short live list: the last few, newest at the bottom, the current one pulsing.
export function liveSteps(steps = [], { show = 3, now = "" } = {}) {
  const lines = progressLines(steps);
  const hidden = Math.max(0, lines.length - show);
  return `<ol class="run-steps">${hidden ? `<li class="is-earlier">${hidden} earlier step${hidden === 1 ? "" : "s"}</li>` : ""}${lines.slice(-show).map((l) => `<li class="${l.bad ? "is-bad" : "is-done"}">${icon(l.bad ? "x" : "check", { size: 12 })}<span>${esc(l.text)}</span></li>`).join("")}${now ? `<li class="is-now"><span class="agent-pulse" aria-hidden="true"></span><span>${esc(now)}</span></li>` : ""}</ol>`;
}

export function nowLine(steps = []) {
  const last = steps[steps.length - 1];
  if (!last) return "Starting…";
  if (last.kind === "model" && last.toolCalls?.length) return `Looking up ${last.toolCalls.slice(0, 3).map((n) => toolLabel(n)).join(", ")}…`;
  if (last.kind === "tool" || last.kind === "source") return "Reading what it found…";
  if (last.kind === "review") return "Re-checking its numbers…";
  if (last.kind === "escalate") return "Taking a closer look…";
  return "Writing…";
}

// run: { id, workflow, label, agent: {slug,name,icon,kind}, status, symbol, costUsd, createdAt,
//        summary, steps, text, error, shared }
// opts: { body: html for the finished output, feedback: html, share: bool, compact, member: name }
export function runCard(run = {}, { body = "", feedback = "", share = false, compact = false, member = null } = {}) {
  const [label, tone] = STATUS[run.status] || [run.status || "", ""];
  const running = run.status === "running";
  const who = run.agent ? agentChip({ ...run.agent, running }, { compact: true }) : `<span class="agent-chip-name">${esc(run.label || run.workflow || "Agent run")}</span>`;
  const live = running ? `<div class="run-live" aria-live="polite">${liveSteps(run.steps || [], { now: nowLine(run.steps || []) })}${run.text ? `<div class="run-text agent-answer-text is-streaming">${esc(run.text)}</div>` : ""}</div>` : "";
  const out = !running ? (body || (run.summary ? `<p class="run-summary">${esc(run.summary)}</p>` : "")) : "";
  return `<article class="panel run-card${compact ? " is-compact" : ""}${running ? " is-running" : ""}" data-run-card="${Number(run.id) || ""}">
    <header class="run-head">
      ${who}
      <span class="run-meta small muted">${run.label && run.agent ? `${esc(run.label)} · ` : ""}${run.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(run.symbol)}">${esc(run.symbol)}</a> · ` : ""}${member ? `for ${esc(member)} · ` : ""}<time datetime="${esc(run.createdAt || "")}">${esc(ago(run.createdAt))}</time></span>
      ${label ? `<span class="badge ${tone} run-status">${esc(label)}</span>` : ""}
    </header>
    ${live}${out}
    ${run.error && !running ? `<p class="error small">${esc(String(run.error).slice(0, 300))}</p>` : ""}
    <footer class="run-foot">
      <span class="muted small">${run.costUsd != null ? `${money(run.costUsd)} · ` : ""}<a href="#/agents/runs/${Number(run.id)}">Why?</a>${share && !running ? ` · <button type="button" class="btn-link small" data-share-run="${Number(run.id)}" aria-pressed="${!!run.shared}">${run.shared ? "Shared" : "Share"}</button>` : ""}</span>
      ${feedback}
    </footer>
  </article>`;
}

// Follows a run live. Handlers: onStep(step, steps), onText(fullText), onTurn(), onDone(output, ev),
// onError(message, ev). Returns stop(). Uses SSE; falls back to polling the run if SSE fails.
export function watchRun(runId, h = {}) {
  let steps = [], text = "", stopped = false, es = null, timer = null, got = false;
  const finish = () => { stopped = true; es?.close(); clearTimeout(timer); };
  const handle = (e) => {
    got = true;
    if (e.type === "step") { steps = [...steps, e.step]; h.onStep?.(e.step, steps); }
    else if (e.type === "turn") { text = ""; h.onTurn?.(e); }
    else if (e.type === "text") { text += e.delta; h.onText?.(text); }
    else if (e.type === "text_snapshot") { text = e.text || ""; h.onText?.(text); }
    else if (e.type === "done") { finish(); h.onDone?.(e.output, e); }
    else if (e.type === "error") { finish(); h.onError?.(e.error || "The run failed.", e); }
  };
  const poll = async () => {
    if (stopped) return;
    try {
      const r = await api(`/api/agents/runs/${Number(runId)}`);
      if ((r.steps || []).length !== steps.length) { steps = r.steps || []; h.onStep?.(steps[steps.length - 1], steps); }
      if (r.status === "done") { finish(); h.onDone?.(r.output, { type: "done", costUsd: r.costUsd }); return; }
      if (r.status !== "running") { finish(); h.onError?.(r.error || r.status, { type: "error", status: r.status }); return; }
    } catch { /* try again */ }
    timer = setTimeout(poll, 1500);
  };
  if (typeof EventSource === "function") {
    es = new EventSource(`/api/agents/runs/${Number(runId)}/stream`);
    es.addEventListener("run", (m) => { try { handle(JSON.parse(m.data)); } catch { /* bad event */ } });
    // The server closes the stream after done/error; any other drop: poll instead of reconnecting.
    es.onerror = () => { if (stopped) return; es.close(); timer = setTimeout(poll, got ? 300 : 0); };
  } else poll();
  return finish;
}

// Shows run `runId` in `el` as a live run card: steps and answer text while it works, then the
// finished card. `body(output)` may return html for the finished output. Returns stop().
export function mountRunCard(el, runId, { body = null, compact = false, label = null } = {}) {
  const run = { id: Number(runId), status: "running", steps: [], text: "", label };
  const paint = () => { if (el.isConnected) el.innerHTML = runCard(run, { compact, body: run.status === "done" && body ? body(run.output) : "" }); };
  paint();
  api(`/api/agents/runs/${Number(runId)}`).then((r) => {
    Object.assign(run, { workflow: r.workflow, symbol: r.symbol, createdAt: r.createdAt, costUsd: r.costUsd, label: label || r.workflow });
    if (r.status !== "running") Object.assign(run, { status: r.status, output: r.output, error: r.error, summary: r.summary || r.output?.answer || r.output?.headline || r.output?.summary || null });
    paint();
  }).catch(() => {});
  return watchRun(runId, {
    onStep: (s, steps) => { run.steps = steps; paint(); },
    onText: (t) => { run.text = t; paint(); },
    onDone: (output, ev) => { Object.assign(run, { status: "done", output, text: "", costUsd: ev?.costUsd ?? run.costUsd, summary: output?.answer || output?.headline || output?.summary || output?.title || (typeof output === "string" ? output : null) }); paint(); },
    onError: (msg, ev) => { Object.assign(run, { status: ev?.status || "failed", error: msg }); paint(); },
  });
}
