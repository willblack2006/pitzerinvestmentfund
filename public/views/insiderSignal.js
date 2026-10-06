// Shared rendering for the insider signal score (research Ownership tab + Insiders page).
import { esc } from "../shared.js";

export const KIND_LABEL = { opportunistic: "Opportunistic", routine: "Routine", new: "New insider" };
export const KIND_HINT = {
  opportunistic: "Trades at irregular times — the kind research finds informative",
  routine: "Trades in the same month every year — ignored, carries no information",
  new: "Less than 3 years of trading history — counted at reduced weight",
};

export function signalTone(score) {
  if (score >= 25) return "good";
  if (score <= -25) return "bad";
  return "neutral";
}

// Horizontal -100…+100 meter with the midpoint marked; the label text carries the meaning.
export function scoreMeter(score) {
  const pos = (score + 100) / 2;
  return `<span class="sig-meter" aria-hidden="true"><span class="sig-mid"></span><span class="sig-dot tone-bg-${signalTone(score)}" style="left:${pos}%"></span></span>`;
}

export function signalBadge(score, label) {
  return `<span class="sig-badge tone-${signalTone(score)}">${esc(label)} <span class="sig-num">${score > 0 ? "+" : ""}${score}</span></span>`;
}

export function kindTag(kind) {
  return `<span class="kind-tag kind-${esc(kind)}" title="${esc(KIND_HINT[kind] || "")}">${esc(KIND_LABEL[kind] || kind)}</span>`;
}
