// 13F "breadth": pure math over every 13F filer's position in one stock, quarter over quarter.
// A single small adviser tells you little; thousands of them together show whether
// institutions broadly added to or cut a stock. Used by the live ingest (lib/thirteenFIngest.js)
// and by the history builder (scripts/build-13f-seed.js), so both count the same way.
//
// Shares, not dollar value, decide buyer vs seller: value moves with the price even when a
// filer did nothing. A change within ±1% counts as unchanged (dividend reinvestment, rounding).

const CHANGE_TOL = 0.01;

// Filer size by total reported 13F value (summaryPage tableValueTotal, in dollars).
const SIZE_BUCKETS = [
  { key: "small", label: "Under $1B", max: 1e9 },
  { key: "mid", label: "$1B to $20B", max: 20e9 },
  { key: "large", label: "$20B and up", max: Infinity },
];
function sizeBucket(totalValue) {
  return SIZE_BUCKETS.find((b) => (Number(totalValue) || 0) < b.max).key;
}

const iso = (d) => d.toISOString().slice(0, 10);

// The latest calendar quarter end on or before `date` (YYYY-MM-DD): the period whose 13Fs
// are being filed now.
function quarterEnd(date) {
  const [y, m, d] = date.split("-").map(Number);
  const ends = [[3, 31], [6, 30], [9, 30], [12, 31]];
  for (let i = ends.length - 1; i >= 0; i--) {
    const [em, ed] = ends[i];
    if (m > em || (m === em && d >= ed)) return `${y}-${String(em).padStart(2, "0")}-${ed}`;
  }
  return `${y - 1}-12-31`;
}

function prevQuarter(period) {
  const [y, m] = period.split("-").map(Number);
  return { 3: `${y - 1}-12-31`, 6: `${y}-03-31`, 9: `${y}-06-30`, 12: `${y}-09-30` }[m];
}

// 45 days after the quarter ends; a weekend deadline moves to the Monday. (Federal holidays
// can push it a further day; not handled.)
function filingDeadline(period) {
  const d = new Date(`${period}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 45);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

function daysAfter(period, date) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${period}T00:00:00Z`)) / 86400000);
}

function quarterLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return `Q${Math.ceil(m / 3)} '${String(y).slice(2)}`;
}

// A stock split multiplies every holder's share count by the same factor, which would make
// everyone look like a buyer. In a normal quarter the filers who did nothing sit at a ratio of
// exactly 1; after a split they sit at exactly the split factor instead. So: if the median
// ratio is near a split factor and far more filers sit exactly on it than on 1, it's a split.
const SPLIT_FACTORS = [1.5, 1 / 1.5];
for (let k = 2; k <= 50; k++) SPLIT_FACTORS.push(k, 1 / k);
function splitFactor(pairs) {
  const ratios = pairs.filter((p) => p.prior > 0 && p.cur > 0).map((p) => p.cur / p.prior).sort((a, b) => a - b);
  if (ratios.length < 5) return 1;
  const med = ratios[Math.floor(ratios.length / 2)];
  const on = (f) => ratios.filter((r) => Math.abs(r / f - 1) <= 0.005).length;
  const atOne = on(1);
  for (const f of SPLIT_FACTORS) {
    if (Math.abs(med / f - 1) > 0.25) continue;
    const n = on(f);
    if (n >= ratios.length * 0.1 && n > atOne * 3) return f;
  }
  return 1;
}

