#!/usr/bin/env bash
# Story 19.8: a real two-session race between a refund of a session payment
# and consumption of that session (pgTAP runs one session, so it cannot).
# Needs the local Supabase stack. Commits fixtures under a throwaway gym and
# removes them on exit.
#
#   scripts/session-refund-race.sh [iterations]     (default 8)
#
# Per iteration, one member with one unused paid session:
#   * a refund (full amount) and private.consume_guest_session() start at the
#     same moment, behind a third session that holds the member lock;
#   * invariant after both commit: the session is voided XOR consumed, never
#     both, and exactly one of the two outcomes is reported.
# Fixed-order case: consumption wins (lock holder consumes first) -> the
# refund must report kept_consumed and leave the session consumed.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
N=${1:-8}
# Runs inside the DB container (the container has bash and psql); from the
# host the script re-executes itself there. RACE_DETACH=<log> runs it detached
# inside the container and leaves the transcript in <log> (inside the container).
if [ -z "${RACE_INSIDE:-}" ]; then
  if [ -n "${RACE_DETACH:-}" ]; then
    docker exec -i "$DB" sh -c "cat > /tmp/race.sh" < "$0"
    docker exec -d -e RACE_INSIDE=1 "$DB" sh -c "bash /tmp/race.sh $N > $RACE_DETACH 2>&1"
    echo "started; read $RACE_DETACH inside $DB"
    exit 0
  fi
  docker exec -i "$DB" sh -c "cat > /tmp/race.sh" < "$0"
  exec docker exec -e RACE_INSIDE=1 "$DB" bash /tmp/race.sh "$N"
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

G=00000000-0000-0000-0000-000000362f01
T=00000000-0000-0000-0000-000000362f00
OWNER_U=00000000-0000-0000-0000-000000362e00
PLAN=00000000-0000-0000-0000-000000362d00

cleanup() {
  psql_ <<SQL >/dev/null
delete from audit_log where gym_id = '$G';
delete from session_attempts where gym_id = '$G';
delete from refunds where gym_id = '$G';
delete from guest_sessions where gym_id = '$G';
delete from attendance_events where gym_id = '$G';
delete from front_desk_alerts where gym_id = '$G';
delete from payments where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from plans where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0000-000000362%';
delete from auth.users where id::text like '00000000-0000-0000-0000-000000362%';
delete from gyms where id = '$G';
delete from tiers where id = '$T';
SQL
}
trap cleanup EXIT
cleanup

psql_ <<SQL
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'Race Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee)
  values ('$G', 'Race Gym', '$T', 'active', true, 0);
insert into auth.users (id) values ('$OWNER_U');
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
  values ('$PLAN', '$G', 'Race PPS', 'pay_per_session', 5000, 'XAF', 'monthly', null);
SQL

fail=0
n_voided=0
n_consumed=0
for i in $(seq 1 "$N"); do
  hex=$(printf '%02x' "$i")
  U=00000000-0000-0000-0000-000000362a$hex
  M=00000000-0000-0000-0000-000000362b$hex
  P=00000000-0000-0000-0000-000000362c$hex
  psql_ <<SQL >/dev/null
insert into auth.users (id) values ('$U');
insert into members (id, gym_id, user_id, role, name, join_date) values ('$M', '$G', '$U', 'member', 'Race $i', current_date);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('$G', '$M', '$PLAN', 'active', current_date, null);
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values ('$P', '$G', '$M', 5000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (gym_id, member_id, payment_id, usable_until) values ('$G', '$M', '$P', now() + interval '5 days');
SQL
  # Lock holder: keeps the member lock for 2 s so both contenders queue.
  psql_ -c "begin; select 1 from members where id = '$M' for no key update; select pg_sleep(2); commit;" >/dev/null &
  pids=($!)
  sleep 0.5
  # Contender order alternates so both arrival orders are exercised.
  refund_sql="insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('$G', '$P', 5000, 'race', '$OWNER_U');"
  consume_sql="select outcome from private.consume_guest_session('$M', '$G', now());"
  if [ $((i % 2)) -eq 0 ]; then
    psql_ -c "$refund_sql" >/dev/null & pids+=($!); sleep 0.2
    psql_ -c "$consume_sql" >/dev/null & pids+=($!)
  else
    psql_ -c "$consume_sql" >/dev/null & pids+=($!); sleep 0.2
    psql_ -c "$refund_sql" >/dev/null & pids+=($!)
  fi
  for pid in "${pids[@]}"; do wait "$pid"; done
  row=$(psql_ -c "select (voided_at is not null)::int, (consumed_at is not null)::int from guest_sessions where payment_id = '$P'")
  outcome=$(psql_ -c "select metadata ->> 'outcome' from audit_log where action_type = 'session_refund_applied' and target_entity_id = '$M'")
  case "$row/$outcome" in
    1\|0/voided) n_voided=$((n_voided + 1)); echo "ok   iteration $i: $row $outcome" ;;
    0\|1/kept_consumed) n_consumed=$((n_consumed + 1)); echo "ok   iteration $i: $row $outcome" ;;
    *) echo "FAIL iteration $i: voided|consumed=$row outcome=$outcome"; fail=1 ;;
  esac
done

# Fixed order: consumption first (it holds the lock), refund second.
psql_ <<SQL >/dev/null
insert into auth.users (id) values ('00000000-0000-0000-0000-000000362aff');
insert into members (id, gym_id, user_id, role, name, join_date) values ('00000000-0000-0000-0000-000000362bff', '$G', '00000000-0000-0000-0000-000000362aff', 'member', 'Race fixed', current_date);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('$G', '00000000-0000-0000-0000-000000362bff', '$PLAN', 'active', current_date, null);
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-000000362cff', '$G', '00000000-0000-0000-0000-000000362bff', 5000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (gym_id, member_id, payment_id, usable_until) values ('$G', '00000000-0000-0000-0000-000000362bff', '00000000-0000-0000-0000-000000362cff', now() + interval '5 days');
SQL
psql_ -c "begin; select outcome from private.consume_guest_session('00000000-0000-0000-0000-000000362bff', '$G', now()); select pg_sleep(2); commit;" >/dev/null &
holder=$!
sleep 0.5
psql_ -c "insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('$G', '00000000-0000-0000-0000-000000362cff', 5000, 'race', '$OWNER_U');" >/dev/null
wait "$holder"
res=$(psql_ -c "select (s.voided_at is null and s.consumed_at is not null)::text || '/' || (select metadata ->> 'outcome' from audit_log where action_type = 'session_refund_applied' and target_entity_id = '00000000-0000-0000-0000-000000362bff') from guest_sessions s where s.payment_id = '00000000-0000-0000-0000-000000362cff'")
if [ "$res" = "true/kept_consumed" ]; then echo "ok   fixed order: consume then refund -> $res"; else echo "FAIL fixed order: $res"; fail=1; fi

# Both outcomes must have occurred, else the consumer never ran (or never won)
# and the loop proved nothing about the race.
if [ "$n_voided" -lt 1 ] || [ "$n_consumed" -lt 1 ]; then
  echo "FAIL: expected both outcomes, got voided=$n_voided kept_consumed=$n_consumed"; fail=1
fi

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
