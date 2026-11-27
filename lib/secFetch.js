// One shared limiter for every request to sec.gov (www, data, efts). SEC's fair-access policy
// allows 10 requests per second per client and requires a descriptive User-Agent; going over
// gets the server's IP blocked for a while, which breaks every SEC feature at once. Before this,
// each source module fetched on its own, so the 13F ingest, agent tools and a research page
// could add up to more than 10/s between them.
const MAX_PER_SEC = Number(process.env.SEC_MAX_PER_SEC) || 8; // a little under SEC's 10
const starts = []; // start times (ms) of requests in the last second
const waiting = [];
let timer = null;

function userAgent() {
  return process.env.SEC_USER_AGENT || "Pitzer Investment Fund research@example.edu";
}

function pump() {
  timer = null;
  const now = Date.now();
  while (starts.length && now - starts[0] >= 1000) starts.shift();
  while (waiting.length && starts.length < MAX_PER_SEC) { starts.push(now); waiting.shift()(); }
  if (waiting.length && !timer) timer = setTimeout(pump, Math.max(5, 1000 - (now - starts[0])));
}

// Resolves when this caller may start a request.
function slot() {
  return new Promise((resolve) => { waiting.push(resolve); pump(); });
}

// fetch() with the SEC User-Agent and the shared limit. A 429 is retried once after 2s.
async function secFetch(url, { accept = "application/json", headers = {}, ...opts } = {}) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await fetch(url, { ...opts, headers: { "User-Agent": userAgent(), Accept: accept, ...headers } });
    if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    return res;
  }
}

module.exports = { secFetch, userAgent, slot, MAX_PER_SEC };
