#!/usr/bin/env bash
# Story 27.4 (NFR-021, AD-29): real two-session races between public.correct_subscription_plan and the paths that write a member's subscription
# or create a payment. pgTAP runs one session, so it can prove the lock order in the body (correct_subscription_plan.test.sql) but not that a second
# caller really waits or what it sees afterwards. Needs the local Supabase stack. Commits fixtures under a throwaway gym and removes them on exit.
#
#   scripts/correct-plan-race.sh        (the verdict is the LAST line of the transcript: "race: all passed" or "race: FAILED")
#
# Lock holders keep their transaction open for HOLD_S seconds (pg_sleep) so the second session is seen WAITING on a lock (pg_stat_activity).
#
# Case 1a/1b  complete_verified_payment (payment lock, then member lock). Correction first: the payment waits for the member lock and then renews
#             the CORRECTED plan; the correction is not overwritten. Payment first: the correction waits, then is refused (subscription_changed
#             with the id the modal showed, payment_stands without it) and the payment's extension is never overwritten.
# Case 2a/2b  confirm_renewal (member lock only), the same two orders.
# Case 3a/3b  the Tara initiation (initiate_member_payment takes NO lock): an in-flight payment already stands, so a correction after it is refused
#             (payment_stands, in_flight); an initiation after a committed correction reads the corrected plan's price.
# Case 4      run_subscription_lifecycle_job() blocked on the correction's row lock re-evaluates its predicate on the corrected values: a stale
#             'active' row the job would have expired stays as corrected.
# Case 4b/4c  renew_subscription (0176 gives it the member lock; it had none). Correction first: the renewal waits and renews the CORRECTED
#             plan. Renewal first: the correction waits, then is refused subscription_changed with the modal's id, and without it corrects the
#             renewal row (renew_subscription records no payment, so nothing stands).
# Case 5      the gate is real: the same payment-first order against a copy of the function WITHOUT the standing-payment check overwrites the
#             payment's extension, and this script reports that as detected (the original body is restored on exit, whatever happens).
#
# Known window, not covered (recorded in docs/decisions.md): initiate_member_payment takes no lock, so an initiation that overlaps the
# correction's transaction reads the plan price from before the correction. The payment then completes on the corrected plan (case 1a).
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
# Runs inside the DB container (it has bash and psql); from the host the script re-executes itself there, detached and polled. In the
# foreground `docker exec` has ended a script right after its first heredoc with exit 0 (Epic 20 retro R-1), so the verdict is the
# transcript's last line, never an exit code.
if [ -z "${RACE_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/ci-cp-race.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/ci-cp-race.out"
  docker exec -d -e RACE_INSIDE=1 "$DB" sh -c "bash /tmp/ci-cp-race.sh > /tmp/ci-cp-race.out 2>&1"
  for _ in $(seq 1 ${RACE_TIMEOUT_POLLS:-150}); do
    docker exec "$DB" sh -c "grep -q '^race:' /tmp/ci-cp-race.out 2>/dev/null" && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/ci-cp-race.out 2>/dev/null"
  docker exec "$DB" sh -c "grep -q '^race: all passed' /tmp/ci-cp-race.out 2>/dev/null"
  exit $?
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }
psqlq_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At "$@"; }   # keeps going and prints errors (the refusals are the point)

P=00000000-0000-0000-0000-00000027d
T=${P}000
G=${P}001
PLAN_M=${P}010   # Monthly, 30 days, 25 000
PLAN_A=${P}011   # Annual, 365 days, 250 000
OWNER_U=${P}200
OWNER_M=${P}300
HOLD_S=2   # seconds the lock holder keeps its locks
ORIG=/tmp/ci-cp-race-orig.sql
ORIG_RENEW=/tmp/ci-cp-race-orig-renew.sql
MUT=0
MUT_RENEW=0

