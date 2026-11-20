#!/usr/bin/env bash
# Story 29.1 (FR-244, FR-245; spine AD-21): real two-connection races around private.apply_class_slots. pgTAP runs one session, so it can assert
# the sequential rules (class_schedule_slots*.test.sql) but not the interleaving. Needs the local Supabase stack. Commits fixtures under a
# throwaway gym and removes them on exit.
#
#   scripts/class-slot-race.sh        (the verdict is the LAST line of the transcript: "race: all passed" or "race: FAILED")
#   CLASS_SLOT_RACE_BROKEN=1 scripts/class-slot-race.sh
#       installs a deliberately broken regeneration function (no session lock, the booking check made before a pause and the delete after it)
#       and runs the same cases against it: the verdict MUST be "race: FAILED". Proof that the cases can fail. Not part of ci-local.sh.
#       The broken function covers case 1 only. Cases 2 and 3 were shown to fail by hand (2026-11-20 review): with the class-row FOR UPDATE
#       removed from private.class_schedule_slots_cap, case 2 ends with 15 slots and no refusal; with `for key share of c` removed from
#       private.materialize_sessions_for_class, case 3 leaves a session at the removed weekday. Redo that if either function is edited.
#
# Case 1 (book_class_session vs apply_class_slots on one unbooked session that matches no slot; CLASS_SLOT_RACE_ITERATIONS, default 50,
#   a third apply first, a third book first, a third started together). Valid outcomes are exactly two. Either the booking is made, the session is
#   kept and listed as left unchanged; or the session is deleted and the booking attempt gets "session ... not found". Never: a deadlock, a
#   foreign-key error to the editor, an orphaned booking, both outcomes at once, or an error from the edit.
# Case 2 (two inserts of the 14th and the 15th slot of one class, the second queued behind the first): exactly one succeeds, the other is
#   refused "a class can have at most 14 weekly times", the class ends with 14 slots.
# Case 3 (a materializer run queued behind a slot edit that removes a weekday): the run reads the NEW slots; no session is generated for the
#   removed weekday after the edit committed.
# Case 4 (Story 29.2: book_class_session vs cancel_class on one session, apply first / book first / together). Valid outcomes are exactly two.
#   Either the booking was made first: cancel_class counts it (bookings_cancelled 1), flags the session and leaves the booking on record. Or the
#   cancel won: the booking attempt is refused "session ... is cancelled", the count is 0 and no booking exists. Never: a deadlock, a booking the
#   count missed, an unflagged session, or an error from the cancel.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
N=${CLASS_SLOT_RACE_ITERATIONS:-50}
BROKEN=${CLASS_SLOT_RACE_BROKEN:-}
# Runs inside the DB container (it has bash and psql); from the host the script re-executes itself there, detached and polled. In the
# foreground `docker exec` has ended a script right after its first heredoc with exit 0 (Epic 20 retro R-1), so the verdict is the
# transcript's last line, never an exit code.
if [ -z "${RACE_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/cs-race.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/cs-race.out"
  docker exec -d -e RACE_INSIDE=1 -e CLASS_SLOT_RACE_ITERATIONS="$N" -e CLASS_SLOT_RACE_BROKEN="$BROKEN" "$DB" sh -c "bash /tmp/cs-race.sh > /tmp/cs-race.out 2>&1"
  for _ in $(seq 1 ${RACE_TIMEOUT_POLLS:-150}); do
    [ "$(docker exec "$DB" sh -c "grep -c '^race:' /tmp/cs-race.out 2>/dev/null || true" | tr -d "[:space:]")" = 1 ] && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/cs-race.out 2>/dev/null"
  [ "$(docker exec "$DB" sh -c "grep -c '^race: all passed' /tmp/cs-race.out 2>/dev/null || true" | tr -d "[:space:]")" = 1 ]
  exit $?
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

T=00000000-0000-0000-0000-00000029f000
G=00000000-0000-0000-0000-00000029f001
PLAN=00000000-0000-0000-0000-00000029f010
COACH_U=00000000-0000-0000-0000-00000029f2a2
COACH_M=00000000-0000-0000-0000-00000029f3a2
MEMBER_U=00000000-0000-0000-0000-00000029f2b1
MEMBER_M=00000000-0000-0000-0000-00000029f3b1
MANAGER_U=00000000-0000-0000-0000-00000029f2c1
MANAGER_M=00000000-0000-0000-0000-00000029f3c1
HOLD_S=0.5   # seconds the first connection keeps its transaction (and its locks) open
GAP_S=0.25   # seconds before the second connection starts

FN=private.apply_class_slots
[ -n "$BROKEN" ] && FN=private.zz_apply_class_slots_broken

cleanup() {
  psql_ <<SQL >/dev/null
delete from class_bookings where gym_id = '$G';
delete from class_sessions where gym_id = '$G';
delete from classes where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from plans where gym_id = '$G';
delete from members where gym_id = '$G';
delete from audit_log where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0000-00000029f2%';
delete from auth.users where id::text like '00000000-0000-0000-0000-00000029f2%';
delete from gyms where id = '$G';
delete from tiers where id = '$T';
drop function if exists private.zz_apply_class_slots_broken(uuid, jsonb);
SQL
}
trap 'cleanup; rm -f /tmp/cs-race-a.$$ /tmp/cs-race-b.$$' EXIT
cleanup

psql_ <<SQL
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'Slot Race Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status) values ('$G', 'Slot Race Gym', '$T', 'active');
insert into auth.users (id) values ('$COACH_U'), ('$MEMBER_U'), ('$MANAGER_U');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('$COACH_M', '$G', '$COACH_U', 'coach', 'Slot Race Coach', current_date),
  ('$MEMBER_M', '$G', '$MEMBER_U', 'member', 'Slot Race Member', current_date),
  ('$MANAGER_M', '$G', '$MANAGER_U', 'manager', 'Slot Race Manager', current_date);
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
  values ('$PLAN', '$G', 'Slot Race Plan', 'pay_per_session', 2000, 'XAF', 'monthly', null);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('$G', '$MEMBER_M', '$PLAN', 'active', current_date, null);
SQL

if [ -n "$BROKEN" ]; then
  psql_ <<'SQL'
-- A deliberately wrong regeneration: the class is locked but the sessions are not, and the booking check is made before a pause that stands for
-- the work between the check and the delete.
create function private.zz_apply_class_slots_broken(p_class_id uuid, p_slots jsonb)
returns table (class_session_id uuid, scheduled_at timestamptz, booked_count integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record; n integer;
begin
  perform 1 from classes where id = p_class_id for update;
  for r in select cs.id, cs.scheduled_at from class_sessions cs where cs.class_id = p_class_id and cs.scheduled_at > now() order by cs.scheduled_at loop
    select count(*) into n from class_bookings cb where cb.class_session_id = r.id;
    perform pg_sleep(0.5);
    if n = 0 then
      delete from class_sessions where id = r.id;
    else
      class_session_id := r.id; scheduled_at := r.scheduled_at; booked_count := n; return next;
    end if;
  end loop;
end;
$$;
SQL
  N=6
fi

fail=0
SLOTS='[{"weekday":2,"start_time":"18:00"}]'
cid() { printf '00000000-0000-0000-0000-00000029f0%02x' "$1"; }
sid() { printf '00000000-0000-0000-0000-00000029f1%02x' "$1"; }

apply_sql() { # apply_sql <class> <hold-seconds>: prints "LISTED <session>" per left-unchanged row
  echo "begin; select 'LISTED ' || class_session_id from $FN('$1', '$SLOTS'::jsonb); select pg_sleep($2); commit;"
}
book_sql() { # book_sql <session> <hold-seconds>: one booking as the member
  echo "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$MEMBER_U\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"member\"}', true); select 'OK ' || id from book_class_session('$2'); reset role; select pg_sleep($3); commit;"
}

# ---- case 1: booking vs slot edit ----
n_kept=0
n_deleted=0
for i in $(seq 1 "$N"); do
  C=$(cid "$i"); S=$(sid "$i")
  psql_ <<SQL >/dev/null
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
  values ('$C', '$G', 'Slot Race $i', '$COACH_M', 10, 'recurring', '{2}', '18:00', current_date);
insert into class_sessions (id, gym_id, class_id, scheduled_at)
  values ('$S', '$G', '$C', date_trunc('day', now()) + interval '2 days 3 hours 7 minutes' + make_interval(secs => $i));
SQL
  case $((i % 3)) in
    0) order="apply first"
       psql_ -c "$(apply_sql "$C" "$HOLD_S")" > /tmp/cs-race-a.$$ 2>&1 & a=$!
       sleep "$GAP_S"
       psql_ -c "$(book_sql "$C" "$S" 0)" > /tmp/cs-race-b.$$ 2>&1 & b=$! ;;
    1) order="book first"
       psql_ -c "$(book_sql "$C" "$S" "$HOLD_S")" > /tmp/cs-race-b.$$ 2>&1 & b=$!
       sleep "$GAP_S"
       psql_ -c "$(apply_sql "$C" 0)" > /tmp/cs-race-a.$$ 2>&1 & a=$! ;;
    *) order="together"
       psql_ -c "$(apply_sql "$C" 0)" > /tmp/cs-race-a.$$ 2>&1 & a=$!
       psql_ -c "$(book_sql "$C" "$S" 0)" > /tmp/cs-race-b.$$ 2>&1 & b=$! ;;
  esac
  wait "$a"; wait "$b"
  sess=$(psql_ -c "select count(*) from class_sessions where id = '$S'")
  books=$(psql_ -c "select count(*) from class_bookings where class_session_id = '$S'")
  orphans=$(psql_ -c "select count(*) from class_bookings b where b.gym_id = '$G' and not exists (select 1 from class_sessions s where s.id = b.class_session_id)")
  listed=$(grep -c "^LISTED $S" /tmp/cs-race-a.$$)
  a_errors=$(grep -ci "error" /tmp/cs-race-a.$$)
  book_ok=$(grep -c "^OK " /tmp/cs-race-b.$$)
  book_nf=$(grep -c "session $S not found" /tmp/cs-race-b.$$)
  bad=$(cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$ | grep -ci "deadlock\|foreign key\|violates")
  if [ "$sess/$books/$listed/$book_ok/$book_nf" = "1/1/1/1/0" ] && [ "$orphans" = 0 ] && [ "$a_errors" = 0 ] && [ "$bad" = 0 ]; then
    n_kept=$((n_kept + 1))
    echo "ok   case 1 iteration $i ($order): booked, session kept and listed as left unchanged"
  elif [ "$sess/$books/$listed/$book_ok/$book_nf" = "0/0/0/0/1" ] && [ "$orphans" = 0 ] && [ "$a_errors" = 0 ] && [ "$bad" = 0 ]; then
    n_deleted=$((n_deleted + 1))
    echo "ok   case 1 iteration $i ($order): session deleted, the booking got not found"
  else
    echo "FAIL case 1 iteration $i ($order): session/bookings/listed/book ok/book not-found = $sess/$books/$listed/$book_ok/$book_nf, orphans=$orphans, edit errors=$a_errors, deadlock-or-fk=$bad"
    cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$; fail=1
  fi
  rm -f /tmp/cs-race-a.$$ /tmp/cs-race-b.$$
