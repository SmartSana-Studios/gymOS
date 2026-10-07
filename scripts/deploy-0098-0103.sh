#!/usr/bin/env bash
# Apply migrations 0098-0103 to the deployed project, in order, via host psql:
#   0098 registration fee foundation   (backfills EVERY member as settled; fee defaults to 0)
#   0099 payment purpose + manual fee collection / waiver
#   0100 Tara Money fee collection
#   0101 void, refund block, revenue line
#   0102 receptionists create members + assign first plan     (optional: --with-receptionist)
#   0103 platform_metrics() excludes voided payments
#
# Same shape as deploy-0095-0097.sh. Deliberately NOT `supabase db push`
# (project_docker_no_network: the CLI's container commands fail silently).
#
# Safety properties:
#   * each migration runs in its own transaction with ON_ERROR_STOP; the ledger
#     row is inserted in the SAME transaction, so it can never claim a migration
#     that did not commit;
#   * the loop stops at the first failure; every migration also self-asserts in
#     its trailing DO block (0098 includes the backfill check);
#   * refuses to start unless the head is exactly 0097;
#   * with every gym's fee at 0 (the default) nothing visible changes.
#
# DO NOT deploy 0098 alone. A gym that sets a fee before 0099-0101 are live
# leaves every new member awaiting with no way to settle them.
# Ship the dashboard + mobile build that go with it right after (or before the
# first gym sets a fee): mobile 18.7 is only in a new TestFlight/Play build.
#
# Usage:
#   psql ... -f scripts/preflight-epic18-deploy.sql     # read-only, first
#   ./scripts/deploy-0098-0103.sh                       # 0098-0101 + 0103
#   ./scripts/deploy-0098-0103.sh --with-receptionist   # also 0102
set -euo pipefail

WITH_RECEPTIONIST=0
[ "${1:-}" = "--with-receptionist" ] && WITH_RECEPTIONIST=1

cd "$(dirname "$0")/.."
# psql runs inside the local Supabase DB container (no host psql in this
# devcontainer); see scripts/prod-db.sh for the connection settings.
# shellcheck source=scripts/prod-db.sh
. scripts/prod-db.sh
PROD=(prod_psql)

HEAD="$("${PROD[@]}" -tAc "select max(version) from supabase_migrations.schema_migrations;")"
echo "=== head BEFORE: $HEAD ==="
if [ "$HEAD" != "0097" ]; then
  echo "Expected head 0097, found $HEAD -- stopping without applying anything."
  exit 1
fi

MEMBERS_BEFORE="$("${PROD[@]}" -tAc "select count(*) from members;")"
PAYMENTS_BEFORE="$("${PROD[@]}" -tAc "select count(*) from payments;")"
echo "members: $MEMBERS_BEFORE   payments: $PAYMENTS_BEFORE"
echo

FILES=(0098_registration_fee_foundation 0099_registration_fee_collection 0100_registration_fee_tara_collection 0101_registration_fee_void_refund_revenue)
[ "$WITH_RECEPTIONIST" = "1" ] && FILES+=(0102_receptionist_create_members_assign_plans)
FILES+=(0103_platform_metrics_exclude_voided_fees)

for BASE in "${FILES[@]}"; do
  F="supabase/migrations/$BASE.sql"
  V="${BASE:0:4}"
  N="${BASE:5}"
  printf '%-5s %-44s ' "$V" "$N"

  # The file is streamed on stdin (\i would look for it inside the container).
  if {
    echo "begin;"
    cat "$F"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$V', '$N');"
    echo "commit;"
  } | "${PROD[@]}"
  then
    echo "APPLIED"
  else
    echo "FAILED -- stopping. Nothing from this migration was committed."
    exit 1
  fi
done

echo
echo "=== VERIFICATION (do not trust the exit code alone) ==="
echo "expected: members $MEMBERS_BEFORE, payments $PAYMENTS_BEFORE"
"${PROD[@]}" <<'SQL'
\pset pager off
select version, name from supabase_migrations.schema_migrations order by version desc limit 7;

select 'members unchanged / awaiting (expect awaiting = 0)' as check,
       count(*)::text || ' members, ' || count(*) filter (where registration_fee_settled_at is null and role = 'member') || ' awaiting' as value
from members
union all
select 'gyms with a fee above 0 (expect 0)', count(*)::text from gyms where registration_fee > 0
union all
select 'payments not purpose=subscription (expect 0)', count(*)::text from payments where purpose is distinct from 'subscription'
union all
select 'payments voided (expect 0)', count(*)::text from payments where voided_at is not null
union all
select 'new RPCs present (expect 5)', count(*)::text
from pg_proc where pronamespace = 'public'::regnamespace and proname in
  ('set_registration_fee','record_registration_fee','waive_registration_fee','initiate_registration_fee_payment','void_registration_fee_payment')
union all
select 'revenue fns present (expect 2)', count(*)::text
from pg_proc where pronamespace = 'public'::regnamespace and proname in ('gym_revenue_mtd','gym_registration_fee_revenue_mtd')
union all
select 'fee triggers present (expect 5)', count(*)::text
from pg_trigger where tgname in ('set_member_registration_fee_settled_at','protect_registration_fee_settled_at',
  'enforce_registration_fee_settled','protect_payment_purpose_and_void','block_fee_and_voided_refunds')
union all
select 'platform_metrics excludes voided (expect true)',
       (pg_get_functiondef('public.platform_metrics()'::regprocedure) like '%voided_at is null%')::text;

-- The fee RPCs must not be callable by anon/public.
select p.oid::regprocedure as function,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in
  ('set_registration_fee','record_registration_fee','waive_registration_fee','initiate_registration_fee_payment','void_registration_fee_payment')
order by 1;
SQL
echo
echo "NEXT: smoke-test in the dashboard with fee = 0 (nothing should look different), then"
echo "set a fee on ONE gym you control and walk collect / waive / void before telling gyms."
