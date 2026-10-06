import { esc, api, pageHead, loading, subTabs } from "../shared.js";
import { MARKET_TABS } from "./insiders.js";

const TYPE_LABEL = { earnings: "Earnings", "ex-dividend": "Ex-dividend", macro: "Macro", fomc: "FOMC", opex: "Options expiration", "month-end": "Month end" };
const TYPE_CLASS = { earnings: "badge-watch", "ex-dividend": "", macro: "badge-warn", fomc: "badge-warn", opex: "", "month-end": "" };

const state = { view: "list", months: 3 };

function groupByMonth(events) {
  const groups = new Map();
  for (const e of events) {
    const key = e.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return groups;
}

function listView(events) {
  const groups = groupByMonth(events);
  return [...groups.entries()].map(([month, rows]) => `
    <section class="panel" aria-label="${esc(month)}">
      <h3>${esc(new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }))}</h3>
      <ul class="link-list small">${rows.map((e) => `
        <li><strong>${esc(e.date)}</strong> — <span class="badge ${TYPE_CLASS[e.type] || ""}">${esc(TYPE_LABEL[e.type] || e.type)}</span> ${esc(e.title)}${e.detail ? ` <span class="muted">(${esc(e.detail)})</span>` : ""}</li>`).join("")}</ul>
    </section>`).join("");
}

function monthGrid(events, monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startDow = first.getUTCDay();
  const byDay = new Map();
  for (const e of events) if (e.date.slice(0, 7) === monthKey) {
    const d = Number(e.date.slice(8, 10));
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(e);
  }
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell cal-empty"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const dayEvents = byDay.get(d) || [];
    cells.push(`<div class="cal-cell"><div class="cal-daynum">${d}</div>${dayEvents.map((e) => `<div class="cal-event" title="${esc(e.title)}${e.detail ? ` — ${esc(e.detail)}` : ""}"><span class="badge ${TYPE_CLASS[e.type] || ""}">${esc(TYPE_LABEL[e.type] || e.type)}</span> ${esc(e.title)}</div>`).join("")}</div>`);
  }
  return `
    <div class="cal-grid-head">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div>${d}</div>`).join("")}</div>
    <div class="cal-grid">${cells.join("")}</div>`;
}

async function load(container) {
  const box = document.getElementById("calBody");
  if (!box) return;
  box.innerHTML = loading("Gathering earnings, ex-dividend dates, CPI/jobs releases and options-expiration dates…");
  let r;
  try {
    r = await api(`/api/calendar?months=${state.months}`);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load the calendar: ${esc(err.message)}</p>`;
    return;
  }
  if (!document.getElementById("calBody")) return;
  const months = [...new Set(r.events.map((e) => e.date.slice(0, 7)))];
  box.innerHTML = `
    ${!r.finnhubConfigured || !r.fredConfigured ? `<p class="notice small">${!r.finnhubConfigured ? "Earnings dates need a Finnhub API key. " : ""}${!r.fredConfigured ? "CPI/jobs release dates need a FRED API key." : ""}</p>` : ""}
    ${state.view === "list" ? listView(r.events) : months.map((m) => monthGrid(r.events, m)).join("")}
    <p class="muted small page-pad">FOMC meeting dates aren't included — there's no free, reliable API for the Fed's own calendar; check <a href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noopener">federalreserve.gov<span class="sr-only"> (opens in new tab)</span></a>.</p>`;
}

export const title = "Market calendar";

export async function mount(container) {
  container.innerHTML = subTabs(MARKET_TABS, "#/calendar") +
    pageHead("Market &amp; event calendar", "Earnings, ex-dividend dates, CPI/jobs releases, options expiration and S&P-style quarterly rebalance dates for the fund's holdings and watchlist.");
  container.innerHTML += `
    <section class="panel page-pad-panel" aria-labelledby="cal-h">
      <div class="panel-head">
        <h3 id="cal-h">Upcoming events</h3>
        <div class="toolbar">
          <div class="seg seg-sm" role="group" aria-label="View">
            ${[["list", "List"], ["month", "Month"]].map(([v, l]) => `<button type="button" class="seg-btn" data-view="${v}" aria-pressed="${state.view === v}">${l}</button>`).join("")}
          </div>
          <label class="field-inline">Months ahead
            <select id="calMonths">${[1, 3, 6, 12].map((n) => `<option value="${n}" ${n === state.months ? "selected" : ""}>${n}</option>`).join("")}</select>
          </label>
          <a class="btn btn-ghost btn-sm" href="/api/calendar.ics?months=${state.months}" id="icsLink">Export .ics</a>
        </div>
      </div>
      <div id="calBody"></div>
    </section>`;
  load(container);
  container.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view;
    container.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load(container);
  }));
  document.getElementById("calMonths").addEventListener("change", (e) => {
    state.months = Number(e.target.value);
    document.getElementById("icsLink").href = `/api/calendar.ics?months=${state.months}`;
    load(container);
  });
}