done
if [ -z "$BROKEN" ] && [ "$N" -ge 6 ] && { [ "$n_kept" -lt 1 ] || [ "$n_deleted" -lt 1 ]; }; then
  echo "FAIL case 1: expected both outcomes to occur, got kept=$n_kept deleted=$n_deleted"; fail=1
fi

if [ -z "$BROKEN" ]; then
  # ---- case 2: the 14th and the 15th slot inserted at once ----
  for i in 1 2 3; do
    K=$(cid $((100 + i)))
    psql_ <<SQL >/dev/null
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
  values ('$K', '$G', 'Slot Cap $i', '$COACH_M', 10, 'recurring', '{1}', '06:00', current_date);
insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
  select '$K', '$G', 2 + (n % 5), ('07:' || lpad(n::text, 2, '0'))::time from generate_series(1, 12) n;
SQL
    ins() { echo "begin; insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('$K', '$G', 0, '$1'); select pg_sleep($2); commit;"; }
    psql_ -c "$(ins "20:00" "$HOLD_S")" > /tmp/cs-race-a.$$ 2>&1 & a=$!
    sleep "$GAP_S"
    psql_ -c "$(ins "21:00" 0)" > /tmp/cs-race-b.$$ 2>&1 & b=$!
    wait "$a"; wait "$b"
    total=$(psql_ -c "select count(*) from class_schedule_slots where class_id = '$K'")
    refused=$(cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$ | grep -c "a class can have at most 14 weekly times")
    if [ "$total" = 14 ] && [ "$refused" = 1 ]; then
      echo "ok   case 2 iteration $i: the 14th slot went in, the queued 15th was refused, the class has 14 slots"
    else
      echo "FAIL case 2 iteration $i: slots=$total refusals=$refused (want 14/1)"; cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$; fail=1
    fi
    rm -f /tmp/cs-race-a.$$ /tmp/cs-race-b.$$
  done

  # ---- case 3: a materializer run queued behind a slot edit reads the new slots ----
  for i in 1 2 3; do
    K=$(cid $((120 + i)))
    psql_ <<SQL >/dev/null
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
  values ('$K', '$G', 'Slot Mat $i', '$COACH_M', 10, 'recurring', '{2}', '18:00', current_date);
