// Agents -> Research desk: compare tickers, test a what-if trade list, prepare the meeting
// agenda and hunt for ideas. Each runs an agent and shows its answer on the shared answer card.
import { esc, api, toast } from "./shared.js";
import { answerCard, withProgress, aiErrorHtml, localTime, bindFeedback } from "./ai.js";

const TOOLS = [
  ["compare", "Compare tickers", "Two to four stocks side by side on growth, valuation, risk and signals."],
  ["what_if", "What if we traded…", "See how a buy or sell would change weights, sectors, cash and the policy limits."],
  ["meeting_prep", "Meeting prep", "A one-page agenda from this week: results, decisions, alerts, what's coming."],
  ["ideas", "Idea hunt", "Three to five names worth researching, with why now and what would kill the idea."],
];
const TITLES = { compare: "Comparison", what_if: "What-if", meeting_prep: "Meeting prep", ideas: "Idea hunt" };

const pct = (v) => `${Number(v).toFixed(1)}%`;

// The code-computed part of a what-if: weights before and after, so members see the facts
// the agent was given without having to trust the prose.
export function simulationTable(sim) {
  if (!sim) return "";
  const names = [...new Set([...sim.before.positions, ...sim.after.positions].map((p) => p.symbol))];
  const b = Object.fromEntries(sim.before.positions.map((p) => [p.symbol, p.weight])), a = Object.fromEntries(sim.after.positions.map((p) => [p.symbol, p.weight]));
  const changed = names.filter((s) => (b[s] || 0) !== (a[s] || 0));
  const rows = changed.length ? changed : names.slice(0, 5);
  return `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Weights before and after the trades</caption>
    <thead><tr><th scope="col" class="left">Holding</th><th scope="col" class="num">Now</th><th scope="col" class="num">After</th></tr></thead>
    <tbody>${rows.map((s) => `<tr><th scope="row" class="left">${esc(s)}</th><td class="num">${b[s] != null ? pct(b[s]) : "—"}</td><td class="num">${a[s] != null ? pct(a[s]) : "—"}</td></tr>`).join("")}
      <tr><th scope="row" class="left">Cash</th><td class="num">${pct(sim.before.cashPct)}</td><td class="num">${pct(sim.after.cashPct)}</td></tr></tbody></table></div>
    ${sim.newPolicyIssues.length ? `<p class="notice small" role="alert"><strong>New policy issues:</strong> ${sim.newPolicyIssues.map(esc).join("; ")}</p>`
      : sim.policy ? `<p class="muted small">No new policy limit is crossed.</p>` : `<p class="muted small">The fund has no policy limits set, so none were checked.</p>`}
    ${sim.notes.length ? `<p class="small">${sim.notes.map(esc).join(" ")}</p>` : ""}`;
}

export function deskResult(o, runId, feedback) {
  const card = answerCard({ ...o, question: o.question }, runId, { feedback });
  return o.kind === "what_if" && o.simulation ? `<section class="panel">${simulationTable(o.simulation)}</section>${card}` : card;
}

function formFor(kind) {
  if (kind === "compare") return `<label class="field-block">Tickers (2 to 4, separated by spaces or commas)<input name="symbols" placeholder="e.g. NVDA AMD MU" required autocomplete="off" maxlength="40"></label>`;
  if (kind === "meeting_prep") return `<label class="field-block">Cover everything since<input type="date" name="since"></label><p class="muted small">Leave empty for the last 7 days.</p>`;
  if (kind === "ideas") return `<label class="field-block">Focus<select name="focus"><option value="balanced">Any angle</option><option value="value">Cheap versus peers</option><option value="growth">Growth and rising estimates</option><option value="insiders">Insider buying and institutions</option><option value="gaps">Gaps in our portfolio</option></select></label>`;
  return `<div id="tradeRows">${tradeRow()}</div><button type="button" class="btn btn-ghost btn-sm" id="addTrade">Add another trade</button>
    <p class="muted small">Nothing is traded or saved. Enter either dollars or a percent of the fund. Weights and policy checks are computed by the app, not the AI.</p>`;
}

