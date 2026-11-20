// Full-page agent builder: #/agents/:slug/edit (open a saved agent) and #/agents/new/:template
// (start from a template). #/agents/new itself is the Agents page's Build tab.
import { pageHead, esc, can, lockedHint } from "../shared.js";

export const title = (p = {}) => (p.slug ? "Edit agent" : "New agent");

export async function mount(container, params = {}) {
  if (!can("ai")) { container.innerHTML = pageHead("Agent builder") + `<div class="toolbar">${lockedHint("Sign in to build agents.", "ai")}</div>`; return; }
  container.innerHTML = pageHead(params.slug ? "Edit agent" : "New agent", `Set what it watches, when it runs and what it does. <a href="#/agents/gallery">Gallery</a>`) + `<div class="page-pad" id="abRoot"></div>`;
  const { mountBuilder } = await import("../agentBuilder/builder.js");
  await mountBuilder(container.querySelector("#abRoot"), { slug: params.slug || null, template: params.template || null });
  if (params.slug) {
    const name = container.querySelector('[data-bind="meta.name"]')?.value;
    if (name) container.querySelector(".page-head h2").textContent = name;
  }
}
