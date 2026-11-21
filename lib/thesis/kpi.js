// Thesis KPI rules (plan section 3.5). A pillar can carry one rule such as
//   { metric: "fundamentals.revenueGrowthYoY", op: ">=", value: 0.20, staleAfterDays: 120 }
// Evaluating a rule is pure and free: no model call. A rule that holds keeps the pillar
// "intact"; a near miss is "watch"; a clear miss is "weakened". A rule never calls a pillar
// "broken" on its own: that takes a member (or an AI check a member approves).
const OPS = ["<", "<=", ">", ">=", "==", "!=", "between", "crosses_above", "crosses_below", "changed", "pct_change_gt", "in"];
const NEAR_MISS = 0.1; // within 10% of the line (relative) is a near miss

function validateKpi(kpi) {
  if (kpi == null) return null;
  if (typeof kpi !== "object" || Array.isArray(kpi)) return "A KPI rule must be an object.";
  if (!kpi.metric || typeof kpi.metric !== "string" || !/^[a-z]\w*(\.\w+)+$/i.test(kpi.metric)) return "A KPI rule needs a metric name like fundamentals.revenueGrowthYoY.";
  if (!OPS.includes(kpi.op)) return `Unknown operator ${kpi.op}. Use one of: ${OPS.join(" ")}.`;
  if (kpi.op === "between") {
    if (!Array.isArray(kpi.value) || kpi.value.length !== 2 || !kpi.value.map(Number).every(Number.isFinite) || Number(kpi.value[0]) > Number(kpi.value[1])) return "between takes [low, high].";
  } else if (kpi.op === "in") {
    if (!Array.isArray(kpi.value) || !kpi.value.length) return "in takes a list of values.";
  } else if (kpi.op !== "changed" && (kpi.value === null || kpi.value === "" || !Number.isFinite(Number(kpi.value)))) return "A KPI rule needs a numeric value.";
  if (kpi.staleAfterDays != null && !(Number(kpi.staleAfterDays) > 0)) return "staleAfterDays must be a positive number.";
  return null;
}

// Parses (if a string) and validates; throws a 400-style error on a bad rule. null stays null.
function normalizeKpi(kpi) {
  if (kpi == null || kpi === "") return null;
  if (typeof kpi === "string") {
    try { kpi = JSON.parse(kpi); } catch { throw Object.assign(new Error("The KPI rule isn't valid JSON."), { status: 400, expose: true }); }
  }
  const err = validateKpi(kpi);
  if (err) throw Object.assign(new Error(err), { status: 400, expose: true });
  const out = { metric: kpi.metric, op: kpi.op };
  out.value = kpi.op === "between" ? kpi.value.map(Number) : kpi.op === "in" ? kpi.value.slice(0, 20) : kpi.op === "changed" ? null : Number(kpi.value);
  for (const k of ["window", "source", "label"]) if (kpi[k]) out[k] = String(kpi[k]).slice(0, 60);
  if (kpi.staleAfterDays != null) out.staleAfterDays = Number(kpi.staleAfterDays);
  return out;
}

const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 864e5;

// Relative distance of `v` from `line`, used to tell a near miss from a clear one.
function relMiss(v, line) {
  return Math.abs(v - line) / Math.max(Math.abs(line), 1e-9);
}

function fmt(v, unit) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  if (unit === "pct") return `${(v * 100).toFixed(1)}%`;
  if (unit === "usd") {
    const a = Math.abs(v);
    return `${v < 0 ? "-" : ""}$${a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a.toFixed(2)}`;
  }
  return Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(4)).toString();
}

function describeRule(kpi, unit) {
  const line = kpi.value;
  const shown = Array.isArray(line) ? line.map((x) => fmt(x, unit)).join(" to ") : fmt(line, unit);
  if (kpi.op === "changed") return "stays unchanged";
  if (kpi.op === "pct_change_gt") return `moves less than ${fmt(line, "pct")} between checks`;
  if (kpi.op === "between") return `between ${shown}`;
  if (kpi.op === "in") return `one of ${line.join(", ")}`;
  if (kpi.op === "crosses_above") return `> ${shown}`;
  if (kpi.op === "crosses_below") return `< ${shown}`;
  return `${kpi.op} ${shown}`;
}

// reading: { value, asOf, sourceUrl } from the metric registry; prev: the last check's value
// (for changed / pct_change_gt). Returns { status, passed, value, detail, stale }.
// For a thesis pillar, crosses_above / crosses_below mean "stays above / below": the pillar
// holds while the metric is on the right side of the line.
function evaluateKpi(kpi, reading, { now = new Date().toISOString(), prev = null, unit = null, label = null } = {}) {
  const name = label || kpi.label || kpi.metric;
  const v = reading?.value;
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) {
    return { status: "unknown", passed: null, value: null, stale: false, detail: `No current reading for ${name}.` };
  }
  const staleDays = Number(kpi.staleAfterDays) || null;
  if (staleDays && reading.asOf && days(reading.asOf, now) > staleDays) {
    return { status: "unknown", passed: null, value: v, stale: true, detail: `${name} last reported ${String(reading.asOf).slice(0, 10)}, older than ${staleDays} days.` };
  }
  const line = kpi.value;
  let passed, miss = Infinity;
  switch (kpi.op) {
    case "<": case "crosses_below": passed = v < line; miss = relMiss(v, line); break;
    case "<=": passed = v <= line; miss = relMiss(v, line); break;
    case ">": case "crosses_above": passed = v > line; miss = relMiss(v, line); break;
    case ">=": passed = v >= line; miss = relMiss(v, line); break;
    case "==": passed = v === line; break;
    case "!=": passed = v !== line; break;
    case "between": passed = v >= line[0] && v <= line[1]; miss = Math.min(relMiss(v, line[0]), relMiss(v, line[1])); break;
    case "in": passed = line.map(String).includes(String(v)); break;
    case "changed": passed = prev == null || v === prev; break;
    case "pct_change_gt": passed = prev == null || prev === 0 || Math.abs(v / prev - 1) <= line; break;
    default: passed = false;
  }
  const status = passed ? "intact" : miss <= NEAR_MISS ? "watch" : "weakened";
  const rule = describeRule(kpi, unit);
  const detail = passed
    ? `${name} is ${fmt(v, unit)}; the rule (${rule}) holds.`
    : `${name} is ${fmt(v, unit)}; the rule was ${rule}${status === "watch" ? ", a near miss." : "."}`;
  return { status, passed, value: v, stale: false, detail };
}

module.exports = { OPS, validateKpi, normalizeKpi, evaluateKpi, describeRule, fmt };
