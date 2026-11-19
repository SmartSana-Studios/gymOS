-- Story 28.2: single-use consumption at check-in (migration 0178), positive paths. Refusals, backstops, tenant isolation and the source scans live
-- in single_use_check_in.negative.test.sql.
--
-- Covers: morning and evening visits, the double scan, the 179/180/181 boundary and the same boundary at 89/90/91 after the platform value is
-- changed directly (audited, read by the next scan), a gym timeout shorter than the limit, an uncovered and a Whole-day-covered open visit
-- (timeout alone), a forgotten check-out with and without a usable session, offline replay / late / denied, the staff path and the staff void
-- (voidable with a later same-day visit), a whole_day gym and a charging-off gym unchanged, exempt members, the setting flipped both ways mid-day
-- and mid-visit, occupancy and the auto-timeout job at limit + 1 minute, the class guard (pinned) and the class pass-through in a whole_day
-- gym, and the engagement counts.
--
-- pgTAP runs one session and one transaction: now() is constant, so every age below is exact. The helpers switch to the caller's role themselves,
-- so every assertion runs as the table owner.
--
-- Fixture ids: 00000000-0000-0000-0000-00000028[21-24]xx. Gyms 2821nn, users 2822nn, members 2823nn, plans 2824nn.

begin;
select plan(170);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002821' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002822' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002823' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.p(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002824' || lpad(to_hex(n), 2, '0'))::uuid $f$;

create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

-- label -> member number, gym number, plan kind
create temp table fx (label text primary key, n int not null, gym int not null, plan text not null);
insert into fx values
  -- gym 1 (single_use, charging, loyalty threshold 3, timeout 8 h)
  ('morn', 101, 1, 'pps'), ('dbl', 102, 1, 'pps'), ('b179', 103, 1, 'pps'), ('b180', 104, 1, 'pps'), ('b181', 105, 1, 'pps'),
  ('nocover', 106, 1, 'pps'), ('daycover', 107, 1, 'pps'), ('unc_stale', 108, 1, 'pps'), ('nosess', 109, 1, 'pps'),
  ('off_replay', 110, 1, 'pps'), ('off_late', 111, 1, 'pps'), ('off_denied', 112, 1, 'pps'), ('off_dbl', 123, 1, 'pps'), ('staff_a', 113, 1, 'pps'),
  ('void_m', 114, 1, 'pps'), ('monthly', 115, 1, 'monthly'), ('zero', 116, 1, 'zero'), ('p89', 117, 1, 'pps'), ('p90', 118, 1, 'pps'),
  ('p91', 119, 1, 'pps'), ('class_m', 120, 1, 'pps'), ('exempt_open', 121, 1, 'monthly'), ('voided_cover', 122, 1, 'pps'),
  -- gym 2 (whole_day, charging)
  ('wd', 130, 2, 'pps'), ('wd_class', 131, 2, 'pps'),
  -- gym 3 (single_use, charging OFF)
  ('off', 140, 3, 'pps'),
  -- gym 4 (single_use, charging, timeout 2 h)
  ('sh119', 150, 4, 'pps'), ('sh121', 151, 4, 'pps'),
  -- gym 5 (whole_day, flipped up), gym 6 (single_use, flipped down)
  ('flip_a', 160, 5, 'pps'), ('flip_b', 170, 6, 'pps'),
  -- gym 7 (single_use, capacity 2): occupancy and the auto-timeout job
  ('occ1', 180, 7, 'pps'), ('occ2', 181, 7, 'pps'),
  -- gym 8 (single_use, charging, timeout 3 h = the platform limit of 180 minutes)
  ('eq180', 190, 8, 'pps');

create function pg_temp.mm(p_label text) returns uuid language sql stable as $f$ select pg_temp.m(n) from fx where label = p_label $f$;
create function pg_temp.gg(p_label text) returns uuid language sql stable as $f$ select pg_temp.g(gym) from fx where label = p_label $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000282101', 'SU Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, capacity,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days, session_validity, checkin_timeout_hours) values
  (pg_temp.g(1), 'SU Gym 1', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 30, true,  3, 3, 1, 'single_use', 8),
  (pg_temp.g(2), 'SU Gym 2', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'whole_day', 8),
  (pg_temp.g(3), 'SU Gym 3', '00000000-0000-0000-0000-000000282101', 'active', false, 0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8),
  (pg_temp.g(4), 'SU Gym 4', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 2),
  (pg_temp.g(5), 'SU Gym 5', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'whole_day', 8),
  (pg_temp.g(6), 'SU Gym 6', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 8),
  (pg_temp.g(7), 'SU Gym 7', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 2,  false, null, null, null, 'single_use', 8),
  (pg_temp.g(8), 'SU Gym 8', '00000000-0000-0000-0000-000000282101', 'active', true,  0, 'Africa/Douala', 30, false, null, null, null, 'single_use', 3);

insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'su-' || n || '@x.example', now() from generate_series(1, 200) n;

