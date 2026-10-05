import { el, isUnlocked } from "./shared.js";
import { initRouter } from "./router.js";
import * as holdings from "./views/holdings.js";
import * as research from "./views/research.js";
import * as macro from "./views/macro.js";

initRouter({
  "/": holdings,
  "/research/:symbol": research,
  "/macro": macro,
});

function updateAuthUI() {
  const unlocked = isUnlocked();
  el("authStatus").textContent = unlocked ? "Editing unlocked" : "Viewing only";
  el("loginBtn").classList.toggle("hidden", unlocked);
  el("logoutBtn").classList.toggle("hidden", !unlocked);
}

el("loginBtn").addEventListener("click", () => {
  el("loginError").classList.add("hidden");
  el("loginDialog").showModal();
});
el("loginCancelBtn").addEventListener("click", () => el("loginDialog").close());
el("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("pif_edit_password");
  updateAuthUI();
  window.dispatchEvent(new HashChangeEvent("hashchange"));
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
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } catch {
    el("loginError").classList.remove("hidden");
  }
});

el("jumpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const symbol = el("jumpInput").value.trim().toUpperCase();
  if (symbol) {
    location.hash = `#/research/${symbol}`;
    el("jumpInput").value = "";
  }
});

updateAuthUI();
