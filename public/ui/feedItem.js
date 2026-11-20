// One team feed item (WS11 component; WS7 builds the feed on it). Agent or member avatar, what
// happened, the summary, ticker, time, and hooks (data-*) for comments and reactions.
import { esc, icon } from "../shared.js";
import { agentChip, memberChip } from "./agentChip.js";
import { ago } from "./runCard.js";

export const FEED_KIND = {
  agent_brief: ["Brief", "doc"], agent_alert: ["Alert", "alert"], thesis_change: ["Thesis", "target"], memory_added: ["Remembered", "sparkle"],
  handoff: ["Handoff", "users"], ask_shared: ["Shared answer", "chat"], pitch_opened: ["Pitch", "vote"], vote_closed: ["Vote", "check-circle"],
  trade_executed: ["Trade", "briefcase"], tripwire_tripped: ["Tripwire", "flag"], note_shared: ["Note", "pencil"],
  agent_created: ["New agent", "plus"], agent_edited: ["Agent changed", "sliders"], digest: ["Digest", "inbox"],
};

const bodyText = (b) => (typeof b === "string" ? b : b?.summary || b?.answer || b?.text || b?.bottomLine || "");

// item: a feed_items row (body parsed) plus optional { agent: {slug,name,icon,kind}, member: {name},
// comments: n, reactions: [{emoji, n, mine}], unread }
export function feedItem(item = {}, { compact = false, actions = true } = {}) {
  const [kindLabel, ic] = FEED_KIND[item.kind] || ["Update", "bell"];
  const who = item.actorType === "agent" || item.agent ? agentChip(item.agent || { slug: `agent-${item.agentId}`, name: "Agent" }, { compact: true })
    : item.actorType === "member" ? memberChip(item.member || { name: "Member" }) : `<span class="agent-chip-name">PIF</span>`;
  const text = bodyText(item.body);
  const max = compact ? 160 : 420;
  const link = item.body?.link && /^#\//.test(item.body.link) ? item.body.link : item.runId ? `#/agents/runs/${Number(item.runId)}` : null;
  const reactions = (item.reactions || []).map((r) => `<button type="button" class="feed-react${r.mine ? " is-mine" : ""}" data-react="${esc(r.emoji)}" data-item="${Number(item.id)}" aria-pressed="${!!r.mine}">${esc(r.emoji)} ${Number(r.n) || 1}</button>`).join("");
  return `<article class="feed-item is-${esc(item.importance || "normal")}${item.unread ? " is-unread" : ""}${compact ? " is-compact" : ""}" data-feed-item="${Number(item.id) || ""}">
    <header class="feed-head">${who}<span class="feed-kind small">${icon(ic, { size: 12 })}${esc(kindLabel)}</span>${item.symbol ? `<a class="symbol-cell small" href="#/research/${encodeURIComponent(item.symbol)}">${esc(item.symbol)}</a>` : ""}<time class="small muted" datetime="${esc(item.createdAt || "")}">${esc(ago(item.createdAt))}</time></header>
    <p class="feed-title">${link ? `<a href="${esc(link)}">${esc(item.title || kindLabel)}</a>` : esc(item.title || kindLabel)}</p>
    ${text ? `<p class="feed-body small">${esc(text.length > max ? `${text.slice(0, max - 3)}…` : text)}</p>` : ""}
    ${actions ? `<footer class="feed-foot">${reactions}<button type="button" class="btn-link small" data-feed-comment="${Number(item.id)}">${icon("chat", { size: 12 })} ${item.comments ? `${Number(item.comments)} comment${item.comments === 1 ? "" : "s"}` : "Comment"}</button>${item.runId ? `<a class="small" href="#/agents/runs/${Number(item.runId)}">Why?</a>` : ""}</footer>` : ""}
  </article>`;
}
