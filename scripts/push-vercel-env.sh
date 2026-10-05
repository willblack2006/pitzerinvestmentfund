#!/usr/bin/env bash
# Copies the app's settings into Vercel (Production) so the live site can use them.
#
# Usage (from the project folder), with every key in .env:
#   bash scripts/push-vercel-env.sh
#
# Turso values come from the command line. Other keys are read from your local .env, unless
# you also pass them on the command line (e.g. EDIT_PASSWORD='...'), which takes precedence.
# Values are piped straight to the Vercel CLI and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

from_env_file() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
TURSO_DATABASE_URL="${TURSO_DATABASE_URL:-$(from_env_file TURSO_DATABASE_URL)}"
TURSO_AUTH_TOKEN="${TURSO_AUTH_TOKEN:-$(from_env_file TURSO_AUTH_TOKEN)}"

[ -n "${TURSO_DATABASE_URL:-}" ] && [ -n "${TURSO_AUTH_TOKEN:-}" ] || {
  echo "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first (see usage at the top of this file)." >&2
  exit 1
}


set_var() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then echo "  skip  $name (no value)"; return; fi
  vercel env rm "$name" production -y >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" production >/dev/null
  echo "  set   $name"
}

echo "Setting Vercel production environment variables:"
set_var TURSO_DATABASE_URL "$TURSO_DATABASE_URL"
set_var TURSO_AUTH_TOKEN "$TURSO_AUTH_TOKEN"
for key in EDIT_PASSWORD FINNHUB_API_KEY FRED_API_KEY SEC_USER_AGENT ANTHROPIC_API_KEY; do
  set_var "$key" "${!key:-$(from_env_file "$key")}"
done
set_var DISABLE_SCHEDULER "true"
[ -n "${EDIT_PASSWORD:-}$(from_env_file EDIT_PASSWORD)" ] || echo "  WARNING: no EDIT_PASSWORD given — the live site keeps its old one."
echo "Done. Tell Claude to redeploy."
