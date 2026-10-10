import { el, esc, api, can, toast, lockedHint, pageHead, loading, errorBox, confirmAction, benchmarkPresets, benchmarkPicker, readBenchmark } from "../shared.js";

export const title = "Settings";

const POLICY = [
  ["maxPositionPct", "Max single position (% of fund)", "Most student-fund IPSs cap a single name at 5–10%."],
  ["maxSectorPct", "Max sector weight (% of fund)", "Limits concentration in one sector; 25–35% is common."],
  ["minPositions", "Minimum number of holdings", "Diversification floor."],
  ["maxPositions", "Maximum number of holdings", "Keeps coverage manageable for the analyst team."],
  ["minCashPct", "Minimum cash (% of fund)", "Liquidity buffer for new ideas or withdrawals."],
];

const ACTION_LABEL = {
  "member.join": "Joined with the sign-up link", "joinLink.create": "Made a new sign-up link", "joinLink.revoke": "Turned off the sign-up link",
  "position.add": "Added a holding", "position.edit": "Edited a holding", "position.delete": "Removed a holding",
  "transaction.buy": "Bought", "transaction.sell": "Sold", "transaction.dividend": "Recorded a dividend", "transaction.deposit": "Recorded a deposit",
  "transaction.withdrawal": "Recorded a withdrawal", "transaction.fee": "Recorded a fee", "transaction.delete": "Deleted a transaction",
  "dividend.received": "Confirmed a dividend", "dividend.notOwed": "Marked a dividend not owed", "dividend.owedAgain": "Re-opened a dividend",
  "settings.update": "Changed settings", "member.add": "Added a member", "member.update": "Updated a member", "member.invite": "Made a sign-in link",
};
export function activityText(a) {
  const d = a.detail || {};
  const what = [d.symbol, d.shares != null ? `${Number(d.shares).toLocaleString("en-US", { maximumFractionDigits: 4 })} sh` : "", d.name].filter(Boolean).join(" · ");
  return `${ACTION_LABEL[a.action] || a.action}${what ? `: ${what}` : ""}`;
}

const joinUrl = (token) => `${location.origin}${location.pathname}#/join/${token}`;
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// The club's shared sign-up link: post it in the group chat; anyone with it joins as an Analyst.
function joinLinkHtml(link) {
  const days = `<label class="field-inline">Works for <select id="joinDays"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option></select></label>`;
  return `<div class="join-link">
    <p class="pf-sub">Sign-up link for the club</p>
    ${link ? `<p class="small">Post this in the group chat. Anyone who opens it can make an account and starts as an <strong>Analyst</strong>; give out other roles below. Works until ${esc(day(link.expiresAt))} · ${link.uses} joined so far.</p>
      <div class="invite-row"><input type="text" readonly value="${esc(joinUrl(link.token))}" aria-label="Club sign-up link" /><button type="button" class="btn btn-primary btn-sm" data-copy="${esc(joinUrl(link.token))}">Copy link</button></div>
      <div class="inline-form join-actions">${days}<button type="button" class="btn btn-ghost btn-sm" id="joinNew">Make a new link</button><button type="button" class="btn btn-danger btn-sm" id="joinOff">Turn off</button></div>
      <p class="muted small">Anyone who gets the link can join, so turn it off (or make a new one) once everyone's in. A new link stops the old one working.</p>`
    : `<p class="small">Make one link to post in the group chat. Anyone who opens it can create their own account as an Analyst, so you don't have to add people one by one.</p>
      <div class="inline-form join-actions">${days}<button type="button" class="btn btn-primary btn-sm" id="joinNew">Make a sign-up link</button></div>`}
  </div>`;
}

const inviteUrl = (token) => `${location.origin}${location.pathname}#/welcome/${token}`;

// Shown after adding a member or making a new link: the admin copies it and sends it to them.
function inviteBox(name, token) {
  const url = inviteUrl(token);
  return `<div class="invite-box" role="status">
    <p><strong>Sign-in link for ${esc(name)}</strong> (works once, for 7 days). Send it to them by text or email:</p>
    <div class="invite-row"><input type="text" readonly value="${esc(url)}" aria-label="Sign-in link for ${esc(name)}" /><button type="button" class="btn btn-primary btn-sm" data-copy="${esc(url)}">Copy link</button></div>
  </div>`;
}