// current / prior: Map cik -> { shares, value } for filers holding the stock that quarter.
// filersCur / filersPrior: Map cik -> totalValue for every filer that reported that quarter
// (holder or not), which is how "sold out" is told apart from "hasn't filed yet".
// Buyer/seller counts only use filers that reported both quarters.
function computeBreadth({ current, prior, filersCur, filersPrior }) {
  const pairs = [];
  for (const [cik, cur] of current) {
    const p = prior.get(cik);
    if (p && filersPrior.has(cik)) pairs.push({ prior: p.shares, cur: cur.shares });
  }
  const split = splitFactor(pairs);
  const blank = () => ({ holders: 0, buyers: 0, sellers: 0, unchanged: 0, newPositions: 0, exits: 0 });
  const total = { ...blank(), shares: 0, value: 0 };
  const bySize = Object.fromEntries(SIZE_BUCKETS.map((b) => [b.key, blank()]));
  const tally = (cik, field) => { total[field]++; bySize[sizeBucket(filersCur.get(cik))][field]++; };

  for (const [cik, cur] of current) {
    if (!filersCur.has(cik)) continue;
    total.shares += cur.shares;
    total.value += cur.value || 0;
    tally(cik, "holders");
    if (!filersPrior.has(cik)) continue;
    const p = prior.get(cik);
    if (!p || !(p.shares > 0)) { tally(cik, "newPositions"); tally(cik, "buyers"); continue; }
    const change = cur.shares / (p.shares * split) - 1;
    tally(cik, change > CHANGE_TOL ? "buyers" : change < -CHANGE_TOL ? "sellers" : "unchanged");
  }
  for (const [cik, p] of prior) {
    if (!(p.shares > 0) || !filersCur.has(cik) || !filersPrior.has(cik) || current.has(cik)) continue;
    tally(cik, "exits");
    tally(cik, "sellers");
  }
  let both = 0;
  for (const cik of filersCur.keys()) if (filersPrior.has(cik)) both++;
  const net = (t) => (t.buyers + t.sellers ? (t.buyers - t.sellers) / (t.buyers + t.sellers) : null);
  for (const b of Object.values(bySize)) b.netPct = net(b);
  return { reported: filersCur.size, reportedBoth: both, ...total, netPct: net(total), split, bySize };
}

// ---- EDGAR text formats (pure parses) ----

// "Latest filings" Atom feed (browse-edgar?action=getcurrent&type=13F-HR&output=atom).
// The CIK in the title is the filer's; the accession prefix can be a filing agent's.
function parseAtomFeed(xml) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const title = e.match(/<title>([^<]*)<\/title>/)?.[1] || "";
    const t = title.match(/^(\S+) - (.*) \((\d{10})\) \(([^)]*)\)\s*$/);
    return {
      form: e.match(/term="([^"]+)"/)?.[1] || t?.[1] || "",
      name: (t?.[2] || "").replace(/&amp;/g, "&").trim(),
      cik: t?.[3] || "",
      role: t?.[4] || "",
      accession: e.match(/accession-number=(\d{10}-\d{2}-\d{6})/)?.[1] || "",
      filedAt: e.match(/<updated>([^<]+)<\/updated>/)?.[1] || "",
    };
  }).filter((f) => f.accession && f.cik && f.role === "Filer");
}

// Daily form index (Archives/edgar/daily-index/YYYY/QTRn/form.YYYYMMDD.idx): fixed columns,
// one filing per line. Only original 13F-HR reports.
function parseFormIndex(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^13F-HR\s{2,}(.+?)\s{2,}(\d+)\s+(\d{8})\s+edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt/);
    if (!m) continue;
    out.push({ form: "13F-HR", name: m[1].trim(), cik: m[2].padStart(10, "0"), filedAt: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6)}`, accession: m[4] });
  }
  return out;
}

// A 13F's cover page (primary_doc.xml).
function parsePrimaryDoc(xml) {
  const grab = (tag) => String(xml).match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)<\\/(?:\\w+:)?${tag}>`, "i"))?.[1]?.trim() || "";
  const p = grab("periodOfReport") || grab("reportCalendarOrQuarter");
  const mdy = p.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return {
    period: mdy ? `${mdy[3]}-${mdy[1]}-${mdy[2]}` : null,
    name: grab("name"),
    reportType: grab("reportType"),
    isAmendment: /^(true|y)/i.test(grab("isAmendment")),
    tableEntryTotal: Number(grab("tableEntryTotal")) || 0,
    tableValueTotal: Number(grab("tableValueTotal")) || 0,
  };
}

module.exports = {
  SIZE_BUCKETS, sizeBucket, quarterEnd, prevQuarter, filingDeadline, daysAfter, quarterLabel,
  splitFactor, computeBreadth, parseAtomFeed, parseFormIndex, parsePrimaryDoc,
};
