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
};
// Price for the model that actually answered (the API may return a dated snapshot name).
function priceFor(name) {
  const key = Object.keys(PRICES).find((k) => name === k || String(name).startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}
const costOf = (name, usage) => { const p = priceFor(name); return p ? (usage.input * p.input + usage.output * p.output) / 1e6 : null; };

// One Responses API call. Returns { text, model, usage: { input, output }, incomplete } where
// `incomplete` names why the output was cut short (e.g. "max_output_tokens"), else null.
// Reasoning tokens are billed as output and are included in usage.output.
async function respond({ system, user, schema = null, schemaName = "result", effort = "low", maxOutputTokens = 8000, useModel = model() }) {
  if (!configured()) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: useModel,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      reasoning: { effort },
      max_output_tokens: maxOutputTokens,
      ...(schema ? { text: { format: { type: "json_schema", name: schemaName, schema, strict: true } } } : {}),
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${json?.error?.message || "no details"}`);
  const parts = (json.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []);
  const refusal = parts.find((p) => p.type === "refusal");
  if (refusal) throw new Error(`The model declined: ${refusal.refusal}`);
  return {
    text: parts.filter((p) => p.type === "output_text").map((p) => p.text).join(""),
    model: json.model || useModel,
    usage: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
    incomplete: json.status === "incomplete" ? json.incomplete_details?.reason || "incomplete" : null,
  };
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
    schema: TRIAGE_SCHEMA, schemaName: "news_triage", effort: "low", maxOutputTokens: 4000,
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
    effort: process.env.OPENAI_RECAP_EFFORT || "low", maxOutputTokens: 12000, useModel: recapModel(),
  });
  if (out.incomplete) throw new Error(`The recap was cut off (${out.incomplete}).`);
  return { text: out.text, model: out.model, usage: out.usage };
}

module.exports = { configured, model, recapModel, priceFor, respond, summarizeFiling, cachedSummary, summarizeFilingChange, triageHeadlines, marketRecap };
