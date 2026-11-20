// OpenAI: every AI feature in the app (filing briefs, 10-K change briefs, news triage, the
// Today recap). Plain fetch against the Responses API (POST /v1/responses), with Structured
// Outputs (text.format json_schema) where the app needs a fixed shape back. Models and
// reasoning effort can be changed without code via env vars.
const { cached, getCached } = require("../cache");
const sec = require("./sec");
const { extractSections } = require("../filingText");
const { RECAP_SYSTEM, RECAP_SCHEMA } = require("../marketNews");

function configured() {
  return !!process.env.OPENAI_API_KEY;
}

// gpt-6-luna won a side-by-side on 2026-10-08 (same recap input): citations matched the
// claims, it said when coverage didn't explain a move, and it cost less than gpt-5-nano
// (fewer output tokens). gpt-5-nano cited unrelated headlines and speculated.
const DEFAULT_MODEL = "gpt-6-luna";
const model = () => process.env.OPENAI_MODEL || DEFAULT_MODEL;
const recapModel = () => process.env.OPENAI_RECAP_MODEL || model();

// Standard-tier list prices per million tokens (developers.openai.com/api/docs/pricing,
// checked 2026-10-08), for the cost estimates shown in the app. Unknown model = no estimate.
const PRICES = {
  "gpt-5-nano": { input: 0.05, output: 0.40 },
  "gpt-6-luna": { input: 0.10, output: 0.50 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-5-mini": { input: 0.25, output: 2.00 },
  // Agent tiers (research report 8.3, prices checked 2026-11-13).
  "gpt-6.1-terra": { input: 1.00, output: 5.00 },
  "gpt-6.1-sol": { input: 2.00, output: 10.00 },
  "gpt-6-astra": { input: 10.00, output: 50.00 },
};
// Price for the model that actually answered (the API may return a dated snapshot name).
function priceFor(name) {
  const key = Object.keys(PRICES).find((k) => name === k || String(name).startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}
// Input tokens served from OpenAI's prompt cache are billed at a fraction of the input price
// (CACHED_INPUT_RATIO, default 0.1 for the GPT-5/6 families; set it if your tier differs).
// Every agent step resends the whole conversation, so most input tokens are cache hits.
const cachedRatio = () => {
  const raw = process.env.CACHED_INPUT_RATIO;
  const r = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(r) && r >= 0 && r <= 1 ? r : 0.1;
};
const costOf = (name, usage) => {
  const p = priceFor(name);
  if (!p) return null;
  const cached = Math.min(usage.cached || 0, usage.input);
  return ((usage.input - cached) * p.input + cached * p.input * cachedRatio() + usage.output * p.output) / 1e6;
};
const usageOf = (json) => {
  const cached = json.usage?.input_tokens_details?.cached_tokens ?? 0;
  return { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0, ...(cached ? { cached } : {}) };
};

// Hooks for the AI spending cap (lib/agents/budget.js registers them at boot): `before` may
// throw to refuse a call (cap reached); `after` records what a call cost. Calls made inside an
// agent run pass `tracked: true` because the run records its own usage.
const hooks = { before: null, after: null };
function setHooks(h) { Object.assign(hooks, h); }

// POST /v1/responses with a timeout and retries. Rate limits (429), server errors (5xx) and
// dropped connections are retried with backoff (honoring Retry-After), so one transient error
// doesn't fail a whole multi-step agent run. A 429 for exhausted quota is not retried.
const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) || 180000;
const MAX_ATTEMPTS = 4;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function postResponses(body, { attempts = MAX_ATTEMPTS, sleep = wait } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    let res, json;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      json = await res.json().catch(() => null);
    } catch (err) {
      lastErr = new Error(`OpenAI request failed: ${err.name === "TimeoutError" ? `no answer in ${REQUEST_TIMEOUT_MS / 1000}s` : err.message}`);
      if (i < attempts - 1) { await sleep(backoff(i)); continue; }
      throw lastErr;
    }
    if (res.ok) return json;
    const message = json?.error?.message || "no details";
    lastErr = Object.assign(new Error(`OpenAI request failed (${res.status}): ${message}`), { status: res.status });
    const quota = json?.error?.code === "insufficient_quota" || /quota/i.test(message);
    if (!RETRY_STATUS.has(res.status) || quota || i === attempts - 1) throw lastErr;
    const after = Number(res.headers?.get?.("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : backoff(i));
  }
  throw lastErr;
}
const backoff = (i) => Math.min(1000 * 2 ** i, 15000) + Math.floor(Math.random() * 500);

// One Responses API call. Returns { text, model, usage: { input, output }, incomplete } where
// `incomplete` names why the output was cut short (e.g. "max_output_tokens"), else null.
// Reasoning tokens are billed as output and are included in usage.output.
async function respond({ system, user, schema = null, schemaName = "result", effort = "low", maxOutputTokens = 8000, useModel = model(), feature = "app", tracked = false }) {
  if (!configured()) throw new Error("OPENAI_API_KEY not configured");
  if (!tracked && hooks.before) hooks.before({ feature });
  const json = await postResponses({
    model: useModel,
    input: [{ role: "system", content: system }, { role: "user", content: user }],
    reasoning: { effort },
    max_output_tokens: maxOutputTokens,
    ...(schema ? { text: { format: { type: "json_schema", name: schemaName, schema, strict: true } } } : {}),
  });
  const parts = (json.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []);
  const refusal = parts.find((p) => p.type === "refusal");
  if (refusal) throw new Error(`The model declined: ${refusal.refusal}`);
  const out = {
    text: parts.filter((p) => p.type === "output_text").map((p) => p.text).join(""),
    model: json.model || useModel,
    usage: usageOf(json),
    incomplete: json.status === "incomplete" ? json.incomplete_details?.reason || "incomplete" : null,
  };
  if (!tracked && hooks.after) { try { hooks.after({ feature, model: out.model, usage: out.usage, costUsd: costOf(out.model, out.usage) }); } catch (err) { console.error("[openai] usage log failed:", err.message); } }
  return out;
}

// One raw Responses API turn for the agent loop (lib/agents/runs.js): `input` is the running list
// of messages, function calls and function outputs; returns the output items and usage. Agent
// runs record their own cost, so this never goes through the usage hooks.
// `cacheKey` groups requests that share a prompt prefix so they land on the same cache (the
// system prompt and tool list are identical across Ask PIF runs).
async function respondRaw({ input, tools = [], schema = null, schemaName = "result", effort = "low", maxOutputTokens = 8000, useModel = model(), cacheKey = null }) {
  if (!configured()) throw new Error("OPENAI_API_KEY not configured");
  const json = await postResponses({
    model: useModel, input, reasoning: { effort }, max_output_tokens: maxOutputTokens,
    ...(cacheKey ? { prompt_cache_key: String(cacheKey).slice(0, 64) } : {}),
    ...(tools.length ? { tools, parallel_tool_calls: true } : {}),
    ...(schema ? { text: { format: { type: "json_schema", name: schemaName, schema, strict: true } } } : {}),
  });
  return shapeRaw(json, useModel);
}

// The agent-loop view of a finished Responses API reply (shared by the plain and streamed calls).
function shapeRaw(json, useModel) {
  const output = json.output || [];
  const parts = output.filter((o) => o.type === "message").flatMap((o) => o.content || []);
  const refusal = parts.find((p) => p.type === "refusal");
  return {
    output,
    calls: output.filter((o) => o.type === "function_call"),
    // Built-in web search runs on OpenAI's side: count the searches (billed per call) and keep
    // the pages the answer cites, so a run can show and check its web sources.
    searches: output.filter((o) => o.type === "web_search_call").map((o) => o.action?.query || ""),
    citations: parts.flatMap((p) => p.annotations || []).filter((a) => a.type === "url_citation" && a.url).map((a) => ({ url: a.url, title: a.title || "" })),
    text: parts.filter((p) => p.type === "output_text").map((p) => p.text).join(""),
    refusal: refusal ? refusal.refusal : null,
    model: json.model || useModel,
    usage: usageOf(json),
    incomplete: json.status === "incomplete" ? json.incomplete_details?.reason || "incomplete" : null,
  };
}

// ---- Stream mode (only when a page is watching the run: lib/agents/stream.js) ----
// Same request and same result as respondRaw, but sent with stream: true so answer text can be
// shown as it is written. `onText(delta)` gets each output_text delta. Retries like
// postResponses, but only before any text arrived (a half-shown answer is never restarted).
// A server that answers with plain JSON instead of an event stream is accepted too.
async function respondStream({ input, tools = [], schema = null, schemaName = "result", effort = "low", maxOutputTokens = 8000, useModel = model(), cacheKey = null, onText = () => {} }, { attempts = MAX_ATTEMPTS, sleep = wait } = {}) {
  if (!configured()) throw new Error("OPENAI_API_KEY not configured");
  const body = {
    model: useModel, input, reasoning: { effort }, max_output_tokens: maxOutputTokens, stream: true,
    ...(cacheKey ? { prompt_cache_key: String(cacheKey).slice(0, 64) } : {}),
    ...(tools.length ? { tools, parallel_tool_calls: true } : {}),
    ...(schema ? { text: { format: { type: "json_schema", name: schemaName, schema, strict: true } } } : {}),
  };
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    let res, sentText = false;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const message = json?.error?.message || "no details";
        lastErr = Object.assign(new Error(`OpenAI request failed (${res.status}): ${message}`), { status: res.status });
        const quota = json?.error?.code === "insufficient_quota" || /quota/i.test(message);
        if (!RETRY_STATUS.has(res.status) || quota || i === attempts - 1) throw lastErr;
        const after = Number(res.headers?.get?.("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : backoff(i));
        continue;
      }
      if (!/event-stream/.test(res.headers.get("content-type") || "")) {
        const json = await res.json();
        const out = shapeRaw(json, useModel);
        if (out.text) onText(out.text);
        return out;
      }
      const final = await readStream(res.body, (d) => { sentText = true; onText(d); });
      return shapeRaw(final, useModel);
    } catch (err) {
      if (err.status) throw err;
      lastErr = new Error(`OpenAI request failed: ${err.name === "TimeoutError" ? `no answer in ${REQUEST_TIMEOUT_MS / 1000}s` : err.message}`);
      if (err.streamError) throw Object.assign(lastErr, { message: `OpenAI stream failed: ${err.message}` });
      if (sentText || i === attempts - 1) throw lastErr;
      await sleep(backoff(i));
    }
  }
  throw lastErr;
}

