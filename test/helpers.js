// Boots the real server on a random port against a throwaway SQLite file, so API tests
// exercise the exact production code path without touching the fund's database.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PASSWORD = "test-edit-password";       // the server's EDIT_PASSWORD (first-admin setup only)
const ADMIN_PASSWORD = "test-admin-password";

// `dir` reuses an existing database folder (to restart against the same data).
async function startServer({ dir = fs.mkdtempSync(path.join(os.tmpdir(), "pif-test-")) } = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, "test.db"),
      EDIT_PASSWORD: PASSWORD,
      DISABLE_SCHEDULER: "true",
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

  // Sessions are cookies. `auth: true` acts as the first admin (who can also trade), created
  // on first use through the one-time setup; `member: cookie` acts as that member.
  let adminCookie = null;
  async function ensureAdmin() {
    if (adminCookie) return adminCookie;
    const r = await api("/api/auth/setup", { method: "POST", body: { setupPassword: PASSWORD, name: "Test Admin", email: "admin@test.edu", password: ADMIN_PASSWORD } });
    if (r.status !== 201) throw new Error(`admin setup failed: ${r.status} ${r.text}`);
    adminCookie = r.cookie;
    return adminCookie;
  }

  async function api(p, { method = "GET", body, auth = false, member, headers = {}, appHeader = true } = {}) {
    const h = { "Content-Type": "application/json", ...(appHeader ? { "x-pif-app": "1" } : {}), ...headers };
    if (auth) h.Cookie = await ensureAdmin();
    if (member) h.Cookie = member;
    const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    const set = res.headers.get("set-cookie")?.match(/pif_session=([^;]*)/);
    return { status: res.status, body: json, text, cookie: set && set[1] ? `pif_session=${set[1]}` : null };
  }

  // Admin adds a member; the member accepts the invite. Returns { id, cookie }.
  async function createMember(name, { canTrade = false, isAdmin = false, email = `${name.toLowerCase()}@test.edu`, password = "member-password-1" } = {}) {
    const r = await api("/api/members", { method: "POST", auth: true, body: { name, email, canTrade, isAdmin } });
    if (r.status !== 201) throw new Error(`create member failed: ${r.status} ${r.text}`);
    const acc = await api(`/api/auth/invite/${r.body.inviteToken}`, { method: "POST", body: { password } });
    if (acc.status !== 200) throw new Error(`accept invite failed: ${acc.status} ${acc.text}`);
    return { id: r.body.member.id, cookie: acc.cookie, email, password };
  }

  return {
    base,
    api,
    createMember,
    ensureAdmin,
    log: () => log,
    dir,
    dbPath: path.join(dir, "test.db"),
    async stop({ keep = false } = {}) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
      if (!keep) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { startServer, PASSWORD, ADMIN_PASSWORD };
