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
#   PGTAP_FLAKE_DIR=<dir> scripts/pgtap-run.sh
#                                       (keeps docker's exit status, byte counts and the head of the output of any
#                                        "incomplete output" run, for the epic 20 retro item 39 flake. The same facts
#                                        are always printed on the RETRY / FAIL lines.)
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

# One psql pass over a file. Prints the verdict line; returns 0 ok, 1 assertion/ERROR failure,
# 3 "incomplete output" (no 'not ok', no ERROR, but the plan or some ok lines are missing).
check_once() {
  local f=$1 out dockerrc
  out=$(docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
    psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=0 -f - <"$f" 2>&1)
  dockerrc=$?
  local plan oks nots errs
  plan=$(printf '%s\n' "$out" | sed -n 's/^1\.\.\([0-9]\+\).*/\1/p' | head -1)
  oks=$(printf '%s\n' "$out" | grep -c '^ok ')
  nots=$(printf '%s\n' "$out" | grep -c '^not ok ')
  errs=$(printf '%s\n' "$out" | grep -c 'ERROR:')
  if [ -n "$plan" ] && [ "$nots" = 0 ] && [ "$errs" = 0 ] && [ "$((oks + nots))" = "$plan" ]; then
    echo "ok   $f ($oks)"
    return 0
  fi
  echo "FAIL $f (plan=${plan:-none} ok=$oks not_ok=$nots errors=$errs)"
  printf '%s\n' "$out" | grep -E '^not ok |^# |ERROR:' | head -12 | sed 's/^/     /'
  if [ "$nots" = 0 ] && [ "$errs" = 0 ]; then
    # Say WHY in the normal log (epic 20 retro item 39): docker's exit status, how much came back, and the first
    # lines. A connection failure ("psql: error: ... FATAL ...", "Error response from daemon ...") never contains
    # the text "ERROR:", so it lands in this branch and used to leave no trace of its cause.
    printf '     docker_exit=%s out_bytes=%s first_lines=[%s]\n' "$dockerrc" "${#out}" \
      "$(printf '%s\n' "$out" | grep -v '^$' | head -3 | cut -c1-160 | tr '\n' '|')"
    # Keep the evidence for the incomplete-output flake (epic 20 retro item 39): what docker returned and how much.
    if [ -n "${PGTAP_FLAKE_DIR:-}" ]; then
      mkdir -p "$PGTAP_FLAKE_DIR"
      {
        printf 'file=%s file_bytes=%s docker_exit=%s out_bytes=%s ok=%s plan=%s\n--- first 40 lines ---\n' \
          "$f" "$(stat -c %s "$f")" "$dockerrc" "${#out}" "$oks" "${plan:-none}"
        printf '%s\n' "$out" | head -40
      } > "$PGTAP_FLAKE_DIR/$(basename "$f").$(date +%s%N).out"
    fi
    return 3
  fi
  return 1
}

# Epic 20 retro P-2: three different files each failed once when run beside the static stage with
# plan=none or one ok line short and no 'not ok' / ERROR, then passed alone -- the docker exec
# output was incomplete, not an assertion. That shape (and only that shape) is retried once, and the
# retry is printed so it is visible. A 'not ok' or an ERROR is never retried.
run_one() {
  local f=$1 rc out try
  out=$(check_once "$f"); rc=$?
  # Incomplete-output shape only (rc 3): up to 3 more tries. With the other stages running beside it, 10 files
  # lost their output at once on 2026-10-18 and one retry was not enough (all passed alone). Only the final
  # attempt is printed, so a retried-then-passed file never leaves a FAIL line for the summary to count.
  for try in 1 2 3; do
    [ "$rc" = 3 ] || break
    echo "RETRY $f (incomplete output, no assertion failed; try $try of 3) $(printf '%s\n' "$out" | grep -m1 'docker_exit=' | sed 's/^ *//')" >&2
    sleep 2
    out=$(check_once "$f"); rc=$?
  done
  printf '%s\n' "$out"
  return "$rc"
}
export -f check_once
export -f run_one
export DB_CONTAINER
LOG=$(mktemp)
printf '%s\0' "${FILES[@]}" | xargs -0 -n1 -P "$JOBS" bash -c 'run_one "$0"' | tee "$LOG"
fails=$(grep -c '^FAIL' "$LOG"); total=${#FILES[@]}
rm -f "$LOG"
echo "pgTAP: $((total - fails))/$total files passed"
[ "$fails" = 0 ]
