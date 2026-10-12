#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml -- run this BEFORE merging anything,
# so GitHub Actions only ever runs once per epic (the epic -> master PR).
#
#   scripts/ci-local.sh              # everything CI runs
#   scripts/ci-local.sh --fast       # static + pgTAP + vitest, skip the E2E (inner loop)
#   scripts/ci-local.sh --only e2e   # one stage: static | pgtap | unit | e2e
#
# Stages and what they mirror in ci.yml:
#   static  typecheck job: typecheck, lint (dashboard + super-admin), i18n parity, migration guardrails
#   pgtap   rls-tests job: supabase/tests/*.sql
#   unit    typecheck job: vitest for @gymos/dashboard
#   e2e     e2e-tests job: Playwright against the local Supabase
#
# Scheduling (4 cores / ~5 GB): static + pgtap run concurrently (both light),
# then vitest alone (it already fans out across every core; overlapping it with
# a Next build makes its timeouts flake), then E2E alone (workers: 1 by design,
# it shares one Supabase instance).
#
# pgTAP runs serially (~15 s) against the shared DB; -j4 on the same database
# is not safe to assume (files insert fixed ids). A pristine database is a
# precondition: against a dev DB holding QA data, 3 files fail deterministically
# (gym_payment_credentials_rls, payment_reconciliation_job,
# registration_fee_tara_collection.negative -- they count rows globally).
#
# Requires the local Supabase stack running (`supabase start`).
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
LOG_DIR=${CI_LOCAL_LOG_DIR:-/tmp/ci-local-logs}
mkdir -p "$LOG_DIR"
SUPABASE="$ROOT/node_modules/.bin/supabase"
DB_CONTAINER=supabase_db_gym_os
DB_PORT=54322

MODE=all
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) MODE=fast ;;
    --only) ONLY=${2:-}; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

want() { # want <stage>
  if [ -n "$ONLY" ]; then [ "$ONLY" = "$1" ]; return; fi
  [ "$MODE" = fast ] && [ "$1" = e2e ] && return 1
  return 0
}

run_stage() { # run_stage <name> <function> -- logs to $LOG_DIR/<name>.log, result to <name>.status
  local name=$1 fn=$2 start=$SECONDS res=FAIL
  rm -f "$LOG_DIR/$name.status"
  if "$fn" >"$LOG_DIR/$name.log" 2>&1; then res=PASS; fi
  echo "$res $((SECONDS - start))" >"$LOG_DIR/$name.status"
  echo "  [$name] $res ($((SECONDS - start))s)  log: $LOG_DIR/$name.log"
}

stage_static() {
  set -e
  pnpm run typecheck
  npx turbo run lint --filter=@gymos/dashboard --filter=@gymos/super-admin
  pnpm run check:i18n
  pnpm run check:migrations
  pnpm run test:guardrails
}

stage_pgtap() {
  set -e
  PGTAP_JOBS="${PGTAP_JOBS:-1}" bash "$ROOT/scripts/pgtap-run.sh"
}

stage_unit() {
  set -e
  npx turbo run test --filter=@gymos/dashboard --filter=@gymos/mobile
}

psql_local() {
  docker exec -e PGPASSWORD=postgres "$DB_CONTAINER" psql -U postgres -h 127.0.0.1 -At "$@"
}

# The E2E seed needs a database that looks like CI's: no other row may own the
# phones it inserts (migration 0094 forbids a staff/member phone clash), and a
# previous aborted run must not have left its fixture gym behind. Fail in a
# second here instead of after a 70 s Next build.
e2e_preflight() {
  local clash leftovers
  clash=$(psql_local -c "select count(*) from members m join gyms g on g.id = m.gym_id
    where g.name not like 'E2E Fixture Gym%'
      and regexp_replace(m.phone, '\D', '', 'g') in ('237670000001','237680000101','237680000102','237680000103','237680000104')") || return 2
  leftovers=$(psql_local -c "select count(*) from gyms where name like 'E2E Fixture Gym%'") || return 2
  if [ "$clash" != 0 ] || [ "$leftovers" != 0 ]; then
    echo "E2E preflight FAILED: the local database is not clean enough for the E2E seed."
    [ "$clash" != 0 ] && echo "  - $clash non-E2E member(s) already own an E2E fixture phone (dev seed data?)."
    [ "$leftovers" != 0 ] && echo "  - $leftovers leftover 'E2E Fixture Gym' row(s) from an aborted run."
    echo "  Reset the local DB (supabase db reset) or remove those rows, then re-run."
    return 1
  fi
}

stage_e2e() {
  set -e
  e2e_preflight || return 1
  eval "$("$SUPABASE" status -o env 2>/dev/null)"
  : "${API_URL:?supabase status did not export API_URL -- is the local stack running?}"
  export NEXT_PUBLIC_SUPABASE_URL=$API_URL
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
  export SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
  export DASHBOARD_APP_URL=http://127.0.0.1:3100
  # Idempotent (no-op once cached); CI does the same before the suite.
  (cd apps/dashboard && npx playwright install chromium)
  # CI=1 matches the Actions environment: retries: 1, no server reuse, html report.
  CI=1 npx turbo run test:e2e --filter=@gymos/dashboard
}

echo "ci-local: $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: working tree is dirty -- the result will not describe a commit." >&2
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "Local Supabase DB container '$DB_CONTAINER' is not running (supabase start)." >&2
  exit 2
fi

START=$SECONDS
STAGES=()
pids=()
if want static; then STAGES+=(static); run_stage static stage_static & pids+=($!); fi
if want pgtap;  then STAGES+=(pgtap);  run_stage pgtap  stage_pgtap  & pids+=($!); fi
for p in "${pids[@]:-}"; do [ -n "$p" ] && wait "$p"; done
if want unit; then STAGES+=(unit); run_stage unit stage_unit; fi
if want e2e;  then STAGES+=(e2e);  run_stage e2e  stage_e2e;  fi

echo
failed=0
for s in "${STAGES[@]}"; do
  read -r res secs <"$LOG_DIR/$s.status"
  printf '  %-7s %s (%ss)\n' "$s" "$res" "$secs"
  [ "$res" = PASS ] || failed=1
done
echo "total: $((SECONDS - START))s"

STAMP="$(git rev-parse --git-dir)/ci-local-pass"
if [ "$failed" = 0 ] && [ -z "$ONLY" ] && [ "$MODE" = all ] && [ -z "$(git status --porcelain)" ]; then
  echo "$(git rev-parse HEAD) $(date -u +%FT%TZ)" >"$STAMP"
  echo "GREEN: full local CI passed for $(git rev-parse --short HEAD) (stamp written)."
else
  rm -f "$STAMP"
  [ "$failed" = 0 ] && echo "Stages passed, but this was a partial/dirty run -- no merge stamp written."
fi
exit "$failed"
