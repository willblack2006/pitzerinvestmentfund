import { el, fmtUSD, fmtPct, api, isUnlocked } from "../shared.js";

const state = { positions: [], sortKey: "symbol", sortDir: 1, filter: "" };

function computeDerived(p) {
  const gain = p.marketValue - p.totalCost;
  const gainPct = p.totalCost ? (gain / p.totalCost) * 100 : 0;
  return { ...p, gain, gainPct };
}

function renderSummary(rows) {
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost ? (totalGain / totalCost) * 100 : 0;
  const totalDiv = rows.reduce((s, r) => s + (r.divIncome || 0), 0);

  el("summary").innerHTML = `
    <div class="stat"><div class="label">Positions</div><div class="value">${rows.length}</div></div>
    <div class="stat"><div class="label">Total Cost</div><div class="value">${fmtUSD(totalCost)}</div></div>
    <div class="stat"><div class="label">Market Value</div><div class="value">${fmtUSD(totalValue)}</div></div>
    <div class="stat"><div class="label">Total Gain</div><div class="value ${totalGain >= 0 ? "gain-pos" : "gain-neg"}">${fmtUSD(totalGain)} (${fmtPct(totalGainPct)})</div></div>
    <div class="stat"><div class="label">Dividend Income</div><div class="value">${fmtUSD(totalDiv)}</div></div>
  `;
}

function renderTable() {
  const unlocked = isUnlocked();
  document.querySelectorAll(".edit-col").forEach((e) => e.classList.toggle("hidden", !unlocked));
  el("addBtn").classList.toggle("hidden", !unlocked);

  let rows = state.positions.map(computeDerived);
  if (state.filter) {
    const f = state.filter.toUpperCase();
    rows = rows.filter((r) => r.symbol.toUpperCase().includes(f));
  }
  rows.sort((a, b) => {
    const av = a[state.sortKey], bv = b[state.sortKey];
    if (typeof av === "string") return av.localeCompare(bv) * state.sortDir;
    return (av - bv) * state.sortDir;
  });

  renderSummary(state.positions.map(computeDerived));

  el("tbody").innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td><a class="symbol-cell" href="#/research/${r.symbol}">${r.symbol}</a></td>
      <td>${r.shares.toLocaleString()}</td>
      <td>${fmtUSD(r.lastPrice)}</td>
      <td>${fmtUSD(r.avgCost)}</td>
      <td>${fmtUSD(r.totalCost)}</td>
      <td>${fmtUSD(r.marketValue)}</td>
      <td class="${r.gain >= 0 ? "gain-pos" : "gain-neg"}">${fmtUSD(r.gain)}</td>
      <td class="${r.gainPct >= 0 ? "gain-pos" : "gain-neg"}">${fmtPct(r.gainPct)}</td>
      <td>${fmtUSD(r.divIncome)}</td>
      <td class="edit-col ${unlocked ? "" : "hidden"}">
        <div class="row-actions">
          <button class="btn btn-ghost" data-edit="${r.id}">Edit</button>
          <button class="btn btn-danger" data-delete="${r.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

async function loadPositions() {
  state.positions = await api("/api/positions");
  renderTable();
}

function openDialog(position) {
  const form = el("posForm");
  form.reset();
  el("dialogTitle").textContent = position ? `Edit ${position.symbol}` : "Add position";
  form.id.value = position?.id || "";
  if (position) {
    for (const key of ["symbol", "shares", "lastPrice", "avgCost", "totalCost", "marketValue", "divIncome", "notes"]) {
      if (form[key]) form[key].value = position[key] ?? "";
    }
  }
  el("dialog").showModal();
}

let wired = false;

// Wires listeners on elements OUTSIDE #view (the dialogs live in index.html and persist
// across route changes), so this only needs to run once per page load.
function wireGlobalOnce() {
  if (wired) return;
  wired = true;

  el("cancelBtn").addEventListener("click", () => el("dialog").close());

  el("posForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value;
    const payload = {
      symbol: form.symbol.value.trim().toUpperCase(),
      shares: parseFloat(form.shares.value) || 0,
      lastPrice: parseFloat(form.lastPrice.value) || 0,
      avgCost: parseFloat(form.avgCost.value) || 0,
      totalCost: parseFloat(form.totalCost.value) || 0,
      marketValue: parseFloat(form.marketValue.value) || 0,
      divIncome: parseFloat(form.divIncome.value) || 0,
      notes: form.notes.value.trim(),
    };
    try {
      if (id) {
        await api(`/api/positions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/positions", { method: "POST", body: JSON.stringify(payload) });
      }
      el("dialog").close();
      await loadPositions();
    } catch (err) {
      alert(err.message);
    }
  });

  document.body.addEventListener("click", async (e) => {
    const editId = e.target.dataset.edit;
    const deleteId = e.target.dataset.delete;
    if (editId && el("tbody")?.contains(e.target)) {
      const p = state.positions.find((p) => String(p.id) === editId);
      openDialog(p);
    }
    if (deleteId && el("tbody")?.contains(e.target)) {
      const p = state.positions.find((p) => String(p.id) === deleteId);
      if (confirm(`Delete ${p.symbol}?`)) {
        try {
          await api(`/api/positions/${deleteId}`, { method: "DELETE" });
          await loadPositions();
        } catch (err) {
          alert(err.message);
        }
      }
    }
  });
}

export async function mount(container) {
  container.innerHTML = `
    <section class="summary" id="summary"></section>
    <section class="toolbar">
      <input id="search" type="search" placeholder="Filter by ticker..." />
      <button id="addBtn" class="btn btn-primary hidden">+ Add position</button>
    </section>
    <section class="table-wrap">
      <table id="table">
        <thead>
          <tr>
            <th data-sort="symbol">Ticker</th>
            <th data-sort="shares">Shares</th>
            <th data-sort="lastPrice">Last Price</th>
            <th data-sort="avgCost">Avg Cost</th>
            <th data-sort="totalCost">Total Cost</th>
            <th data-sort="marketValue">Market Value</th>
            <th data-sort="gain">Gain $</th>
            <th data-sort="gainPct">Gain %</th>
            <th data-sort="divIncome">Div Income</th>
            <th class="edit-col hidden"></th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </section>
  `;

  wireGlobalOnce();

  el("addBtn").addEventListener("click", () => openDialog(null));

  container.querySelectorAll("thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.sortDir = state.sortKey === key ? -state.sortDir : 1;
      state.sortKey = key;
      renderTable();
    });
  });

  el("search").addEventListener("input", (e) => {
    state.filter = e.target.value;
    renderTable();
  });

  await loadPositions();
}

export function refresh() {
  if (document.getElementById("tbody")) renderTable();
}
