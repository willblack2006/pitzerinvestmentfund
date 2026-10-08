// OpenAI, used only for the Today page recap. Plain fetch against the Responses API
// (POST /v1/responses) with Structured Outputs (text.format json_schema), so no extra
// dependency. Model and reasoning effort can be changed without code via env vars.
const { RECAP_SYSTEM, RECAP_SCHEMA } = require("../marketNews");

function configured() {
  return !!process.env.OPENAI_API_KEY;
}

// gpt-6-luna won a side-by-side on 2026-10-08 (same input): citations matched the claims,
// it said when coverage didn't explain a move, and it cost less than gpt-5-nano per recap
// (fewer output tokens). gpt-5-nano cited unrelated headlines and speculated.
const recapModel = () => process.env.OPENAI_RECAP_MODEL || "gpt-6-luna";

// Standard-tier list prices per million tokens (developers.openai.com/api/docs/pricing,
// checked 2026-10-08), for the cost estimate shown on each edition. Unknown model = no estimate.
const PRICES = {
  "gpt-5-nano": { input: 0.05, output: 0.40 },
  "gpt-6-luna": { input: 0.10, output: 0.50 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-5-mini": { input: 0.25, output: 2.00 },
};

// Returns { text, model, usage: { input, output } } like claude.marketRecap. Reasoning tokens
// are billed as output and are included in usage.output_tokens.
async function marketRecap(inputText) {
  const model = recapModel();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: RECAP_SYSTEM },
        { role: "user", content: inputText },
      ],
      reasoning: { effort: process.env.OPENAI_RECAP_EFFORT || "low" },
      max_output_tokens: 12000,
      text: { format: { type: "json_schema", name: "market_recap", schema: RECAP_SCHEMA, strict: true } },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${json?.error?.message || "no details"}`);
  if (json.status === "incomplete") throw new Error(`The recap was cut off (${json.incomplete_details?.reason || "incomplete"}).`);
  const parts = (json.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []);
  const refusal = parts.find((p) => p.type === "refusal");
  if (refusal) throw new Error(`The model declined to write this recap: ${refusal.refusal}`);
  return {
    text: parts.filter((p) => p.type === "output_text").map((p) => p.text).join(""),
    model: json.model || model,
    usage: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
  };
}

// Price for the model that actually answered (the API may return a dated snapshot name).
function priceFor(model) {
  const key = Object.keys(PRICES).find((k) => model === k || String(model).startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}

module.exports = { configured, marketRecap, priceFor, recapModel };
