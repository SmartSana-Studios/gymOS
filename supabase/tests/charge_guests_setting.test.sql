-- Story 19.3: charge-guests setting, session record and plan-type rules
-- (migration 0107), positive paths. Denial paths live in
-- charge_guests_setting.negative.test.sql.
--
-- The flag, plans.plan_type and plans.price are pinned: a bare UPDATE
-- silently reverts, so every pin assertion pairs with a positive control.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000320xx.

begin;
select plan(39);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000032001', 'Guest Charging Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000032011', 'Guest Charging Gym A', '00000000-0000-0000-0000-000000032001', 'active'),
  ('00000000-0000-0000-0000-000000032012', 'Guest Charging Gym B', '00000000-0000-0000-0000-000000032001', 'active');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000032021'), -- owner A
  ('00000000-0000-0000-0000-000000032022'), -- supervisor A
  ('00000000-0000-0000-0000-000000032023'), -- manager A
  ('00000000-0000-0000-0000-000000032024'), -- receptionist A
  ('00000000-0000-0000-0000-000000032025'), -- member: pay-per-session 2000 (counts)
  ('00000000-0000-0000-0000-000000032026'), -- member: pay-per-session 0 (exempt)
  ('00000000-0000-0000-0000-000000032027'), -- member: monthly
  ('00000000-0000-0000-0000-000000032028'), -- member: deactivated pay-per-session
  ('00000000-0000-0000-0000-000000032029'), -- member: old pps sub, latest monthly
  ('00000000-0000-0000-0000-00000003202a'), -- member: old monthly sub, latest pps (counts)
  ('00000000-0000-0000-0000-00000003202b'), -- member of gym B on pps
  ('00000000-0000-0000-0000-00000003202c'), -- super admin
  ('00000000-0000-0000-0000-00000003202d'); -- owner B

insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at) values
  ('00000000-0000-0000-0000-000000032031', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032021', 'owner',        'GC Owner A',        current_date, null),
  ('00000000-0000-0000-0000-000000032032', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032022', 'supervisor',   'GC Supervisor A',   current_date, null),
  ('00000000-0000-0000-0000-000000032033', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032023', 'manager',      'GC Manager A',      current_date, null),
  ('00000000-0000-0000-0000-000000032034', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032024', 'receptionist', 'GC Receptionist A', current_date, null),
  ('00000000-0000-0000-0000-000000032035', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032025', 'member',       'GC PPS Member',     current_date, null),
  ('00000000-0000-0000-0000-000000032036', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032026', 'member',       'GC Free PPS Member', current_date, null),
  ('00000000-0000-0000-0000-000000032037', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032027', 'member',       'GC Monthly Member', current_date, null),
  ('00000000-0000-0000-0000-000000032038', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032028', 'member',       'GC Deactivated PPS', current_date, now()),
  ('00000000-0000-0000-0000-000000032039', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032029', 'member',       'GC Moved To Monthly', current_date, null),
  ('00000000-0000-0000-0000-00000003203a', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-00000003202a', 'member',       'GC Moved To PPS',   current_date, null),
  ('00000000-0000-0000-0000-00000003203b', '00000000-0000-0000-0000-000000032012', '00000000-0000-0000-0000-00000003202b', 'member',       'GC Gym B PPS',      current_date, null),
  ('00000000-0000-0000-0000-00000003203d', '00000000-0000-0000-0000-000000032012', '00000000-0000-0000-0000-00000003202d', 'owner',        'GC Owner B',        current_date, null);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000032041', '00000000-0000-0000-0000-000000032011', 'GC PPS 2000',  'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000032042', '00000000-0000-0000-0000-000000032011', 'GC PPS 0',     'pay_per_session', 0,     'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000032043', '00000000-0000-0000-0000-000000032011', 'GC Monthly',   'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000032044', '00000000-0000-0000-0000-000000032011', 'GC Unused',    'monthly',         9000,  'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000032045', '00000000-0000-0000-0000-000000032012', 'GC B PPS',     'pay_per_session', 2000,  'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035', '00000000-0000-0000-0000-000000032041', 'active',  current_date, null, now()),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032036', '00000000-0000-0000-0000-000000032042', 'active',  current_date, null, now()),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032037', '00000000-0000-0000-0000-000000032043', 'active',  current_date, current_date + 30, now()),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032038', '00000000-0000-0000-0000-000000032041', 'active',  current_date, null, now()),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032039', '00000000-0000-0000-0000-000000032041', 'expired', current_date - 60, null, now() - interval '60 days'),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032039', '00000000-0000-0000-0000-000000032043', 'active',  current_date, current_date + 30, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-00000003203a', '00000000-0000-0000-0000-000000032043', 'expired', current_date - 60, current_date - 30, now() - interval '60 days'),
  ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-00000003203a', '00000000-0000-0000-0000-000000032041', 'active',  current_date, null, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000032012', '00000000-0000-0000-0000-00000003203b', '00000000-0000-0000-0000-000000032045', 'active',  current_date, null, now());

-- ============================================================================
-- The flag defaults off.
-- ============================================================================
select is(
  (select count(*)::int from gyms where charge_guests_per_session),
  0,
  'every gym, existing or newly inserted, is off by default'
);

-- ============================================================================
-- set_guest_charging(): owner toggles, audit row, no-op writes nothing.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"owner"}', true);

select lives_ok($$ select set_guest_charging(true) $$, 'owner can turn charging on');
reset role;

select is(
  (select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032011'),
  true,
  'the flag is true after the owner call'
);

select is(
  (select metadata from audit_log
   where action_type = 'guest_charging_changed' and gym_id = '00000000-0000-0000-0000-000000032011'
   order by created_at desc limit 1),
  '{"old_enabled": false, "new_enabled": true}'::jsonb,
  'one audit row records old and new value'
);

select is(
  (select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032012'),
  false,
  'gym B is untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"owner"}', true);
select set_guest_charging(true);
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'guest_charging_changed' and gym_id = '00000000-0000-0000-0000-000000032011'),
  1,
  'an unchanged value writes no second audit row'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"supervisor"}', true);
select lives_ok($$ select set_guest_charging(false) $$, 'supervisor can turn charging off');
reset role;

select is(
  (select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032011'),
  false,
  'the flag is false after the supervisor call'
);

select is(
  (select count(*)::int from audit_log where action_type = 'guest_charging_changed' and gym_id = '00000000-0000-0000-0000-000000032011'),
  2,
  'the supervisor change added one audit row'
);

-- ============================================================================
-- guest_charging_impact()
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"owner"}', true);

select is(
  guest_charging_impact(),
  2,
  'impact counts latest-subscription pay-per-session members with price > 0 (not free, monthly, deactivated, moved-away or other-gym)'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"supervisor"}', true);
select is(guest_charging_impact(), 2, 'supervisor sees the same count');
reset role;

-- ============================================================================
-- Plans: direct UPDATE pins type and price, the rest stays editable.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"manager"}', true);

update plans set plan_type = 'monthly', price = 1, duration_days = 30, name = 'GC Unused Renamed'
where id = '00000000-0000-0000-0000-000000032044';
reset role;

select is(
  (select name from plans where id = '00000000-0000-0000-0000-000000032044'),
  'GC Unused Renamed',
  'positive control: the direct UPDATE landed (name changed)'
);
select is(
  (select price from plans where id = '00000000-0000-0000-0000-000000032044'),
  9000,
  'direct UPDATE of plans.price is pinned'
);

update plans set price = 1 where id = '00000000-0000-0000-0000-000000032044';
select is(
  (select price from plans where id = '00000000-0000-0000-0000-000000032044'),
  1,
  'the pin covers authenticated only: a service-role/owner-level UPDATE still lands'
);
update plans set price = 9000 where id = '00000000-0000-0000-0000-000000032044';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"manager"}', true);
update plans set plan_type = 'class_only', name = 'GC Unused Renamed 2' where id = '00000000-0000-0000-0000-000000032044';
reset role;

select is(
  (select plan_type::text from plans where id = '00000000-0000-0000-0000-000000032044'),
  'monthly',
  'direct UPDATE of plans.plan_type is pinned'
);

-- ============================================================================
-- update_plan_pricing()
-- ============================================================================
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035',
        '00000000-0000-0000-0000-000000032099', now() + interval '60 days');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"manager"}', true);

select lives_ok(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032041', 'pay_per_session', 2500, null, 'monthly', null) $$,
  'manager can change the price of a plan that has subscriptions'
);
reset role;

select is(
  (select price from plans where id = '00000000-0000-0000-0000-000000032041'),
  2500,
  'the price changed'
);

select is(
  (select metadata from audit_log
   where action_type = 'plan_price_changed' and target_entity_id = '00000000-0000-0000-0000-000000032041'),
  '{"old_price": 2000, "new_price": 2500}'::jsonb,
  'the price change is audited with old and new value'
);

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000032035'
     and loyalty_grant_id = '00000000-0000-0000-0000-000000032099' and usable_until > now() + interval '59 days'),
  1,
  'a price change leaves existing guest_sessions rows untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"manager"}', true);

select lives_ok(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032044', 'pay_per_session', 1500, null, 'monthly', null) $$,
  'a type change with zero subscriptions succeeds in one statement'
);
reset role;