// Reads a Responses API event stream; calls onText for each output_text delta and returns the
// final response object (from response.completed / response.incomplete).
async function readStream(body, onText) {
  const decoder = new TextDecoder();
  let buf = "", raw = "", final = null;
  const handle = (block) => {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === "response.output_text.delta" && ev.delta) onText(ev.delta);
    else if (ev.type === "response.completed" || ev.type === "response.incomplete") final = ev.response;
    else if (ev.type === "response.failed") throw Object.assign(new Error(ev.response?.error?.message || "the model failed"), { streamError: true });
    else if (ev.type === "error") throw Object.assign(new Error(ev.message || ev.error?.message || "stream error"), { streamError: true });
  };
  for await (const chunk of body) {
    // CRLF may be split across chunks: normalize the whole buffer, holding back a trailing CR.
    raw += decoder.decode(chunk, { stream: true });
    const cut = raw.endsWith("\r") ? raw.length - 1 : raw.length;
    buf += raw.slice(0, cut).replace(/\r\n?/g, "\n");
    raw = raw.slice(cut);
    let at;
    while ((at = buf.indexOf("\n\n")) >= 0) { handle(buf.slice(0, at)); buf = buf.slice(at + 2); }
  }
  buf += raw.replace(/\r/g, "\n");
  if (buf.trim()) handle(buf);
  if (!final) throw Object.assign(new Error("the stream ended without a final response"), { streamError: true });
  return final;
}

