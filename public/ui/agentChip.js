// Agent identity (WS11): one avatar, name and status dot used everywhere an agent appears, so the
// same agent always looks the same (its colour comes from its slug). Pure HTML strings; esc'd.
import { esc, icon } from "../shared.js";

const ICONS = new Set(["sparkle", "flask", "doc", "eye", "target", "trending-up", "briefcase", "alert", "calendar", "megaphone", "users", "chat", "flag", "star", "vote", "inbox", "percent", "search"]);
const STATUS = { active: "Active", paused: "Paused", archived: "Archived", suspended: "Suspended", running: "Running now" };

// Stable hue per agent (FNV-1a over the slug), spread so neighbours differ.
export function agentHue(slug = "") {
  let h = 2166136261;
  for (const c of String(slug)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 24) * 15;
}

const initials = (name = "") => String(name).split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "A";

export function agentAvatar(a = {}, { size = 28 } = {}) {
  const ic = ICONS.has(a.icon) ? a.icon : null;
  return `<span class="agent-avatar${a.kind === "builtin" ? " is-builtin" : ""}" style="--agent-hue:${agentHue(a.slug || a.name)};--agent-size:${size}px" aria-hidden="true">${ic ? icon(ic, { size: Math.round(size * 0.55) }) : esc(initials(a.name))}</span>`;
}

// <a> to the agent's profile (WS7 route) with avatar, name and an optional status dot.
// opts: { href, status: "running"|..., meta: "text after the name", compact }
export function agentChip(a = {}, { href, status = a.running ? "running" : a.status, meta = "", compact = false, size } = {}) {
  const link = href ?? (a.slug ? `#/agents/a/${encodeURIComponent(a.slug)}` : null);
  const dot = status && status !== "active" || a.running ? `<span class="agent-dot is-${esc(a.running ? "running" : status)}" title="${esc(STATUS[a.running ? "running" : status] || status)}"><span class="sr-only">${esc(STATUS[a.running ? "running" : status] || status)}</span></span>` : "";
  const inner = `${agentAvatar(a, { size: size || (compact ? 20 : 28) })}<span class="agent-chip-text"><span class="agent-chip-name">${esc(a.name || a.slug || "Agent")}</span>${meta ? `<span class="agent-chip-meta">${esc(meta)}</span>` : ""}</span>${dot}`;
  return link ? `<a class="agent-id${compact ? " is-compact" : ""}" href="${esc(link)}">${inner}</a>` : `<span class="agent-id${compact ? " is-compact" : ""}">${inner}</span>`;
}

export function memberChip(m = {}, { compact = true } = {}) {
  return `<span class="agent-id is-member${compact ? " is-compact" : ""}"><span class="agent-avatar is-member" style="--agent-size:${compact ? 20 : 28}px" aria-hidden="true">${esc(initials(m.name))}</span><span class="agent-chip-text"><span class="agent-chip-name">${esc(m.name || "Member")}</span></span></span>`;
}