export async function mount(container) {
  container.innerHTML = loading("Loading settings…");
  const admin = can("admin"), trader = can("trade"), member = can("member");
  let s, members, presets, managers, activity;
  try {
    [s, members, presets, managers, activity] = await Promise.all([
      api("/api/settings"), member ? api("/api/members") : Promise.resolve([]), benchmarkPresets(), api("/api/13f/managers"),
      admin ? api("/api/activity?limit=40") : Promise.resolve([]),
    ]);
  } catch (err) {
    container.innerHTML = pageHead("Settings") + errorBox(err.message);
    return;
  }
  const dis = admin ? "" : "disabled";

  container.innerHTML = `
    ${pageHead("Settings", "The fund's investment policy, voting rules, cash and members. Admins change policy and members; portfolio managers maintain cash.")}
    ${member ? "" : `<div class="toolbar">${lockedHint("Sign in to manage settings and members.")}</div>`}
    <div class="tab-grid">
      <section class="panel" aria-labelledby="ips-h">
        <h3 id="ips-h">Investment policy limits</h3>
        <form id="policyForm" class="stack-form">
          ${POLICY.map(([k, label, hint]) => `<label>${label}<input name="${k}" type="number" step="any" min="0" value="${s[k] ?? ""}" placeholder="Not set" ${dis} inputmode="decimal" /><span class="field-hint">${hint} Leave blank for no limit.</span></label>`).join("")}
          ${admin ? `<button class="btn btn-primary">Save limits</button>` : member ? lockedHint("", "admin") : ""}
        </form>
        <p class="muted small">Breaches show on <a href="#/allocation">Allocation &amp; policy</a> and in <a href="#/alerts">Alerts</a>.</p>
      </section>
      <section class="panel" aria-labelledby="vote-h">
        <h3 id="vote-h">Voting rules &amp; official benchmark</h3>
        <form id="voteForm" class="stack-form">
          <label>Approval threshold (% yes of yes+no votes)<input name="voteThresholdPct" type="number" min="0" max="100" step="1" value="${s.voteThresholdPct}" ${dis} /><span class="field-hint">50 = simple majority; 66.7 = two-thirds.</span></label>
          <label>Quorum (minimum votes cast)<input name="voteQuorum" type="number" min="1" step="1" value="${s.voteQuorum}" ${dis} /></label>
          ${benchmarkPicker("fundBench", s.benchmark, presets, { label: "Fund benchmark", disabled: !admin })}
          <span class="field-hint">Currently <strong>${esc(s.benchmarkLabel)}</strong>. The fund's official comparison for reports and the default for visitors. Each member can compare against something else with "Compare with" on Performance, Allocation and Research. Any Yahoo ticker works, or a blend like <code>SPY:60,AGG:40</code>.</span>
          ${admin ? `<button class="btn btn-primary">Save</button>` : member ? lockedHint("", "admin") : ""}
        </form>
        <form id="cashForm" class="stack-form">
          <label>Cash balance ($)<input name="cash" type="number" step="any" min="0" value="${s.cash}" ${trader ? "" : "disabled"} /><span class="field-hint">Normally kept up to date by the Transactions ledger and confirmed dividends.</span></label>
          ${trader ? `<button class="btn btn-ghost">Save cash</button>` : member ? lockedHint("", "trade") : ""}
        </form>
      </section>
      <section class="panel span-full" aria-labelledby="mem-h">
        <div class="panel-head"><h3 id="mem-h">Members</h3><span class="muted small">${admin ? "Share the sign-up link, or add people one at a time" : "Club members"}</span></div>
        ${!member ? `<p class="muted">Sign in to see the club's members.</p>` : admin ? `
          <div id="joinLinkBox"></div>
          <p class="pf-sub">Members</p>
          <div id="inviteOut"></div>
          <div class="table-scroll"><table class="mini-table members-table">
            <caption class="sr-only">Fund members and what they can do</caption>
            <thead><tr><th scope="col" class="left">Name</th><th scope="col" class="left">Email</th><th scope="col" class="left">Title</th><th scope="col">Admin</th><th scope="col">Can trade</th><th scope="col" class="left">Status</th><th scope="col" class="left">Last seen</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${members.map((m) => `<tr class="${m.active ? "" : "muted"}">
              <th scope="row" class="left"><a href="#/members/${m.id}">${esc(m.name)}</a></th>
              <td class="left small">${esc(m.email || "—")}</td>
              <td class="left"><label class="sr-only" for="title-${m.id}">Title for ${esc(m.name)}</label><input id="title-${m.id}" class="title-input" data-title="${m.id}" value="${esc(m.title || "")}" maxlength="60" /></td>
              <td><input type="checkbox" data-flag="isAdmin" data-id="${m.id}" ${m.isAdmin ? "checked" : ""} aria-label="${esc(m.name)} is an admin" /></td>
              <td><input type="checkbox" data-flag="canTrade" data-id="${m.id}" ${m.canTrade ? "checked" : ""} aria-label="${esc(m.name)} can trade" /></td>
              <td class="left small">${!m.active ? "Alumni" : m.hasPassword ? "Active" : "Invited (no password yet)"}</td>
              <td class="left small">${esc(m.lastSeenAt ? m.lastSeenAt.slice(0, 10) : "—")}</td>
              <td><div class="row-actions">
                ${m.active ? `<button class="btn btn-ghost btn-sm" data-invite="${m.id}" data-name="${esc(m.name)}">${m.hasPassword ? "Password reset link" : "New sign-in link"}</button>` : ""}
                <button class="btn btn-ghost btn-sm" data-active="${m.id}" data-to="${m.active ? 0 : 1}">${m.active ? "Mark alumni" : "Reactivate"}</button>
              </div></td>
            </tr>`).join("")}</tbody>
          </table></div>
          <form id="addMember" class="inline-form add-member">
            <label>Name <input name="name" required maxlength="80" autocomplete="off" /></label>
            <label>Email <input name="email" type="email" required autocomplete="off" /></label>
            <label>Title <input name="title" maxlength="60" placeholder="Analyst" /></label>
            <label class="check"><input type="checkbox" name="canTrade" /> Can trade</label>
            <label class="check"><input type="checkbox" name="isAdmin" /> Admin</label>
            <button class="btn btn-primary btn-sm">Add member</button>
          </form>
          <p class="muted small">"Can trade" lets someone change the real fund: holdings, trades, cash and dividends. Admins manage members and fund policy. Marking someone alumni signs them out everywhere and keeps their votes, notes and messages on record.</p>`
        : `<ul class="member-list">${members.filter((m) => m.active).map((m) => `<li><a href="#/members/${m.id}"><strong>${esc(m.name)}</strong></a> <span class="muted small">${esc(m.title || "")}</span></li>`).join("")}</ul>`}
      </section>
      ${admin ? `<section class="panel span-full" aria-labelledby="act-h">
        <div class="panel-head"><h3 id="act-h">Activity log</h3><span class="muted small">Every change to the fund, members and settings</span></div>
        ${activity.length ? `<ul class="activity-list">${activity.map((a) => `<li><span class="muted small">${esc(a.at.slice(0, 16).replace("T", " "))}</span> <strong>${esc(a.memberName || "System")}</strong> ${esc(activityText(a))}</li>`).join("")}</ul>` : `<p class="muted">No activity yet.</p>`}
      </section>` : ""}
      <section class="panel span-full" aria-labelledby="13f-h">
        <div class="panel-head"><h3 id="13f-h">13F tracker: managers followed</h3><a class="small" href="#/13f">Open tracker →</a></div>
        ${managers.length ? `
          <ul class="link-list">${managers.map((m) => `<li>${esc(m.name || m.cik)} <span class="muted small">(CIK ${esc(m.cik)})</span>${member ? ` <button class="btn-link small" data-del-manager="${esc(m.cik)}">Remove</button>` : ""}</li>`).join("")}</ul>`
          : `<p class="muted">No managers followed yet.</p>`}
        ${member ? `
          <form id="findManager" class="inline-form" role="search">
            <label>Find a manager by name <input name="q" required minlength="2" maxlength="80" placeholder="e.g. Bridgewater" autocomplete="off" /></label>
            <button class="btn btn-primary btn-sm">Search EDGAR</button>
          </form>
          <div id="managerResults" aria-live="polite"></div>
          <form id="addManager" class="inline-form">
            <label>Or add by CIK <input name="cik" required placeholder="e.g. 0001067983" maxlength="10" /></label>
            <label>Name <input name="name" placeholder="e.g. Berkshire Hathaway" maxlength="120" /></label>
            <button class="btn btn-ghost btn-sm">Follow</button>
          </form>
          <p class="muted small">Name search covers firms that file 13F-HR reports with the SEC. If it misses one, find the CIK on <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=13F-HR" target="_blank" rel="noopener">SEC EDGAR's 13F filer search<span class="sr-only"> (opens in new tab)</span></a>. Up to 20 managers.</p>` : ""}
      </section>
    </div>`;

  if (!member) return;

  const save = async (body, msg) => {
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      toast(msg, { type: "success" });
      mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
  };
  el("policyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const body = {};
    for (const [k, v] of new FormData(e.target).entries()) body[k] = v.trim() === "" ? null : Number(v); // blank = no limit
    save(body, "Policy limits saved.");
  });
  el("voteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    save({ voteThresholdPct: Number(f.get("voteThresholdPct")), voteQuorum: Number(f.get("voteQuorum")), benchmark: readBenchmark("fundBench") }, "Voting rules and benchmark saved.");
  });
  el("cashForm").addEventListener("submit", (e) => {
    e.preventDefault();
    save({ cash: Number(new FormData(e.target).get("cash")) }, "Cash saved.");
  });

  container.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast("Link copied.", { type: "success" }); }
      catch { copy.previousElementSibling?.select(); toast("Press Cmd/Ctrl+C to copy the selected link."); }
    }
  });

  if (admin) wireMembers(container);

  const followed = new Set(managers.map((m) => m.cik));
  el("findManager")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q").trim();
    const box = el("managerResults");
    box.innerHTML = `<p class="muted small">Searching EDGAR…</p>`;
    try {
      const { results } = await api(`/api/13f/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = results.length
        ? `<ul class="link-list">${results.map((m) => `<li>${esc(m.name)} <span class="muted small">(CIK ${esc(m.cik)})</span> ${followed.has(m.cik) ? `<span class="muted small">Following</span>` : `<button type="button" class="btn-link small" data-follow-cik="${esc(m.cik)}" data-follow-name="${esc(m.name)}">Follow</button>`}</li>`).join("")}</ul>`
        : `<p class="muted small">No 13F filer with “${esc(q)}” in its name. Try a shorter or different part of the name.</p>`;
    } catch (err) {
      box.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
    }
  });
  el("managerResults")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-follow-cik]");
    if (!b) return;
    try {
      await api("/api/13f/managers", { method: "POST", body: JSON.stringify({ cik: b.dataset.followCik, name: b.dataset.followName }) });
      toast("Manager added.", { type: "success" });
      mount(container);
    } catch (err) { toast(err.message, { type: "error" }); }
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