-- Staff: 1 receptionist G1, 2 manager G1, 3 manager G2, 4 coach G1, 5 coach G2.
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, 'SU Staff ' || s.n, current_date
from (values (1, pg_temp.g(1), 'receptionist'), (2, pg_temp.g(1), 'manager'), (3, pg_temp.g(2), 'manager'),
             (4, pg_temp.g(1), 'coach'), (5, pg_temp.g(2), 'coach')) as s(n, gym, role);

insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(f.n), pg_temp.g(f.gym), pg_temp.u(f.n), 'member', 'SU ' || f.label, current_date from fx f;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
select pg_temp.p(g), pg_temp.g(g), 'SU PPS ' || g, 'pay_per_session', 2000, 'XAF', 'monthly', null from generate_series(1, 8) g;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  (pg_temp.p(21), pg_temp.g(1), 'SU Monthly', 'monthly',         15000, 'XAF', 'monthly', 30),
  (pg_temp.p(22), pg_temp.g(1), 'SU PPS 0',   'pay_per_session', 0,     'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select pg_temp.g(f.gym), pg_temp.m(f.n),
       case f.plan when 'monthly' then pg_temp.p(21) when 'zero' then pg_temp.p(22) else pg_temp.p(f.gym) end,
       'active', current_date, case f.plan when 'monthly' then current_date + 30 end
from fx f;

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

-- The platform visit limit starts at its default.
select is((select single_use_visit_limit_minutes from platform_session_config), 180, 'the platform visit limit is the default 180 minutes');

-- ============================================================================
-- Morning and evening (gym 1, single_use): two usable sessions, two visits the same day.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('morn'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('morn'));

create temp table keep (label text primary key, att uuid, sess uuid);

select ok((pg_temp.scan('morn') ? 'id'), 'morning: the member checks in');
insert into keep select 'morn1', pg_temp.att('morn'), (select id from guest_sessions where member_id = pg_temp.mm('morn') and consumed_at is not null);
select is(pg_temp.consumed('morn'), 1, 'morning: exactly one session consumed');
select is(
  (select validity_mode || ':' || covered_kind || ':' || (covered_day is null)::text || ':' || (consumed_at = now())::text
   from guest_sessions where id = (select sess from keep where label = 'morn1')),
  'single_use:visit:true:true',
  'morning: the row is single_use / visit, has no covered_day and is consumed at receipt time');
select is((select covered_attendance_id from guest_sessions where id = (select sess from keep where label = 'morn1')),
          (select att from keep where label = 'morn1'), 'morning: covered_attendance_id is the new attendance row');
select lives_ok($$ set constraints guest_sessions_visit_has_attendance immediate $$, 'morning: the deferred visit constraint passes (the id was set in the same transaction)');
set constraints guest_sessions_visit_has_attendance deferred;
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('morn')), 1, 'morning: one guest stamp earned');
select is((select count(*)::int from audit_log where action_type = 'session_consumed' and target_entity_id = pg_temp.mm('morn')::text
           and metadata ->> 'covered_kind' = 'visit' and metadata ->> 'validity_mode' = 'single_use' and metadata -> 'covered_day' = 'null'::jsonb), 1,
          'morning: one session_consumed audit row, single_use / visit, no covered day');

select pg_temp.checkout('morn');
select ok((pg_temp.scan('morn') ? 'id'), 'evening: the member checks in again the same day');
insert into keep select 'morn2', (select id from attendance_events where member_id = pg_temp.mm('morn') and id <> (select att from keep where label = 'morn1')), (select id from guest_sessions where member_id = pg_temp.mm('morn') and consumed_at is not null
                                                       and id <> (select sess from keep where label = 'morn1'));
select is(pg_temp.consumed('morn'), 2, 'evening: a second session consumed');
select is((select covered_attendance_id from guest_sessions where id = (select sess from keep where label = 'morn2')),
          (select att from keep where label = 'morn2'), 'evening: the second visit row is bound to the new attendance id');
select isnt((select att from keep where label = 'morn1'), (select att from keep where label = 'morn2'), 'evening: a different attendance row');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('morn')), 2, 'evening: a second stamp earned');
select is((select count(*)::int from attendance_counted where member_id = pg_temp.mm('morn')), 2, 'engagement: two attendance_counted rows for the two visits');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.mm('morn')), 1, 'engagement: one member_visit_days row for the day');
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mm('morn') and covered_day is not null), 0, 'morning and evening: no covered_day anywhere (the one-per-day index never applies)');

-- ============================================================================
-- Double scan: an open visit younger than the limit is "already checked in" before the consume function runs.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('dbl'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('dbl'));
select ok((pg_temp.scan('dbl') ? 'id'), 'double scan: the first scan checks in');
insert into keep select 'dbl1', pg_temp.att('dbl'), (select id from guest_sessions where member_id = pg_temp.mm('dbl') and consumed_at is not null);
select is(pg_temp.err(pg_temp.scan('dbl')), 'P0001:check_in: member ' || pg_temp.mm('dbl') || ' already has an open check-in', 'double scan: the second scan is "already has an open check-in"');
select is(pg_temp.err(pg_temp.scan('dbl')), 'P0001:check_in: member ' || pg_temp.mm('dbl') || ' already has an open check-in', 'double scan: and a third (a second device)');
select is(pg_temp.consumed('dbl'), 1, 'double scan: only one session consumed');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('dbl')), 0, 'double scan: no attempt row');
select is((select count(*)::int from front_desk_alerts where member_id = pg_temp.mm('dbl')), 0, 'double scan: no front-desk alert');
select is((select covered_attendance_id from guest_sessions where id = (select sess from keep where label = 'dbl1')), (select att from keep where label = 'dbl1'),
          'double scan: the first visit''s covered_attendance_id is unchanged');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mm('dbl')), 1, 'double scan: one attendance row');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('dbl')), 1, 'double scan: one stamp');