// ---- Filing briefs (Research → Filings) ----

const FILING_SYSTEM = `You are a senior equity research analyst mentoring a student-run investment fund.
You summarize SEC filings into a concise brief the fund's investment committee can act on.
Ground every statement in the filing text provided; if the text doesn't say something, don't infer it.
Quote figures exactly as filed and say which section they came from. Be direct about negatives.

Format the brief in Markdown with exactly these headings:
## Bottom line
(2-3 sentences: what this filing tells an owner of the stock)
## What changed
(bullets: results vs prior period, segment trends, margins, cash flow, capital allocation)
## Key risks
(bullets: the most material risks, flag any that look new or elevated)
## Outlook & guidance
(bullets; write "No explicit guidance in this filing." if there is none)
## Red flags
(bullets on accounting changes, going-concern language, restatements, unusual items, litigation — or "None noted.")
## Questions to ask
(3-5 pointed questions an analyst should investigate next)`;

const filingKey = (accession) => `ai_filing_${accession}`;

async function summarizeFiling(symbol, filing) {
  return cached(filingKey(filing.accession), 30 * 24 * 60 * 60, "ai_summary", async () => {
    const text = await sec.getFilingText(filing.url);
    let sections = extractSections(text, filing.form);
    // 8-Ks (and filings whose headings we can't locate) are sent whole; they are short.
    if (!sections.length) sections = [{ label: "Full filing text", body: text }];
    const body = sections.map((s) => `<section name="${s.label}">\n${s.body}\n</section>`).join("\n\n");
    const out = await respond({
      system: FILING_SYSTEM,
      user: `Company: ${symbol}\nFiling: ${filing.form} filed ${filing.filingDate}${filing.reportDate ? ` (period ${filing.reportDate})` : ""}${filing.items ? `, items ${filing.items}` : ""}\n\n${body}\n\nWrite the brief.`,
      effort: "medium",
      maxOutputTokens: 16000,
      feature: "filing_brief",
    });
    if (!out.text.trim()) throw new Error(`The brief came back empty (${out.incomplete || "no text"}).`);
    return {
      summary: out.text.trim(),
      truncatedByModel: out.incomplete === "max_output_tokens",
      sections: sections.map((s) => s.label),
      model: out.model,
      usage: out.usage,
      costUsd: costOf(out.model, out.usage),
      generatedAt: new Date().toISOString(),
    };
  });
}

