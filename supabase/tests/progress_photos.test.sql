-- Story 10.2: Progress Data & Photo Privacy. New table/RLS/trigger from
-- 0067_progress_data_photo_privacy.sql -- progress_photos' self_read/
-- self_insert/self_update_sharing/coach_read_shared policies, the
-- protect_progress_photo_immutable_columns pin-back trigger, the partial
-- unique index on progress_entry_id, the new coach_read_assigned_
-- progress_entries policy is covered in progress_entries.test.sql (not
-- here, per this story's own task list), and the coach_select_shared_
-- progress_photo Storage policy on the existing progress-photos bucket
-- (0066). Session-simulation and cross-member-denial conventions match
-- progress_entries.test.sql; coach/coach_assignment fixture shape matches
-- coach_portal_member_list.test.sql (active assignment, ended assignment,
-- cross-gym coach).

begin;
select plan(24);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009601', 'Progress Photos Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009611', 'Progress Photos Test Gym A', '00000000-0000-0000-0000-000000009601', 30),
  ('00000000-0000-0000-0000-000000009612', 'Progress Photos Test Gym B', '00000000-0000-0000-0000-000000009601', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009621'), -- Member A (self-access, the row under test)
  ('00000000-0000-0000-0000-000000009622'), -- Member A2 (different member, same gym -- cross-member denial)
  ('00000000-0000-0000-0000-000000009623'), -- Member A-Ended (Coach A's assignment to them has ended)
  ('00000000-0000-0000-0000-000000009624'), -- Coach A (gym A, actively assigned to Member A)
  ('00000000-0000-0000-0000-000000009625'); -- Coach B (gym B, never assigned to Member A -- cross-gym denial)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009621', 'member', 'Member A'),
  ('00000000-0000-0000-0000-000000009632', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009622', 'member', 'Member A2'),
  ('00000000-0000-0000-0000-000000009633', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009623', 'member', 'Member A-Ended'),
  ('00000000-0000-0000-0000-000000009634', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009624', 'coach', 'Coach A'),
  ('00000000-0000-0000-0000-000000009635', '00000000-0000-0000-0000-000000009612', '00000000-0000-0000-0000-000000009625', 'coach', 'Coach B');

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000009651', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009634', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000009652', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009633', '00000000-0000-0000-0000-000000009634', now() - interval '60 days', now() - interval '30 days');

insert into progress_entries (id, member_id, gym_id, weight_kg, client_entry_id) values
  ('00000000-0000-0000-0000-000000009641', '00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', 80, '00000000-0000-0000-0000-000000009641'),
  ('00000000-0000-0000-0000-000000009642', '00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', 79, '00000000-0000-0000-0000-000000009642'),
  ('00000000-0000-0000-0000-000000009643', '00000000-0000-0000-0000-000000009632', '00000000-0000-0000-0000-000000009611', 60, '00000000-0000-0000-0000-000000009643'),
  ('00000000-0000-0000-0000-000000009644', '00000000-0000-0000-0000-000000009633', '00000000-0000-0000-0000-000000009611', 65, '00000000-0000-0000-0000-000000009644');

-- Member A-Ended's own photo, shared with the coach at insert time -- used
-- only for the ended-assignment coach-denial assertion below.
insert into progress_photos (gym_id, member_id, progress_entry_id, photo_path, shared_with_coach) values
  ('00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009633', '00000000-0000-0000-0000-000000009644', '00000000-0000-0000-0000-000000009623/ae.jpg', true);

-- ============================================================================
-- Task 2 RED contract: table shape, RLS enabled, indexes.
-- ============================================================================
select ok(to_regclass('public.progress_photos') is not null, 'progress_photos exists in public');

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('public.progress_photos')),
  'progress_photos has RLS enabled'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'progress_photos' and indexdef like '%gym_id%'
  ),
  'progress_photos has a gym_id index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'progress_photos' and indexdef like '%member_id%'
  ),
  'progress_photos has a member_id index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'progress_photos'
      and indexname = 'idx_progress_photos_entry_id' and indexdef like '%UNIQUE%'
  ),
  'progress_photos has a unique index on progress_entry_id (one photo per entry)'
);

-- ============================================================================
-- AC #5: self-insert succeeds; sharing defaults to off at the DB layer
-- regardless of what the client sends (no shared_with_coach in the payload).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009621","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);

select lives_ok(
  $$insert into progress_photos (member_id, gym_id, progress_entry_id, photo_path)
    values ('00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009641', '00000000-0000-0000-0000-000000009621/e1.jpg')$$,
  'Member A can self-insert a photo row for their own entry'
);

