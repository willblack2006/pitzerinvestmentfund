// Agent tools for shared memory and asking other agents (plan WS5). Loaded from the end of
// tools.js, after the data tools; adds to TOOLS (append-only).
//   get_memory   what the fund's agents and members already know (ranked recall)
//   list_agents  the team agents another agent can ask
//   ask_agent    ask one of them a question; it answers in a child run (depth <= 2)
const { TOOLS } = require("./tools");

const STR_OR_NULL = (d) => ({ type: ["string", "null"], description: d });
function add(name, description, props, run) {
  TOOLS[name] = { name, description, parameters: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props }, run };
}

add("get_memory",
  "What the fund's agents and members already know: earlier observations, facts, decisions, open questions and predictions, ranked by relevance, each with an id (m12), date, author and source. Use it before starting research on a ticker so you build on earlier work instead of repeating it. Memory can be stale: check anything important with your other tools. Cite memory ids you rely on.",
  {
    symbol: STR_OR_NULL("Ticker the question is about, or null for fund-wide memory."),
    query: STR_OR_NULL("Words describing what you want to know, or null."),
    kinds: { type: ["array", "null"], items: { type: "string", enum: ["fact", "observation", "decision", "preference", "open_question", "prediction"] }, description: "Only these kinds, or null for all." },
  },
  async ({ symbol, query, kinds }, context = {}) => {
    const memory = require("./memory");
    const s = symbol ? String(symbol).trim().toUpperCase() : null;
    const items = memory.recall({ symbol: s, query: query || "", kinds: kinds?.length ? kinds : null, memberId: context.memberId ?? null, agentId: context.agentId ?? null, limit: 20 });
    if (context.ctx) context.ctx.memoryUsed = [...new Set([...(context.ctx.memoryUsed || []), ...items.map((m) => m.id)])];
    return {
      data: { count: items.length, note: "Internal notes from earlier runs; may be stale. Cite ids like m12.", items: items.map((m) => ({ id: `m${m.id}`, kind: m.kind, about: m.scope === "symbol" ? m.scopeKey : m.scope, text: m.text, asOf: m.asOf || m.createdAt?.slice(0, 10), by: m.by?.name, source_url: m.sourceUrl || (m.sourceRunId ? `#/agents/runs/${m.sourceRunId}` : null), confidence: m.confidence })) },
      source_url: s ? `#/memory/${encodeURIComponent(s)}` : "#/memory",
      as_of: new Date().toISOString(), cached: false,
    };
  });

add("list_agents",
  "The fund's team agents you can ask a question with ask_agent: slug, name and what each one does.",
  {},
  async (_args, context = {}) => {
    const h = require("./handoffs");
    return { data: { agents: h.askable(context.memberId ?? null) }, source_url: "#/agents", as_of: new Date().toISOString(), cached: false };
  });

add("ask_agent",
  "Ask another of the fund's team agents a question (for example the agent that watches a ticker's thesis, or a valuation agent). It answers from its own instructions, tools and the fund's memory in a separate recorded run, which counts against the same budget. Use it when another agent's specialty or past work would answer something better than you can; don't use it for simple lookups you can do yourself. Agents can only ask two levels deep.",
  {
    agent: { type: "string", description: "The agent's slug from list_agents." },
    question: { type: "string", description: "One specific question." },
    symbol: STR_OR_NULL("Ticker the question is about, or null."),
  },
  async ({ agent, question, symbol }, context = {}) => {
    const h = require("./handoffs");
    const parent = context.ctx || { memberId: context.memberId ?? null, depth: context.depth || 0, id: context.runId ?? null };
    const out = await h.askAgent({ agent, question, symbol }, parent);
    return { data: out, source_url: out.link, as_of: new Date().toISOString(), cached: false };
  });