// Admin members table: add, toggle access, titles, sign-in links, alumni.
async function wireJoinLink() {
  const box = el("joinLinkBox");
  if (!box) return;
  const draw = (link) => {
    box.innerHTML = joinLinkHtml(link);
    el("joinNew").addEventListener("click", async () => {
      if (link && !(await confirmAction({ title: "Make a new sign-up link?", body: "The current link stops working. Anyone who already joined keeps their account.", confirmLabel: "Make new link" }))) return;
      try { draw((await api("/api/auth/join-link", { method: "POST", body: JSON.stringify({ days: Number(el("joinDays").value) }) })).link); toast("New sign-up link ready. Copy it into the group chat.", { type: "success" }); } catch (err) { toast(err.message, { type: "error" }); }
    });
    el("joinOff")?.addEventListener("click", async () => {
      if (!(await confirmAction({ title: "Turn off the sign-up link?", body: "Nobody new can join with it. Existing accounts aren't affected.", confirmLabel: "Turn off", danger: true }))) return;
      try { await api("/api/auth/join-link", { method: "DELETE" }); draw(null); toast("Sign-up link turned off."); } catch (err) { toast(err.message, { type: "error" }); }
    });
  };
  try { draw((await api("/api/auth/join-link")).link); } catch (err) { box.innerHTML = `<p class="muted small">${esc(err.message)}</p>`; }
}

