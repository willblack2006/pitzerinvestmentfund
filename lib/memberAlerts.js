// Personal price alerts: only their owner sees them, and they arrive in the owner's inbox.
// "above"/"below" fire once, then switch off until re-armed; "move" fires at most once a
// trading day when the stock is up or down at least N% on the day.
const db = require("../db");
const yahoo = require("./sources/yahoo");
const { notify } = require("./notify");

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;
const MAX_PER_MEMBER = 30;

function cleanAlert(input = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || input.symbol !== undefined) {
    out.symbol = String(input.symbol || "").toUpperCase().replace(/^\$/, "").trim();
    if (!TICKER.test(out.symbol)) throw bad("Enter a valid ticker.");
  }
  if (!partial || input.kind !== undefined) {
    if (!["above", "below", "move"].includes(input.kind)) throw bad("Choose rises above, falls below, or moves by.");
    out.kind = input.kind;
  }
  if (!partial || input.value !== undefined) {
    const v = Number(input.value);
    const kind = out.kind ?? input.kind;
    if (!(v > 0) || !Number.isFinite(v)) throw bad(kind === "move" ? "Enter a percent move above 0." : "Enter a price above 0.");
    if (kind === "move" && v > 50) throw bad("Moves are capped at 50% a day.");
    out.value = v;
  }
  if (input.note !== undefined) out.note = String(input.note).slice(0, 200);
  return out;
}

const nyDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

// Pure: does this alert fire on this quote? `day` is today's New York date.
function shouldTrigger(alert, quote, day) {
  if (!alert.active || !quote || !Number.isFinite(quote.price)) return false;
  if (alert.kind === "above") return quote.price >= alert.value;
  if (alert.kind === "below") return quote.price <= alert.value;
  // A daily move only counts once the quote is from today's session (not yesterday's close).
  const quoteDay = quote.time ? nyDay(new Date(quote.time)) : null;
  return Number.isFinite(quote.changePct) && Math.abs(quote.changePct) >= alert.value && alert.lastTriggeredDay !== day && quoteDay === day;
}

function describe(alert, quote) {
  const price = `$${quote.price.toFixed(2)}`;
  if (alert.kind === "above") return { title: `${alert.symbol} rose above $${alert.value}`, body: `Now ${price}.` };
  if (alert.kind === "below") return { title: `${alert.symbol} fell below $${alert.value}`, body: `Now ${price}.` };
  const pct = quote.changePct;
  return { title: `${alert.symbol} is ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% today`, body: `Now ${price} (your alert: moves ${alert.value}% in a day).` };
}

// Checks every active alert against live quotes. Run by the scheduler; safe to call any time.
async function checkAlerts() {
  const alerts = db.prepare("SELECT a.* FROM member_alerts a JOIN members m ON m.id = a.memberId WHERE a.active = 1 AND m.active = 1").all();
  if (!alerts.length) return { fired: 0 };
  const quotes = await yahoo.getQuotes([...new Set(alerts.map((a) => a.symbol))]);
  const day = nyDay();
  let fired = 0;
  for (const a of alerts) {
    const q = quotes[a.symbol];
    if (!shouldTrigger(a, q, day)) continue;
    const { title, body } = describe(a, q);
    if (a.kind === "move") db.prepare("UPDATE member_alerts SET lastTriggeredAt = datetime('now'), lastTriggeredDay = ? WHERE id = ?").run(day, a.id);
    else db.prepare("UPDATE member_alerts SET lastTriggeredAt = datetime('now'), active = 0 WHERE id = ?").run(a.id);
    notify([a.memberId], { type: "priceAlert", title, body: a.note ? `${body} ${a.note}` : body, link: `#/research/${encodeURIComponent(a.symbol)}` });
    fired++;
  }
  return { fired };
}

module.exports = { cleanAlert, shouldTrigger, describe, checkAlerts, nyDay, MAX_PER_MEMBER };
