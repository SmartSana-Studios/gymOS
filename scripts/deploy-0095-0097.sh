#!/usr/bin/env bash
# Apply migrations 0095-0097 (Epic 17) to the deployed project, in order, via
# host psql. Same shape as deploy-0090-0094.sh.
#
# Deliberately NOT `supabase db push`: in this devcontainer the Supabase CLI's
# container commands can fail silently and still exit 0
# (project_docker_no_network).
#
# Safety properties:
#   * each migration runs inside its own transaction with ON_ERROR_STOP -- a
#     failure rolls that migration back entirely rather than half-applying it;
#   * the version row is inserted in the SAME transaction, so the ledger can
#     never claim a migration that did not commit;
#   * the loop stops at the first failure;
#   * every migration also self-asserts in its own trailing DO block.
#
# All three are additive: 0095 and 0097 add SECURITY INVOKER functions, 0096
# adds two SECURITY DEFINER reads. No policy, table or row is changed.
# Order matters: 0097's gym_local_period_bounds() calls 0095's
# private.gym_local_month_bounds().
#
# Usage:  ./scripts/deploy-0095-0097.sh
set -euo pipefail

HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER_="postgres.vfxezibagiznrirdwkwh"
DB="postgres"

export PGPASSWORD="$(cat ~/.supabase-db-password)"
PROD=(psql -h "$HOST" -p "$PORT" -U "$USER_" -d "$DB" -v ON_ERROR_STOP=1 -q -X)

HEAD="$("${PROD[@]}" -tAc "select max(version) from supabase_migrations.schema_migrations;")"
echo "=== head BEFORE: $HEAD ==="
if [ "$HEAD" != "0094" ]; then
  echo "Expected head 0094, found $HEAD -- stopping without applying anything."
  exit 1
fi
echo

for F in supabase/migrations/009[567]_*.sql; do
  V="$(basename "$F" | cut -c1-4)"
  N="$(basename "$F" .sql | cut -c6-)"
  printf '%-5s %-34s ' "$V" "$N"

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
select version, name from supabase_migrations.schema_migrations order by version desc limit 4;

select p.oid::regprocedure as function,
       case when p.prosecdef then 'definer' else 'invoker' end as security,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (('private','gym_local_month_bounds'), ('public','gym_revenue_mtd'),
                                 ('public','list_my_classes'), ('public','list_my_class_session_roster'),
                                 ('private','gym_local_day_bounds'), ('public','gym_local_period_bounds'))
order by 1;

select 'functions present (expect 6)' as check, count(*)::text as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (('private','gym_local_month_bounds'), ('public','gym_revenue_mtd'),
                                 ('public','list_my_classes'), ('public','list_my_class_session_roster'),
                                 ('private','gym_local_day_bounds'), ('public','gym_local_period_bounds'))
union all
select 'guarded write-RPCs + 0096 reads (expect 23, was 21)',
       count(*)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc like '%current_gym_status() is distinct from ''active''%';
SQL
