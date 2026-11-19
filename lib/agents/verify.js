// Verification for agent output (pure, unit-tested). Two rules from the research report (8.2):
// a quote is shown only if it appears verbatim in the source text the agent was given, and a
// number in model prose is flagged unless it matches a number a tool returned.

// Whitespace, curly quotes, dashes and non-breaking spaces vary between EDGAR's HTML and what a
// model writes back, so both sides are normalized the same way before matching.
function normalize(text) {
  return String(text || "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[  -​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A quote shorter than this proves nothing ("the company", "revenue") and is never "verified".
const MIN_QUOTE_CHARS = 12;
// Models trim the leading/trailing ellipsis or join two fragments with one; each fragment must match.
const splitFragments = (q) => normalize(q).replace(/^\.{3}|\.{3}$|^…|…$/g, "").split(/\s*(?:\.\.\.|…)\s*/).map((f) => f.trim()).filter(Boolean);

// sources: { [id]: text }. quotes: [{ quote, source? }]. Returns each quote with `verified` and
// the id of the source it was found in (the named source first, then any other).
function verifyQuotes(quotes, sources) {
  const norm = Object.fromEntries(Object.entries(sources || {}).map(([id, t]) => [id, normalize(t)]));
  return (quotes || []).map((q) => {
    const text = typeof q === "string" ? q : q.quote;
    const fragments = splitFragments(text);
    const ok = fragments.length && fragments.every((f) => f.length >= MIN_QUOTE_CHARS || fragments.length > 1);
    const order = [q.source, ...Object.keys(norm).filter((id) => id !== q.source)].filter((id) => id && norm[id] != null);
    const foundIn = ok ? order.find((id) => fragments.every((f) => norm[id].includes(f))) : undefined;
    return { ...(typeof q === "string" ? { quote: q } : q), verified: !!foundIn, foundIn: foundIn || null };
  });
}

// Numbers worth checking: anything with a digit that reads as an amount, percent or ratio.
// Years (1900-2099), dates, item numbers like "2.02" next to "Item", and single digits are skipped.
const NUM_RE = /\$?\(?-?\d[\d,]*(?:\.\d+)?\)?\s*(?:%|percent|x|bps|basis points|billion|million|thousand|bn|mm|m|b|k)?/gi;
function parseNumber(raw) {
  const s = raw.toLowerCase().replace(/[$,\s()]/g, "");
  const m = s.match(/^-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let v = Number(m[0]);
  if (/\(.*\)/.test(raw)) v = -Math.abs(v);
  const unit = s.slice(m[0].length);
  if (/^(billion|bn|b)$/.test(unit)) v *= 1e9;
  else if (/^(million|mm|m)$/.test(unit)) v *= 1e6;
  else if (/^(thousand|k)$/.test(unit)) v *= 1e3;
  return { value: v, percent: /^(%|percent)$/.test(unit) };
}

function extractNumbers(text) {
  const out = [];
  const str = String(text || "");
  for (const m of str.matchAll(NUM_RE)) {
    const raw = m[0].trim();
    const before = str.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
    if (/item\s*$/.test(before)) continue;                   // "Item 2.02"
    const after = str.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^-[A-Za-z]/.test(after) || /^-[A-Za-z]/.test(str.slice(m.index + m[0].trimEnd().length, m.index + m[0].trimEnd().length + 2))) continue; // "10-year", "10-K", "3-month"
    if (/[A-Za-z]$/.test(str.slice(Math.max(0, m.index - 1), m.index))) continue; // "Q3", "FY2026", "S&P500"
    if (/^(19|20)\d\d$/.test(raw)) continue;                 // a year
    if (/^\d$/.test(raw)) continue;                          // "3 risks"
    if (/[/-]\s*$/.test(before) || /^\d{1,2}[/-]\d{1,2}/.test(str.slice(m.index, m.index + 6))) continue; // dates
    const n = parseNumber(raw);
    if (n) out.push({ raw, ...n });
  }
  return out;
}

// Every number found anywhere in a tool result (nested objects/arrays, numeric strings).
function collectNumbers(value, acc = []) {
  if (value == null) return acc;
  if (typeof value === "number" && Number.isFinite(value)) acc.push(value);
  else if (typeof value === "string") extractNumbers(value).forEach((n) => acc.push(n.value));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, acc));
  else if (typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, acc));
  return acc;
}

// A prose number matches a tool number if they agree to the precision the prose was written at
// (e.g. "$4.2 billion" matches 4,213,000,000; "12%" matches 0.1204 or 12.04).
function matches(n, known) {
  const decimals = (n.raw.match(/\.(\d+)/)?.[1].length) ?? 0;
  const scale = Math.abs(n.value) >= 1e3 ? Math.pow(10, Math.floor(Math.log10(Math.abs(n.value))) - 2) : Math.pow(10, -decimals);
  const tol = Math.max(scale / 2, Math.abs(n.value) * 0.005);
  return known.some((k) => Math.abs(k - n.value) <= tol || (n.percent && Math.abs(k * 100 - n.value) <= tol));
}

// Returns the numbers in `text` that no tool result or source text backs up.
function unbackedNumbers(text, toolResults = [], sourceTexts = []) {
  const known = collectNumbers(toolResults);
  sourceTexts.forEach((t) => extractNumbers(t).forEach((n) => known.push(n.value)));
  return extractNumbers(text).filter((n) => !matches(n, known)).map((n) => n.raw);
}

module.exports = { normalize, verifyQuotes, extractNumbers, unbackedNumbers, MIN_QUOTE_CHARS };
