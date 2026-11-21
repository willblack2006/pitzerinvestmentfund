// Version history for one agent: every save is a version; pick one to see what changed against
// the current version, in words, and restore it (restoring saves a new version, so nothing is lost).
import { esc, icon, toast, confirmAction } from "../shared.js";
import { diffSpecs } from "./specModel.js";
import * as A from "./api.js";
import { relTime } from "./ui.js";

const parse = (s) => (typeof s === "string" ? JSON.parse(s || "{}") : s || {});

export function diffHtml(changes) {
  if (!changes.length) return `<p class="muted small">Same as the current version.</p>`;
  const bySection = new Map();
  for (const c of changes) { if (!bySection.has(c.section)) bySection.set(c.section, []); bySection.get(c.section).push(c); }
  return [...bySection.entries()].map(([sec, list]) => `<p class="ab-diff-sec">${esc(sec)}</p><ul class="ab-diff">${list.map((c) => `<li class="is-${c.kind}">${esc(c.text)}</li>`).join("")}</ul>`).join("");
}

export async function renderHistory(box, { agent, current, metrics, canRestore, onRestored }) {
  box.innerHTML = `<section class="ab-side-card"><h3>${icon("calendar", { size: 16 })} History</h3><p class="muted small">Loading…</p></section>`;
  let list;
  try { list = await A.versions(agent.id); }
  catch (err) { box.innerHTML = `<section class="ab-side-card"><h3>History</h3><p class="error small">${esc(A.isMissing(err) ? "History needs the agent engine." : err.message)}</p></section>`; return; }
  list = [...list].sort((a, b) => b.version - a.version);
  let pick = list.find((v) => v.version !== agent.version)?.version ?? null;
  const draw = () => {
    const v = list.find((x) => x.version === pick);
    box.innerHTML = `<section class="ab-side-card ab-history" aria-labelledby="abHistH"><h3 id="abHistH">${icon("calendar", { size: 16 })} History</h3>
      <ol class="ab-versions">${list.map((x) => `<li><button type="button" class="ab-ver${x.version === pick ? " is-picked" : ""}" data-ver="${x.version}" aria-pressed="${x.version === pick}">
        <strong>v${x.version}</strong>${x.version === agent.version ? ` <span class="badge badge-owned">current</span>` : ""}
        <span class="muted small">${esc(x.editedByName || "someone")} · ${esc(relTime(x.createdAt))}</span>${x.note ? `<span class="small">${esc(x.note)}</span>` : ""}</button></li>`).join("")}</ol>
      ${v ? `<div class="ab-diffbox"><p class="small"><strong>Going from v${v.version} to the current version:</strong></p>${diffHtml(diffSpecs(parse(v.spec), current, { metrics }))}
        ${canRestore && v.version !== agent.version ? `<button type="button" class="btn btn-ghost btn-sm" data-restore="${v.version}">Restore v${v.version}</button>` : ""}</div>`
        : `<p class="muted small">${list.length <= 1 ? "Only one version so far. Each save adds one." : "Pick a version to compare."}</p>`}
    </section>`;
  };
  box.onclick = async (e) => {
    const b = e.target.closest("[data-ver]");
    if (b) { pick = Number(b.dataset.ver); draw(); return; }
    const r = e.target.closest("[data-restore]");
    if (!r) return;
    const ver = Number(r.dataset.restore);
    if (!(await confirmAction({ title: `Restore version ${ver}?`, body: "Its settings become the current version. Your current version stays in history.", confirmLabel: "Restore" }))) return;
    r.disabled = true;
    try { const a = await A.restore(agent.id, ver); toast(`Restored v${ver}.`, { type: "success" }); onRestored?.(a); }
    catch (err) { r.disabled = false; toast(err.message, { type: "error" }); }
  };
  draw();
}
