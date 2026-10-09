// Live updates: an in-process hub behind GET /api/events (Server-Sent Events). Render runs a
// single instance, so an in-memory set of open streams is enough; if the app ever runs on
// several instances this needs a shared bus (e.g. Redis pub/sub).
const { logActivity } = require("../middleware/auth");

const clients = new Set(); // { res, member } — member is null for visitors

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// `membersOnly` events (chat, presence) never go to visitors' streams; `to` limits an event to
// specific member ids (e.g. a mention).
function publish(type, data, { membersOnly = false, to = null } = {}) {
  for (const c of clients) {
    if (membersOnly && !c.member) continue;
    if (to && (!c.member || !to.includes(c.member.id))) continue;
    try { send(c.res, type, data); } catch { clients.delete(c); }
  }
}

// Members with at least one open tab (for "who's online").
function onlineMemberIds() {
  return [...new Set([...clients].filter((c) => c.member).map((c) => c.member.id))];
}

function subscribe(req, res, member) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // proxies must not buffer the stream
  });
  res.write("retry: 5000\n\n");
  const client = { res, member };
  const wasOnline = member && onlineMemberIds().includes(member.id);
  clients.add(client);
  send(res, "hello", { member: member ? { id: member.id, name: member.name } : null, online: member ? onlineMemberIds() : [] });
  if (member && !wasOnline) publish("presence", { online: onlineMemberIds() }, { membersOnly: true });
  // Render's proxy closes idle connections; a comment line every 25s keeps the stream open.
  const beat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 25000);
  req.on("close", () => {
    clearInterval(beat);
    clients.delete(client);
    if (member && !onlineMemberIds().includes(member.id)) publish("presence", { online: onlineMemberIds() }, { membersOnly: true });
  });
}

// Every change to the real fund: record who did it, then tell every open page to refresh.
function fundChanged(req, action, detail = {}) {
  logActivity(req, action, detail);
  publish("fund.changed", { action, detail, by: req.member?.name || null, at: new Date().toISOString() });
  // Real buys and sells also go to everyone's inbox (required lazily: notify.js uses this module).
  if (action === "transaction.buy" || action === "transaction.sell") {
    const n = Number(detail.shares).toLocaleString("en-US", { maximumFractionDigits: 4 });
    const price = Number.isFinite(detail.price) ? ` at $${detail.price.toFixed(2)}` : "";
    require("./notify").notify("all", {
      type: "fundTrade",
      title: `The fund ${action === "transaction.buy" ? "bought" : "sold"} ${n} ${detail.symbol}${price}`,
      body: req.member?.name ? `Recorded by ${req.member.name}.` : "",
      link: `#/research/${encodeURIComponent(detail.symbol)}`,
    }, { except: req.member?.id ?? null });
  }
}

module.exports = { publish, subscribe, fundChanged, onlineMemberIds, _clients: clients };
