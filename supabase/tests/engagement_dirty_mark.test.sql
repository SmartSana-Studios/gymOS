-- Story 30.3 (NFR-028, NFR-029, FR-225, FR-230): the dirty mark that private.record_check_in and public.void_staff_check_in (migration 0186)
-- write, and nothing else.
--
-- Proves: a QR check-in, a staff check-in and a void each write exactly one engagement_state upsert and no engagement_facts row, with the
-- epoch unset (dark) and set; the mark is the Monday of the STORED visit_day (an offline scan recorded in the previous week marks the previous
-- week, not the week of receipt); a later mark never replaces an earlier one and an earlier one replaces a later one; a void marks the week of
-- the voided visit and deletes nothing; the lock stays the first statement of both bodies and the mark is unguarded (no exception handler);
-- the scan that every function inserting into attendance_events or voiding a row of it also writes engagement_state.
-- The Epic 27 check-in and void pgTAP files (record_check_in, check_in_record_path, staff_check_in, check_in_session_gate*,
-- check_in_one_open_session_enforcement, suspension_rpc_coverage) pass UNEDITED; scripts/ci-local.sh runs them. void_staff_check_in.test.sql
-- case 7 is the one edit (it asserted the void never contains dirty_from, the opposite of the statement 0186 adds); it now asserts the mark.
--
-- The clock is real here because the check-in functions read now() themselves: assertions are relative to the stored visit_day, never to a
-- literal date, except the fixed March 2026 marks that the "earliest wins" cases plant.
--
-- Fixture ids: 00000000-0000-0000-0036-00000000nnnn. Gym 1001, users 2xxx, members 3xxx (1 owner, 2 receptionist, 10+ members).

