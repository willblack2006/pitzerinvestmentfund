import { esc, pageHead } from "../shared.js";
import { GLOSSARY } from "../glossary.js";

export const title = "Glossary";

export async function mount(container) {
  const entries = Object.entries(GLOSSARY).sort((a, b) => a[1][0].localeCompare(b[1][0]));
  const list = (q) => {
    const n = q.trim().toLowerCase();
    const rows = n ? entries.filter(([, [name, def]]) => name.toLowerCase().includes(n) || def.toLowerCase().includes(n)) : entries;
    return rows.length
      ? `<dl class="glossary-list">${rows.map(([key, [name, def]]) => `<dt id="g-${esc(key)}">${esc(name)}</dt><dd>${esc(def)}</dd>`).join("")}</dl>`
      : `<p class="muted">No term matches "${esc(q)}".</p>`;
  };
  container.innerHTML = `
    ${pageHead("Glossary", "Plain-language definitions of the terms and scores used across the app. New to investing? <a href=\"#/learn\">Start here</a>.")}
    <section class="panel page-pad-panel">
      <label class="glossary-search">Find a term <input type="search" id="glossarySearch" autocomplete="off" placeholder="e.g. margin, beta, dividend" /></label>
      <div id="glossaryList" aria-live="polite">${list("")}</div>
    </section>`;
  container.querySelector("#glossarySearch").addEventListener("input", (e) => {
    container.querySelector("#glossaryList").innerHTML = list(e.target.value);
  });
  // A "#/glossary" link from a "?" popover has no anchor; scroll support for ids isn't needed.
}
