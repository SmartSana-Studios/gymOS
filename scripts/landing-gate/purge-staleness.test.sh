#!/usr/bin/env bash
# Story 24.12 review: scripts/landing-gate/purge-staleness.sql is the only detector for a dead media purge job and runs only on staging, so a renamed
# column, a changed job name or status literal in public.record_page_media_purge_run, or a broken \gset / \if would keep every stage green and make the
# staging check lie. This runs the real script against the migrated local schema, each case in its own rolled-back transaction (nothing is committed):
#   no_rows        no page_media_purge row                          -> FAIL, "none ever", psql exits non-zero
#   fresh_success  record_page_media_purge_run(now(), true, ...)    -> PASS, exit 0
#   fresh_failure  record_page_media_purge_run(now(), false, ...)   -> FAIL (a failed run is not a live job), exit non-zero
#   old_success    a success that finished 30 minutes ago           -> FAIL, exit non-zero
#   other_job      a fresh success of another job                   -> FAIL (only page_media_purge counts)
#   null_finished  a row with finished_at null                      -> FAIL that names the row, not "none ever"
#
#   scripts/landing-gate/purge-staleness.test.sh
#   PURGE_STALENESS_SQL=<path> scripts/landing-gate/purge-staleness.test.sh   # known-bad run: a script that always passes
#
# Needs the local Supabase stack.
set -uo pipefail
cd "$(dirname "$0")/../.."
DB=${DB_CONTAINER:-supabase_db_gym_os}
SCRIPT=${PURGE_STALENESS_SQL:-scripts/landing-gate/purge-staleness.sql}
[ -f "$SCRIPT" ] || { echo "FAIL $SCRIPT not found"; exit 1; }

fail=0
run_case() { # run_case <name> <fixture sql> <expect PASS|FAIL> [expected substring]
  local name=$1 fixture=$2 want=$3 sub=${4:-} out rc
  out=$({ echo "begin;"; echo "delete from job_runs;"; echo "$fixture"; cat "$SCRIPT"; echo "rollback;"; } |
    docker exec -i -e PGPASSWORD=postgres "$DB" psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 2>&1)
  rc=$?
  # `case` patterns, not `printf | grep -q`: under pipefail grep -q exits at the first match, printf gets SIGPIPE and the pipeline reports 141, so a
  # correct result was sometimes reported as a failure when the machine was busy.
  if [ "$want" = PASS ]; then
    case "$out" in
      "PASS purge-staleness"*|*$'\n'"PASS purge-staleness"*) [ "$rc" = 0 ] && { echo "ok   $name"; return; } ;;
    esac
    echo "FAIL $name: expected PASS and exit 0, got exit $rc: $out"; fail=1
  else
    if [ "$rc" != 0 ]; then
      case "$out" in
        "FAIL purge-staleness"*|*$'\n'"FAIL purge-staleness"*)
          case "$out" in *"$sub"*) echo "ok   $name"; return ;; esac ;;
      esac
    fi
    echo "FAIL $name: expected FAIL ${sub:+naming [$sub] }and a non-zero exit, got exit $rc: $out"; fail=1
  fi
}

run_case no_rows "" FAIL "none ever"
run_case fresh_success "select public.record_page_media_purge_run(now(), true, 'x');" PASS
run_case fresh_failure "select public.record_page_media_purge_run(now(), false, 'x');" FAIL "failure at"
run_case old_success "insert into job_runs (job_name, started_at, finished_at, status) values ('page_media_purge', now() - interval '31 minutes', now() - interval '30 minutes', 'success');" FAIL "success at"
run_case other_job "insert into job_runs (job_name, started_at, finished_at, status) values ('loyalty_sweep', now(), now(), 'success');" FAIL "none ever"
run_case null_finished "insert into job_runs (job_name, started_at, finished_at, status) values ('page_media_purge', now() - interval '20 minutes', null, null);" FAIL "running at"

[ "$fail" = 0 ] && echo "purge-staleness: 6/6 cases ok"
exit "$fail"
