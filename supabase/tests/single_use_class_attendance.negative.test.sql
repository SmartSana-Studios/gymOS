-- Story 28.3: class attendance in a single-use gym (migration 0179), refusals, backstops, tenant isolation and the source scans. Positive paths live
-- in single_use_class_attendance.test.sql.
--
-- Covers: the consume function's fifth parameter, its default and privileges (no 4-argument form left), the booking-id requirement, the unique
-- booking and the cover CHECK as backstops, the role and suspended-gym gates of mark_class_attendance, a visit that does not cover (another
-- member's, a voided one, a closed one), a cross-gym consume, tenant isolation of the Paid tab RPC and its signature, the callers source scan,
-- the readers of the cover columns, the session_attempts sources, and AD-21 (class marking never writes attendance_events).
--
-- Fixture ids: 00000000-0000-0000-0000-00000028[61-64]xx. Gyms 2861nn: 1 single_use, 2 whole_day, 3 suspended single_use.

begin;
select plan(52);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002861' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002862' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002863' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.p(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002864' || lpad(to_hex(n), 2, '0'))::uuid $f$;

create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

-- label -> member number, gym number, plan kind
create temp table fx (label text primary key, n int not null, gym int not null, plan text not null);
insert into fx values
  ('n_a', 101, 1, 'pps'), ('n_b', 102, 1, 'pps'), ('n_pc', 103, 1, 'pps'), ('n_nobook', 104, 1, 'pps'), ('n_role', 105, 1, 'pps'),
  ('n_iso', 106, 1, 'pps'), ('n_uniq', 107, 1, 'pps'), ('n_closed', 108, 1, 'pps'), ('n_dup', 109, 1, 'pps'),
  ('w_a', 130, 2, 'pps'), ('s_a', 140, 3, 'pps');

create function pg_temp.mm(p_label text) returns uuid language sql stable as $f$ select pg_temp.m(n) from fx where label = p_label $f$;
create function pg_temp.gg(p_label text) returns uuid language sql stable as $f$ select pg_temp.g(gym) from fx where label = p_label $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000286101', 'CN Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, capacity, session_validity, checkin_timeout_hours) values
  (pg_temp.g(1), 'CN Gym 1', '00000000-0000-0000-0000-000000286101', 'active',    true, 0, 'Africa/Douala', 30, 'single_use', 8),
  (pg_temp.g(2), 'CN Gym 2', '00000000-0000-0000-0000-000000286101', 'active',    true, 0, 'Africa/Douala', 30, 'whole_day',  8),
  (pg_temp.g(3), 'CN Gym 3', '00000000-0000-0000-0000-000000286101', 'suspended', true, 0, 'Africa/Douala', 30, 'single_use', 8);

insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'cn-' || n || '@x.example', now() from generate_series(1, 250) n;

-- Staff: 1 receptionist G1, 11..13 manager of gym 1..3, 31..33 coach of gym 1..3.
insert into members (id, gym_id, user_id, role, name, join_date) values
  (pg_temp.m(1), pg_temp.g(1), pg_temp.u(1), 'receptionist', 'CN Receptionist', current_date);
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(10 + g), pg_temp.g(g), pg_temp.u(10 + g), 'manager', 'CN Manager ' || g, current_date from generate_series(1, 3) g;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(30 + g), pg_temp.g(g), pg_temp.u(30 + g), 'coach', 'CN Coach ' || g, current_date from generate_series(1, 3) g;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(f.n), pg_temp.g(f.gym), pg_temp.u(f.n), 'member', 'CN ' || f.label, current_date from fx f;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
select pg_temp.p(g), pg_temp.g(g), 'CN PPS ' || g, 'pay_per_session', 2000, 'XAF', 'monthly', null from generate_series(1, 3) g;
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select pg_temp.g(f.gym), pg_temp.m(f.n), pg_temp.p(f.gym), 'active', current_date, null from fx f;

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
select ('00000000-0000-0000-0000-0000002865' || lpad(to_hex(g), 2, '0'))::uuid, pg_temp.g(g), 'CN Class ' || g, pg_temp.m(30 + g), 50, 'one_off', now() + interval '1 day'
from generate_series(1, 3) g;