SQL
    psql_ -c "select private.materialize_sessions_for_class('$K')" >/dev/null
    before=$(psql_ -c "select count(*) from class_sessions where class_id = '$K' and scheduled_at > now()")
    NEW='[{"weekday":5,"start_time":"07:30"}]'
    psql_ -c "begin; select count(*) from private.apply_class_slots('$K', '$NEW'::jsonb); select pg_sleep($HOLD_S); commit;" > /tmp/cs-race-a.$$ 2>&1 & a=$!
    sleep "$GAP_S"
    psql_ -c "select private.materialize_sessions_for_class('$K')" > /tmp/cs-race-b.$$ 2>&1 & b=$!
    wait "$a"; wait "$b"
    old_wd=$(psql_ -c "select count(*) from class_sessions s join gyms g on g.id = s.gym_id where s.class_id = '$K' and s.scheduled_at > now() and extract(dow from s.scheduled_at at time zone g.timezone) = 2")
    new_wd=$(psql_ -c "select count(*) from class_sessions s join gyms g on g.id = s.gym_id where s.class_id = '$K' and s.scheduled_at > now() and extract(dow from s.scheduled_at at time zone g.timezone) = 5")
    if [ "$before" -ge 3 ] && [ "$old_wd" = 0 ] && [ "$new_wd" -ge 3 ]; then
      echo "ok   case 3 iteration $i: the queued materializer run used the new slots (no session at the removed weekday, $new_wd at the new one)"
    else
      echo "FAIL case 3 iteration $i: sessions before=$before, at the removed weekday=$old_wd, at the new weekday=$new_wd"; cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$; fail=1
    fi
    rm -f /tmp/cs-race-a.$$ /tmp/cs-race-b.$$
  done

  # ---- case 4: booking vs cancel class ----
  cancel_sql() { # cancel_sql <class> <hold-seconds>: prints "COUNT n" as the manager
    echo "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$MANAGER_U\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"manager\"}', true); select 'COUNT ' || (cancel_class('$1') ->> 'bookings_cancelled'); reset role; select pg_sleep($2); commit;"
  }
  n_booked_first=0
  n_cancel_first=0
  for i in $(seq 1 "$N"); do
    C=$(cid $((140 + i))); S=$(sid $((140 + i)))
    psql_ <<SQL >/dev/null
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
  values ('$C', '$G', 'Cancel Race $i', '$COACH_M', 10, 'recurring', '{2}', '18:00', current_date);
