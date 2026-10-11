#!/usr/bin/env bash
# Run supabase/tests/*.test.sql against the local Supabase Postgres with plain
# psql (inside the DB container) and a minimal TAP check -- replaces the
# pg_prove container, which was observed dying silently (no output, exit 0).
#
# A file FAILS if psql reports an ERROR, any line starts with "not ok", the
# "1..N" plan is missing, or the number of ok/not ok lines differs from N.
# Exit status is non-zero if any file fails.
#
#   scripts/pgtap-run.sh [files...]     (default: every supabase/tests/*.test.sql)
#   PGTAP_JOBS=4 scripts/pgtap-run.sh   (files run concurrently on the SAME db;
#                                         only safe on a pristine database)
set -uo pipefail
cd "$(dirname "$0")/.."

DB_CONTAINER=${DB_CONTAINER:-supabase_db_gym_os}
JOBS=${PGTAP_JOBS:-1}
FILES=("$@")
[ ${#FILES[@]} -gt 0 ] || FILES=(supabase/tests/*.test.sql)

# `supabase test db` creates pgTAP itself; a freshly reset database has none.
docker exec -e PGPASSWORD=postgres "$DB_CONTAINER" psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 \
  -c "create extension if not exists pgtap with schema extensions" >/dev/null || {
  echo "could not create the pgtap extension in $DB_CONTAINER" >&2; exit 2; }

run_one() {
  local f=$1 out
  out=$(docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
    psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=0 -f - <"$f" 2>&1)
  local plan oks nots errs
  plan=$(printf '%s\n' "$out" | sed -n 's/^1\.\.\([0-9]\+\).*/\1/p' | head -1)
  oks=$(printf '%s\n' "$out" | grep -c '^ok ')
  nots=$(printf '%s\n' "$out" | grep -c '^not ok ')
  errs=$(printf '%s\n' "$out" | grep -c 'ERROR:')
  if [ -n "$plan" ] && [ "$nots" = 0 ] && [ "$errs" = 0 ] && [ "$((oks + nots))" = "$plan" ]; then
    echo "ok   $f ($oks)"
  else
    echo "FAIL $f (plan=${plan:-none} ok=$oks not_ok=$nots errors=$errs)"
    printf '%s\n' "$out" | grep -E '^not ok |^# |ERROR:' | head -12 | sed 's/^/     /'
    return 1
  fi
}
export -f run_one
export DB_CONTAINER
LOG=$(mktemp)
printf '%s\0' "${FILES[@]}" | xargs -0 -n1 -P "$JOBS" bash -c 'run_one "$0"' | tee "$LOG"
fails=$(grep -c '^FAIL' "$LOG"); total=${#FILES[@]}
rm -f "$LOG"
echo "pgTAP: $((total - fails))/$total files passed"
[ "$fails" = 0 ]
