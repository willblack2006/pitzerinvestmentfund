// Exit tripwires: conditions a member writes down when buying a position, so selling is a
// pre-made decision rather than an in-the-moment one. Prices and dates are checked
// automatically; "custom" ones are only reminders a member marks tripped by hand.
const db = require("../db");
const { latestPrices } = require("./prices");
const { notify } = require("./notify");

const KINDS = ["price_below", "price_above", "review_by", "custom"];

function describe(t) {
  if (t.kind === "price_below") return `falls below $${t.value}`;
  if (t.kind === "price_above") return `rises above $${t.value}`;
  if (t.kind === "review_by") return `review by ${t.dueDate}`;
  return t.note ? t.note.slice(0, 80) : "custom condition";
}

// Pure: returns a detail string if the tripwire is tripped, else null.
function evaluate(t, price, today) {
  if (t.status !== "active") return null;
  if (t.kind === "price_below" && Number.isFinite(price) && price <= t.value) return `Price is $${price.toFixed(2)}, at or below your $${t.value} line.`;
  if (t.kind === "price_above" && Number.isFinite(price) && price >= t.value) return `Price is $${price.toFixed(2)}, at or above your $${t.value} line.`;
  if (t.kind === "review_by" && today >= t.dueDate) return `The review date ${t.dueDate} has arrived.`;
  return null;
}

// Trips every active automatic tripwire that now holds and notifies once per trip.
async function check() {
  const active = db.prepare("SELECT * FROM tripwires WHERE status = 'active' AND kind != 'custom'").all();
  if (!active.length) return { tripped: 0 };
  const needPrice = [...new Set(active.filter((t) => t.kind.startsWith("price_")).map((t) => t.symbol))];
  const prices = needPrice.length ? await latestPrices(needPrice).catch(() => ({})) : {};
  const today = new Date().toISOString().slice(0, 10);
  let tripped = 0;
  for (const t of active) {
    const detail = evaluate(t, prices[t.symbol]?.price, today);
    if (!detail) continue;
    const r = db.prepare("UPDATE tripwires SET status = 'tripped', trippedAt = datetime('now'), trippedDetail = ? WHERE id = ? AND status = 'active'").run(detail, t.id);
    if (!r.changes) continue;
    tripped++;
<<<<<<< HEAD
    require("./feed/activity").tripwireTripped(t, detail, describe(t));
=======
    try { require("./platform/bus").emit("tripwire", { symbol: t.symbol, tripwireId: t.id, kind: t.kind, detail }); } catch { /* agent triggers are optional */ }
>>>>>>> origin/platform/agent-upgrade
    notify("all", { type: "tripwire", title: `${t.symbol} tripwire: ${describe(t)}`, body: `${detail}${t.note ? ` Why we set it: ${t.note}` : ""}`, link: `#/research/${encodeURIComponent(t.symbol)}/thesis` });
  }
  return { tripped };
}

module.exports = { KINDS, describe, evaluate, check };