restore_function() {
  [ -s "$ORIG" ] && PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -q -v ON_ERROR_STOP=1 -f "$ORIG" >/dev/null 2>&1
  restore_renew
}
restore_renew() {
  [ -s "$ORIG_RENEW" ] && PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -q -v ON_ERROR_STOP=1 -f "$ORIG_RENEW" >/dev/null 2>&1
}
cleanup() {
  [ "$MUT" = 1 ] && restore_function
  [ "$MUT_RENEW" = 1 ] && restore_renew
  psql_ <<SQL >/dev/null
delete from refunds where gym_id = '$G';
delete from notifications where gym_id = '$G';
delete from loyalty_events where gym_id = '$G';
delete from loyalty_progress where gym_id = '$G';
delete from audit_log where gym_id = '$G';
delete from payments where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from plans where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '${P}2%';
delete from auth.users where id::text like '${P}2%';
delete from gyms where id = '$G';
delete from tiers where id = '$T';
SQL
}
trap 'cleanup; rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$' EXIT
cleanup

psql_ <<SQL
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'CP Race Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, grace_period_days, registration_fee, charge_guests_per_session) values ('$G', 'CP Race Gym', '$T', 'active', 3, 0, false);
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, annual_discount_percent, duration_days) values
  ('$PLAN_M', '$G', 'Race Monthly', 'monthly', 25000,  'XAF', 'monthly', null, 30),
  ('$PLAN_A', '$G', 'Race Annual',  'monthly', 250000, 'XAF', 'annual',  0,    365);
insert into auth.users (id) values ('$OWNER_U');
insert into members (id, gym_id, user_id, role, name) values ('$OWNER_M', '$G', '$OWNER_U', 'owner', 'CP Race Owner');
SQL

fail=0
mid() { echo "${P}3$1"; }   # member id for case number <2 hex digits>
uid() { echo "${P}2$1"; }
pid() { echo "${P}4$1"; }
# mk <nn> <plan> <start offset days> <expiry offset days> <status>: a member with one subscription (created now), Annual by default
mk() {
  local n=$1 plan=$2 so=$3 eo=$4 st=$5
  psql_ <<SQL >/dev/null
insert into auth.users (id) values ('$(uid "$n")');
insert into members (id, gym_id, user_id, role, name, join_date) values ('$(mid "$n")', '$G', '$(uid "$n")', 'member', 'CP Race $n', current_date);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
values ('$G', '$(mid "$n")', '$plan', '$st', current_date + ($so), current_date + ($eo));
SQL
}
mkpay() { # mkpay <nn> <status>: an unlinked subscription payment of the member
  psql_ -c "insert into payments (id, gym_id, member_id, amount, currency, method, status, provider) values ('$(pid "$1")', '$G', '$(mid "$1")', 250000, 'XAF', 'mobile_money', '$2', 'taramoney')" >/dev/null
}
sub_of() { psql_ -c "select id from subscriptions where member_id = '$(mid "$1")' order by created_at desc, id desc limit 1"; }
sub_count() { psql_ -c "select count(*) from subscriptions where member_id = '$(mid "$1")'"; }
claims_owner() { echo "set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$OWNER_U\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"owner\"}', true);"; }
claims_member() { echo "set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$(uid "$1")\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"member\"}', true);"; }
correct_call() { # correct_call <nn> <plan> <sub-id or null>
  local sub=$3; [ "$sub" = null ] || sub="'$sub'"
  echo "select 'CORRECTED ' || plan_name || ' ' || coalesce(expiry_date::text, 'null') || ' ' || status from public.correct_subscription_plan('$(mid "$1")', '$2', 'Wrong plan chosen at sign-up', $sub);"
}
waiting() { # waiting <needle>: sessions waiting on a lock whose statement contains the needle
  psql_ -c "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%$1%' and query not like '%pg_stat_activity%'"
}
now_ms() { local t=${EPOCHREALTIME/./}; echo $((t / 1000)); }
check() { # check <label> <condition result 0/1> <detail>
  if [ "$2" = 0 ]; then echo "ok   $1 ($3)"; else echo "FAIL $1 ($3)"; fail=1; fi
}

