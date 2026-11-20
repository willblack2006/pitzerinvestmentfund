// Agents → Ask PIF (WS11): conversations on the left (yours and the team's shared ones), the open
// conversation on the right. Same live conversation as the side panel. #/agents/ask?thread=12
// opens one directly.
import { icon, toast } from "../../shared.js";
import { mountConversation, threadList, threadListHtml, shareThread } from "../../askConversation.js";

export default {
  key: "ask", label: "Ask PIF", order: 20,
  async render(el, ctx) {
    const startId = Number(ctx.query.get("thread")) || null;
    el.innerHTML = `<div class="ask-page">
      <aside class="ask-page-side panel" aria-label="Conversations">
        <div class="ask-page-side-head"><button type="button" class="btn btn-primary btn-sm" id="askPageNew">${icon("plus", { size: 14 })} New conversation</button></div>
        <div class="segmented ask-scope" role="tablist" aria-label="Whose conversations">
          <button type="button" role="tab" aria-selected="true" data-scope="mine">Yours</button><button type="button" role="tab" aria-selected="false" data-scope="team">Team</button></div>
        <label class="sr-only" for="askPageSearch">Search conversations</label>
        <input id="askPageSearch" type="search" class="ask-page-search" placeholder="Search conversations" autocomplete="off" />
        <div id="askPageThreads"><p class="muted small">Loading…</p></div>
      </aside>
      <section class="ask-page-main panel" aria-labelledby="askPageTitle">
        <header class="ask-page-head"><h3 id="askPageTitle">New conversation</h3>
          <div class="ask-page-actions"><button type="button" class="btn btn-ghost btn-sm hidden" id="askPageShare">${icon("users", { size: 14 })} <span>Share with team</span></button></div></header>
        <div id="askPageConvo"></div>
      </section>
    </div>`;
    let scope = "mine", q = "";
    const threadsBox = el.querySelector("#askPageThreads");
    const shareBtn = el.querySelector("#askPageShare");
    const title = el.querySelector("#askPageTitle");
    const paintThreads = async () => {
      const list = await threadList(scope, { q, limit: 50 });
      threadsBox.innerHTML = list == null ? `<p class="error small">Couldn't load conversations.</p>`
        : list.length ? threadListHtml(list, { activeId: convo.state.thread?.id })
        : `<p class="muted small ask-threads-empty">${q ? "Nothing matches." : scope === "team" ? "Nobody has shared a conversation yet. Share one of yours and it shows up here and on the feed." : "Your conversations show up here. Ask something to start one."}</p>`;
    };
    let lastThreadId = null;
    const onChange = (st) => {
      const t = st.thread;
      title.textContent = t?.title || "New conversation";
      shareBtn.classList.toggle("hidden", !(t && t.mine) || st.busy);
      shareBtn.querySelector("span").textContent = t?.visibility === "team" ? "Shared with team" : "Share with team";
      shareBtn.setAttribute("aria-pressed", String(t?.visibility === "team"));
      if ((t?.id || null) !== lastThreadId) {
        lastThreadId = t?.id || null;
        history.replaceState(null, "", t ? `#/agents/ask?thread=${t.id}` : "#/agents/ask");
        paintThreads();
      }
    };
    const convo = mountConversation(el.querySelector("#askPageConvo"), { onChange, threadId: startId });
    paintThreads();
    el.querySelector("#askPageNew").addEventListener("click", () => convo.reset());
    shareBtn.addEventListener("click", async () => {
      const t = convo.state.thread;
      if (!t) return;
      try { convo.state.thread = await shareThread(t, t.visibility !== "team"); onChange(convo.state); paintThreads(); } catch (err) { toast(err.message, { type: "error" }); }
    });
    el.querySelector(".ask-scope").addEventListener("click", (e) => {
      const b = e.target.closest("[data-scope]");
      if (!b) return;
      scope = b.dataset.scope;
      el.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      paintThreads();
    });
    let t0;
    el.querySelector("#askPageSearch").addEventListener("input", (e) => { clearTimeout(t0); t0 = setTimeout(() => { q = e.target.value.trim(); paintThreads(); }, 200); });
    threadsBox.addEventListener("click", (e) => {
      const b = e.target.closest("[data-thread]");
      if (!b) return;
      convo.load(Number(b.dataset.thread));
      if (window.matchMedia("(max-width: 860px)").matches) el.querySelector(".ask-page-main").scrollIntoView({ behavior: "smooth" });
    });
    if (!startId) convo.focus();
  },
};
