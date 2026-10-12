-- Migration 0116 negative / boundary cases: the alert must come back when it should.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000381xx.

begin;
select plan(5);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000038101', 'Cooldown Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000038111', 'Cooldown Neg Gym', '00000000-0000-0000-0000-000000038101', 'active', true);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000038121'),
  ('00000000-0000-0000-0000-000000038122'),
  ('00000000-0000-0000-0000-000000038123');

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000038131', '00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038121', 'member', 'CN Old', current_date),
  ('00000000-0000-0000-0000-000000038132', '00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038122', 'member', 'CN Paid', current_date),
  ('00000000-0000-0000-0000-000000038133', '00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038123', 'member', 'CN Expired Kind', current_date);

-- Old: dismissed 20 minutes ago (outside the 15 minute window).
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date, created_at, dismissed_at) values
  ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038131', 'session_required', null, null, now() - interval '30 minutes', now() - interval '20 minutes');

insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038131', 'session_required', null, null);

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038131' and kind = 'session_required' and dismissed_at is null),
  1,
  'after the cooldown has elapsed a new alert is raised'
);

-- Paid: dismissed 2 minutes ago, but a session was bought after that alert was raised
-- (a refund-then-rescan must alert again).
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date, created_at, dismissed_at) values
  ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038132', 'session_required', null, null, now() - interval '10 minutes', now() - interval '2 minutes');

insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at)
values ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038132', gen_random_uuid(), now() + interval '5 days', now() - interval '5 minutes');

insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038132', 'session_required', null, null);

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038132' and kind = 'session_required' and dismissed_at is null),
  1,
  'a session bought since the dismissed alert re-arms the alert'
);

-- Expired-subscription alerts are untouched by the cooldown.
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date, created_at, dismissed_at) values
  ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038133', 'session_required', null, null, now() - interval '10 minutes', now() - interval '2 minutes');

insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038133', 'subscription_status', 'expired', current_date - 1);

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038133' and kind = 'subscription_status' and dismissed_at is null),
  1,
  'a subscription-status alert is not held back by a session-required dismissal'
);

-- The dismissal of one member never holds back another member's alert.
select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038131' and dismissed_at is null),
  1,
  'cooldown is per member'
);

-- Edge: dismissed 14 minutes ago is still inside the window, so it IS held back.
insert into auth.users (id) values ('00000000-0000-0000-0000-000000038124');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000038134', '00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038124', 'member', 'CN Edge', current_date);
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date, created_at, dismissed_at) values
  ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038134', 'session_required', null, null, now() - interval '20 minutes', now() - interval '14 minutes');
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038111', '00000000-0000-0000-0000-000000038134', 'session_required', null, null);

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038134' and kind = 'session_required' and dismissed_at is null),
  0,
  'a dismissal 14 minutes ago is still inside the cooldown'
);

select * from finish();
rollback;
