// Government contracts feed: summarize recent federal contract actions (USAspending.gov) for
// a company. Low-evidence context: a big award is public news, and most of it is priced in
// by the time the data posts. Pure functions; the source module does the fetching.
const { normalizeName } = require("./thirteenF");

// Defense, health and IT are where federal contracts are a meaningful share of revenue.
const RELEVANT_INDUSTRY = /aerospace|defense|government|it services|information technology|software|health|medical|pharma|biotech|drug|engineering|construction/i;

function isGovRelevant(sector, industry) {
  return sector === "Industrials" && RELEVANT_INDUSTRY.test(industry || "")
    || sector === "Healthcare"
    || sector === "Technology" && RELEVANT_INDUSTRY.test(industry || "");
}

// Search text for USAspending's recipient search: the company name without legal suffixes.
// "Lockheed Martin Corporation" -> "lockheed martin" (the API matches case-insensitively and
// also returns subsidiaries filed under the parent, e.g. Sikorsky under Lockheed Martin).
function recipientSearchText(companyName) {
  const text = normalizeName(companyName);
  return text.length >= 3 ? text : null;
}

// rows: [{ amount, date, agency, description, recipient, url }]. `annualRevenue` (optional)
// puts the total in proportion: $500M is noise for a $70B company and huge for a $1B one.
function summarizeAwards(rows, { annualRevenue = null } = {}) {
  const valid = rows.filter((r) => Number.isFinite(r.amount));
  const obligated = valid.filter((r) => r.amount > 0);
  const total = obligated.reduce((s, r) => s + r.amount, 0);
  const byAgency = {};
  for (const r of obligated) byAgency[r.agency || "Unknown"] = (byAgency[r.agency || "Unknown"] || 0) + r.amount;
  return {
    count: obligated.length,
    total,
    deobligated: valid.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0),
    pctOfRevenue: annualRevenue > 0 ? total / annualRevenue : null,
    topAgencies: Object.entries(byAgency).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([agency, amount]) => ({ agency, amount })),
    top: [...obligated].sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

module.exports = { isGovRelevant, recipientSearchText, summarizeAwards };
