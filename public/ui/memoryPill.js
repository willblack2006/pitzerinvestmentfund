// One shared-memory item (plan 3.3) as a small pill (WS11): what kind of note it is, the text,
// where it came from and when. Used on agent profiles, the dossier and answers that recalled it.
import { esc, icon, safeUrl } from "../shared.js";

const KIND = { fact: ["Fact", "check"], observation: ["Seen", "eye"], decision: ["Decision", "vote"], preference: ["Preference", "star"], open_question: ["Open question", "help"], prediction: ["Prediction", "target"] };

export function memoryPill(m = {}, { long = false } = {}) {
  const [label, ic] = KIND[m.kind] || ["Memory", "sparkle"];
  const text = String(m.text || "");
  const short = !long && text.length > 140 ? `${text.slice(0, 137)}…` : text;
  const when = m.asOf || (m.createdAt ? String(m.createdAt).slice(0, 10) : "");
  const src = m.sourceUrl ? (m.sourceUrl.startsWith("#") ? ` <a href="${esc(m.sourceUrl)}">source</a>` : ` <a href="${safeUrl(m.sourceUrl)}" target="_blank" rel="noopener">source<span class="sr-only"> (opens in a new tab)</span></a>`)
    : m.sourceRunId ? ` <a href="#/agents/runs/${Number(m.sourceRunId)}">run</a>` : "";
  return `<span class="memory-pill is-${esc(m.kind || "fact")}${m.status && m.status !== "active" ? " is-stale" : ""}" title="${esc(text)}">
    <span class="memory-kind">${icon(ic, { size: 12 })}${esc(label)}</span><span class="memory-text">${esc(short)}</span>${when || src ? `<span class="memory-meta">${esc(when)}${m.by ? ` · ${esc(m.by)}` : ""}${src}</span>` : ""}
  </span>`;
}