# ---- case 1a: the correction holds the locks; complete_verified_payment must wait, then renews the CORRECTED plan -----------------------------
n=01
mk "$n" "$PLAN_A" -10 355 active
S0=$(sub_of "$n")
# the payment is created by the waiting session, after the correction has passed its standing-payment check (the correction ran first)
( psql_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$S0") select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
sleep 0.6
start=$(now_ms)
( psql_ -c "begin; insert into payments (id, gym_id, member_id, amount, currency, method, status, provider) values ('$(pid "$n")', '$G', '$(mid "$n")', 25000, 'XAF', 'mobile_money', 'processing', 'taramoney'); select complete_verified_payment('$(pid "$n")', 0); commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
sleep 0.8
w=$(waiting complete_verified_payment)
wait "$waiter"; wait "$holder"
elapsed=$(( $(now_ms) - start ))
rows=$(sub_count "$n")
new_sub=$(sub_of "$n")
res=$(psql_ -c "select s.plan_id = '$PLAN_M' and s.id <> '$S0' and s.start_date = (select private.gym_today('$G')) and p.subscription_id = s.id from subscriptions s, payments p where s.id = '$new_sub' and p.id = '$(pid "$n")'")
old=$(psql_ -c "select plan_id = '$PLAN_M' and expiry_date = start_date + 30 from subscriptions where id = '$S0'")
check "case 1a (correction first)" "$([ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$res" = t ] && [ "$old" = t ] && [ "$rows" = 2 ] && grep -q '^CORRECTED' /tmp/ci-cp-race-a.$$ && echo 0 || echo 1)" \
  "payment waited (waiting=$w, ${elapsed} ms), renewed the corrected plan (new row on Monthly linked to the payment: $res), the corrected row kept its expiry ($old), rows=$rows"
rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$

# ---- case 1b: the payment holds the locks; the correction waits, then is refused and the payment's extension survives ----------------------------
payment_first_case() { # payment_first_case <nn> <label> <pass the modal's id? yes|no> <expected code>
  local n=$1 label=$2 withid=$3 want=$4
  mk "$n" "$PLAN_A" -10 355 active
  local s0 sid
  s0=$(sub_of "$n")
  mkpay "$n" processing
  ( psql_ -c "begin; select complete_verified_payment('$(pid "$n")', 0); select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
  sleep 0.6
  sid=null; [ "$withid" = yes ] && sid=$s0
  local start; start=$(now_ms)
  ( psqlq_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$sid") commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
  sleep 0.8
  w=$(waiting correct_subscription_plan)
  wait "$waiter"; wait "$holder"
  local elapsed=$(( $(now_ms) - start ))
  local new_sub; new_sub=$(sub_of "$n")
  local intact; intact=$(psql_ -c "select s.plan_id = '$PLAN_A' and s.expiry_date = (select o.expiry_date from subscriptions o where o.id = '$s0') + 365 from subscriptions s where s.id = '$new_sub'")
  local old_intact; old_intact=$(psql_ -c "select plan_id = '$PLAN_A' and expiry_date = current_date + 355 from subscriptions where id = '$s0'")
  local got=0; grep -q "ERROR:  $want" /tmp/ci-cp-race-b.$$ || got=1
  check "$label" "$([ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$got" = 0 ] && [ "$intact" = t ] && [ "$old_intact" = t ] && [ "$(sub_count "$n")" = 2 ] && echo 0 || echo 1)" \
    "correction waited (waiting=$w, ${elapsed} ms) and was refused with $want ($([ "$got" = 0 ] && echo yes || echo NO: $(head -c 200 /tmp/ci-cp-race-b.$$))), the renewal's expiry is intact ($intact), the old row is intact ($old_intact)"
  rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$
}
payment_first_case 02 "case 1b (payment first, the modal's id)" yes subscription_changed
payment_first_case 03 "case 1b (payment first, no id)" no payment_stands

# ---- case 2: confirm_renewal (member lock) ------------------------------------------------------------------------------------------------------
n=04
mk "$n" "$PLAN_A" -10 355 active
S0=$(sub_of "$n")
( psql_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$S0") select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
sleep 0.6
start=$(now_ms)
( psql_ -c "begin; $(claims_owner) select 'RENEWED ' || new_expiry_date from confirm_renewal('$(mid "$n")', 'cash', 'renewal at the desk'); commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
sleep 0.8
w=$(waiting confirm_renewal)
wait "$waiter"; wait "$holder"
elapsed=$(( $(now_ms) - start ))
new_sub=$(sub_of "$n")
res=$(psql_ -c "select s.plan_id = '$PLAN_M' and s.id <> '$S0' from subscriptions s where s.id = '$new_sub'")
old=$(psql_ -c "select plan_id = '$PLAN_M' and expiry_date = start_date + 30 from subscriptions where id = '$S0'")
check "case 2a (correction first)" "$([ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$res" = t ] && [ "$old" = t ] && grep -q '^RENEWED' /tmp/ci-cp-race-b.$$ && echo 0 || echo 1)" \
  "confirm_renewal waited (waiting=$w, ${elapsed} ms) and renewed the corrected plan ($res); the corrected row kept its expiry ($old)"
rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$

renewal_first_case() { # renewal_first_case <nn> <label> <yes|no> <code>
  local n=$1 label=$2 withid=$3 want=$4 s0 sid
  mk "$n" "$PLAN_A" -10 355 active
  s0=$(sub_of "$n")
  ( psql_ -c "begin; $(claims_owner) select 'RENEWED ' || new_expiry_date from confirm_renewal('$(mid "$n")', 'cash', 'renewal at the desk'); select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
  sleep 0.6
  sid=null; [ "$withid" = yes ] && sid=$s0
  local start; start=$(now_ms)
  ( psqlq_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$sid") commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
  sleep 0.8
  w=$(waiting correct_subscription_plan)
  wait "$waiter"; wait "$holder"
  local elapsed=$(( $(now_ms) - start ))
  local new_sub; new_sub=$(sub_of "$n")
  local intact; intact=$(psql_ -c "select s.plan_id = '$PLAN_A' and s.expiry_date = (select o.expiry_date from subscriptions o where o.id = '$s0') + 365 from subscriptions s where s.id = '$new_sub'")
  local got=0; grep -q "ERROR:  $want" /tmp/ci-cp-race-b.$$ || got=1
  check "$label" "$([ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$got" = 0 ] && [ "$intact" = t ] && echo 0 || echo 1)" \
    "correction waited (waiting=$w, ${elapsed} ms) and was refused with $want ($([ "$got" = 0 ] && echo yes || echo NO: $(head -c 200 /tmp/ci-cp-race-b.$$))); the renewal's expiry is intact ($intact)"
  rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$
}
renewal_first_case 05 "case 2b (renewal first, the modal's id)" yes subscription_changed
renewal_first_case 06 "case 2b (renewal first, no id)" no payment_stands

# ---- case 3: the Tara initiation (no lock of its own) -------------------------------------------------------------------------------------------
n=07   # expired Annual; the member initiates a renewal payment first, then the staff member tries to correct
mk "$n" "$PLAN_A" -400 -35 expired
out=$(psqlq_ -c "begin; $(claims_member "$n") select 'INITIATED ' || initiate_member_payment(); commit;" 2>&1)
init_ok=$(echo "$out" | grep -c '^INITIATED ')
out=$(psqlq_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" null) commit;" 2>&1)
check "case 3a (initiation first)" "$([ "$init_ok" = 1 ] && [[ "$out" == *'ERROR:  payment_stands'* ]] && [[ "$out" == *'"state": "in_flight"'* ]] && echo 0 || echo 1)" \
  "the in-flight payment stands: initiated=$init_ok, correction refused: $(echo "$out" | grep -o 'ERROR:  [a-z_]*' | head -1)"
n=08   # expired Annual, no payment: the correction commits first, then the initiation reads the corrected plan's price (25 000, not 250 000)
mk "$n" "$PLAN_A" -400 -35 expired
S0=$(sub_of "$n")
out=$(psqlq_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$S0") commit;" 2>&1)
out2=$(psqlq_ -c "begin; $(claims_member "$n") select 'INITIATED ' || initiate_member_payment(); commit;" 2>&1)
amount=$(psql_ -c "select amount from payments where member_id = '$(mid "$n")'")
check "case 3b (correction first)" "$([[ "$out" == *CORRECTED* ]] && [[ "$out2" == *'INITIATED '* ]] && [ "$amount" = 25000 ] && echo 0 || echo 1)" \
  "the initiation charged the corrected plan's price: amount=$amount (want 25000)"

