-- Story 6.4: Notification Preferences. New table/RLS/trigger from
-- 0047_notification_preferences.sql -- self_read_own_member_preferences /
-- self_update_own_member_preferences policies, the
-- protect_self_managed_member_preferences_columns pin-back trigger, and the
-- create_default_member_preferences auto-create trigger + backfill.
-- Session-simulation and cross-member-denial (CTE `returning`, not a
-- follow-up SELECT) conventions match
-- member_onboarding_completion_rls.test.sql.

begin;
select plan(28);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Notification Prefs Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009011', 'Notification Prefs Test Gym A', '00000000-0000-0000-0000-000000009001', 30),
  ('00000000-0000-0000-0000-000000009012', 'Notification Prefs Test Gym B', '00000000-0000-0000-0000-000000009001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Member A (self-access, the row under test)
  ('00000000-0000-0000-0000-000000009022'), -- Member A2 (different member, same gym -- cross-member denial)
  ('00000000-0000-0000-0000-000000009023'), -- Member D (different member, different gym -- cross-gym denial)
  ('00000000-0000-0000-0000-000000009025'); -- Multi-gym user (a member at both Gym A and Gym B)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009031', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'member', 'Member A'),
  ('00000000-0000-0000-0000-000000009032', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'member', 'Member A2'),
  ('00000000-0000-0000-0000-000000009033', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009023', 'member', 'Member D'),
  ('00000000-0000-0000-0000-000000009035', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009025', 'member', 'Multi-Gym Member (Gym A)'),
  ('00000000-0000-0000-0000-000000009036', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009025', 'member', 'Multi-Gym Member (Gym B)');

-- ============================================================================
-- Task 1 RED contract: table shape, RLS enabled, constraints, index.
-- ============================================================================
select ok(to_regclass('public.member_preferences') is not null, 'member_preferences exists in public');

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('public.member_preferences')),
  'member_preferences has RLS enabled'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.member_preferences')
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%member_id%'
  ),
  'member_id is unique (one preferences row per member)'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'member_preferences' and indexdef like '%gym_id%'
  ),
  'member_preferences has a gym_id index'
);

-- ============================================================================
-- AC #1: the auto-create trigger gives every new members row exactly one
-- member_preferences row, both categories opted-in (false) by default.
-- ============================================================================
select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  1,
  'a newly inserted members row gets exactly one member_preferences row'
);

select is(
  (select quiet_gym_alerts_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  false,
  'the auto-created row defaults quiet_gym_alerts_opted_out to opted-in (false)'
);

select is(
  (select class_reminder_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  false,
  'the auto-created row defaults class_reminder_opted_out to opted-in (false)'
);

-- ============================================================================
-- AC #1: backfill statement is idempotent and repairs a member left without
-- a row (simulating the pre-migration dataset the real backfill covers).
-- ============================================================================
set local role service_role;
delete from member_preferences where member_id = '00000000-0000-0000-0000-000000009032';
reset role;

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009032'),
  0,
  'sanity: Member A2''s preferences row was removed to simulate a pre-migration member'
);

insert into member_preferences (member_id, gym_id)
select id, gym_id from members where id = '00000000-0000-0000-0000-000000009032'
on conflict (member_id) do nothing;

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009032'),
  1,
  'the backfill statement repairs a member left without a preferences row'
);

insert into member_preferences (member_id, gym_id)
select id, gym_id from members
on conflict (member_id) do nothing;

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009032'),
  1,
  'a re-run of the backfill statement is idempotent -- no duplicate row'
);

-- ============================================================================
-- AC #2/#3: a member can SELECT/UPDATE their own row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  1,
  'Member A can SELECT their own member_preferences row'
);

select lives_ok(
  $$update member_preferences set quiet_gym_alerts_opted_out = true, class_reminder_opted_out = true
    where member_id = '00000000-0000-0000-0000-000000009031'$$,
  'Member A can UPDATE their own member_preferences row'
);

