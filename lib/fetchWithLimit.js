// Simple concurrency + spacing limiter so bursts (e.g. the screener fanning out to ~40
// Finnhub calls at once) don't blow through the free tier's ~60 calls/min cap.
const MAX_CONCURRENT = 8;
const MIN_SPACING_MS = 150; // ~6-7 calls/sec ceiling, well under 60/min per caller burst

let active = 0;
let lastStart = 0;
const queue = [];

function pump() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  const now = Date.now();
  const wait = Math.max(0, lastStart + MIN_SPACING_MS - now);
  setTimeout(() => {
    const job = queue.shift();
    if (!job) return;
    active++;
    lastStart = Date.now();
    job();
    pump();
  }, wait);
}

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    });
    pump();
  });
}

module.exports = { schedule };
