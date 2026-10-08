// Dividend tracking. The fund's holdings were reconciled with Schwab on TRACKING_START, so
// from that date the share count on every ex-dividend date is known and the dividend owed is
// exact (shares × declared amount). Earlier dividends can't be rebuilt without Schwab's
// history (share counts on past dates are unknown), so they aren't estimated.
// Pure helpers first (unit-tested), then the I/O that uses them.
const db = require("../db");
const yahoo = require("./sources/yahoo");
const { recordTransaction } = require("./portfolio");

const TRACKING_START = "2026-10-08"; // holdings matched Schwab's statement this day (see AGENT_NOTES.md)

const DAY = 864e5;
const isoDaysAgo = (today, n) => new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY).toISOString().slice(0, 10);

// Annual dividend per share: the company's declared forward rate when Yahoo has one,
// otherwise (ETFs, irregular payers) the sum of the last 12 months of payments.
function annualRate({ declaredRate, events = [], today }) {
  if (Number.isFinite(declaredRate) && declaredRate > 0) return { rate: declaredRate, basis: "declared" };
  const yearAgo = isoDaysAgo(today, 365);
  const trailing = events.filter((e) => e.exDate > yearAgo && e.exDate <= today).reduce((s, e) => s + e.amount, 0);
  return trailing > 0 ? { rate: trailing, basis: "trailing 12 months" } : { rate: 0, basis: null };
}

// Payments per year, from how many ex-dates fell in the last 12 months (at least 1 if any).
function paymentsPerYear(events = [], today) {
  const yearAgo = isoDaysAgo(today, 365);
  return events.filter((e) => e.exDate > yearAgo && e.exDate <= today).length;
}

// Ex-dates on or after `since` and on or before `today` that aren't logged yet.
function newExDates(events = [], { since, today, logged = new Set() }) {
  return events.filter((e) => e.exDate >= since && e.exDate <= today && !logged.has(e.exDate));
}

// ---- I/O ----

async function infoFor(symbol, today) {
  const [eventsR, summaryR] = await Promise.allSettled([yahoo.getDividendEvents(symbol), yahoo.getQuoteSummary(symbol)]);
  const events = eventsR.status === "fulfilled" ? eventsR.value : [];
  const q = summaryR.status === "fulfilled" ? summaryR.value : {};
  const sd = q.summaryDetail || {}, ce = q.calendarEvents || {};
  const { rate, basis } = annualRate({ declaredRate: sd.dividendRate?.raw, events, today });
  return {
    symbol, events, rate, basis,
    perYear: paymentsPerYear(events, today),
    // Yahoo's calendar holds the latest declared (or next expected) ex-date and pay date.
    exDate: ce.exDividendDate?.fmt || sd.exDividendDate?.fmt || null,
    payDate: ce.dividendDate?.fmt || null,
    price: Number.isFinite(sd.previousClose?.raw) ? sd.previousClose.raw : null,
  };
}

async function allInfo(positions, today) {
  const out = {};
  const queue = positions.map((p) => p.symbol);
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) { const s = queue.shift(); out[s] = await infoFor(s, today); }
  }));
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

// Log a row for every ex-date since tracking started that isn't recorded yet (scheduler, daily).
async function syncDividends(day = today()) {
  const positions = db.prepare("SELECT symbol, shares FROM positions").all();
  const info = await allInfo(positions, day);
  const insert = db.prepare("INSERT OR IGNORE INTO dividends (symbol, exDate, payDate, perShare, shares, amount) VALUES (?, ?, ?, ?, ?, ?)");
  let added = 0;
  for (const p of positions) {
    const i = info[p.symbol];
    const logged = new Set(db.prepare("SELECT exDate FROM dividends WHERE symbol = ?").all(p.symbol).map((r) => r.exDate));
    for (const e of newExDates(i.events, { since: TRACKING_START, today: day, logged })) {
      insert.run(p.symbol, e.exDate, i.exDate === e.exDate ? i.payDate : null, e.amount, p.shares, Math.round(e.amount * p.shares * 100) / 100);
      added++;
    }
  }
  return { added };
}

