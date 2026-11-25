// Research → Overview: "What our agents know" (WS5). The nightly dossier summary plus the open
// questions and latest notes from shared memory, with a link to the ticker's full memory.
import { esc, api, can, icon } from "../../shared.js";
import { dossierSummary, memoryItem } from "../memory.js";

export async function render(el, { symbol }) {
  if (!can("member")) { el.remove(); return; }
  let d;
  try { d = await api(`/api/memory/dossier/${encodeURIComponent(symbol)}`); } catch { el.remove(); return; }
  const recent = [...d.decisions, ...d.facts, ...d.observations, ...d.predictions].sort((a, b) => (b.pinned - a.pinned) || String(b.asOf || b.createdAt).localeCompare(String(a.asOf || a.createdAt)));
  const total = recent.length + d.openQuestions.length;
  if (!total) { el.remove(); return; }
  const summary = dossierSummary(d, { canRefresh: can("ai") });
  el.className = "panel dossier-card";
  el.innerHTML = `<div class="panel-head"><h3>${icon("agent", { size: 16 })} What our agents know</h3><a class="small" href="#/memory/${encodeURIComponent(symbol)}">All ${total} ${total === 1 ? "memory" : "memories"}</a></div>
    ${summary}
    ${d.openQuestions.length ? `<p class="pf-sub">Open questions</p><ul class="mem-list">${d.openQuestions.slice(0, 3).map((m) => memoryItem(m, { actions: false, showSymbol: false })).join("")}</ul>` : ""}
    ${recent.length ? `<details${summary ? "" : " open"}><summary class="small">Latest notes (${Math.min(4, recent.length)} of ${recent.length})</summary><ul class="mem-list">${recent.slice(0, 4).map((m) => memoryItem(m, { actions: false, showSymbol: false })).join("")}</ul></details>` : ""}
    ${d.proposed ? `<p class="muted small"><a href="#/agents/approvals">${d.proposed} waiting for approval</a></p>` : ""}`;
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-dossier-refresh]");
    if (!b) return;
    b.disabled = true; b.textContent = "Writing…";
    try { await api(`/api/memory/dossier/${encodeURIComponent(symbol)}/refresh`, { method: "POST" }); render(el, { symbol }); }
    catch (err) { b.disabled = false; b.textContent = esc(err.message).slice(0, 80); }
  });
}
