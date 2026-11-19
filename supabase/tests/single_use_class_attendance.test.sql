-- Story 28.3: class attendance in a single-use gym and setting-change parity (migration 0179), positive paths. Refusals, role and tenant gates,
-- signatures and the source scans live in single_use_class_attendance.negative.test.sql.
--
-- Covers: a class inside an open visit covered by its own session (free, twice), a class with no visit / a stale visit / a visit no session covers
-- (its own `class` session, stamp, audit, attendance untouched, the stale visit left open), the 179 / 180 minute boundary, a consumed whole_day
-- row covering a class in a single_use gym, class then scan then class then class, a re-mark, a denial, exempt members, a free session, an
-- atomic failure, the voided-visit consequence, the whole_day gym byte for byte, the four setting-flip combinations with a before / after row
-- snapshot, a class mark made right after a flip, the lapse windows per setting through the sweep, three stamps in one day, no stamps with loyalty
-- off, a refund of a consumed class session, the Paid tab columns, and the Guest sessions totals identical under both settings.
--
-- pgTAP runs one session and one transaction: now() is constant, so every age below is exact. The helpers switch to the caller's role themselves,
-- so every assertion runs as the table owner.
--
-- Fixture ids: 00000000-0000-0000-0000-00000028[51-54]xx. Gyms 2851nn, users 2852nn, members 2853nn, plans 2854nn.

begin;
select plan(150);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002851' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002852' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002853' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.p(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002854' || lpad(to_hex(n), 2, '0'))::uuid $f$;

create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

-- label -> member number, gym number, plan kind
create temp table fx (label text primary key, n int not null, gym int not null, plan text not null);
insert into fx values
  -- gym 1 (single_use, charging, loyalty threshold 3, timeout 8 h)
  ('c_in', 101, 1, 'pps'), ('c_nov', 102, 1, 'pps'), ('c_stale', 103, 1, 'pps'), ('c_unc', 104, 1, 'pps'), ('c_seq', 105, 1, 'pps'),
  ('c_none', 106, 1, 'pps'), ('c_zero', 107, 1, 'zero'), ('c_monthly', 108, 1, 'monthly'), ('c_day', 109, 1, 'pps'), ('c_free', 110, 1, 'pps'),
  ('c_fail', 111, 1, 'pps'), ('loy', 112, 1, 'pps'), ('c_void', 113, 1, 'pps'), ('r_cls', 114, 1, 'pps'), ('r_free', 115, 1, 'pps'),
  ('b179', 116, 1, 'pps'), ('b180', 117, 1, 'pps'), ('p_unused', 118, 1, 'pps'), ('c_two', 119, 1, 'pps'), ('c_plat', 120, 1, 'pps'), ('y_su', 121, 1, 'pps'),
  -- gym 2 (whole_day, charging, loyalty threshold 3)
  ('wd_c', 130, 2, 'pps'), ('wd_s', 131, 2, 'pps'), ('y_wd', 132, 2, 'pps'),
  -- gyms 3 to 6: the four setting flips (3 whole_day with a day row, 4 single_use with an open visit, 5 single_use with a class row, 6 no activity)
  ('f_day', 140, 3, 'pps'), ('f_visit', 150, 4, 'pps'), ('f_class', 160, 5, 'pps'), ('f_none', 170, 6, 'pps'),
  -- gym 7 (whole_day) and gym 8 (single_use): lapse windows and totals parity, loyalty threshold 2
  ('l7', 180, 7, 'pps'), ('l7c', 181, 7, 'pps'), ('d7', 182, 7, 'pps'), ('l8', 190, 8, 'pps'), ('l8c', 191, 8, 'pps'), ('d8', 192, 8, 'pps'),
  -- gym 9 (single_use, loyalty off), gym 10 (single_use, charging off)
  ('nl', 200, 9, 'pps'), ('off', 210, 10, 'pps');