-- ============================================================================
-- Boundary 179 / 180 / 181 minutes (platform limit 180).
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('b179'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('b180'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('b181'));
insert into keep select 'b179', pg_temp.open_visit('b179', 179, 'visit'), null;
insert into keep select 'b180', pg_temp.open_visit('b180', 180, 'visit'), null;
insert into keep select 'b181', pg_temp.open_visit('b181', 181, 'visit'), null;

select is(pg_temp.err(pg_temp.scan('b179')), 'P0001:check_in: member ' || pg_temp.mm('b179') || ' already has an open check-in', '179 minutes: rejected as already checked in');
select is(pg_temp.consumed('b179'), 1, '179 minutes: nothing consumed (only the cover is consumed)');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'b179')), null, '179 minutes: the open visit stays open');
select is(pg_temp.stale_audits((select att from keep where label = 'b179')), '[]'::jsonb, '179 minutes: no stale-close audit row');

select ok((pg_temp.scan('b180') ? 'id'), '180 minutes: the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'b180')),
          (select checked_in_at + interval '180 minutes' from attendance_events where id = (select att from keep where label = 'b180')),
          '180 minutes: the old visit closed at checked_in_at + limit exactly');
select is((select checkout_type from attendance_events where id = (select att from keep where label = 'b180')), 'auto', '180 minutes: closed as auto');
select ok((select checked_out_at <= (select checked_in_at from attendance_events where id = pg_temp.att('b180'))
           from attendance_events where id = (select att from keep where label = 'b180')), '180 minutes: never closed after the new check-in began');
select is((select jsonb_array_length(pg_temp.stale_audits((select att from keep where label = 'b180')))), 1, '180 minutes: one stale-close audit row');
select is((pg_temp.stale_audits((select att from keep where label = 'b180')) -> 0) ->> 'reason', 'visit_limit', '180 minutes: the audit reason is visit_limit');
select is((pg_temp.stale_audits((select att from keep where label = 'b180')) -> 0) ->> 'visit_limit_minutes', '180', '180 minutes: the audit carries visit_limit_minutes');
select is(pg_temp.consumed('b180'), 2, '180 minutes: a new session consumed for the new visit');
select is((select covered_attendance_id from guest_sessions where member_id = pg_temp.mm('b180') and consumed_at = now()), pg_temp.att('b180'),
          '180 minutes: the new session covers the new visit');

select ok((pg_temp.scan('b181') ? 'id'), '181 minutes: the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'b181')),
          (select checked_in_at + interval '180 minutes' from attendance_events where id = (select att from keep where label = 'b181')),
          '181 minutes: closed at checked_in_at + limit, not at receipt time');
select is((select (pg_temp.stale_audits((select att from keep where label = 'b181')) -> 0) ->> 'reason'), 'visit_limit', '181 minutes: audited as visit_limit');
select is(pg_temp.consumed('b181'), 2, '181 minutes: a new session consumed');

-- ============================================================================
-- A gym timeout shorter than the limit (gym 4, 2 h): the earlier of the two applies and the audit row carries no visit_limit reason.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(4), pg_temp.mm('sh119'));
select pg_temp.mk_paid(pg_temp.g(4), pg_temp.mm('sh121'));
insert into keep select 'sh119', pg_temp.open_visit('sh119', 119, 'visit'), null;
insert into keep select 'sh121', pg_temp.open_visit('sh121', 121, 'visit'), null;
select is(pg_temp.err(pg_temp.scan('sh119')), 'P0001:check_in: member ' || pg_temp.mm('sh119') || ' already has an open check-in', 'timeout 2 h: a visit of 119 minutes is still open');
select ok((pg_temp.scan('sh121') ? 'id'), 'timeout 2 h: a visit of 121 minutes is stale and the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'sh121')),
          (select checked_in_at + interval '2 hours' from attendance_events where id = (select att from keep where label = 'sh121')),
          'timeout 2 h: closed at checked_in_at + timeout');
select is(((pg_temp.stale_audits((select att from keep where label = 'sh121')) -> 0) ? 'reason'), false, 'timeout 2 h: no visit_limit reason when the timeout is the binding window');
select is((pg_temp.stale_audits((select att from keep where label = 'sh121')) -> 0) ->> 'timeout_hours', '2', 'timeout 2 h: the audit keeps its timeout_hours');
select is(pg_temp.consumed('sh121'), 2, 'timeout 2 h: a new session consumed');

