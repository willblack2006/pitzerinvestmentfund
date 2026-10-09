// Personal price alerts (only you see them; they arrive in your notifications). Used on the
// Account page (all of yours) and on each company's Research page (that ticker only).
import { esc, api, toast, fmtUSD } from "./shared.js";

const KINDS = [["above", "Rises above"], ["below", "Falls below"], ["move", "Moves up or down by"]];
const describe = (a) => (a.kind === "move" ? `Moves ${a.value}% or more in a day` : `${a.kind === "above" ? "Rises above" : "Falls below"} ${fmtUSD(a.value)}`);
const when = (utc) => new Date(`${utc.replace(" ", "T")}Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export async function mountMyAlerts(box, { symbol = null } = {}) {
  let alerts = [];
  const draw = () => {
    box.innerHTML = `
      ${alerts.length ? `<ul class="my-alerts">${alerts.map((a) => `<li>
        <span>${symbol ? "" : `<a class="symbol-cell" href="#/research/${encodeURIComponent(a.symbol)}">${esc(a.symbol)}</a> `}${esc(describe(a))}${a.note ? ` <span class="muted small">· ${esc(a.note)}</span>` : ""}</span>
        <span class="small ${a.active ? "" : "muted"}">${a.active ? (a.kind === "move" && a.lastTriggeredAt ? `On · last fired ${esc(when(a.lastTriggeredAt))}` : "On") : (a.lastTriggeredAt ? `Fired ${esc(when(a.lastTriggeredAt))}` : "Off")}</span>
        <span class="my-alert-actions">${a.active ? "" : `<button type="button" class="btn-link small" data-rearm="${a.id}">Turn back on</button>`}
          <button type="button" class="btn-link small danger-link" data-del="${a.id}" aria-label="Delete alert: ${esc(a.symbol)} ${esc(describe(a))}">Delete</button></span>
      </li>`).join("")}</ul>` : `<p class="muted small">No price alerts${symbol ? ` on ${esc(symbol)}` : ""} yet.</p>`}
      <form class="inline-form my-alert-form" novalidate>
        ${symbol ? "" : `<label class="sr-only" for="maSym">Ticker</label><input id="maSym" name="symbol" placeholder="Ticker" maxlength="12" autocomplete="off" required style="width:90px" />`}
        <label class="sr-only" for="maKind${symbol || ""}">When it</label>
        <select id="maKind${symbol || ""}" name="kind">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <label class="sr-only" for="maVal${symbol || ""}">Value</label>
        <input id="maVal${symbol || ""}" name="value" type="number" min="0" step="any" inputmode="decimal" placeholder="$ price" required style="width:100px" />
        <button class="btn btn-primary btn-sm">Add alert</button>
      </form>
      <p class="field-hint">Only you see these. Checked every 5 minutes; a price alert fires once, a daily-move alert at most once a day.</p>`;
    const form = box.querySelector("form");
    const kind = form.querySelector("[name=kind]"), val = form.querySelector("[name=value]");
    kind.addEventListener("change", () => { val.placeholder = kind.value === "move" ? "% move" : "$ price"; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      try {
        await api("/api/my-alerts", { method: "POST", body: JSON.stringify({ symbol: symbol || f.symbol, kind: f.kind, value: Number(f.value) }) });
        toast("Alert added. It'll show up in your notifications.", { type: "success" });
        await load();
      } catch (err) { toast(err.message, { type: "error" }); }
    });
  };
  const load = async () => {
    alerts = await api(`/api/my-alerts${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`);
    draw();
  };
  box.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]"), re = e.target.closest("[data-rearm]");
    try {
      if (del) { await api(`/api/my-alerts/${del.dataset.del}`, { method: "DELETE" }); await load(); }
      if (re) { await api(`/api/my-alerts/${re.dataset.rearm}`, { method: "PUT", body: JSON.stringify({ active: true }) }); await load(); }
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  try { await load(); } catch (err) { box.innerHTML = `<p class="muted small">${esc(err.message)}</p>`; }
}
