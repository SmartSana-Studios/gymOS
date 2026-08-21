-- Story 10.1: Body Profile & Progress Entry Logging. New table/RLS/trigger
-- from 0066_body_profile_progress_entry_logging.sql -- progress_entries'
-- self_read/self_insert/self_soft_delete policies, the
-- protect_progress_entry_immutable_columns pin-back trigger, the partial
-- unique index on client_entry_id, the new members.height_cm/
-- starting_weight_kg columns (self-writable via 0020's existing
-- self_update_own_member_onboarding_fields policy/trigger, no new members
-- policy), and the progress-photos private Storage bucket + its 4 policies.
-- Session-simulation and cross-member-denial (CTE `returning`, not a
-- follow-up SELECT) conventions match notification_preferences.test.sql /
-- member_onboarding_completion_rls.test.sql.

begin;
select plan(36);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009201', 'Progress Entries Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009211', 'Progress Entries Test Gym A', '00000000-0000-0000-0000-000000009201', 30),
  ('00000000-0000-0000-0000-000000009212', 'Progress Entries Test Gym B', '00000000-0000-0000-0000-000000009201', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009221'), -- Member A (self-access, the row under test)
  ('00000000-0000-0000-0000-000000009222'), -- Member A2 (different member, same gym -- cross-member denial)
  ('00000000-0000-0000-0000-000000009223'), -- Member D (different member, different gym -- cross-gym denial)
  ('00000000-0000-0000-0000-000000009224'), -- Coach A (gym A, actively assigned to Member A -- Story 10.2)
  ('00000000-0000-0000-0000-000000009225'), -- Member A-Ended (gym A, Coach A's assignment to them has ended -- Story 10.2)
  ('00000000-0000-0000-0000-000000009226'); -- Coach B (gym B, never assigned to Member A -- cross-gym denial, Story 10.2)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009221', 'member', 'Member A'),
  ('00000000-0000-0000-0000-000000009232', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009222', 'member', 'Member A2'),
  ('00000000-0000-0000-0000-000000009233', '00000000-0000-0000-0000-000000009212', '00000000-0000-0000-0000-000000009223', 'member', 'Member D'),
  ('00000000-0000-0000-0000-000000009234', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009224', 'coach', 'Coach A'),
  ('00000000-0000-0000-0000-000000009235', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009225', 'member', 'Member A-Ended'),
  ('00000000-0000-0000-0000-000000009236', '00000000-0000-0000-0000-000000009212', '00000000-0000-0000-0000-000000009226', 'coach', 'Coach B');

-- Story 10.2: Coach A actively assigned to Member A; Coach A's prior
-- assignment to Member A-Ended has already ended (ended_at set).
insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000009251', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009234', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000009252', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009235', '00000000-0000-0000-0000-000000009234', now() - interval '60 days', now() - interval '30 days');

-- Story 10.2: Member A-Ended's own entry, used only for the ended-assignment
-- coach-denial assertion below (not otherwise exercised by this file).
insert into progress_entries (id, member_id, gym_id, weight_kg, client_entry_id) values
  ('00000000-0000-0000-0000-000000009245', '00000000-0000-0000-0000-000000009235', '00000000-0000-0000-0000-000000009211', 60, '00000000-0000-0000-0000-000000009245');

-- ============================================================================
-- Task 2 RED contract: table shape, RLS enabled, indexes.
-- ============================================================================
select ok(to_regclass('public.progress_entries') is not null, 'progress_entries exists in public');

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('public.progress_entries')),
  'progress_entries has RLS enabled'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'progress_entries' and indexdef like '%gym_id%'
  ),
  'progress_entries has a gym_id index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'progress_entries'
      and indexname = 'idx_progress_entries_client_entry_id'
      and indexdef like '%UNIQUE%' and indexdef like '%WHERE%'
  ),
  'progress_entries has a partial unique index on client_entry_id'
);

select ok(
  exists (select 1 from information_schema.columns where table_name = 'members' and column_name = 'height_cm'),
  'members.height_cm exists'
);

select ok(
  exists (select 1 from information_schema.columns where table_name = 'members' and column_name = 'starting_weight_kg'),
  'members.starting_weight_kg exists'
);

-- ============================================================================
-- AC #2/#3: self-insert succeeds with any subset of fields populated.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select lives_ok(
  $$insert into progress_entries (member_id, gym_id, note, client_entry_id)
    values ('00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009211', 'Feeling good today', '00000000-0000-0000-0000-000000009241')$$,
  'Member A can self-insert an entry with only a note populated'
);

