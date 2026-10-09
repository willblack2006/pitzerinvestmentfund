import { sessionReady, getPref } from "./shared.js";

function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/";
  return hash.split("/").filter(Boolean);
}

function matchRoute(routes, segments) {
  for (const [pattern, handler] of routes) {
    const patternParts = pattern.split("/").filter(Boolean);
    if (patternParts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) {
        params[patternParts[i].slice(1)] = decodeURIComponent(segments[i]);
      } else if (patternParts[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler, params };
  }
  return null;
}

// Which top-level nav section a route belongs to (each section groups several pages).
const SECTION_OF = {
  today: "today",
  "": "portfolio",
  performance: "portfolio",
  allocation: "portfolio",
  transactions: "portfolio",
  dividends: "portfolio",
  alerts: "portfolio",
  factors: "portfolio",
  research: "research",
  screener: "ideas",
  watchlist: "ideas",
  pitches: "ideas",
  "track-record": "ideas",
  "forced-sellers": "ideas",
  paper: "ideas",
  macro: "market",
  insiders: "market",
  "short-interest": "market",
  backtest: "market",
  "13f": "market",
  calendar: "market",
  "index-radar": "market",
  congress: "market",
  settings: "settings",
  account: "settings",
  notes: "settings",
  chat: "settings",
  inbox: "settings",
  members: "settings",
};

const SITE = "Pitzer Investment Fund";

export function initRouter(routeMap) {
  const routes = Object.entries(routeMap);
  const view = document.getElementById("view");
  const announcer = document.getElementById("routeAnnouncer");
  let firstRender = true;
  let renderToken = 0;

  async function render() {
    const token = ++renderToken;
    await sessionReady(); // know who's signed in before the first page draws
    // Your start page: opening the app's bare address goes to Today if you chose that.
    if (firstRender && !location.hash.replace(/^#\/?/, "") && getPref("startPage") === "today") {
      location.replace("#/today");
      return;
    }
    const segments = parseHash();
    const match = matchRoute(routes, segments);
    const section = SECTION_OF[segments[0] || ""];

    document.querySelectorAll("[data-section]").forEach((a) => {
      const active = a.dataset.section === section;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    if (!match) {
      document.title = `Page not found · ${SITE}`;
      view.innerHTML = `
        <div class="page-head"><h2 tabindex="-1">Page not found</h2></div>
        <p class="muted page-pad">That link doesn't match any page. Try
          <a href="#/">Portfolio</a>, <a href="#/research">Research</a>, or <a href="#/screener">Ideas</a>.</p>`;
      focusHeading();
      return;
    }

    view.innerHTML = "";
    view.setAttribute("aria-busy", "true");
    try {
      const handler = await loadHandler(match.handler);
      if (token !== renderToken) return; // user navigated away while the view's code was loading
      // Title up front too, so anything reading it mid-load (notes, chat snapshots) sees this page.
      const early = typeof handler.title === "function" ? handler.title(match.params) : handler.title;
      if (early) document.title = `${early} · ${SITE}`;
      await handler.mount(view, match.params);
    } catch (err) {
      if (token !== renderToken) return;
      view.innerHTML = `<div class="page-head"><h2 tabindex="-1">Something went wrong</h2></div>
        <p class="error">Failed to load this page: ${String(err.message).replace(/[<>&]/g, "")}</p>`;
    }
    if (token !== renderToken) return; // user navigated away mid-load
    view.setAttribute("aria-busy", "false");

    const handler = moduleCache.get(match.handler);
    const title = typeof handler?.title === "function" ? handler.title(match.params) : handler?.title;
    document.title = title ? `${title} · ${SITE}` : SITE;
    // On phones the tab bars scroll sideways; keep the current tab visible.
    for (const a of view.querySelectorAll(".subtabs [aria-current], .tabnav [aria-current]")) {
      const bar = a.parentElement, b = bar.getBoundingClientRect(), t = a.getBoundingClientRect();
      bar.scrollLeft += t.left - b.left - (b.width - t.width) / 2;
    }
    focusHeading();
  }

  // Route modules are dynamic imports (for code-splitting); resolve each loader once and
  // reuse the module after that, since a repeat dynamic import() is already cached by the
  // browser but still costs a microtask round trip we'd rather skip.
  const moduleCache = new Map();
  async function loadHandler(loader) {
    if (!moduleCache.has(loader)) moduleCache.set(loader, await loader());
    return moduleCache.get(loader);
  }

  // Move focus to the new page's heading so keyboard and screen-reader users land on the
  // content (not left at the top of the document) and hear which page loaded.
  function focusHeading() {
    if (firstRender) { firstRender = false; return; }
    const h = view.querySelector("h2");
    if (h) {
      h.setAttribute("tabindex", "-1");
      h.focus({ preventScroll: true });
      announcer.textContent = h.textContent.trim();
    } else {
      view.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }

  window.addEventListener("hashchange", render);
  render();
  return { rerender: render };
}
