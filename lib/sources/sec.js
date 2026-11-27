const { cached } = require("../cache");

const { secFetch } = require("../secFetch");

async function fetchJson(url) {
  const res = await secFetch(url);
  if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await secFetch(url, { accept: "text/html,*/*" });
  if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
  return res.text();
}

// Every SEC-registered ticker, its CIK, and its company name — one cached fetch backs both
// getTickerCikMap() (ticker lookups) and company-name matching (e.g. supply-chain customers).
async function getCompanyDirectory() {
  return cached("sec_company_directory", 24 * 60 * 60, "sec_tickers", async () => {
    const json = await fetchJson("https://www.sec.gov/files/company_tickers.json");
    return Object.values(json).map((row) => ({ ticker: String(row.ticker).toUpperCase(), cik: String(row.cik_str).padStart(10, "0"), name: row.title }));
  });
}

async function getTickerCikMap() {
  const dir = await getCompanyDirectory();
  const map = {};
  for (const row of dir) map[row.ticker] = row.cik;
  return map;
}

async function cikFor(symbol) {
  const map = await getTickerCikMap();
  // SEC uses dashes for share classes (BRK-B); Yahoo-style dots map onto them.
  return map[symbol.toUpperCase()] || map[symbol.toUpperCase().replace(".", "-")] || null;
}

const DAY = 24 * 60 * 60 * 1000;

// Flow concepts (income statement / cash flow) are reported over a duration. A 10-Q reports
// both the 3-month and the year-to-date figure with the same end date, so classify each fact
// by its length — single quarter (~91 days) or full fiscal year (~365 days) — and drop YTD
// and other spans instead of letting them collide.
function durationPeriod(u) {
  if (!u.start) return null;
  const days = (new Date(u.end) - new Date(u.start)) / DAY;
  if (days >= 75 && days <= 105) return "Q";
  if (days >= 340 && days <= 380) return "FY";
  return null;
}

// Balance-sheet concepts are point-in-time ("instant") values; a 10-K's balance sheet is the
// fiscal-year-end snapshot.
function instantPeriod(u, form) {
  if (u.start) return null;
  return form === "10-K" ? "FY" : "Q";
}

// Merge every tag a company might have used for a concept (GAAP tags change over time,
// e.g. ASC 606 revenue in 2018), dedupe by period, keep the most recently filed value.
// Flow concepts also get fiscal Q4 filled in (see deriveQ4): a 10-K has no Q4 column, and
// cash-flow statements in a 10-Q are year-to-date, so `cumulative` concepts are differenced
// into single quarters first.
function pick(facts, keys, { instant = false, unit, cumulative = false } = {}) {
  const byPeriod = new Map();
  for (const key of keys) {
    const [ns, tag] = key.includes(":") ? key.split(":") : ["us-gaap", key];
    const units = facts[ns]?.[tag]?.units;
    if (!units) continue;
    const series = unit ? units[unit] : units.USD || units["USD/shares"];
    if (!series) continue;
    for (const u of series) {
      const form = (u.form || "").replace("/A", "");
      if (form !== "10-K" && form !== "10-Q") continue;
      let period = instant ? instantPeriod(u, form) : durationPeriod(u);
      if (!period && cumulative && !instant && u.start) {
        // Year-to-date cash-flow spans (6 and 9 months), kept only to be differenced.
        const days = (new Date(u.end) - new Date(u.start)) / DAY;
        if (days > 105 && days < 300) period = "YTD";
      }
      if (!period) continue;
      const id = `${period}|${u.start || ""}|${u.end}`;
      const existing = byPeriod.get(id);
      if (!existing || new Date(u.filed) >= new Date(existing.filed)) byPeriod.set(id, { ...u, period });
    }
  }
  let all = [...byPeriod.values()].sort((a, b) => new Date(a.end) - new Date(b.end));
  if (!instant) all = deriveQ4(all, cumulative);
  const quarters = all.filter((u) => u.period === "Q").slice(-24);
  const years = all.filter((u) => u.period === "FY").slice(-6);
  // `form` keeps its meaning for the UI: "10-Q" = single quarter, "10-K" = fiscal year.
  return [...quarters, ...years]
    .sort((a, b) => new Date(a.end) - new Date(b.end) || (a.period === "FY" ? 1 : -1))
    .map((u) => ({ end: u.end, val: u.val, form: u.period === "FY" ? "10-K" : "10-Q", ...(u.derived ? { derived: true } : {}) }));
}

