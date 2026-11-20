// #/feed: the team feed page (WS7). #/feed/:filter for a saved view (holdings, followed, mine,
// members, agents, high), #/feed/t/:symbol for one ticker's room, #/feed/item/:id for one thread.
import { esc, api, can, pageHead, lockedHint, errorState, skeleton } from "../shared.js";
import { mountFeed, mountRunning, filterBar, itemHtml, FILTERS } from "../feed/feedUi.js";

export const title = (p = {}) => (p.symbol ? `${p.symbol} room` : p.id ? "Feed thread" : "Team feed");

export async function mount(container, params = {}) {
  if (!can("member")) {
    container.innerHTML = pageHead("Team feed") + `<div class="toolbar">${lockedHint("Sign in to see what the team and its agents are doing.")}</div>`;
    return;
  }
  if (params.id) return mountThread(container, Number(params.id));
  if (params.symbol) return mountRoom(container, String(params.symbol).toUpperCase());
  const filter = FILTERS.some(([k]) => k === params.tab) ? params.tab : "all";
  renderFeedPage(container, { filter });
}

// Shared by the page and the Agents hub tab.
export async function renderFeedPage(container, { filter = "all", base = "#/feed", head = true } = {}) {
  container.innerHTML = (head ? pageHead("Team feed", "What every member and agent is doing, as it happens. Comment, react, or @ an agent to have it answer in the thread.",
    `<button type="button" class="btn btn-ghost btn-sm" id="feedMarkRead">Mark all read</button>`) : "")
    + `<div class="page-pad feed-page"><div class="feed-running hidden" id="feedRunning"></div><div id="feedFilters"></div><div id="feedStream"></div></div>`;
  const running = mountRunning(container.querySelector("#feedRunning"));
  const stream = container.querySelector("#feedStream");
  let ctl = null;
  const q = { filter, symbol: "", member: "" };
  const start = () => { ctl?.destroy(); ctl = mountFeed(stream, { query: { filter: q.filter, symbol: q.symbol, member: q.member } }); };
  const facets = await api("/api/feed/facets").catch(() => null);
  container.querySelector("#feedFilters").innerHTML = filterBar(filter, { base, facetsData: facets });
  container.querySelector("[data-feed-symbol]")?.addEventListener("change", (e) => { q.symbol = e.target.value; start(); });
  container.querySelector("[data-feed-member]")?.addEventListener("change", (e) => { q.member = e.target.value; start(); });
  container.querySelector("#feedMarkRead")?.addEventListener("click", async () => {
    const r = await api("/api/feed?limit=1").catch(() => null);
    if (r?.items[0]) await api("/api/feed/read", { method: "POST", body: JSON.stringify({ lastReadId: r.items[0].id }) });
    window.dispatchEvent(new Event("pif:feed-read"));
    start();
  });
  start();
  return { destroy: () => { ctl?.destroy(); running.stop(); } };
}

// One ticker's room: the feed filtered to the ticker, with links to its pages on the side.
function mountRoom(container, symbol) {
  container.innerHTML = pageHead(`${esc(symbol)} room`, `Everything the team and its agents posted about ${esc(symbol)}. <a href="#/feed">Whole feed</a>`)
    + `<div class="page-pad feed-room"><div id="roomStream"></div>
      <aside class="panel feed-room-side" aria-label="${esc(symbol)} links">
        <h3>${esc(symbol)}</h3>
        <ul class="feed-room-links">
          <li><a href="#/research/${encodeURIComponent(symbol)}">Research overview</a></li>
          <li><a href="#/research/${encodeURIComponent(symbol)}/thesis">Thesis and tripwires</a></li>
          <li><a href="#/notes">Notes</a></li>
        </ul>
        <div id="roomDossier"></div>
      </aside></div>`;
  mountFeed(container.querySelector("#roomStream"), { query: { symbol }, compact: false, markRead: false, emptyText: { title: `Nothing on ${symbol} yet`, body: "Agent briefs, shared answers, pitches and trades on this ticker will collect here." } });
  // "What our agents know" (WS5) when it exists.
  import("./research/dossierCard.js").then((m) => (m.renderDossierCard || m.default)?.(container.querySelector("#roomDossier"), symbol)).catch(() => {});
}

// One item with its thread open (links from notifications land here).
async function mountThread(container, id) {
  container.innerHTML = pageHead("Feed thread", `<a href="#/feed">Back to the team feed</a>`) + `<div class="page-pad feed-page" id="threadBody">${skeleton("cards", { rows: 1 })}</div>`;
  const body = container.querySelector("#threadBody");
  try { await api(`/api/feed/${id}`); } catch (err) { body.innerHTML = errorState({ title: "That post isn't there.", detail: "It may have been removed, or it belongs to a private agent." }); return; }
  const ctl = mountFeed(body, { query: { before: id + 1, limit: 1 }, compact: true, markRead: false, single: true });
  ctl.openThread(id);
}

export { itemHtml };
