#!/usr/bin/env bash
# Apply migrations 0124-0130 (Epic 22) to the deployed project, in order.
#   0124 live authorization in the database   (rewrites ~130 policies/functions: every gym is affected)
#   0125 authorize_action
#   0126 Super Admin aal2 flag (seeded OFF)   (replaces custom_access_token_hook)
#   0127 session limits + step-up
#   0128 Super Admin recovery email
#   0129 last-verified-factor guard           (replaces custom_access_token_hook again; trigger on auth.mfa_factors)
#   0130 a gym owner is never a Super Admin
#
# Modes:
#   --preflight   run scripts/preflight-epic22-deploy.sql (read-only) and stop
#   (default)     apply
#   --verify      print the post-deploy checks only
#
# Transport: DEPLOY_VIA=api (default; Supabase management API, token in ~/.supabase/access-token) or
# DEPLOY_VIA=psql (scripts/prod-db.sh; needs a host with network -- from the devcontainer it fails silently).
#
# Safety properties (same shape as deploy-0098-0103.sh):
#   * each migration runs in its own transaction and its ledger row is inserted in the SAME transaction;
#   * the loop stops at the first failure; every migration also self-asserts in a trailing DO block;
#   * refuses to start unless the head is exactly 0123;
#   * the super_admin_aal2 flag stays OFF: nothing here changes how a Super Admin signs in.
# Rollback: scripts/rollback-0130 ... rollback-0124, in that order (see docs/runbooks/deploy-epic-22.md).
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="apply"
case "${1:-}" in
  --preflight) MODE="preflight" ;;
  --verify) MODE="verify" ;;
  "") ;;
  *) echo "usage: $0 [--preflight|--verify]" >&2; exit 2 ;;
esac

VIA="${DEPLOY_VIA:-api}"
REF="${PROD_PROJECT_REF:-vfxezibagiznrirdwkwh}"

if [ "$VIA" = "psql" ]; then
  # shellcheck source=scripts/prod-db.sh
  . scripts/prod-db.sh
  run_sql() { prod_psql; }          # SQL on stdin
else
  TOKEN="$(cat "${SUPABASE_ACCESS_TOKEN_FILE:-$HOME/.supabase/access-token}")"
  # SQL on stdin -> management API; prints the JSON rows, exits non-zero on an API error.
  run_sql() {
    local body resp
    body="$(uv run --no-project python -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')"
    resp="$(curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary "$body")"
    echo "$resp"
    case "$resp" in *'"message"'*ERROR*|*'"message":"Failed'*) return 1 ;; esac
  }
fi

if [ "$MODE" = "preflight" ]; then
  if [ "$VIA" = "psql" ]; then run_sql < scripts/preflight-epic22-deploy.sql
  else
    # The API returns only the last statement's rows, so run each statement separately.
    uv run --no-project python - "$REF" "$TOKEN" <<'PY'
import json, re, sys, urllib.request
ref, token = sys.argv[1], sys.argv[2]
src = open("scripts/preflight-epic22-deploy.sql").read()
src = "\n".join(l for l in src.splitlines() if not l.startswith("\\echo") and not l.strip().startswith("--"))
for stmt in [s.strip() for s in src.split(";") if s.strip()]:
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": stmt}).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "gymos-preflight"})
    try:
        print(urllib.request.urlopen(req).read().decode())
    except urllib.error.HTTPError as e:
        print("API error:", e.read().decode()[:300], "\n  in:", stmt[:120].replace("\n", " "))
        sys.exit(1)
PY
  fi
  exit 0
fi

HEAD() { echo "select max(version) as head from supabase_migrations.schema_migrations;" | run_sql; }

verify() {
  run_sql <<'SQL'
select 'ledger' as check, string_agg(version, ',' order by version) as value
  from supabase_migrations.schema_migrations where version >= '0124'
union all select 'flag super_admin_aal2 (expect false)', (select enabled::text from private.platform_flags where flag = 'super_admin_aal2')
union all select 'authorize_action present (expect 2)', count(*)::text from pg_proc where proname = 'authorize_action'
union all select 'guard triggers (expect 3)', count(*)::text from pg_trigger
  where tgname in ('guard_last_verified_factor','guard_super_admin_not_owner','guard_owner_not_super_admin')
union all select 'hook not client-callable (expect false,false)',
  has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')::text || ',' ||
  has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')::text
union all select 'hook callable by auth admin (expect true)', has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')::text
union all select 'super admins flagged (expect >= 1)', count(*)::text from public.users where is_super_admin
union all select 'active gyms', count(*)::text from public.gyms where status = 'active';
SQL
}

if [ "$MODE" = "verify" ]; then verify; exit 0; fi

# docs/decisions.md (V1.6 release runbook, section 3): a fresh GREEN db-backup run immediately before the migrations.
# One backup covers the whole batch. Refuses to apply if it is not green. (SKIP_DB_BACKUP="<reason>" skips on purpose, loudly.)
uv run --no-project python scripts/lib/require-db-backup.py || { echo "No green backup: nothing was applied." >&2; exit 1; }

echo "=== head BEFORE ==="
H="$(HEAD)"; echo "$H"
case "$H" in *'"head":"0123"'*) ;; *) echo "Expected head 0123 -- stopping without applying anything."; exit 1 ;; esac

FILES=(0124_live_authorization_database 0125_authorize_action 0126_super_admin_aal2_flag 0127_session_limits_step_up 0128_super_admin_recovery_email 0129_super_admin_factor_guard 0130_owner_never_super_admin)
for BASE in "${FILES[@]}"; do
  V="${BASE:0:4}"; N="${BASE:5}"
  printf '%-5s %-40s ' "$V" "$N"
  if { echo "begin;"; cat "supabase/migrations/$BASE.sql"; echo "insert into supabase_migrations.schema_migrations (version, name) values ('$V', '$N');"; echo "commit;"; } | run_sql >/dev/null; then
    echo "APPLIED"
  else
    echo "FAILED -- stopping. Nothing from this migration was committed. Earlier ones in this run stay applied."
    exit 1
  fi
done

echo; echo "=== VERIFICATION (do not trust the exit code alone) ==="
verify
echo
echo "NEXT: deploy the payment-webhook edge function, then merge the PR (Vercel deploys the apps), then smoke-test."
