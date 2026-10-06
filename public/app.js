import { el, esc, api, isUnlocked, toast, fundContext, getMember, setMember } from "./shared.js";
import { initRouter } from "./router.js";

// Each page's code only downloads when the user actually navigates there, instead of every
// view in the app loading up front (the old eager imports were the biggest contributor to
// slow first loads, especially on phones).
const router = initRouter({
  "/": () => import("./views/holdings.js"),
  "/performance": () => import("./views/performance.js"),
  "/allocation": () => import("./views/allocation.js"),
  "/transactions": () => import("./views/transactions.js"),
  "/alerts": () => import("./views/alerts.js"),
  "/factors": () => import("./views/factors.js"),
  "/research": () => import("./views/researchHome.js"),
  "/research/:symbol": () => import("./views/research.js"),
  "/research/:symbol/:tab": () => import("./views/research.js"),
  "/screener": () => import("./views/screener.js"),
  "/watchlist": () => import("./views/watchlist.js"),
  "/pitches": () => import("./views/pitches.js"),
  "/pitches/new": () => import("./views/pitch.js"),
  "/pitches/new/:symbol": () => import("./views/pitch.js"),
  "/pitches/:id": () => import("./views/pitch.js"),
  "/track-record": () => import("./views/trackRecord.js"),
  "/forced-sellers": () => import("./views/forcedSellers.js"),
  "/macro": () => import("./views/macro.js"),
  "/insiders": () => import("./views/insiders.js"),
  "/short-interest": () => import("./views/shortInterest.js"),
  "/backtest": () => import("./views/backtest.js"),
  "/13f": () => import("./views/thirteenF.js"),
  "/calendar": () => import("./views/calendar.js"),
  "/index-radar": () => import("./views/indexRadar.js"),
  "/settings": () => import("./views/settings.js"),
});

// ---- Edit lock (shared fund password) ----

function updateAuthUI() {
  const unlocked = isUnlocked();
  el("authStatus").textContent = unlocked ? "Editing on" : "";
  el("authStatus").classList.toggle("auth-on", unlocked);
  el("loginBtn").classList.toggle("hidden", unlocked);
  el("logoutBtn").classList.toggle("hidden", !unlocked);
}

let unlockReturnFocus = null;
function openUnlock() {
  unlockReturnFocus = document.activeElement;
  el("loginError").classList.add("hidden");
  el("loginForm").reset();
  el("loginDialog").showModal();
}

el("loginBtn").addEventListener("click", openUnlock);
el("loginCancelBtn").addEventListener("click", () => el("loginDialog").close());
el("confirmCancel").addEventListener("click", () => el("confirmDialog").close());

el("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("pif_edit_password");
  updateAuthUI();
  router.rerender();
  el("loginBtn").focus();
  toast("Editing locked.");
});

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = e.target.password.value;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error("bad password");
    sessionStorage.setItem("pif_edit_password", password);
    el("loginDialog").close();
    updateAuthUI();
    await router.rerender();
    (unlockReturnFocus?.isConnected && !unlockReturnFocus.closest(".hidden") ? unlockReturnFocus : el("logoutBtn")).focus();
    toast("Editing unlocked for this browser tab.", { type: "success" });
  } catch {
    el("loginError").classList.remove("hidden");
    e.target.password.select();
  }
});

window.addEventListener("pif:request-unlock", openUnlock);
window.addEventListener("pif:auth-expired", () => {
  updateAuthUI();
  toast("The edit password changed or expired — please unlock again.", {
    type: "error",
    action: { label: "Unlock", onClick: openUnlock },
  });
});

// ---- Member identity (individual PIN sign-in, for votes and authorship) ----

function updateMemberUI() {
  const m = getMember();
  el("memberBtn").textContent = m ? m.member.name.split(" ")[0] : "Sign in";
  el("memberBtn").setAttribute("aria-label", m ? `Signed in as ${m.member.name}` : "Member sign-in");
  el("memberBtn").classList.toggle("member-on", !!m);
}

async function openMemberSignIn() {
  if (getMember()) {
    const m = getMember().member;
    el("memberMenuBody").innerHTML = `<strong>${esc(m.name)}</strong> <span class="muted">(${esc(m.role)})</span>`;
    el("memberMenu").showModal();
    return;
  }
  el("memberError").classList.add("hidden");
  el("memberForm").reset();
  let list = [];
  try { list = (await api("/api/members")).filter((x) => x.active); } catch { /* ignore */ }
  el("memberSelect").innerHTML = list.length
    ? `<option value="">Choose your name…</option>${list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}`
    : `<option value="">No members yet — add them in Settings</option>`;
  el("memberDialog").showModal();
}

el("memberBtn").addEventListener("click", openMemberSignIn);
el("memberCancel").addEventListener("click", () => el("memberDialog").close());
el("memberMenuClose").addEventListener("click", () => el("memberMenu").close());
el("memberSignOut").addEventListener("click", async () => {
  try { await api("/api/members/logout", { method: "POST" }); } catch { /* ignore */ }
  setMember(null);
  el("memberMenu").close();
  toast("Signed out.");
});

el("memberForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (!f.get("memberId")) {
    el("memberError").textContent = "Choose your name.";
    el("memberError").classList.remove("hidden");
    return;
  }
  try {
    const res = await fetch("/api/members/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: Number(f.get("memberId")), pin: f.get("pin") }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Sign-in failed.");
    setMember(body);
    el("memberDialog").close();
    toast(`Signed in as ${body.member.name}.`, { type: "success" });
  } catch (err) {
    el("memberError").textContent = err.message;
    el("memberError").classList.remove("hidden");
    e.target.pin.select();
  }
});

window.addEventListener("pif:request-member", openMemberSignIn);
window.addEventListener("pif:member-changed", () => { updateMemberUI(); router.rerender(); });

document.body.addEventListener("click", (e) => {
  if (e.target.closest("[data-unlock]")) openUnlock();
  if (e.target.closest("[data-member-signin]")) openMemberSignIn();
});

// ---- Alerts badge (count of items needing action) ----

async function refreshAlertBadge() {
  try {
    const { alerts: list } = await api("/api/alerts");
    const n = list.filter((a) => a.level === "action").length;
    el("alertCount").textContent = n > 9 ? "9+" : String(n);
    el("alertCount").classList.toggle("hidden", !n);
    el("alertsLink").setAttribute("aria-label", n ? `Alerts: ${n} need action` : "Alerts");
  } catch { /* badge is best-effort */ }
}

// ---- Global ticker search ----

async function refreshTickerOptions() {
  const ctx = await fundContext();
  const opts = [
    ...ctx.positions.map((p) => [p.symbol, "Owned"]),
    ...ctx.watchlist.filter((w) => !ctx.owned.has(w.symbol)).map((w) => [w.symbol, "Watching"]),
  ];
  el("tickerOptions").innerHTML = opts.map(([s, label]) => `<option value="${esc(s)}">${label}</option>`).join("");
}
window.addEventListener("pif:context-changed", refreshTickerOptions);

el("jumpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const symbol = el("jumpInput").value.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
  if (!symbol) {
    el("jumpInput").focus();
    return;
  }
  location.hash = `#/research/${encodeURIComponent(symbol)}`;
  el("jumpInput").value = "";
  el("jumpInput").blur();
});

// "/" focuses search from anywhere (unless already typing in a field).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
  e.preventDefault();
  el("jumpInput").focus();
});

updateAuthUI();
updateMemberUI();
refreshTickerOptions();
refreshAlertBadge();
setInterval(refreshAlertBadge, 10 * 60 * 1000);