create function pg_temp.mm(p_label text) returns uuid language sql stable as $f$ select pg_temp.m(n) from fx where label = p_label $f$;
create function pg_temp.gg(p_label text) returns uuid language sql stable as $f$ select pg_temp.g(gym) from fx where label = p_label $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000285101', 'CA Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, capacity,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days, session_validity, checkin_timeout_hours) values
  (pg_temp.g(1),  'CA Gym 1',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, true,  3, 3, 1, 'single_use', 8),
  (pg_temp.g(2),  'CA Gym 2',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, true,  3, 3, 1, 'whole_day',  8),
  (pg_temp.g(3),  'CA Gym 3',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'whole_day',  8),
  (pg_temp.g(4),  'CA Gym 4',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8),
  (pg_temp.g(5),  'CA Gym 5',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8),
  (pg_temp.g(6),  'CA Gym 6',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8),
  (pg_temp.g(7),  'CA Gym 7',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, true,  2, 3, 1, 'whole_day',  8),
  (pg_temp.g(8),  'CA Gym 8',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, true,  2, 3, 1, 'single_use', 8),
  (pg_temp.g(9),  'CA Gym 9',  '00000000-0000-0000-0000-000000285101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8),
  (pg_temp.g(10), 'CA Gym 10', '00000000-0000-0000-0000-000000285101', 'active', false, 0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8);

insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'ca-' || n || '@x.example', now() from generate_series(1, 250) n;

-- Staff: 1 receptionist G1, 4 coach G1, 11..20 manager of gym 1..10, 31..40 coach of gym 1..10.
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(s.n), pg_temp.g(s.gym), pg_temp.u(s.n), s.role::member_role, 'CA Staff ' || s.n, current_date
from (values (1, 1, 'receptionist'), (4, 1, 'coach')) as s(n, gym, role);
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(10 + g), pg_temp.g(g), pg_temp.u(10 + g), 'manager', 'CA Manager ' || g, current_date from generate_series(1, 10) g;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(30 + g), pg_temp.g(g), pg_temp.u(30 + g), 'coach', 'CA Coach ' || g, current_date from generate_series(1, 10) g;

insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(f.n), pg_temp.g(f.gym), pg_temp.u(f.n), 'member', 'CA ' || f.label, current_date from fx f;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
select pg_temp.p(g), pg_temp.g(g), 'CA PPS ' || g, 'pay_per_session', 2000, 'XAF', 'monthly', null from generate_series(1, 10) g;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  (pg_temp.p(21), pg_temp.g(1), 'CA Monthly', 'monthly',         15000, 'XAF', 'monthly', 30),
  (pg_temp.p(22), pg_temp.g(1), 'CA PPS 0',   'pay_per_session', 0,     'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select pg_temp.g(f.gym), pg_temp.m(f.n),
       case f.plan when 'monthly' then pg_temp.p(21) when 'zero' then pg_temp.p(22) else pg_temp.p(f.gym) end,
       'active', current_date, case f.plan when 'monthly' then current_date + 30 end
from fx f;

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
select ('00000000-0000-0000-0000-0000002855' || lpad(to_hex(g), 2, '0'))::uuid, pg_temp.g(g), 'CA Class ' || g, pg_temp.m(30 + g), 50, 'one_off', now() + interval '1 day'
from generate_series(1, 10) g;

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
declare v_row jsonb; v_member uuid := pg_temp.mm(p_label);
begin
  perform pg_temp.claims(pg_temp.u(10 + (select gym from fx where label = p_label)), pg_temp.gg(p_label), 'manager');
  set local role authenticated;
  select to_jsonb(r) into v_row from list_guest_sessions_paid('month') r where r.member_id = v_member limit 1;
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

-- The platform visit limit starts at its default.
select is((select single_use_visit_limit_minutes from platform_session_config), 180, 'the platform visit limit is the default 180 minutes');

-- ============================================================================
-- A class inside an open visit that the visit's own session covers is free, and so is a second class in the same visit (FR-238, A3).
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_in'));
select ok((pg_temp.scan('c_in') ? 'id'), 'covered visit: the member checks in, one visit session consumed');
insert into keep select 'c_in', pg_temp.att('c_in'), (select id from guest_sessions where member_id = pg_temp.mm('c_in') and consumed_at is not null), pg_temp.msnap('c_in');
select is(pg_temp.stamps('c_in'), 1, 'covered visit: the visit earned its one stamp');
select is(pg_temp.cm('c_in', 1), 'attended', 'covered visit: a class mark inside the visit attends the booking');
select ok(pg_temp.attended('c_in', 1), 'covered visit: attended_at is set');
select is(pg_temp.msnap('c_in'), (select h from keep where label = 'c_in'), 'covered visit: no guest_sessions row written or changed');
select is(pg_temp.stamps('c_in'), 1, 'covered visit: no stamp earned for the class');
select is(pg_temp.audits('c_in', 'session_consumed'), 1, 'covered visit: no second session_consumed audit row');
select is(pg_temp.att_count('c_in'), 1, 'covered visit: the class wrote no attendance row');
select is(pg_temp.cm('c_in', 2), 'attended', 'covered visit: a second class in the same visit is attended');
select is(pg_temp.msnap('c_in'), (select h from keep where label = 'c_in'), 'covered visit: and also costs nothing');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'c_in')), null, 'covered visit: the class marks did not touch the visit');

-- ============================================================================
-- A class with no usable cover consumes its own session: its own row, covering nothing else.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_nov'));
select is(pg_temp.cm('c_nov'), 'attended', 'no visit: the class mark attends the booking');
select is((select validity_mode || ':' || covered_kind || ':' || (covered_booking_id = pg_temp.bk('c_nov'))::text || ':' || (covered_day is null)::text || ':'
                  || (covered_attendance_id is null)::text || ':' || (consumed_at = now())::text
           from guest_sessions where member_id = pg_temp.mm('c_nov') and consumed_at is not null),
          'single_use:class:true:true:true:true', 'no visit: one single_use / class row with the booking id, no day, no attendance id, consumed at receipt');
