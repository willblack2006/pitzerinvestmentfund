// @mentions in feed comments (WS7).
//   @Member Name  → an inbox notification (same matching rules as the club chat).
//   @agent-slug   → runs that agent with the feed item as context and posts its reply in the
//                   thread (trigger 'mention', billed to the member who wrote the comment).
//   @pif / @ask   → Ask PIF does the same.
// Custom agents run through WS2's engine when it is installed; built-in agents and Ask PIF
// answer through the Ask PIF workflow with the item as untrusted context.
const { db, optional } = require("./store");
const chat = require("../chat");

const MAX_AGENT_MENTIONS = 2;
const ASK_ALIASES = new Set(["pif", "ask", "askpif", "ask-pif", "ask_pif"]);
const SLUG_RE = /(^|[\s(,;:])@([a-z0-9][a-z0-9_-]{1,59})(?=$|[\s),.!?:;])/gi;

// Agents the member may address: team agents and their own private ones, not archived/suspended.
function addressableAgents(member) {
  return db.prepare(`SELECT * FROM agents WHERE status IN ('active', 'paused') AND (visibility = 'team' OR ownerId = ? OR ? = 1)`).all(member.id, member.isAdmin ? 1 : 0);
}

// [{ agent, ask: bool }] in the order they appear, deduped, at most MAX_AGENT_MENTIONS.
function parseAgentMentions(text, agents) {
  const bySlug = new Map(agents.map((a) => [String(a.slug).toLowerCase(), a]));
  const out = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(SLUG_RE)) {
    const slug = m[2].toLowerCase();
    if (seen.has(slug)) continue;
    const agent = bySlug.get(slug) || null;
    if (!agent && !ASK_ALIASES.has(slug)) continue;
    seen.add(slug);
    out.push(agent ? { agent, ask: agent.workflow === "ask_pif" } : { agent: null, ask: true });
    if (out.length >= MAX_AGENT_MENTIONS) break;
  }
  return out;
}

function parseMemberMentions(text, selfId) {
  const members = db.prepare("SELECT id, name FROM members WHERE active = 1").all();
  return chat.parseMentions(text, members).filter((id) => id !== selfId);
}

// Plain-text version of a feed item for a model prompt. Kept short; it is marked untrusted.
function itemContext(item, thread = []) {
  const body = item.body && typeof item.body === "object" ? item.body : {};
  const text = [body.summary, body.headline, body.answer, body.text, body.verdict, Array.isArray(body.bullets) ? body.bullets.join("\n") : null]
    .filter((x) => typeof x === "string" && x.trim()).join("\n");
  const lines = [
    `Feed item #${item.id} (${item.kind}) by ${item.actor?.name || "someone"} on ${item.createdAt}`,
    item.symbol ? `Ticker: ${item.symbol}` : null,
    `Title: ${item.title || "(none)"}`,
    text ? `Content:\n${text.slice(0, 2500)}` : null,
    thread.length ? `Earlier comments:\n${thread.slice(-6).map((c) => `- ${c.authorName}: ${String(c.text).slice(0, 300)}`).join("\n")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// The readable part of any agent output.
function textOf(output) {
  if (output == null) return "";
  if (typeof output === "string") return output;
  for (const k of ["answer", "summary", "brief", "headline", "text", "verdict", "note"]) {
    if (typeof output[k] === "string" && output[k].trim()) return output[k];
  }
  if (output.output) return textOf(output.output);
  return JSON.stringify(output).slice(0, 1500);
}

// Strip the @handles from the comment so the agent gets the actual question.
const questionFrom = (text) => String(text || "").replace(SLUG_RE, "$1").replace(/\s+/g, " ").trim();

// Runs one mention. Resolves to { runId, text, costUsd } or throws (err.runId when a run started).
async function runMention({ agent, ask, item, thread, comment, member }) {
  const runs = require("../agents/runs");
  const question = questionFrom(comment.text) || `What should the team take from this${item.symbol ? ` about ${item.symbol}` : ""}?`;
  const context = itemContext(item, thread);
  const engine = optional("../agents/engine");
  const runAgent = engine && (engine.runAgent || engine.run);
  if (agent && !ask && agent.kind === "custom" && typeof runAgent === "function") {
    const out = await runAgent.call(engine, agent, {
      trigger: "mention", triggeredBy: member.id, memberId: member.id, symbol: item.symbol || null,
      event: { type: "mention", itemId: item.id, commentId: comment.id, question, context },
    });
    return { runId: out?.runId ?? null, text: textOf(out?.output ?? out), costUsd: out?.costUsd ?? null };
  }
  const { ask: askWorkflow } = require("../agents/workflows/ask");
  const role = agent && !ask ? `You are answering as the team agent "${agent.name}"${agent.description ? ` (${agent.description})` : ""}. ` : "";
  const out = await runs.run({
    workflow: "ask_pif", memberId: member.id, symbol: item.symbol || null,
    agentId: agent?.id ?? null, trigger: "mention", triggeredBy: member.id,
  }, (ctx) => askWorkflow({ question: `${role}${question}`.slice(0, 1000), context }, ctx));
  return { runId: out.runId, text: textOf(out.output), costUsd: out.costUsd };
}

module.exports = { parseAgentMentions, parseMemberMentions, addressableAgents, itemContext, textOf, questionFrom, runMention, MAX_AGENT_MENTIONS, ASK_ALIASES };
