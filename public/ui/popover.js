// Shared non-modal popover (W3C APG dialog pattern). Below 600px wide it renders as a bottom sheet.
// Nothing here touches document or window until openPopover() runs, so node tests can import it.

const MARGIN = 8;        // keep this far from the viewport edges
const GAP = 6;           // space between anchor and popover
const SHEET_BELOW = 600; // viewport width where the popover becomes a bottom sheet

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pure: where to put a popover of size popRect next to anchorRect inside viewport.
// placement is "bottom-start" | "bottom-end" | "top-start" | "top-end".
// Returns { top, left, side, maxHeight } in viewport (position: fixed) coordinates.
export function computePosition(anchorRect, popRect, viewport, placement = "bottom-start") {
  const [want, align = "start"] = String(placement).split("-");
  const roomBelow = viewport.height - anchorRect.bottom - GAP - MARGIN;
  const roomAbove = anchorRect.top - GAP - MARGIN;
  let side = want === "top" ? "top" : "bottom";
  // Flip when the preferred side is too short and the other side fits better.
  if (side === "bottom" && popRect.height > roomBelow && roomAbove > roomBelow) side = "top";
  else if (side === "top" && popRect.height > roomAbove && roomBelow > roomAbove) side = "bottom";
  const room = Math.max(0, side === "bottom" ? roomBelow : roomAbove);
  const height = Math.min(popRect.height, room);
  let top = side === "bottom" ? anchorRect.bottom + GAP : anchorRect.top - GAP - height;
  top = Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - height));

  let left = align === "end" ? anchorRect.right - popRect.width : anchorRect.left;
  left = Math.min(left, viewport.width - MARGIN - popRect.width);
  left = Math.max(MARGIN, left); // too wide for the screen: pin to the left margin
  return { top: Math.round(top), left: Math.round(left), side, maxHeight: Math.floor(room) };
}

const stack = []; // open popovers, outermost first
let uid = 0;

function closeUnrelated(anchor) {
  // Keep popovers that contain the new anchor (nesting); close the rest, innermost first.
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].el.contains(anchor)) break;
    stack[i].close({ returnFocus: false });
  }
}

export function openPopover({ anchor, content, label, placement = "bottom-start", onClose, width }) {
  const existing = stack.find((p) => p.anchor === anchor);
  if (existing) existing.close({ returnFocus: false });
  closeUnrelated(anchor);

  const host = anchor.closest("dialog[open]") || document.body;
  const id = `ui-pop-${++uid}`;
  const backdrop = document.createElement("div");
  backdrop.className = "ui-pop-backdrop";
  const el = document.createElement("div");
  el.className = "ui-pop";
  el.id = id;
  el.tabIndex = -1;
  el.setAttribute("role", "dialog");
  if (label) el.setAttribute("aria-label", label);
  if (width != null) el.style.setProperty("--ui-pop-w", typeof width === "number" ? `${width}px` : width);
  el.innerHTML = `<div class="ui-sheet-bar"><span class="ui-sheet-handle" aria-hidden="true"></span><button type="button" class="ui-sheet-close" aria-label="Close">×</button></div><div class="ui-pop-body"></div>`;
  const body = el.querySelector(".ui-pop-body");
  if (typeof content === "string") body.innerHTML = content;
  else if (content) body.append(content);
  host.append(backdrop, el);

  anchor.setAttribute("aria-expanded", "true");
  anchor.setAttribute("aria-controls", id);

  let closed = false;
  let frame = 0;

  function reposition() {
    if (closed) return;
    if (!anchor.isConnected) { handle.close({ returnFocus: false }); return; }
    const sheet = window.innerWidth < SHEET_BELOW;
    el.classList.toggle("is-sheet", sheet);
    backdrop.classList.toggle("is-on", sheet);
    if (sheet) { el.style.top = el.style.left = el.style.maxHeight = ""; return; }
    el.style.maxHeight = "";
    const r = el.getBoundingClientRect();
    const pos = computePosition(anchor.getBoundingClientRect(), { width: r.width, height: r.height },
      { width: document.documentElement.clientWidth, height: window.innerHeight }, placement);
    el.style.top = `${pos.top}px`;
    el.style.left = `${pos.left}px`;
    el.style.maxHeight = `min(70vh, ${pos.maxHeight}px)`;
    el.dataset.side = pos.side;
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reposition); };

  function onKey(e) {
    if (stack[stack.length - 1] !== handle) return; // only the innermost popover reacts
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close an enclosing <dialog>
      handle.close();
    } else if (e.key === "Tab" && el.contains(document.activeElement)) {
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function onPointerDown(e) {
    if (stack[stack.length - 1] !== handle) return;
    const t = e.target;
    if (el.contains(t) || anchor.contains(t)) return;
    // Let a click on another control keep its focus; otherwise go back to the anchor.
    handle.close({ returnFocus: !t.closest?.(FOCUSABLE) });
  }

  const handle = {
    el,
    anchor,
    reposition,
    close({ returnFocus = true } = {}) {
      if (closed) return;
      // Close anything nested inside this one first.
      const i = stack.indexOf(handle);
      while (i >= 0 && stack.length > i + 1) stack[stack.length - 1].close({ returnFocus: false });
      closed = true;
      if (i >= 0) stack.splice(i, 1);
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      const hadFocus = el.contains(document.activeElement) || document.activeElement === document.body;
      el.remove();
      backdrop.remove();
      anchor.setAttribute("aria-expanded", "false");
      anchor.removeAttribute("aria-controls");
      if (returnFocus && hadFocus && anchor.isConnected) anchor.focus();
      onClose?.();
    },
  };

  stack.push(handle);
  el.querySelector(".ui-sheet-close").addEventListener("click", () => handle.close());
  backdrop.addEventListener("click", () => handle.close());
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);

  reposition();
  const target = body.querySelector("[autofocus]") || body.querySelector('input[type="search"]') ||
    body.querySelector(FOCUSABLE) || el;
  target.focus({ preventScroll: true });
  return handle;
}

// Same as openPopover, but a second call for the same anchor closes it instead.
export function togglePopover(opts) {
  const open = stack.find((p) => p.anchor === opts.anchor);
  if (open) { open.close(); return null; }
  return openPopover(opts);
}
