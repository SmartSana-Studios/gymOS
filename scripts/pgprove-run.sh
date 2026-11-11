#!/usr/bin/env bash
# Run supabase/tests/*.test.sql with the REAL pg_prove, the parser CI uses (`supabase test db`), against the local Supabase Postgres.
# scripts/pgtap-run.sh is a plain-psql runner with its own TAP counting; on PR #122 it passed files that CI's pg_prove rejected (unnumbered
# `ok` lines), so the epic's first CI run failed (Epic 24 retro, lesson 1). This script closes that gap.
#
#   scripts/pgprove-run.sh [files...]      (default: every supabase/tests/*.test.sql)
#   PGPROVE_IMAGE=public.ecr.aws/supabase/pg_prove:3.36 scripts/pgprove-run.sh
#
# The image is used from the local Docker cache (no pull). Files are copied into a throwaway container with `docker cp`, never a bind
# mount (bind mounts from this devcontainer are empty on the host daemon). The container shares the database container's network, so the
# server is 127.0.0.1. Files run one after the other, as CI does. Exit status is pg_prove's (2 when the machinery itself cannot run).
# pg_prove prints a final `Result: PASS|FAIL`; the exit code alone is not trusted, so a run without a Result line is treated as broken.
set -uo pipefail
cd "$(dirname "$0")/.."
DB_CONTAINER=${DB_CONTAINER:-supabase_db_gym_os}
IMAGE=${PGPROVE_IMAGE:-public.ecr.aws/supabase/pg_prove:3.36}

FILES=("$@")
[ ${#FILES[@]} -gt 0 ] || FILES=(supabase/tests/*.test.sql)

docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "pg_prove image $IMAGE is not in the local Docker cache (this script does not pull)" >&2; exit 2; }
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" || { echo "database container $DB_CONTAINER is not running" >&2; exit 2; }

# A freshly reset database has no pgTAP; `supabase test db` creates it itself.
docker exec -e PGPASSWORD=postgres "$DB_CONTAINER" psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 \
  -c "create extension if not exists pgtap with schema extensions" >/dev/null </dev/null || { echo "could not create pgtap in $DB_CONTAINER" >&2; exit 2; }

STAGE=$(mktemp -d)
CID=""
cleanup() { rm -rf "$STAGE"; [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1; }
trap cleanup EXIT

ARGS=()
for f in "${FILES[@]}"; do
  cp "$f" "$STAGE/$(basename "$f")" || { echo "cannot read $f" >&2; exit 2; }
  ARGS+=("/t/$(basename "$f")")
done

CID=$(docker create --network "container:$DB_CONTAINER" -e PGPASSWORD=postgres --entrypoint pg_prove "$IMAGE" \
  --ext .sql -h 127.0.0.1 -p 5432 -d postgres -U postgres "${ARGS[@]}") || { echo "docker create failed" >&2; exit 2; }
docker cp "$STAGE/." "$CID:/t" >/dev/null || { echo "docker cp failed" >&2; exit 2; }
# An attached `docker start -a` loses its output in this devcontainer (exit 0, nothing printed), so start detached, wait for the exit
# code and read the logs, the same lesson as scripts/pgtap-run.sh.
docker start "$CID" >/dev/null || { echo "docker start failed" >&2; exit 2; }
RC=$(docker wait "$CID") || { echo "docker wait failed" >&2; exit 2; }
OUT=$(docker logs "$CID" 2>&1)
printf '%s\n' "$OUT"
[[ "$RC" =~ ^[0-9]+$ ]] || { echo "no exit code from the pg_prove container" >&2; exit 2; }
printf '%s\n' "$OUT" | grep -qE '^Result: (PASS|FAIL)$' || { echo "pg_prove printed no Result line: the run is not trusted" >&2; exit 2; }
exit "$RC"
