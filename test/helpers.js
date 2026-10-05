// Boots the real server on a random port against a throwaway SQLite file, so API tests
// exercise the exact production code path without touching the fund's database.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PASSWORD = "test-edit-password";

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pif-test-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, "test.db"),
      EDIT_PASSWORD: PASSWORD,
      DISABLE_SCHEDULER: "true",
      // Never let tests reach the live database, whatever is in .env.
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      USE_TURSO: "false",
      AUTO_REFRESH_PRICES: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 15000);
    child.stdout.on("data", () => { if (log.includes("running on")) { clearTimeout(t); resolve(); } });
    child.on("exit", (code) => reject(new Error(`server exited ${code}:\n${log}`)));
  });
  const base = `http://localhost:${port}`;

  async function api(p, { method = "GET", body, auth = false, member, headers = {} } = {}) {
    const h = { "Content-Type": "application/json", ...headers };
    if (auth) h["x-edit-password"] = PASSWORD;
    if (member) h["x-member-token"] = member;
    const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: json, text };
  }

  return {
    base,
    api,
    log: () => log,
    async stop() {
      child.kill();
      await new Promise((r) => child.once("exit", r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { startServer, PASSWORD };
