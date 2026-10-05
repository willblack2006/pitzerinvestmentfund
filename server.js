require("dotenv").config();

const express = require("express");
const positionsRouter = require("./routes/positions");
const researchRouter = require("./routes/research");
const macroRouter = require("./routes/macro");
const screenerRouter = require("./routes/screener");
const insidersRouter = require("./routes/insiders");
const watchlistRouter = require("./routes/watchlist");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/api", positionsRouter);
app.use("/api", researchRouter);
app.use("/api", macroRouter);
app.use("/api", screenerRouter);
app.use("/api", insidersRouter);
app.use("/api", watchlistRouter);

app.listen(PORT, () => console.log(`PIF tracker running on http://localhost:${PORT}`));