// Turns reported periods into single quarters, including fiscal Q4.
//  - Income-statement items: Q4 = fiscal year - (Q1 + Q2 + Q3), when all three are reported.
//  - Cash-flow items (`cumulative`): a 10-Q reports 3-, 6- and 9-month totals from the same
//    fiscal-year start, so Q2 = 6M - 3M, Q3 = 9M - 6M and Q4 = FY - 9M.
// Anything that can't be built from complete data is skipped rather than guessed.
function deriveQ4(all, cumulative) {
  const out = all.filter((u) => u.period !== "YTD");
  const years = all.filter((u) => u.period === "FY");
  const near = (a, b, days = 6) => Math.abs(new Date(a) - new Date(b)) <= days * DAY;
  for (const fy of years) {
    const inYear = (u) => u.period !== "FY" && new Date(u.start) >= new Date(fy.start) - 6 * DAY && new Date(u.end) <= new Date(fy.end) - 30 * DAY;
    if (cumulative) {
      const chain = all.filter((u) => u.period !== "FY" && near(u.start, fy.start) && inYear(u)).sort((a, b) => new Date(a.end) - new Date(b.end));
      // Cumulative totals ending ~3, 6 and 9 months in.
      const at = (months) => chain.find((u) => near(u.end, new Date(new Date(fy.start).getTime() + months * 30.4 * DAY), 20));
      const c3 = at(3), c6 = at(6), c9 = at(9);
      const add = (start, end, val) => {
        if (!out.some((u) => u.period === "Q" && near(u.end, end))) out.push({ start, end, val, period: "Q", derived: true, filed: fy.filed });
      };
      if (c3 && c6 && c6.end > c3.end) add(c3.end, c6.end, c6.val - c3.val);
      if (c6 && c9 && c9.end > c6.end) add(c6.end, c9.end, c9.val - c6.val);
      if (c9) add(c9.end, fy.end, fy.val - c9.val);
    } else {
      const qs = out.filter((u) => u.period === "Q" && inYear(u));
      if (qs.length === 3 && !out.some((u) => u.period === "Q" && near(u.end, fy.end))) {
        out.push({ start: qs[2].end, end: fy.end, val: fy.val - qs.reduce((s, u) => s + u.val, 0), period: "Q", derived: true, filed: fy.filed });
      }
    }
  }
  return out.sort((a, b) => new Date(a.end) - new Date(b.end));
}

const FLOW = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  eps: ["EarningsPerShareDiluted"],
  sga: ["SellingGeneralAndAdministrativeExpense"],
  depreciation: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "Depreciation"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating"],
  incomeTax: ["IncomeTaxExpenseBenefit"],
  preTaxIncome: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquireOtherPropertyPlantAndEquipment"],
  dividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  stockComp: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
};
// Concepts that come from the cash-flow statement, which 10-Qs report year to date.
const CASH_FLOW = new Set(["operatingCashFlow", "capex", "dividendsPaid", "buybacks", "stockComp", "depreciation"]);
const INSTANT = {
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  shortTermDebt: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  receivables: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  ppe: ["PropertyPlantAndEquipmentNet"],
};

