// Valuation football field: one horizontal range per method (52-week range, analyst targets,
// DCF, peer multiples, the stock's own P/E and EV/EBITDA history, the fund's pitch cases),
// lined up against today's price. HTML + CSS percentages, so it reflows on any width.
// data: lib/researchViz.footballField output { price, rows: [{ key, label, low, high, mid, note }], min, max }
import { escHtml as esc, niceTicks, fmtPrice, tooltip, dataToggle } from "./rv.js";

// Categorical colour per method, in a fixed order (never by rank).
const COLOR = { range52: "--s1", analysts: "--s2", dcf: "--s3", comps: "--s4", peBand: "--s5", evBand: "--s5", pitch: "--accent" };

export function footballFieldHtml(data, { id = "ffChart", symbol = "" } = {}) {
  if (!data?.rows?.length) return `<p class="muted">Not enough data for a football field yet (needs at least one of: price targets, SEC cash flows, peer multiples, a 52-week range).</p>`;
  const { price } = data;
  const ticks = niceTicks(data.min, data.max, 5);
  const lo = Math.min(ticks[0] ?? data.min, data.min), hi = Math.max(ticks.at(-1) ?? data.max, data.max);
  const x = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const where = (r) => (!price ? "" : price < r.low ? "below this range" : price > r.high ? "above this range" : "inside this range");
  const label = `${symbol} valuation football field. ${price ? `Price now ${fmtPrice(price)}. ` : ""}${data.rows.map((r) => `${r.label}: ${fmtPrice(r.low)} to ${fmtPrice(r.high)}${r.mid ? `, middle ${fmtPrice(r.mid)}` : ""}${price ? `, price is ${where(r)}` : ""}`).join(". ")}.`;
  return `
    <div class="rv-ff" id="${esc(id)}" role="img" aria-label="${esc(label)}">
      <div class="rv-ff-rows">
        ${data.rows.map((r) => {
          const tip = `<strong>${esc(r.label)}</strong><br>${fmtPrice(r.low)} to ${fmtPrice(r.high)}${r.mid ? ` · middle ${fmtPrice(r.mid)}` : ""}${price ? `<br>Today's price is ${where(r)}${r.mid ? ` (${((r.mid / price - 1) * 100).toFixed(0)}% to the middle)` : ""}` : ""}<br><span class="muted">${esc(r.note || "")}</span>`;
          return `<div class="rv-ff-row">
            <div class="rv-ff-label">${r.key === "pitch" && r.pitchId ? `<a href="#/pitches/${encodeURIComponent(r.pitchId)}">${esc(r.label)}</a>` : esc(r.label)}</div>
            <div class="rv-ff-track">
              <span class="rv-ff-bar" tabindex="0" data-tip="${esc(tip)}" style="left:${x(r.low).toFixed(2)}%;width:${Math.max(0.8, x(r.high) - x(r.low)).toFixed(2)}%;--c:var(${COLOR[r.key] || "--s1"})">
                ${r.mid ? `<i class="rv-ff-mid" style="left:${(((r.mid - r.low) / (r.high - r.low || 1)) * 100).toFixed(2)}%"></i>` : ""}
              </span>
            </div>
            <div class="rv-ff-range">${fmtPrice(r.low)} to ${fmtPrice(r.high)}</div>
          </div>`;
        }).join("")}
        ${price ? `<div class="rv-ff-price" style="--x:${x(price).toFixed(2)}%" aria-hidden="true"><span>Now ${fmtPrice(price)}</span></div>` : ""}
      </div>
      <div class="rv-ff-axis" aria-hidden="true"><div class="rv-ff-ticks">${ticks.map((t) => `<span style="left:${x(t).toFixed(2)}%">${fmtPrice(t)}</span>`).join("")}</div></div>
    </div>`;
}

export function wireFootballField(data, { id = "ffChart", symbol = "" } = {}) {
  const host = document.getElementById(id);
  if (!host || !data?.rows?.length) return;
  tooltip(host);
  dataToggle(host, `${symbol} valuation ranges`, ["Method", "Low", "Middle", "High", "Basis"],
    data.rows.map((r) => [r.label, fmtPrice(r.low), r.mid ? fmtPrice(r.mid) : "—", fmtPrice(r.high), r.note || ""]));
}
