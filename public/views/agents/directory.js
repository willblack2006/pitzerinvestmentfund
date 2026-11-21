// Agents hub → Team agents tab (WS7): every agent the team can use, with search and sorting.
// Follow from the card; the profile has everything else.
import { api, icon, emptyState, errorState, bindRetry, skeleton } from "../../shared.js";
import { agentCard, bindFollow } from "./profile.js";

const SORTS = [["followed", "Most followed"], ["useful", "Most useful"], ["recent", "Most recent"], ["name", "Name"]];

export async function renderDirectory(el) {
  el.innerHTML = `<div class="feed-dir-bar">
      <label class="sr-only" for="dirQ">Search agents</label>
      <input id="dirQ" type="search" placeholder="Search agents by name or what they do" autocomplete="off">
      <label class="sr-only" for="dirSort">Sort</label>
      <select id="dirSort">${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <label class="feed-dir-mine"><input type="checkbox" id="dirMine"> Mine only</label>
      <a class="btn btn-primary btn-sm" href="#/agents/new">${icon("plus", { size: 14 })} Create agent</a>
    </div><div id="dirList" class="feed-dir-grid">${skeleton("cards", { rows: 6 })}</div>`;
  const list = el.querySelector("#dirList");
  let timer = null;
  const load = async () => {
    const qs = new URLSearchParams({ q: el.querySelector("#dirQ").value.trim(), sort: el.querySelector("#dirSort").value, ...(el.querySelector("#dirMine").checked ? { mine: "1" } : {}) });
    let r;
    try { r = await api(`/api/agents/directory?${qs}`); } catch (err) { list.innerHTML = errorState({ title: "Couldn't load the agents.", detail: err.message, retryId: "dir" }); bindRetry(list, "dir", load); return; }
    list.innerHTML = r.agents.length ? r.agents.map((a) => agentCard(a)).join("")
      : emptyState({ icon: "sparkle", title: "No agents match", body: "Try another search, or create one from a template.", action: { label: "Create agent", href: "#/agents/new" } });
  };
  el.querySelector("#dirQ").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  el.querySelector("#dirSort").addEventListener("change", load);
  el.querySelector("#dirMine").addEventListener("change", load);
  bindFollow(el, () => {});
  load();
}

export default { key: "directory", label: "Team agents", order: 15, render: renderDirectory };