-- ============================================================================
-- Timeout equal to the limit (gym 8: 3 h = 180 minutes): the limit is the binding window, so the audit row carries visit_limit.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(8), pg_temp.mm('eq180'));
insert into keep select 'eq180', pg_temp.open_visit('eq180', 181, 'visit'), null;
select ok((pg_temp.scan('eq180') ? 'id'), 'timeout = limit: a visit of 181 minutes is stale and the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'eq180')),
          (select checked_in_at + interval '180 minutes' from attendance_events where id = (select att from keep where label = 'eq180')),
          'timeout = limit: closed at checked_in_at + 180 minutes');
select is((select checkout_type from attendance_events where id = (select att from keep where label = 'eq180')), 'auto', 'timeout = limit: closed as auto');
select is((pg_temp.stale_audits((select att from keep where label = 'eq180')) -> 0) ->> 'reason', 'visit_limit', 'timeout = limit: the audit reason is visit_limit (the limit binds when limit <= timeout)');
select is((pg_temp.stale_audits((select att from keep where label = 'eq180')) -> 0) ->> 'visit_limit_minutes', '180', 'timeout = limit: the audit carries visit_limit_minutes 180');
select is(pg_temp.consumed('eq180'), 2, 'timeout = limit: a new session consumed for the new visit');

-- ============================================================================
-- Open visits with no single_use cover: the timeout alone (A2).
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('nocover'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('daycover'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('unc_stale'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('voided_cover'));
insert into keep select 'nocover', pg_temp.open_visit('nocover', 200, 'none'), null;
insert into keep select 'daycover', pg_temp.open_visit('daycover', 200, 'day'), null;
insert into keep select 'unc_stale', pg_temp.open_visit('unc_stale', 540, 'none'), null;
insert into keep select 'voided_cover', pg_temp.open_visit('voided_cover', 200, 'visit'), null;
update guest_sessions set voided_at = now() where member_id = pg_temp.mm('voided_cover') and consumed_at is not null;

select is(pg_temp.err(pg_temp.scan('nocover')), 'P0001:check_in: member ' || pg_temp.mm('nocover') || ' already has an open check-in', 'uncovered open visit past the limit: still already checked in (timeout alone)');
select is(pg_temp.consumed('nocover'), 0, 'uncovered open visit: nothing consumed');
select is(pg_temp.err(pg_temp.scan('daycover')), 'P0001:check_in: member ' || pg_temp.mm('daycover') || ' already has an open check-in', 'Whole-day-covered open visit past the limit: still already checked in');
select is(pg_temp.err(pg_temp.scan('voided_cover')), 'P0001:check_in: member ' || pg_temp.mm('voided_cover') || ' already has an open check-in', 'open visit whose single_use cover is voided: the limit does not apply');
select ok((pg_temp.scan('unc_stale') ? 'id'), 'uncovered open visit past the timeout: the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'unc_stale')),
          (select checked_in_at + interval '8 hours' from attendance_events where id = (select att from keep where label = 'unc_stale')),
          'uncovered open visit past the timeout: closed at checked_in_at + timeout');
select is(((pg_temp.stale_audits((select att from keep where label = 'unc_stale')) -> 0) ? 'reason'), false, 'uncovered stale close: the audit row is exactly today''s (no reason key)');
select is(pg_temp.consumed('unc_stale'), 1, 'uncovered stale close: the new visit consumed one session');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.mm('unc_stale') and consumed_at is not null), 'single_use:visit',
          'uncovered stale close: the new session is a single_use visit');

-- ============================================================================
-- Forgotten check-out, no usable session: the stale close commits with the denial; after payment a rescan succeeds.
-- ============================================================================
insert into keep select 'nosess', pg_temp.open_visit('nosess', 181, 'visit'), null;
select is(pg_temp.scan('nosess'), '{"denied": true}'::jsonb, 'forgotten check-out, no session: the scan is denied (null)');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'nosess')),
          (select checked_in_at + interval '180 minutes' from attendance_events where id = (select att from keep where label = 'nosess')),
          'forgotten check-out, no session: the stale close committed at checked_in_at + limit');
select is((select checkout_type from attendance_events where id = (select att from keep where label = 'nosess')), 'auto', 'forgotten check-out: closed as auto');
select is((pg_temp.stale_audits((select att from keep where label = 'nosess')) -> 0) ->> 'reason', 'visit_limit', 'forgotten check-out: audited as visit_limit');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('nosess') and source = 'check_in'), 1, 'forgotten check-out: one check_in attempt');
select is((select count(*)::int from front_desk_alerts where member_id = pg_temp.mm('nosess') and kind = 'session_required' and dismissed_at is null), 1, 'forgotten check-out: one session_required alert');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mm('nosess')), 1, 'forgotten check-out: no new attendance row');
select is((select count(*)::int from attendance_counted where member_id = pg_temp.mm('nosess') and checked_in_at > now() - interval '1 minute'), 0, 'engagement: a denied scan adds no counted row');
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('nosess'));
select ok((pg_temp.scan('nosess') ? 'id'), 'forgotten check-out: after the desk records the payment a rescan checks in');
select is(pg_temp.consumed('nosess'), 2, 'forgotten check-out: the rescan consumed the new session');

