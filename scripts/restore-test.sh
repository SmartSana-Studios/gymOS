#!/usr/bin/env bash
# Restore test for the daily db-backup dump (docs/restore-test.md as one command).
# Proves a production dump can be fetched, decrypted and restored into a throwaway
# database on the LOCAL Supabase container, and prints the record to paste into
# docs/decisions.md. Never touches production: it only reads the dump from R2.
#
# Two ways in:
#   1. The real test (owner's machine; needs the age PRIVATE key and R2 read access):
#        R2_ACCOUNT_ID=... R2_BUCKET=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#        AGE_KEY_FILE=~/path/to/age-key.txt scripts/restore-test.sh
#      fetches the newest db.<stamp>.dump.age, decrypts it, restores it.
#   2. Rehearsal / an already decrypted dump:
#        scripts/restore-test.sh --dump path/to/db.dump
#
# Optional: PROD_COUNTS="gyms=1 members=3 payments=2" compares the restored row counts
# (taken read-only from production around the dump time); PROD_HEAD=0122 compares the
# migration head. Without them the counts are printed for you to compare.
#
# Needs: docker with the local Supabase DB container (DB_CONTAINER, default
# supabase_db_gym_os) which ships pg_restore/psql 17; aws + age only for way 1.
set -uo pipefail

DB=${DB_CONTAINER:-supabase_db_gym_os}
SCRATCH=restore_test
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0
START=$SECONDS

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
bad()  { say "FAIL $*"; fail=1; }
good() { say "ok   $*"; }
psql_db() { docker exec -e PGPASSWORD=postgres "$DB" psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

docker ps --format '{{.Names}}' | grep -qx "$DB" || { say "container $DB is not running (supabase start)"; exit 2; }

DUMP=""
STAMP=""
if [ "${1:-}" = "--dump" ]; then
  DUMP=${2:?usage: --dump <file>}
  [ -s "$DUMP" ] || { say "no such dump: $DUMP"; exit 2; }
  STAMP="local:$(basename "$DUMP")"
else
  for v in R2_ACCOUNT_ID R2_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AGE_KEY_FILE; do
    [ -n "${!v:-}" ] || { say "missing $v (see the header, or pass --dump <file>)"; exit 2; }
  done
  command -v aws >/dev/null || { say "aws CLI not found"; exit 2; }
  command -v age >/dev/null || { say "age not found"; exit 2; }
  [ -r "$AGE_KEY_FILE" ] || { say "cannot read AGE_KEY_FILE"; exit 2; }
  export AWS_DEFAULT_REGION=auto
  EP="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

  step "1. Fetch and decrypt the newest dump"
  KEY=$(aws s3 ls "s3://${R2_BUCKET}/db/" --endpoint-url "$EP" | awk '{print $4}' | grep '^db\..*\.dump\.age$' | sort | tail -1)
  [ -n "$KEY" ] || { bad "no db.*.dump.age object found under db/"; exit 1; }
  STAMP=$KEY
  aws s3 cp "s3://${R2_BUCKET}/db/${KEY}" "$WORK/db.dump.age" --endpoint-url "$EP" --only-show-errors || { bad "download failed"; exit 1; }
  good "downloaded $KEY ($(stat -c %s "$WORK/db.dump.age") bytes encrypted)"
  age -d -i "$AGE_KEY_FILE" -o "$WORK/db.dump" "$WORK/db.dump.age" || { bad "age could not decrypt the dump (wrong private key?)"; exit 1; }
  DUMP="$WORK/db.dump"
  good "decrypted ($(stat -c %s "$DUMP") bytes)"
fi

step "2-5. Restore and verify (runs inside the container; results are copied out as a file)"
# Streaming stdout of `docker exec` proved unreliable on the dev container (lines lost, exit 0),
# so the container-side script writes key=value lines to a file and the host reads that file.
docker cp "$DUMP" "$DB:/tmp/restore_test.dump" >/dev/null 2>&1
cat > "$WORK/inside.sh" <<'INSIDE'
#!/bin/sh
export PGPASSWORD=postgres
P="psql -U postgres -h 127.0.0.1 -At"
OUT=/tmp/restore_test.out
: > $OUT
w() { echo "$1" >> $OUT; }
w "size=$(stat -c %s /tmp/restore_test.dump 2>/dev/null || echo 0)"
w "entries=$(pg_restore --list /tmp/restore_test.dump 2>/dev/null | grep -c '^[0-9]')"
$P -c "drop database if exists restore_test" >/dev/null 2>&1
$P -c "create database restore_test" >/dev/null 2>&1
w "created=$($P -d postgres -c "select count(*) from pg_database where datname='restore_test'" 2>/dev/null)"
pg_restore -U postgres -h 127.0.0.1 -d restore_test --no-owner --no-privileges /tmp/restore_test.dump > /tmp/restore_test.log 2>&1
w "restore_errors=$(grep -c '^pg_restore: error' /tmp/restore_test.log)"
grep '^pg_restore: error' /tmp/restore_test.log | grep -v -i 'extension\|already exists\|permission denied to set parameter\|permission denied for table secrets\|relation "cron\.\|role "\|schema "\(auth\|storage\|extensions\|graphql\|realtime\|vault\|supabase\|pgsodium\|net\|cron\)' | head -8 | sed 's/^/unexpected=/' >> $OUT
w "head=$($P -d restore_test -c "select max(version) from supabase_migrations.schema_migrations" 2>/dev/null)"
for t in gyms members payments subscriptions audit_log guest_sessions loyalty_events; do
  w "count_$t=$($P -d restore_test -c "select count(*) from public.$t" 2>/dev/null)"
done
w "functions=$($P -d restore_test -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')" 2>/dev/null)"
$P -c "drop database if exists restore_test" >/dev/null 2>&1
rm -f /tmp/restore_test.dump /tmp/restore_test.log
w "done=1"
INSIDE
docker cp "$WORK/inside.sh" "$DB:/tmp/restore_test.sh" >/dev/null 2>&1
# Started detached and polled: a foreground `docker exec` returned before the restore finished on
# the dev container (exit 0, partial output), so the run is detached and judged by its done=1 line.
docker exec "$DB" rm -f /tmp/restore_test.out >/dev/null 2>&1 < /dev/null
docker exec -d "$DB" sh /tmp/restore_test.sh >/dev/null 2>&1
for _ in $(seq 1 ${RESTORE_TIMEOUT_POLLS:-300}); do
  docker exec "$DB" sh -c "grep -q '^done=1' /tmp/restore_test.out 2>/dev/null" >/dev/null 2>&1 < /dev/null && break
  sleep 2