-- ---- helpers ------------------------------------------------------------------------------------------------------------------------
create function pg_temp.mk_paid(p_gym uuid, p_member uuid) returns uuid language plpgsql security definer as $mk$
declare v_payment uuid; v_session uuid;
begin
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session') returning id into v_payment;
  insert into guest_sessions (gym_id, member_id, payment_id, usable_until, created_at)
  values (p_gym, p_member, v_payment, now() + interval '30 days', now() - interval '1 day') returning id into v_session;
  return v_session;
end $mk$;
create function pg_temp.mk_free(p_gym uuid, p_member uuid) returns uuid language plpgsql security definer as $mk$
declare v_grant uuid; v_session uuid;
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_grant;
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at)
  values (p_gym, p_member, v_grant, now() + interval '30 days', now() - interval '1 day') returning id into v_session;
  return v_session;
end $mk$;
-- An open visit that began p_age_min minutes ago, covered by a consumed single_use visit session, a consumed whole_day day session, or nothing.
create function pg_temp.open_visit(p_label text, p_age_min int, p_cover text) returns uuid language plpgsql security definer as $mk$
declare
  v_gym uuid := pg_temp.gg(p_label);
  v_member uuid := pg_temp.mm(p_label);
  v_att uuid;
  v_grant uuid;
  v_at timestamptz := now() - make_interval(mins => p_age_min);
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, source) values (v_gym, v_member, v_at, 'qr') returning id into v_att;
  if p_cover in ('visit', 'day') then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
    values (v_gym, v_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_grant;
    if p_cover = 'visit' then
      insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at, consumed_at, validity_mode, covered_kind, covered_attendance_id)
      values (v_gym, v_member, v_grant, now() + interval '30 days', now() - interval '1 day', v_at, 'single_use', 'visit', v_att);
    else
      insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at, consumed_at, validity_mode, covered_kind, covered_day, covered_attendance_id)
      values (v_gym, v_member, v_grant, now() + interval '30 days', now() - interval '1 day', v_at, 'whole_day', 'day', private.gym_local_date(v_gym, v_at), v_att);
    end if;
  end if;
  return v_att;
end $mk$;
-- One scan as the member. denied -> {"denied":true}; a raise -> {"error":"<sqlstate>:<message>"}; a row -> {"id","out","type"}.
create function pg_temp.scan(p_label text, p_at timestamptz default null, p_scan uuid default null) returns jsonb language plpgsql as $f$
declare
  v_user uuid;
  v_gym uuid;
  r attendance_events;
begin
  select pg_temp.u(n), pg_temp.g(gym) into v_user, v_gym from fx where label = p_label;
  perform pg_temp.claims(v_user, v_gym, 'member');
  set local role authenticated;
  begin
    if p_at is null and p_scan is null then
      r := check_in();
    else
      r := check_in(p_at, p_scan);
    end if;
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  if r.id is null then
    return jsonb_build_object('denied', true);
  end if;
  return jsonb_build_object('id', r.id, 'out', r.checked_out_at, 'type', r.checkout_type);
end $f$;
create function pg_temp.sci(p_label text, p_staff int, p_role text) returns jsonb language plpgsql as $f$
declare
  v_member uuid;
  v_gym uuid;
  r record;
begin
  select pg_temp.m(n), pg_temp.g(gym) into v_member, v_gym from fx where label = p_label;
  perform pg_temp.claims(pg_temp.u(p_staff), v_gym, p_role);
  set local role authenticated;
  begin
    select * into r from public.staff_check_in(v_member);
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  return jsonb_strip_nulls(to_jsonb(r));
end $f$;
create function pg_temp.void(p_att uuid, p_staff int, p_gym int, p_role text) returns jsonb language plpgsql as $f$
declare r record;
begin
  perform pg_temp.claims(pg_temp.u(p_staff), pg_temp.g(p_gym), p_role);
  set local role authenticated;
  begin
    select * into r from public.void_staff_check_in(p_att, 'wrong member selected');
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  return jsonb_strip_nulls(to_jsonb(r));
end $f$;
create function pg_temp.mark(p_booking uuid, p_staff int, p_gym int, p_role text) returns text language plpgsql as $f$
declare r class_bookings;
begin
  perform pg_temp.claims(pg_temp.u(p_staff), pg_temp.g(p_gym), p_role);
  set local role authenticated;
  begin
    r := mark_class_attendance(p_booking);
  exception when others then
    reset role;
    return 'error:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return case when r.id is null then 'null' when r.attended_at is null then 'refused' else 'attended' end;