select is(pg_temp.stamps('c_nov'), 1, 'no visit: one stamp earned');
select is(pg_temp.att_count('c_nov'), 0, 'no visit: no attendance row written (AD-21)');
select is(pg_temp.audits('c_nov', 'session_consumed'), 1, 'no visit: one session_consumed audit row');
select is((select (metadata ->> 'validity_mode') || ':' || (metadata ->> 'covered_kind') || ':' || (metadata ->> 'covered_booking_id') || ':' || (metadata ->> 'source')
           from audit_log where action_type = 'session_consumed' and target_entity_id = pg_temp.mm('c_nov')::text),
          'single_use:class:' || pg_temp.bk('c_nov') || ':paid', 'no visit: the audit row carries validity_mode, covered_kind, covered_booking_id and source');
select is((select metadata -> 'covered_day' from audit_log where action_type = 'session_consumed' and target_entity_id = pg_temp.mm('c_nov')::text),
          'null'::jsonb, 'no visit: the audit row has no covered day');
select is(pg_temp.cm('c_nov'), 'attended', 're-mark: the second mark returns the stored booking');
select is(pg_temp.kind_count('c_nov', 'class') || '/' || pg_temp.sessions('c_nov') || '/' || pg_temp.stamps('c_nov') || '/' || pg_temp.audits('c_nov', 'session_consumed'),
          '1/1/1/1', 're-mark: nothing consumed, no stamp, no audit row');

-- A stale visit (older than the limit) is not closed by a class mark; the class consumes its own session.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_stale'));
insert into keep select 'c_stale', pg_temp.open_visit('c_stale', 181, 'visit'), null, null;
select is(pg_temp.cm('c_stale'), 'attended', 'stale visit: the class mark attends the booking');
select is(pg_temp.kind_count('c_stale', 'class') || '/' || pg_temp.kind_count('c_stale', 'visit'), '1/1', 'stale visit: the class consumed its own session, the visit session is untouched');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'c_stale')), null, 'stale visit: left open (a class mark never closes a visit)');
select is(pg_temp.att_count('c_stale') || '/' || jsonb_array_length(pg_temp.stale_audits((select att from keep where label = 'c_stale'))), '1/0', 'stale visit: no new attendance row, no stale-close audit row');

-- An open visit that no single_use session covers (opened before charging was switched on): the class consumes its own session.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_unc'));
insert into keep select 'c_unc', pg_temp.open_visit('c_unc', 30, 'none'), null, null;
select is(pg_temp.cm('c_unc'), 'attended', 'uncovered visit: the class mark attends the booking');
select is(pg_temp.kind_count('c_unc', 'class') || '/' || pg_temp.sessions('c_unc'), '1/1', 'uncovered visit: the class consumed its own session');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'c_unc')), null, 'uncovered visit: left open');

-- The 179 / 180 minute boundary (platform limit 180): the limit is judged at receipt time, a visit of exactly 180 minutes has ended.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('b179'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('b180'));
insert into keep select 'b179', pg_temp.open_visit('b179', 179, 'visit'), null, null;
insert into keep select 'b180', pg_temp.open_visit('b180', 180, 'visit'), null, null;
select is(pg_temp.cm('b179'), 'attended', '179 minutes: the class mark attends the booking');
select is(pg_temp.kind_count('b179', 'class'), 0, '179 minutes: covered by the visit, no class session');
select is(pg_temp.cm('b180'), 'attended', '180 minutes: the class mark attends the booking');
select is(pg_temp.kind_count('b180', 'class'), 1, '180 minutes: the visit has ended, the class consumed its own session');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'b180')), null, '180 minutes: the old visit is still open (only a later scan closes it)');

-- The window is the one record_check_in uses: the shorter of the gym timeout and the platform limit, both read, neither hard-coded.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_plat'));
insert into keep select 'c_plat', pg_temp.open_visit('c_plat', 100, 'visit'), null, null;
update platform_session_config set single_use_visit_limit_minutes = 90;
select is(pg_temp.cm('c_plat'), 'attended', 'platform limit 90: the class mark attends the booking');
select is(pg_temp.kind_count('c_plat', 'class'), 1, 'platform limit 90: a visit of 100 minutes no longer covers the class');
update platform_session_config set single_use_visit_limit_minutes = 180;
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_two'));
insert into keep select 'c_two', pg_temp.open_visit('c_two', 70, 'visit'), null, null;
update gyms set checkin_timeout_hours = 1 where id = pg_temp.g(1);
select is(pg_temp.cm('c_two'), 'attended', 'gym timeout 1 h: the class mark attends the booking');
select is(pg_temp.kind_count('c_two', 'class'), 1, 'gym timeout 1 h: a visit of 70 minutes (inside the limit, past the timeout) no longer covers the class');
update gyms set checkin_timeout_hours = 8 where id = pg_temp.g(1);

