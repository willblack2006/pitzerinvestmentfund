// Street → beat/miss strip (WS10): one tile per earnings release with the EPS surprise and how
// the stock moved over the next trading day and the next five. Answers "does this company beat,
// and does the market care?" Release dates are 8-K Item 2.02 filings (from the annotations
// endpoint), so the move is measured from the close before the release.
import { api, esc } from "../shared.js";
import { loadAnnotations } from "./markers.js";
import { fmtSignedPct, dataToggle, tooltip } from "./rv.js";

export const beatMissHtml = () => `
  <section class="panel span-full" aria-labelledby="bm-h">
    <div class="panel-head"><h3 id="bm-h">Beat or miss, and how the stock reacted</h3><span class="muted small">Each results release: EPS surprise, then the price move after it</span></div>
    <div id="bmBody"><p class="muted small">Loading results releases…</p></div>
  </section>`;

// Move from the close before `date` to the close `n` trading days after the release day.
export function reaction(bars, date, n) {
  const i = bars.findIndex((b) => b.date >= date);
  if (i <= 0) return null;
  // Close before the release day to the close n days after it, so a release before the open
  // (moves day i) and one after the close (moves day i+1) are both inside the window.
  const j = Math.min(bars.length - 1, i + n);
  if (j <= i - 1 || j >= bars.length) return null;
  return (bars[j].close / bars[i - 1].close - 1) * 100;
}

export async function loadBeatMiss(symbol) {
  const box = document.getElementById("bmBody");
  if (!box) return;
  let ann;
  try {
    ann = await loadAnnotations(symbol);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load releases: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById("bmBody")) return;
  const rel = (ann?.layers?.earnings || []).filter((e) => !e.upcoming).slice(-12);
  if (!rel.length) { box.innerHTML = `<p class="muted">No results releases (8-K Item 2.02) found in SEC filings.</p>`; return; }
  // Reactions need daily bars; releases older than two years show the surprise only.
  const daily = await api(`/api/research/${encodeURIComponent(symbol)}/bars?frame=2Y`).then((r) => (r.bars || []).filter((b) => Number.isFinite(b.close))).catch(() => []);
  const rows = rel.map((e) => {
    const src = daily.length && e.date >= daily[0].date ? daily : null;
    return { ...e, d1: src ? reaction(src, e.date, 1) : null, d5: src ? reaction(src, e.date, 5) : null };
  });
  const next = (ann?.layers?.earnings || []).find((e) => e.upcoming);
  const beats = rows.filter((r) => r.surprisePct != null && r.surprisePct >= 0).length;
  const known = rows.filter((r) => r.surprisePct != null).length;
  const ups = rows.filter((r) => r.d1 != null && r.d1 > 0).length, moved = rows.filter((r) => r.d1 != null);
  const avgAbs = moved.length ? moved.reduce((s, r) => s + Math.abs(r.d1), 0) / moved.length : null;
  const tile = (r) => {
    const s = r.surprisePct;
    const cls = s == null ? "rv-bm-na" : s >= 0 ? "rv-bm-beat" : "rv-bm-miss";
    const word = s == null ? "No estimate" : s >= 0 ? "Beat" : "Miss";
    const tip = `<strong>${esc(r.date)}</strong><br>${word}${s != null ? ` by ${Math.abs(s * 100).toFixed(1)}%` : ""}${r.actual != null ? `<br>EPS $${r.actual.toFixed(2)}${r.estimate != null ? ` vs $${r.estimate.toFixed(2)}` : ""}` : ""}<br>Next day ${fmtSignedPct(r.d1)} · 5 days ${fmtSignedPct(r.d5)}`;
    return `<li class="rv-bm-tile ${cls}" tabindex="0" data-tip="${esc(tip)}">
      <span class="rv-bm-date">${esc(r.date.slice(0, 7))}</span>
      <span class="rv-bm-word"><span aria-hidden="true">${s == null ? "–" : s >= 0 ? "+" : "−"}</span> ${word}${s != null ? ` ${Math.abs(s * 100).toFixed(0)}%` : ""}</span>
      <span class="rv-bm-move ${r.d1 == null ? "" : r.d1 >= 0 ? "tone-good" : "tone-bad"}">${r.d1 == null ? "—" : `${fmtSignedPct(r.d1)} next day`}</span>
    </li>`;
  };
  box.innerHTML = `
    <p>${known ? `Beat in <strong>${beats} of ${known}</strong> releases shown.` : ""} ${moved.length ? `The stock rose the next day after <strong>${ups} of ${moved.length}</strong>, moving ${avgAbs.toFixed(1)}% on average either way.` : ""}${next ? ` Next release ${esc(next.date)}.` : ""}</p>
    <ol class="rv-bm" id="bmStrip" aria-label="Results releases, oldest first">${rows.map(tile).join("")}</ol>
    <p class="muted small">Beat or miss is reported EPS against the analyst average. The move is from the close before the filing date; a release after the close shows up the next day. A beat with a falling stock usually means the outlook or the quality of the beat disappointed.</p>`;
  const strip = document.getElementById("bmStrip");
  tooltip(box);
  dataToggle(strip, `${symbol} results releases`, ["Release", "Surprise", "EPS", "Estimate", "Next day", "5 days"],
    rows.slice().reverse().map((r) => [r.date, r.surprisePct == null ? "—" : fmtSignedPct(r.surprisePct * 100), r.actual == null ? "—" : `$${r.actual.toFixed(2)}`, r.estimate == null ? "—" : `$${r.estimate.toFixed(2)}`, fmtSignedPct(r.d1), fmtSignedPct(r.d5)]));
}
