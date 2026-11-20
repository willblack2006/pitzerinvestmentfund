// Test panel: a free dry run ("would have fired on Oct 3, Oct 17…") over the last 30 or 90 days
// of stored data, shown as a small timeline, and "Run once now" for a saved agent (a real run,
// billed like any other, shown as it works).
import { esc, icon, toast } from "../shared.js";
import * as A from "./api.js";

const DAY = 864e5;
const fmtDay = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Groups fires by day and positions each day on a track from (today - days) to today.
export function timeline(fires = [], days = 30, now = Date.now()) {
  const start = now - days * DAY;
  const byDay = new Map();
  for (const f of fires) {
    const d = String(f.date || "").slice(0, 10);
    if (!d) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(f);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({
    date, list, pct: Math.max(0, Math.min(100, ((Date.parse(`${date}T12:00:00Z`) - start) / (days * DAY)) * 100)),
  }));
}

function resultHtml(r, days) {
  const fires = r.fires || [];
  const days_ = timeline(fires, r.days || days);
  const symbols = new Set(fires.map((f) => f.symbol).filter(Boolean));
  const head = fires.length
    ? `Would have run <strong>${fires.length}</strong> time${fires.length === 1 ? "" : "s"} in the last ${r.days || days} days${symbols.size ? `, on ${symbols.size} stock${symbols.size === 1 ? "" : "s"}` : ""}.`
    : `Wouldn't have run in the last ${r.days || days} days.${r.evaluated ? ` Checked ${r.evaluated.toLocaleString()} moments.` : ""}`;
  return `<p>${head}</p>
    <div class="ab-timeline" role="img" aria-label="${esc(`${fires.length} runs over ${r.days || days} days`)}">
      <span class="ab-tl-track"></span>
      ${days_.map((d) => `<span class="ab-tl-dot${d.list.length > 1 ? " is-many" : ""}" style="left:${d.pct.toFixed(2)}%" title="${esc(`${fmtDay(d.date)}: ${d.list.map((f) => f.symbol || "fund").join(", ")}`)}"></span>`).join("")}
      <span class="ab-tl-label is-start">${fmtDay(new Date(Date.now() - (r.days || days) * DAY).toISOString())}</span><span class="ab-tl-label is-end">Today</span>
    </div>
    ${days_.length ? `<ul class="ab-fires">${days_.slice(-12).reverse().map((d) => `<li><span class="ab-fire-date">${fmtDay(d.date)}</span><span>${d.list.slice(0, 4).map((f) => `${f.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(f.symbol)}">${esc(f.symbol)}</a> ` : ""}<span class="muted small">${esc(f.reason || "")}</span>`).join("<br>")}${d.list.length > 4 ? `<br><span class="muted small">and ${d.list.length - 4} more</span>` : ""}</span></li>`).join("")}</ul>` : ""}
    ${days_.length > 12 ? `<p class="muted small">Showing the latest 12 days with runs.</p>` : ""}
    ${r.skipped?.length ? `<p class="muted small">Not backtested: ${r.skipped.map((s) => esc(s.reason || s.trigger)).join("; ")}.</p>` : ""}
    <p class="muted small">A dry run checks triggers and conditions against stored data. No AI is called and nothing is posted.</p>`;
}

export function renderTest(box, state, { start = false } = {}) {
  if (!box) return;
  state.days ||= 30;
  const saved = !!state.agent?.id;
  const draw = () => {
    box.innerHTML = `<section class="ab-side-card ab-test" aria-labelledby="abTestH">
      <div class="ab-test-head"><h3 id="abTestH">${icon("flask", { size: 16 })} Test</h3>
        <div class="seg seg-sm" role="group" aria-label="Look back">${[30, 90].map((d) => `<button type="button" class="seg-btn" data-test-days="${d}" aria-pressed="${state.days === d}">${d} days</button>`).join("")}</div></div>
      <div class="ab-test-body" aria-live="polite">${state.running ? `<p class="muted">${icon("sparkle", { size: 16 })} Checking the last ${state.days} days…</p>`
        : state.error ? `<p class="error small">${esc(state.error)}</p>` : state.result ? resultHtml(state.result, state.days) : ""}</div>
      <div class="ab-test-run">
        ${saved ? `<button type="button" class="btn btn-ghost btn-sm" data-test-run>${icon("sparkle", { size: 16 })} Run once now</button><span class="muted small">A real run: it posts where the agent posts and costs what a run costs.</span>`
          : `<span class="muted small">Save the agent to run it for real.</span>`}
      </div>
      <div class="ab-run-out" aria-live="polite"></div>
    </section>`;
  };
  const dry = async () => {
    state.running = true; state.error = null; draw();
    try {
      // An unsaved or edited form is tested as it stands, not as last saved.
      state.result = await A.dryRun(saved && !state.dirty ? { id: state.agent.id, days: state.days } : { spec: state.spec, days: state.days });
    } catch (err) {
      state.result = null;
      state.error = A.isMissing(err) ? "Dry runs need the agent engine, which isn't on this server yet." : err.message;
    }
    state.running = false; draw();
  };
  if (!box.dataset.bound) {
    box.dataset.bound = "1";
    box.addEventListener("click", async (e) => {
      const d = e.target.closest("[data-test-days]");
      if (d) { state.days = Number(d.dataset.testDays); return dry(); }
      const r = e.target.closest("[data-test-run]");
      if (r) runOnce(box.querySelector(".ab-run-out"), state, r);
    });
  }
  draw();
  if (start) { dry(); box.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
}

// Starts a real run and shows it: WS11's run card when it's installed, otherwise a light
// poll of the run until it finishes.
async function runOnce(out, state, btn) {
  btn.disabled = true;
  let runId;
  try { ({ runId } = await A.runNow(state.agent.id)); }
  catch (err) { btn.disabled = false; toast(err.message, { type: "error" }); return; }
  try {
    const rc = await import("../ui/runCard.js");
    if (typeof rc.mountRunCard === "function") { await rc.mountRunCard(out, runId); btn.disabled = false; return; }
  } catch { /* shared run card not installed yet */ }
  out.innerHTML = `<p class="muted small">${icon("sparkle", { size: 16 })} Running… <a href="#/agents/runs/${runId}">open the run</a></p>`;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (!out.isConnected) return;
    let run;
    try { run = await A.run(runId); } catch { continue; }
    if (run.status === "running") continue;
    let card = "";
    try { card = (await import("../views/agents.js")).outputCard?.(run.output, run.id, run.feedback) || ""; } catch { /* fine */ }
    out.innerHTML = `<p class="small"><span class="badge ${run.status === "done" ? "badge-owned" : "badge-danger"}">${esc(run.status)}</span>${run.error ? ` ${esc(run.error)}` : ""} · <a href="#/agents/runs/${run.id}">How it was made</a></p>${card}`;
    break;
  }
  btn.disabled = false;
}