-- A consumed whole_day row of the day covers a class in a single_use gym (the row's own mode governs).
select pg_temp.mk_day(pg_temp.g(1), pg_temp.mm('c_day'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_day'));
insert into keep select 'c_day', null, null, pg_temp.msnap('c_day');
select is(pg_temp.cm('c_day'), 'attended', 'whole_day row: the class mark attends the booking');
select is(pg_temp.msnap('c_day'), (select h from keep where label = 'c_day'), 'whole_day row: the day row still covers the class, nothing consumed');

-- An open visit under the limit whose cover is a whole_day `day` row of YESTERDAY (a visit that began under Whole day and never closed) is not a
-- single_use visit session: it covers no class, in either gym mode. The class consumes its own session (single_use gym: a class row; whole_day gym:
-- a day row for today), never free.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('y_su'));
insert into keep select 'y_su', pg_temp.open_visit('y_su', 30, 'day'), null, null;
update guest_sessions set covered_day = covered_day - 1 where member_id = pg_temp.mm('y_su') and covered_kind = 'day';
select is(pg_temp.cm('y_su'), 'attended', 'old day-row visit, single_use gym: the class mark attends the booking');
select is(pg_temp.kind_count('y_su', 'class') || '/' || pg_temp.kind_count('y_su', 'day'), '1/1', 'old day-row visit, single_use gym: the class consumed its own class session, the open visit covered nothing');
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('y_wd'));
insert into keep select 'y_wd', pg_temp.open_visit('y_wd', 30, 'day'), null, null;
update guest_sessions set covered_day = covered_day - 1 where member_id = pg_temp.mm('y_wd') and covered_kind = 'day';
select is(pg_temp.cm('y_wd'), 'attended', 'old day-row visit, whole_day gym: the class mark attends the booking');
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mm('y_wd') and covered_kind = 'day' and covered_day = private.gym_local_date(pg_temp.g(2), now()))
          || '/' || pg_temp.kind_count('y_wd', 'day'), '1/2', 'old day-row visit, whole_day gym: the class consumed a day row for today, it was not free');

-- ============================================================================
-- Class, scan, class, class: the class session covers nothing else; a class inside the visit is free; a class after check-out consumes again.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_seq'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_seq'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_seq'));
select is(pg_temp.cm('c_seq', 1), 'attended', 'sequence: the first class consumes its own session');
select ok((pg_temp.scan('c_seq') ? 'id'), 'sequence: the member then scans in the same day');
select is(pg_temp.kind_count('c_seq', 'class') || '/' || pg_temp.kind_count('c_seq', 'visit'), '1/1', 'sequence: the scan consumed a second session as a visit (the class session covers neither the floor)');
select is(pg_temp.cm('c_seq', 2), 'attended', 'sequence: a second class inside the open visit is attended');
select is(pg_temp.kind_count('c_seq', 'class') || '/' || pg_temp.kind_count('c_seq', 'visit'), '1/1', 'sequence: and costs nothing');
select pg_temp.checkout('c_seq');
select is(pg_temp.cm('c_seq', 3), 'attended', 'sequence: a class after check-out is attended');
select is(pg_temp.kind_count('c_seq', 'class') || '/' || pg_temp.kind_count('c_seq', 'visit'), '2/1', 'sequence: a second class session consumed (no open visit)');
select is(pg_temp.stamps('c_seq'), 3, 'sequence: class, visit and class each earned a stamp, the covered class none');

-- ============================================================================
-- Denied, exempt, free, and an atomic failure.
-- ============================================================================
select is(pg_temp.cm('c_none'), 'refused', 'denied: no usable session, the caller gets the same refusal as before (attended_at stays null)');
select is(pg_temp.attended('c_none'), false, 'denied: the booking is not attended');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('c_none') and source = 'class' and class_session_id = (select cs from bks where label = 'c_none' and k = 1)), 1,
          'denied: one session_attempts row, source class, with the class session');
select is((select count(*)::int from front_desk_alerts where member_id = pg_temp.mm('c_none') and kind = 'session_required' and dismissed_at is null), 1, 'denied: one session_required alert');
select is(pg_temp.audits('c_none', 'session_attempt_blocked'), 1, 'denied: one session_attempt_blocked audit row');
select is(pg_temp.att_count('c_none') || '/' || pg_temp.sessions('c_none'), '0/0', 'denied: no attendance, no session');
select is(pg_temp.cm('c_none'), 'refused', 'denied: a second mark is refused again');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('c_none')) || '/'
          || (select count(*)::int from front_desk_alerts where member_id = pg_temp.mm('c_none') and kind = 'session_required' and dismissed_at is null), '2/1',
          'denied: every refusal counts, the alert is deduplicated');

select is(pg_temp.cm('c_zero'), 'attended', 'exempt: a price-0 plan is marked as before');
select is(pg_temp.cm('c_monthly'), 'attended', 'exempt: a member not on Pay-per-session is marked as before');
select is((select count(*)::int from guest_sessions where member_id in (pg_temp.mm('c_zero'), pg_temp.mm('c_monthly')))
          + (select count(*)::int from session_attempts where member_id in (pg_temp.mm('c_zero'), pg_temp.mm('c_monthly'))), 0, 'exempt: nothing consumed, no attempt');

