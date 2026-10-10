import { el, esc, api, toast, setSession, loading, currentMember } from "../shared.js";

export const title = "Join the fund";

// Opened from the club's shared sign-up link: anyone with it makes their own account.
export async function mount(container, params) {
  container.innerHTML = loading("Checking the link…");
  try {
    await api(`/api/auth/join/${encodeURIComponent(params.token)}`);
  } catch (err) {
    container.innerHTML = `<div class="page-head"><h2 tabindex="-1">Link expired</h2></div>
      <div class="page-pad narrow"><p>${esc(err.message)}</p><p><a href="#/today">Go to the app →</a></p></div>`;
    return;
  }
  const me = currentMember();
  container.innerHTML = `
    <div class="page-head"><h2 tabindex="-1">Join the Pitzer Investment Fund</h2></div>
    <div class="page-pad narrow">
      ${me ? `<p class="notice small">You're already signed in as <strong>${esc(me.name)}</strong>. You don't need another account. <a href="#/today">Go to Today →</a></p>` : ""}
      <p>Create your account. Everyone starts as an <strong>Analyst</strong>: notes, the club chat, pitches and votes, watchlists and paper trading. Portfolio managers and admins are set later by an admin.</p>
      <form id="joinForm" class="stack-form" novalidate>
        <label>Your name <input name="name" required maxlength="80" autocomplete="name" placeholder="First and last name" /></label>
        <label>Email <input name="email" type="email" required autocomplete="email" placeholder="you@students.pitzer.edu" /></label>
        <label>Password (10+ characters) <input name="password" type="password" required minlength="10" autocomplete="new-password" /></label>
        <label>Confirm password <input name="confirm" type="password" required minlength="10" autocomplete="new-password" aria-describedby="joinError" /></label>
        <p class="error hidden" id="joinError" role="alert"></p>
        <button class="btn btn-primary">Create account</button>
      </form>
      <p class="muted small">Already have an account? <button type="button" class="btn-link" data-signin>Sign in</button></p>
    </div>`;
  el("joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const err = el("joinError");
    const fail = (m) => { err.textContent = m; err.classList.remove("hidden"); };
    if (f.password !== f.confirm) return fail("The passwords don't match.");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const r = await api(`/api/auth/join/${encodeURIComponent(params.token)}`, { method: "POST", body: JSON.stringify({ name: f.name, email: f.email, password: f.password }) });
      setSession({ member: r.member, setupNeeded: false });
      toast(`Welcome to the fund, ${r.member.name.split(" ")[0]}.`, { type: "success" });
      location.hash = "#/today";
    } catch (ex) { fail(ex.message); btn.disabled = false; }
  });
}