select lives_ok(
  $$insert into progress_entries (member_id, gym_id, note, client_entry_id)
    values ('00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009211', 'Second entry', '00000000-0000-0000-0000-000000009242')$$,
  'Member A can self-insert a second entry'
);

select lives_ok(
  $$insert into progress_entries (member_id, gym_id, weight_kg, waist_cm, chest_cm, hips_cm, arms_cm, thighs_cm, note, client_entry_id)
    values ('00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009211', 82.5, 90, 100, 95, 32, 55, 'Full entry', '00000000-0000-0000-0000-000000009243')$$,
  'Member A can self-insert an entry with weight, measurements, and a note'
);

-- ============================================================================
-- The data-correctness gym_id guard: a caller cannot pass a gym_id that
-- doesn't match their own member row's real gym.
-- ============================================================================
select throws_like(
  $$insert into progress_entries (member_id, gym_id, note, client_entry_id)
    values ('00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009212', 'Mismatched gym', '00000000-0000-0000-0000-000000009244')$$,
  '%row-level security%',
  'a self-insert with a gym_id that does not match the member''s real gym is rejected'
);

-- ============================================================================
-- AC #4: self-read returns only the caller's own rows.
-- ============================================================================
select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009231'),
  3,
  'Member A can SELECT all 3 of their own progress_entries rows'
);

-- ============================================================================
-- AC #4: soft-delete via UPDATE; the entry stays visible to its own owner
-- (soft-delete does not hide a row from its own reader -- client-side
-- filtering, not RLS, decides display).
-- ============================================================================
select lives_ok(
  $$update progress_entries set deactivated_at = now()
    where client_entry_id = '00000000-0000-0000-0000-000000009241'$$,
  'Member A can soft-delete their own entry by setting deactivated_at'
);

select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009231'),
  3,
  'the soft-deleted entry is still visible to its own owner (count unchanged)'
);

select ok(
  (select deactivated_at from progress_entries where client_entry_id = '00000000-0000-0000-0000-000000009241') is not null,
  'the soft-deleted entry''s deactivated_at is actually set'
);

-- ============================================================================
-- The pin-back trigger: a self-update that also tries to change weight_kg/
-- gym_id in the same statement leaves those columns unchanged, while
-- deactivated_at does get set (column-selective pin-back, not a blanket
-- revert).
-- ============================================================================
update progress_entries
set weight_kg = 999, gym_id = '00000000-0000-0000-0000-000000009212', deactivated_at = now()
where client_entry_id = '00000000-0000-0000-0000-000000009243';

select is(
  (select weight_kg from progress_entries where client_entry_id = '00000000-0000-0000-0000-000000009243'),
  82.5,
  'a self-update attempting to also change weight_kg is silently pinned back to its prior value'
);

select is(
  (select gym_id from progress_entries where client_entry_id = '00000000-0000-0000-0000-000000009243')::text,
  '00000000-0000-0000-0000-000000009211',
  'a self-update attempting to also change gym_id is silently pinned back to its prior value'
);

select ok(
  (select deactivated_at from progress_entries where client_entry_id = '00000000-0000-0000-0000-000000009243') is not null,
  'deactivated_at still updates correctly in the same statement that attempted the pinned columns'
);

-- ============================================================================
-- The idempotency-enforcing partial unique index: a second insert with the
-- same client_entry_id for the same member raises a unique-violation.
-- ============================================================================
select throws_like(
  $$insert into progress_entries (member_id, gym_id, note, client_entry_id)
    values ('00000000-0000-0000-0000-000000009231', '00000000-0000-0000-0000-000000009211', 'Duplicate replay', '00000000-0000-0000-0000-000000009243')$$,
  '%duplicate key value violates unique constraint%',
  'a second insert reusing the same client_entry_id raises a unique-violation'
);
reset role;

-- ============================================================================
-- AC #4: cross-member denial, same gym -- a second member cannot read or
-- write the first member's rows at all.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009231'),
  0,
  'Member A2 cannot SELECT any of Member A''s progress_entries rows'
);

with updated as (
  update progress_entries set deactivated_at = now()
  where client_entry_id = '00000000-0000-0000-0000-000000009242'
  returning id
)
select is((select count(*) from updated)::int, 0, 'Member A2''s UPDATE attempt against Member A''s row affects 0 rows');
reset role;

-- ============================================================================
-- AC #4: cross-member denial, cross-gym.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009212","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009231'),
  0,
  'Member D (different gym) cannot SELECT any of Member A''s progress_entries rows'
);