end $f$;
create function pg_temp.att(p_label text) returns uuid language sql security definer as $f$
  select id from attendance_events where member_id = pg_temp.mm(p_label) order by checked_in_at desc, created_at desc limit 1 $f$;
create function pg_temp.checkout(p_label text) returns void language sql security definer as $f$
  update attendance_events set checked_out_at = now(), checkout_type = 'manual' where member_id = pg_temp.mm(p_label) and checked_out_at is null $f$;
create function pg_temp.consumed(p_label text) returns int language sql security definer as $f$
  select count(*)::int from guest_sessions where member_id = pg_temp.mm(p_label) and consumed_at is not null $f$;
create function pg_temp.set_validity(p_gym int, p_value text) returns void language plpgsql security definer as $f$
begin
  perform set_config('app.session_validity_update_bypass', 'true', true);
  update gyms set session_validity = p_value where id = pg_temp.g(p_gym);
  perform set_config('app.session_validity_update_bypass', 'false', true);
end $f$;
create function pg_temp.stale_audits(p_att uuid) returns jsonb language sql security definer as $f$
  select coalesce(jsonb_agg(metadata), '[]'::jsonb) from audit_log
  where action_type = 'attendance_stale_check_in_auto_closed' and target_entity_id = p_att::text $f$;
create function pg_temp.err(p_result jsonb) returns text language sql immutable as $f$ select coalesce(p_result ->> 'error', 'none') $f$;

-- One class booking per (member, k): its own class_session of the gym's class, so a member can hold several. Idempotent.
create temp table bks (label text, k int, id uuid, cs uuid, primary key (label, k));
create function pg_temp.bk(p_label text, p_k int default 1) returns uuid language plpgsql security definer as $f$
declare v_gym uuid := pg_temp.gg(p_label); v_cs uuid; v_b uuid; v_class uuid;
begin
  select id into v_b from bks where label = p_label and k = p_k;
  if v_b is not null then return v_b; end if;
  select c.id into v_class from classes c where c.gym_id = v_gym;
  insert into class_sessions (gym_id, class_id, scheduled_at) values (v_gym, v_class, now() + interval '1 day' + make_interval(mins => (select n from fx where label = p_label) * 10 + p_k)) returning id into v_cs;
  insert into class_bookings (gym_id, class_session_id, member_id) values (v_gym, v_cs, pg_temp.mm(p_label)) returning id into v_b;
  insert into bks values (p_label, p_k, v_b, v_cs);
  return v_b;
end $f$;
-- A class mark by the gym's manager.
create function pg_temp.cm(p_label text, p_k int default 1) returns text language sql as $f$
  select pg_temp.mark(pg_temp.bk(p_label, p_k), 10 + gym, gym, 'manager') from fx where label = p_label $f$;
create function pg_temp.sessions(p_label text) returns int language sql security definer as $f$
  select count(*)::int from guest_sessions where member_id = pg_temp.mm(p_label) $f$;
create function pg_temp.kind_count(p_label text, p_kind text) returns int language sql security definer as $f$
  select count(*)::int from guest_sessions where member_id = pg_temp.mm(p_label) and consumed_at is not null and covered_kind = p_kind $f$;
create function pg_temp.stamps(p_label text) returns int language sql security definer as $f$
  select count(*)::int from loyalty_events where member_id = pg_temp.mm(p_label) and event_type = 'stamp_earned' $f$;
create function pg_temp.att_count(p_label text) returns int language sql security definer as $f$
  select count(*)::int from attendance_events where member_id = pg_temp.mm(p_label) $f$;