-- ============================================================================
-- Offline scans.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('off_replay'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('off_replay'));
create temp table scanned (label text primary key, res jsonb);
insert into scanned select 'replay1', pg_temp.scan('off_replay', now() - interval '10 minutes', '00000000-0000-0000-0000-0000002828a1');
select ok((select res ? 'id' from scanned where label = 'replay1'), 'offline replay: the first sync checks in');
select is((select checked_in_at from attendance_events where member_id = pg_temp.mm('off_replay')), now() - interval '10 minutes', 'offline replay: the honoured scan time is kept');
select is(pg_temp.scan('off_replay', now() - interval '10 minutes', '00000000-0000-0000-0000-0000002828a1') ->> 'id', (select res ->> 'id' from scanned where label = 'replay1'),
          'offline replay: the same scan id returns the stored row');
select is(pg_temp.consumed('off_replay'), 1, 'offline replay: the replay consumed nothing more');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mm('off_replay')), 1, 'offline replay: one attendance row');

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('off_late'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('off_late'));
insert into scanned select 'late1', pg_temp.scan('off_late', now() - interval '200 minutes', '00000000-0000-0000-0000-0000002828a2');
select ok((select res ? 'id' from scanned where label = 'late1'), 'offline late: a scan older than the limit at receipt checks in');
select is(pg_temp.consumed('off_late'), 1, 'offline late: it consumed one session');
select is((select checked_in_at from attendance_events where member_id = pg_temp.mm('off_late')), now() - interval '200 minutes', 'offline late: the honoured scan time is kept');
select is((select checked_out_at from attendance_events where member_id = pg_temp.mm('off_late')), now() - interval '200 minutes' + interval '180 minutes',
          'offline late: recorded closed at scan time + limit');
select is((select checkout_type from attendance_events where member_id = pg_temp.mm('off_late')), 'auto', 'offline late: closed as auto');
select is((select metadata ->> 'reason' || ':' || (metadata ->> 'visit_limit_minutes') || ':' || (metadata ->> 'source') from audit_log
           where action_type = 'attendance_stale_check_in_auto_closed' and target_entity_id = pg_temp.att('off_late')::text),
          'visit_limit:180:offline_sync', 'offline late: the immediate close is audited with the limit and its offline source');
select is((select visit_day from attendance_events where member_id = pg_temp.mm('off_late')), private.gym_local_date(pg_temp.g(1), now() - interval '200 minutes'),
          'engagement: a late visit takes the gym-local day of its honoured time');
select ok((pg_temp.scan('off_late') ? 'id'), 'offline late: it does not block a later scan');
select is(pg_temp.consumed('off_late'), 2, 'offline late: the later scan consumed the second session');

-- Two offline scans inside one visit, both synced after the limit lapsed: one session (28.2 review). A at -200 min is closed on arrival at
-- -20 min; B at -199 min lies inside that closed visit and consumes nothing; C at -19 min is after it and is a new visit.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('off_dbl'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('off_dbl'));
insert into scanned select 'dblA', pg_temp.scan('off_dbl', now() - interval '200 minutes', '00000000-0000-0000-0000-0000002828b1');
insert into scanned select 'dblB', pg_temp.scan('off_dbl', now() - interval '199 minutes', '00000000-0000-0000-0000-0000002828b2');
select ok((select res ? 'id' from scanned where label = 'dblB'), 'offline double: the second scan inside the closed visit checks in');
select is(pg_temp.consumed('off_dbl'), 1, 'offline double: both scans cost one session');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mm('off_dbl')), 2, 'offline double: both scans are recorded');
select is((select checked_out_at from attendance_events where client_scan_id = '00000000-0000-0000-0000-0000002828b2'),
          (select checked_out_at from attendance_events where client_scan_id = '00000000-0000-0000-0000-0000002828b1'),
          'offline double: the second scan is closed with the visit it belongs to');
select is((select checkout_type from attendance_events where client_scan_id = '00000000-0000-0000-0000-0000002828b2'), 'auto', 'offline double: closed as auto');
select is((select metadata ->> 'reason' || ':' || (metadata ->> 'source') from audit_log
           where action_type = 'attendance_stale_check_in_auto_closed'
             and target_entity_id = (select id::text from attendance_events where client_scan_id = '00000000-0000-0000-0000-0000002828b2')),
          'inside_closed_visit:offline_sync', 'offline double: the close is audited with its reason and offline source');
insert into scanned select 'dblC', pg_temp.scan('off_dbl', now() - interval '19 minutes', '00000000-0000-0000-0000-0000002828b3');
select is(pg_temp.consumed('off_dbl'), 2, 'offline double: a scan after the closed visit is a new visit and consumes the second session');

insert into scanned select 'den1',pg_temp.scan('off_denied', now() - interval '5 minutes', '00000000-0000-0000-0000-0000002828a3');
select is((select res from scanned where label = 'den1'), '{"denied": true}'::jsonb, 'offline denied: no usable session, the sync is denied');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('off_denied') and scan_id = '00000000-0000-0000-0000-0000002828a3'), 1, 'offline denied: one attempt keyed by its scan id');
select is(pg_temp.scan('off_denied', now() - interval '5 minutes', '00000000-0000-0000-0000-0000002828a3'), '{"denied": true}'::jsonb, 'offline denied: the replay is denied again');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('off_denied')), 1, 'offline denied: the replay did not add an attempt');
select is((select count(*)::int from front_desk_alerts where member_id = pg_temp.mm('off_denied') and kind = 'session_required' and dismissed_at is null), 1, 'offline denied: the FR-160 alert is raised');