// Everything the Dividends page and the Holdings card show.
async function overview(day = today()) {
  const positions = db.prepare("SELECT symbol, shares, totalCost, divIncome FROM positions ORDER BY symbol").all();
  const info = await allInfo(positions, day);
  // A "received" row whose transaction was deleted on the Transactions page is owed again.
  const rows = db.prepare(`SELECT d.*, t.id AS txExists FROM dividends d LEFT JOIN transactions t ON t.id = d.transactionId ORDER BY d.exDate DESC, d.symbol`).all()
    .map(({ txExists, ...r }) => (r.status === "received" && !txExists ? { ...r, status: "expected", transactionId: null } : r));
  const byHolding = positions.map((p) => {
    const i = info[p.symbol];
    const annual = i.rate * p.shares;
    return {
      symbol: p.symbol, shares: p.shares, rate: i.rate, basis: i.basis, perYear: i.perYear,
      annualIncome: annual,
      yieldOnPrice: i.price && i.rate ? i.rate / i.price : null,
      yieldOnCost: p.totalCost > 0 && annual ? annual / p.totalCost : null,
      receivedTotal: p.divIncome || 0,
    };
  }).filter((h) => h.rate > 0).sort((a, b) => b.annualIncome - a.annualIncome);

  // Next 60 days: declared ex-dates and pay dates from Yahoo's calendar, amount at today's shares.
  const horizon = isoDaysAgo(day, -60);
  const upcoming = positions.flatMap((p) => {
    const i = info[p.symbol];
    const perShare = i.rate && i.perYear ? i.rate / i.perYear : null;
    const out = [];
    if (i.exDate && i.exDate >= day && i.exDate <= horizon) out.push({ symbol: p.symbol, kind: "ex", date: i.exDate, payDate: i.payDate, estAmount: perShare ? perShare * p.shares : null });
    else if (i.payDate && i.payDate >= day && i.payDate <= horizon && i.exDate && i.exDate < day) out.push({ symbol: p.symbol, kind: "pay", date: i.payDate, exDate: i.exDate });
    return out;
  }).sort((a, b) => a.date.localeCompare(b.date));

  const received = db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE type = 'dividend' AND date >= ?").get(TRACKING_START).s;
  return {
    trackingStart: TRACKING_START,
    totals: {
      annualIncome: byHolding.reduce((s, h) => s + h.annualIncome, 0),
      receivedSinceStart: received,
      owed: rows.filter((r) => r.status === "expected").reduce((s, r) => s + r.amount, 0),
      payers: byHolding.length,
    },
    rows, byHolding, upcoming,
  };
}

// Mark a logged dividend as paid: records a dividend transaction (credits cash and the
// holding's dividend total) for the amount actually received, which can differ (fractional
// shares, rounding, foreign withholding on ADRs like CJPRY).
function markReceived({ symbol, exDate, amount, date, createdBy = "" }) {
  const row = db.prepare("SELECT * FROM dividends WHERE symbol = ? AND exDate = ?").get(symbol, exDate);
  if (!row) throw Object.assign(new Error("No dividend logged for that ticker and ex-date."), { status: 404 });
  if (row.status === "received" && row.transactionId && db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(row.transactionId)) {
    throw Object.assign(new Error("Already marked received."), { status: 409 });
  }
  const amt = Number.isFinite(amount) && amount > 0 ? amount : row.amount;
  const tx = recordTransaction({ date: date || row.payDate || today(), type: "dividend", symbol, amount: Math.round(amt * 100) / 100, note: `Dividend, ex-date ${exDate}`, createdBy });
  db.prepare("UPDATE dividends SET status = 'received', transactionId = ? WHERE symbol = ? AND exDate = ?").run(tx.id, symbol, exDate);
  return tx;
}

function setSkipped({ symbol, exDate, skipped }) {
  const info = db.prepare("UPDATE dividends SET status = ? WHERE symbol = ? AND exDate = ? AND status != 'received'").run(skipped ? "skipped" : "expected", symbol, exDate);
  if (!info.changes) throw Object.assign(new Error("No unreceived dividend logged for that ticker and ex-date."), { status: 404 });
}

module.exports = { TRACKING_START, annualRate, paymentsPerYear, newExDates, syncDividends, overview, markReceived, setSkipped };
