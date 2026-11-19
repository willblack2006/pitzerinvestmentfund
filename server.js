require("dotenv").config();

const express = require("express");
const compression = require("compression");
const positionsRouter = require("./routes/positions");
const researchRouter = require("./routes/research");
const macroRouter = require("./routes/macro");
const screenerRouter = require("./routes/screener");
const insidersRouter = require("./routes/insiders");
const shortPressureRouter = require("./routes/shortPressure");
const estimateRevisionsRouter = require("./routes/estimateRevisions");
const factorsRouter = require("./routes/factors");
const trackRecordRouter = require("./routes/trackRecord");
const backtestRouter = require("./routes/backtest");
const executionRouter = require("./routes/execution");
const crowdingRouter = require("./routes/crowding");
const thirteenFRouter = require("./routes/thirteenF");
const calendarRouter = require("./routes/calendar");
const newsTriageRouter = require("./routes/newsTriage");
const forcedSellersRouter = require("./routes/forcedSellers");
const indexRadarRouter = require("./routes/indexRadar");
const baseRateRouter = require("./routes/baseRate");
const govContractsRouter = require("./routes/govContracts");
const congressTradesRouter = require("./routes/congressTrades");
const paperTradingRouter = require("./routes/paperTrading");
const watchlistRouter = require("./routes/watchlist");
const portfolioRouter = require("./routes/portfolio");
const todayRouter = require("./routes/today");
const dividendsRouter = require("./routes/dividends");
const pitchesRouter = require("./routes/pitches");
const membersRouter = require("./routes/members");
const authRouter = require("./routes/auth");
const eventsRouter = require("./routes/events");
const { requireAppHeader } = require("./middleware/auth");
const scheduler = require("./lib/scheduler");
// AI spending cap: every OpenAI call is checked against it and logged (lib/agents/budget.js).
require("./lib/agents/budget").install();
// Research agent workflows (filing and earnings flashes, …) register with the dispatcher.
require("./lib/agents/workflows");
const path = require("path");

const PORT = process.env.PORT || 3000;

const app = express();
// Cheap liveness check for the host's health probe: no data-source calls, one trivial query.
app.get("/healthz", (req, res) => {
  try { require("./db").prepare("SELECT 1").get(); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});
app.set("trust proxy", 1); // Render/most hosts sit behind one proxy; needed for per-IP rate limits
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Scripts only from this site and the one CDN that serves the chart libraries; no inline
    // scripts, no plugins, no framing. Styles allow inline (the UI sets some style attributes).
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net data: blob:",
      "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; "),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...(process.env.NODE_ENV === "production" || process.env.RENDER ? { "Strict-Transport-Security": "max-age=15552000" } : {}),
  });
  next();
});
// gzip JSON/JS/CSS responses — a real win on cellular connections. Never the live-update
// stream: compression buffers output, which would hold events back.
app.use(compression({ filter: (req, res) => req.path !== "/api/events" && compression.filter(req, res) }));
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  // These files aren't content-hashed and the app is many ES modules, so a cached copy of one
  // file next to a fresh copy of another breaks pages right after a deploy. maxAge 0 makes the
  // browser revalidate each file (a cheap 304 via ETag when nothing changed).
  maxAge: 0,
}));

// Session cookies ride along on cross-site requests, so every API change must carry the app's
// own header (see middleware/auth.js requireAppHeader).
// Tell API callers how old the cached data behind a response is (oldest row used). Agent tools
// read this so they can report real freshness instead of "now".
app.use("/api", (req, res, next) => {
  const store = {};
  const json = res.json.bind(res);
  res.json = (body) => { if (store.oldest && !res.headersSent) res.set("x-pif-data-as-of", store.oldest); return json(body); };
  require("./lib/cache").requestAge.run(store, next);
});
app.use("/api", requireAppHeader);
app.use("/api", authRouter);
app.use("/api", eventsRouter);
app.use("/api", require("./routes/prefs"));
app.use("/api", require("./routes/notes"));
app.use("/api", require("./routes/chat"));
app.use("/api", require("./routes/notifications"));
app.use("/api", require("./routes/myAlerts"));
app.use("/api", require("./routes/profiles"));
app.use("/api", require("./routes/watchlists"));
app.use("/api", positionsRouter);
app.use("/api", researchRouter);
app.use("/api", macroRouter);
app.use("/api", screenerRouter);
app.use("/api", insidersRouter);
app.use("/api", shortPressureRouter);
app.use("/api", estimateRevisionsRouter);
app.use("/api", factorsRouter);
app.use("/api", trackRecordRouter);
app.use("/api", backtestRouter);
app.use("/api", executionRouter);
app.use("/api", crowdingRouter);
app.use("/api", thirteenFRouter);
app.use("/api", calendarRouter);
app.use("/api", newsTriageRouter);
app.use("/api", forcedSellersRouter);
app.use("/api", indexRadarRouter);
app.use("/api", baseRateRouter);
app.use("/api", govContractsRouter);
app.use("/api", congressTradesRouter);
app.use("/api", paperTradingRouter);
app.use("/api", watchlistRouter);
app.use("/api", portfolioRouter);
app.use("/api", todayRouter);
app.use("/api", dividendsRouter);
app.use("/api", pitchesRouter);
app.use("/api", membersRouter);
app.use("/api", require("./routes/agents"));
app.use("/api", require("./routes/tripwires"));
app.use("/api", require("./routes/agentDesk"));
app.use("/api", require("./routes/learn"));

app.use("/api", (req, res) => res.status(404).json({ error: "No such API endpoint." }));

// Express 5 forwards async errors here; answer JSON so the UI can show a message.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : "Something went wrong on the server." });
});

// Run as a normal server (`npm start`).
if (require.main === module) {
  // One-time Schwab 11/09 sync (guarded by a marker row, so it only ever runs once per database).
  const syncDb = require("./db");
  const sync = require("./lib/migrations/schwab20261109").apply(syncDb, process.env.DB_PATH || path.join(__dirname, "data", "pif.db"));
  if (sync.ran) console.log(`[migration] Schwab 11/09 applied: ${sync.positions} positions, backup ${sync.backup}`);
  // A stray rejected promise (a data source failing in a background job or a route that
  // forgot a handler) should be logged, not stop the server for every member.
  process.on("unhandledRejection", (err) => console.error("[unhandled rejection]", err?.stack || err));
  const interrupted = require("./lib/agents/runs").markInterrupted();
  if (interrupted) console.log(`[agents] ${interrupted} run(s) interrupted by the last restart marked failed`);
  const server = app.listen(PORT, () => {
    // Agent tools call the app's own read-only endpoints in-process.
    require("./lib/agents/tools").setBaseUrl(`http://127.0.0.1:${PORT}`);
    console.log(`PIF tracker running on http://localhost:${PORT}`);
    if (process.env.DISABLE_SCHEDULER !== "true") scheduler.start();
  });
  // A deploy sends SIGTERM: finish in-flight requests, fold the write-ahead log back into the
  // database file, then exit (and force it after 10s so a stuck connection can't block a deploy).
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => {
      try { syncDb.pragma("wal_checkpoint(TRUNCATE)"); } catch (err) { console.error("[server] checkpoint failed:", err.message); }
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
