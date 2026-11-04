// Red-flag scanner over SEC filing metadata, full-text search hits and the filings' own text.
// Pure, so it's unit-testable without the network. Everything here is a fact about a filing
// (an item was checked, a notice was filed, a conclusion was stated) rather than a prediction.
//
// Most raw hits are noise: every 8-K Item 5.02 (often just a new director or a pay plan) and
// every 10-K whose auditor's report says "assessing the risk that a material weakness exists".
// So each hit is read and sorted into four tiers:
//   critical  restatement, auditor change with a disagreement, late 10-K, going-concern doubt stated
//   high      auditor resigned, late 10-Q, material weakness concluded, CEO/CFO fired or out at once
//   watch     auditor dismissed, CEO/CFO/CAO leaving (not a retirement), weakness being remediated
//   info      routine officer/director changes, planned retirements, unread hits. Hidden by default.

const TIERS = ["critical", "high", "watch", "info"];
const RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

const WHY = {
  restatement: "The company says investors should no longer rely on financials it already published. Restatements often come with weak controls and lawsuits.",
  auditor_change: "Companies rarely change auditors mid-stream. A resignation or a disagreement can mean the auditor didn't like what it saw.",
  late_filing: "The company couldn't file its report on time. Late filings often come before restatements or bad news.",
  going_concern: "Management or the auditor doubts the company can keep operating for the next year without new money.",
  material_weakness: "Internal controls over financial reporting failed. The numbers are more likely to contain errors until it's fixed.",
  departure: "A sudden exit by the CEO, CFO or chief accounting officer can signal trouble the market hasn't priced yet.",
  officer_change: "Routine leadership change (appointment, planned retirement, board seat or pay plan). Shown for completeness.",
};

const TITLE = {
  restatement: "Restatement (Item 4.02)",
  auditor_change: "Auditor change (Item 4.01)",
  late_filing: "Late filing notice",
  going_concern: "Going-concern doubt",
  material_weakness: "Material weakness",
  departure: "Senior officer departure",
  officer_change: "Officer or director change",
};

