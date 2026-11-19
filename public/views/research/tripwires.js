import { esc, fmtUSD, api, can, toast } from "../../shared.js";

const KIND_LABEL = { price_below: "Falls below", price_above: "Rises above", review_by: "Review by", custom: "Other condition" };

function line(t) {
  const what = t.kind.startsWith("price_") ? `${KIND_LABEL[t.kind]} <strong>${fmtUSD(t.value)}</strong>` : t.kind === "review_by" ? `Review by <strong>${esc(t.dueDate)}</strong>` : `<strong>${esc(t.note)}</strong>`;
  const note = t.kind === "custom" ? "" : t.note ? ` <span class="muted small">(${esc(t.note)})</span>` : "";
  const tripped = t.status === "tripped";
  return `<li class="tripwire${tripped ? " tripped" : ""}">${tripped ? `<span class="badge badge-danger">Tripped</span> ` : ""}${what}${note}
    ${tripped ? `<div class="small">${esc(t.trippedDetail)}</div>` : ""}
    ${can("member") ? `<div class="small">${tripped ? `<button class="btn-link" data-tw="reset" data-id="${t.id}">Keep holding, re-arm</button> · ` : t.kind === "custom" ? `<button class="btn-link" data-tw="trip" data-id="${t.id}">It happened</button> · ` : ""}<button class="btn-link" data-tw="resolve" data-id="${t.id}" aria-label="Remove tripwire">Remove</button></div>` : ""}</li>`;
}

export async function mountTripwires(box, { symbol }) {
  const load = async () => {
    let rows = [];
    try { rows = await api(`/api/tripwires?symbol=${encodeURIComponent(symbol)}`); } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
    box.innerHTML = `
      <ul class="link-list">${rows.map(line).join("") || `<li class="muted">None yet. Write down now what would make us sell.</li>`}</ul>
      ${can("member") ? `<form id="twForm" class="alert-form">
        <label class="sr-only" for="twKind">Type</label>
        <select id="twKind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <label class="sr-only" for="twValue">Value</label>
        <input id="twValue" type="number" step="any" min="0" placeholder="Price" inputmode="decimal" />
        <input id="twDate" type="date" hidden aria-label="Review date" />
        <input id="twNote" maxlength="300" placeholder="Why / what" aria-label="Note" />
        <button class="btn btn-ghost btn-sm">Add</button>
      </form>` : ""}`;
    const kind = box.querySelector("#twKind");
    const sync = () => {
      const k = kind.value;
      box.querySelector("#twValue").hidden = !k.startsWith("price_");
      box.querySelector("#twDate").hidden = k !== "review_by";
      box.querySelector("#twNote").placeholder = k === "custom" ? "Condition, e.g. loses its biggest customer" : "Why we set it (optional)";
    };
    kind?.addEventListener("change", sync); if (kind) sync();
    box.querySelector("#twForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/api/tripwires", { method: "POST", body: JSON.stringify({ symbol, kind: kind.value, value: box.querySelector("#twValue").value, dueDate: box.querySelector("#twDate").value, note: box.querySelector("#twNote").value }) });
        load();
      } catch (err) { toast(err.message, { type: "error" }); }
    });
    box.querySelectorAll("[data-tw]").forEach((b) => b.addEventListener("click", async () => {
      try { await api(`/api/tripwires/${b.dataset.id}/${b.dataset.tw}`, { method: "POST", body: "{}" }); load(); } catch (err) { toast(err.message, { type: "error" }); }
    }));
  };
  await load();
}
