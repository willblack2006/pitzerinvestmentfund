// Pitch page: the investment committee simulation (WS6). Mounted by a guarded import in
// public/views/pitch.js; adds its own panel under the pitch.
import { esc, api, can } from "../../shared.js";
import { aiErrorHtml } from "../../ai.js";
import { followRun, teamRunHtml } from "../teamsShared.js";

let stop = null;
export async function mount(container, p) {
  stop?.();
  if (!can("ai") || !p?.id) return;
  const main = container.querySelector(".research-main");
  if (!main) return;
  const sec = document.createElement("section");
  sec.className = "panel team-pitch";
  sec.setAttribute("aria-labelledby", "committee-h");
  sec.innerHTML = `<div class="panel-head"><h3 id="committee-h">Committee simulation</h3><span class="muted small">Bull, Bear, Risk and Valuation agents debate this pitch; a PM agent sums up</span></div><div id="committeeBody"><p class="muted small">Loading…</p></div>`;
  main.appendChild(sec);
  const box = sec.querySelector("#committeeBody");
  const button = (label) => `<button type="button" class="btn btn-ghost btn-sm" id="committeeRun">${esc(label)}</button>`;
  const bind = () => box.querySelector("#committeeRun")?.addEventListener("click", start);
  async function start() {
    box.querySelector("#committeeRun")?.setAttribute("disabled", "");
    try {
      const r = await api(`/api/agents/teams/committee/runs`, { method: "POST", body: JSON.stringify({ pitchId: p.id }) });
      stop = followRun(box, r.runId, { onDone: () => { box.insertAdjacentHTML("beforeend", button("Run again")); bind(); } });
    } catch (err) { box.insertAdjacentHTML("beforeend", aiErrorHtml(err)); box.querySelector("#committeeRun")?.removeAttribute("disabled"); }
  }
  let d;
  try { d = await api(`/api/pitches/${p.id}/committee`); } catch (err) { box.innerHTML = aiErrorHtml(err); return; }
  if (!d.run) {
    box.innerHTML = `<p class="small">No committee has looked at this pitch yet. ${p.status === "voting" ? "One starts automatically when voting opens; " : ""}it takes a few minutes and comes out of the fund's AI budget.</p>${d.aiConfigured ? button("Convene committee") : `<p class="muted small">AI is off on the server.</p>`}`;
    bind();
    return;
  }
  if (d.run.status === "running") { stop = followRun(box, d.run.runId, { onDone: () => { box.insertAdjacentHTML("beforeend", button("Run again")); bind(); } }); return; }
  box.innerHTML = teamRunHtml(d.run) + (d.aiConfigured ? button("Run again") : "");
  bind();
}
