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

export function initRouter(routeMap) {
  const routes = Object.entries(routeMap);
  const view = document.getElementById("view");

  async function render() {
    const segments = parseHash();
    const match = matchRoute(routes, segments);
    document.querySelectorAll(".nav-link").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === `#/${segments[0] || ""}`);
    });
    if (!match) {
      view.innerHTML = `<p class="error">Page not found.</p>`;
      return;
    }
    view.innerHTML = "";
    try {
      await match.handler.mount(view, match.params);
    } catch (err) {
      view.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
    }
  }

  window.addEventListener("hashchange", render);
  render();
}
