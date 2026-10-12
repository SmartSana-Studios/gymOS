#!/usr/bin/env bash
# Apply V1.6 stage 1 to the deployed project, in order, via host psql. Same shape as
# deploy-0098-0103.sh. Deliberately NOT `supabase db push` (project_docker_no_network).
#
#   1a   0106 flagged-payment reason, 0107 charge-guests setting + guest_sessions + plan rules,
#        0108 desk session payment, 0109 in-app Tara session payment      (head must be 0105)
#   1b   0110 front-desk alert kind refactor, NO behaviour change         (head must be 0109)
#
# 1b ships ALONE and runs in production >= 7 days before 0111 (docs/decisions.md, V1.6 release
# runbook, section 1). Nothing else from V1.6 lands in that window.
#
# Safety properties (as the Epic 18 script):
#   * each migration runs in its own transaction with ON_ERROR_STOP, and its ledger row is
#     inserted in the SAME transaction, so the ledger never claims a migration that did not commit;
#   * the loop stops at the first failure; every migration self-asserts in its trailing DO block;
#   * refuses to start unless the head is exactly the expected one;
#   * refuses to start without --backup-confirmed (the operator asserts the db-backup workflow
#     was triggered and finished green immediately before; it cannot be read from here).
#
# Usage:
#   psql ... -f scripts/preflight-v16-stage1.sql        # read-only, first; no STOP lines
#   ./scripts/deploy-0106-0110.sh 1a --backup-confirmed
#   ./scripts/deploy-0106-0110.sh 1b --backup-confirmed  # a day or more later, after watching 1a
# Rehearse first against a restored dump: PROD_HOST=localhost PROD_PORT=5432 PROD_USER=postgres \
#   PROD_PASSWORD_FILE=<file> ./scripts/deploy-0106-0110.sh 1a --backup-confirmed
set -euo pipefail

STAGE="${1:-}"
CONFIRM="${2:-}"
case "$STAGE" in 1a|1b) ;; *) echo "usage: $0 <1a|1b> --backup-confirmed" >&2; exit 2;; esac
if [ "$CONFIRM" != "--backup-confirmed" ]; then
  echo "Refusing to run: trigger the db-backup workflow, wait for green, then pass --backup-confirmed." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
# shellcheck source=scripts/prod-db.sh
. scripts/prod-db.sh
PROD=(prod_psql)

if [ "$STAGE" = "1a" ]; then
  EXPECT_HEAD="0105"
  FILES=(0106_flagged_payment_reason 0107_charge_guests_setting_session_record 0108_desk_session_payment 0109_in_app_tara_session_payment)
else
  EXPECT_HEAD="0109"
  FILES=(0110_front_desk_alert_kind)
fi

HEAD="$("${PROD[@]}" -tAc "select max(version) from supabase_migrations.schema_migrations;")"
echo "=== stage $STAGE: head BEFORE: $HEAD (expected $EXPECT_HEAD) ==="
if [ "$HEAD" != "$EXPECT_HEAD" ]; then
  echo "Expected head $EXPECT_HEAD, found $HEAD -- stopping without applying anything."
  exit 1
fi

COUNTS_SQL="select (select count(*) from members), (select count(*) from payments), (select count(*) from front_desk_alerts), (select count(*) from front_desk_alerts where dismissed_at is null);"
read -r MEMBERS_BEFORE PAYMENTS_BEFORE ALERTS_BEFORE ACTIVE_BEFORE < <("${PROD[@]}" -tAF' ' -c "$COUNTS_SQL")
echo "members: $MEMBERS_BEFORE   payments: $PAYMENTS_BEFORE   alerts: $ALERTS_BEFORE (active $ACTIVE_BEFORE)"
echo

for BASE in "${FILES[@]}"; do
  F="supabase/migrations/$BASE.sql"
  V="${BASE:0:4}"
  N="${BASE:5}"
  printf '%-5s %-46s ' "$V" "$N"
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
echo "expected: members $MEMBERS_BEFORE, payments $PAYMENTS_BEFORE, alerts $ALERTS_BEFORE (active $ACTIVE_BEFORE)"
"${PROD[@]}" <<'SQL'
\pset pager off
select version, name from supabase_migrations.schema_migrations order by version desc limit 6;
select 'members / payments / alerts / active alerts' as check,
       (select count(*) from members) || ' / ' || (select count(*) from payments) || ' / ' ||
       (select count(*) from front_desk_alerts) || ' / ' || (select count(*) from front_desk_alerts where dismissed_at is null) as value;
select 'gyms with charging on (expect 0)' as check, count(*)::text as value
  from gyms where to_jsonb(gyms) ? 'charge_guests_per_session' and (to_jsonb(gyms)->>'charge_guests_per_session')::boolean;
select 'V1.6 RPCs present (1a: expect 5)' as check, count(*)::text as value
  from pg_proc where pronamespace='public'::regnamespace and proname in
  ('record_session_payment','initiate_session_payment','set_guest_charging','guest_charging_impact','update_plan_pricing');
select 'alert kinds (1b: expect only subscription_status)' as check,
       coalesce((select string_agg(distinct kind, ',') from front_desk_alerts where to_jsonb(front_desk_alerts) ? 'kind'), 'n/a (kind not added yet)') as value;
select 'one-active index (1b: expect idx_..._kind_status)' as check,
       coalesce((select string_agg(indexname, ',') from pg_indexes where tablename='front_desk_alerts' and indexname like 'idx_front_desk_alerts_one_active%'), 'none') as value;
-- New RPCs must not be callable by anon/public.
select p.oid::regprocedure as function,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in
  ('record_session_payment','initiate_session_payment','set_guest_charging','guest_charging_impact','update_plan_pricing','check_in')
order by 1;
SQL
echo
if [ "$STAGE" = "1a" ]; then
  echo "NEXT: deploy the payment-webhook edge function that dispatches purpose 'session' (docs/decisions.md"
  echo "runbook section 1, row 0109), smoke-test a subscription payment end to end, watch job_runs, then 1b."
else
  echo "NEXT: 0110 is live. The 7-day soak starts now: confirm front-desk alerts still raise, dismiss and"
  echo "auto-dismiss on a real gym. Do NOT apply 0111 or later before $(date -u -d '+7 days' +%F)."
fi
