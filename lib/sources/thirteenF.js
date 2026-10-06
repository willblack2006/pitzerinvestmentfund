// EDGAR 13F-HR filings: a manager's quarterly information table of equity holdings. 13F
// filings have a ~45-day lag after quarter end (deadline is 45 days after quarter close).
const { cached } = require("../cache");

function userAgent() {
  return process.env.SEC_USER_AGENT || "Pitzer Investment Fund research@example.edu";
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
  if (!res.ok) throw new Error(`EDGAR request failed: ${res.status} ${url}`);
  return res.json();
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/xml,text/xml,*/*" } });
  if (!res.ok) throw new Error(`EDGAR request failed: ${res.status} ${url}`);
  return res.text();
}

// Pure parse: a 13F information table XML -> [{ nameOfIssuer, cusip, value, shares, putCall }].
// `value` is reported in thousands of dollars, per the SEC's 13F schema.
function parseInfoTable(xml) {
  const entries = [...xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)];
  return entries.map((m) => {
    const block = m[1];
    const grab = (tag) => block.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)<\\/(?:\\w+:)?${tag}>`, "i"))?.[1]?.trim() || "";
    return {
      nameOfIssuer: grab("nameOfIssuer"),
      cusip: grab("cusip"),
      value: Number(grab("value")) || 0,
      shares: Number(grab("sshPrnamt")) || 0,
      putCall: grab("putCall") || null,
    };
  });
}

async function get13FFilings(cik, limit = 2) {
  return cached(`13f_filings_${cik}`, 12 * 60 * 60, "sec_13f", async () => {
    const json = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const r = json.filings?.recent || {};
    const out = [];
    for (let i = 0; i < (r.form || []).length && out.length < limit; i++) {
      if (!/^13F-HR/.test(r.form[i])) continue;
      out.push({ accession: r.accessionNumber[i], filingDate: r.filingDate[i], periodOfReport: r.reportDate[i] });
    }
    return { companyName: json.name || "", filings: out };
  });
}

async function findInfoTableUrl(cik, accession) {
  const accNoDash = accession.replace(/-/g, "");
  const cikNum = Number(cik);
  const idx = await fetchJson(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/index.json`);
  const files = idx.directory?.item || [];
  const info = files.find((f) => /infotable/i.test(f.name) && /\.xml$/i.test(f.name));
  return info ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${info.name}` : null;
}

// The two most recent 13F-HR filings' parsed holdings, for a quarter-over-quarter comparison.
async function getHoldings(cik) {
  return cached(`13f_holdings_${cik}`, 24 * 60 * 60, "sec_13f", async () => {
    const { companyName, filings } = await get13FFilings(cik, 2);
    if (!filings.length) return { companyName, filings: [], current: [], prior: [] };
    const urls = await Promise.all(filings.map((f) => findInfoTableUrl(cik, f.accession).catch(() => null)));
    const tables = await Promise.all(urls.map((u) => (u ? fetchXml(u).then(parseInfoTable).catch(() => []) : [])));
    return { companyName, filings, current: tables[0] || [], prior: tables[1] || [] };
  });
}

module.exports = { parseInfoTable, get13FFilings, getHoldings };
