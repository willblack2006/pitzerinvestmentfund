// Small shared pieces for thesis tracking (board and timeline): status chips with shape cues,
// the health gauge, and an SVG sparkline. Colour is never the only cue.
import { esc } from "../../shared.js";

export const STATUS = {
  intact: { label: "Intact", glyph: "●", cls: "th-intact" },
  watch: { label: "Watch", glyph: "◆", cls: "th-watch" },
  weakened: { label: "Weakened", glyph: "◇", cls: "th-weakened" },
  broken: { label: "Broken", glyph: "✕", cls: "th-broken" },
  unknown: { label: "Unknown", glyph: "○", cls: "th-unknown" },
};
export const RANK = { intact: 4, watch: 3, weakened: 2, broken: 1, unknown: 0 };

export function statusChip(status, { compact = false, title = "" } = {}) {
  const s = STATUS[status] || STATUS.unknown;
  return `<span class="th-chip ${s.cls}"${title ? ` title="${esc(title)}"` : ""}><span aria-hidden="true">${s.glyph}</span>${compact ? `<span class="sr-only">${s.label}</span>` : ` ${s.label}`}</span>`;
}

export function healthBadge(h) {
  if (!h || h.score == null) return `<span class="th-health th-health-none">—<span class="sr-only"> no health score</span></span>`;
  const band = h.score >= 80 ? "good" : h.score >= 60 ? "ok" : h.score >= 40 ? "weak" : "bad";
  const why = [h.label, ...(h.adjustments || []).map((a) => `${a.points} ${a.text}`)].join(" · ");
  return `<span class="th-health th-health-${band}" title="${esc(why)}"><strong>${h.score}</strong><span class="muted small"> ${esc(h.label)}</span></span>`;
}

// Health history as a tiny line (0-100 scale), with an accessible summary.
export function sparkline(points, { w = 96, h = 24 } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p.score));
  if (pts.length < 2) return `<span class="muted small">${pts.length ? "1 day" : "no history"}</span>`;
  const x = (i) => (i / (pts.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 2 - (v / 100) * (h - 4);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join("");
  const first = pts[0].score, last = pts.at(-1).score;
  const dir = last > first ? "up" : last < first ? "down" : "flat";
  return `<svg class="th-spark th-spark-${dir}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Health ${esc(first)} to ${esc(last)} since ${esc(pts[0].date)}">
    <line x1="2" x2="${w - 2}" y1="${y(60)}" y2="${y(60)}" class="th-spark-ref"/>
    <path d="${d}"/><circle cx="${x(pts.length - 1)}" cy="${y(last)}" r="2"/></svg>`;
}

export function fmtKpi(kpi, unit) {
  if (!kpi) return "";
  const f = (v) => (unit === "pct" ? `${+(v * 100).toFixed(1)}%` : unit === "usd" ? `$${Number(v).toLocaleString("en-US")}` : String(v));
  const v = Array.isArray(kpi.value) ? kpi.value.map(f).join(" to ") : kpi.value == null ? "" : f(kpi.value);
  const op = { ">=": "≥", "<=": "≤", between: "between", crosses_above: ">", crosses_below: "<", pct_change_gt: "moves <", changed: "unchanged" }[kpi.op] || kpi.op;
  return `${kpi.label || kpi.metric} ${op} ${v}`.trim();
}