with updated as (
  update progress_entries set deactivated_at = now()
  where client_entry_id = '00000000-0000-0000-0000-000000009242'
  returning id
)
select is((select count(*) from updated)::int, 0, 'Member D''s UPDATE attempt against Member A''s row affects 0 rows');
reset role;

select ok(
  (select deactivated_at from progress_entries where client_entry_id = '00000000-0000-0000-0000-000000009242') is null,
  'Member A''s untouched entry is still unmodified after both denied cross-member update attempts (verified as the connecting role, bypassing RLS visibility)'
);

-- ============================================================================
-- The new members columns: a self-update setting height_cm/starting_weight_kg
-- succeeds under the existing self_update_own_member_onboarding_fields
-- policy; a self-update also attempting to change role/gym_id in the same
-- statement still gets those columns pinned back (regression on 0020's
-- existing trigger, now covering two more self-writable columns implicitly).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

update members
set height_cm = 178.5, starting_weight_kg = 85.2, role = 'owner', gym_id = '00000000-0000-0000-0000-000000009212'
where id = '00000000-0000-0000-0000-000000009231';
reset role;

select is(
  (select height_cm from members where id = '00000000-0000-0000-0000-000000009231'),
  178.5,
  'a member self-update setting height_cm persists'
);

select is(
  (select starting_weight_kg from members where id = '00000000-0000-0000-0000-000000009231'),
  85.2,
  'a member self-update setting starting_weight_kg persists'
);

select is(
  (select role from members where id = '00000000-0000-0000-0000-000000009231')::text,
  'member',
  'a self-update attempting to also set role=owner alongside height_cm/starting_weight_kg is still pinned back'
);

select is(
  (select gym_id from members where id = '00000000-0000-0000-0000-000000009231')::text,
  '00000000-0000-0000-0000-000000009211',
  'a self-update attempting to also change gym_id alongside height_cm/starting_weight_kg is still pinned back'
);

-- ============================================================================
-- The progress-photos Storage bucket: private, and a member can SELECT/
-- INSERT/UPDATE/DELETE only under their own auth.uid() folder.
-- ============================================================================
select is(
  (select public::boolean from storage.buckets where id = 'progress-photos'),
  false,
  'the progress-photos bucket is private (public = false)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('progress-photos', '00000000-0000-0000-0000-000000009221/09243.jpg', auth.uid())$$,
  'Member A can insert into progress-photos/<own-auth-uid>/...'
);

-- Review finding: the SELECT policy (member_select_own_progress_photo)
-- shipped in the migration but had no positive assertion anywhere -- only
-- INSERT/UPDATE/DELETE were exercised.
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009221/09243.jpg'),
  1,
  'Member A can SELECT their own progress-photos object'
);

select throws_like(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('progress-photos', '00000000-0000-0000-0000-000000009222/09243.jpg', auth.uid())$$,
  '%row-level security%',
  'Member A cannot insert into progress-photos/<another-auth-uid>/...'
);

select lives_ok(
  $$update storage.objects set metadata = '{"size": 1}'::jsonb
    where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009221/09243.jpg'$$,
  'Member A can UPDATE their own progress-photos object'
);

-- Supabase's storage.protect_objects_delete trigger blocks raw DELETEs on
-- storage.objects by default (statement-level guard against accidental
-- orphaned-object data loss) -- this session-local setting is the documented
-- opt-out for exercising the real RLS DELETE policy directly via pgTAP,
-- matching gym_settings_rls.test.sql's identical precedent.
select set_config('storage.allow_delete_query', 'true', true);

select lives_ok(
  $$delete from storage.objects
    where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009221/09243.jpg'$$,
  'Member A can DELETE their own progress-photos object'
);
reset role;

-- ============================================================================
-- Story 10.2 AC #1/#2: the new coach_read_assigned_progress_entries policy.
-- An actively-assigned coach can read weight/measurements/note; a coach
-- whose assignment has ended, and a coach at a different gym, cannot --
-- re-verified live on every request, no caching window (AC #2).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009231'),
  3,
  'Coach A (actively assigned) can SELECT all 3 of Member A''s progress_entries rows'
);

select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009235'),
  0,
  'Coach A gets 0 rows for Member A-Ended -- their assignment to that member has already ended'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009226","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009212","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009231'),
  0,
  'Coach B (different gym, never assigned) gets 0 rows for Member A -- cross-gym denial'
);
reset role;

select * from finish();
rollback;
