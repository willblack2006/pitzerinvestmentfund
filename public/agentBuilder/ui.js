// Small pieces shared by the builder and the gallery: agent icons and colours, status dots,
// the stylesheet loader, and a "the engine isn't installed yet" notice.
import { esc, icon } from "../shared.js";

// Icons a member can pick for an agent (all in public/icons.svg). The engine's default "bot"
// has no sprite of its own, so it draws as the sparkle.
export const AGENT_ICONS = ["sparkle", "flask", "target", "eye", "bell", "alert", "doc", "trending-up", "trending-down", "calendar", "users", "megaphone", "briefcase", "flag", "star", "percent"];
export const agentIcon = (name) => (AGENT_ICONS.includes(name) ? name : "sparkle");

// A stable colour per agent so the same agent looks the same everywhere (8 hues, by slug).
export function hueOf(key) {
  let h = 0;
  for (const c of String(key || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}
export const avatar = (a, size = 20) => `<span class="ab-avatar ab-hue-${hueOf(a.slug || a.name)}" aria-hidden="true">${icon(agentIcon(a.icon), { size })}</span>`;

const STATUS = { active: ["On", "is-on"], paused: ["Paused", "is-paused"], archived: ["Archived", "is-off"], suspended: ["Suspended by an admin", "is-bad"] };
export const statusDot = (s) => {
  const [label, cls] = STATUS[s] || [s || "Unknown", "is-off"];
  return `<span class="ab-status ${cls}"><span class="ab-dot" aria-hidden="true"></span>${esc(label)}</span>`;
};

// Loads public/css/builder.css once, for routes that open before the shared CSS index has it.
export function ensureCss() {
  if (typeof document === "undefined" || document.querySelector('link[data-css="builder"], link[href$="css/builder.css"]')) return;
  if ([...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.href?.endsWith("builder.css")); } catch { return false; } })) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/css/builder.css"; l.dataset.css = "builder";
  document.head.appendChild(l);
}

export const engineMissing = (what = "Agents") => `<p class="notice small">${esc(what)} need the agent engine, which isn't on this server yet. The builder still works for drafting; saving and testing switch on once the engine is deployed.</p>`;

export function relTime(iso) {
  if (!iso) return "";
  const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return "";
  const s = (Date.now() - t) / 1000, f = s < 0;
  const a = Math.abs(s);
  const txt = a < 60 ? "moments" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return f ? `in ${txt}` : `${txt} ago`;
}