async function getCompanyFacts(symbol) {
  const cik = await cikFor(symbol);
  if (!cik) return null;
  return cached(`sec_facts_v4_${symbol}`, 24 * 60 * 60, "sec_facts", async () => {
    const json = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    const facts = json.facts || {};
    const out = { companyName: json.entityName, cik };
    for (const [name, keys] of Object.entries(FLOW)) out[name] = pick(facts, keys, { cumulative: CASH_FLOW.has(name) });
    for (const [name, keys] of Object.entries(INSTANT)) out[name] = pick(facts, keys, { instant: true });
    out.sharesOutstanding = pick(facts, ["dei:EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], { instant: true, unit: "shares" });
    out.dilutedShares = pick(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], { unit: "shares" });
    return out;
  });
}

// EDGAR full-text search (filings since 2001). Used to spot language a filing's metadata
// doesn't capture, e.g. "going concern" or "material weakness", without downloading every
// filing's full text. Keep request volume low — SEC asks for <=10/sec across all endpoints.
async function fullTextSearch({ q, forms, cik, startdt, enddt }) {
  const params = new URLSearchParams({ q: `"${q}"` });
  if (forms) params.set("forms", forms);
  if (cik) params.set("ciks", cik);
  // EDGAR ignores startdt/enddt unless dateRange=custom is set and both ends are given.
  if (startdt || enddt) {
    params.set("dateRange", "custom");
    params.set("startdt", startdt || "2001-01-01");
    params.set("enddt", enddt || new Date().toISOString().slice(0, 10));
  }
  const json = await fetchJson(`https://efts.sec.gov/LATEST/search-index?${params}`);
  return (json.hits?.hits || []).map((h) => {
    const [accession, filename] = String(h._id).split(":");
    const cikNum = h._source.ciks?.[0] ? Number(h._source.ciks[0]) : null;
    return {
      form: h._source.root_forms?.[0] || h._source.file_type || "",
      filedAt: h._source.file_date,
      accession,
      name: h._source.display_names?.[0] || "",
      url: cikNum && filename ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession.replace(/-/g, "")}/${filename}` : null,
    };
  });
}

// ---- Filings (for AI summaries) ----

// Caches the FULL unfiltered filing list per symbol (one network call serves every form
// filter) and filters in memory — a per-`forms` cache key would mean different callers with
// different form lists silently clobber each other's cached results.
async function getAllRecentFilings(symbol) {
  const cik = await cikFor(symbol);
  if (!cik) return [];
  return cached(`sec_filings_all_${symbol}`, 6 * 60 * 60, "sec_filings", async () => {
    const json = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const r = json.filings?.recent || {};
    const out = [];
    for (let i = 0; i < (r.form || []).length && out.length < 250; i++) {
      const acc = r.accessionNumber[i].replace(/-/g, "");
      out.push({
        form: r.form[i],
        filingDate: r.filingDate[i],
        reportDate: r.reportDate[i],
        accession: r.accessionNumber[i],
        items: r.items?.[i] || "",
        description: r.primaryDocDescription?.[i] || "",
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}`,
      });
    }
    return out;
  });
}

async function getRecentFilings(symbol, forms = ["10-K", "10-Q", "8-K"]) {
  const all = await getAllRecentFilings(symbol);
  return all.filter((f) => forms.includes(f.form)).slice(0, 40);
}

// Strip an EDGAR HTML filing to readable text (drops the inline-XBRL header and markup).
function htmlToText(html) {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function getFilingText(url) {
  return htmlToText(await fetchText(url));
}

// Press-release exhibits (EX-99.x) of a filing, as text: an 8-K Item 2.02's actual numbers live
// in exhibit 99.1, not the cover document. Reads the filing folder's index.json.
async function getExhibit99Texts(primaryUrl, { max = 2 } = {}) {
  const folder = String(primaryUrl).replace(/\/[^/]*$/, "");
  const idx = await cached(`sec_index_${folder}`, 7 * 24 * 60 * 60, "sec_filings", () => fetchJson(`${folder}/index.json`));
  const files = (idx.directory?.item || []).map((i) => i.name).filter((n) => /ex-?99/i.test(n) && /\.html?$/i.test(n)).sort().slice(0, max);
  const out = [];
  for (const name of files) out.push({ name, url: `${folder}/${name}`, text: htmlToText(await fetchText(`${folder}/${name}`)) });
  return out;
}

module.exports = { _pick: pick, getTickerCikMap, getExhibit99Texts, getCompanyDirectory, cikFor, getCompanyFacts, getRecentFilings, getAllRecentFilings, getFilingText, fullTextSearch };
