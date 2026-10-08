import { esc, pageHead } from "../shared.js";
import { GLOSSARY } from "../glossary.js";

export const title = "Glossary";

export async function mount(container) {
  const entries = Object.entries(GLOSSARY).sort((a, b) => a[1][0].localeCompare(b[1][0]));
  container.innerHTML = `
    ${pageHead("Glossary", "Plain-language definitions of the terms and scores used across the app.")}
    <section class="panel page-pad-panel">
      <dl class="glossary-list">${entries.map(([key, [name, def]]) => `<dt id="g-${esc(key)}">${esc(name)}</dt><dd>${esc(def)}</dd>`).join("")}</dl>
    </section>`;
}
