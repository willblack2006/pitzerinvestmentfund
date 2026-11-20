// Ownership pictures (WS10): 13F holder flows by quarter (who added, who cut) and an insider
// timeline (Form 4 open-market buys above the line, sales below, sized by dollar value, with
// the cluster badge when three or more insiders bought within 30 days).
import { esc, fmtNum, fmtMoneyCompact } from "../shared.js";
import { loadAnnotations } from "./markers.js";
import { linear, responsiveSvg, tooltip, dataToggle } from "./rv.js";

// ---- 13F flows: diverging stacked columns ----
// rows: thirteenFLive.breadthHistory rows ({ period, buyers, sellers, newPositions, exits, holders })
// "Added" = buyers that already held; "New" = first-time holders; "Cut" and "Sold out" below zero.
export function flowsHtml(rows, label) {
  const q = rows.filter((r) => r.buyers != null && r.sellers != null);
  if (!q.length) return "";
  const parts = q.map((r) => {
    const fresh = r.newPositions || 0, exits = r.exits || 0;
    return { label: label(r), added: Math.max(0, r.buyers - fresh), fresh, cut: Math.max(0, r.sellers - exits), exits, holders: r.holders };
  });
  const up = Math.max(1, ...parts.map((p) => p.added + p.fresh));
  const down = Math.max(1, ...parts.map((p) => p.cut + p.exits));
  const total = up + down;
  const h = (n) => `${((n / total) * 100).toFixed(2)}%`;
  const aria = `13F filers adding and cutting, by quarter: ${parts.map((p) => `${p.label}: ${p.fresh} new, ${p.added} added, ${p.cut} cut, ${p.exits} sold out`).join("; ")}.`;
  return `
    <div class="rv-legend" aria-hidden="true">
      <span><i style="--c:var(--s4)"></i>New holders</span><span><i style="--c:color-mix(in srgb, var(--s4) 55%, var(--panel))"></i>Added</span>
      <span><i style="--c:color-mix(in srgb, var(--s5) 55%, var(--panel))"></i>Cut</span><span><i style="--c:var(--s5)"></i>Sold out</span>
    </div>
    <div class="rv-flows" id="flowsChart" role="img" aria-label="${esc(aria)}" style="--up:${((up / total) * 100).toFixed(2)}%">
      ${parts.map((p) => {
        const tip = `<strong>${esc(p.label)}</strong><br>${fmtNum(p.fresh)} new · ${fmtNum(p.added)} added<br>${fmtNum(p.cut)} cut · ${fmtNum(p.exits)} sold out<br><span class="muted">${fmtNum(p.holders)} filers holding</span>`;
        const net = p.added + p.fresh - p.cut - p.exits;
        return `<div class="rv-flow-col" tabindex="0" data-tip="${esc(tip)}">
          <div class="rv-flow-up"><span class="rv-seg-added" style="height:${h(p.added)}"></span><span class="rv-seg-new" style="height:${h(p.fresh)}"></span></div>
          <div class="rv-flow-down"><span class="rv-seg-cut" style="height:${h(p.cut)}"></span><span class="rv-seg-exit" style="height:${h(p.exits)}"></span></div>
          <span class="rv-flow-net ${net >= 0 ? "tone-good" : "tone-bad"}">${net >= 0 ? "+" : "−"}${fmtNum(Math.abs(net))}</span>
          <span class="rv-flow-label">${esc(p.label)}</span>
        </div>`;
      }).join("")}
    </div>`;
}
export function wireFlows(host) { if (host) tooltip(host); }

// ---- Insider timeline ----
export const insiderTimelineHtml = () => `
  <section class="panel span-full" aria-labelledby="itl-h">
    <div class="panel-head"><h3 id="itl-h">Insider trades over time</h3><span class="muted small">Form 4 open-market buys and sales, five years</span></div>
    <div id="itlBody"><p class="muted small">Loading Form 4 history…</p></div>
  </section>`;

