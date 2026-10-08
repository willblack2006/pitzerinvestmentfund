// House Clerk financial disclosures: the yearly index (a zip holding YYYYFD.txt) and the text
// of electronically filed Periodic Transaction Reports (PDFs, encrypted with an empty password,
// which pdf-parse handles).
const zlib = require("zlib");
const { cached } = require("../cache");
const { parseFdIndex, parsePtrText } = require("../congressTrades");

const BASE = "https://disclosures-clerk.house.gov/public_disc";

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`House disclosure request failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Minimal zip reader: finds `name` through the central directory (local headers can leave
// sizes blank) and inflates it. Enough for the Clerk's single-folder archives.
function unzipEntry(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (entryName === name) {
      const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const data = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in zip`);
}

async function getPtrIndex(year) {
  return cached(`house_fd_index_${year}`, 12 * 60 * 60, "house_fd", async () => {
    const zip = await fetchBuffer(`${BASE}/financial-pdfs/${year}FD.zip`);
    return parseFdIndex(unzipEntry(zip, `${year}FD.txt`).toString("utf8"), year);
  });
}

// Trades in one PTR. A filed report never changes, so its parsed trades cache for 30 days.
async function getPtrTrades(filing) {
  return cached(`house_ptr_${filing.docId}`, 30 * 24 * 60 * 60, "house_fd", async () => {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js"); // the package index runs a self-test on load
    const { text } = await pdfParse(await fetchBuffer(filing.url));
    return parsePtrText(text);
  });
}

// Electronic PTRs filed in the last `days` days, each with its parsed trades. Fetched four at a
// time to stay polite to the Clerk's server; a PDF that fails is skipped, not fatal.
async function getRecentPtrs(days = 60) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10);
  const years = [...new Set([now.getUTCFullYear(), new Date(cutoff).getUTCFullYear()])];
  const indexes = await Promise.all(years.map((y) => getPtrIndex(y).catch(() => [])));
  const recent = indexes.flat().filter((f) => f.electronic && f.filingDate && f.filingDate >= cutoff);
  const queue = [...recent];
  const out = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try { out.push({ ...f, trades: await getPtrTrades(f) }); } catch { out.push({ ...f, trades: [], error: true }); }
    }
  }));
  return { filings: out, paperCount: indexes.flat().filter((f) => !f.electronic && f.filingDate >= cutoff).length };
}

module.exports = { unzipEntry, getPtrIndex, getPtrTrades, getRecentPtrs };