function wireMembers(container) {
  wireJoinLink();
  el("addMember").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { name: f.get("name"), email: f.get("email"), title: f.get("title") || "Analyst", canTrade: f.get("canTrade") === "on", isAdmin: f.get("isAdmin") === "on" };
    try {
      const r = await api("/api/members", { method: "POST", body: JSON.stringify(body) });
      await mount(container);
      el("inviteOut").innerHTML = inviteBox(r.member.name, r.inviteToken);
      el("inviteOut").querySelector("input").select();
    } catch (err) { toast(err.message, { type: "error" }); }
  });

  const tbody = container.querySelector(".members-table tbody");
  const update = async (id, body, msg) => {
    try { await api(`/api/members/${id}`, { method: "PUT", body: JSON.stringify(body) }); if (msg) toast(msg); return true; }
    catch (err) { toast(err.message, { type: "error" }); mount(container); return false; }
  };
  tbody.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.flag) await update(t.dataset.id, { [t.dataset.flag]: t.checked }, "Access updated.");
    if (t.dataset.title) await update(t.dataset.title, { title: t.value }, "Title updated.");
  });
  tbody.addEventListener("click", async (e) => {
    const inv = e.target.closest("[data-invite]");
    const activeBtn = e.target.closest("[data-active]");
    if (inv) {
      try {
        const r = await api(`/api/members/${inv.dataset.invite}/invite`, { method: "POST" });
        el("inviteOut").innerHTML = inviteBox(inv.dataset.name, r.inviteToken);
        el("inviteOut").scrollIntoView({ block: "nearest" });
        el("inviteOut").querySelector("input").select();
      } catch (err) { toast(err.message, { type: "error" }); }
    }
    if (activeBtn) {
      const to = activeBtn.dataset.to === "1";
      if (!to && !(await confirmAction({ title: "Mark as alumni?", body: "They'll be signed out everywhere and can't sign in again until reactivated. Their votes, notes and messages are kept.", confirmLabel: "Mark alumni" }))) return;
      if (await update(activeBtn.dataset.active, { active: to })) mount(container);
    }
  });
}
