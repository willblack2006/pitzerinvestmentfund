// One agent-team run (#/agents/teams/:id): the debate or dossier, the run tree, live while working.
import { can, pageHead, lockedHint, skeleton } from "../shared.js";
import { followRun } from "./teamsShared.js";

export const title = "Team run";

let stop = null;
export async function mount(container, params = {}) {
  stop?.();
  if (!can("ai")) { container.innerHTML = pageHead("Team run") + `<div class="toolbar">${lockedHint("Sign in to see agent teams.", "ai")}</div>`; return; }
  const id = Number(params.id);
  container.innerHTML = `${pageHead("Agent team run", "Several agents worked this together. Open any worker to see exactly what it read and what it cost.", `<a class="btn btn-ghost btn-sm" href="#/agents/teams">All teams</a>`)}
    <div class="page-pad" id="teamRunBox">${skeleton("cards", { rows: 2 })}</div>`;
  stop = followRun(container.querySelector("#teamRunBox"), id);
}
