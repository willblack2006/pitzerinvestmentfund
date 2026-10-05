import { el, api, isUnlocked } from "../shared.js";

async function removeItem(id) {
  try {
    await api(`/api/watchlist/${id}`, { method: "DELETE" });
    mount(document.getElementById("view"));
  } catch (err) {
    alert(err.message);
  }
}

export async function mount(container) {
  container.innerHTML = `<p class="muted">Loading watchlist...</p>`;

  let rows;
  try {
    rows = await api("/api/watchlist");
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load watchlist: ${err.message}</p>`;
    return;
  }

  const unlocked = isUnlocked();

  container.innerHTML = `
    <h2>Watchlist</h2>
    <p class="muted">Candidates the fund is tracking but doesn't yet own.</p>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Ticker</th><th class="left">Sourced From</th><th>Added</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><a class="symbol-cell" href="#/research/${r.symbol}">${r.symbol}</a></td>
              <td class="left muted small">${r.sourcedFrom || "—"}</td>
              <td>${r.addedAt?.slice(0, 10) || "—"}</td>
              <td>${unlocked ? `<button class="btn btn-danger" data-remove="${r.id}">Remove</button>` : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${!rows.length ? `<p class="muted">Nothing watchlisted yet — add candidates from the Discovery page or a research page.</p>` : ""}
    </section>
  `;

  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeItem(btn.dataset.remove));
  });
}