-- ============================================================================
-- Staff path: same rules, source staff, no alert.
-- ============================================================================
select is(pg_temp.sci('staff_a', 1, 'receptionist') ->> 'outcome', 'session_required', 'staff: a guest with no session is refused');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('staff_a') and source = 'staff'), 1, 'staff: one staff attempt');
select is((select count(*)::int from front_desk_alerts where member_id = pg_temp.mm('staff_a')), 0, 'staff: no front-desk alert (FR-249)');
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('staff_a'));
create temp table staffres (label text primary key, res jsonb);
insert into staffres select 'a1', pg_temp.sci('staff_a', 1, 'receptionist');
select is((select res ->> 'outcome' from staffres where label = 'a1'), 'checked_in', 'staff: after the desk payment the check-in completes');
select is(pg_temp.consumed('staff_a'), 1, 'staff: one session consumed');
select is((select covered_attendance_id from guest_sessions where member_id = pg_temp.mm('staff_a') and consumed_at is not null), ((select res ->> 'attendance_id' from staffres where label = 'a1'))::uuid,
          'staff: the session covers the staff entry');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.mm('staff_a') and consumed_at is not null), 'single_use:visit', 'staff: a single_use visit session');
select is(pg_temp.sci('staff_a', 1, 'receptionist') ->> 'outcome', 'already_checked_in', 'staff: a second check-in during the visit is already_checked_in');
select is(pg_temp.consumed('staff_a'), 1, 'staff: and costs nothing');

-- Void with a later same-day visit.
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('void_m'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('void_m'));
select is(pg_temp.sci('void_m', 1, 'receptionist') ->> 'outcome', 'checked_in', 'void: the first staff visit');
insert into keep select 'void1', pg_temp.att('void_m'), (select id from guest_sessions where member_id = pg_temp.mm('void_m') and consumed_at is not null);
select pg_temp.checkout('void_m');
select is(pg_temp.sci('void_m', 1, 'receptionist') ->> 'outcome', 'checked_in', 'void: the second staff visit the same day');
insert into keep select 'void2', (select id from attendance_events where member_id = pg_temp.mm('void_m') and id <> (select att from keep where label = 'void1')), (select id from guest_sessions where member_id = pg_temp.mm('void_m') and consumed_at is not null
                                                         and id <> (select sess from keep where label = 'void1'));
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('void_m')), 2, 'void: two stamps before the void');
select is(pg_temp.void((select att from keep where label = 'void1'), 2, 1, 'manager') - 'attendance_id' - 'voided_at',
          '{"outcome":"voided","session_released":true,"stamp_removed":true}'::jsonb,
          'void: the first visit is voidable although a later same-day visit exists, and releases exactly its session');
select is((select (consumed_at is null and validity_mode is null and covered_kind is null and covered_day is null and covered_attendance_id is null and voided_at is null)
           from guest_sessions where id = (select sess from keep where label = 'void1')), true, 'void: the session is Unused again, every cover column cleared');
select is((select consumed_at is not null and covered_attendance_id = (select att from keep where label = 'void2') from guest_sessions where id = (select sess from keep where label = 'void2')), true,
          'void: the later visit''s session is untouched');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mm('void_m')), 1, 'void: exactly one stamp reversed');
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mm('void_m') and event_type = 'stamp_reversed' and origin_id = (select sess from keep where label = 'void1')), 1,
          'void: the stamp_reversed event is for the voided visit''s session');
select is((select count(*)::int from attendance_counted where member_id = pg_temp.mm('void_m')), 1, 'void: the voided visit leaves the counted rows');

-- ============================================================================
-- Whole-day gym: byte-for-byte today's behaviour.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('wd'));
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('wd'));
select ok((pg_temp.scan('wd') ? 'id'), 'whole_day: check in');
select pg_temp.checkout('wd');
select ok((pg_temp.scan('wd') ? 'id'), 'whole_day: check out and in again');
select is(pg_temp.consumed('wd'), 1, 'whole_day: one consumed session');
select is((select validity_mode || ':' || covered_kind || ':' || (covered_day = private.gym_local_date(pg_temp.g(2), now()))::text from guest_sessions
           where member_id = pg_temp.mm('wd') and consumed_at is not null), 'whole_day:day:true', 'whole_day: a day row covering the gym-local day');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mm('wd')), 2, 'whole_day: two attendance rows');
select is((select count(*)::int from guest_sessions where gym_id = pg_temp.g(2) and covered_kind = 'visit'), 0, 'whole_day: no visit row is ever written');
select is((select covered_attendance_id from guest_sessions where member_id = pg_temp.mm('wd') and consumed_at is not null),
          (select id from attendance_events where member_id = pg_temp.mm('wd') order by checked_in_at, created_at limit 1), 'whole_day: the day row links the first entry (0175 behaviour)');