select pg_temp.mk_free(pg_temp.g(1), pg_temp.mm('c_free'));
select is(pg_temp.cm('c_free'), 'attended', 'free session: the class mark attends the booking');
select is(pg_temp.kind_count('c_free', 'class'), 1, 'free session: the free session was consumed as the class session');
select is(pg_temp.stamps('c_free'), 0, 'free session: no stamp earned');
select is((select metadata ->> 'source' from audit_log where action_type = 'session_consumed' and target_entity_id = pg_temp.mm('c_free')::text), 'free',
          'free session: the audit row says free');

-- A failed attended_at update leaves no consumed session (the consume and the update share one transaction).
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_fail'));
select pg_temp.bk('c_fail');
create function public.zz_boom_28_3() returns trigger language plpgsql as $f$ begin raise exception 'boom 28.3'; end $f$;
create trigger zz_boom_28_3 before update of attended_at on class_bookings for each row execute function public.zz_boom_28_3();
select is(pg_temp.cm('c_fail'), 'error:P0001:boom 28.3', 'atomic: the attended_at update fails');
drop trigger zz_boom_28_3 on class_bookings;
select is(pg_temp.kind_count('c_fail', 'class') || '/' || pg_temp.stamps('c_fail') || '/' || pg_temp.audits('c_fail', 'session_consumed') || '/' || pg_temp.attended('c_fail')::text,
          '0/0/0/false', 'atomic: no consumed session, no stamp, no audit row, booking not attended');

-- ============================================================================
-- Voided-visit consequence (recorded, not fixed): a class marked free inside a visit stays free when staff later void that visit.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('c_void'));
select is(pg_temp.sci('c_void', 1, 'receptionist') ->> 'outcome', 'checked_in', 'voided visit: a staff check-in consumes a visit session');
select is(pg_temp.cm('c_void'), 'attended', 'voided visit: a class inside it is attended');
select is(pg_temp.kind_count('c_void', 'class'), 0, 'voided visit: the class cost nothing');
select is(pg_temp.void(pg_temp.att('c_void'), 11, 1, 'manager') ->> 'outcome', 'voided', 'voided visit: staff void the visit');
select is(pg_temp.consumed('c_void') || '/' || pg_temp.attended('c_void')::text, '0/true', 'voided visit: the session is released, the class stays attended and free');

-- ============================================================================
-- Whole day gym: a class writes a day row that also covers the floor; nothing visit- or class-shaped is ever written.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('wd_c'));
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('wd_c'));
select is(pg_temp.cm('wd_c', 1), 'attended', 'whole day: the class mark attends the booking');
select is((select validity_mode || ':' || covered_kind || ':' || (covered_day = private.gym_local_date(pg_temp.g(2), now()))::text || ':' || (covered_booking_id is null)::text
           from guest_sessions where member_id = pg_temp.mm('wd_c') and consumed_at is not null), 'whole_day:day:true:true', 'whole day: a day row, as before');
select is(pg_temp.cm('wd_c', 2), 'attended', 'whole day: a second class is attended');
select is(pg_temp.kind_count('wd_c', 'day') || '/' || pg_temp.sessions('wd_c'), '1/2', 'whole day: and costs nothing');
select ok((pg_temp.scan('wd_c') ? 'id'), 'whole day: the same day''s scan checks in');
select is(pg_temp.kind_count('wd_c', 'day') || '/' || pg_temp.sessions('wd_c'), '1/2', 'whole day: the day row covers the floor too, nothing more consumed');
select is((select count(*)::int from guest_sessions where gym_id = pg_temp.g(2) and covered_kind in ('visit', 'class')), 0, 'whole day: no visit or class row in the gym');
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('wd_s'));
select ok((pg_temp.scan('wd_s') ? 'id'), 'whole day: a scan first writes a day row');
select is(pg_temp.cm('wd_s'), 'attended', 'whole day: and the class the same day is covered');
select is(pg_temp.kind_count('wd_s', 'day') || '/' || pg_temp.sessions('wd_s'), '1/1', 'whole day: nothing more consumed');

-- ============================================================================
-- Setting flips (FR-239): a flip rewrites no row; each of the four combinations.
-- ============================================================================
-- (1) gym 3, Whole day -> Single use, with a day row.
select pg_temp.mk_paid(pg_temp.g(3), pg_temp.mm('f_day'));
select pg_temp.mk_paid(pg_temp.g(3), pg_temp.mm('f_day'));
select ok((pg_temp.scan('f_day') ? 'id'), 'flip with a day row: the member checks in under Whole day');
insert into keep select 'g3', null, null, pg_temp.gsnap(3);
select pg_temp.set_validity(3, 'single_use');
select is(pg_temp.gsnap(3), (select h from keep where label = 'g3'), 'flip with a day row: every guest_sessions row of the gym identical after the flip');
select is(pg_temp.cm('f_day'), 'attended', 'flip with a day row: a class after the flip is attended');
select is(pg_temp.gsnap(3), (select h from keep where label = 'g3'), 'flip with a day row: the day row covers the class, nothing consumed, nothing rewritten');
select pg_temp.set_validity(3, 'whole_day');
select is(pg_temp.gsnap(3), (select h from keep where label = 'g3'), 'flip with a day row: and identical again after flipping back');

