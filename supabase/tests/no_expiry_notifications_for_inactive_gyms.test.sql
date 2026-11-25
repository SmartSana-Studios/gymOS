-- Migration 0194: private.send_push_notification() sends nothing, and records nothing, for a gym that is not active; the lifecycle job still moves the subscription states.

begin;
select plan(10);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000194001', 'Inactive Notif Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000194101', 'Notif Active Gym',      '00000000-0000-0000-0000-000000194001', 'active'),
  ('00000000-0000-0000-0000-000000194102', 'Notif Suspended Gym',   '00000000-0000-0000-0000-000000194001', 'suspended'),
  ('00000000-0000-0000-0000-000000194103', 'Notif Deactivated Gym', '00000000-0000-0000-0000-000000194001', 'deactivated');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000194201'),
  ('00000000-0000-0000-0000-000000194202'),
  ('00000000-0000-0000-0000-000000194203');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000194301', '00000000-0000-0000-0000-000000194101', '00000000-0000-0000-0000-000000194201', 'member', 'Active Member'),
  ('00000000-0000-0000-0000-000000194302', '00000000-0000-0000-0000-000000194102', '00000000-0000-0000-0000-000000194202', 'member', 'Suspended Member'),
  ('00000000-0000-0000-0000-000000194303', '00000000-0000-0000-0000-000000194103', '00000000-0000-0000-0000-000000194203', 'member', 'Deactivated Member');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000194401', '00000000-0000-0000-0000-000000194101', 'Plan A', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000194402', '00000000-0000-0000-0000-000000194102', 'Plan S', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000194403', '00000000-0000-0000-0000-000000194103', 'Plan D', 'monthly', 10000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000194501', '00000000-0000-0000-0000-000000194101', '00000000-0000-0000-0000-000000194301', '00000000-0000-0000-0000-000000194401', 'active', current_date - 23, current_date + 7),
  ('00000000-0000-0000-0000-000000194502', '00000000-0000-0000-0000-000000194102', '00000000-0000-0000-0000-000000194302', '00000000-0000-0000-0000-000000194402', 'active', current_date - 23, current_date + 7),
  ('00000000-0000-0000-0000-000000194503', '00000000-0000-0000-0000-000000194103', '00000000-0000-0000-0000-000000194303', '00000000-0000-0000-0000-000000194403', 'active', current_date - 23, current_date + 7);

-- The sender, called directly.
select private.send_push_notification('00000000-0000-0000-0000-000000194501', 'N-01');
select private.send_push_notification('00000000-0000-0000-0000-000000194502', 'N-01');
select private.send_push_notification('00000000-0000-0000-0000-000000194503', 'N-01');

select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000194501'), 1,
  'an active gym: the notice is dispatched');
select is((select count(*)::int from public.notifications where member_id = '00000000-0000-0000-0000-000000194301'), 1,
  'an active gym: the member gets a history row');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000194502'), 0,
  'a suspended gym: nothing is dispatched');
select is((select count(*)::int from public.notifications where member_id = '00000000-0000-0000-0000-000000194302'), 0,
  'a suspended gym: no history row either');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000194503'), 0,
  'a deactivated gym: nothing is dispatched');
select is((select count(*)::int from public.notifications where member_id = '00000000-0000-0000-0000-000000194303'), 0,
  'a deactivated gym: no history row either');

-- The code check still runs first.
select throws_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000194502', 'N-09')$$,
  'P0001', 'unsupported notification code: N-09',
  'an unsupported code is still refused for a suspended gym');

-- The nightly job: the subscription states still move, the messages stop.
select run_subscription_lifecycle_job();
select is((select status::text from subscriptions where id = '00000000-0000-0000-0000-000000194502'), 'expiring_soon',
  'the job still moves a suspended gym''s subscription to expiring_soon');
select is((select count(*)::int from private.notification_dispatches where subscription_id in ('00000000-0000-0000-0000-000000194502', '00000000-0000-0000-0000-000000194503')), 0,
  'and sends nothing for the suspended and the deactivated gym');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000194501' and notification_code = 'N-01'), 1,
  'while the active gym keeps its one N-01 (idempotent across the direct call and the job)');

select * from finish();
rollback;