const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
// Split on sentence ends, but not after "Mr." / "Inc." / "No." and similar.
const sentences = (t) => clean(t).split(/(?<!\b(?:Mr|Ms|Mrs|Dr|Jr|Sr|Inc|Co|Corp|Ltd|No|St|U\.S|[A-Z])\.)(?<=[.;])\s+(?=[A-Z(“"])/);
const snippet = (s, max = 220) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// The text of one 8-K item ("Item 5.02 …" up to the next "Item x.xx").
function itemSection(text, item) {
  const t = clean(text);
  const re = new RegExp(`item\\s*${item.replace(".", "\\.")}\\b`, "i");
  const m = re.exec(t);
  if (!m) return "";
  const rest = t.slice(m.index + m[0].length);
  const next = /\bitem\s*\d\.\d\d\b/i.exec(rest);
  return t.slice(m.index, m.index + m[0].length + (next ? next.index : Math.min(rest.length, 6000)));
}

// "was not the result of any disagreement" and "there were no disagreements" are boilerplate.
function realDisagreement(text) {
  return sentences(text).find((s) => /disagreement/i.test(s) && !/\b(not|no|never|without)\b[^.]{0,80}disagreement/i.test(s) && !/disagreement[^.]{0,40}\b(none|not applicable)\b/i.test(s));
}
function realReportableEvent(text) {
  return sentences(text).find((s) => /reportable event/i.test(s) && !/\b(no|not|none|neither)\b[^.]{0,80}reportable event/i.test(s) && !/reportable event[^.]{0,60}\b(none|not applicable)\b/i.test(s));
}

const DEPART = /\b(resign\w*|leav(e|ing) the company|depart\w*|step(ping|ped)? down|terminat\w*|separat\w*|ceased? to serve|will not stand for re-?election|not to stand for re-?election|removed)\b/i;
const RETIRE = /\b(retire\w*|retirement|planned transition|succession plan)\b/i;
const ABRUPT = /\b(effective immediately|terminated|for cause|without cause|placed on (administrative )?leave|investigation)\b/i;
const KEY_ROLE = /\b(chief (executive|financial|accounting) officer|principal (executive|financial|accounting) officer|CEO|CFO)\b/i;

// Item 5.02 (officer/director changes).
// The item's own caption ("Departure of Directors or Certain Officers; Election of …") would
// match every departure word, so drop it first.
const CAPTION_502 = /departure of directors or (certain|principal) officers[^.]*?compensatory arrangements of certain officers\.?/i;

function classifyDeparture(text) {
  const sec = (itemSection(text, "5.02") || clean(text))
    .replace(CAPTION_502, " ")
    // Term-of-office boilerplate for new directors: "…until his earlier death, resignation or removal".
    .replace(/(until|or) (his|her|their|his or her) (earlier |prior )?((death|disqualification|resignation|retirement|removal),? (or )?){1,5}/gi, " ");
  const departs = sentences(sec).filter((s) => DEPART.test(s) || RETIRE.test(s));
  const disagree = realDisagreement(sec);
  if (disagree) return { type: "departure", severity: "high", title: "Departure with a disagreement", evidence: snippet(disagree) };
  const key = departs.find((s) => KEY_ROLE.test(s));
  if (key && !RETIRE.test(key)) {
    const abrupt = ABRUPT.test(key) || departs.some((s) => KEY_ROLE.test(s) && ABRUPT.test(s));
    return { type: "departure", severity: abrupt ? "high" : "watch", title: abrupt ? "Senior officer out abruptly" : TITLE.departure, evidence: snippet(key) };
  }
  const first = departs[0] || sentences(sec).find((s) => /\b(appoint|elect|named|compensat|award)\w*/i.test(s)) || "";
  const what = !departs.length ? "Appointment or pay change" : RETIRE.test(first) ? "Planned retirement or transition" : "Officer or director leaving";
  return { type: "officer_change", severity: "info", title: what, evidence: first ? snippet(first) : "" };
}

// Item 4.01 (auditor change).
function classifyAuditorChange(text) {
  const sec = (itemSection(text, "4.01") || clean(text)).replace(/changes? in registrant'?s certifying accountant\.?/i, " ");
  const disagree = realDisagreement(sec) || realReportableEvent(sec);
  if (disagree) return { type: "auditor_change", severity: "critical", title: "Auditor change with a disagreement", evidence: snippet(disagree) };
  const s = sentences(sec);
  const resigned = s.find((x) => /\b(resign\w*|declin\w* to stand)\b/i.test(x));
  if (resigned) return { type: "auditor_change", severity: "high", title: "Auditor resigned", evidence: snippet(resigned) };
  const dismissed = s.find((x) => /\b(dismiss\w*|approved the (engagement|appointment)|selected|engaged)\b/i.test(x));
  return { type: "auditor_change", severity: "watch", title: "Company switched auditors", evidence: snippet(dismissed || s[1] || s[0] || "") };
}

// Conditional or definitional wording: risk factors and the audit report's boilerplate.
const HYPOTHETICAL = /\b(could|may|might|would|if (we|the company)|whether|in the event|risk that|assessing|is a deficiency|are deficiencies|no material weakness|did not identify|have not identified|has not identified|there (were|are|was|is) no|no substantial doubt|not raise substantial doubt|alleviat\w*)\b/i;

function classifyGoingConcern(text) {
  const hits = sentences(text).filter((s) => /going concern/i.test(s));
  const stated = hits.find((s) => /substantial doubt/i.test(s) && !HYPOTHETICAL.test(s));
  if (stated) return { type: "going_concern", severity: "critical", title: TITLE.going_concern, evidence: snippet(stated) };
  const eased = hits.find((s) => /substantial doubt/i.test(s) && /alleviat\w*/i.test(s));
  if (eased) return { type: "going_concern", severity: "watch", title: "Going-concern doubt eased", evidence: snippet(eased) };
  return null; // only boilerplate ("could raise substantial doubt…")
}

function classifyMaterialWeakness(text) {
  const hits = sentences(text).filter((s) => /material weakness|controls? and procedures (were|was) not effective|control over financial reporting (was|were) not effective/i.test(s));
  const concluded = hits.find((s) => !HYPOTHETICAL.test(s) && (
    /\b(identified|disclosed|reported|existence of|due to|because of|as a result of|resulting from)\b[^.]{0,60}material weakness/i.test(s)
    || /material weakness(es)?\b[^.]{0,60}\b(was|were|has been|have been) identified/i.test(s)
    || /\bnot effective\b/i.test(s)));
  if (concluded) {
    const remediated = hits.find((s) => /\b(has|have) been remediated|remediation (of|was) completed|was remediated/i.test(s));
    if (remediated) return { type: "material_weakness", severity: "watch", title: "Material weakness fixed", evidence: snippet(remediated) };
    return { type: "material_weakness", severity: "high", title: TITLE.material_weakness, evidence: snippet(concluded) };
  }
  const remediating = hits.find((s) => /remediat\w*/i.test(s) && !/\b(could|may|might|would|if)\b/i.test(s));
  if (remediating) return { type: "material_weakness", severity: "watch", title: "Fixing an earlier material weakness", evidence: snippet(remediating) };
  return null;
}

// The parts of a filing worth keeping for re-classification (so the cache stores a few KB,
// not a 10-K). Item sections for 8-Ks, matching sentences for 10-K/10-Q.
function relevantText(text, form) {
  if (form === "8-K") return [itemSection(text, "4.01"), itemSection(text, "4.02"), itemSection(text, "5.02")].filter(Boolean).join(" ").slice(0, 12000);
  return sentences(text).filter((s) => /going concern|material weakness|not effective|remediat/i.test(s)).join(" ").slice(0, 12000);
}

function make(base, cls, f, date) {
  const type = cls?.type || base.type;
  return {
    type,
    severity: cls?.severity || base.severity,
    date,
    title: cls?.title || TITLE[type],
    detail: base.detail,
    why: WHY[type],
    evidence: cls?.evidence || "",
    form: f.form,
    url: f.url,
  };
}

// `filings`: sec.getRecentFilings() output. `textHits`: { goingConcern, materialWeakness }
// arrays from sec.fullTextSearch(), scoped to this company. `texts`: { [url]: relevantText }
// for filings that were read; anything unread keeps a conservative tier.
function scanRedFlags(filings = [], textHits = {}, texts = {}) {
  const flags = [];
  const read = (url) => (url && texts[url] != null ? texts[url] : null);
  for (const f of filings) {
    if (f.form === "8-K") {
      const items = f.items || "";
      if (/\b4\.02\b/.test(items)) flags.push(make({ type: "restatement", severity: "critical", detail: "Non-reliance on previously issued financial statements" }, null, f, f.filingDate));
      if (/\b4\.01\b/.test(items)) {
        const t = read(f.url);
        flags.push(make({ type: "auditor_change", severity: "high", detail: "Change in the company's certifying accountant" }, t != null ? classifyAuditorChange(t) : null, f, f.filingDate));
      }
      if (/\b5\.02\b/.test(items)) {
        const t = read(f.url);
        flags.push(make({ type: "officer_change", severity: "info", detail: "Officer or director change (Item 5.02)" }, t != null ? classifyDeparture(t) : { type: "officer_change", severity: "info", title: "Officer or director change (not read yet)" }, f, f.filingDate));
      }
    }
    if (f.form === "NT 10-K" || f.form === "NT 10-Q") {
      flags.push(make({ type: "late_filing", severity: f.form === "NT 10-K" ? "critical" : "high", detail: `${f.form}: the company couldn't file its ${f.form.slice(3)} on time` }, { title: `Late ${f.form.slice(3)} (${f.form})` }, f, f.filingDate));
    }
  }
  for (const [key, classify, type] of [["goingConcern", classifyGoingConcern, "going_concern"], ["materialWeakness", classifyMaterialWeakness, "material_weakness"]]) {
    for (const h of textHits[key] || []) {
      const t = read(h.url);
      const f = { form: h.form, url: h.url };
      const label = type === "going_concern" ? '"Going concern"' : '"Material weakness"';
      if (t == null) {
        flags.push(make({ type, severity: "info", detail: `${label} appears in a ${h.form}; not read yet` }, { title: `${TITLE[type]} mentioned (unconfirmed)` }, f, h.filedAt));
        continue;
      }
      const cls = classify(t);
      if (cls) flags.push(make({ type, severity: cls.severity, detail: `From the ${h.form} filed ${h.filedAt}` }, cls, f, h.filedAt));
    }
  }
  // Dedupe (full-text search and the filing list can surface the same filing): keep the most
  // severe reading per type and date.
  const best = new Map();
  for (const f of flags) {
    const key = `${f.type === "officer_change" ? "departure" : f.type}|${f.date}`;
    const prev = best.get(key);
    if (!prev || RANK[f.severity] < RANK[prev.severity]) best.set(key, f);
  }
  return [...best.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.date || "").localeCompare(a.date || ""));
}

// Overall read for badges and alerts.
function summarize(flags = []) {
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const f of flags) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const serious = counts.critical + counts.high;
  const level = serious ? "concern" : counts.watch ? "watch" : "clean";
  const parts = [];
  if (serious) parts.push(`${serious} serious`);
  if (counts.watch) parts.push(`${counts.watch} to watch`);
  const label = level === "clean" ? "No red flags" : parts.join(", ");
  return { level, label, counts, serious };
}

// What the scan looked for, for the "checked" list in the UI.
const CHECKS = [
  { key: "restatement", label: "Restatements (8-K Item 4.02)" },
  { key: "auditor_change", label: "Auditor changes (8-K Item 4.01)" },
  { key: "late_filing", label: "Late 10-K / 10-Q notices" },
  { key: "going_concern", label: "Going-concern doubt in 10-K / 10-Q" },
  { key: "material_weakness", label: "Material weaknesses in internal controls" },
  { key: "departure", label: "CEO, CFO or chief accounting officer exits" },
];

const SEVERITY_WEIGHT = { critical: 4, high: 2, watch: 1, info: 0 };
function flagScore(flags) {
  return flags.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] ?? 1), 0);
}

module.exports = { TIERS, CHECKS, scanRedFlags, summarize, flagScore, relevantText, itemSection, classifyDeparture, classifyAuditorChange, classifyGoingConcern, classifyMaterialWeakness };
