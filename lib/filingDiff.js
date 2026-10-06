// Filing-change detector ("Lazy Prices" — Cohen, Malloy & Nguyen, Journal of Finance 2020):
// companies that materially rewrite their Risk Factors / MD&A / Legal Proceedings sections
// between filings tend to underperform afterward, especially when the market doesn't seem
// to notice. Pure text comparison (cosine similarity on word counts + paragraph-level diff)
// so it's unit-testable without touching the network; the route does the filing fetches.

function tokenize(text) {
  const counts = new Map();
  const words = (text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return counts;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  for (const [k, v] of a) if (b.has(k)) dot += v * b.get(k);
  if (!na || !nb) return null;
  return dot / Math.sqrt(na * nb);
}

function splitParagraphs(text) {
  return (text || "").split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 40);
}

const normalize = (p) => p.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();

// Paragraphs in `newText` with no near-duplicate in `oldText` are "added", and vice versa for
// "removed". Matching on normalized text (not exact equality) since filings re-wrap and
// re-number paragraphs between periods without changing their substance.
function diffParagraphs(oldText, newText) {
  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);
  const oldNorm = new Set(oldParas.map(normalize));
  const newNorm = new Set(newParas.map(normalize));
  return {
    added: newParas.filter((p) => !oldNorm.has(normalize(p))),
    removed: oldParas.filter((p) => !newNorm.has(normalize(p))),
  };
}

function compareFilingSections(oldText, newText) {
  const similarity = cosineSimilarity(tokenize(oldText), tokenize(newText));
  const { added, removed } = diffParagraphs(oldText, newText);
  return { similarity, added, removed, changeSize: added.length + removed.length };
}

module.exports = { tokenize, cosineSimilarity, splitParagraphs, diffParagraphs, compareFilingSections };
