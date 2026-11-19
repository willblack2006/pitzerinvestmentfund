// Scores one Ask PIF answer against an eval question (eval/ask-questions.json). Pure functions,
// so the scoring is unit-tested offline; scripts/eval-ask.js feeds it real runs.
function score(q, result, { costUsd = 0, steps = [], usage = {}, error = null } = {}) {
  if (error) return { id: q.id, pass: false, error: String(error), costUsd };
  const out = result || {};
  const used = new Set((out.toolsUsed || []).filter((t) => t.ok).map((t) => t.name));
  // Each expectTools entry is a list of acceptable alternatives; one of each entry must be used.
  const missingTools = (q.expectTools || []).filter((alts) => !alts.some((t) => used.has(t))).map((alts) => alts.join("|"));
  const answer = String(out.answer || "");
  const missingText = (q.mustMatch || []).filter((re) => !new RegExp(re, "i").test(answer));
  const claims = out.claims || [];
  const sourced = claims.filter((c) => c.sourced).length;
  const sourcedRatio = claims.length ? sourced / claims.length : null;
  const unbacked = (out.unbackedNumbers || []).length;
  const quotesOk = !q.needsQuote || claims.some((c) => c.quote && c.verified);
  const modelSteps = steps.filter((s) => s.kind === "model").length;
  const checks = {
    tools: !missingTools.length,
    text: !missingText.length,
    sourced: sourcedRatio == null ? true : sourcedRatio >= 0.8,
    numbers: unbacked === 0,
    quote: quotesOk,
    tier: !q.expectTier || !out.plan || out.plan.tier === q.expectTier || !!out.plan.escalated,
  };
  const input = usage.input || 0, cached = usage.cached || 0;
  return {
    id: q.id, pass: Object.values(checks).every(Boolean), checks, missingTools, missingText,
    tier: out.plan?.tier, escalated: !!out.plan?.escalated, toolCount: out.plan?.toolCount, modelSteps,
    toolCalls: (out.toolsUsed || []).length, sourcedRatio, unbacked,
    tokens: { input, cached, output: usage.output || 0 }, cacheHit: input ? cached / input : 0, costUsd,
  };
}

function summarize(rows) {
  const ok = rows.filter((r) => !r.error);
  const sum = (f) => ok.reduce((a, r) => a + (f(r) || 0), 0);
  return {
    questions: rows.length, passed: rows.filter((r) => r.pass).length, errors: rows.length - ok.length,
    totalCostUsd: rows.reduce((a, r) => a + (r.costUsd || 0), 0),
    avgCostUsd: rows.length ? rows.reduce((a, r) => a + (r.costUsd || 0), 0) / rows.length : 0,
    avgModelSteps: ok.length ? sum((r) => r.modelSteps) / ok.length : 0,
    escalated: ok.filter((r) => r.escalated).length,
    cacheHit: sum((r) => r.tokens.input) ? sum((r) => r.tokens.cached) / sum((r) => r.tokens.input) : 0,
    unbackedNumbers: sum((r) => r.unbacked),
  };
}

module.exports = { score, summarize };
