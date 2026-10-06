// Shared rendering for the short-pressure "avoid" score (Research → Risk tab + Market ranking).
// Unlike the insider score (-100..+100, positive is good), this is 0..100 crowdedness: high is
// the "bad" (avoid) end, so the tone mapping runs the other way.
import { esc } from "../shared.js";

export function shortTone(score) {
  if (score >= 45) return "bad";
  if (score <= 20) return "good";
  return "neutral";
}

export function shortMeter(score) {
  return `<span class="sig-meter" aria-hidden="true"><span class="sig-dot tone-bg-${shortTone(score)}" style="left:${score}%"></span></span>`;
}

export function shortBadge(score, label) {
  return `<span class="sig-badge tone-${shortTone(score)}">${esc(label)} <span class="sig-num">${score}</span></span>`;
}
