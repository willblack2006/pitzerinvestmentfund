// What reaches members' inboxes from the agents, and when. Most agent output is useful to read
// but not worth an interruption, so it goes into ONE daily digest per member; only a few things
// are sent on their own (see `alertFor`). Will's rule (2026-11-19): don't overload alerts, every
// notification has to be worth opening.
//
// Sent on their own (type agentBrief):
//   - push-tier filings (bankruptcy, delisting, impairment, non-reliance, change in control...)
//   - earnings on a big holding (>= BIG_WEIGHT of invested value) or with a negative tone
//   - a thesis check that says a written thesis is weakened or broken
//   - red team on a pitch, to its author only; the weekly memo once an editor approves it
// Everything else (other filings, 10-Qs, earnings previews, weekly macro/ownership/policy
// reports) is listed in the daily digest (type agentDigest), sent once on weekday evenings.
const db = require("../../db");
const { notifyAiMembers } = require("./notifyAi");

const BIG_WEIGHT = 0.05;
const DIGEST_HOUR_UTC = 22; // 5 PM New York in winter, 6 PM in summer: after the close and the 4:30 filings
const DIGEST_WORKFLOWS = ["filing_flash", "earnings_flash", "earnings_preview", "red_team", "thesis_check", "macro_brief", "ownership_watch", "policy_watch"];
const MAX_BODY = 480;

// The holding's share of invested value (0 to 1), or null when the fund doesn't own it.
function weightOf(symbol) {
  const rows = db.prepare("SELECT symbol, marketValue FROM positions").all();
  const total = rows.reduce((a, r) => a + (r.marketValue || 0), 0);
  const row = rows.find((r) => r.symbol === symbol);
  return row && total > 0 ? row.marketValue / total : null;
}

// Why a flash brief deserves its own notification, or null (digest only).
function alertFor({ tier, workflow, symbol, tone }) {
  if (tier === "push") return "important filing";
  if (workflow === "earnings_flash") {
    const w = weightOf(symbol);
    if (w != null && w >= BIG_WEIGHT) return `earnings on a ${(w * 100).toFixed(0)}% holding`;
    if (tone === "negative") return "negative earnings";
  }
  return null;
}

// One line per run for the digest.
function lineFor(r) {
  const o = r.output || {};
  const sym = r.symbol || o.symbol || "";
  switch (r.workflow) {
    case "earnings_flash": return `${sym} earnings: ${o.headline || ""}`;
    case "filing_flash": return `${sym} ${o.form || "filing"}: ${o.headline || ""}`;
    case "earnings_preview": return `${sym} reports ${o.reportDate || "soon"}: preview ready`;
    case "red_team": return `Red team on the ${sym} pitch: ${(o.objections || []).length} objections`;
    case "thesis_check": return o.status && o.status !== "intact" ? `${sym} thesis check: ${o.status}` : null;
    default: return o.title || null;
  }
}

// Builds the digest from finished runs since `since` (SQLite datetime text) that weren't already
// sent on their own. Pure apart from the read; returns null when there's nothing to say.
function build(since) {
  const rows = db.prepare(`SELECT id, workflow, symbol, output FROM agent_runs WHERE status = 'done' AND createdAt >= ?
    AND workflow IN (${DIGEST_WORKFLOWS.map(() => "?").join(",")}) ORDER BY id`).all(since, ...DIGEST_WORKFLOWS);
  const lines = [];
  let specific = 0;
  for (const r of rows) {
    let output = null;
    try { output = JSON.parse(r.output || "null"); } catch { /* skip */ }
    if (!output || output.alerted || output.skipped) continue;
    const line = lineFor({ ...r, output });
    if (!line) continue;
    lines.push(line.replace(/\s+/g, " ").trim().replace(/:\s*$/, ""));
    if (r.symbol || output.symbol) specific++;
  }
  // The weekly macro/ownership/policy reports alone don't justify a notification; they ride
  // along with the next digest that has news on a holding or pitch.
  if (!specific) return null;
  let body = "";
  let shown = 0;
  for (const l of lines) {
    const next = `${body}${body ? "\n" : ""}• ${l}`;
    if (next.length > MAX_BODY - 20) break;
    body = next; shown++;
  }
  if (shown < lines.length) body += `\n+ ${lines.length - shown} more`;
  return { title: `Research digest: ${lines.length} new item${lines.length === 1 ? "" : "s"}`, body, count: lines.length };
}

const sqlTime = (d) => d.toISOString().replace("T", " ").slice(0, 19);

// Sends today's digest once, on weekdays after DIGEST_HOUR_UTC. It covers everything since the
// previous digest that was sent (so Monday's covers the weekend, and a quiet day rolls into the
// next). The marker is an agent_events row, recorded only when a digest goes out.
function maybeSend({ now = new Date(), agents = require(".") } = {}) {
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6 || now.getUTCHours() < DIGEST_HOUR_UTC) return null;
  const day = now.toISOString().slice(0, 10);
  if (db.prepare("SELECT 1 FROM agent_events WHERE dedupeKey = ?").get(`DIGEST:${day}`)) return null;
  const prev = db.prepare("SELECT createdAt FROM agent_events WHERE type = 'DIGEST' ORDER BY id DESC LIMIT 1").get();
  const since = prev?.createdAt || sqlTime(new Date(now.getTime() - 3 * 864e5));
  const d = build(since);
  if (!d) return { sent: 0 };
  agents.recordEvent({ dedupeKey: `DIGEST:${day}`, type: "DIGEST", title: `Research digest ${day}`, asOf: day });
  const sent = notifyAiMembers({ type: "agentDigest", title: d.title, body: d.body, link: "#/agents" });
  return { sent: sent.length, items: d.count };
}

module.exports = { alertFor, build, maybeSend, weightOf, BIG_WEIGHT, DIGEST_HOUR_UTC };
