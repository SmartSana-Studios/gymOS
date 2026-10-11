-- Story 19.6a: front_desk_alerts `kind` refactor (0110), no behavior change.
-- Exercises every rewritten ON CONFLICT (member_id, kind, status) site:
-- check_in() expired branch, check_in() at-risk branch, and
-- mark_class_attendance() rejection branch, plus dedupe-after-dismiss and the
-- post-migration schema shape. Fixture style mirrors
-- real_time_front_desk_alert.test.sql (set role + jwt claims, reset role to
-- assert on committed rows).

begin;
select plan(19);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009601', 'Alert Kind Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-000000009611', 'Alert Kind Test Gym', '00000000-0000-0000-0000-000000009601', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009621'), -- expired member (check_in, dismiss + rescan)
  ('00000000-0000-0000-0000-000000009622'), -- expiring_soon member
  ('00000000-0000-0000-0000-000000009623'), -- grace_period member
  ('00000000-0000-0000-0000-000000009624'), -- expired member with a class booking
  ('00000000-0000-0000-0000-000000009625'), -- receptionist
  ('00000000-0000-0000-0000-000000009626'); -- coach

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009621', 'member', 'Kind Expired Member'),
  ('00000000-0000-0000-0000-000000009632', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009622', 'member', 'Kind Expiring Member'),
  ('00000000-0000-0000-0000-000000009633', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009623', 'member', 'Kind Grace Member'),
  ('00000000-0000-0000-0000-000000009634', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009624', 'member', 'Kind Class Member'),
  ('00000000-0000-0000-0000-000000009635', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009625', 'receptionist', 'Kind Receptionist'),
  ('00000000-0000-0000-0000-000000009636', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009626', 'coach', 'Kind Coach');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0000-000000009641', '00000000-0000-0000-0000-000000009611', 'Kind Monthly', 'monthly', 15000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000009651', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009641', 'expired', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000009652', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009632', '00000000-0000-0000-0000-000000009641', 'expiring_soon', current_date - 25, current_date + 3),
  ('00000000-0000-0000-0000-000000009653', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009633', '00000000-0000-0000-0000-000000009641', 'grace_period', current_date - 32, current_date - 2),
  ('00000000-0000-0000-0000-000000009654', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009634', '00000000-0000-0000-0000-000000009641', 'expired', current_date - 40, current_date - 10);

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
values ('00000000-0000-0000-0000-000000009661', '00000000-0000-0000-0000-000000009611', 'Kind Class', '00000000-0000-0000-0000-000000009636', 10, 'one_off', now() + interval '3 days');

insert into class_sessions (id, gym_id, class_id, scheduled_at)
values ('00000000-0000-0000-0000-000000009671', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009661', now() + interval '3 days');

insert into class_bookings (id, gym_id, class_session_id, member_id)
values ('00000000-0000-0000-0000-000000009681', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009671', '00000000-0000-0000-0000-000000009634');

-- ============================================================================
-- Schema shape after 0110.
-- ============================================================================
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'front_desk_alerts' and column_name = 'status'),
  'YES',
  'status is nullable'
);

select is(
  to_regclass('public.idx_front_desk_alerts_one_active_per_member_status') is null
    and to_regclass('public.idx_front_desk_alerts_one_active_per_member_kind_status') is not null,
  true,
  'old one-active index is gone and the (member_id, kind, status) index exists'
);

-- ============================================================================
-- (1) Expired scan, repeat: check_in() expired branch dedupes under the new
-- ON CONFLICT target; the row carries kind = subscription_status.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009621","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);

select ok((select check_in()) is null, 'expired member first scan returns null');
select ok((select check_in()) is null, 'expired member repeat scan returns null');

reset role;

select is(
  (select count(*)::int from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009631' and dismissed_at is null),
  1,
  'a repeated expired scan leaves exactly one active alert'
);

select is(
  (select kind || '/' || status::text from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009631' and dismissed_at is null),
  'subscription_status/expired',
  'the expired alert has kind subscription_status and status expired'
);

-- ============================================================================
-- (2) At-risk scans: check_in() expiring_soon / grace_period branch dedupes.
-- The open session is removed between scans so the second scan reaches the
-- alert insert again (an open session short-circuits before it).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009622","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);

select isnt((select check_in()), null, 'expiring_soon member first scan succeeds');

reset role;
delete from attendance_events where member_id = '00000000-0000-0000-0000-000000009632';

set local role authenticated;
select isnt((select check_in()), null, 'expiring_soon member second scan succeeds');
reset role;

select is(
  (select count(*)::int from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009632' and dismissed_at is null
      and kind = 'subscription_status' and status = 'expiring_soon'),
  1,
  'two expiring_soon scans leave exactly one active expiring_soon alert'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009623","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);
select isnt((select check_in()), null, 'grace_period member first scan succeeds');
reset role;
delete from attendance_events where member_id = '00000000-0000-0000-0000-000000009633';

set local role authenticated;
select isnt((select check_in()), null, 'grace_period member second scan succeeds');
reset role;

select is(
  (select count(*)::int from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009633' and dismissed_at is null
      and kind = 'subscription_status' and status = 'grace_period'),
  1,
  'two grace_period scans leave exactly one active grace_period alert'
);

-- ============================================================================
-- (3) Class attendance on an expired member: mark_class_attendance() rejection
-- branch inserts one deduped expired alert and returns null.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009625","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"receptionist"}',
  true
);

select is(
  (select mark_class_attendance('00000000-0000-0000-0000-000000009681')),
  null,
  'marking an expired member''s booking returns null'
);
select is(
  (select mark_class_attendance('00000000-0000-0000-0000-000000009681')),
  null,
  'marking the same booking again still returns null'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009634' and dismissed_at is null
      and kind = 'subscription_status' and status = 'expired'),
  1,
  'two rejected attendance marks leave exactly one active expired alert'
);

-- ============================================================================
-- (4) Dismiss then rescan: a dismissed alert no longer blocks a new one.
-- ============================================================================
update front_desk_alerts set dismissed_at = now()
where member_id = '00000000-0000-0000-0000-000000009631' and dismissed_at is null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009621","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);
select ok((select check_in()) is null, 'expired member rescans after dismissal');
reset role;

select is(
  (select count(*)::int from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009631' and dismissed_at is null),
  1,
  'after dismissal and a rescan there is exactly one active alert'
);

select is(
  (select count(*)::int from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009631'),
  2,
  'the dismissed alert row is kept and a new one was inserted'
);

-- ============================================================================
-- (5) Every alert written through the live paths carries the default kind and
-- a non-null status.
-- ============================================================================
select is(
  (select count(*)::int from front_desk_alerts
    where gym_id = '00000000-0000-0000-0000-000000009611'
      and (kind is distinct from 'subscription_status' or status is null)),
  0,
  'every alert is kind subscription_status with a non-null status'
);

select * from finish();
rollback;