begin;
select plan(51);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0036-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', p_app_role)::text, true);
end $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'DM Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, checkin_timeout_hours)
values (pg_temp.id(1, 1), 'DM Gym', pg_temp.id(0, 1), 'active', false, 0, 'Africa/Douala', 240);
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'dm-' || n || '@x.example', now() from generate_series(1, 30) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, 1), pg_temp.id(2, n), (case n when 1 then 'owner' when 2 then 'receptionist' else 'member' end)::member_role, 'DM Member ' || n, date '2026-01-05'
from generate_series(1, 30) n;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
values (pg_temp.id(4, 1), pg_temp.id(1, 1), 'DM Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select pg_temp.id(1, 1), pg_temp.m(n), pg_temp.id(4, 1), 'active', current_date - 5, current_date + 400 from generate_series(10, 30) n;

create function pg_temp.today() returns date language sql stable as $f$ select private.gym_today(pg_temp.id(1, 1)) $f$;
create function pg_temp.mon() returns date language sql stable as $f$ select private.week_start_of(pg_temp.today()) $f$;
create function pg_temp.nstate(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_state where member_id = pg_temp.m(p_n) $f$;
create function pg_temp.dirty(p_n int) returns date language sql stable as $f$ select dirty_from from engagement_state where member_id = pg_temp.m(p_n) $f$;
create function pg_temp.nfacts() returns int language sql stable as $f$ select count(*)::int from engagement_facts $f$;
create function pg_temp.att(p_n int) returns uuid language sql stable as $f$
  select id from attendance_events where member_id = pg_temp.m(p_n) order by created_at desc, id desc limit 1 $f$;
create function pg_temp.vday(p_n int) returns date language sql stable as $f$
  select visit_day from attendance_events where member_id = pg_temp.m(p_n) order by created_at desc, id desc limit 1 $f$;

-- ============================================================================
-- Shape: the lock first, the mark one unguarded statement, nothing else of the engagement area
-- ============================================================================
select ok(
  (select position('for no key update' in p.prosrc) > 0
          and position('for no key update' in p.prosrc) < position('current_gym_status' in p.prosrc)
          and position('for no key update' in p.prosrc) < position('insert into attendance_events' in p.prosrc)
          and position('insert into attendance_events' in p.prosrc) < position('insert into engagement_state' in p.prosrc)
   from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure),
  'record_check_in: the member lock is still taken first and the mark comes after the attendance insert');
select ok(
  (select position('for no key update' in p.prosrc) < position('update attendance_events' in p.prosrc)
          and position('update attendance_events' in p.prosrc) < position('insert into engagement_state' in p.prosrc)
   from pg_proc p where p.oid = 'public.void_staff_check_in(uuid, text)'::regprocedure),
  'void_staff_check_in: the member lock comes first and the mark comes after the void update');
select is(
  (select (regexp_matches(p.prosrc, 'insert into engagement_state \(member_id, gym_id, dirty_from\)\s+values \(([^;]*)\)\s+on conflict \(member_id\) do update\s+set dirty_from = least\(coalesce\(engagement_state\.dirty_from, excluded\.dirty_from\), excluded\.dirty_from\);'))[1]
   from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure),
  'p_member_id, p_gym_id, private.week_start_of(event.visit_day)',
  'record_check_in marks the week of the stored visit_day of the row it wrote, with the AC upsert');
select is(
  (select (regexp_matches(p.prosrc, 'insert into engagement_state \(member_id, gym_id, dirty_from\)\s+values \(([^;]*)\)\s+on conflict \(member_id\) do update\s+set dirty_from = least\(coalesce\(engagement_state\.dirty_from, excluded\.dirty_from\), excluded\.dirty_from\);'))[1]
   from pg_proc p where p.oid = 'public.void_staff_check_in(uuid, text)'::regprocedure),
  'ae.member_id, v_gym_id, private.week_start_of(ae.visit_day)',
  'void_staff_check_in marks the week of the stored visit_day of the voided row, with the AC upsert');
select is(
  (select count(*)::int from pg_proc p
   where p.oid in ('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure, 'public.void_staff_check_in(uuid, text)'::regprocedure)
     and (p.prosrc ~* 'settle_engagement|engagement_facts|engagement_fold|engagement_evaluate|rebuild_engagement|milestone|engagement_state_view')),
  0, 'neither body settles, folds, writes a fact, checks a milestone or reads the view (FR-225, FR-230)');
select is(
  (select count(*)::int from regexp_matches(
     (select p.prosrc from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure), 'engagement_state', 'g')),
  2, 'record_check_in names engagement_state only in the one statement (the insert target and the conflict update)');
select ok(
  (select p.prosrc !~* 'exception\s+when'
   from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure)
  and (select p.prosrc !~* 'exception\s+when'
   from pg_proc p where p.oid = 'public.void_staff_check_in(uuid, text)'::regprocedure),
  'neither body has an exception handler, so the mark cannot be swallowed (a lost mark would leave a week missed for good)');

-- ============================================================================
-- Dark (epoch NULL): a QR check-in marks, a staff check-in marks, a void marks, and no fact is written
-- ============================================================================
select is((select release_week_start from platform_engagement_config), null::date, 'the epoch is unset (dark) in this database');
select is(pg_temp.nstate(10), 0, 'before: member 10 has no engagement_state row');

select pg_temp.claims(10, 'member');
select lives_ok($$select * from public.check_in(null, gen_random_uuid())$$, 'a QR check-in by member 10 succeeds with the epoch unset');
select is(pg_temp.nstate(10), 1, 'QR: exactly one engagement_state row');
select is(pg_temp.dirty(10), pg_temp.mon(), 'QR: dirty_from is the Monday of this week (the stored visit_day)');
select is(pg_temp.vday(10), pg_temp.today(), 'QR: and that visit_day is the gym-local today');
select is(pg_temp.nfacts(), 0, 'QR: no engagement_facts row exists');

select pg_temp.claims(2, 'receptionist');
select is((select outcome from public.staff_check_in(pg_temp.m(11))), 'checked_in', 'a staff check-in of member 11 succeeds with the epoch unset');
select is(pg_temp.nstate(11), 1, 'staff: exactly one engagement_state row');
select is(pg_temp.dirty(11), pg_temp.mon(), 'staff: dirty_from is the Monday of this week');
select is(pg_temp.nfacts(), 0, 'staff: no engagement_facts row exists');

-- A void marks by itself: drop the mark the staff check-in left, then void and watch the row come back.
delete from engagement_state where member_id = pg_temp.m(11);
select pg_temp.claims(1, 'owner');
select is((select outcome from public.void_staff_check_in(pg_temp.att(11), 'dirty mark test void')), 'voided', 'the Owner voids the staff check-in of member 11');
select is(pg_temp.nstate(11), 1, 'void: exactly one engagement_state row, written by the void');
select is(pg_temp.dirty(11), pg_temp.mon(), 'void: dirty_from is the Monday of the voided visit_day');
select is(pg_temp.nfacts(), 0, 'void: no engagement_facts row exists');
select is((select count(*)::int from attendance_events where member_id = pg_temp.m(11) and voided_at is not null), 1, 'void: the attendance row is voided (the void itself is unchanged)');

-- ============================================================================
-- With the epoch set the same paths still write a mark only: settle is not run, so no fact appears
-- ============================================================================
update platform_engagement_config set release_week_start = date '2026-03-02';
select pg_temp.claims(12, 'member');
select lives_ok($$select * from public.check_in(null, gen_random_uuid())$$, 'a QR check-in succeeds with the epoch set');
select is(pg_temp.nstate(12), 1, 'epoch set: the mark is written');
select is(pg_temp.nfacts(), 0, 'epoch set: and still no fact (a check-in never settles)');
select pg_temp.claims(2, 'receptionist');
select is((select outcome from public.staff_check_in(pg_temp.m(13))), 'checked_in', 'a staff check-in succeeds with the epoch set');
select is(pg_temp.nfacts(), 0, 'epoch set: a staff check-in writes no fact either');
select pg_temp.claims(1, 'owner');
select is((select outcome from public.void_staff_check_in(pg_temp.att(13), 'dirty mark test void two')), 'voided', 'and the void succeeds with the epoch set');
select is(pg_temp.nfacts(), 0, 'epoch set: a void writes no fact');
update platform_engagement_config set release_week_start = null;

-- ============================================================================
-- The recorded week, not the week of receipt: an offline scan recorded last Sunday evening marks last week's Monday
-- ============================================================================
create function pg_temp.late_scan(p_n int) returns text language plpgsql as $f$
declare
  v_at timestamptz := ((pg_temp.mon() - 1) + time '20:00') at time zone 'Africa/Douala';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', 'member')::text, true);
  return (select r.outcome from private.record_check_in(pg_temp.m(p_n), pg_temp.id(1, 1), 'qr', null, v_at, gen_random_uuid()) r);
end $f$;
select is(pg_temp.late_scan(14), 'checked_in', 'an offline scan recorded last Sunday at 20:00 is accepted');
select is(pg_temp.vday(14), pg_temp.mon() - 1, 'its stored visit_day is last Sunday');
select is(pg_temp.dirty(14), pg_temp.mon() - 7, 'dirty_from is the Monday of the RECORDED week (the week before this one), not the week of receipt');

-- The gym-local date, not the UTC one: Monday 00:30 in Douala is Sunday 23:30 UTC, and the mark is that Monday's week.
create function pg_temp.midnight_scan(p_n int) returns text language plpgsql as $f$
declare
  v_at timestamptz := ((pg_temp.mon() - 7) + time '00:30') at time zone 'Africa/Douala';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', 'member')::text, true);
  return (select r.outcome from private.record_check_in(pg_temp.m(p_n), pg_temp.id(1, 1), 'qr', null, v_at, gen_random_uuid()) r);
end $f$;
select is(pg_temp.midnight_scan(20), 'checked_in', 'an offline scan recorded at Monday 00:30 gym time (Sunday 23:30 UTC) is accepted');
select is(pg_temp.vday(20), pg_temp.mon() - 7, 'its stored visit_day is that Monday (the gym-local date, not the UTC Sunday)');
select is(pg_temp.dirty(20), pg_temp.mon() - 7, 'dirty_from is that Monday: the mark follows the stored visit_day, not the UTC date of the scan');

-- ============================================================================
-- The earliest mark wins; a later one never replaces it; an earlier one replaces a later one
-- ============================================================================
insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(15), pg_temp.id(1, 1), date '2026-03-02');
select pg_temp.claims(15, 'member');
select lives_ok($$select * from public.check_in(null, gen_random_uuid())$$, 'member 15 (already dirty from 2026-03-02) checks in today');
select is(pg_temp.dirty(15), date '2026-03-02', 'a later mark never replaces an earlier one: dirty_from stays 2026-03-02');
insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(16), pg_temp.id(1, 1), private.week_start_of(current_date) + 14);
select pg_temp.claims(16, 'member');
select lives_ok($$select * from public.check_in(null, gen_random_uuid())$$, 'member 16 (dirty from a week two Mondays ahead) checks in today');
select is(pg_temp.dirty(16), pg_temp.mon(), 'an earlier mark replaces a later one: dirty_from moves back to this week');
insert into engagement_state (member_id, gym_id, settled_through, dirty_from) values (pg_temp.m(17), pg_temp.id(1, 1), date '2026-03-02', null);
select pg_temp.claims(17, 'member');
select lives_ok($$select * from public.check_in(null, gen_random_uuid())$$, 'member 17 (settled, not dirty) checks in today');
select is((select settled_through::text || '|' || dirty_from::text from engagement_state where member_id = pg_temp.m(17)), '2026-03-02|' || pg_temp.mon()::text,
          'the mark sets dirty_from on an existing row and leaves settled_through alone');

-- ============================================================================
-- A void deletes and edits no fact, milestone or badge (FR-230), and a refused void marks nothing
-- ============================================================================
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
values (pg_temp.m(18), pg_temp.id(1, 1), 'week', '2026-03-02', 1, 'met', 3, 3);
select pg_temp.claims(2, 'receptionist');
select is((select outcome from public.staff_check_in(pg_temp.m(18))), 'checked_in', 'a staff check-in of member 18 (who has a week fact)');
select pg_temp.claims(1, 'owner');
select is((select outcome from public.void_staff_check_in(pg_temp.att(18), 'dirty mark test void three')), 'voided', 'voided');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(18)), 1, 'the void deleted and added no fact');
delete from engagement_state where member_id = pg_temp.m(18);
select is((select outcome from public.void_staff_check_in(pg_temp.att(18), 'dirty mark test void four')), 'already_voided', 'a second void is refused as already_voided');
select is(pg_temp.nstate(18), 0, 'a refused void writes no mark');