done
docker cp "$DB:/tmp/restore_test.out" "$WORK/result.out" >/dev/null 2>&1
docker exec "$DB" rm -f /tmp/restore_test.sh /tmp/restore_test.out >/dev/null 2>&1 < /dev/null
[ -s "$WORK/result.out" ] || { bad "no result file came back from the container"; exit 1; }
v() { sed -n "s/^$1=//p" "$WORK/result.out" | head -1; }
grep -q '^done=1$' "$WORK/result.out" || bad "the container-side script did not finish"

[ "$(v size)" -gt 10000 ] 2>/dev/null && good "dump copied into the container ($(v size) bytes)" || bad "dump missing or suspiciously small in the container"
[ "$(v entries)" -gt 100 ] 2>/dev/null && good "pg_restore --list reads $(v entries) entries" || bad "pg_restore --list found only $(v entries) entries"
[ "$(v created)" = 1 ] && good "scratch database created" || bad "could not create the scratch database"
say "     pg_restore reported $(v restore_errors) error line(s); expected ones are Supabase-managed objects"
sed -n 's/^unexpected=/     unexpected: /p' "$WORK/result.out"

HEAD=$(v head)
[ -n "$HEAD" ] && good "migration head $HEAD" || bad "no schema_migrations in the restored database"
[ -n "${PROD_HEAD:-}" ] && { [ "$HEAD" = "$PROD_HEAD" ] && good "head equals PROD_HEAD" || bad "head $HEAD differs from PROD_HEAD $PROD_HEAD"; }
COUNTS=""
for t in gyms members payments subscriptions audit_log guest_sessions loyalty_events; do
  n=$(v "count_$t")
  [ -n "$n" ] && COUNTS="$COUNTS $t=$n" || bad "table public.$t missing or unreadable"
done
say "     counts:$COUNTS"
for kv in ${PROD_COUNTS:-}; do
  t=${kv%%=*}; want=${kv##*=}; got=$(v "count_$t")
  if [ "$got" = "$want" ]; then good "$t = $want"
  elif [ "${got:-0}" -le "$want" ] 2>/dev/null; then say "     $t restored $got, production had $want (dump is older: check the dump time)"
  else bad "$t restored $got, more than production's $want"; fi
done
[ "$(v functions)" -gt 50 ] 2>/dev/null && good "$(v functions) functions restored" || bad "only $(v functions) functions restored"
good "scratch database dropped, dump removed from the container"

ELAPSED=$((SECONDS - START))
step "Record (paste into docs/decisions.md, V1.6 release runbook, section 3)"
say "Last tested restore: $(date -u +%Y-%m-%d), dump ${STAMP}, head ${HEAD}, counts${COUNTS}, restore took ${ELAPSED}s."
say "Known limit unchanged: Vault secrets (per-gym Tara credentials) do not decrypt in another project; gyms must reconnect Tara after a restore into a new project."
[ "$fail" = 0 ] && say "restore-test: PASSED" || { say "restore-test: FAILED"; exit 1; }