-- (2) gym 4, Single use -> Whole day, with an open visit.
select pg_temp.mk_paid(pg_temp.g(4), pg_temp.mm('f_visit'));
select pg_temp.mk_paid(pg_temp.g(4), pg_temp.mm('f_visit'));
select ok((pg_temp.scan('f_visit') ? 'id'), 'flip with an open visit: the member checks in under Single use');
insert into keep select 'g4', pg_temp.att('f_visit'), (select id from guest_sessions where member_id = pg_temp.mm('f_visit') and consumed_at is not null), pg_temp.gsnap(4);
select pg_temp.set_validity(4, 'whole_day');
select is(pg_temp.gsnap(4), (select h from keep where label = 'g4'), 'flip with an open visit: every guest_sessions row of the gym identical after the flip');
select is(pg_temp.cm('f_visit'), 'attended', 'flip with an open visit: a class inside the visit after the flip is attended');
select is(pg_temp.gsnap(4), (select h from keep where label = 'g4'), 'flip with an open visit: the visit''s own session still covers it, nothing consumed');
-- The open visit ends under the rule it began with: past the limit, the next scan closes it at checked_in_at + limit although the gym is Whole day now.
update attendance_events set checked_in_at = now() - interval '181 minutes' where id = (select att from keep where label = 'g4');
select ok((pg_temp.scan('f_visit') ? 'id'), 'flip with an open visit: a scan past the limit checks in under Whole day');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'g4')),
          (select checked_in_at + interval '180 minutes' from attendance_events where id = (select att from keep where label = 'g4')),
          'flip with an open visit: the old visit closed at checked_in_at + limit (the rule it began with)');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.mm('f_visit') and consumed_at = now() and id <> (select sess from keep where label = 'g4')),
          'whole_day:day', 'flip with an open visit: the new check-in consumed a day row under the new setting');
select is((select consumed_at is not null and validity_mode = 'single_use' and covered_kind = 'visit' from guest_sessions where id = (select sess from keep where label = 'g4')), true,
          'flip with an open visit: the original visit row keeps its single_use / visit coverage');

-- (3) gym 5, Single use -> Whole day -> Single use, with a class row.
select pg_temp.mk_paid(pg_temp.g(5), pg_temp.mm('f_class'));
select pg_temp.mk_paid(pg_temp.g(5), pg_temp.mm('f_class'));
select is(pg_temp.cm('f_class', 1), 'attended', 'flip with a class row: the class consumes its own session');
insert into keep select 'g5', null, (select id from guest_sessions where member_id = pg_temp.mm('f_class') and consumed_at is not null), pg_temp.gsnap(5);
select pg_temp.set_validity(5, 'whole_day');
select is(pg_temp.gsnap(5), (select h from keep where label = 'g5'), 'flip with a class row: every guest_sessions row of the gym identical after the flip down');
select pg_temp.set_validity(5, 'single_use');
select is(pg_temp.gsnap(5), (select h from keep where label = 'g5'), 'flip with a class row: and after the flip back up');
select pg_temp.set_validity(5, 'whole_day');
select is(pg_temp.cm('f_class', 2), 'attended', 'flip with a class row: a class after the flip down is attended');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.mm('f_class') and consumed_at is not null and id <> (select sess from keep where label = 'g5')),
          'whole_day:day', 'flip with a class row: the new class consumed a day row under Whole day');
select is((select consumed_at is not null and validity_mode = 'single_use' and covered_kind = 'class' from guest_sessions where id = (select sess from keep where label = 'g5')), true,
          'flip with a class row: the earlier class row keeps its single_use / class coverage');

-- (4) gym 6, no activity, both directions.
select pg_temp.mk_paid(pg_temp.g(6), pg_temp.mm('f_none'));
select pg_temp.mk_free(pg_temp.g(6), pg_temp.mm('f_none'));
insert into keep select 'g6', null, null, pg_temp.gsnap(6);
select pg_temp.set_validity(6, 'whole_day');
select is(pg_temp.gsnap(6), (select h from keep where label = 'g6'), 'flip with no activity: identical after Single use -> Whole day');
select pg_temp.set_validity(6, 'single_use');
select is(pg_temp.gsnap(6), (select h from keep where label = 'g6'), 'flip with no activity: identical after Whole day -> Single use');

