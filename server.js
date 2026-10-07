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
const watchlistRouter = require("./routes/watchlist");
const portfolioRouter = require("./routes/portfolio");
const pitchesRouter = require("./routes/pitches");
const membersRouter = require("./routes/members");
const scheduler = require("./lib/scheduler");
const path = require("path");

const PORT = process.env.PORT || 3000;

const app = express();
app.set("trust proxy", 1); // Render/most hosts sit behind one proxy; needed for per-IP rate limits
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  next();
});
app.use(compression()); // gzip JSON/JS/CSS responses — a real win on cellular connections
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  // These files aren't content-hashed, so keep the cache short rather than immutable —
  // long enough to skip a re-fetch on back/forward and quick repeat visits, short enough
  // that a deploy is visible within a few minutes instead of needing a hard refresh.
  maxAge: "10m",
}));

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
app.use("/api", watchlistRouter);
app.use("/api", portfolioRouter);
app.use("/api", pitchesRouter);
app.use("/api", membersRouter);

app.use("/api", (req, res) => res.status(404).json({ error: "No such API endpoint." }));

// Express 5 forwards async errors here; answer JSON so the UI can show a message.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : "Something went wrong on the server." });
});

// Run as a normal server (`npm start`).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PIF tracker running on http://localhost:${PORT}`);
    if (process.env.DISABLE_SCHEDULER !== "true") scheduler.start();
  });
}

module.exports = app;
