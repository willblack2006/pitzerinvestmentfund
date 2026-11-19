// Background job registry (plan 3.4). Modules call register() at require time; lib/scheduler.js
// calls start() once when the server boots. Jobs registered after start() begin right away.
// Each job skips a round while its previous round is still running (no overlap) and records
// its last run for GET /api/platform/health.
//
//   jobs.register("agent-triggers", { everyMs: 60_000, delayMs: 20_000, fn: async () => { ... } })
const jobs = new Map(); // name -> { everyMs, delayMs, fn, running, lastStartAt, lastEndAt, lastError, runs, timers }
let started = false;

function register(name, { everyMs, fn, delayMs = 0 } = {}) {
  if (!name || typeof fn !== "function") throw new Error("jobs.register needs a name and fn");
  if (!(everyMs > 0)) throw new Error(`jobs.register("${name}") needs everyMs > 0`);
  if (jobs.has(name)) stop(name);
  const job = { name, everyMs, delayMs, fn, running: false, lastStartAt: null, lastEndAt: null, lastError: null, lastMs: null, runs: 0, skipped: 0, timers: [] };
  jobs.set(name, job);
  if (started) schedule(job);
  return job;
}

// One round of a job (also what tests and "run now" buttons call). Returns false if skipped.
async function runOnce(name) {
  const job = jobs.get(name);
  if (!job) throw new Error(`No job named ${name}`);
  if (job.running) { job.skipped++; return false; }
  job.running = true; job.lastStartAt = new Date().toISOString();
  const t0 = Date.now();
  try { await job.fn(); job.lastError = null; } catch (err) {
    job.lastError = String(err?.message || err).slice(0, 500);
    console.error(`[jobs] ${name} failed:`, job.lastError);
  } finally {
    job.running = false; job.runs++; job.lastEndAt = new Date().toISOString(); job.lastMs = Date.now() - t0;
  }
  return true;
}

function schedule(job) {
  const first = setTimeout(() => runOnce(job.name), job.delayMs);
  const every = setInterval(() => runOnce(job.name), job.everyMs);
  first.unref?.(); every.unref?.();
  job.timers = [first, every];
}

function start() {
  if (started) return;
  started = true;
  for (const job of jobs.values()) schedule(job);
}

function stop(name) {
  const list = name ? [jobs.get(name)].filter(Boolean) : [...jobs.values()];
  for (const j of list) { j.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); j.timers = []; }
  if (!name) started = false;
}

function status() {
  return [...jobs.values()].map(({ name, everyMs, running, lastStartAt, lastEndAt, lastError, lastMs, runs, skipped }) => ({ name, everyMs, running, lastStartAt, lastEndAt, lastError, lastMs, runs, skipped }));
}

module.exports = { register, runOnce, start, stop, status, _jobs: jobs };
