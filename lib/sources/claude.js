const Anthropic = require("@anthropic-ai/sdk");
const { cached, getCached } = require("../cache");
const sec = require("./sec");

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
function extractSections(text, form) {
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
  } else if (form === "10-Q") {
    grab("Item 2. Management's Discussion and Analysis", /item\s*2\.?\s*[\-–—:]?\s*management['’]?s\s+discussion/gi, /item\s*3\.?\s*[\-–—:]?\s*quantitative/i);
    grab("Item 1A. Risk Factors (updates)", /item\s*1a\.?\s*[\-–—:]?\s*risk\s+factors/gi, /item\s*2\.?\s*[\-–—:]?\s*unregistered|item\s*5\.?|item\s*6\.?\s*[\-–—:]?\s*exhibits/i);
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

module.exports = { configured, summarizeFiling, cachedSummary, extractSections };
