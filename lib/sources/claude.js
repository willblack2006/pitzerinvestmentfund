const Anthropic = require("@anthropic-ai/sdk");
const { cached, getCached } = require("../cache");
const sec = require("./sec");
const { RECAP_SYSTEM, RECAP_SCHEMA } = require("../marketNews");

const MODEL = "claude-opus-5-5";

function configured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client = null;
function getClient() {
  if (!configured()) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!client) client = new Anthropic();
  return client;
}

// Pull the analyst-relevant sections out of a 10-K/10-Q: Risk Factors (Item 1A) and MD&A
// (Item 7 in a 10-K, Item 2 in a 10-Q). Filings repeat item headings in the table of
// contents, so take the LAST heading occurrence that is followed by substantial text.
function extractSections(text, form, { includeLegal = false } = {}) {
  const sections = [];
  const grab = (label, startRe, endRe) => {
    const starts = [...text.matchAll(startRe)].map((m) => m.index);
    for (let i = starts.length - 1; i >= 0; i--) {
      const rest = text.slice(starts[i]);
      const endMatch = rest.slice(200).search(endRe);
      const body = endMatch > 0 ? rest.slice(0, endMatch + 200) : rest;
      if (body.length > 3000) {
        sections.push({ label, body });
        return;
      }
    }
  };
  if (form === "10-K") {
    grab("Item 1A. Risk Factors", /item\s*1a\.?\s*[\-–—:]?\s*risk\s+factors/gi, /item\s*1b\.?|item\s*1c\.?|item\s*2\.?\s*[\-–—:]?\s*properties/i);
    grab("Item 7. Management's Discussion and Analysis", /item\s*7\.?\s*[\-–—:]?\s*management['’]?s\s+discussion/gi, /item\s*7a\.?|item\s*8\.?\s*[\-–—:]?\s*financial\s+statements/i);
    if (includeLegal) grab("Item 3. Legal Proceedings", /item\s*3\.?\s*[\-–—:]?\s*legal\s+proceedings/gi, /item\s*4\.?\s*[\-–—:]?\s*mine\s+safety|item\s*5\.?/i);
  } else if (form === "10-Q") {
    grab("Item 2. Management's Discussion and Analysis", /item\s*2\.?\s*[\-–—:]?\s*management['’]?s\s+discussion/gi, /item\s*3\.?\s*[\-–—:]?\s*quantitative/i);
    grab("Item 1A. Risk Factors (updates)", /item\s*1a\.?\s*[\-–—:]?\s*risk\s+factors/gi, /item\s*2\.?\s*[\-–—:]?\s*unregistered|item\s*5\.?|item\s*6\.?\s*[\-–—:]?\s*exhibits/i);
    if (includeLegal) grab("Part II Item 1. Legal Proceedings", /part\s*ii[\s\S]{0,20}item\s*1\.?\s*[\-–—:]?\s*legal\s+proceedings/gi, /item\s*1a\.?|item\s*2\.?\s*[\-–—:]?\s*unregistered/i);
  }
  return sections;
}

const SYSTEM = `You are a senior equity research analyst mentoring a student-run investment fund.
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

async function summarizeFiling(symbol, filing) {
  const key = `claude_filing_${filing.accession}`;
  return cached(key, 30 * 24 * 60 * 60, "claude_summary", async () => {
    const text = await sec.getFilingText(filing.url);
    let sections = extractSections(text, filing.form);
    // 8-Ks (and filings whose headings we can't locate) are sent whole; they are short.
    if (!sections.length) sections = [{ label: "Full filing text", body: text }];
    const body = sections.map((s) => `<section name="${s.label}">\n${s.body}\n</section>`).join("\n\n");

    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      // Opt into server-side fallback so a classifier decline is re-run on a suitable model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Company: ${symbol}\nFiling: ${filing.form} filed ${filing.filingDate}${filing.reportDate ? ` (period ${filing.reportDate})` : ""}${filing.items ? `, items ${filing.items}` : ""}\n\n${body}\n\nWrite the brief.`,
      }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("The model declined to summarize this filing.");
    const summary = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return {
      summary,
      truncatedByModel: message.stop_reason === "max_tokens",
      sections: sections.map((s) => s.label),
      model: message.model,
      usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
      generatedAt: new Date().toISOString(),
    };
  });
}

function cachedSummary(accession) {
  return getCached(`claude_filing_${accession}`);
}

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

// AI summary of what changed between two filings' Risk Factors / MD&A / Legal Proceedings
// sections (the diff's added/removed paragraphs), cached like the per-filing summaries.
async function summarizeFilingChange(symbol, diff) {
  const key = `claude_filingdiff_${symbol}_${diff.form}_${diff.latest.accession}`;
  return cached(key, 30 * 24 * 60 * 60, "claude_summary", async () => {
    const body = diff.sections.map((s) => `<section name="${s.label}">\nADDED:\n${(s.added || []).join("\n\n") || "(none)"}\n\nREMOVED:\n${(s.removed || []).join("\n\n") || "(none)"}\n</section>`).join("\n\n");
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: DIFF_SYSTEM,
      messages: [{
        role: "user",
        content: `Company: ${symbol}\nComparing ${diff.form} filed ${diff.latest.filingDate} vs prior ${diff.form} filed ${diff.prior.filingDate}.\n\n${body}\n\nWrite the brief.`,
      }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("The model declined to summarize this change.");
    const summary = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return { summary, model: message.model, usage: { input: message.usage.input_tokens, output: message.usage.output_tokens }, generatedAt: new Date().toISOString() };
  });
}

const NEWS_SYSTEM = `You are triaging news headlines for a student investment fund that owns or watches the named stock.
For EACH headline, in order, rate:
- materiality: 0-10, how likely this is to move the stock's fundamentals or price meaningfully (0 = noise, 10 = thesis-changing)
- direction: "positive", "negative", or "neutral" for the stock
- reason: one short sentence why

The effect is documented to be strongest for small-cap stocks and negative news (Lopez-Lira & Tang) — weight accordingly, but still rate every headline.
Respond with ONLY a JSON array, one object per headline in the same order:
[{"materiality":7,"direction":"negative","reason":"..."}, ...]
No other text, no markdown fencing.`;

// One batched call scores every headline for a symbol at once (cheap — a handful of short
// headlines per call). Returns the model's raw text; lib/newsTriage.js parses it.
async function triageHeadlines(symbol, headlines) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: NEWS_SYSTEM,
    messages: [{ role: "user", content: `Company: ${symbol}\n\nHeadlines:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}` }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined to triage this news.");
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// Today page recap: three short calls per weekday, so it uses the cheapest current model
// (Claude Haiku 5.5, $0.10 / $0.50 per million tokens) at low effort, with a JSON schema so
// the bullets and their cited headline numbers come back in a fixed shape.
const RECAP_MODEL = "claude-haiku-5-5";

async function marketRecap(inputText) {
  const message = await getClient().messages.create({
    model: RECAP_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: RECAP_SCHEMA } },
    system: RECAP_SYSTEM,
    messages: [{ role: "user", content: inputText }],
  });
  if (message.stop_reason === "refusal") throw new Error("The model declined to write this recap.");
  if (message.stop_reason === "max_tokens") throw new Error("The recap was cut off (max_tokens).");
  return {
    text: message.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
    model: message.model,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}

module.exports = { configured, summarizeFiling, cachedSummary, extractSections, summarizeFilingChange, triageHeadlines, marketRecap };
