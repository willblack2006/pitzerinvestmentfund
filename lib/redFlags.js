// Red-flag scanner over SEC filing metadata and full-text search hits — pure, so it's
// unit-testable without touching the network. Everything here is a fact about a filing
// (an item was checked, a notice was filed, a phrase appears) rather than a prediction.
const ITEM_FLAGS = [
  { re: /\b4\.01\b/, type: "auditor_change", severity: "high", label: "Auditor change (Item 4.01)" },
  { re: /\b4\.02\b/, type: "restatement", severity: "high", label: "Non-reliance / restatement of prior financials (Item 4.02)" },
  { re: /\b5\.02\b/, type: "departure", severity: "medium", label: "Executive or director departure (Item 5.02)" },
];

// `filings` is sec.getRecentFilings() output; `textHits` is { goingConcern, materialWeakness }
// arrays from sec.fullTextSearch(), each already scoped to this company's CIK.
function scanRedFlags(filings = [], textHits = {}) {
  const flags = [];
  for (const f of filings) {
    if (f.form === "8-K") {
      for (const { re, type, severity, label } of ITEM_FLAGS) {
        if (re.test(f.items || "")) flags.push({ type, severity, date: f.filingDate, detail: label, url: f.url });
      }
    }
    if (f.form === "NT 10-K" || f.form === "NT 10-Q") {
      flags.push({ type: "late_filing", severity: "high", date: f.filingDate, detail: `Late filing notice (${f.form}) — the company couldn't file on time.`, url: f.url });
    }
  }
  for (const h of textHits.goingConcern || []) {
    flags.push({ type: "going_concern", severity: "high", date: h.filedAt, detail: `"Going concern" language found in a recent ${h.form} filing.`, url: h.url });
  }
  for (const h of textHits.materialWeakness || []) {
    flags.push({ type: "material_weakness", severity: "high", date: h.filedAt, detail: `Material weakness in internal controls mentioned in a recent ${h.form} filing.`, url: h.url });
  }
  // Dedupe (full-text search and the filing list can both surface the same filing) and sort newest first.
  const seen = new Set();
  const deduped = flags.filter((f) => {
    const key = `${f.type}|${f.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return deduped;
}

const SEVERITY_WEIGHT = { high: 2, medium: 1 };
function flagScore(flags) {
  return flags.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] || 1), 0);
}

module.exports = { scanRedFlags, flagScore };