-- A void only ever reaches today's visit (an earlier gym-local day is refused as not_same_day), so the week it marks is always the open week; a
-- visit of an earlier week can never be voided, and the refusal marks nothing.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source, entered_by)
values (pg_temp.id(1, 1), pg_temp.m(21), now() - interval '8 days', now() - interval '8 days' + interval '1 hour', 'manual', 'staff', pg_temp.id(2, 2));
select is((select outcome from public.void_staff_check_in(pg_temp.att(21), 'dirty mark test void past week')), 'not_same_day', 'a visit of an earlier week cannot be voided: not_same_day');
select is(pg_temp.nstate(21), 0, 'and the refused void of an earlier week writes no mark');

-- ============================================================================
-- The consumer scan: every function that inserts into attendance_events or voids a row of it also writes engagement_state
-- ============================================================================
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname !~ '^(pg_|information_schema$)'
     and (p.prosrc ~* 'insert\s+into\s+(public\.)?attendance_events\M' or p.prosrc ~* 'update\s+(public\.)?attendance_events\M[^;]*\mvoided_at\s*=')
     and p.prosrc !~* '\mengagement_state\M'),
  '', 'no function that inserts into attendance_events or sets voided_at on it fails to write engagement_state');
select is(
  (select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname !~ '^(pg_|information_schema$)'
     and (p.prosrc ~* 'insert\s+into\s+(public\.)?attendance_events\M' or p.prosrc ~* 'update\s+(public\.)?attendance_events\M[^;]*\mvoided_at\s*=')),
  'private.record_check_in, public.void_staff_check_in',
  'the scan is not vacuous: the writers it finds are exactly the two Epic 27 paths');

select * from finish();
rollback;
