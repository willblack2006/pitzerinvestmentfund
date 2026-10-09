// Club chat: pure helpers (unit-tested). routes/chat.js does the I/O.
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;

const REACTIONS = ["👍", "👀", "🔥", "❓", "✅", "😂"];
const MAX_BODY = 2000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_IMAGE_BYTES = 600 * 1024;

// Attachment kinds: "quote" (highlighted text + where it came from), "page" (a link to a page),
// "snapshot" (an uploaded image of part of a page, with the page it came from).
function cleanAttachment(a) {
  if (a === undefined || a === null) return null;
  if (typeof a !== "object") throw bad("Attachment must be an object.");
  if (!["quote", "page", "snapshot"].includes(a.kind)) throw bad("Unknown attachment kind.");
  const ref = String(a.pageRef ?? "");
  const symbol = a.symbol ? String(a.symbol).toUpperCase() : null;
  const out = {
    kind: a.kind,
    pageRef: /^#\/[\w\-./%=&?]*$/.test(ref) ? ref.slice(0, 300) : "", // in-app links only
    pageTitle: String(a.pageTitle ?? "").slice(0, 200),
    symbol: symbol && TICKER.test(symbol) ? symbol : null,
  };
  if (a.kind === "quote") {
    out.quote = String(a.quote ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!out.quote) throw bad("A quote attachment needs the quoted text.");
  }
  return out;
}

// @mentions: "@Ana" (first name) or "@Ana Analyst" (full name), case-insensitive, matched
// against active members. A first name shared by two members only matches by full name.
function parseMentions(body, members) {
  const text = ` ${String(body || "").toLowerCase()} `;
  const firstCounts = {};
  for (const m of members) { const f = m.name.split(/\s+/)[0].toLowerCase(); firstCounts[f] = (firstCounts[f] || 0) + 1; }
  const hit = (needle) => new RegExp(`[\\s(]@${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s,.!?:;)]|$)`, "i").test(text);
  return members.filter((m) => {
    const full = m.name.toLowerCase(), first = full.split(/\s+/)[0];
    return hit(full) || (firstCounts[first] === 1 && hit(first));
  }).map((m) => m.id);
}

function cleanMessage(input = {}) {
  const body = String(input.body ?? "").trim();
  if (body.length > MAX_BODY) throw bad(`Messages are limited to ${MAX_BODY} characters.`);
  const attachment = cleanAttachment(input.attachment);
  const imageId = input.imageId == null ? null : Number(input.imageId);
  if (imageId !== null && !Number.isInteger(imageId)) throw bad("Bad image.");
  if (!body && !attachment && !imageId) throw bad("Write a message or attach something.");
  const replyTo = input.replyTo == null ? null : Number(input.replyTo);
  if (replyTo !== null && !Number.isInteger(replyTo)) throw bad("Bad reply.");
  return { body, attachment, imageId, replyTo };
}

const canEdit = (msg, member, now = Date.now()) => msg.memberId === member.id && !msg.deletedAt && now - Date.parse(`${msg.createdAt.replace(" ", "T")}Z`) < EDIT_WINDOW_MS;
const canDelete = (msg, member) => !msg.deletedAt && (msg.memberId === member.id || member.isAdmin);

// Image uploads: trust the bytes, not the declared type.
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === "PNG") return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

module.exports = { REACTIONS, MAX_BODY, MAX_IMAGE_BYTES, EDIT_WINDOW_MS, cleanAttachment, parseMentions, cleanMessage, canEdit, canDelete, sniffImage };
