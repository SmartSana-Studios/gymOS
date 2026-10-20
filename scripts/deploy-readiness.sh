#!/usr/bin/env bash
# READ-ONLY readiness check for a production deploy window (Epic 22 retro item 78): proves the tooling a deploy needs actually
# works BEFORE the window, against the real transports, instead of finding out in the middle of it. Writes nothing, triggers
# nothing (it only LISTS db-backup runs), applies nothing.
#
#   bash scripts/deploy-readiness.sh [<migration version, e.g. 0133>]
#
# PASS / WARN / FAIL per line; exit 1 if any FAIL. A WARN is a tool you may not need for this deploy (the Vercel CLI, prod_psql,
# the pg module) but should know about now. The 2026-10-17 deploy found, during the window, that prod_psql fails silently here,
# that the Vercel CLI has no login or hangs, and that the operator scripts had no pg module.
set -uo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
REF="${PROD_PROJECT_REF:-vfxezibagiznrirdwkwh}"
TOKEN_FILE="${SUPABASE_ACCESS_TOKEN_FILE:-$HOME/.supabase/access-token}"
fail=0
pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fail=1; }

api() { # $1 method+path suffix after /v1/, $2 optional JSON body
  curl -sS --max-time 25 -w '\n%{http_code}' -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Content-Type: application/json" \
    ${2:+-X POST --data-binary "$2"} "https://api.supabase.com/v1/$1" 2>&1
}

echo "== deploy readiness ($(date -u +%Y-%m-%dT%H:%MZ)) project $REF${VERSION:+, migration $VERSION}"

# 1. Python with a working json module (the system python3 here lacks it; the deploy scripts use uv's)
if uv run --no-project python -c 'import json' >/dev/null 2>&1; then pass "uv python with json (used by the deploy scripts)"; else bad "uv run python cannot import json: the deploy scripts will fail"; fi

# 2. Supabase management API token and the project
if [ ! -r "$TOKEN_FILE" ]; then bad "management API token not readable at $TOKEN_FILE"
else
  r=$(api "projects/$REF/database/backups"); code=${r##*$'\n'}
  if [ "$code" = 200 ]; then pass "management API token works (HTTP 200)"; else bad "management API answered HTTP $code for the project (token expired or revoked?)"; fi

  # 3. the production ledger is readable and its head is what the next migration expects
  body=$(uv run --no-project python -c 'import json; print(json.dumps({"query": "select max(version) as head from supabase_migrations.schema_migrations"}))')
  r=$(api "projects/$REF/database/query" "$body"); code=${r##*$'\n'}; json=${r%$'\n'*}
  head=$(printf '%s' "$json" | uv run --no-project python -c 'import json,sys; print(json.load(sys.stdin)[0]["head"])' 2>/dev/null || true)
  if [ "$code" = 201 ] || [ "$code" = 200 ]; then
    if [ -n "$head" ]; then pass "production ledger readable, head is $head"; else bad "production query returned no ledger head"; fi
  else bad "production query failed (HTTP $code)"; fi
  if [ -n "$VERSION" ] && [ -n "$head" ]; then
    prev=$(printf '%04d' $((10#$VERSION - 1)))
    if [ "$head" = "$prev" ]; then pass "head $head is exactly one before $VERSION"
    elif [ "$head" = "$VERSION" ]; then warn "head is already $VERSION: nothing to apply"
    else bad "head is $head but $VERSION needs $prev"; fi
    ls supabase/migrations/${VERSION}_*.sql >/dev/null 2>&1 && pass "migration file for $VERSION exists" || bad "no supabase/migrations/${VERSION}_*.sql"
    ls scripts/rollback-${VERSION}-*.sql >/dev/null 2>&1 && pass "rollback script for $VERSION exists" || warn "no scripts/rollback-${VERSION}-*.sql (a migration without a rollback script)"
  fi
fi

# 4. the backup: the deploy scripts need gh and a green db-backup run
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  pass "gh is logged in (the deploy scripts trigger db-backup through it)"
  last=$(gh run list --workflow db-backup.yaml --limit 8 --json conclusion,createdAt --jq '[.[]|select(.conclusion=="success")][0].createdAt' 2>/dev/null)
  if [ -n "$last" ] && [ "$last" != null ]; then
    age_h=$(( ($(date -u +%s) - $(date -u -d "$last" +%s)) / 3600 ))
    if [ "$age_h" -le 26 ]; then pass "last green db-backup run is ${age_h}h old ($last)"; else warn "last green db-backup run is ${age_h}h old: the nightly job may be failing (the deploy script will trigger a fresh one)"; fi
  else bad "no green db-backup run found in the last 8 runs"; fi
else bad "gh is missing or not logged in: the deploy scripts cannot take the pre-migration backup"; fi

# 5. tools only some paths need: say now if they are unusable
if [ -d scripts/operator/node_modules/pg ] || node -e 'require("pg")' >/dev/null 2>&1; then pass "pg module available for the operator scripts"; else warn "pg module missing: run npm ci --prefix scripts/operator before using enable/disable/reset/unlock"; fi
if [ -r "$HOME/.supabase-db-password" ]; then pass "database password file present (operator scripts)"; else warn "no ~/.supabase-db-password: the operator scripts cannot connect"; fi
# prod_psql from the devcontainer returns NOTHING and exits 0; detect that rather than trust it
out=$(timeout 25 bash -c '. scripts/prod-db.sh >/dev/null 2>&1 && prod_psql -tAc "select 1"' 2>/dev/null | tr -d '[:space:]')
if [ "$out" = 1 ]; then pass "prod_psql works from here"; else warn "prod_psql returns nothing from here (silent failure, known): use the management-API scripts"; fi
if command -v vercel >/dev/null 2>&1; then who=$(timeout 25 vercel whoami 2>/dev/null | tail -1); else who=$(timeout 25 npx --no-install vercel whoami 2>/dev/null | tail -1); fi
if [ -n "${who:-}" ]; then pass "Vercel CLI logged in as $who"; else warn "Vercel CLI unavailable, hung or not logged in: do app deploys from the Vercel dashboard / git push"; fi

echo
[ "$fail" = 0 ] && echo "READY: nothing blocks a deploy (read the WARN lines)." || { echo "NOT READY: fix the FAIL lines first."; exit 1; }
