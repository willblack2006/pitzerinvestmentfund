import { el, esc, api, toast, setSession, loading } from "../shared.js";

export const title = "Welcome";

// Opened from an admin's one-time link: set a password and you're signed in.
export async function mount(container, params) {
  container.innerHTML = loading("Checking your link…");
  let info;
  try {
    info = await api(`/api/auth/invite/${encodeURIComponent(params.token)}`);
  } catch (err) {
    container.innerHTML = `<div class="page-head"><h2 tabindex="-1">Link expired</h2></div>
      <div class="page-pad narrow"><p>${esc(err.message)}</p><p><a href="#/today">Go to the app →</a></p></div>`;
    return;
  }
  const reset = info.hasPassword;
  container.innerHTML = `
    <div class="page-head"><h2 tabindex="-1">${reset ? "Choose a new password" : `Welcome, ${esc(info.name.split(" ")[0])}`}</h2></div>
    <div class="page-pad narrow">
      <p>${reset ? "Set a new password for" : "Set a password to finish your account for"} <strong>${esc(info.email)}</strong>. You'll use your email and this password to sign in.</p>
      <form id="welcomeForm" class="stack-form">
        <label>Password (10+ characters) <input name="password" type="password" required minlength="10" autocomplete="new-password" /></label>
        <label>Confirm password <input name="confirm" type="password" required minlength="10" autocomplete="new-password" aria-describedby="welcomeError" /></label>
        <p class="error hidden" id="welcomeError" role="alert"></p>
        <button class="btn btn-primary">${reset ? "Save password and sign in" : "Create account"}</button>
      </form>
    </div>`;
  el("welcomeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = el("welcomeError");
    if (f.get("password") !== f.get("confirm")) { err.textContent = "The passwords don't match."; err.classList.remove("hidden"); return; }
    try {
      const r = await api(`/api/auth/invite/${encodeURIComponent(params.token)}`, { method: "POST", body: JSON.stringify({ password: f.get("password") }) });
      setSession({ member: r.member, setupNeeded: false });
      toast(reset ? "Password updated. You're signed in." : `Welcome to the fund, ${r.member.name.split(" ")[0]}.`, { type: "success" });
      location.hash = "#/today";
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  });
}