-- ============================================================================
-- Loyalty (FR-165, FR-239): one stamp per consumed paid session, none for a covered class or a free session, only while both programs are on.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('loy'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('loy'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('loy'));
select ok((pg_temp.scan('loy') ? 'id'), 'three stamps: the first visit');
select pg_temp.checkout('loy');
select ok((pg_temp.scan('loy') ? 'id'), 'three stamps: the second visit the same day');
select pg_temp.checkout('loy');
select is(pg_temp.cm('loy'), 'attended', 'three stamps: a class with no open visit');
select is(pg_temp.stamps('loy'), 3, 'three stamps: two visits and one class-with-own-session earned three stamps');
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mm('loy') and event_type = 'reward_granted'), 1, 'three stamps: the threshold of 3 granted one free session');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('loy')), 0, 'three stamps: the counter reset to 0');

select pg_temp.mk_paid(pg_temp.g(9), pg_temp.mm('nl'));
select is(pg_temp.cm('nl'), 'attended', 'loyalty off: the class consumes its own session');
select is(pg_temp.kind_count('nl', 'class') || '/' || pg_temp.stamps('nl'), '1/0', 'loyalty off: no stamp');
select pg_temp.mk_paid(pg_temp.g(10), pg_temp.mm('off'));
select is(pg_temp.cm('off'), 'attended', 'charging off: the class is marked as before');
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mm('off') and consumed_at is not null)
          + (select count(*)::int from session_attempts where member_id = pg_temp.mm('off')), 0, 'charging off: nothing consumed, no attempt');

-- Refund of a consumed class session: reverses exactly that stamp, never revokes a free session, the counter never goes below 0.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('r_cls'));
select is(pg_temp.cm('r_cls'), 'attended', 'refund: the class consumes a paid session');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('r_cls')), 1, 'refund: one stamp before');
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select pg_temp.g(1), gs.payment_id, 2000, 'class session refund', pg_temp.u(11) from guest_sessions gs where gs.member_id = pg_temp.mm('r_cls');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('r_cls')), 0, 'refund: exactly that stamp reversed');
select is((select consumed_at is not null and voided_at is null and covered_kind = 'class' from guest_sessions where member_id = pg_temp.mm('r_cls')), true,
          'refund: the class session stays consumed and keeps its class coverage');
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mm('r_cls') and event_type = 'stamp_reversed'), 1, 'refund: one stamp_reversed event');
select is((select metadata ->> 'outcome' from audit_log where action_type = 'session_refund_applied' and target_entity_id = pg_temp.mm('r_cls')::text), 'kept_consumed',
          'refund: the audit row says kept_consumed');

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('r_free'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('r_free'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('r_free'));
select is(pg_temp.cm('r_free', 1) || pg_temp.cm('r_free', 2) || pg_temp.cm('r_free', 3), 'attendedattendedattended', 'refund after a reward: three classes consume three sessions');
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mm('r_free') and event_type = 'reward_granted'), 1, 'refund after a reward: a free session was earned');
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select pg_temp.g(1), gs.payment_id, 2000, 'third class refund', pg_temp.u(11) from guest_sessions gs
where gs.member_id = pg_temp.mm('r_free') and gs.covered_booking_id = pg_temp.bk('r_free', 3);
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mm('r_free') and loyalty_grant_id is not null and voided_at is null and consumed_at is null), 1,
          'refund after a reward: the free session already earned is not taken back');
select ok((select guest_stamps >= 0 from loyalty_progress where member_id = pg_temp.mm('r_free')), 'refund after a reward: the counter never goes below 0');

-- ============================================================================
-- Paid tab columns (UX AD-22): what each consumed session covered, by the manager of the gym.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('p_unused'));
select is(pg_temp.paid_row('c_nov') ->> 'covered_kind', 'class', 'paid tab: a class row says class');
select is(pg_temp.paid_row('c_nov') ->> 'covered_booking_id', pg_temp.bk('c_nov')::text, 'paid tab: and the booking');
select is(pg_temp.paid_row('c_nov') ->> 'class_name', 'CA CLASS 1', 'paid tab: and the class name');
select is((pg_temp.paid_row('c_nov') ->> 'class_starts_at')::timestamptz, (select scheduled_at from class_sessions where id = (select cs from bks where label = 'c_nov' and k = 1)),
          'paid tab: and the class start');
select ok(pg_temp.paid_row('c_nov') ->> 'consumed_at' is not null, 'paid tab: and consumed_at');
select is(pg_temp.paid_row('c_in') ->> 'covered_kind', 'visit', 'paid tab: a visit row says visit');
select is(pg_temp.paid_row('c_in') -> 'class_name', 'null'::jsonb, 'paid tab: and has no class name');
select is(pg_temp.paid_row('wd_s') ->> 'covered_kind', 'day', 'paid tab: a day row says day');
select is(pg_temp.paid_row('p_unused') ->> 'covered_kind', null, 'paid tab: an unused session has no cover');
select is(pg_temp.paid_row('p_unused') -> 'consumed_at', 'null'::jsonb, 'paid tab: and no consumed_at');

