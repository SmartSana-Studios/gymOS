#!/usr/bin/env bash
# Apply migrations 0090-0094 to the deployed project, in order, via host psql.
#
# Deliberately NOT `supabase db push`: in this devcontainer the Supabase CLI's
# container commands can fail silently and still exit 0, which is the one
# failure mode you cannot afford mid-deploy (project_docker_no_network).
#
# Safety properties:
#   * each migration runs inside its own transaction with ON_ERROR_STOP -- a
#     failure rolls that migration back entirely rather than half-applying it;
#   * the version row is inserted in the SAME transaction, so the ledger can
#     never claim a migration that did not commit;
#   * the loop stops at the first failure rather than ploughing on;
#   * every migration also self-asserts in its own trailing DO block.
#
# Run the read-only pre-flight first:
#   psql ... -f scripts/preflight-prod-deploy.sql
#
# Usage:  ./scripts/deploy-0090-0094.sh
set -euo pipefail

HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER_="postgres.vfxezibagiznrirdwkwh"
DB="postgres"

export PGPASSWORD="$(cat ~/.supabase-db-password)"
PROD=(psql -h "$HOST" -p "$PORT" -U "$USER_" -d "$DB" -v ON_ERROR_STOP=1 -q)

echo "=== head BEFORE ==="
"${PROD[@]}" -tAc "select version from supabase_migrations.schema_migrations order by version desc limit 1;"
echo

for F in supabase/migrations/009[01234]_*.sql; do
  V="$(basename "$F" | cut -c1-4)"
  N="$(basename "$F" .sql | cut -c6-)"
  printf '%-5s %-46s ' "$V" "$N"

  if "${PROD[@]}" <<SQL
begin;
\i $F
insert into supabase_migrations.schema_migrations (version, name) values ('$V', '$N');
commit;
SQL
  then
    echo "APPLIED"
  else
    echo "FAILED -- stopping. Nothing from this migration was committed."
    exit 1
  fi
done

echo
echo "=== VERIFICATION (do not trust the exit code alone) ==="
"${PROD[@]}" <<'SQL'
\pset pager off
select version from supabase_migrations.schema_migrations order by version desc limit 6;

select 'guarded write-RPCs (expect 21)' as check,
       count(*)::text as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosrc like '%current_gym_status() is distinct from ''active''%'
union all
select 'tables carrying tenant_active_gate (expect 21)',
       count(distinct tablename)::text
from pg_policies where schemaname='public' and policyname='tenant_active_gate'
union all
select 'policies granting manager w/o supervisor (expect 0)',
       count(*)::text
from pg_policies where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%manager%'
  and (coalesce(qual,'')||coalesce(with_check,'')) not ilike '%supervisor%'
union all
select 'staff/member separation trigger (expect 1)',
       count(*)::text
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where c.relname='members' and t.tgname='enforce_staff_member_phone_separation_trigger'
union all
select 'phone_has_staff_membership present (expect 1)',
       count(*)::text
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='phone_has_staff_membership';
SQL
