import {
  esc, api, fmtUSD, fmtPct, signed, can, toast, confirmAction, lockedHint, pageHead, loading, errorBox, subTabs, invalidateContext, loadSession,
} from "../shared.js";
import { IDEAS_TABS } from "./screener.js";
import { openPositionDialog } from "./holdings.js";
import { crowdingPanelHtml, loadCrowdingPanel } from "./crowdingPanel.js";
import { noteCounts, noteMarker } from "../notes.js";

export const title = "Watchlists";

// Lists: Fund holdings (default, automatic), Fund watchlist, your Following list, and lists
// members make: private, or shared with the club (anyone can add to a shared list).
let lists = [];
let current = null; // { list, items }
let quotes = {};
let noteMap = {};
let showNew = false;

const icon = (l) => (l.kind === "holdings" ? "💼" : l.kind === "fund" ? "👀" : l.kind === "following" ? "★" : l.visibility === "club" ? "👥" : "🔒");
const who = (l) => (l.kind === "custom" ? (l.visibility === "club" ? `Shared with the club${l.owner ? ` · made by ${l.mine ? "you" : l.owner}` : ""}` : "Only you can see this") : "");

function picker(activeKey) {
  const group = (label, items) => (items.length ? `<p class="list-group-label">${esc(label)}</p>${items.map((l) => `
    <a class="list-tab" href="#/watchlist/${encodeURIComponent(l.key)}" ${l.key === activeKey ? 'aria-current="page"' : ""}>
      <span aria-hidden="true">${icon(l)}</span><span class="list-tab-name">${esc(l.name)}</span><span class="list-count">${l.count}</span>
    </a>`).join("")}` : "");
  return `<nav class="list-picker" aria-label="Lists">
    ${group("Fund", lists.filter((l) => l.kind === "holdings" || l.kind === "fund"))}
    ${group("Yours", lists.filter((l) => l.kind === "following" || (l.kind === "custom" && l.mine)))}
    ${group("Shared by others", lists.filter((l) => l.kind === "custom" && !l.mine))}
    ${can("member") ? `<button type="button" class="btn btn-ghost btn-sm list-new-btn" id="newListBtn" aria-expanded="${showNew}">+ New list</button>` : ""}
  </nav>`;
}

function newListForm() {
  return `<form id="newListForm" class="panel new-list ${showNew ? "" : "hidden"}" novalidate>
    <h3>New list</h3>
    <label class="field-inline">Name <input name="name" maxlength="60" required placeholder="e.g. Consumer names, Earnings plays" /></label>
    <fieldset class="vis-choice"><legend class="sr-only">Who can see it</legend>
      <label class="check"><input type="radio" name="visibility" value="private" checked /> 🔒 Private: only you</label>
      <label class="check"><input type="radio" name="visibility" value="club" /> 👥 Shared: everyone in the club can see it and add to it</label>
    </fieldset>
    <label class="field-inline">Description <input name="description" maxlength="300" placeholder="Optional" /></label>
    <div><button class="btn btn-primary btn-sm">Create list</button> <button type="button" class="btn btn-ghost btn-sm" id="cancelNew">Cancel</button></div>
  </form>`;
}

function listHead() {
  const l = current.list;
  const meta = lists.find((x) => x.key === l.key) || l;
  return `<div class="list-head">
    <div>
      <h3 id="listTitle">${icon(meta)} ${esc(meta.name)}</h3>
      <p class="muted small">${esc(meta.description || "")}${meta.description && who(meta) ? " · " : ""}${esc(who(meta))}</p>
    </div>
    ${meta.canManage ? `<div class="row-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-act="rename">Rename</button>
      ${meta.mine ? `<button type="button" class="btn btn-ghost btn-sm" data-act="visibility">${meta.visibility === "club" ? "Make private" : "Share with the club"}</button>` : ""}
      <button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete list</button>
    </div>` : ""}
  </div>
  ${meta.canEdit ? `<form id="addItemForm" class="inline-form add-item" novalidate>
    <label class="sr-only" for="addSym">Ticker to add</label><input id="addSym" name="symbol" placeholder="Ticker" maxlength="12" autocomplete="off" autocapitalize="characters" style="width:100px" />
    ${meta.kind === "following" ? "" : `<label class="sr-only" for="addNote">Note</label><input id="addNote" name="note" placeholder="Why it's here (optional)" maxlength="200" />`}
    <button class="btn btn-primary btn-sm">Add</button>
  </form>` : current.list.kind === "holdings" ? "" : !can("member") ? lockedHint("Sign in to make your own lists and add to shared ones.") : ""}`;
}

