// Free checks (no model): spec conditions and rule steps. A condition is
// { metric, op, value } where metric is a registry name ("quote.changePct"), a step result
// ("d1.data.keyStats.forwardPE"; the "data." can be left out for tool steps), the last run's
// output ("$prev.score") or the triggering event ("$event.sigma").
//
// `crosses_above`, `crosses_below`, `changed` and `pct_change_gt` compare with the value seen on
// the agent's previous run for the same symbol, which the engine stores in the run output as
// `metrics`. On the first run there is nothing to compare with, so they don't pass.
const registry = require("../metrics/registry");

function pathGet(obj, parts) {
  let v = obj;
  for (const p of parts) { if (v == null) return undefined; v = v[p]; }
  return v;
}

// Value of a reference in an evaluation scope. Returns { value, source, asOf, sourceUrl, error }.
async function resolve(ref, scope) {
  if (typeof ref !== "string") return { value: ref };
  const parts = ref.split(".");
  if (parts[0] === "$prev") return { value: pathGet(scope.prev || {}, parts.slice(1)), source: "prev" };
  if (parts[0] === "$event") return { value: pathGet(scope.event || {}, parts.slice(1)), source: "event" };
  if (parts[0] === "$symbol") return { value: scope.symbol };
  const step = scope.steps?.[parts[0]];
  if (step !== undefined) {
    let v = pathGet(step, parts.slice(1));
    if (v === undefined && step && step.data !== undefined) v = pathGet(step.data, parts.slice(1));
    return { value: v, source: "step" };
  }
  if (registry.has(ref)) {
    scope.metricCache = scope.metricCache || new Map();
    if (!scope.metricCache.has(ref)) scope.metricCache.set(ref, registry.value(ref, scope.symbol, { loaders: scope.loaders }));
    const r = await scope.metricCache.get(ref);
    return { ...r, source: "metric" };
  }
  return { value: undefined, error: `Unknown reference ${ref}` };
}

const toNum = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = (v) => (v == null ? "n/a" : typeof v === "number" ? String(Math.round(v * 100) / 100) : Array.isArray(v) ? v.join("/") : String(v));

// Evaluates one condition. Returns { pass, value, prev, reason, metric, missing }.
async function evaluate(cond, scope) {
  const { metric, op } = cond;
  const r = await resolve(metric, scope);
  const value = r.value;
  const prev = scope.prevMetrics ? scope.prevMetrics[metric] : undefined;
  const out = { metric, op, value: value ?? null, prev: prev ?? null, asOf: r.asOf || null, sourceUrl: r.sourceUrl || null };
  if (value === undefined || value === null) return { ...out, pass: false, missing: true, reason: `${metric} is not available${r.error ? ` (${r.error})` : ""}` };
  let target = cond.value;
  if (typeof target === "string" && /[.$]/.test(target) && !["==", "!=", "in"].includes(op)) {
    const t = await resolve(target, scope);
    target = t.value;
  }
  const a = toNum(value), b = toNum(target), p = toNum(prev);
  let pass = false;
  switch (op) {
    case "<": pass = a != null && b != null && a < b; break;
    case "<=": pass = a != null && b != null && a <= b; break;
    case ">": pass = a != null && b != null && a > b; break;
    case ">=": pass = a != null && b != null && a >= b; break;
    case "==": pass = a != null && b != null ? a === b : String(value) === String(target); break;
    case "!=": pass = a != null && b != null ? a !== b : String(value) !== String(target); break;
    case "in": pass = Array.isArray(target) && target.some((t) => String(t) === String(value)); break;
    case "changed": pass = prev !== undefined && prev !== null && JSON.stringify(prev) !== JSON.stringify(value); break;
    case "crosses_above": pass = p != null && a != null && b != null && p < b && a >= b; break;
    case "crosses_below": pass = p != null && a != null && b != null && p > b && a <= b; break;
    case "pct_change_gt": pass = p != null && p !== 0 && a != null && b != null && Math.abs((a / p - 1) * 100) > b; break;
    default: return { ...out, pass: false, reason: `Unknown comparison ${op}` };
  }
  const needsPrev = ["changed", "crosses_above", "crosses_below", "pct_change_gt"].includes(op);
  const reason = needsPrev && (prev === undefined || prev === null)
    ? `${metric} is ${fmt(value)}; no earlier value to compare with yet`
    : `${metric} is ${fmt(value)}${needsPrev ? ` (was ${fmt(prev)})` : ""}, ${pass ? "" : "not "}${op.replace(/_/g, " ")} ${op === "changed" ? "" : fmt(target)}`.trim();
  return { ...out, pass, reason };
}

// All must pass. Stops at the first failure (later metrics aren't fetched).
async function all(conds, scope) {
  const results = [];
  for (const c of conds || []) {
    const r = await evaluate(c, scope);
    results.push(r);
    if (!r.pass) return { pass: false, results };
  }
  return { pass: true, results };
}

// The same comparison on plain numbers, for the dry run's history replay (prev = yesterday).
function compare(op, value, target, prev) {
  const a = toNum(value), b = toNum(target), p = toNum(prev);
  switch (op) {
    case "<": return a != null && b != null && a < b;
    case "<=": return a != null && b != null && a <= b;
    case ">": return a != null && b != null && a > b;
    case ">=": return a != null && b != null && a >= b;
    case "==": return a != null && b != null ? a === b : String(value) === String(target);
    case "!=": return a != null && b != null ? a !== b : String(value) !== String(target);
    case "in": return Array.isArray(target) && target.some((t) => String(t) === String(value));
    case "changed": return prev != null && value != null && JSON.stringify(prev) !== JSON.stringify(value);
    case "crosses_above": return p != null && a != null && b != null && p < b && a >= b;
    case "crosses_below": return p != null && a != null && b != null && p > b && a <= b;
    case "pct_change_gt": return p != null && p !== 0 && a != null && b != null && Math.abs((a / p - 1) * 100) > b;
    default: return false;
  }
}

// Registry metrics a spec reads in its conditions and rule steps (to snapshot for next time).
function metricsUsed(spec) {
  const names = new Set();
  for (const c of spec.conditions || []) if (registry.has(c.metric)) names.add(c.metric);
  for (const s of spec.steps || []) if (s.type === "rule" && registry.has(s.if.metric)) names.add(s.if.metric);
  return [...names];
}

module.exports = { resolve, evaluate, all, compare, metricsUsed, pathGet };
