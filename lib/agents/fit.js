// Fits a tool result into a character budget without breaking it. The old approach cut the JSON
// text at N characters, so a model saw half an object and lost every field after the cut (on
// Research overview that was the fundamentals, the fund's thesis and the red flags). This trims
// the longest arrays first, keeping the newest rows, and says what it left out, so the result
// stays valid JSON with every key present.

const DATE_KEYS = ["date", "end", "period", "quarter", "asOf", "filingDate", "filedAt", "reportDate", "transactionDate", "createdAt", "datetime"];
const MAX_STRING = 1500;

const len = (v) => JSON.stringify(v ?? null).length;

// Arrays sorted oldest-first (time series) keep their tail; everything else keeps its head.
function newestAtEnd(arr) {
  const a = arr[0], b = arr[arr.length - 1];
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const key = DATE_KEYS.find((k) => a[k] != null && b[k] != null);
  return key ? String(a[key]) < String(b[key]) : false;
}

// Every array inside `root`, with its parent, so it can be replaced in place.
function arrays(root) {
  const out = [];
  const walk = (v, parent, key) => {
    if (Array.isArray(v)) { out.push({ arr: v, parent, key }); v.forEach((x, i) => walk(x, v, i)); }
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, v, k);
  };
  walk(root, null, null);
  return out;
}

function shortenStrings(v) {
  if (typeof v === "string") return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}… [${v.length - MAX_STRING} more chars]` : v;
  if (Array.isArray(v)) return v.map(shortenStrings);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shortenStrings(x)]));
  return v;
}

// Returns a copy of `value` whose JSON is at most `max` characters when that can be done by
// trimming arrays and long strings. Trimmed arrays get a marker element saying how many rows
// were left out and which end was kept.
function fit(value, max) {
  if (value == null || typeof value !== "object" || len(value) <= max) return value;
  let v = JSON.parse(JSON.stringify(value));
  if (len(v) > max) v = shortenStrings(v);
  const wrap = Array.isArray(v) ? { rows: v } : null; // so a top-level array has a parent
  const root = wrap || v;
  for (let guard = 0; guard < 200 && len(root) > max; guard++) {
    const candidates = arrays(root).filter((a) => a.parent && a.arr.filter((x) => !x?._leftOut).length > 1);
    if (!candidates.length) break;
    const biggest = candidates.reduce((m, a) => (len(a.arr) > len(m.arr) ? a : m));
    const rows = biggest.arr.filter((x) => !x?._leftOut);
    const prior = biggest.arr.find((x) => x?._leftOut)?._leftOut || 0;
    const tail = newestAtEnd(rows);
    const keep = Math.max(1, Math.floor(rows.length / 2));
    const kept = tail ? rows.slice(-keep) : rows.slice(0, keep);
    const leftOut = prior + rows.length - keep;
    const marker = { _leftOut: leftOut, _note: `${leftOut} ${tail ? "older" : "later"} rows left out to fit` };
    biggest.parent[biggest.key] = tail ? [marker, ...kept] : [...kept, marker];
  }
  return wrap ? wrap.rows : root;
}

module.exports = { fit, newestAtEnd };
