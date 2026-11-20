// Live run events: an in-process hub that carries one run's steps and answer text to anyone
// watching it (GET /api/agents/runs/:id/stream). Render runs one instance, so memory is enough,
// like lib/events.js. Each run keeps a short replay buffer so a page that connects a moment after
// the run started still sees every step, and the text written so far.
//
// Events: { type: "step", step }            a step was logged (tool call, model turn, review)
//         { type: "turn", n }               a new model turn started (text resets)
//         { type: "text", delta }           answer text arrived (decoded, ready to show)
//         { type: "done", output, costUsd }  the run finished
//         { type: "error", error, code }    the run failed or was refused
const { EventEmitter } = require("node:events");

const hub = new EventEmitter();
hub.setMaxListeners(0);
const runs = new Map(); // runId -> { events: [], text, raw, field, finished, timer }
const KEEP_EVENTS = 300;
const KEEP_AFTER_DONE_MS = 2 * 60e3;
const wanted = new Set(); // runs started by a page that will listen (stream from the first turn)

const state = (id) => {
  let s = runs.get(id);
  if (!s) { s = { events: [], text: "", raw: "", field: null, sent: 0, finished: false, timer: null }; runs.set(id, s); }
  return s;
};

function publish(runId, event) {
  const id = Number(runId);
  const s = state(id);
  if (s.finished) return;
  s.events.push(event);
  if (s.events.length > KEEP_EVENTS) {
    // Keep the newest; fold old text deltas into one so a late viewer still gets the full text.
    s.events = [{ type: "text_snapshot", text: s.text }, ...s.events.filter((e) => e.type !== "text" && e.type !== "text_snapshot").slice(-KEEP_EVENTS / 2)];
  }
  if (event.type === "done" || event.type === "error") {
    s.finished = true;
    wanted.delete(id);
    s.timer = setTimeout(() => runs.delete(id), KEEP_AFTER_DONE_MS);
    s.timer.unref?.();
  }
  hub.emit(`run:${id}`, event);
}

// Calls fn(event) for every past and future event of the run. Returns an unsubscribe function.
function subscribe(runId, fn) {
  const id = Number(runId);
  const s = runs.get(id);
  if (s) for (const e of s.events) fn(e);
  const h = (e) => fn(e);
  hub.on(`run:${id}`, h);
  return () => hub.off(`run:${id}`, h);
}

const listening = (runId) => wanted.has(Number(runId)) || hub.listenerCount(`run:${Number(runId)}`) > 0;
// A page asked for this run and will connect: stream it from the first model turn.
const expect = (runId) => { wanted.add(Number(runId)); state(Number(runId)); };
const finished = (runId) => !!runs.get(Number(runId))?.finished;
const known = (runId) => runs.has(Number(runId));

// ---- Answer text out of a structured (JSON) answer ----
// Agents answer in JSON (the answer text is one string field). While the JSON arrives we decode
// that field's value so far and send only the new part, so the page can show plain words.

// The decoded value of string field `name` in a partial JSON text, or null if it hasn't started.
function partialField(json, name) {
  const m = new RegExp(`"${name}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let out = "";
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === "\"") return out;
    if (c !== "\\") { out += c; continue; }
    const n = json[i + 1];
    if (n === undefined) return out; // escape split across chunks: wait for the rest
    const simple = { n: "\n", t: "\t", r: "", b: "", f: "", "\"": "\"", "\\": "\\", "/": "/" };
    if (n in simple) { out += simple[n]; i++; continue; }
    if (n === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5; continue;
    }
    i++;
  }
  return out;
}

function turn(runId, n) {
  const s = state(Number(runId));
  s.raw = ""; s.sent = 0; s.text = "";
  publish(runId, { type: "turn", n });
}

// A raw text delta from the model. `field` names the JSON string field holding the answer
// (null = the text is the answer itself).
function delta(runId, raw, { field = "answer" } = {}) {
  const s = state(Number(runId));
  s.raw += raw;
  const text = field ? partialField(s.raw, field) : s.raw;
  if (text == null || text.length <= s.sent) return;
  const d = text.slice(s.sent);
  s.sent = text.length; s.text = text;
  publish(runId, { type: "text", delta: d });
}

// A step as a page may see it: no tool output, no long args.
function stepView(s) {
  const out = { at: s.at, kind: s.kind };
  for (const k of ["name", "ok", "error", "source_url", "toolCalls", "model", "note", "from"]) if (s[k] !== undefined) out[k] = s[k];
  if (s.args) out.args = JSON.parse(JSON.stringify(s.args, (k, v) => (typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v)));
  return out;
}

module.exports = { publish, subscribe, listening, expect, finished, known, turn, delta, partialField, stepView, _runs: runs };
