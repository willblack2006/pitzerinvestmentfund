// Activist / 5%-owner alerts: best-effort extraction of the reporting person and stake % from
// a 13D/13G cover page. These filings vary in layout (plain text, HTML, EDGARized tables), so
// this returns null for a field it can't find rather than guessing — still useful as "a new
// SC 13D was filed, here's the link" even when the cover-page fields don't parse.
function parseCoverPage(text) {
  const name = text.match(/names?\s+of\s+reporting\s+persons?\s*:?\s*\n{0,2}\s*([A-Z][A-Za-z0-9.,&'’\- ]{2,90})/i)?.[1]?.trim() || null;
  const pctMatch = text.match(/percent\s+of\s+class\s+represented[^%]{0,250}?(\d{1,2}(?:\.\d+)?)\s*%/i);
  const stakePct = pctMatch ? Number(pctMatch[1]) : null;
  return { reportingPerson: name, stakePct: Number.isFinite(stakePct) ? stakePct : null };
}

const FORMS = ["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"];

// `filings` is the output of sec.getRecentFilings(symbol, FORMS); `coverPages` maps
// accession -> parsed cover-page fields (fetched lazily by the route, since fetching every
// filing's text is the expensive part).
function buildActivistAlerts(filings, coverPages = {}) {
  return filings
    .filter((f) => FORMS.includes(f.form))
    .map((f) => ({ ...f, isAmendment: f.form.endsWith("/A"), ...(coverPages[f.accession] || { reportingPerson: null, stakePct: null }) }))
    .sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
}

module.exports = { parseCoverPage, buildActivistAlerts, FORMS };
