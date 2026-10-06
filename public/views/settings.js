import { el, esc, api, isUnlocked, toast, lockedHint, pageHead, loading, errorBox, confirmAction, benchmarkPresets, benchmarkPicker, readBenchmark } from "../shared.js";

export const title = "Settings";

const ROLES = ["analyst", "portfolio manager", "risk officer", "officer", "advisor"];

const POLICY = [
  ["maxPositionPct", "Max single position (% of fund)", "Most student-fund IPSs cap a single name at 5–10%."],
  ["maxSectorPct", "Max sector weight (% of fund)", "Limits concentration in one sector; 25–35% is common."],
  ["minPositions", "Minimum number of holdings", "Diversification floor."],
  ["maxPositions", "Maximum number of holdings", "Keeps coverage manageable for the analyst team."],
  ["minCashPct", "Minimum cash (% of fund)", "Liquidity buffer for new ideas or withdrawals."],
];

export async function mount(container) {
  container.innerHTML = loading("Loading settings…");
  let s, members, presets, managers;
  try {
    [s, members, presets, managers] = await Promise.all([api("/api/settings"), api("/api/members"), benchmarkPresets(), api("/api/13f/managers")]);
  } catch (err) {
    container.innerHTML = pageHead("Settings") + errorBox(err.message);
    return;
  }
  const unlocked = isUnlocked();
  const dis = unlocked ? "" : "disabled";

  container.innerHTML = `
    ${pageHead("Settings", "The fund's investment policy limits, voting rules and members. Changes need the shared edit password.")}
    ${unlocked ? "" : `<div class="toolbar">${lockedHint("Unlock editing to change settings or manage members.")}</div>`}
    <div class="tab-grid">
      <section class="panel" aria-labelledby="ips-h">
        <h3 id="ips-h">Investment policy limits</h3>
        <form id="policyForm" class="stack-form">
          ${POLICY.map(([k, label, hint]) => `<label>${label}<input name="${k}" type="number" step="any" min="0" value="${s[k] ?? ""}" placeholder="Not set" ${dis} inputmode="decimal" /><span class="field-hint">${hint} Leave blank for no limit.</span></label>`).join("")}
          ${unlocked ? `<button class="btn btn-primary">Save limits</button>` : lockedHint("These are read-only until you unlock editing.")}
        </form>
        <p class="muted small">Breaches show on <a href="#/allocation">Allocation &amp; policy</a> and in <a href="#/alerts">Alerts</a>.</p>
      </section>
      <section class="panel" aria-labelledby="vote-h">
        <h3 id="vote-h">Benchmark, voting rules &amp; cash</h3>
        <form id="voteForm" class="stack-form">
          <label>Approval threshold (% yes of yes+no votes)<input name="voteThresholdPct" type="number" min="0" max="100" step="1" value="${s.voteThresholdPct}" ${dis} /><span class="field-hint">50 = simple majority; 66.7 = two-thirds.</span></label>
          <label>Quorum (minimum votes cast)<input name="voteQuorum" type="number" min="1" step="1" value="${s.voteQuorum}" ${dis} /></label>
          ${benchmarkPicker("fundBench", s.benchmark, presets, { label: "Fund benchmark", disabled: !unlocked })}
          <span class="field-hint">Currently <strong>${esc(s.benchmarkLabel)}</strong>. Drives performance, beta and relative charts; equity benchmarks also set the sector comparison. Any Yahoo ticker works, or a blend like <code>SPY:60,AGG:40</code> (rebalanced daily).</span>
          <label>Cash balance ($)<input name="cash" type="number" step="any" min="0" value="${s.cash}" ${dis} /><span class="field-hint">Normally maintained automatically by the Transactions ledger.</span></label>
          ${unlocked ? `<button class="btn btn-primary">Save</button>` : lockedHint("Read-only — unlock editing to change the benchmark. (To just compare, use “Compare with” on the Performance page.)")}
        </form>
      </section>
      <section class="panel span-full" aria-labelledby="mem-h">
        <div class="panel-head"><h3 id="mem-h">Members</h3><span class="muted small">Members sign in with a PIN to vote and author pitches</span></div>
        ${members.length ? `
          <div class="table-scroll"><table class="mini-table">
            <caption class="sr-only">Fund members</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Joined</th>${unlocked ? `<th scope="col"><span class="sr-only">Actions</span></th>` : ""}</tr></thead>
            <tbody>${members.map((m) => `<tr class="${m.active ? "" : "muted"}">
              <td>${esc(m.name)}</td>
              <td>${unlocked ? `<label class="sr-only" for="role-${m.id}">Role for ${esc(m.name)}</label><select id="role-${m.id}" data-role="${m.id}">${ROLES.map((r) => `<option ${r === m.role ? "selected" : ""}>${r}</option>`).join("")}</select>` : esc(m.role)}</td>
              <td>${m.active ? "Active" : "Alumni"}</td>
              <td>${esc(m.createdAt.slice(0, 10))}</td>
              ${unlocked ? `<td><div class="row-actions">
                <button class="btn btn-ghost btn-sm" data-pin="${m.id}" aria-label="Reset PIN for ${esc(m.name)}">Reset PIN</button>
                <button class="btn btn-ghost btn-sm" data-active="${m.id}" data-to="${m.active ? 0 : 1}" aria-label="${m.active ? "Mark as alumni" : "Reactivate"} ${esc(m.name)}">${m.active ? "Mark alumni" : "Reactivate"}</button>
              </div></td>` : ""}
            </tr>`).join("")}</tbody>
          </table></div>` : `<p class="muted">No members yet.</p>`}
        ${unlocked ? `
          <form id="addMember" class="inline-form">
            <label>Name <input name="name" required maxlength="80" autocomplete="off" /></label>
            <label>Role <select name="role">${ROLES.map((r) => `<option>${r}</option>`).join("")}</select></label>
            <label>PIN (4–8 digits) <input name="pin" required inputmode="numeric" pattern="\\d{4,8}" maxlength="8" autocomplete="new-password" /></label>
            <button class="btn btn-primary btn-sm">Add member</button>
          </form>
          <p class="muted small">Give each member their PIN privately. Marking someone alumni signs them out and keeps their past votes on record — use it at the end of each semester.</p>` : ""}
      </section>
      <section class="panel span-full" aria-labelledby="13f-h">
        <div class="panel-head"><h3 id="13f-h">13F tracker: managers followed</h3><a class="small" href="#/13f">Open tracker →</a></div>
        ${managers.length ? `
          <ul class="link-list">${managers.map((m) => `<li>${esc(m.name || m.cik)} <span class="muted small">(CIK ${esc(m.cik)})</span>${unlocked ? ` <button class="btn-link small" data-del-manager="${esc(m.cik)}">Remove</button>` : ""}</li>`).join("")}</ul>`
          : `<p class="muted">No managers followed yet.</p>`}
        ${unlocked ? `
          <form id="addManager" class="inline-form">
            <label>CIK <input name="cik" required placeholder="e.g. 0001067983" maxlength="10" /></label>
            <label>Name <input name="name" placeholder="e.g. Berkshire Hathaway" maxlength="120" /></label>
            <button class="btn btn-primary btn-sm">Follow</button>
          </form>
          <p class="muted small">Find a manager's CIK on <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=13F-HR" target="_blank" rel="noopener">SEC EDGAR's 13F filer search<span class="sr-only"> (opens in new tab)</span></a>. Up to 20 managers.</p>` : ""}
      </section>
    </div>`;

  if (!unlocked) return;

  const saveForm = (id) => el(id).addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {};
    for (const [k, v] of new FormData(e.target).entries()) {
      if (k.startsWith("fundBench")) continue;
      body[k] = v.trim() === "" && id === "policyForm" ? null : Number(v); // blank policy limit = not set
    }
    if (id === "voteForm") body.benchmark = readBenchmark("fundBench");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      toast("Settings saved.", { type: "success" });
      if (id === "voteForm") mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  saveForm("policyForm");
  saveForm("voteForm");

  el("addMember").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api("/api/members", { method: "POST", body: JSON.stringify(body) });
      toast(`${body.name} added.`, { type: "success" });
      mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  });

  container.querySelector("tbody")?.addEventListener("submit", async (e) => {
    const id = e.target.dataset.pinform;
    if (!id) return;
    e.preventDefault();
    const pin = el(`pin-${id}`).value.trim();
    if (!/^\d{4,8}$/.test(pin)) {
      el(`pin-${id}`).setAttribute("aria-invalid", "true");
      toast("PIN must be 4–8 digits.", { type: "error" });
      return;
    }
    try {
      await api(`/api/members/${id}`, { method: "PUT", body: JSON.stringify({ pin }) });
      toast("PIN reset; that member was signed out everywhere.", { type: "success" });
      mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  container.querySelector("tbody")?.addEventListener("change", async (e) => {
    const id = e.target.dataset.role;
    if (!id) return;
    try {
      await api(`/api/members/${id}`, { method: "PUT", body: JSON.stringify({ role: e.target.value }) });
      toast("Role updated.");
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  container.querySelector("tbody")?.addEventListener("click", async (e) => {
    const pinId = e.target.closest("[data-pin]")?.dataset.pin;
    const activeBtn = e.target.closest("[data-active]");
    if (pinId) {
      // Inline reset form in place of the row's actions (no native prompt()).
      const cell = e.target.closest("td");
      const name = members.find((m) => String(m.id) === pinId)?.name || "member";
      cell.innerHTML = `<form class="inline-form pin-form" data-pinform="${pinId}">
        <label class="sr-only" for="pin-${pinId}">New PIN for ${esc(name)}</label>
        <input id="pin-${pinId}" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" placeholder="New 4–8 digit PIN" autocomplete="new-password" required />
        <button class="btn btn-primary btn-sm">Save</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cancelpin>Cancel</button>
      </form>`;
      el(`pin-${pinId}`).focus();
      return;
    }
    if (e.target.closest("[data-cancelpin]")) { mount(container); return; }
    if (activeBtn) {
      const to = activeBtn.dataset.to === "1";
      if (!to && !(await confirmAction({ title: "Mark as alumni?", body: "They'll be signed out and can no longer vote. Past votes are kept.", confirmLabel: "Mark alumni" }))) return;
      try {
        await api(`/api/members/${activeBtn.dataset.active}`, { method: "PUT", body: JSON.stringify({ active: to }) });
        mount(container);
      } catch (err) { toast(err.message, { type: "error" }); }
    }
  });

  el("addManager")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api("/api/13f/managers", { method: "POST", body: JSON.stringify(body) });
      toast("Manager added.", { type: "success" });
      mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  container.querySelectorAll("[data-del-manager]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await api(`/api/13f/managers/${b.dataset.delManager}`, { method: "DELETE" });
      mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  }));
}