create function pg_temp.attended(p_label text, p_k int default 1) returns boolean language sql security definer as $f$
  select attended_at is not null from class_bookings where id = pg_temp.bk(p_label, p_k) $f$;
create function pg_temp.audits(p_label text, p_action text) returns int language sql security definer as $f$
  select count(*)::int from audit_log where action_type = p_action and target_entity_id = pg_temp.mm(p_label)::text $f$;
-- A digest of every guest_sessions row of the member / the gym / one row.
create function pg_temp.msnap(p_label text) returns text language sql security definer as $f$
  select md5(coalesce(string_agg(to_jsonb(gs)::text, '|' order by gs.id), '')) from guest_sessions gs where gs.member_id = pg_temp.mm(p_label) $f$;
create function pg_temp.gsnap(p_gym int) returns text language sql security definer as $f$
  select md5(coalesce(string_agg(to_jsonb(gs)::text, '|' order by gs.id), '')) from guest_sessions gs where gs.gym_id = pg_temp.g(p_gym) $f$;
create function pg_temp.rsnap(p_id uuid) returns text language sql security definer as $f$
  select md5(to_jsonb(gs)::text) from guest_sessions gs where gs.id = p_id $f$;
-- A paid session that is already consumed as a Whole-day row of today (the gym-local day).
create function pg_temp.mk_day(p_gym uuid, p_member uuid) returns uuid language plpgsql security definer as $mk$
declare v_session uuid;
begin
  v_session := pg_temp.mk_paid(p_gym, p_member);
  update guest_sessions set consumed_at = now(), validity_mode = 'whole_day', covered_kind = 'day', covered_day = private.gym_local_date(p_gym, now())
  where id = v_session;
  return v_session;
end $mk$;
-- A paid session made by the platform's own creation function (usable for the platform's paid window).
create function pg_temp.mk_real(p_gym uuid, p_member uuid) returns uuid language plpgsql security definer as $mk$
declare v_payment uuid; v_session guest_sessions;
begin
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session') returning id into v_payment;
  select * into v_session from private.create_guest_session_for_payment(v_payment, p_member, p_gym);
  return v_session.id;
end $mk$;
-- The Paid tab row of a member, read as the gym's manager.
create function pg_temp.paid_row(p_label text) returns jsonb language plpgsql as $f$
declare v_row jsonb;
begin
  perform pg_temp.claims(pg_temp.u(10 + (select gym from fx where label = p_label)), pg_temp.gg(p_label), 'manager');
  set local role authenticated;
  select to_jsonb(r) into v_row from list_guest_sessions_paid('month') r where r.member_id = pg_temp.mm(p_label) limit 1;
  reset role;
  return v_row;
end $f$;
-- The Guest sessions card and the Paid tab of a gym, read as its manager, as one comparable string.
create function pg_temp.totals(p_gym int) returns text language plpgsql as $f$
declare v_out text;
begin
  perform pg_temp.claims(pg_temp.u(10 + p_gym), pg_temp.g(p_gym), 'manager');
  set local role authenticated;
  select (select paid_count from guest_sessions_summary('month')) || '/' || (select blocked_count from guest_sessions_summary('month')) || '/'
         || (select blocked_members from guest_sessions_summary('month')) || '/' || (select free_count from guest_sessions_summary('month')) || '/'
         || (select count(*) from list_guest_sessions_paid('month')) || '/'
         || (select count(*) from list_guest_sessions_paid('month') where consumed_at is not null) into v_out;
  reset role;
  return v_out;
end $f$;

create temp table keep (label text primary key, att uuid, sess uuid, h text);

create function pg_temp.anon_mark(p_booking uuid) returns text language plpgsql as $f$
begin
  set local role anon;
  begin
    perform mark_class_attendance(p_booking);
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok';
end $f$;
create function pg_temp.paid_as(p_user int, p_gym int, p_role text) returns text language plpgsql as $f$
declare v_rows int;
begin
  perform pg_temp.claims(pg_temp.u(p_user), pg_temp.g(p_gym), p_role);
  set local role authenticated;
  begin
    select count(*)::int into v_rows from list_guest_sessions_paid('month');
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'rows:' || v_rows;
end $f$;