select is(
  (select quiet_gym_alerts_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  true,
  'quiet_gym_alerts_opted_out change persisted'
);

select is(
  (select class_reminder_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  true,
  'class_reminder_opted_out change persisted'
);

-- No self-insert policy: a fresh member_id this session does not own is
-- rejected by RLS itself (not merely the unique constraint) -- proven with a
-- member_id that has no existing preferences row.
set local role service_role;
delete from member_preferences where member_id = '00000000-0000-0000-0000-000000009033';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);
select throws_like(
  $$insert into member_preferences (member_id, gym_id) values ('00000000-0000-0000-0000-000000009033', '00000000-0000-0000-0000-000000009012')$$,
  '%row-level security%',
  'a member cannot INSERT a member_preferences row directly -- no self-insert policy exists'
);
reset role;

set local role service_role;
insert into member_preferences (member_id, gym_id) values ('00000000-0000-0000-0000-000000009033', '00000000-0000-0000-0000-000000009012')
on conflict (member_id) do nothing;
reset role;

-- ============================================================================
-- AC #6: cross-member denial, same gym.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  0,
  'Member A2 cannot SELECT Member A''s member_preferences row'
);

with updated as (
  update member_preferences set quiet_gym_alerts_opted_out = true
  where member_id = '00000000-0000-0000-0000-000000009031'
  returning member_id
)
select is((select count(*) from updated)::int, 0, 'Member A2 cannot UPDATE Member A''s member_preferences row');
reset role;

-- ============================================================================
-- AC #6: cross-member denial, cross-gym.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  0,
  'Member D (different gym) cannot SELECT Member A''s member_preferences row'
);

with updated as (
  update member_preferences set quiet_gym_alerts_opted_out = true
  where member_id = '00000000-0000-0000-0000-000000009031'
  returning member_id
)
select is((select count(*) from updated)::int, 0, 'Member D (different gym) cannot UPDATE Member A''s member_preferences row');
reset role;

select is(
  (select quiet_gym_alerts_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  true,
  'Member A''s row is unchanged after both denied cross-member update attempts (verified as the connecting role, bypassing RLS visibility)'
);

-- ============================================================================
-- Self-scope has no gym_id filter, deliberately mirroring
-- self_read_own_membership (0013): the same real user's own rows across
-- multiple gym memberships are all visible/writable via self policy -- not a
-- gap, the policy text specified by this story's own migration task.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009035'),
  1,
  'the multi-gym user can SELECT their own Gym A preferences row'
);

select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009036'),
  1,
  'the multi-gym user can also SELECT their own Gym B preferences row under the same (Gym A) JWT claim -- self policy has no gym_id filter, by design'
);

select lives_ok(
  $$update member_preferences set quiet_gym_alerts_opted_out = true where member_id = '00000000-0000-0000-0000-000000009036'$$,
  'the multi-gym user can also UPDATE their own Gym B preferences row under the same (Gym A) JWT claim'
);
reset role;

-- ============================================================================
-- AC #6: the pin-back trigger. member_id/gym_id/created_at are pinned back
-- to OLD on a self-update; the two boolean columns still persist in the
-- same statement (column-selective pin-back, not a blanket revert).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

update member_preferences
set member_id = '00000000-0000-0000-0000-000000009032',
    gym_id = '00000000-0000-0000-0000-000000009012',
    quiet_gym_alerts_opted_out = false,
    class_reminder_opted_out = false
where member_id = '00000000-0000-0000-0000-000000009031';
reset role;

select is(
  (select member_id from member_preferences where member_id = '00000000-0000-0000-0000-000000009031')::text,
  '00000000-0000-0000-0000-000000009031',
  'a self-update attempting to also change member_id is silently pinned back to its prior value'
);

select is(
  (select gym_id from member_preferences where member_id = '00000000-0000-0000-0000-000000009031')::text,
  '00000000-0000-0000-0000-000000009011',
  'a self-update attempting to also change gym_id is silently pinned back to its prior value'
);

select is(
  (select quiet_gym_alerts_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  false,
  'quiet_gym_alerts_opted_out still updates correctly in the same statement that attempted the pinned columns'
);

select is(
  (select class_reminder_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009031'),
  false,
  'class_reminder_opted_out still updates correctly in the same statement that attempted the pinned columns'
);

-- ============================================================================
-- Sanity: 0045/0046's notification infrastructure is untouched by this file.
-- ============================================================================
select is(
  (select count(*)::int from cron.job where jobname = 'notification_delivery_processor'),
  1,
  'sanity: the shared delivery processor cron entry is unaffected by this file'
);

select * from finish();
rollback;