function cachedSummary(accession) {
  return getCached(filingKey(accession));
}

// ---- What changed between two filings (Research → Filings, "Lazy Prices" diff) ----

const DIFF_SYSTEM = `You are a senior equity research analyst mentoring a student-run investment fund.
You are given, for one or more sections of a company's SEC filing (Risk Factors, MD&A, Legal Proceedings),
the paragraphs that were ADDED and the paragraphs that were REMOVED compared to the company's prior same-type filing.
Explain what changed and why it might matter to an owner of the stock. Ground every statement in the paragraphs given;
if nothing substantive changed in a section, say so plainly. Research (Cohen, Malloy & Nguyen 2020) finds the market
often underreacts to these rewrites, so flag anything that looks like a genuine shift in tone or substance (not just rewording).

Format the brief in Markdown with exactly these headings:
## What changed
(bullets, grouped by section, on the substantive changes)
## Why it might matter
(2-4 sentences on the likely significance)
## Reworded vs. substantive
(call out anything that looks like pure rewording vs. a real change in risk or outlook)`;

async function summarizeFilingChange(symbol, diff) {
  const key = `ai_filingdiff_${symbol}_${diff.form}_${diff.latest.accession}`;
  return cached(key, 30 * 24 * 60 * 60, "ai_summary", async () => {
    const body = diff.sections.map((s) => `<section name="${s.label}">\nADDED:\n${(s.added || []).join("\n\n") || "(none)"}\n\nREMOVED:\n${(s.removed || []).join("\n\n") || "(none)"}\n</section>`).join("\n\n");
    const out = await respond({
      system: DIFF_SYSTEM,
      user: `Company: ${symbol}\nComparing ${diff.form} filed ${diff.latest.filingDate} vs prior ${diff.form} filed ${diff.prior.filingDate}.\n\n${body}\n\nWrite the brief.`,
      effort: "medium",
      maxOutputTokens: 8000,
      feature: "filing_change_brief",
    });
    if (!out.text.trim()) throw new Error(`The brief came back empty (${out.incomplete || "no text"}).`);
    return { summary: out.text.trim(), model: out.model, usage: out.usage, costUsd: costOf(out.model, out.usage), generatedAt: new Date().toISOString() };
  });
}

// ---- News triage (Research news, Alerts "Run today's triage") ----

const NEWS_SYSTEM = `You are triaging news headlines for a student investment fund that owns or watches the named stock.
For EACH headline, in the order given, rate:
- materiality: 0-10, how likely this is to move the stock's fundamentals or price meaningfully (0 = noise, 10 = thesis-changing)
- direction: "positive", "negative", or "neutral" for the stock
- reason: one short sentence why

The effect is documented to be strongest for small-cap stocks and negative news (Lopez-Lira & Tang) — weight accordingly, but still rate every headline.
Return exactly one rating per headline, in the same order.`;

const TRIAGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["ratings"],
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["materiality", "direction", "reason"],
        properties: {
          materiality: { type: "integer" },
          direction: { type: "string", enum: ["positive", "negative", "neutral"] },
          reason: { type: "string" },
        },
      },
    },
  },
};

// One batched call scores every headline for a symbol at once. Returns a JSON array as text,
// the shape lib/newsTriage.js parses (and clamps).
async function triageHeadlines(symbol, headlines) {
  const out = await respond({
    system: NEWS_SYSTEM,
    user: `Company: ${symbol}\n\nHeadlines:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}`,
    schema: TRIAGE_SCHEMA, schemaName: "news_triage", effort: "low", maxOutputTokens: 4000, feature: "news_triage",
  });
  if (out.incomplete) throw new Error(`The triage was cut off (${out.incomplete}).`);
  let ratings;
  try { ratings = JSON.parse(out.text).ratings; } catch { throw new Error("The triage came back malformed."); }
  return JSON.stringify(ratings);
}

// ---- Today page recap ----

// Returns { text, model, usage } like the other features; lib/today.js parses and prices it.
async function marketRecap(inputText) {
  const out = await respond({
    system: RECAP_SYSTEM, user: inputText,
    schema: RECAP_SCHEMA, schemaName: "market_recap",
    effort: process.env.OPENAI_RECAP_EFFORT || "low", maxOutputTokens: 12000, useModel: recapModel(), feature: "today_recap",
  });
  if (out.incomplete) throw new Error(`The recap was cut off (${out.incomplete}).`);
  return { text: out.text, model: out.model, usage: out.usage };
}

module.exports = { postResponses, configured, model, recapModel, priceFor, respond, summarizeFiling, cachedSummary, summarizeFilingChange, triageHeadlines, marketRecap, costOf, setHooks, respondRaw, respondStream, readStream };