function tradeRow() {
  return `<div class="desk-trade" role="group" aria-label="Trade"><select name="action" aria-label="Buy or sell"><option value="buy">Buy</option><option value="sell">Sell</option></select>
    <input name="symbol" placeholder="Ticker" aria-label="Ticker" maxlength="12" autocomplete="off">
    <input name="usd" type="number" min="0" step="any" placeholder="$ amount" aria-label="Dollar amount">
    <input name="pct" type="number" min="0" max="100" step="any" placeholder="or % of fund" aria-label="Percent of the fund"></div>`;
}

function payload(kind, form) {
  const v = (n) => form.elements[n]?.value?.trim() || "";
  if (kind === "compare") return { path: "compare", body: { symbols: v("symbols").split(/[\s,]+/).filter(Boolean) } };
  if (kind === "meeting_prep") return { path: "meeting-prep", body: { since: v("since") } };
  if (kind === "ideas") return { path: "ideas", body: { focus: v("focus") } };
  const trades = [...form.querySelectorAll(".desk-trade")].map((r) => ({ action: r.querySelector("[name=action]").value, symbol: r.querySelector("[name=symbol]").value.trim(),
    usd: r.querySelector("[name=usd]").value, pct: r.querySelector("[name=pct]").value })).filter((t) => t.symbol);
  return { path: "what-if", body: { trades } };
}

export async function mountDesk(body, { kind = "compare" } = {}) {
  body.innerHTML = `<p class="muted small">Analyst agents that work from the app's data and SEC filings. They lay out evidence; they never recommend a trade. Each run costs a few cents from your daily AI budget.</p>
    <div class="agent-followups desk-tabs" role="tablist" aria-label="Research desk tools">${TOOLS.map(([k, label, hint]) => `<button type="button" role="tab" class="btn btn-ghost btn-sm agent-chip" data-kind="${k}" aria-selected="${k === kind}" title="${esc(hint)}">${esc(label)}</button>`).join("")}</div>
    <form class="panel desk-form" id="deskForm"></form><div id="deskOut"></div><div id="deskHistory"></div>`;
  const form = body.querySelector("#deskForm"), out = body.querySelector("#deskOut"), hist = body.querySelector("#deskHistory");
  let current = kind;
  const renderForm = () => {
    const t = TOOLS.find(([k]) => k === current);
    body.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.kind === current)));
    form.innerHTML = `<p class="small"><strong>${esc(t[1])}.</strong> ${esc(t[2])}</p>${formFor(current)}<button class="btn btn-primary">Run</button>`;
  };
  const renderHistory = async () => {
    try {
      const r = await api("/api/agents/desk/history");
      const past = r.runs.filter((x) => x.output);
      hist.innerHTML = past.length ? `<p class="pf-sub">Your recent desk runs</p><div class="agent-history">${past.map((x, i) => `<details class="agent-hist"${i === 0 && !out.innerHTML ? " open" : ""}>
        <summary><span>${esc(TITLES[x.workflow] || x.workflow)}: ${esc(x.output.question)}</span><span class="muted small">${esc(localTime(x.createdAt))}</span></summary>${deskResult(x.output, x.runId)}</details>`).join("")}</div>` : "";
    } catch { hist.innerHTML = ""; }
  };
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (b) { current = b.dataset.kind; renderForm(); return; }
    if (e.target.id === "addTrade") {
      const rows = form.querySelectorAll(".desk-trade");
      if (rows.length >= 6) return toast("Six trades at most.", { type: "error" });
      form.querySelector("#tradeRows").insertAdjacentHTML("beforeend", tradeRow());
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector(".btn-primary");
    const { path, body: reqBody } = payload(current, form);
    btn.disabled = true;
    try {
      const r = await withProgress(out, api(`/api/agents/desk/${path}`, { method: "POST", body: JSON.stringify(reqBody) }), { workflow: current, intro: "Planning what to look up", expect: "Usually 30 to 90 seconds" });
      out.innerHTML = deskResult(r.output, r.runId);
      renderHistory();
    } catch (err) { out.innerHTML = aiErrorHtml(err); }
    finally { btn.disabled = false; }
  });
  renderForm();
  bindFeedback(body);
  await renderHistory();
}
