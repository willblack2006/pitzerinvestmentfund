// Research Overview row: every quant signal for one stock, each with its own scale spelled out
// ("+40 on −100…+100") and a link to the tab that explains it.
import { esc, api } from "../shared.js";

const chip = (href, name, value, scale, tone) => `
  <a class="snap" href="${href}">
    <span class="snap-label">${esc(name)}</span>
    <span class="snap-value ${tone ? `tone-${tone}` : ""}">${value}</span>
    <span class="snap-sub">${esc(scale)}</span>
  </a>`;

export function signalsGlanceHtml() {
  return `<section class="snapshot" id="signalsGlance" aria-label="Signals at a glance" hidden></section>`;
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
  if (ins && !ins.error) chips.push(chip(`${base}/ownership`, "Insider signal", `${signedNum(ins.score)} <span class="small">${esc(ins.label)}</span>`, "−100 heavy selling … +100 strong buying", ins.score >= 25 ? "good" : ins.score <= -25 ? "bad" : ""));
  if (rv) chips.push(chip(`${base}/street`, "Estimate revisions", `${signedNum(rv.score)} <span class="small">${esc(rv.label)}</span>`, "−100 falling … +100 rising", rv.score >= 15 ? "good" : rv.score <= -15 ? "bad" : ""));
  if (sp && !sp.error) chips.push(chip(`${base}/risk`, "Short crowding", `${sp.score}/100 <span class="small">${esc(sp.label)}</span>`, "45+ crowded · 70+ heavily crowded", sp.score >= 45 ? "bad" : ""));
  if (cr && !cr.error) chips.push(chip(base, "Attention", `${cr.score}/100 <span class="small">${esc(cr.label)}</span>`, "Volume, gaps & news vs normal", cr.score >= 60 ? "bad" : ""));
  if (data.redFlags?.length) chips.push(chip(`${base}/filings`, "Filing red flags", String(data.redFlags.length), "8-K items & late filings", "bad"));
  if (!chips.length) return;
  box.innerHTML = chips.join("");
  box.hidden = false;
}
