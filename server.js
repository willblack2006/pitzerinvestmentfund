require("dotenv").config();

const express = require("express");
const positionsRouter = require("./routes/positions");
const researchRouter = require("./routes/research");
const macroRouter = require("./routes/macro");
const screenerRouter = require("./routes/screener");
const insidersRouter = require("./routes/insiders");
const watchlistRouter = require("./routes/watchlist");
const portfolioRouter = require("./routes/portfolio");
const pitchesRouter = require("./routes/pitches");
const membersRouter = require("./routes/members");
const scheduler = require("./lib/scheduler");
const db = require("./db");
const portfolio = require("./lib/portfolio");
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
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

// On Turso-backed serverless hosts, pick up writes made by other instances.
app.use("/api", (req, res, next) => { db.syncIfStale(); next(); });

// Daily valuation snapshot for hosts without an always-on process (Vercel Cron calls this).
app.get("/api/cron/snapshot", async (req, res) => {
  if (process.env.CRON_SECRET && req.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  res.json(await portfolio.snapshot());
});
app.use("/api", positionsRouter);
app.use("/api", researchRouter);
app.use("/api", macroRouter);
app.use("/api", screenerRouter);
app.use("/api", insidersRouter);
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

// Run as a normal server (`npm start`), or export the app for serverless hosts (api/index.js).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PIF tracker running on http://localhost:${PORT}`);
    if (process.env.DISABLE_SCHEDULER !== "true") scheduler.start();
  });
}

module.exports = app;
