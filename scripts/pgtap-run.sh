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
#   PGTAP_TIMEOUT_SECONDS=900           (give up on a batch that has not finished; default 900)
#   PGTAP_FLAKE_DIR=<dir> scripts/pgtap-run.sh
#                                       (keeps the exit status, byte counts and the head of the output of any
#                                        "incomplete output" run. The same facts are always printed on the RETRY / FAIL lines.)
#
# HOW IT RUNS (Epic 20 retro item 39). It used to stream each file's output back through `docker exec`, and under load that
# stream was sometimes cut short while docker reported success (seen 2026-10-20: exit 0, 3085 bytes, the plan line present,
# the tail missing; and `docker exec` has been seen returning before its command finished). So nothing is streamed any more:
#   1. every script (plus an end-of-file sentinel) is copied into the container ONCE;
#   2. a runner INSIDE the container runs psql on each script, writing each result to a FILE, then writes checksums and a
#      `done` marker;
#   3. the host waits for the marker (not for docker's exit), copies the result files out ONCE, and verifies them against the
#      checksums before reading a single line.
# A copy that fails its checksum is repeated; a file whose output is still incomplete is re-run (up to 3 more times), and
# the RETRY / FAIL lines say which part broke.
set -uo pipefail
cd "$(dirname "$0")/.."

