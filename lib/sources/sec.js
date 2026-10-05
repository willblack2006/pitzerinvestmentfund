const { cached } = require("../cache");

function userAgent() {
  return process.env.SEC_USER_AGENT || "Pitzer Investment Fund research@example.edu";
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
  if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
  return res.text();
}

async function getTickerCikMap() {
  return cached("sec_company_tickers", 24 * 60 * 60, "sec_tickers", async () => {
    const json = await fetchJson("https://www.sec.gov/files/company_tickers.json");
    const map = {};
    for (const row of Object.values(json)) {
      map[row.ticker.toUpperCase()] = String(row.cik_str).padStart(10, "0");
    }
    return map;
  });
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
function pick(facts, keys, { instant = false, unit } = {}) {
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
      const period = instant ? instantPeriod(u, form) : durationPeriod(u);
      if (!period) continue;
      const id = `${period}|${u.end}`;
      const existing = byPeriod.get(id);
      if (!existing || new Date(u.filed) >= new Date(existing.filed)) byPeriod.set(id, { ...u, period });
    }
  }
  const all = [...byPeriod.values()].sort((a, b) => new Date(a.end) - new Date(b.end));
  const quarters = all.filter((u) => u.period === "Q").slice(-12);
  const years = all.filter((u) => u.period === "FY").slice(-6);
  // `form` keeps its meaning for the UI: "10-Q" = single quarter, "10-K" = fiscal year.
  return [...quarters, ...years]
    .sort((a, b) => new Date(a.end) - new Date(b.end))
    .map((u) => ({ end: u.end, val: u.val, form: u.period === "FY" ? "10-K" : "10-Q" }));
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
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  dividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
};
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
  return cached(`sec_facts_v3_${symbol}`, 24 * 60 * 60, "sec_facts", async () => {
    const json = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    const facts = json.facts || {};
    const out = { companyName: json.entityName, cik };
    for (const [name, keys] of Object.entries(FLOW)) out[name] = pick(facts, keys);
    for (const [name, keys] of Object.entries(INSTANT)) out[name] = pick(facts, keys, { instant: true });
    out.sharesOutstanding = pick(facts, ["dei:EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], { instant: true, unit: "shares" });
    out.dilutedShares = pick(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], { unit: "shares" });
    return out;
  });
}

// ---- Filings (for AI summaries) ----

async function getRecentFilings(symbol, forms = ["10-K", "10-Q", "8-K"]) {
  const cik = await cikFor(symbol);
  if (!cik) return [];
  return cached(`sec_filings_${symbol}`, 6 * 60 * 60, "sec_filings", async () => {
    const json = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const r = json.filings?.recent || {};
    const out = [];
    for (let i = 0; i < (r.form || []).length && out.length < 40; i++) {
      if (!forms.includes(r.form[i])) continue;
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

module.exports = { getTickerCikMap, getCompanyFacts, getRecentFilings, getFilingText };