-- ============================================================================
-- Signature, default and privileges.
-- ============================================================================
select is(to_regprocedure('private.consume_guest_session(uuid, uuid, timestamptz, text)'), null, 'the 4-argument consume function no longer exists (no ambiguity with the default)');
select is(pg_get_function_arguments('private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure),
          'p_member_id uuid, p_gym_id uuid, p_receipt_at timestamp with time zone, p_kind text DEFAULT ''visit''::text, p_booking_id uuid DEFAULT NULL::uuid',
          'the consume function takes p_kind and p_booking_id, both defaulted');
select is(pg_get_function_result('private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure),
          'TABLE(outcome text, session_created_at timestamp with time zone, session_id uuid)', 'the consume function keeps its three result columns');
select is(has_function_privilege('anon', 'private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)', 'EXECUTE')
          or has_function_privilege('authenticated', 'private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)', 'EXECUTE'), false,
          'anon and authenticated cannot execute the consume function');
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure and a.grantee = 0), 0, 'PUBLIC has no EXECUTE on the consume function');
select is(pg_get_function_arguments('public.mark_class_attendance(uuid)'::regprocedure), 'p_booking_id uuid', 'mark_class_attendance keeps its signature');
select is(pg_get_function_result('public.mark_class_attendance(uuid)'::regprocedure), 'class_bookings', 'mark_class_attendance keeps its return type');
select is(has_function_privilege('anon', 'public.mark_class_attendance(uuid)', 'EXECUTE') || '/' || has_function_privilege('authenticated', 'public.mark_class_attendance(uuid)', 'EXECUTE'),
          'false/true', 'mark_class_attendance: authenticated yes, anon no');
select is(pg_get_function_result('public.list_guest_sessions_paid(text, boolean, boolean, integer, integer)'::regprocedure),
          'TABLE(payment_id uuid, member_id uuid, member_name text, amount integer, method text, created_at timestamp with time zone, consumed_at timestamp with time zone, '
          'refund_state text, recorder_id uuid, recorder_name text, recorder_kind text, group_sessions bigint, group_total bigint, total_count bigint, '
          'covered_kind text, covered_booking_id uuid, class_name text, class_starts_at timestamp with time zone, gym_timezone text)',
          'list_guest_sessions_paid: the old columns in the old order, then the five cover columns');
select is((select prosecdef::text || '/' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           from pg_proc p where p.oid = 'public.list_guest_sessions_paid(text, boolean, boolean, integer, integer)'::regprocedure),
          'false/false/true', 'list_guest_sessions_paid: SECURITY INVOKER, authenticated yes, anon no');

-- ============================================================================
-- A class needs its booking id where a booking is recorded; the backstops behind the function.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_nobook'));
select throws_ok(format($q$ select * from private.consume_guest_session(%L, %L, now(), 'class') $q$, pg_temp.mm('n_nobook'), pg_temp.g(1)),
                  'P0001', 'consume_guest_session: a class needs its booking id', 'single_use gym: a class consume with no booking id raises');
select is(pg_temp.consumed('n_nobook'), 0, 'single_use gym: and consumed nothing');
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('w_a'));
select is((select outcome from private.consume_guest_session(pg_temp.mm('w_a'), pg_temp.g(2), now(), 'class')), 'consumed', 'whole_day gym: a class consume needs no booking id (a day row, as before)');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.mm('w_a') and consumed_at is not null), 'whole_day:day', 'whole_day gym: and writes a day row');
select throws_ok(format($q$ select * from private.consume_guest_session(%L, %L, now(), 'booking') $q$, pg_temp.mm('n_nobook'), pg_temp.g(1)),
                  'P0001', 'consume_guest_session: invalid kind booking', 'an unknown kind raises');

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_uniq'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_uniq'));
select is(pg_temp.cm('n_uniq', 1), 'attended', 'backstops: a class consumes a session for its booking');
select throws_ok(format($q$ update guest_sessions set consumed_at = now(), validity_mode = 'single_use', covered_kind = 'class', covered_booking_id = %L
                           where member_id = %L and consumed_at is null $q$, pg_temp.bk('n_uniq', 1), pg_temp.mm('n_uniq')),
                  '23505', null, 'backstops: unique (covered_booking_id) refuses a second session for one booking');
