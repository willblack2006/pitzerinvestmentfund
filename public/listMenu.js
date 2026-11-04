// "Lists" menu on a company's research page: tick the lists this ticker should be on.
import { esc, api, toast, invalidateContext, loadSession, icon } from "./shared.js";
import { openPopover } from "./ui/popover.js";

export async function openListMenu(button, symbol) {
  const menu = document.createElement("div");
  menu.id = "listMenu";
  menu.className = "list-menu";
  menu.innerHTML = `<p class="muted small list-menu-pad">Loading lists…</p>`;
  const pop = openPopover({ anchor: button, content: menu, label: "Add to lists", placement: "bottom-end", width: 300 });
  let lists;
  try { lists = (await api(`/api/watchlists?symbol=${encodeURIComponent(symbol)}`)).filter((l) => l.canEdit); } catch (err) { menu.innerHTML = `<p class="list-menu-pad small">${esc(err.message)}</p>`; pop.reposition(); return; }
  menu.innerHTML = `
    <p class="list-menu-pad"><strong>Lists with ${esc(symbol)}</strong></p>
    <div class="list-menu-items">${lists.map((l) => `<label class="check list-menu-item"><input type="checkbox" data-key="${esc(l.key)}" data-kind="${esc(l.kind)}" ${l.has ? "checked" : ""} />
      <span>${esc(l.name)} <span class="muted small">${l.kind === "custom" ? (l.visibility === "club" ? "shared" : "private") : l.kind === "fund" ? "fund" : "private"}</span></span></label>`).join("")}</div>
    <a class="list-menu-link small" href="#/watchlist">Manage lists / make a new one</a>`;
  pop.reposition();
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
        if (fb) { fb.setAttribute("aria-pressed", String(box.checked)); fb.innerHTML = `${icon(box.checked ? "star-filled" : "star", { size: 16 })}<span>${box.checked ? "Following" : "Follow"}</span>`; }
      }
      toast(`${symbol} ${box.checked ? "added to" : "removed from"} ${box.closest("label").querySelector("span").firstChild.textContent.trim()}.`);
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message, { type: "error" });
    } finally { box.disabled = false; }
  }));
  menu.querySelector("a").addEventListener("click", () => pop.close({ returnFocus: false }));
}
