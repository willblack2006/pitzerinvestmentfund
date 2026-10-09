// Personal notes. Pure validation here (unit-tested); routes/notes.js does the I/O.
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// Cleans a note from user input. `partial` = only validate the fields present (edits).
function cleanNote(input = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has("symbol")) {
    const s = input.symbol == null || input.symbol === "" ? null : String(input.symbol).toUpperCase().trim().replace(/^\$/, "");
    if (s !== null && !TICKER.test(s)) throw bad("Ticker looks wrong (e.g. AAPL or BRK-B).");
    out.symbol = s;
  }
  if (!partial || has("body")) out.body = String(input.body ?? "").slice(0, 10000);
  if (!partial || has("quote")) out.quote = String(input.quote ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!partial || has("pageRef")) {
    const ref = String(input.pageRef ?? "");
    out.pageRef = /^#\/[\w\-./%=&?]*$/.test(ref) ? ref.slice(0, 300) : ""; // in-app links only
  }
  if (!partial || has("pageTitle")) out.pageTitle = String(input.pageTitle ?? "").slice(0, 200);
  if (!partial || has("visibility")) {
    const v = input.visibility ?? "private";
    if (!["private", "club"].includes(v)) throw bad("Visibility must be private or club.");
    out.visibility = v;
  }
  if (!partial || has("pinned")) out.pinned = input.pinned ? 1 : 0;
  if (!partial || has("tags")) {
    const tags = Array.isArray(input.tags) ? input.tags : String(input.tags ?? "").split(",");
    out.tags = JSON.stringify([...new Set(tags.map((t) => String(t).trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9\-]/g, "")).filter(Boolean))].slice(0, 10));
  }
  if (!partial && !out.body.trim() && !out.quote) throw bad("Write something (or highlight text to quote).");
  return out;
}

module.exports = { cleanNote };