export async function loadInsiderTimeline(symbol) {
  const box = document.getElementById("itlBody");
  if (!box) return;
  const ann = await loadAnnotations(symbol);
  if (!document.getElementById("itlBody")) return;
  const rows = ann?.layers?.insiders || [];
  if (!rows.length) {
    box.innerHTML = `<p class="muted">${ann?.errors?.insiders ? (/FINNHUB/.test(ann.errors.insiders) ? "Insider history needs a Finnhub API key on the server." : `Insider history unavailable: ${esc(ann.errors.insiders)}`) : "No open-market insider buys or sales in five years. Grants, option exercises and tax withholding are left out."}</p>`;
    return;
  }
  const buys = rows.filter((r) => r.side === "buy"), sells = rows.filter((r) => r.side === "sell");
  const clusters = buys.filter((r) => r.cluster).length;
  const sum = (a) => a.reduce((s, r) => s + (r.value || 0), 0);
  box.innerHTML = `
    <p>${buys.length} buying day${buys.length === 1 ? "" : "s"} (${fmtMoneyCompact(sum(buys))}) and ${sells.length} selling day${sells.length === 1 ? "" : "s"} (${fmtMoneyCompact(sum(sells))}).${clusters ? ` <span class="rv-badge">Cluster buying ${clusters === 1 ? "once" : `${clusters} times`}</span>` : ""}</p>
    <div class="rv-legend" aria-hidden="true"><span><i style="--c:var(--s4)"></i>Buy (above)</span><span><i style="--c:var(--s5)"></i>Sale (below)</span><span><i class="ring"></i>Cluster: 3+ insiders buying within 30 days</span><span class="muted">Size = dollar value</span></div>
    <div id="itlChart" class="rv-chart"></div>
    <p class="muted small">Selling is common (taxes, diversification, planned 10b5-1 sales) and says little on its own; buying with their own money, especially several insiders at once, is the stronger signal.</p>`;
  const host = document.getElementById("itlChart");
  const from = ann.from || rows[0].date;
  const t0 = Date.parse(from), t1 = Date.now();
  const maxV = Math.max(1, ...rows.map((r) => r.value || 0));
  responsiveSvg(host, `${symbol} insider trades since ${from}: ${buys.length} buying days, ${sells.length} selling days${clusters ? `, ${clusters} clusters` : ""}.`, (W) => {
    const H = 180, pad = { l: 8, r: 8, t: 14, b: 26 }, mid = (H - pad.b + pad.t) / 2;
    const x = linear([t0, t1], [pad.l + 10, W - pad.r - 10]);
    const rMax = Math.min(22, (H - pad.t - pad.b) / 4);
    const r = (v) => Math.max(3.5, Math.sqrt((v || 0) / maxV) * rMax);
    const years = [];
    for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) years.push(y);
    const dots = rows.map((e) => {
      const cx = x(Date.parse(e.date)), rad = r(e.value), buy = e.side === "buy";
      const cy = buy ? mid - rad - 4 : mid + rad + 4;
      const tip = `<strong>${esc(e.date)}</strong> · ${buy ? "Buy" : "Sale"}${e.cluster ? " (cluster)" : ""}<br>${esc(e.names.join(", "))}<br>${fmtNum(e.shares)} shares${e.value ? `, about ${fmtMoneyCompact(e.value)}` : ""}`;
      return `<g class="rv-itl-dot" tabindex="0" data-tip="${esc(tip)}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="var(${buy ? "--s4" : "--s5"})" fill-opacity="${buy ? 0.85 : 0.55}" stroke="var(--panel)" stroke-width="1.5"/>${e.cluster ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(rad + 4).toFixed(1)}" fill="none" stroke="var(--text)" stroke-width="1.5"/>` : ""}</g>`;
    }).join("");
    return {
      height: H,
      html: `
        ${years.map((y) => { const xx = x(Date.UTC(y, 0, 1)); return `<line x1="${xx}" x2="${xx}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--grid)"/><text x="${xx + 4}" y="${H - 8}" class="rv-axis-text">${y}</text>`; }).join("")}
        <line x1="${pad.l}" x2="${W - pad.r}" y1="${mid}" y2="${mid}" stroke="var(--border-strong)"/>
        <text x="${pad.l}" y="${pad.t}" class="rv-axis-text">Buys</text><text x="${pad.l}" y="${H - pad.b - 4}" class="rv-axis-text">Sales</text>
        ${dots}`,
    };
  });
  tooltip(host);
  dataToggle(host, `${symbol} insider open-market trades`, ["Date", "Side", "Insiders", "Shares", "Value", "Cluster"],
    rows.slice().reverse().map((e) => [e.date, e.side === "buy" ? "Buy" : "Sale", e.names.join(", "), fmtNum(e.shares), e.value ? fmtMoneyCompact(e.value) : "—", e.cluster ? "Yes" : ""]));
}
