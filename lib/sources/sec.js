const { cached } = require("../cache");

function userAgent() {
  return process.env.SEC_USER_AGENT || "Pitzer Investment Fund research@example.edu";
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
  if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
  return res.json();
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

async function getCompanyFacts(symbol) {
  const map = await getTickerCikMap();
  const cik = map[symbol.toUpperCase()];
  if (!cik) return null;
  return cached(`sec_facts_${symbol}`, 24 * 60 * 60, "sec_facts", async () => {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const json = await fetchJson(url);
    const usGaap = json.facts?.["us-gaap"] || {};

    // Pull from every tag a company might have used for a concept over time (GAAP tags
    // change, e.g. ASC 606 revenue recognition in 2018), merge, dedupe by period end
    // (keeping the most-recently-filed value for that period), then take the most recent.
    const pick = (keys) => {
      const byEnd = new Map();
      for (const key of keys) {
        const units = usGaap[key]?.units?.USD || usGaap[key]?.units?.["USD/shares"];
        if (!units) continue;
        for (const u of units) {
          if (u.form !== "10-K" && u.form !== "10-Q") continue;
          const existing = byEnd.get(u.end);
          if (!existing || new Date(u.filed) >= new Date(existing.filed)) {
            byEnd.set(u.end, u);
          }
        }
      }
      return [...byEnd.values()]
        .sort((a, b) => new Date(a.end) - new Date(b.end))
        .slice(-12)
        .map((u) => ({ end: u.end, val: u.val, form: u.form }));
    };

    return {
      companyName: json.entityName,
      revenue: pick([
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
      ]),
      netIncome: pick(["NetIncomeLoss"]),
      eps: pick(["EarningsPerShareDiluted"]),
    };
  });
}

module.exports = { getTickerCikMap, getCompanyFacts };