# ---- case 4: the lifecycle job blocked on the correction's row lock re-evaluates its predicate -----------------------------------------------------
n=09   # a stale 'active' row whose expiry is long past: the job would expire it. The correction (Annual, from start 60 days ago) makes it active until next year.
mk "$n" "$PLAN_M" -60 -30 active
S0=$(sub_of "$n")
( psql_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_A" "$S0") select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
sleep 0.6
start=$(now_ms)
( psql_ -c "select run_subscription_lifecycle_job();" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
sleep 0.8
w=$(waiting run_subscription_lifecycle_job)
wait "$waiter"; wait "$holder"
elapsed=$(( $(now_ms) - start ))
res=$(psql_ -c "select status::text || ' ' || (expiry_date = start_date + 365)::text from subscriptions where id = '$S0'")
check "case 4 (job blocked on the row lock)" "$([ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$res" = 'active true' ] && echo 0 || echo 1)" \
  "the job waited (waiting=$w, ${elapsed} ms) and, re-reading the corrected row, left it '$res' (without the lock semantics it would have set expired)"
rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$

# ---- case 4b: renew_subscription, correction first -----------------------------------------------------------------------------------------------
renew_correction_first() { # renew_correction_first <nn> -> sets RC_* : waiting count, elapsed, whether the new row is on the corrected plan, old row intact
  local n=$1 s0 start
  mk "$n" "$PLAN_A" -10 355 active
  s0=$(sub_of "$n")
  ( psql_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$s0") select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
  sleep 0.6
  start=$(now_ms)
  ( psql_ -c "begin; $(claims_owner) select 'RENEWED ' || renew_subscription('$(mid "$n")', 'desk renewal'); commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
  sleep 0.8
  RC_WAIT=$(waiting renew_subscription)
  wait "$waiter"; wait "$holder"
  RC_ELAPSED=$(( $(now_ms) - start ))
  RC_NEW=$(psql_ -c "select s.plan_id = '$PLAN_M' and s.id <> '$s0' from subscriptions s where s.id = '$(sub_of "$n")'")
  RC_OLD=$(psql_ -c "select plan_id = '$PLAN_M' and expiry_date = start_date + 30 from subscriptions where id = '$s0'")
  RC_ROWS=$(sub_count "$n")
  rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$
}
renew_correction_first 0b
check "case 4b (renew_subscription, correction first)" "$([ "${RC_WAIT:-0}" -ge 1 ] && [ "$RC_ELAPSED" -ge 1000 ] && [ "$RC_NEW" = t ] && [ "$RC_OLD" = t ] && [ "$RC_ROWS" = 2 ] && echo 0 || echo 1)" \
  "the renewal waited (waiting=$RC_WAIT, ${RC_ELAPSED} ms) and renewed the corrected plan ($RC_NEW); the corrected row kept its expiry ($RC_OLD); rows=$RC_ROWS"

# ---- case 4c: renew_subscription, renewal first ------------------------------------------------------------------------------------------------
renew_first_case() { # renew_first_case <nn> <label> <yes|no>
  local n=$1 label=$2 withid=$3 s0 sid start out
  mk "$n" "$PLAN_A" -10 355 active
  s0=$(sub_of "$n")
  ( psql_ -c "begin; $(claims_owner) select 'RENEWED ' || renew_subscription('$(mid "$n")', 'desk renewal'); select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
  sleep 0.6
  sid=null; [ "$withid" = yes ] && sid=$s0
  start=$(now_ms)
  ( psqlq_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" "$sid") commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
  sleep 0.8
  w=$(waiting correct_subscription_plan)
  wait "$waiter"; wait "$holder"
  local elapsed=$(( $(now_ms) - start ))
  local new_sub; new_sub=$(sub_of "$n")
  local old_intact; old_intact=$(psql_ -c "select plan_id = '$PLAN_A' and expiry_date = current_date + 355 from subscriptions where id = '$s0'")
  local ok=1 detail
  if [ "$withid" = yes ]; then
    local kept; kept=$(psql_ -c "select plan_id = '$PLAN_A' from subscriptions where id = '$new_sub'")
    grep -q "ERROR:  subscription_changed" /tmp/ci-cp-race-b.$$ && [ "$kept" = t ] && ok=0
    detail="refused subscription_changed, the renewal row stays on its plan ($kept)"
  else
    local corrected; corrected=$(psql_ -c "select plan_id = '$PLAN_M' and expiry_date = start_date + 30 from subscriptions where id = '$new_sub'")
    grep -q '^CORRECTED' /tmp/ci-cp-race-b.$$ && [ "$corrected" = t ] && ok=0
    detail="corrected the renewal row, the current one ($corrected)"
  fi
  check "$label" "$([ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$ok" = 0 ] && [ "$old_intact" = t ] && [ "$(sub_count "$n")" = 2 ] && echo 0 || echo 1)" \
    "correction waited (waiting=$w, ${elapsed} ms); $detail; the old row is intact ($old_intact)"
  rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$
}
renew_first_case 0c "case 4c (renewal first, the modal's id)" yes
renew_first_case 0d "case 4c (renewal first, no id)" no

# ---- case 5: the gate is real. A copy of the function WITHOUT the standing-payment check is shown overwriting the payment's extension -------------
psql_ -c "select pg_get_functiondef('public.correct_subscription_plan(uuid,uuid,text,uuid)'::regprocedure)" > "$ORIG"
if ! grep -q 'if v_stand_count > 0 then' "$ORIG"; then
  echo "FAIL case 5: the standing-payment branch was not found in the function body (the mutation below would be vacuous)"; fail=1
else
  MUT=1
  sed 's/if v_stand_count > 0 then/if false then/' "$ORIG" | PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -q -v ON_ERROR_STOP=1 >/dev/null
  n=0a
  mk "$n" "$PLAN_A" -10 355 active
  S0=$(sub_of "$n")
  mkpay "$n" processing
  ( psql_ -c "begin; select complete_verified_payment('$(pid "$n")', 0); select pg_sleep($HOLD_S); commit;" > /tmp/ci-cp-race-a.$$ 2>&1 ) & holder=$!
  sleep 0.6
  ( psqlq_ -c "begin; $(claims_owner) $(correct_call "$n" "$PLAN_M" null) commit;" > /tmp/ci-cp-race-b.$$ 2>&1 ) & waiter=$!
  wait "$waiter"; wait "$holder"
  new_sub=$(sub_of "$n")
  overwritten=$(psql_ -c "select s.plan_id = '$PLAN_M' from subscriptions s where s.id = '$new_sub'")
  restore_function; MUT=0
  restored=$(psql_ -c "select position('if v_stand_count > 0 then' in prosrc) > 0 from pg_proc where proname = 'correct_subscription_plan'")
  check "case 5 (known-bad body detected)" "$([ "$overwritten" = t ] && [ "$restored" = t ] && echo 0 || echo 1)" \
    "without the standing-payment check the correction overwrote the renewal's extension (detected=$overwritten); the real body is restored ($restored)"
  rm -f /tmp/ci-cp-race-a.$$ /tmp/ci-cp-race-b.$$
fi

# ---- case 6: the renew_subscription lock is real. The same correction-first order against a copy of the function WITHOUT the member lock --------
psql_ -c "select pg_get_functiondef('public.renew_subscription(uuid,text)'::regprocedure)" > "$ORIG_RENEW"
if ! grep -q 'for no key update' "$ORIG_RENEW"; then
  echo "FAIL case 6: the member lock was not found in renew_subscription (the mutation below would be vacuous)"; fail=1
else
  MUT_RENEW=1
  grep -v 'perform 1 from members where id = p_member_id and gym_id = v_caller_gym_id for no key update;' "$ORIG_RENEW" | PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -q -v ON_ERROR_STOP=1 >/dev/null
  renew_correction_first 0e
  restore_renew; MUT_RENEW=0
  restored=$(psql_ -c "select position('for no key update' in prosrc) > 0 from pg_proc where proname = 'renew_subscription'")
  # without the lock the renewal does not wait, reads the pre-correction plan and inserts a row on it: RC_NEW is false
  check "case 6 (known-bad renew_subscription detected)" "$([ "${RC_WAIT:-0}" = 0 ] && [ "$RC_NEW" = f ] && [ "$restored" = t ] && echo 0 || echo 1)" \
    "without the member lock the renewal did not wait (waiting=$RC_WAIT) and landed on the pre-correction plan (corrected-plan check=$RC_NEW); the real body is restored ($restored)"
fi

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
