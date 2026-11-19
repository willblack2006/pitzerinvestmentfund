import { esc, api, pageHead, getPref, setPref, can, icon, skeleton, errorState, bindRetry, requestSignIn } from "../shared.js";
import { term } from "../glossary.js";
import { LESSONS, learnSummary } from "../learnContent.js";

export const title = "Start here";

function lessonHtml(l, done, read, open) {
  const isRead = read.includes(l.id);
  const doneCount = l.actions.filter((a) => a.done && done[a.done]).length;
  const autoCount = l.actions.filter((a) => a.done).length;
  return `<details class="panel learn-lesson" data-lesson="${esc(l.id)}"${open ? " open" : ""}>
    <summary class="learn-sum">
      <span class="learn-check${isRead && doneCount === autoCount ? " is-done" : ""}" aria-hidden="true">${isRead && doneCount === autoCount ? icon("check", { size: 14 }) : ""}</span>
      <span class="learn-title">${esc(l.title)}</span>
      <span class="muted small">${l.minutes} min${autoCount ? ` · ${doneCount}/${autoCount} done in the app` : ""}${isRead ? " · read" : ""}</span>
    </summary>
    <div class="learn-body">
      <p>${esc(l.intro)}</p>
      <ul class="learn-points">${l.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="small learn-terms"><span class="muted">Terms:</span> ${l.terms.map((t) => `<span class="learn-term">${term(t)}</span>`).join(" ")}</p>
      <ul class="learn-actions">${l.actions.map((a) => `<li>${a.done ? `<span class="learn-check small${done[a.done] ? " is-done" : ""}" role="img" aria-label="${done[a.done] ? "Done" : "Not done yet"}">${done[a.done] ? icon("check", { size: 12 }) : ""}</span>` : `<span class="learn-bullet" aria-hidden="true">→</span>`}<a href="${esc(a.href)}">${esc(a.label)}</a></li>`).join("")}</ul>
      <div class="learn-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-read="${esc(l.id)}" aria-pressed="${isRead}">${isRead ? "Mark as unread" : "Mark as read"}</button>
        ${can("ai") ? `<button type="button" class="btn btn-ghost btn-sm" data-ask="${esc(l.ask)}">${icon("sparkle", { size: 14 })} Ask PIF to explain</button>` : ""}
      </div>
    </div>
  </details>`;
}

export async function mount(container) {
  if (!can("member")) {
    container.innerHTML = `${pageHead("Start here", "A short path from new member to your first pitch.")}
      <div class="page-pad narrow"><p>Sign in to follow the path. Your progress is kept with your account.</p><button type="button" class="btn btn-primary" id="learnSignIn">Sign in</button>
      <p class="small muted">No account yet? Ask an admin for the club's sign-up link. You can read the <a href="#/glossary">glossary</a> without one.</p></div>`;
    container.querySelector("#learnSignIn").addEventListener("click", () => requestSignIn());
    return;
  }
  container.innerHTML = skeleton("cards", { rows: 3, label: "Loading your progress" });
  let done;
  try { done = (await api("/api/learn/progress")).done; } catch (err) {
    container.innerHTML = errorState({ title: "Couldn't load your progress.", detail: err.message, retryId: "learn" });
    bindRetry(container, "learn", () => mount(container));
    return;
  }
  const render = () => {
    const read = getPref("learnRead", []);
    const sum = learnSummary(done, read);
    const openId = sum.next?.id;
    container.innerHTML = `
      ${pageHead("Start here", "Seven short lessons, in the order a new analyst needs them. The checks fill in as you do things in the app.")}
      <div class="page-pad narrow learn">
        <div class="panel learn-progress">
          <div class="learn-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${sum.total}" aria-valuenow="${sum.count}" aria-label="Progress"><span style="width:${sum.pct}%"></span></div>
          <p class="small">${sum.finished ? "You've been through the whole path. Keep going with real pitches and votes." : `${sum.count} of ${sum.total} steps done${sum.next ? `. Next: <strong>${esc(sum.next.title)}</strong>` : ""}.`}
            <a href="#/glossary">Glossary</a></p>
        </div>
        ${LESSONS.map((l) => lessonHtml(l, done, read, l.id === openId)).join("")}
        <p class="muted small">Educational material, not investment advice. Paper trades use virtual money.</p>
      </div>`;
    container.querySelectorAll("[data-read]").forEach((b) => b.addEventListener("click", async (e) => {
      e.preventDefault();
      const id = b.dataset.read;
      const cur = getPref("learnRead", []);
      const openNow = [...container.querySelectorAll("details[open]")].map((d) => d.dataset.lesson);
      await setPref("learnRead", cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      render();
      container.querySelectorAll("details").forEach((d) => { d.open = openNow.includes(d.dataset.lesson); });
    }));
  };
  render();
}
