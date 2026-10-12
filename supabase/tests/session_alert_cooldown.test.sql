-- Migration 0116: a refused scan right after the desk dismissed the member's session-required
-- alert does not raise a new alert (blocked attempts are still recorded). Positive paths; the
-- re-arm and untouched cases live in session_alert_cooldown.negative.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000380xx.

begin;
select plan(7);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000038001', 'Cooldown Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000038011', 'Cooldown Gym', '00000000-0000-0000-0000-000000038001', 'active', true);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000038021'),
  ('00000000-0000-0000-0000-000000038022');

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000038031', '00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038021', 'member', 'CD A', current_date),
  ('00000000-0000-0000-0000-000000038032', '00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038022', 'member', 'CD B', current_date);

-- A: an alert the desk dismissed 2 minutes ago.
insert into front_desk_alerts (id, gym_id, member_id, kind, status, expiry_date, created_at, dismissed_at) values
  ('00000000-0000-0000-0000-000000038041', '00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038031',
   'session_required', null, null, now() - interval '10 minutes', now() - interval '2 minutes');

-- 1. a new session_required alert for A is held back
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038031', 'session_required', null, null);

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038031' and kind = 'session_required'),
  1,
  'a repeat session-required alert right after a dismissal is not raised'
);

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038031' and kind = 'session_required' and dismissed_at is null),
  0,
  'and no active alert exists for the member'
);

-- 2. the same insert with ON CONFLICT DO NOTHING (the exact shape check_in() uses) also holds
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038031', 'session_required', null, null)
on conflict (member_id, kind, status) where dismissed_at is null do nothing;

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038031' and kind = 'session_required'),
  1,
  'the ON CONFLICT DO NOTHING insert shape is held back as well'
);

-- 3. a first-ever alert for B is raised, and a second one while active stays a single row
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038032', 'session_required', null, null);
insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
values ('00000000-0000-0000-0000-000000038011', '00000000-0000-0000-0000-000000038032', 'session_required', null, null)
on conflict (member_id, kind, status) where dismissed_at is null do nothing;

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000038032' and kind = 'session_required' and dismissed_at is null),
  1,
  'a member with no recent dismissal gets exactly one active alert'
);

-- 4. the cooldown is not an attempt filter: the trigger exists, is BEFORE INSERT, row-level
select is(
  (select tgtype & 2 from pg_trigger
   where tgrelid = 'public.front_desk_alerts'::regclass
     and tgname = 'front_desk_alerts_hold_back_repeat_session_alert'),
  2,
  'the hold-back trigger is a BEFORE trigger'
);

select is(
  (select tgtype & 4 from pg_trigger
   where tgrelid = 'public.front_desk_alerts'::regclass
     and tgname = 'front_desk_alerts_hold_back_repeat_session_alert'),
  4,
  'and fires on INSERT'
);

select is(
  (select has_function_privilege('anon', 'private.hold_back_repeat_session_alert()', 'execute')),
  false,
  'the trigger function is not executable by anon'
);

select * from finish();
rollback;