function rowsHtml() {
  const l = current.list;
  const editable = (lists.find((x) => x.key === l.key) || l).canEdit;
  const trader = can("trade") && l.kind !== "holdings";
  const dated = current.items.some((i) => i.addedAt);
  return current.items.map((r) => {
    const q = quotes[r.symbol];
    return `<tr>
      <th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a>${noteMarker(r.symbol, noteMap)}</th>
      <td>${q ? fmtUSD(q.price) : `<span class="muted">—</span>`}</td>
      <td>${q?.changePct != null ? signed(q.changePct, fmtPct(q.changePct)) : `<span class="muted">—</span>`}</td>
      <td class="left muted small">${esc(r.note || "—")}</td>
      ${dated ? `<td class="left small">${r.addedAt ? esc(r.addedAt.slice(0, 10)) : "—"}${r.addedBy ? `<div class="muted">${esc(r.addedBy)}</div>` : ""}</td>` : ""}
      <td><div class="row-actions">
        <a class="btn btn-ghost btn-sm" href="#/research/${encodeURIComponent(r.symbol)}" aria-label="Research ${esc(r.symbol)}">Research</a>
        ${trader ? `<button class="btn btn-ghost btn-sm" data-buy="${esc(r.symbol)}" aria-label="Add ${esc(r.symbol)} to the fund's holdings">Add to holdings</button>` : ""}
        ${editable ? `<button class="btn btn-danger btn-sm" data-remove="${esc(r.symbol)}" aria-label="Remove ${esc(r.symbol)} from ${esc(l.name)}">Remove</button>` : ""}
      </div></td></tr>`;
  }).join("");
}

function emptyHtml() {
  const k = current.list.kind;
  if (k === "holdings") return `<p class="muted page-pad">The fund doesn't own anything yet.</p>`;
  if (k === "following") return `<div class="empty-state"><p class="empty-title">You're not following anything yet</p><p class="muted">Add a ticker above, or use ☆ Follow on any company's research page. Followed tickers show up in "For you" on Today.</p></div>`;
  if (k === "fund") return `<div class="empty-state"><p class="empty-title">Nothing on the fund watchlist yet</p><p class="muted">Add candidates from Discovery or any research page, then build the thesis before pitching.</p><p><a class="btn btn-primary" href="#/screener">Find ideas in Discovery</a></p></div>`;
  return `<div class="empty-state"><p class="empty-title">This list is empty</p><p class="muted">Add a ticker above, or use "Lists" on any company's research page.</p></div>`;
}

function renderList(container) {
  const box = container.querySelector("#listBody");
  if (!box) return;
  box.innerHTML = `${listHead()}
    ${current.items.length ? `<div class="table-wrap"><table>
      <caption class="sr-only">${esc(current.list.name)}</caption>
      <thead><tr><th scope="col" class="left">Ticker</th><th scope="col">Price</th><th scope="col">Day</th><th scope="col" class="left">${current.list.kind === "holdings" ? "Position" : "Note"}</th>${current.items.some((i) => i.addedAt) ? `<th scope="col" class="left">Added</th>` : ""}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rowsHtml()}</tbody></table></div>` : emptyHtml()}`;
}

async function loadList(container, key) {
  const box = container.querySelector("#listBody");
  box.innerHTML = loading("Loading the list…");
  try {
    current = await api(`/api/watchlists/${encodeURIComponent(key)}`);
  } catch (err) {
    box.innerHTML = errorBox(err.code === "signin_required" ? "Sign in to see members' lists." : err.message, false);
    return;
  }
  quotes = {};
  renderList(container);
  if (current.items.length) {
    api(`/api/quotes?symbols=${encodeURIComponent(current.items.map((r) => r.symbol).join(","))}`)
      .then((r) => { quotes = r.quotes; if (current?.list.key === key) renderList(container); })
      .catch(() => { /* prices stay blank */ });
  }
  const crowd = container.querySelector("#crowdWrap");
  crowd.innerHTML = key === "fund" && current.items.length ? crowdingPanelHtml("crowdPanel") : "";
  if (key === "fund" && current.items.length) loadCrowdingPanel("crowdPanel", "watchlist");
}

async function refreshLists(container, key) {
  lists = await api("/api/watchlists");
  container.querySelector("#pickerWrap").innerHTML = picker(key);
}