select is(
  (select shared_with_coach from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009641'),
  false,
  'a newly self-inserted photo row defaults to shared_with_coach = false, enforced at the DB layer'
);

select lives_ok(
  $$insert into progress_photos (member_id, gym_id, progress_entry_id, photo_path)
    values ('00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009642', '00000000-0000-0000-0000-000000009621/e2.jpg')$$,
  'Member A can self-insert a second photo row for their second entry'
);

-- The exists-clause data-correctness guard: a caller cannot attach a photo
-- row to another member's entry.
select throws_like(
  $$insert into progress_photos (member_id, gym_id, progress_entry_id, photo_path)
    values ('00000000-0000-0000-0000-000000009631', '00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009643', '00000000-0000-0000-0000-000000009621/hijack.jpg')$$,
  '%row-level security%',
  'Member A cannot self-insert a photo row against Member A2''s entry -- the exists-clause guard rejects it'
);

select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009631'),
  2,
  'Member A can SELECT both of their own progress_photos rows'
);

-- ============================================================================
-- The pin-back trigger: a self-update attempting to also change photo_path/
-- member_id in the same statement leaves those columns unchanged, while
-- shared_with_coach does get updated (column-selective pin-back).
-- ============================================================================
update progress_photos
set photo_path = 'hacked.jpg', member_id = '00000000-0000-0000-0000-000000009632', shared_with_coach = true
where progress_entry_id = '00000000-0000-0000-0000-000000009641';

select is(
  (select photo_path from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009641'),
  '00000000-0000-0000-0000-000000009621/e1.jpg',
  'a self-update attempting to also change photo_path is silently pinned back to its prior value'
);

select is(
  (select member_id from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009641')::text,
  '00000000-0000-0000-0000-000000009631',
  'a self-update attempting to also change member_id is silently pinned back to its prior value'
);

select is(
  (select shared_with_coach from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009641'),
  true,
  'shared_with_coach still updates correctly in the same statement that attempted the pinned columns'
);
reset role;

-- ============================================================================
-- AC #1: cross-member denial -- a second member cannot read another's
-- photo row at all, not even the row's existence.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009622","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009631'),
  0,
  'Member A2 cannot SELECT any of Member A''s progress_photos rows'
);
reset role;

-- ============================================================================
-- AC #1/#5: an actively-assigned coach reads only the shared photo --
-- Entry1 is now shared_with_coach = true, Entry2 is still the DB default
-- false.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009624","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009631'),
  1,
  'Coach A (actively assigned) can SELECT only Member A''s shared photo (1 of 2 rows)'
);

select is(
  (select count(*)::int from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009642'),
  0,
  'Coach A gets 0 rows for Entry2''s photo -- shared_with_coach is still false'
);
reset role;

-- ============================================================================
-- AC #2/#4: the revoke/grant is re-verified live, no caching window --
-- toggle both flags in the same test run and re-query as the coach.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009621","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);
update progress_photos set shared_with_coach = false where progress_entry_id = '00000000-0000-0000-0000-000000009641';
update progress_photos set shared_with_coach = true where progress_entry_id = '00000000-0000-0000-0000-000000009642';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009624","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009631'),
  1,
  'Coach A still sees exactly 1 shared photo after the toggle -- but it is now the other one'
);

select is(
  (select count(*)::int from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009641'),
  0,
  'Coach A immediately loses access to Entry1''s photo the moment shared_with_coach flips to false -- no caching window'
);

select is(
  (select count(*)::int from progress_photos where progress_entry_id = '00000000-0000-0000-0000-000000009642'),
  1,
  'Coach A immediately gains access to Entry2''s photo the moment shared_with_coach flips to true'
);

-- ============================================================================
-- AC #2: a coach whose assignment has ended gets 0 rows even though the
-- row exists and is shared.
-- ============================================================================
select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009633'),
  0,
  'Coach A gets 0 rows for Member A-Ended''s photo -- their assignment to that member has already ended, despite shared_with_coach = true'
);
reset role;

-- ============================================================================
-- Cross-gym denial: a coach at a different gym gets 0 rows regardless of
-- assignment status.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009625","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009612","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009631'),
  0,
  'Coach B (different gym) gets 0 rows for Member A -- cross-gym denial'
);
reset role;

-- ============================================================================
-- Storage RLS: the coach_select_shared_progress_photo policy mirrors the
-- same live re-check at the Storage layer -- a coach can SELECT the object
-- only while the paired progress_photos row is shared_with_coach = true,
-- and loses access the instant it flips to false, in the same test run.
-- ============================================================================
insert into storage.objects (bucket_id, name, owner) values
  ('progress-photos', '00000000-0000-0000-0000-000000009621/e1.jpg', '00000000-0000-0000-0000-000000009621'),
  ('progress-photos', '00000000-0000-0000-0000-000000009621/e2.jpg', '00000000-0000-0000-0000-000000009621');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009624","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009621/e2.jpg'),
  1,
  'Coach A can SELECT the Storage object for Entry2''s photo -- it is currently shared'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009621/e1.jpg'),
  0,
  'Coach A cannot SELECT the Storage object for Entry1''s photo -- it is currently unshared'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009621","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"member"}',
  true
);
update progress_photos set shared_with_coach = false where progress_entry_id = '00000000-0000-0000-0000-000000009642';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009624","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009611","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009621/e2.jpg'),
  0,
  'Coach A immediately loses Storage access to Entry2''s photo the moment shared_with_coach flips to false -- mint-time enforcement, no caching window'
);
reset role;

select * from finish();
rollback;
