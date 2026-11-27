// Data health (admins): when each public-data collector last ran, whether it worked, and how
// big the market-data warehouse is. Route #/data-health. Server: routes/dataHealth.js.
import { esc, api, currentMember, pageHead, lockedHint, skeleton, errorState, toast } from "../shared.js";

export const title = "Data health";

const HEALTH = {
  ok: { dot: "is-done", text: "Working" },
  flaky: { dot: "is-watch", text: "Last run failed" },
  stale: { dot: "is-watch", text: "Behind schedule" },
  failing: { dot: "is-error", text: "Failing" },
  never: { dot: "", text: "Hasn't run yet" },
};
const STATUS = { ok: "Saved data", empty: "Nothing new", error: "Failed", running: "Running" };

function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const every = (ms) => (ms >= 86400e3 ? `every ${Math.round(ms / 86400e3)} days`.replace("every 1 days", "daily") : ms >= 3600e3 ? `every ${Math.round(ms / 3600e3)} h` : `every ${Math.round(ms / 60e3)} min`);
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const num = (n) => Number(n || 0).toLocaleString();

function collectorRow(c) {
  const h = HEALTH[c.health] || HEALTH.never;
  const wk = c.week || {};
  const weekRows = (wk.ok?.rows || 0);
  const weekFails = wk.error?.runs || 0;
  const last = c.last;
  return `<tr>
    <th scope="row" class="left"><span class="status-dot ${h.dot}" aria-hidden="true"></span>
      <strong>${esc(c.label)}</strong><span class="muted small dh-sub">${c.sourceUrl ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.source)}</a>` : esc(c.source)} · ${every(c.everyMs)}</span></th>
    <td class="left" data-label="Health">${esc(h.text)}${c.failStreak > 1 ? ` <span class="muted small">(${c.failStreak} in a row)</span>` : ""}</td>
    <td class="left" data-label="Last run">${last ? `${esc(STATUS[last.status] || last.status)} <span class="muted small">${esc(ago(last.finished_at || last.started_at))}</span>` : "—"}
      ${last?.status === "error" && last.message ? `<span class="small dh-err">${esc(last.message)}</span>` : ""}</td>
    <td class="num" data-label="Latest data">${c.lastGood?.as_of ? esc(c.lastGood.as_of) : "—"}</td>
    <td class="num" data-label="Rows this week">${num(weekRows)}${weekFails ? ` <span class="muted small">· ${weekFails} failed</span>` : ""}</td>
    <td class="num dh-act"><button type="button" class="btn btn-ghost btn-sm" data-run="${esc(c.name)}" ${c.running ? "disabled" : ""}>${c.running ? "Running" : "Run now"}</button></td>
  </tr>`;
}

function runsList(runs, labels) {
  if (!runs.length) return `<p class="muted small">No runs yet. Collectors start a couple of minutes after the server boots.</p>`;
  return `<ol class="dh-runs">${runs.map((r) => `<li><span class="status-dot ${r.status === "ok" ? "is-done" : r.status === "error" ? "is-error" : r.status === "running" ? "is-running" : ""}" aria-hidden="true"></span>
    <span>${esc(labels[r.collector] || r.collector)}</span>
    <span class="muted small">${esc(STATUS[r.status] || r.status)}${r.rows ? ` · ${num(r.rows)} rows` : ""}${r.as_of ? ` · data for ${esc(r.as_of)}` : ""}${r.trigger === "manual" ? " · run by hand" : ""}</span>
    <span class="muted small dh-when">${esc(ago(r.started_at))}</span>
    ${r.message ? `<span class="small ${r.status === "error" ? "dh-err" : "muted"} dh-msg">${esc(r.message)}</span>` : ""}</li>`).join("")}</ol>`;
}

function render(container, s) {
  const labels = Object.fromEntries(s.collectors.map((c) => [c.name, c.label]));
  const bad = s.collectors.filter((c) => c.health !== "ok" && c.health !== "never").length;
  container.querySelector(".page-pad").innerHTML = `
    ${!s.scheduled ? `<p class="spend-banner is-warn">Collectors aren't scheduled on this server (COLLECTORS=off or the scheduler is disabled). They only run when started by hand here.</p>` : ""}
    <div class="trace-tiles">
      <div class="trace-tile"><span class="muted small">Collectors</span><strong>${s.collectors.length}</strong><span class="muted small">${bad ? `${bad} need${bad === 1 ? "s" : ""} a look` : "all on schedule"}</span></div>
      <div class="trace-tile"><span class="muted small">Warehouse size</span><strong>${mb(s.warehouse.bytes)}</strong><span class="muted small">separate from member data</span></div>
      <div class="trace-tile"><span class="muted small">Stored data points</span><strong>${num(s.warehouse.seriesRows)}</strong><span class="muted small">across every series</span></div>
    </div>
    <section class="panel"><h3>Sources</h3>
      <div class="table-scroll dh-scroll"><table class="mini-table dh-table"><caption class="sr-only">Collectors</caption>
        <thead><tr><th scope="col" class="left">Source</th><th scope="col" class="left">Health</th><th scope="col" class="left">Last run</th><th scope="col" class="num">Latest data</th><th scope="col" class="num">Rows this week</th><th scope="col" class="num"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${s.collectors.map(collectorRow).join("")}</tbody></table></div>
      <p class="muted small">"Nothing new" is normal: most sources publish once a day, and a run in between finds nothing to save. "Behind schedule" means no successful run for longer than the source's usual gap.</p>
    </section>
    <section class="panel"><h3>Recent runs</h3>${runsList(s.runs, labels)}</section>`;
  container.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Running";
    try {
      const { run } = await api(`/api/admin/data-health/${encodeURIComponent(b.dataset.run)}/run`, { method: "POST" });
      toast(run.status === "error" ? `Failed: ${run.message || "unknown error"}` : run.status === "empty" ? "Ran. Nothing new to save." : `Saved ${num(run.rows)} rows.`, { type: run.status === "error" ? "error" : "success" });
    } catch (err) { toast(err.message, { type: "error" }); }
    load(container);
  }));
}

async function load(container) {
  let s;
  try { s = await api("/api/admin/data-health"); }
  catch (err) { container.querySelector(".page-pad").innerHTML = errorState({ title: "Couldn't load data health.", detail: err.message }); return; }
  render(container, s);
}

export async function mount(container) {
  if (!currentMember()?.isAdmin) {
    container.innerHTML = pageHead("Data health") + `<div class="toolbar">${lockedHint("Only admins can see data health.", "member")}</div>`;
    return;
  }
  const { ensureCss } = await import("./agents/cssLoader.js");
  ensureCss("/css/trace.css");
  container.innerHTML = pageHead("Data health", "The public sources the app collects on a schedule, when each last worked, and how much it has stored.")
    + `<div class="page-pad trace-page">${skeleton("rows", { rows: 4 })}</div>`;
  await load(container);
}