export async function mount(container, params = {}) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/watchlist") + loading("Loading watchlists…");
  try { lists = await api("/api/watchlists"); } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/watchlist") + pageHead("Watchlists") + errorBox(`Could not load watchlists: ${err.message}`);
    return;
  }
  const key = lists.some((l) => l.key === params.key) ? params.key : "holdings";
  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/watchlist")}
    ${pageHead("Watchlists", "The fund's holdings and watchlist, your own lists, and lists members share with the club.")}
    <div class="lists-layout">
      <div id="pickerWrap">${picker(key)}</div>
      <div class="lists-main">
        ${can("member") ? newListForm() : ""}
        <section id="listBody" aria-labelledby="listTitle"></section>
        <div id="crowdWrap"></div>
      </div>
    </div>`;
  noteCounts().then((m) => { noteMap = m; if (current) renderList(container); });
  await loadList(container, key);
  // Listen on this page's own wrapper (rebuilt on every visit), not the shared #view element.
  const root = container.querySelector(".lists-layout");
  if (!root) return;

  root.addEventListener("click", async (e) => {
    if (e.target.closest("#newListBtn")) {
      showNew = !showNew;
      container.querySelector("#newListForm").classList.toggle("hidden", !showNew);
      e.target.closest("#newListBtn").setAttribute("aria-expanded", String(showNew));
      if (showNew) container.querySelector("#newListForm [name=name]").focus();
      return;
    }
    if (e.target.closest("#cancelNew")) { showNew = false; container.querySelector("#newListForm").classList.add("hidden"); return; }
    const l = current?.list;
    const meta = lists.find((x) => x.key === l?.key);
    const act = e.target.closest("[data-act]")?.dataset.act;
    try {
      if (act === "rename") {
        const h = container.querySelector("#listTitle");
        h.innerHTML = `<form id="renameForm" class="inline-form"><label class="sr-only" for="renameInput">List name</label><input id="renameInput" value="${esc(meta.name)}" maxlength="60" /><button class="btn btn-primary btn-sm">Save</button></form>`;
        container.querySelector("#renameInput").focus();
        container.querySelector("#renameForm").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try {
            await api(`/api/watchlists/${meta.id}`, { method: "PUT", body: JSON.stringify({ name: container.querySelector("#renameInput").value }) });
            await refreshLists(container, l.key); renderList(container);
          } catch (err) { toast(err.message, { type: "error" }); }
        });
      }
      if (act === "visibility") {
        const to = meta.visibility === "club" ? "private" : "club";
        const ok = await confirmAction({ title: to === "club" ? `Share "${meta.name}" with the club?` : `Make "${meta.name}" private?`, body: to === "club" ? "Everyone signed in will see it and can add or remove tickers. You stay the only one who can rename or delete it." : "Only you will see it. Tickers others added stay on it.", confirmLabel: to === "club" ? "Share" : "Make private" });
        if (!ok) return;
        await api(`/api/watchlists/${meta.id}`, { method: "PUT", body: JSON.stringify({ visibility: to }) });
        await refreshLists(container, l.key); renderList(container);
      }
      if (act === "delete") {
        const ok = await confirmAction({ title: `Delete "${meta.name}"?`, body: `Its ${meta.count} ticker${meta.count === 1 ? "" : "s"} come off this list (nothing else changes). This can't be undone.`, confirmLabel: "Delete list", danger: true });
        if (!ok) return;
        await api(`/api/watchlists/${meta.id}`, { method: "DELETE" });
        toast("List deleted.");
        location.hash = "#/watchlist/holdings";
      }
      const rm = e.target.closest("[data-remove]")?.dataset.remove;
      if (rm) {
        const item = current.items.find((i) => i.symbol === rm);
        await api(`/api/watchlists/${encodeURIComponent(l.key)}/items/${encodeURIComponent(rm)}`, { method: "DELETE" });
        if (l.kind === "fund") invalidateContext();
        if (l.kind === "following") loadSession();
        current.items = current.items.filter((i) => i.symbol !== rm);
        await refreshLists(container, l.key); renderList(container);
        toast(`${rm} removed from ${l.name}.`, { action: { label: "Undo", onClick: async () => {
          await api(`/api/watchlists/${encodeURIComponent(l.key)}/items`, { method: "POST", body: JSON.stringify({ symbol: rm, note: item?.note || "" }) });
          if (l.kind === "fund") invalidateContext();
          if (container.isConnected) { await refreshLists(container, l.key); await loadList(container, l.key); }
        } } });
      }
      const buy = e.target.closest("[data-buy]")?.dataset.buy;
      if (buy) openPositionDialog(null, { symbol: buy, notes: current.items.find((i) => i.symbol === buy)?.note || "" });
    } catch (err) { toast(err.message, { type: "error" }); }
  });

  root.addEventListener("submit", async (e) => {
    if (e.target.id === "newListForm") {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      try {
        const made = await api("/api/watchlists", { method: "POST", body: JSON.stringify(f) });
        showNew = false;
        toast(`Created "${made.name}".`, { type: "success" });
        location.hash = `#/watchlist/${made.id}`;
      } catch (err) { toast(err.message, { type: "error" }); }
    }
    if (e.target.id === "addItemForm") {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      const l = current.list;
      try {
        await api(`/api/watchlists/${encodeURIComponent(l.key)}/items`, { method: "POST", body: JSON.stringify({ symbol: f.symbol, note: f.note || "", sourcedFrom: "watchlists page" }) });
        if (l.kind === "fund") invalidateContext();
        if (l.kind === "following") loadSession();
        await refreshLists(container, l.key);
        await loadList(container, l.key);
        container.querySelector("#addSym")?.focus();
      } catch (err) { toast(err.message, { type: "error" }); }
    }
  });
}
