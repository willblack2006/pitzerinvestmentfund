// Earnings call material for agents. Free route (always on): the earnings press release a company
// files as exhibit 99 of its Item 2.02 8-K, read from SEC EDGAR. Paid route (only when
// FMP_API_KEY is set): the full call transcript from Financial Modeling Prep. FMP's paths and
// shapes were taken from its docs, not checked against a live key; parse defensively.
const { cached } = require("../cache");
const sec = require("./sec");

const FMP = "https://financialmodelingprep.com/stable";
const fmpKey = () => process.env.FMP_API_KEY || "";
const transcriptsConfigured = () => !!fmpKey();

async function fmpJson(path) {
  const res = await fetch(`${FMP}${path}${path.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(fmpKey())}`);
  if (!res.ok) throw new Error(`Transcript provider returned ${res.status}`);
  return res.json();
}

// The newest Item 2.02 ("Results of Operations") 8-K and its press release text.
async function latestEarningsRelease(symbol) {
  const filings = await sec.getAllRecentFilings(symbol);
  const f = filings.find((x) => (x.form === "8-K" || x.form === "8-K/A") && /\b2\.02\b/.test(x.items || ""));
  if (!f) return null;
  const exhibits = await sec.getExhibit99Texts(f.url, { max: 2 });
  if (!exhibits.length) exhibits.push({ name: "8-K", url: f.url, text: await sec.getFilingText(f.url) });
  return { form: f.form, filingDate: f.filingDate, reportDate: f.reportDate, accession: f.accession, url: exhibits[0].url, exhibits };
}

// Picks the newest { year, quarter } from FMP's transcript date list.
function newestPeriod(dates) {
  const rows = (Array.isArray(dates) ? dates : []).map((d) => ({ year: Number(d.fiscalYear ?? d.year), quarter: Number(String(d.quarter ?? d.period ?? "").replace(/\D/g, "")), date: d.date || null }))
    .filter((d) => d.year && d.quarter >= 1 && d.quarter <= 4);
  rows.sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  return rows[0] || null;
}

async function latestTranscript(symbol) {
  if (!transcriptsConfigured()) return null;
  return cached(`fmp_transcript_latest_${symbol}`, 12 * 60 * 60, "transcripts", async () => {
    const period = newestPeriod(await fmpJson(`/earning-call-transcript-dates?symbol=${encodeURIComponent(symbol)}`));
    if (!period) return null;
    const rows = await fmpJson(`/earning-call-transcript?symbol=${encodeURIComponent(symbol)}&year=${period.year}&quarter=${period.quarter}`);
    const row = Array.isArray(rows) ? rows[0] : rows;
    const content = String(row?.content || "");
    if (!content) return null;
    return {
      year: period.year, quarter: period.quarter, date: row.date || period.date,
      // Never put the API key in a URL the model or members see.
      url: `${FMP}/earning-call-transcript?symbol=${encodeURIComponent(symbol)}&year=${period.year}&quarter=${period.quarter}`,
      content,
    };
  });
}

module.exports = { latestEarningsRelease, latestTranscript, transcriptsConfigured, newestPeriod };
