// Free government data for agents: lobbying disclosures (Senate LDA, lda.gov), FDA recalls and
// drug approvals (openFDA), and new federal rules (Federal Register). All are public APIs with no
// key required; LDA_API_KEY and OPENFDA_API_KEY raise the rate limits if set. Paths and fields
// follow each API's documentation; the build environment couldn't reach them, so parsing is
// defensive and unit-tested on documented shapes.
const { cached } = require("../cache");
const sec = require("./sec");

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "PIF research app", ...headers } });
  if (res.status === 404) return null; // openFDA answers "no matches" with 404
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return res.json();
}

// "NVIDIA CORP" -> "NVIDIA"; "Eli Lilly & Co" -> "Eli Lilly". Used to search by company name.
function searchName(name) {
  return String(name || "")
    .replace(/\/[a-z]{2,3}\/?/gi, " ")
    .replace(/[,.]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|class [a-z]|the|n ?v|s ?a|ag|llc|lp)\b/gi, " ")
    .replace(/&\s*$/, "")
    .replace(/\s+/g, " ").trim();
}

async function companyName(symbol) {
  const dir = await sec.getCompanyDirectory();
  const row = dir.find((r) => r.ticker === symbol.toUpperCase() || r.ticker === symbol.toUpperCase().replace(".", "-"));
  return row ? row.name : null;
}

// ---- Lobbying (LDA) ----

function parseLda(json) {
  return (json?.results || []).map((f) => ({
    year: f.filing_year, period: f.filing_period_display || f.filing_period, type: f.filing_type_display || f.filing_type,
    registrant: f.registrant?.name || null, client: f.client?.name || null,
    // Income is what an outside firm was paid; expenses are an in-house lobbying spend.
    amountUsd: Number(f.income ?? f.expenses) || null, amountKind: f.income != null ? "paid to lobbying firm" : f.expenses != null ? "in-house spend" : null,
    issues: [...new Set((f.lobbying_activities || []).map((a) => a.general_issue_code_display || a.general_issue_code).filter(Boolean))].slice(0, 8),
    detail: (f.lobbying_activities || []).map((a) => a.description).filter(Boolean).join(" | ").slice(0, 400),
    agencies: [...new Set((f.lobbying_activities || []).flatMap((a) => (a.government_entities || []).map((g) => g.name)).filter(Boolean))].slice(0, 8),
    posted: f.dt_posted ? String(f.dt_posted).slice(0, 10) : null,
    url: f.filing_document_url || null,
  }));
}

async function lobbying(symbol) {
  const name = await companyName(symbol);
  if (!name) throw new Error(`No company name on file for ${symbol}.`);
  const q = searchName(name);
  const year = new Date().getUTCFullYear();
  return cached(`lda_${symbol}_${year}`, 24 * 60 * 60, "lda", async () => {
    const headers = process.env.LDA_API_KEY ? { Authorization: `Token ${process.env.LDA_API_KEY}` } : {};
    const pages = await Promise.all([year, year - 1].map((y) => getJson(`https://lda.gov/api/v1/filings/?client_name=${encodeURIComponent(q)}&filing_year=${y}&ordering=-dt_posted&page_size=25`, headers)));
    const filings = pages.flatMap(parseLda);
    const byYear = {};
    for (const f of filings) if (f.amountUsd) byYear[f.year] = (byYear[f.year] || 0) + f.amountUsd;
    return { company: name, searchedAs: q, totalReportedByYear: byYear, filings: filings.slice(0, 25), source: "Senate Lobbying Disclosure Act filings (lda.gov)" };
  });
}

// ---- FDA (openFDA) ----

const fdaKey = () => (process.env.OPENFDA_API_KEY ? `&api_key=${encodeURIComponent(process.env.OPENFDA_API_KEY)}` : "");
const fdaDate = (d) => (/^\d{8}$/.test(d || "") ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || null);

function parseRecalls(json) {
  return (json?.results || []).map((r) => ({
    date: fdaDate(r.report_date || r.recall_initiation_date || r.event_date_initiated), firm: r.recalling_firm, classification: r.classification || null,
    status: r.status || null, product: String(r.product_description || "").slice(0, 200), reason: String(r.reason_for_recall || "").slice(0, 300),
  }));
}

function parseApprovals(json) {
  const out = [];
  for (const app of json?.results || []) {
    const brand = app.products?.[0]?.brand_name || app.openfda?.brand_name?.[0] || null;
    for (const s of app.submissions || []) {
      if (s.submission_status !== "AP") continue;
      out.push({ date: fdaDate(s.submission_status_date), brand, application: app.application_number, sponsor: app.sponsor_name, type: s.submission_type, classCode: s.submission_class_code_description || s.submission_class_code || null });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
}

async function fda(symbol) {
  const name = await companyName(symbol);
  if (!name) throw new Error(`No company name on file for ${symbol}.`);
  const q = searchName(name);
  return cached(`openfda_${symbol}`, 24 * 60 * 60, "openfda", async () => {
    const firm = encodeURIComponent(`"${q}"`);
    const [drugRecalls, deviceRecalls, approvals] = await Promise.all([
      getJson(`https://api.fda.gov/drug/enforcement.json?search=recalling_firm:${firm}&sort=report_date:desc&limit=10${fdaKey()}`).catch(() => null),
      getJson(`https://api.fda.gov/device/enforcement.json?search=recalling_firm:${firm}&sort=report_date:desc&limit=10${fdaKey()}`).catch(() => null),
      getJson(`https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:${firm}&limit=50${fdaKey()}`).catch(() => null),
    ]);
    return {
      company: name, searchedAs: q,
      drugRecalls: parseRecalls(drugRecalls), deviceRecalls: parseRecalls(deviceRecalls), recentApprovals: parseApprovals(approvals),
      source: "openFDA (FDA enforcement reports and Drugs@FDA)", note: "Matched by company name; subsidiaries filing under other names are missed. Recall class I is the most serious.",
    };
  });
}

// ---- Federal Register ----

function parseFedReg(json) {
  return (json?.results || []).map((d) => ({
    date: d.publication_date, type: d.type, title: d.title, agencies: (d.agencies || []).map((a) => a.name || a.raw_name).filter(Boolean),
    abstract: String(d.abstract || "").slice(0, 400), commentsClose: d.comments_close_on || null, effective: d.effective_on || null,
    url: d.html_url, documentNumber: d.document_number,
  }));
}

async function federalRegister(query, { days = 90 } = {}) {
  const q = String(query || "").trim().slice(0, 100);
  if (q.length < 2) throw new Error("Give a company name or topic to search the Federal Register.");
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return cached(`fedreg_${q.toLowerCase()}_${since}`, 12 * 60 * 60, "federal_register", async () => {
    const types = ["RULE", "PRORULE", "NOTICE", "PRESDOCU"].map((t) => `&conditions[type][]=${t}`).join("");
    const json = await getJson(`https://www.federalregister.gov/api/v1/documents.json?conditions[term]=${encodeURIComponent(q)}&conditions[publication_date][gte]=${since}${types}&order=relevance&per_page=20`);
    return { query: q, since, count: json?.count ?? 0, documents: parseFedReg(json), source: "Federal Register (federalregister.gov)" };
  });
}

module.exports = { lobbying, fda, federalRegister, companyName, searchName, parseLda, parseRecalls, parseApprovals, parseFedReg };