-- ============================================================================
-- Lapse windows (FR-159, FR-166) and totals parity under each setting. Gym 7 is Whole day, gym 8 Single use, both loyalty threshold 2.
-- The same sequence on both: three paid sessions, two consumed (the second earns a free session), a control member with one unused session,
-- one member with no session who is denied at a class.
-- ============================================================================
select set_config('request.jwt.claims', '{}', true);
select pg_temp.mk_real(pg_temp.g(7), pg_temp.mm('l7'));
select pg_temp.mk_real(pg_temp.g(7), pg_temp.mm('l7'));
select pg_temp.mk_real(pg_temp.g(7), pg_temp.mm('l7'));
select pg_temp.mk_real(pg_temp.g(7), pg_temp.mm('l7c'));
select pg_temp.mk_real(pg_temp.g(8), pg_temp.mm('l8'));
select pg_temp.mk_real(pg_temp.g(8), pg_temp.mm('l8'));
select pg_temp.mk_real(pg_temp.g(8), pg_temp.mm('l8'));
select pg_temp.mk_real(pg_temp.g(8), pg_temp.mm('l8c'));
select is((select count(*)::int from guest_sessions where member_id in (pg_temp.mm('l7'), pg_temp.mm('l8')) and usable_until = now() + interval '7 days'), 6,
          'paid window: a paid session is usable for 7 days under Whole day and under Single use');
select is((select outcome from private.consume_guest_session(pg_temp.mm('l7'), pg_temp.g(7), now() - interval '1 day')), 'consumed', 'gym 7: the first consumption (yesterday) consumes a day row');
select is((select outcome from private.consume_guest_session(pg_temp.mm('l7'), pg_temp.g(7), now())), 'consumed', 'gym 7: the second consumption (today) consumes a day row');
select is((select outcome from private.consume_guest_session(pg_temp.mm('l8'), pg_temp.g(8), now(), 'class', pg_temp.bk('l8', 1))), 'consumed', 'gym 8: the first consumption consumes a class row');
select is((select outcome from private.consume_guest_session(pg_temp.mm('l8'), pg_temp.g(8), now(), 'class', pg_temp.bk('l8', 2))), 'consumed', 'gym 8: the second consumption consumes a class row');
select is((select count(*)::int from guest_sessions where member_id in (pg_temp.mm('l7'), pg_temp.mm('l8')) and loyalty_grant_id is not null and usable_until = now() + interval '60 days'), 2,
          'free window: the free session earned by the second stamp is usable for 60 days under Whole day and under Single use');
-- A member with no session is denied at a class in each gym.
select is(pg_temp.cm('d7') || pg_temp.cm('d8'), 'refusedrefused', 'parity: a denial in each gym');
select is(pg_temp.totals(7), pg_temp.totals(8), 'parity: the card (paid, blocked, blocked members, free) and the Paid tab (rows, consumed rows) are identical under Whole day and Single use');
select is(pg_temp.totals(8), '4/1/1/1/4/2', 'parity: four payments, one blocked attempt by one member, one free session, four Paid rows of which two consumed');

-- Lapse: back-date every unused session of the two lapse members; the control member keeps its window.
update guest_sessions set created_at = now() - interval '70 days', usable_until = now() - interval '1 day'
where member_id in (pg_temp.mm('l7'), pg_temp.mm('l8')) and consumed_at is null;
select set_config('request.jwt.claims', '{}', true);
select run_loyalty_sweep_job();
select is((select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
           where e.event_type = 'lapse' and s.member_id = pg_temp.mm('l7') and s.payment_id is not null), 1, 'lapse, Whole day: the unused paid session lapsed');
select is((select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
           where e.event_type = 'lapse' and s.member_id = pg_temp.mm('l8') and s.payment_id is not null), 1, 'lapse, Single use: the unused paid session lapsed');
select is((select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
           where e.event_type = 'lapse' and s.member_id = pg_temp.mm('l7') and s.loyalty_grant_id is not null), 1, 'lapse, Whole day: the unused free session lapsed');
select is((select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
           where e.event_type = 'lapse' and s.member_id = pg_temp.mm('l8') and s.loyalty_grant_id is not null), 1, 'lapse, Single use: the unused free session lapsed');
select is(pg_temp.audits('l7', 'loyalty_paid_session_lapsed') || '/' || pg_temp.audits('l7', 'loyalty_free_session_lapsed') || '/'
          || pg_temp.audits('l8', 'loyalty_paid_session_lapsed') || '/' || pg_temp.audits('l8', 'loyalty_free_session_lapsed'), '1/1/1/1', 'lapse: one audit row per lapsed session, the same under either setting');
select is((select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
           where e.event_type = 'lapse' and s.consumed_at is not null and s.gym_id in (pg_temp.g(7), pg_temp.g(8))), 0, 'lapse: a consumed row (day or class) is never lapsed');
select is((select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
           where e.event_type = 'lapse' and s.member_id in (pg_temp.mm('l7c'), pg_temp.mm('l8c'))), 0, 'lapse: a session still inside its 7 days is not lapsed');

select * from finish();
rollback;