-- ============================================================================
-- Charging off (gym 3, single_use setting): no session, no limit.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(3), pg_temp.mm('off'));
insert into keep select 'off', pg_temp.open_visit('off', 200, 'none'), null;
select is(pg_temp.err(pg_temp.scan('off')), 'P0001:check_in: member ' || pg_temp.mm('off') || ' already has an open check-in', 'charging off: an open visit past the limit is still open (no limit)');
select pg_temp.checkout('off');
select ok((pg_temp.scan('off') ? 'id'), 'charging off: a new scan checks in');
select is(pg_temp.consumed('off'), 0, 'charging off: nothing consumed');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mm('off')), 0, 'charging off: no attempt');

-- ============================================================================
-- Exempt members in a single_use gym: nothing touched, no limit.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('monthly'));
select ok((pg_temp.scan('monthly') ? 'id'), 'exempt (monthly plan): checks in');
select pg_temp.checkout('monthly');
select ok((pg_temp.scan('monthly') ? 'id'), 'exempt (monthly plan): checks in again');
select is(pg_temp.consumed('monthly'), 0, 'exempt (monthly plan): the usable session is untouched');
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('zero'));
select ok((pg_temp.scan('zero') ? 'id'), 'exempt (price 0): checks in');
select is(pg_temp.consumed('zero'), 0, 'exempt (price 0): nothing consumed');
insert into keep select 'exempt_open', pg_temp.open_visit('exempt_open', 200, 'none'), null;
select is(pg_temp.err(pg_temp.scan('exempt_open')), 'P0001:check_in: member ' || pg_temp.mm('exempt_open') || ' already has an open check-in', 'exempt: an open visit past the limit is still open');
select is((select count(*)::int from session_attempts where member_id in (pg_temp.mm('monthly'), pg_temp.mm('zero'), pg_temp.mm('exempt_open'))), 0, 'exempt: no attempts');

-- ============================================================================
-- The setting flipped mid-day and mid-visit.
-- ============================================================================
-- Whole day -> Single use (gym 5).
select pg_temp.mk_paid(pg_temp.g(5), pg_temp.mm('flip_a'));
select pg_temp.mk_paid(pg_temp.g(5), pg_temp.mm('flip_a'));
select ok((pg_temp.scan('flip_a') ? 'id'), 'flip up: the 09:00 check-in consumes a day session');
select is((select validity_mode from guest_sessions where member_id = pg_temp.mm('flip_a') and consumed_at is not null), 'whole_day', 'flip up: that row is whole_day');
select pg_temp.checkout('flip_a');
select pg_temp.set_validity(5, 'single_use');
select is((select session_validity from gyms where id = pg_temp.g(5)), 'single_use', 'flip up: the gym is now single_use');
select ok((pg_temp.scan('flip_a') ? 'id'), 'flip up: the 11:00 return checks in');
select is(pg_temp.consumed('flip_a'), 1, 'flip up: the day row still covers the later check-in, nothing consumed');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mm('flip_a')), 2, 'flip up: both visits have an attendance row');
select is((select outcome from private.consume_guest_session(pg_temp.m(160), pg_temp.g(5), now() + interval '1 day')), 'consumed', 'flip up: the next day consumes a session');
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mm('flip_a') and validity_mode = 'single_use' and covered_kind = 'visit' and covered_day is null), 1,
          'flip up: the next-day session is a single_use visit');
-- (That direct call has no attendance id; the deferred constraint is only checked at commit, and this file rolls back.)

-- Single use -> Whole day with a visit open (gym 6).
select pg_temp.mk_paid(pg_temp.g(6), pg_temp.mm('flip_b'));
insert into keep select 'flip_b', pg_temp.open_visit('flip_b', 181, 'visit'), null;
select pg_temp.set_validity(6, 'whole_day');
select ok((pg_temp.scan('flip_b') ? 'id'), 'flip down: a scan after the limit checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'flip_b')),
          (select checked_in_at + interval '180 minutes' from attendance_events where id = (select att from keep where label = 'flip_b')),
          'flip down: the open visit finished under the limit rule it began with');
select is((select (pg_temp.stale_audits((select att from keep where label = 'flip_b')) -> 0) ->> 'reason'), 'visit_limit', 'flip down: audited as visit_limit');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.mm('flip_b') and consumed_at = now()), 'whole_day:day', 'flip down: the new session is a day row');
select pg_temp.checkout('flip_b');
select pg_temp.mk_paid(pg_temp.g(6), pg_temp.mm('flip_b'));
select ok((pg_temp.scan('flip_b') ? 'id'), 'flip down: a later same-day return after check-out checks in');
select is(pg_temp.consumed('flip_b'), 2, 'flip down: the day row covers the rest of the day (the visit cover plus one day row)');

