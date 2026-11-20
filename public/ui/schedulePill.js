// When an agent runs, in plain words (WS11). Reads spec triggers (plan 3.2): presets, a 5-field
// cron subset, events, handoffs and manual.
import { esc, icon } from "../shared.js";

const PRESET = { premarket: "Weekdays before the open", close: "Weekdays after the close", weekly_fri: "Fridays after the close", daily: "Every day" };
const EVENT = {
  filing: "On new filings", price_move: "On big price moves", earnings_soon: "Before earnings", insider_buy: "On insider buys", tripwire: "When a tripwire trips",
  news_high: "On important news", thirteenf: "On new 13Fs", ips_breach: "On policy breaches", pitch_status: "When a pitch moves", estimate_revision: "On estimate changes",
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function time(h, m) {
  const hh = Number(h), mm = Number(m);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

export function describeCron(cron, tz = "America/New_York") {
  const f = String(cron || "").trim().split(/\s+/);
  if (f.length !== 5) return "On a schedule";
  const [m, h, dom, mon, dow] = f;
  const t = time(h, m);
  const zone = /New_York/.test(tz) ? " ET" : "";
  let days = "Every day";
  if (dow === "1-5") days = "Weekdays";
  else if (/^\d$/.test(dow)) days = `${DAYS[Number(dow) % 7]}s`;
  else if (/^[\d,]+$/.test(dow)) days = dow.split(",").map((d) => DAYS[Number(d) % 7]).join(", ");
  if (dom !== "*" && mon === "*") days = `Day ${dom} of each month`;
  if (!t) return h === "*" ? (m === "0" ? "Every hour" : "Often") : `${days}`;
  return `${days} at ${t}${zone}`;
}

export function describeTrigger(t = {}) {
  if (t.type === "schedule") return t.preset ? PRESET[t.preset] || t.preset : describeCron(t.cron, t.tz);
  if (t.type === "event") return t.on === "price_move" && t.sigma ? `On ${t.sigma}σ price moves` : t.on === "earnings_soon" && t.days ? `${t.days} days before earnings` : EVENT[t.on] || "On events";
  if (t.type === "handoff") return `When another agent hands off${t.topic ? ` “${t.topic}”` : ""}`;
  if (t.type === "manual") return "When asked";
  return "";
}

export function schedulePill(triggers = [], { nextRunAt = null } = {}) {
  const list = (Array.isArray(triggers) ? triggers : [triggers]).map(describeTrigger).filter(Boolean);
  if (!list.length) return "";
  const main = list.find((x) => x !== "When asked") || list[0];
  const more = list.length > 1 ? ` +${list.length - 1}` : "";
  const title = list.join(" · ") + (nextRunAt ? ` · next ${nextRunAt}` : "");
  return `<span class="agent-pill" title="${esc(title)}">${icon("calendar", { size: 12 })}<span>${esc(main)}${esc(more)}</span></span>`;
}
