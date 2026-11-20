// "Why?" on an agent run (WS5): the shared memory it was given (and which it cited), messages
// it sent or picked up on the blackboard, agents it asked (child runs), the memory it wrote and
// the tools it read. Added under the run page by the hook in routes.d/memory.js.
import { esc, api, safeUrl } from "./shared.js";
import { memoryItem, messageItem } from "./views/memory.js";

const href = (u) => (!u ? "#" : u.startsWith("#") ? esc(u) : safeUrl(u));

export async function addWhy({ container, run } = {}) {
  const host = container?.querySelector(".agent-run");
  if (!host || !run?.id || host.querySelector(".mem-why")) return;
  let w;
  try { w = await api(`/api/agents/runs/${encodeURIComponent(run.id)}/explain`); } catch { return; }
  const parts = [];
  if (w.parent) parts.push(`<p class="small">Asked by <a href="#/agents/runs/${w.parent.id}">run #${w.parent.id}</a>${w.parent.summary ? `: ${esc(w.parent.summary.slice(0, 160))}` : ""}</p>`);
  if (w.memory.length) parts.push(`<h4>What it already knew (${w.memory.length} from shared memory)</h4><ul class="mem-list">${w.memory.map((m) => memoryItem(m, { actions: false, cited: m.cited })).join("")}</ul>`);
  if (w.children.length) parts.push(`<h4>Agents it asked</h4><ul class="small">${w.children.map((c) => `<li><a href="#/agents/runs/${c.id}">run #${c.id}</a> · ${esc(c.status)}${c.summary ? `: ${esc(c.summary.slice(0, 200))}` : ""}</li>`).join("")}</ul>`);
  if (w.messages.length) parts.push(`<h4>Blackboard</h4><ul class="mem-list">${w.messages.map(messageItem).join("")}</ul>`);
  const tools = w.tools.filter((t) => t.ok && t.name !== "get_memory");
  if (tools.length) parts.push(`<h4>Data it read (${tools.length})</h4><ul class="small">${tools.map((t) => `<li>${esc(t.name)}${t.args?.symbol ? ` ${esc(t.args.symbol)}` : ""}${t.source_url ? ` · <a href="${href(t.source_url)}">${esc(t.title || "source")}</a>` : ""}</li>`).join("")}</ul>`);
  if (w.memoryWritten.length) parts.push(`<h4>What it added to memory</h4><ul class="mem-list">${w.memoryWritten.map((m) => memoryItem(m, { actions: false })).join("")}</ul>`);
  if (!parts.length) return;
  const sec = document.createElement("section");
  sec.className = "panel mem-why";
  sec.innerHTML = `<details open><summary><h3 style="display:inline">Why? What this run used</h3></summary>${parts.join("")}</details>`;
  const steps = [...host.querySelectorAll("section.panel")].find((s) => /Steps/.test(s.querySelector("h3")?.textContent || ""));
  if (steps) steps.before(sec); else host.append(sec);
}
