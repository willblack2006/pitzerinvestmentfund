// After a decision: the exit conditions a pitch writes down become tripwires, and the pitch page
// shows how the call is going against what was promised. Pure helpers plus one seeding function.

const addMonths = (iso, m) => new Date(new Date(iso).getTime() + m * 30 * 864e5).toISOString().slice(0, 10);

// The tripwires an executed buy/add should leave behind (not for trims and sells).
function tripwiresFor(p) {
  if (!["buy", "add"].includes(p.direction)) return [];
  const out = [];
  if (p.killCriteria?.trim()) out.push({ kind: "custom", note: `Kill criteria: ${p.killCriteria.trim().slice(0, 270)}` });
  if (p.bearPrice > 0) out.push({ kind: "price_below", value: p.bearPrice, note: `Bear-case price from pitch #${p.id}` });
  if (p.horizonMonths > 0) out.push({ kind: "review_by", dueDate: addMonths(p.createdAt, p.horizonMonths), note: `Horizon of pitch #${p.id}: did the thesis play out?` });
  return out;
}

// Idempotent: a pitch seeds its tripwires once.
function seedTripwires(db, p) {
  if (db.prepare("SELECT 1 FROM tripwires WHERE pitchId = ?").get(p.id)) return 0;
  const rows = tripwiresFor(p);
  const ins = db.prepare("INSERT INTO tripwires (symbol, kind, value, dueDate, note, author, authorId, pitchId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const t of rows) ins.run(p.symbol, t.kind, t.value ?? null, t.dueDate ?? null, t.note, p.author, p.authorId ?? null, p.id);
  return rows.length;
}

// How the call is going. `current` is the latest price (or null), `today` an ISO date.
function review(p, current, today, tripwires = []) {
  if (!["approved", "executed", "rejected"].includes(p.status) || !p.priceAtPitch) return null;
  const horizonDate = p.horizonMonths ? addMonths(p.createdAt, p.horizonMonths) : null;
  const daysLeft = horizonDate ? Math.round((Date.parse(horizonDate) - Date.parse(today)) / 864e5) : null;
  const up = p.direction === "buy" || p.direction === "add";
  const since = current ? current / p.priceAtPitch - 1 : null;
  // 100% = at the base target; negative = moving away from it.
  const progress = current && p.basePrice && p.basePrice !== p.priceAtPitch ? ((current - p.priceAtPitch) / (p.basePrice - p.priceAtPitch)) * 100 : null;
  const hit = current && p.basePrice ? (up ? current >= p.basePrice : current <= p.basePrice) : null;
  const elapsed = horizonDate && p.horizonMonths ? 1 - daysLeft / (p.horizonMonths * 30) : null;
  let state = "unknown";
  if (hit) state = "hit";
  else if (daysLeft !== null && daysLeft < 0) state = "missed";
  else if (progress !== null && elapsed !== null) state = progress >= elapsed * 100 * 0.6 ? "on_track" : "behind";
  return {
    horizonDate, daysLeft, sinceReturn: since, progressPct: progress, state,
    tripped: tripwires.filter((t) => t.status === "tripped").map((t) => t.note || t.kind),
  };
}

module.exports = { tripwiresFor, seedTripwires, review };