insert into class_sessions (id, gym_id, class_id, scheduled_at)
  values ('$S', '$G', '$C', date_trunc('day', now()) + interval '2 days 5 hours 11 minutes' + make_interval(secs => $i));
SQL
    case $((i % 3)) in
      0) order="cancel first"
         psql_ -c "$(cancel_sql "$C" "$HOLD_S")" > /tmp/cs-race-a.$$ 2>&1 & a=$!
         sleep "$GAP_S"
         psql_ -c "$(book_sql "$C" "$S" 0)" > /tmp/cs-race-b.$$ 2>&1 & b=$! ;;
      1) order="book first"
         psql_ -c "$(book_sql "$C" "$S" "$HOLD_S")" > /tmp/cs-race-b.$$ 2>&1 & b=$!
         sleep "$GAP_S"
         psql_ -c "$(cancel_sql "$C" 0)" > /tmp/cs-race-a.$$ 2>&1 & a=$! ;;
      *) order="together"
         psql_ -c "$(cancel_sql "$C" 0)" > /tmp/cs-race-a.$$ 2>&1 & a=$!
         psql_ -c "$(book_sql "$C" "$S" 0)" > /tmp/cs-race-b.$$ 2>&1 & b=$! ;;
    esac
    wait "$a"; wait "$b"
    flagged=$(psql_ -c "select count(*) from class_sessions where id = '$S' and cancelled_at is not null")
    books=$(psql_ -c "select count(*) from class_bookings where class_session_id = '$S'")
    counted=$(grep -o "^COUNT [0-9]*" /tmp/cs-race-a.$$ | cut -d' ' -f2)
    book_ok=$(grep -c "^OK " /tmp/cs-race-b.$$)
    refused=$(grep -c "session $S is cancelled" /tmp/cs-race-b.$$)
    bad=$(cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$ | grep -ci "deadlock\|foreign key\|violates")
    a_errors=$(grep -ci "error" /tmp/cs-race-a.$$)
    if [ "$flagged/$books/$counted/$book_ok/$refused" = "1/1/1/1/0" ] && [ "$bad" = 0 ] && [ "$a_errors" = 0 ]; then
      n_booked_first=$((n_booked_first + 1))
      echo "ok   case 4 iteration $i ($order): booked, counted by the cancel, session flagged, booking on record"
    elif [ "$flagged/$books/$counted/$book_ok/$refused" = "1/0/0/0/1" ] && [ "$bad" = 0 ] && [ "$a_errors" = 0 ]; then
      n_cancel_first=$((n_cancel_first + 1))
      echo "ok   case 4 iteration $i ($order): the cancel won, the booking was refused as cancelled, nothing counted"
    else
      echo "FAIL case 4 iteration $i ($order): flagged/bookings/counted/book ok/refused = $flagged/$books/$counted/$book_ok/$refused, deadlock-or-fk=$bad, cancel errors=$a_errors"
      cat /tmp/cs-race-a.$$ /tmp/cs-race-b.$$; fail=1
    fi
    rm -f /tmp/cs-race-a.$$ /tmp/cs-race-b.$$
  done
  if [ "$N" -ge 6 ] && { [ "$n_booked_first" -lt 1 ] || [ "$n_cancel_first" -lt 1 ]; }; then
    echo "FAIL case 4: expected both outcomes to occur, got booked-first=$n_booked_first cancel-first=$n_cancel_first"; fail=1
  fi
fi

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
