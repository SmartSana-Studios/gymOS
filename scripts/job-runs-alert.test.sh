#!/usr/bin/env bash
# Epic 20 retro R-4: nothing exercised scripts/job-runs-alert.sql, so a dropped or misspelled
# job name in its `expected` list would have gone unnoticed. Runs the real script against the
# local database inside one rolled-back transaction, three scenarios:
#   healthy  every expected job ran 10 min ago                 -> zero rows
#   stale    loyalty_sweep last ran 30 h ago                 -> one 'not running' row for loyalty_sweep
#   failed   a fresh 'loyalty_hook' failure + stale/never    -> a 'failed run' row for loyalty_hook
# Needs the local Supabase stack. Never commits.
#
#   scripts/job-runs-alert.test.sh
set -uo pipefail
cd "$(dirname "$0")/.."
DB=${DB_CONTAINER:-supabase_db_gym_os}
SCRIPT=scripts/job-runs-alert.sql

JOBS="check_in_auto_timeout class_reminder quiet_gym_alert class_session_materializer payment_reconciliation saas_billing_lifecycle subscription_lifecycle loyalty_sweep"

run() { # $1 = fixture sql; prints the script's rows, pipe-separated
  { echo "begin; delete from job_runs;"; echo "$1"; cat "$SCRIPT"; echo "rollback;"; } |
    docker exec -i -e PGPASSWORD=postgres "$DB" psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 2>&1 |
    grep -v '^BEGIN$\|^DELETE \|^INSERT \|^ROLLBACK$'
}
healthy_sql() {
  local j
  for j in $JOBS; do echo "insert into job_runs (job_name, started_at, finished_at, status) values ('$j', now() - interval '10 minutes', now() - interval '9 minutes', 'success');"; done
}

fail=0
check() { # $1 name, $2 actual, $3 expected-substring ('' = must be empty)
  if [ -z "$3" ]; then
    [ -z "$2" ] && echo "ok   $1" || { echo "FAIL $1: expected no rows, got: $2"; fail=1; }
  else
    case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: expected '$3', got: ${2:-<nothing>}"; fail=1 ;; esac
  fi
}

check "healthy: every expected job ran recently -> no rows" "$(run "$(healthy_sql)")" ""
check "stale: loyalty_sweep 30 h old -> not running" \
  "$(run "$(healthy_sql | grep -v loyalty_sweep)
insert into job_runs (job_name, started_at, finished_at, status) values ('loyalty_sweep', now() - interval '30 hours', now() - interval '30 hours', 'success');")" \
  "not running|loyalty_sweep"
check "never: loyalty_sweep never ran -> not running ... never" \
  "$(run "$(healthy_sql | grep -v loyalty_sweep)")" "not running|loyalty_sweep|never"
check "failed: fresh loyalty_hook failure -> failed run" \
  "$(run "$(healthy_sql)
insert into job_runs (job_name, started_at, finished_at, status, error) values ('loyalty_hook', now() - interval '5 minutes', now() - interval '5 minutes', 'failure', 'boom');")" \
  "failed run|loyalty_hook"

[ "$fail" = 0 ] && echo "job-runs-alert: all passed" || { echo "job-runs-alert: FAILED"; exit 1; }