select throws_ok(format($q$ update guest_sessions set consumed_at = now(), validity_mode = 'single_use', covered_kind = 'class'
                           where member_id = %L and consumed_at is null $q$, pg_temp.mm('n_uniq')),
                  '23514', null, 'backstops: the cover CHECK refuses a class row with no booking id');
select throws_ok(format($q$ update guest_sessions set consumed_at = now(), validity_mode = 'single_use', covered_kind = 'class', covered_booking_id = %L, covered_day = current_date
                           where member_id = %L and consumed_at is null $q$, pg_temp.bk('n_uniq', 2), pg_temp.mm('n_uniq')),
                  '23514', null, 'backstops: the cover CHECK refuses a class row that also has a covered day');
select is(pg_temp.kind_count('n_uniq', 'class'), 1, 'backstops: still exactly one class row');

-- ============================================================================
-- Visits that do not cover a class: another member's, a voided session's, a closed visit's.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_b'));
select ok((pg_temp.scan('n_b') ? 'id'), 'another member''s visit: member B checks in (one visit session)');
insert into keep select 'n_b', pg_temp.att('n_b'), null, pg_temp.msnap('n_b');
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_pc'));
select is(pg_temp.cm('n_pc'), 'attended', 'another member''s visit: member C''s class is attended');
select is(pg_temp.kind_count('n_pc', 'class'), 1, 'another member''s visit: B''s visit does not cover C, C consumed its own class session');
select is(pg_temp.msnap('n_b'), (select h from keep where label = 'n_b'), 'another member''s visit: B''s rows are untouched');

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_a'));
insert into keep select 'n_a', pg_temp.open_visit('n_a', 30, 'visit'), null, null;
update guest_sessions set voided_at = now() where member_id = pg_temp.mm('n_a') and consumed_at is not null;
select is(pg_temp.cm('n_a'), 'attended', 'voided cover: the class mark attends the booking');
select is(pg_temp.kind_count('n_a', 'class'), 1, 'voided cover: an open visit whose session is voided does not cover, the class consumed its own session');

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_closed'));
insert into keep select 'n_closed', pg_temp.open_visit('n_closed', 30, 'visit'), null, null;
select pg_temp.checkout('n_closed');
select is(pg_temp.cm('n_closed'), 'attended', 'closed visit: the class mark attends the booking');
select is(pg_temp.kind_count('n_closed', 'class'), 1, 'closed visit: a visit that has been checked out does not cover, the class consumed its own session');

-- ============================================================================
-- Role and status gates of mark_class_attendance, tenant isolation of the consume function and the Paid tab RPC.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_role'));
select pg_temp.bk('n_role');
select is(pg_temp.mark(pg_temp.bk('n_role'), 31, 1, 'coach'), 'error:P0001:mark_class_attendance: permission denied', 'role gate: a coach cannot mark attendance');
select is(pg_temp.mark(pg_temp.bk('n_role'), 105, 1, 'member'), 'error:P0001:mark_class_attendance: permission denied', 'role gate: a member cannot mark attendance');
select is(pg_temp.anon_mark(pg_temp.bk('n_role')), '42501', 'role gate: anon cannot execute mark_class_attendance');
select is(pg_temp.mark(pg_temp.bk('n_role'), 12, 2, 'manager'), 'error:P0001:mark_class_attendance: booking ' || pg_temp.bk('n_role') || ' not found',
          'tenant: another gym''s manager cannot mark this booking (uniform not found)');
select is(pg_temp.kind_count('n_role', 'class') || '/' || pg_temp.attended('n_role')::text || '/' || (select count(*)::int from session_attempts where member_id = pg_temp.mm('n_role')), '0/false/0',
          'role gates: nothing consumed, nothing attended, no attempt');
select is(pg_temp.mark(pg_temp.bk('n_role'), 1, 1, 'receptionist'), 'attended', 'role gate: a receptionist can');

