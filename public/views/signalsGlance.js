// Research Overview row: every quant signal for one stock as a compact chip that links to the
// tab that explains it. Each chip's scale ("−100 … +100") is in its tooltip.
import { esc, api } from "../shared.js";

// One compact chip: label, value, tone color. The scale goes in the tooltip, not on the page.
const chip = (href, name, value, scale, tone) => `
  <a class="sig-chip ${tone ? `tone-${tone}` : ""}" href="${href}" title="${esc(scale)}">
    <span class="sig-label">${esc(name)}</span>
    <span class="sig-value">${value}</span>
  </a>`;

export function signalsGlanceHtml() {
  return `<section class="sig-row" id="signalsGlance" aria-label="Signals at a glance" hidden></section>`;
}

export async function loadSignalsGlance(symbol, data) {
  const box = document.getElementById("signalsGlance");
  if (!box) return;
  const base = `#/research/${encodeURIComponent(symbol)}`;
  const get = (url) => api(url).catch(() => null);
  const [ins, sp, cr] = await Promise.all([
    get(`/api/insiders/${encodeURIComponent(symbol)}/signal`),
    get(`/api/short-pressure/${encodeURIComponent(symbol)}`),
    get(`/api/crowding/${encodeURIComponent(symbol)}`),
  ]);
  if (!document.getElementById("signalsGlance")) return;
  const signedNum = (n) => `${n > 0 ? "+" : ""}${n}`;
  const rv = data.street?.revisionScore;
  const chips = [];
  if (ins && !ins.error) chips.push(chip(`${base}/ownership`, "Insider signal", `${signedNum(ins.score)} ${esc(ins.label)}`, "−100 heavy selling … +100 strong buying", ins.score >= 25 ? "good" : ins.score <= -25 ? "bad" : ""));
  if (rv) chips.push(chip(`${base}/street`, "Estimate revisions", `${signedNum(rv.score)} ${esc(rv.label)}`, "−100 falling … +100 rising", rv.score >= 15 ? "good" : rv.score <= -15 ? "bad" : ""));
  if (sp && !sp.error) chips.push(chip(`${base}/risk`, "Short crowding", `${sp.score}/100 ${esc(sp.label)}`, "45+ crowded · 70+ heavily crowded", sp.score >= 45 ? "bad" : ""));
  if (cr && !cr.error) chips.push(chip(base, "Attention", `${cr.score}/100 ${esc(cr.label)}`, "Volume, gaps & news vs normal", cr.score >= 60 ? "bad" : ""));
  const rf = data.redFlags;
  if (rf && rf.level !== "clean") chips.push(chip(`${base}/filings`, "Filing red flags", esc(rf.label), rf.full ? "Read from recent SEC filings" : "Item codes only; open Filings for the full scan", rf.level === "concern" ? "bad" : "warn"));
  if (!chips.length) return;
  box.innerHTML = chips.join("");
  box.hidden = false;
}
