#!/usr/bin/env bash
# Apply ONE migration to the deployed project through the Supabase management API (the dev container's
# docker-exec psql fails silently, see docs/runbooks/deploy-epic-22.md).
#
#   scripts/deploy-migration.sh 0131 [--verify]
#
# Refuses unless the ledger head is exactly the previous version, runs the file and inserts the ledger row in ONE
# transaction, and prints the ledger afterwards. Read-only with --verify. Token: ~/.supabase/access-token.
set -euo pipefail
cd "$(dirname "$0")/.."

V="${1:-}"
[[ "$V" =~ ^[0-9]{4}$ ]] || { echo "usage: $0 <4-digit version> [--verify]" >&2; exit 2; }
PREV="$(printf '%04d' $((10#$V - 1)))"
FILE="$(ls supabase/migrations/${V}_*.sql 2>/dev/null | head -1)"
[ -n "$FILE" ] || { echo "no supabase/migrations/${V}_*.sql" >&2; exit 2; }
NAME="$(basename "$FILE" .sql)"; NAME="${NAME#${V}_}"
REF="${PROD_PROJECT_REF:-vfxezibagiznrirdwkwh}"
TOKEN="$(cat "${SUPABASE_ACCESS_TOKEN_FILE:-$HOME/.supabase/access-token}")"

run_sql() {
  local body resp
  body="$(uv run --no-project python -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')"
  resp="$(curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary "$body")"
  echo "$resp"
  case "$resp" in *'"message":"Failed'*) return 1 ;; esac
}

ledger() { echo "select version, name from supabase_migrations.schema_migrations order by version desc limit 3;" | run_sql; }

if [ "${2:-}" = "--verify" ]; then ledger; exit 0; fi

HEAD="$(echo "select max(version) as head from supabase_migrations.schema_migrations;" | run_sql)"
echo "head before: $HEAD"
case "$HEAD" in *"\"head\":\"$PREV\""*) ;; *) echo "Expected head $PREV -- stopping without applying anything." >&2; exit 1 ;; esac

printf '%s %s ... ' "$V" "$NAME"
if { echo "begin;"; cat "$FILE"; echo "insert into supabase_migrations.schema_migrations (version, name) values ('$V', '$NAME');"; echo "commit;"; } | run_sql >/dev/null; then
  echo "APPLIED"
else
  echo "FAILED -- nothing from this migration was committed." >&2
  exit 1
fi
ledger
