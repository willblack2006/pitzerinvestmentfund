// Schedules for agents (plan 3.4): a 5-field cron subset plus named presets, evaluated in a time
// zone, optionally only on NYSE trading days.
//
//   nextRun("30 8 * * 1-5", "America/New_York")       next weekday 08:30 New York time
//   nextRun("premarket")                              next trading day 08:30 New York (skips holidays)
//   nextRun("0 9 * * *", tz, from, { marketDays: true })
//
// Fields: minute hour day-of-month month day-of-week (0 or 7 = Sunday). Each field takes *, a
// number, a list (1,3,5), a range (1-5) and a step (*/15, 0-30/10). When both day-of-month and
// day-of-week are restricted, either may match (classic cron). Daylight saving: a wall time
// that doesn't exist (02:30 on the spring-forward day) runs at the same wall time after the
// jump (03:30); a wall time that happens twice (01:30 on the fall-back day) runs once, the first time.
const { isTradingDay } = require("../calendar");

const DEFAULT_TZ = "America/New_York";
const PRESETS = {
  premarket: { cron: "30 8 * * 1-5", marketDays: true, label: "Trading days, 8:30 AM ET" },
  open: { cron: "45 9 * * 1-5", marketDays: true, label: "Trading days, 9:45 AM ET" },
  midday: { cron: "0 12 * * 1-5", marketDays: true, label: "Trading days, noon ET" },
  close: { cron: "15 16 * * 1-5", marketDays: true, label: "Trading days, 4:15 PM ET" },
  evening: { cron: "0 19 * * 1-5", marketDays: true, label: "Trading days, 7 PM ET" },
  weekly_mon: { cron: "0 8 * * 1", marketDays: false, label: "Mondays, 8 AM ET" },
  weekly_fri: { cron: "0 17 * * 5", marketDays: false, label: "Fridays, 5 PM ET" },
  daily: { cron: "0 7 * * *", marketDays: false, label: "Every day, 7 AM ET" },
};
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const MAX_DAYS = 400;

function parseField(text, [lo, hi], idx) {
  const out = new Set();
  for (const part of String(text).split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`Bad cron field "${text}"`);
    let a = lo, b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1].split("-").map(Number);
      a = x; b = y === undefined ? (m[2] ? hi : x) : y;
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) throw new Error(`Cron field "${text}" is out of range ${lo}-${hi}`);
    for (let v = a; v <= b; v += step) out.add(idx === 4 && v === 7 ? 0 : v);
  }
  return out;
}

function parse(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron needs 5 fields (minute hour day month weekday), got "${expr}"`);
  const [minute, hour, dom, month, dow] = fields.map((f, i) => parseField(f, RANGES[i], i));
  return { minute, hour, dom, month, dow, domStar: fields[2] === "*", dowStar: fields[4] === "*" };
}

// Resolves a preset name or a cron string to { cron, marketDays }.
function resolve(cronOrPreset) {
  if (PRESETS[cronOrPreset]) return { ...PRESETS[cronOrPreset] };
  parse(cronOrPreset); // throws on a bad expression
  return { cron: cronOrPreset, marketDays: false };
}

const fmtCache = new Map();
function wallParts(t, tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
  const p = Object.fromEntries(fmtCache.get(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
const offsetAt = (t, tz) => { const w = wallParts(t, tz); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(t / 60000) * 60000; };

// UTC instant of a wall-clock time in tz (see the DST rules at the top).
function wallToUtc(y, mo, d, h, mi, tz) {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const offs = [...new Set([offsetAt(naive - 12 * 3600e3, tz), offsetAt(naive + 12 * 3600e3, tz)])];
  const valid = offs.map((o) => naive - o).filter((t) => { const w = wallParts(t, tz); return w.h === h && w.mi === mi && w.d === d; });
  if (valid.length) return Math.min(...valid);
  return naive - offs[0]; // in the gap: pre-jump offset lands just after the jump
}

function nextRun(cronOrPreset, tz = DEFAULT_TZ, from = new Date(), opts = {}) {
  const { cron, marketDays: presetMarket } = resolve(cronOrPreset);
  const marketDays = opts.marketDays ?? presetMarket;
  const c = parse(cron);
  const zone = tz || DEFAULT_TZ;
  const fromMs = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const start = wallParts(fromMs, zone);
  const hours = [...c.hour].sort((a, b) => a - b), minutes = [...c.minute].sort((a, b) => a - b);
  for (let i = 0; i <= MAX_DAYS; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate(), dow = day.getUTCDay();
    if (!c.month.has(mo)) continue;
    const domOk = c.dom.has(d), dowOk = c.dow.has(dow);
    const dayOk = c.domStar && c.dowStar ? true : c.domStar ? dowOk : c.dowStar ? domOk : domOk || dowOk;
    if (!dayOk) continue;
    if (marketDays && !isTradingDay(day.toISOString().slice(0, 10))) continue;
    for (const h of hours) for (const mi of minutes) {
      const t = wallToUtc(y, mo, d, h, mi, zone);
      if (t > fromMs) return new Date(t);
    }
  }
  return null;
}

// A plain-English label for the builder UI.
function describe(cronOrPreset) {
  return PRESETS[cronOrPreset]?.label || `cron ${cronOrPreset}`;
}

module.exports = { nextRun, parse, resolve, describe, wallToUtc, PRESETS, DEFAULT_TZ };