-- ============================================================================
-- Occupancy and the auto-timeout job at limit + 1 minute (gym 7, capacity 2).
-- ============================================================================
insert into keep select 'occ1', pg_temp.open_visit('occ1', 181, 'visit'), null;
insert into keep select 'occ2', pg_temp.open_visit('occ2', 540, 'none'), null;
select is((select count(*)::int from attendance_counted where gym_id = pg_temp.g(7) and checked_out_at is null), 2, 'occupancy: both open visits are counted at limit + 1 minute');
select is(private.gym_occupancy_band(pg_temp.g(7)), 'busy', 'occupancy: the band still counts the visit past the limit');
select lives_ok($$ select public.run_check_in_auto_timeout_job() $$, 'the auto-timeout job runs');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'occ1')), null, 'auto-timeout job: leaves a visit past the limit but inside the timeout open');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'occ2')),
          (select checked_in_at + interval '8 hours' from attendance_events where id = (select att from keep where label = 'occ2')),
          'auto-timeout job: closes at checked_in_at + checkin_timeout_hours');
select is((select checkout_type from attendance_events where id = (select att from keep where label = 'occ2')), 'auto', 'auto-timeout job: closed as auto');
select is(private.gym_occupancy_band(pg_temp.g(7)), 'medium', 'occupancy: after the job one visit is still counted');

-- ============================================================================
-- Classes: the guard is pinned for a single_use gym; a whole_day gym passes 'class' through unchanged.
-- ============================================================================
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000282a01', pg_temp.g(1), 'SU Class 1', pg_temp.m(4), 20, 'one_off', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000282a02', pg_temp.g(2), 'SU Class 2', pg_temp.m(5), 20, 'one_off', now() + interval '1 day');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000282b01', pg_temp.g(1), '00000000-0000-0000-0000-000000282a01', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000282b02', pg_temp.g(2), '00000000-0000-0000-0000-000000282a02', now() + interval '1 day');
insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-000000282c01', pg_temp.g(1), '00000000-0000-0000-0000-000000282b01', pg_temp.mm('class_m')),
  ('00000000-0000-0000-0000-000000282c02', pg_temp.g(2), '00000000-0000-0000-0000-000000282b02', pg_temp.mm('wd_class'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('class_m'));
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mm('wd_class'));

select is(pg_temp.mark('00000000-0000-0000-0000-000000282c01', 2, 1, 'manager'), 'error:P0001:class_single_use_unsupported',
          'class guard (Story 28.3 replaces this case): a class mark for a charged member in a single_use gym raises class_single_use_unsupported');
select is((select attended_at from class_bookings where id = '00000000-0000-0000-0000-000000282c01'), null, 'class guard: the booking is not attended');
select is(pg_temp.consumed('class_m'), 0, 'class guard: no session consumed');
select is(pg_temp.mark('00000000-0000-0000-0000-000000282c02', 3, 2, 'manager'), 'attended', 'whole_day gym: the class mark passes ''class'' through and attends the booking');
select is((select validity_mode || ':' || covered_kind || ':' || (covered_day is not null)::text from guest_sessions where member_id = pg_temp.mm('wd_class') and consumed_at is not null),
          'whole_day:day:true', 'whole_day gym: the class consumed a day row exactly as before');

-- ============================================================================
-- The platform value is read, not hard-coded: change it directly (audited), repeat the boundary at 89 / 90 / 91.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('p89'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('p90'));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.mm('p91'));
insert into keep select 'p89', pg_temp.open_visit('p89', 89, 'visit'), null;
insert into keep select 'p90', pg_temp.open_visit('p90', 90, 'visit'), null;
insert into keep select 'p91', pg_temp.open_visit('p91', 91, 'visit'), null;
update platform_session_config set single_use_visit_limit_minutes = 90;
select is((select count(*)::int from audit_log where action_type = 'platform_session_config_updated'
           and metadata -> 'new' ->> 'single_use_visit_limit_minutes' = '90' and metadata -> 'old' ->> 'single_use_visit_limit_minutes' = '180'), 1,
          'a direct change of the platform limit is audited with its old and new value');
select is(pg_temp.err(pg_temp.scan('p89')), 'P0001:check_in: member ' || pg_temp.mm('p89') || ' already has an open check-in', 'platform 90, 89 minutes: rejected');
select ok((pg_temp.scan('p90') ? 'id'), 'platform 90, 90 minutes: the old visit has ended, the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'p90')),
          (select checked_in_at + interval '90 minutes' from attendance_events where id = (select att from keep where label = 'p90')), 'platform 90, 90 minutes: closed at checked_in_at + 90');
select is((pg_temp.stale_audits((select att from keep where label = 'p90')) -> 0) ->> 'visit_limit_minutes', '90', 'platform 90: the audit carries the new value');
select ok((pg_temp.scan('p91') ? 'id'), 'platform 90, 91 minutes: the scan checks in');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'p91')),
          (select checked_in_at + interval '90 minutes' from attendance_events where id = (select att from keep where label = 'p91')), 'platform 90, 91 minutes: closed at checked_in_at + 90');
select is(pg_temp.consumed('p91'), 2, 'platform 90, 91 minutes: a new session consumed');
select is((select checked_out_at from attendance_events where id = (select att from keep where label = 'p89')), null, 'platform 90, 89 minutes: the visit stays open');

select * from finish();
rollback;
