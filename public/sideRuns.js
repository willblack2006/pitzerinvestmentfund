// "Working now" in the sidebar: every agent run in progress, with a live dot and how long it has
// been going. Updates only when the server says a run started or finished (run_started /
// run_finished on /api/events), never by polling. The once-a-second tick only redraws the timers.
import { el, esc, api } from "./shared.js";

let box = null, runs = [], ticker = null, on = false;

const started = (r) => Date.parse(String(r.createdAt).replace(" ", "T") + "Z");
const elapsed = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 3600)}h`;
};

function draw() {
  if (!box) return;
  if (runs.length > 1) box.dataset.more = runs.length - 1; else delete box.dataset.more;
  if (!runs.length) { box.innerHTML = ""; stopTicker(); return; }
  box.innerHTML = `<div class="side-runs-label">Working now</div>` + runs.map((r) => {
    const name = r.agent?.name || String(r.workflow || "Agent").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    return `<a class="side-run" href="#/agents/runs/${Number(r.runId)}" title="${esc(name)}${r.symbol ? ` on ${esc(r.symbol)}` : ""}">
      <span class="status-dot is-running" aria-hidden="true"></span>
      <span class="side-run-name">${esc(name)}${r.symbol ? ` · ${esc(r.symbol)}` : ""}</span>
      <span class="side-run-time" data-t="${started(r)}">${elapsed(Date.now() - started(r))}</span></a>`;
  }).join("");
  if (!ticker) ticker = setInterval(() => box?.querySelectorAll("[data-t]").forEach((t) => { t.textContent = elapsed(Date.now() - Number(t.dataset.t)); }), 1000);
}
function stopTicker() { clearInterval(ticker); ticker = null; }

async function load() {
  if (!on) return;
  try { runs = (await api("/api/feed/running")).running || []; } catch { runs = []; }
  draw();
}

// Called whenever the signed-in member changes. Only members with AI access see runs.
export function setSideRunsMember(m) {
  box = box || el("sideRuns");
  on = !!(m && (m.canUseAi || m.isAdmin));
  if (on) load(); else { runs = []; draw(); }
}

window.addEventListener("pif:live", (e) => {
  const t = e.detail?.type;
  if (!on) return;
  if (t === "run_finished") { runs = runs.filter((r) => r.runId !== e.detail.data?.runId); draw(); }
  else if (t === "run_started" || t === "hello") load();
});
