// Agents → Teams (WS6): start a committee, deep research or portfolio review run, and see every
// team run the fund has made. Runs open on their own page (#/agents/teams/:id).
import { esc, api, emptyState, errorState, bindRetry, skeleton, toast, icon } from "../../shared.js";
import { aiErrorHtml } from "../../ai.js";
import { runRow, money, followRun } from "../teamsShared.js";

const TICKER = /^[A-Za-z0-9.\-]{1,12}$/;

function teamCard(t, pitches, usage, aiOn) {
  const members = t.members.map((m) => `<li>${esc(m.label)}</li>`).join("");
  const form = t.key === "committee"
    ? `<label class="small">Pitch or ticker
        <select name="pitchId"><option value="">A ticker instead…</option>${pitches.map((p) => `<option value="${p.id}">#${p.id} ${esc(p.direction)} ${esc(p.symbol)} (${esc(p.status)})</option>`).join("")}</select></label>
       <label class="small">Ticker <input name="symbol" placeholder="e.g. NVDA" maxlength="12" autocomplete="off"></label>`
    : t.key === "deep_research"
      ? `<label class="small">Ticker <input name="symbol" placeholder="e.g. CRWV" maxlength="12" required autocomplete="off"></label>
         <label class="small team-wide">What do you most want to know? <span class="muted">(optional)</span><input name="focus" maxlength="300" placeholder="e.g. how durable the backlog is"></label>`
      : `<p class="small muted">Scores every holding, then writes the agenda.</p>`;
  return `<article class="panel team-card" data-team="${esc(t.key)}">
    <header><h3>${esc(t.name)}</h3><span class="muted small">up to ${money(t.budgetUsd)} a run · ${esc(t.typicalMinutes)} min</span></header>
    <p class="small">${esc(t.description)}</p>
    <ul class="team-members" aria-label="Agents on this team">${members}</ul>
    <p class="small muted">${t.triggers.map(esc).join(" · ")}</p>
    <form class="team-form" novalidate>${form}
      <button type="submit" class="btn btn-primary btn-sm"${aiOn ? "" : " disabled"}>${t.key === "committee" ? "Convene committee" : t.key === "deep_research" ? "Start research" : "Run review now"}</button>
      <p class="team-form-msg small" role="status" aria-live="polite"></p>
    </form>
  </article>`;
}

async function render(el) {
  el.innerHTML = skeleton("cards", { rows: 3 });
  let d, pitches = [];
  try {
    [d, pitches] = await Promise.all([api("/api/agents/teams"), api("/api/pitches").then((r) => (Array.isArray(r) ? r : r.pitches || [])).catch(() => [])]);
  } catch (err) { el.innerHTML = errorState({ title: "Couldn't load the teams.", detail: err.message, retryId: "teams" }); bindRetry(el, "teams", () => render(el)); return; }
  const open = pitches.filter((p) => ["voting", "draft"].includes(p.status));
  const u = d.usage;
  el.innerHTML = `<p class="small muted team-intro">Teams are several agents working one problem together: each does one job, they read each other's work, and one agent pulls it together. Every worker is its own run you can open. Team runs come out of the fund's AI budget and everyone with AI access sees them. You can start ${Math.max(0, u.limits.perMemberDay - u.mineToday)} more today.</p>
    ${d.aiConfigured ? "" : `<p class="notice small">AI is off on the server (no OpenAI key is set), so teams can't run.</p>`}
    <div class="team-cards">${d.teams.map((t) => teamCard(t, open, u, d.aiConfigured)).join("")}</div>
    <div id="teamLive"></div>
    <section aria-labelledby="team-runs-h"><h3 id="team-runs-h" class="team-sub">Recent team runs</h3>
      ${d.runs.length ? `<ul class="team-rows">${d.runs.map(runRow).join("")}</ul>` : emptyState({ icon: "users", title: "No team runs yet", body: "Convene a committee on an open pitch to see how it works." })}
    </section>`;
  el.querySelectorAll(".team-form").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const team = form.closest(".team-card").dataset.team;
    const msg = form.querySelector(".team-form-msg");
    const body = Object.fromEntries(new FormData(form).entries());
    if (team === "committee" && !body.pitchId && !TICKER.test(body.symbol || "")) { msg.innerHTML = `<span class="error">Pick a pitch or type a ticker.</span>`; return; }
    if (team === "deep_research" && !TICKER.test(body.symbol || "")) { msg.innerHTML = `<span class="error">Type a ticker to research.</span>`; return; }
    const btn = form.querySelector("button"); btn.disabled = true; msg.textContent = "Starting…";
    try {
      const r = await api(`/api/agents/teams/${team}/runs`, { method: "POST", body: JSON.stringify(body) });
      msg.innerHTML = `Started. <a href="#/agents/teams/${r.runId}">Open the run</a>`;
      toast("Team started. You can leave this page; the run keeps going.");
      const live = el.querySelector("#teamLive");
      followRun(live, r.runId, { opts: { link: true } });
      live.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) { msg.innerHTML = aiErrorHtml(err); } finally { btn.disabled = false; }
  }));
}

export default { key: "teams", label: "Teams", order: 35, render: (el) => render(el) };
export { icon };
