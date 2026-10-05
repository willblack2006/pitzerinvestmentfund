export const el = (id) => document.getElementById(id);
export const fmtUSD = (n) => (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const fmtPct = (n) => `${n >= 0 ? "+" : ""}${(n ?? 0).toFixed(2)}%`;
export const fmtNum = (n) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
export const fmtCompact = (n) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);

export function getPassword() {
  return sessionStorage.getItem("pif_edit_password") || "";
}
export function isUnlocked() {
  return !!getPassword();
}

export async function api(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  if (isUnlocked()) headers["x-edit-password"] = getPassword();
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}