select is(
  (select row(plan_type::text, price, duration_days, billing_interval::text)::text from plans where id = '00000000-0000-0000-0000-000000032044'),
  '(pay_per_session,1500,,monthly)',
  'the shape columns moved with the type (duration null, monthly)'
);

select is(
  (select metadata from audit_log
   where action_type = 'plan_type_changed' and target_entity_id = '00000000-0000-0000-0000-000000032044'),
  '{"old_plan_type": "monthly", "new_plan_type": "pay_per_session"}'::jsonb,
  'the type change is audited with old and new value'
);

-- ============================================================================
-- guest_sessions: constraints, grants, visibility.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000032051', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035', 2500, 'XAF', 'cash', 'verified', 'session');

select is(
  (select purpose from payments where id = '00000000-0000-0000-0000-000000032051'),
  'session',
  'the purpose CHECK admits session'
);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, payment_id, usable_until)
     values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035',
             '00000000-0000-0000-0000-000000032098', '00000000-0000-0000-0000-000000032051', now() + interval '7 days') $$,
  '23514', null,
  'both payment and grant set: rejected by the CHECK'
);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, usable_until)
     values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035', now() + interval '7 days') $$,
  '23514', null,
  'neither payment nor grant set: rejected by the CHECK'
);

insert into guest_sessions (gym_id, member_id, payment_id, usable_until, consumed_at, covered_day)
values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035',
        '00000000-0000-0000-0000-000000032051', now() + interval '7 days', now(), current_date);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day)
     values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035',
             '00000000-0000-0000-0000-000000032097', now() + interval '7 days', now(), current_date) $$,
  '23505', null,
  'two consumed non-voided rows for one member and day: rejected by the partial unique index'
);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
     values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035',
             '00000000-0000-0000-0000-000000032051', now() + interval '7 days') $$,
  '23505', null,
  'a payment backs at most one session'
);

update guest_sessions set voided_at = now() where payment_id = '00000000-0000-0000-0000-000000032051';
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day)
     values ('00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035',
             '00000000-0000-0000-0000-000000032097', now() + interval '7 days', now(), current_date) $$,
  'once the earlier consumed row is voided a new one for that day is allowed'
);

select ok(
  not has_table_privilege('authenticated', 'public.guest_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.guest_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.guest_sessions', 'DELETE')
  and not has_table_privilege('authenticated', 'public.guest_sessions', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.guest_sessions', 'INSERT')
  and not has_table_privilege('service_role', 'public.guest_sessions', 'UPDATE')
  and not has_table_privilege('service_role', 'public.guest_sessions', 'DELETE')
  and not has_table_privilege('service_role', 'public.guest_sessions', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.guest_sessions', 'SELECT'),
  'guest_sessions is SELECT-only for authenticated and service_role'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"receptionist"}', true);
select is((select count(*)::int from guest_sessions), 3, 'staff of the gym read its guest_sessions rows');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"member"}', true);
select is((select count(*)::int from guest_sessions), 3, 'the member reads their own guest_sessions rows');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032011","app_role":"member"}', true);
select is((select count(*)::int from guest_sessions), 0, 'another member of the gym sees none of them');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003202d","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032012","app_role":"owner"}', true);
select is((select count(*)::int from guest_sessions), 0, 'staff of another gym see none of them');
reset role;

-- ============================================================================
-- platform_session_config
-- ============================================================================
select is(
  (select row(paid_session_validity_days, free_session_validity_days, loyalty_idle_reset_days)::text from platform_session_config),
  '(7,60,90)',
  'platform_session_config is seeded 7 / 60 / 90'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003202c","role":"authenticated","app_role":"super_admin"}', true);
select is((select count(*)::int from platform_session_config), 1, 'super admin reads the config row');
update platform_session_config set paid_session_validity_days = 10;
reset role;

select is(
  (select paid_session_validity_days from platform_session_config),
  10,
  'super admin can update the config'
);

select is(
  (select metadata #>> '{old,paid_session_validity_days}' || '>' || (metadata #>> '{new,paid_session_validity_days}')
   from audit_log where action_type = 'platform_session_config_updated'),
  '7>10',
  'the config update is audited with old and new values'
);

-- ============================================================================
-- Notification trigger skips session payments.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000032052', '00000000-0000-0000-0000-000000032011', '00000000-0000-0000-0000-000000032035', 15000, 'XAF', 'cash', 'verified', 'subscription');

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000032051'),
  0,
  'a verified session payment creates no notification dispatch'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000032052'),
  1,
  'positive control: a verified subscription payment does'
);

select * from finish();
rollback;