select pg_temp.mk_paid(pg_temp.g(3), pg_temp.mm('s_a'));
select is(pg_temp.cm('s_a'), 'error:P0001:mark_class_attendance: gym ' || pg_temp.g(3) || ' is not active', 'status gate: a suspended gym refuses the mark');
select is(pg_temp.kind_count('s_a', 'class') || '/' || pg_temp.attended('s_a')::text, '0/false', 'status gate: nothing consumed, not attended');

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('n_iso'));
insert into keep select 'n_iso', null, null, pg_temp.gsnap(1);
select is((select outcome from private.consume_guest_session(pg_temp.mm('n_iso'), pg_temp.g(2), now(), 'class', pg_temp.bk('n_iso'))), 'denied',
          'tenant: a class consume for another gym never touches the member''s sessions of this gym');
select is(pg_temp.gsnap(1), (select h from keep where label = 'n_iso'), 'tenant: every guest_sessions row of gym 1 is unchanged');

select is(pg_temp.paid_as(12, 2, 'manager'), 'rows:1', 'paid tab: the manager of gym 2 sees only gym 2''s one payment');
select is(pg_temp.paid_as(11, 1, 'manager'), 'rows:' || (select count(*)::text from payments where gym_id = pg_temp.g(1) and purpose = 'session'), 'paid tab: the manager of gym 1 sees exactly gym 1''s payments');
select is(pg_temp.paid_as(1, 1, 'receptionist'), '42501', 'paid tab: a receptionist is refused');
select is(pg_temp.paid_as(31, 1, 'coach'), '42501', 'paid tab: a coach is refused');
select is((select has_function_privilege('anon', 'public.list_guest_sessions_paid(text, boolean, boolean, integer, integer)', 'EXECUTE')), false, 'paid tab: anon cannot execute');

-- ============================================================================
-- Source scans: the callers, the readers of the cover, the attempt sources, AD-21.
-- ============================================================================
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind = 'f' and n.nspname in ('public', 'private') and p.proname <> 'consume_guest_session'
             and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'consume_guest_session\s*\('),
          'private.record_check_in, public.mark_class_attendance', 'only record_check_in and mark_class_attendance call the consume function (source scan)');
select ok((select regexp_replace(prosrc, '--[^\n]*', '', 'g') ~ 'consume_guest_session\(v_member_id, v_gym_id, now\(\), ''class'', v_booking_id\)' from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure),
          'mark_class_attendance passes the class kind and the booking id');
select ok((select position('attended_at is null' in prosrc) > 0 and prosrc ~ 'v_attended_at is not null' from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure),
          'mark_class_attendance keeps its attended_at re-mark guards');
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind = 'f' and n.nspname in ('public', 'private') and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'covered_kind|covered_booking_id'),
          'private.audit_session_consumed, private.consume_guest_session, private.guest_sessions_check_visit_has_attendance, private.guest_sessions_normalise_cover, private.record_check_in, public.list_guest_sessions_paid',
          'the functions that read the cover columns are exactly these six (a new reader must be added here on purpose)');
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind = 'f' and n.nspname in ('public', 'private') and p.proname <> 'list_guest_sessions_paid'
             and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'list_guest_sessions_paid'), '', 'no other function calls the Paid tab RPC');
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind = 'f' and n.nspname in ('public', 'private') and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'session_attempts'),
          'public.check_in, public.guest_sessions_summary, public.list_session_attempts, public.mark_class_attendance, public.staff_check_in',
          'the functions that touch session_attempts are exactly these five');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.session_attempts'::regclass and contype = 'c'),
          'CHECK ((source = ANY (ARRAY[''check_in''::text, ''class''::text, ''staff''::text])))', 'session_attempts.source: still exactly check_in, class and staff (no new value)');
select is((select count(*)::int from pg_proc p where p.oid in ('private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure, 'public.mark_class_attendance(uuid)'::regprocedure)
           and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?attendance_events'), 0,
          'AD-21: neither the consume function nor mark_class_attendance writes attendance_events');
select is((select count(*)::int from pg_proc p where p.oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure and position('class_single_use_unsupported' in p.prosrc) > 0), 0,
          'the class_single_use_unsupported guard is gone');

select * from finish();
rollback;
