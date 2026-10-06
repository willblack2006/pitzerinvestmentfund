// AI news triage: pure helpers for validating the model's per-headline scores and picking
// the top items. The actual Claude call lives in lib/sources/claude.js (I/O); this file only
// parses/clamps its response and ranks results, so it's testable without the network.

function parseTriageResponse(text, count) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  let arr;
  try { arr = JSON.parse(match[0]); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  return Array.from({ length: count }, (_, i) => {
    const row = arr[i] || {};
    const materiality = Math.max(0, Math.min(10, Number(row.materiality) || 0));
    const direction = ["positive", "negative", "neutral"].includes(row.direction) ? row.direction : "neutral";
    return { materiality, direction, reason: String(row.reason || "").slice(0, 200) };
  });
}

// Highest-materiality items first; pure noise (materiality 0) is dropped.
function topItems(scoredHeadlines, n = 5) {
  return [...scoredHeadlines].sort((a, b) => b.materiality - a.materiality).filter((h) => h.materiality > 0).slice(0, n);
}

// A short, stable key for caching a result per headline (djb2 hash of the URL/headline).
function headlineKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

module.exports = { parseTriageResponse, topItems, headlineKey };