DB_CONTAINER=${DB_CONTAINER:-supabase_db_gym_os}
JOBS=${PGTAP_JOBS:-1}
TIMEOUT=${PGTAP_TIMEOUT_SECONDS:-900}
FILES=("$@")
[ ${#FILES[@]} -gt 0 ] || FILES=(supabase/tests/*.test.sql)
N=${#FILES[@]}

RUN="pgtap-run-$$-$RANDOM"
T=$(mktemp -d)
cleanup() {
  rm -rf "$T"
  docker exec "$DB_CONTAINER" rm -rf "/tmp/$RUN" </dev/null >/dev/null 2>&1
}
trap cleanup EXIT

# `supabase test db` creates pgTAP itself; a freshly reset database has none.
docker exec -e PGPASSWORD=postgres "$DB_CONTAINER" psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 \
  -c "create extension if not exists pgtap with schema extensions" >/dev/null </dev/null || {
  echo "could not create the pgtap extension in $DB_CONTAINER" >&2; exit 2; }

BATCH_ERR=""
mkdir -p "$T/res"

# Run the scripts with the given indexes in one batch. Leaves <idx>.out and <idx>.rc in $T/res for each. Returns 1 (and sets
# BATCH_ERR) when the machinery itself failed, in which case no result is trusted.
batch() {
  local tag=$1; shift
  local idxs=("$@") stage="$T/stage.$tag" out="$T/out.$tag" i f
  BATCH_ERR=""
  rm -rf "$stage" "$out"; mkdir -p "$stage"
  for i in "${idxs[@]}"; do
    f=${FILES[$i]}
    # The sentinel proves the script ran to its end even if the output file is later found short.
    { cat "$f"; printf '\n\\echo PGTAP_EOF\n'; } > "$stage/$i.sql"
    echo "$i" >> "$stage/list"
  done
  cat > "$stage/run.sh" <<'RUNNER'
#!/bin/sh
# Runs INSIDE the DB container. usage: run.sh <dir> <jobs>. Writes <dir>/out/<idx>.out and .rc, then SUMS, then done.
D=$1; JOBS=$2; OUT=$D/out
mkdir -p "$OUT"
export PGPASSWORD=postgres
xargs -P "$JOBS" -I{} sh -c 'psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=0 -f "$0/{}.sql" > "$1/{}.out" 2>&1; echo $? > "$1/{}.rc"' "$D" "$OUT" < "$D/list"
( cd "$OUT" && md5sum ./*.out ./*.rc > SUMS )
echo done > "$OUT/done"
RUNNER

  docker exec "$DB_CONTAINER" rm -rf "/tmp/$RUN" </dev/null >/dev/null 2>&1
  docker cp "$stage" "$DB_CONTAINER:/tmp/$RUN" >/dev/null 2>&1 || { BATCH_ERR="docker cp into the container failed"; return 1; }
  local have
  have=$(docker exec "$DB_CONTAINER" sh -c "ls /tmp/$RUN/*.sql 2>/dev/null | wc -l" </dev/null 2>/dev/null | tr -d '[:space:]')
  [ "$have" = "${#idxs[@]}" ] || { BATCH_ERR="only ${have:-0} of ${#idxs[@]} scripts arrived in the container"; return 1; }

  # Attached, but its exit is NOT trusted: the done marker below is what says the runner finished.
  docker exec "$DB_CONTAINER" sh "/tmp/$RUN/run.sh" "/tmp/$RUN" "$JOBS" </dev/null >/dev/null 2>&1
  local waited=0
  until docker exec "$DB_CONTAINER" test -f "/tmp/$RUN/out/done" </dev/null >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$TIMEOUT" ]; then BATCH_ERR="the in-container runner did not finish within ${TIMEOUT}s"; return 1; fi
  done

  # The copy-out is itself a docker stream, and under load it has returned results that failed their checksum (seen 2026-10-20,
  # three times in a row). So it is verified, repeated with a growing pause, and the LAST reason is kept for the log.
  local try why="" cprc bad
  for try in 1 2 3 4 5; do
    rm -rf "$out"
    docker cp "$DB_CONTAINER:/tmp/$RUN/out" "$out" >/dev/null 2>&1; cprc=$?
    if [ "$cprc" != 0 ]; then why="docker cp exited $cprc"
    elif [ ! -s "$out/SUMS" ]; then why="SUMS missing or empty after the copy"
    else
      bad=$(cd "$out" && md5sum -c SUMS 2>&1 | grep -v ': OK$' | head -3 | tr '\n' ' ')
      if [ -z "$bad" ]; then
        for i in "${idxs[@]}"; do
          if [ -f "$out/$i.out" ] && [ -f "$out/$i.rc" ]; then cp "$out/$i.out" "$out/$i.rc" "$T/res/"; else rm -f "$T/res/$i.out" "$T/res/$i.rc"; fi
        done
        return 0
      fi
      why="checksum: $bad"
    fi
    [ "$try" -lt 5 ] && sleep $((1 << (try - 1)))
  done
  BATCH_ERR="the results copied out of the container failed verification 5 times (last: $why)"
  return 1
}

# Judge one file from its result files. Prints the verdict lines; returns 0 ok, 1 assertion/ERROR failure,
# 3 "incomplete output" (no 'not ok', no ERROR, but the plan or some ok lines are missing).
judge() {
  local i=$1 f=${FILES[$1]} out psqlrc eof plan oks nots errs
  if [ -f "$T/res/$i.out" ]; then
    out=$(sed "s#psql:/tmp/$RUN/$i\.sql#psql:$f#" "$T/res/$i.out")
    psqlrc=$(cat "$T/res/$i.rc" 2>/dev/null)
  else
    out=""; psqlrc="no-result"
  fi
  eof=$(printf '%s\n' "$out" | grep -c '^PGTAP_EOF$')
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
    # Say WHY in the normal log: psql's exit status, how much came back, whether the end-of-file sentinel arrived, the first
    # lines, and the batch error if the machinery itself failed. A connection failure ("psql: error: ... FATAL ...") never
    # contains the text "ERROR:", so it lands in this branch.
    printf '     psql_exit=%s out_bytes=%s eof_marker=%s first_lines=[%s]%s\n' "$psqlrc" "${#out}" "$eof" \
      "$(printf '%s\n' "$out" | grep -v '^$' | head -3 | cut -c1-160 | tr '\n' '|')" "${BATCH_ERR:+ batch_error=[$BATCH_ERR]}"
    if [ -n "${PGTAP_FLAKE_DIR:-}" ]; then
      mkdir -p "$PGTAP_FLAKE_DIR"
      {
        printf 'file=%s file_bytes=%s psql_exit=%s out_bytes=%s eof_marker=%s ok=%s plan=%s batch_error=%s\n--- first 40 lines ---\n' \
          "$f" "$(stat -c %s "$f")" "$psqlrc" "${#out}" "$eof" "$oks" "${plan:-none}" "${BATCH_ERR:-none}"
        printf '%s\n' "$out" | head -40
      } > "$PGTAP_FLAKE_DIR/$(basename "$f").$(date +%s%N).out"
    fi
    return 3
  fi
  return 1
}

declare -A VERDICT RC
pending=()
for ((i = 0; i < N; i++)); do pending+=("$i"); done
attempt=0
while :; do
  attempt=$((attempt + 1))
  for i in "${pending[@]}"; do rm -f "$T/res/$i.out" "$T/res/$i.rc"; done
  batch "a$attempt" "${pending[@]}" || true
  next=()
  for i in "${pending[@]}"; do
    VERDICT[$i]=$(judge "$i"); RC[$i]=$?
    [ "${RC[$i]}" = 3 ] && next+=("$i")
  done
  { [ ${#next[@]} -eq 0 ] || [ "$attempt" -ge 4 ]; } && break
  for i in "${next[@]}"; do
    echo "RETRY ${FILES[$i]} (incomplete output, no assertion failed; try $attempt of 3) $(printf '%s\n' "${VERDICT[$i]}" | grep -m1 'psql_exit=' | sed 's/^ *//')" >&2
  done
  sleep 2
  pending=("${next[@]}")
done

fails=0
for ((i = 0; i < N; i++)); do
  printf '%s\n' "${VERDICT[$i]}"
  [ "${RC[$i]}" = 0 ] || fails=$((fails + 1))
done
echo "pgTAP: $((N - fails))/$N files passed"
[ "$fails" = 0 ]
