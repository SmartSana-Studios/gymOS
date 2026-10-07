#!/usr/bin/env bash
# Backup to take BEFORE applying 0098-0103. Read-only against the database; writes
# only to a local directory OUTSIDE the repository (it contains member data).
#
#   ~/gymos-backups/<timestamp>/
#     tables.dump     pg_dump -Fc of the tables the migrations rewrite or add to
#     functions.sql   current definitions of every function the migrations REPLACE
#                     (paste back to roll those bodies back)
#     policies.sql    current definitions of the RLS policies they ALTER
#     counts.txt      row counts to compare after the deploy
#
# Usage: ./scripts/backup-before-epic18.sh      (needs ~/.supabase-db-password)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/prod-db.sh
. scripts/prod-db.sh

OUT="${BACKUP_DIR:-$HOME/gymos-backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
chmod 700 "$OUT"
echo "target: $PROD_USER@$PROD_HOST:$PROD_PORT/$PROD_DB  ->  $OUT"

# 0098 rewrites every members row (backfill) and alters gyms; 0099/0101 alter
# payments/refunds; the rest read them.
prod_pg_dump -Fc --no-owner \
  -t public.gyms -t public.members -t public.payments -t public.subscriptions -t public.refunds \
  > "$OUT/tables.dump"

prod_psql -tA > "$OUT/functions.sql" <<'SQL'
select '-- ' || p.oid::regprocedure || E'\n' || pg_get_functiondef(p.oid) || E';\n'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('public','complete_verified_payment'), ('public','gym_revenue_mtd'), ('public','platform_metrics'),
  ('private','protect_super_admin_only_gym_columns'))
order by 1;
SQL

prod_psql -tA > "$OUT/policies.sql" <<'SQL'
select format('-- %I on %I.%I (%s)', policyname, schemaname, tablename, cmd) || E'\n' ||
       format('alter policy %I on %I.%I', policyname, schemaname, tablename) ||
       coalesce(E'\n  using (' || qual || ')', '') ||
       coalesce(E'\n  with check (' || with_check || ')', '') || E';\n'
from pg_policies
where policyname in ('gym_staff_insert_own_payments','manager_or_owner_insert_own_refunds',
                     'manager_or_owner_insert_own_members','manager_or_owner_insert_own_subscriptions')
order by tablename, policyname;
SQL

prod_psql -tA > "$OUT/counts.txt" <<'SQL'
select 'gyms ' || count(*) from gyms union all
select 'members ' || count(*) from members union all
select 'payments ' || count(*) from payments union all
select 'subscriptions ' || count(*) from subscriptions union all
select 'refunds ' || count(*) from refunds;
SQL

echo
ls -l "$OUT"
echo
cat "$OUT/counts.txt"
if [ ! -s "$OUT/tables.dump" ] || [ ! -s "$OUT/functions.sql" ] || [ ! -s "$OUT/policies.sql" ]; then
  echo "BACKUP INCOMPLETE -- an output file is empty" >&2
  exit 1
fi
echo "backup complete: $OUT"
