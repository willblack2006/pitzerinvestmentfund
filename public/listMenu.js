// "Lists" menu on a company's research page: tick the lists this ticker should be on.
import { esc, api, toast, invalidateContext, loadSession } from "./shared.js";

let menu = null;

export async function openListMenu(button, symbol) {
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "listMenu";
    menu.className = "account-menu list-menu";
    menu.setAttribute("popover", "");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Add to lists");
    document.body.append(menu);
  }
  menu.innerHTML = `<p class="muted small list-menu-pad">Loading lists…</p>`;
  const r = button.getBoundingClientRect();
  Object.assign(menu.style, { top: `${Math.min(r.bottom + 6, innerHeight - 100)}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 300))}px`, right: "auto" });
  menu.showPopover();
  let lists;
  try { lists = (await api(`/api/watchlists?symbol=${encodeURIComponent(symbol)}`)).filter((l) => l.canEdit); } catch (err) { menu.innerHTML = `<p class="list-menu-pad small">${esc(err.message)}</p>`; return; }
  menu.innerHTML = `
    <p class="list-menu-pad"><strong>Lists with ${esc(symbol)}</strong></p>
    <div class="list-menu-items">${lists.map((l) => `<label class="check list-menu-item"><input type="checkbox" data-key="${esc(l.key)}" data-kind="${esc(l.kind)}" ${l.has ? "checked" : ""} />
      <span>${esc(l.name)} <span class="muted small">${l.kind === "custom" ? (l.visibility === "club" ? "shared" : "private") : l.kind === "fund" ? "fund" : "private"}</span></span></label>`).join("")}</div>
    <a class="account-item small" href="#/watchlist">Manage lists / make a new one →</a>`;
  menu.querySelectorAll("[data-key]").forEach((box) => box.addEventListener("change", async () => {
    const key = box.dataset.key, kind = box.dataset.kind;
    box.disabled = true;
    try {
      if (box.checked) await api(`/api/watchlists/${encodeURIComponent(key)}/items`, { method: "POST", body: JSON.stringify({ symbol, sourcedFrom: "research page" }) });
      else await api(`/api/watchlists/${encodeURIComponent(key)}/items/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      if (kind === "fund") invalidateContext();
      if (kind === "following") {
        loadSession();
        const fb = document.getElementById("followBtn"); // the Follow button beside the menu
        if (fb) { fb.setAttribute("aria-pressed", String(box.checked)); fb.textContent = box.checked ? "★ Following" : "☆ Follow"; }
      }
      toast(`${symbol} ${box.checked ? "added to" : "removed from"} ${box.closest("label").querySelector("span").firstChild.textContent.trim()}.`);
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message, { type: "error" });
    } finally { box.disabled = false; }
  }));
  menu.querySelector("a").addEventListener("click", () => menu.hidePopover());
}
