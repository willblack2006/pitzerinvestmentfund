// Every server call the builder and gallery make, in one place. The engine's routes (WS2,
// routes/agentEngine.js) and the builder's own (routes/agentDraft.js) live under
// /api/platform. A 404 from the engine means it isn't installed on this server yet; callers
// show that plainly instead of a broken page.
import { api } from "../shared.js";

const BASE = "/api/platform/agents";
const enc = encodeURIComponent;

// Like shared.api, but keeps the server's field-level `errors` and `warnings` on the thrown error.
async function call(path, { method = "GET", body } = {}) {
  if (method === "GET") return api(path);
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-pif-app": "1" }, credentials: "same-origin", body: body == null ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, code: data?.code, errors: data?.errors || [], warnings: data?.warnings || [] });
  return data;
}

export const isMissing = (err) => err?.status === 404 || err?.status === 405;

export const listAgents = () => call(BASE).then((r) => r.agents || []);
export const getAgent = (idOrSlug) => call(`${BASE}/${enc(idOrSlug)}`).then((r) => r.agent || r);
export const createAgent = (body) => call(BASE, { method: "POST", body }).then((r) => r.agent || r);
export const updateAgent = (id, body) => call(`${BASE}/${enc(id)}`, { method: "PUT", body }).then((r) => r.agent || r);
export const versions = (id) => call(`${BASE}/${enc(id)}/versions`).then((r) => r.versions || []);
export const restore = (id, version) => call(`${BASE}/${enc(id)}/restore`, { method: "POST", body: { version } }).then((r) => r.agent || r);
export const fork = (id) => call(`${BASE}/${enc(id)}/fork`, { method: "POST", body: {} }).then((r) => r.agent || r);
export const pause = (id) => call(`${BASE}/${enc(id)}/pause`, { method: "POST", body: {} });
export const resume = (id) => call(`${BASE}/${enc(id)}/resume`, { method: "POST", body: {} });
export const runNow = (id, symbol) => call(`${BASE}/${enc(id)}/run`, { method: "POST", body: symbol ? { symbol } : {} });
export const follow = (id, on = true) => call(`${BASE}/${enc(id)}/follow`, { method: on ? "POST" : "DELETE", body: {} });
// Dry run a saved agent, or an unsaved spec straight from the form.
export const dryRun = ({ id, spec, days = 30 }) => id
  ? call(`${BASE}/${enc(id)}/dry-run`, { method: "POST", body: { days } })
  : call(`${BASE}/dry-run`, { method: "POST", body: { spec, days } });
export const validate = (spec) => call(`${BASE}/validate`, { method: "POST", body: { spec } });
export const templates = () => call(`${BASE}/templates`).then((r) => r.templates || []);
export const draft = (text) => call(`${BASE}/draft`, { method: "POST", body: { text } });
export const catalog = () => call("/api/platform/builder/catalog");
export const metrics = () => call("/api/metrics").then((r) => r.metrics || []);
export const run = (runId) => api(`/api/agents/runs/${enc(runId)}`);
