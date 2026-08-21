-- Story 10.2 negative privilege contract: progress_photos is
-- authenticated/service_role-writable but strictly self-scoped plus a
-- narrow shared-with-an-assigned-coach carve-out -- anon cannot touch it at
-- all, gym staff (Manager/Owner/Receptionist/Supervisor) have no
-- staff-facing read/write policy at all (FR-095's explicit non-goal), a
-- peer member cannot flip another member's sharing flag, and a Coach who is
-- NOT currently assigned to the member gets 0 rows regardless of
-- shared_with_coach, proving the coach carve-out is assignment-gated, not
-- role-gated.

begin;
select plan(18);

select ok(
  not has_table_privilege('anon', 'progress_photos', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon has no progress_photos table access at all'
);

select ok(
  has_table_privilege('authenticated', 'progress_photos', 'SELECT')
    and has_table_privilege('authenticated', 'progress_photos', 'INSERT')
    and has_table_privilege('authenticated', 'progress_photos', 'UPDATE'),
  'authenticated has the baseline SELECT/INSERT/UPDATE grant (RLS still scopes it to self/shared-coach)'
);

select ok(
  not has_table_privilege('authenticated', 'progress_photos', 'DELETE'),
  'authenticated has no DELETE grant -- photo removal only happens via the parent entry''s cascade'
);

select ok(
  has_table_privilege('service_role', 'progress_photos', 'SELECT')
    and has_table_privilege('service_role', 'progress_photos', 'INSERT')
    and has_table_privilege('service_role', 'progress_photos', 'UPDATE')
    and has_table_privilege('service_role', 'progress_photos', 'DELETE'),
  'service_role has the full baseline table-level grant'
);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009701', 'Progress Photos Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009711', 'Progress Photos Negative Test Gym', '00000000-0000-0000-0000-000000009701', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009721'), -- Member (the row under test)
  ('00000000-0000-0000-0000-000000009722'), -- Manager
  ('00000000-0000-0000-0000-000000009723'), -- Owner
  ('00000000-0000-0000-0000-000000009724'), -- Receptionist
  ('00000000-0000-0000-0000-000000009725'), -- Coach (never assigned to the member)
  ('00000000-0000-0000-0000-000000009726'), -- Supervisor (Review finding -- AC #1 names Supervisor explicitly)
  ('00000000-0000-0000-0000-000000009727'); -- Member 2 (peer member, same gym -- cross-member UPDATE denial, Review finding)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009731', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009721', 'member', 'Negative Test Member'),
  ('00000000-0000-0000-0000-000000009732', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009722', 'manager', 'Negative Test Manager'),
  ('00000000-0000-0000-0000-000000009733', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009723', 'owner', 'Negative Test Owner'),
  ('00000000-0000-0000-0000-000000009734', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009724', 'receptionist', 'Negative Test Receptionist'),
  ('00000000-0000-0000-0000-000000009735', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009725', 'coach', 'Negative Test Unassigned Coach'),
  ('00000000-0000-0000-0000-000000009736', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009726', 'supervisor', 'Negative Test Supervisor'),
  ('00000000-0000-0000-0000-000000009737', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009727', 'member', 'Negative Test Member 2');

insert into progress_entries (id, member_id, gym_id, weight_kg, client_entry_id) values
  ('00000000-0000-0000-0000-000000009741', '00000000-0000-0000-0000-000000009731', '00000000-0000-0000-0000-000000009711', 70, '00000000-0000-0000-0000-000000009741');

-- shared_with_coach = true on purpose -- proves the coach carve-out is
-- assignment-gated (private.is_assigned_coach()), not merely a broad "any
-- coach role, any shared photo" grant.
insert into progress_photos (id, gym_id, member_id, progress_entry_id, photo_path, shared_with_coach) values
  ('00000000-0000-0000-0000-000000009751', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', '00000000-0000-0000-0000-000000009741', '00000000-0000-0000-0000-000000009721/photo.jpg', true);

-- Storage negative fixture: an unassigned coach cannot SELECT the shared
-- photo's Storage object either -- coach_select_shared_progress_photo
-- requires private.is_assigned_coach(), same as the table-level policy.
-- Seeded here, before any role switch, so the fixture-owning role's own
-- write access (unaffected by any RLS policy) inserts it.
insert into storage.objects (bucket_id, name, owner) values
  ('progress-photos', '00000000-0000-0000-0000-000000009721/photo.jpg', '00000000-0000-0000-0000-000000009721');

-- ============================================================================
-- Gym staff (Manager/Owner/Receptionist) have no staff-facing policy on
-- progress_photos -- only the self policies and the assignment-gated coach
-- policy exist, so both SELECT and UPDATE must resolve to zero rows, not
-- an error.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009722","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"manager"}',
  true
);
select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009731'),
  0,
  'a Manager cannot SELECT a member''s progress_photos row -- no staff-facing read policy exists'
);
with updated as (
  update progress_photos set shared_with_coach = false
  where member_id = '00000000-0000-0000-0000-000000009731'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Manager cannot UPDATE a member''s progress_photos row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009723","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"owner"}',
  true
);
select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009731'),
  0,
  'an Owner cannot SELECT a member''s progress_photos row -- no staff-facing read policy exists'
);
with updated as (
  update progress_photos set shared_with_coach = false
  where member_id = '00000000-0000-0000-0000-000000009731'
  returning id
)
select is((select count(*) from updated)::int, 0, 'an Owner cannot UPDATE a member''s progress_photos row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009724","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"receptionist"}',
  true
);
select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009731'),
  0,
  'a Receptionist cannot SELECT a member''s progress_photos row -- no staff-facing read policy exists'
);
with updated as (
  update progress_photos set shared_with_coach = false
  where member_id = '00000000-0000-0000-0000-000000009731'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Receptionist cannot UPDATE a member''s progress_photos row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009725","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"coach"}',
  true
);
select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009731'),
  0,
  'an unassigned Coach cannot SELECT the member''s progress_photos row even though shared_with_coach = true -- the carve-out requires an active assignment'
);
with updated as (
  update progress_photos set shared_with_coach = false
  where member_id = '00000000-0000-0000-0000-000000009731'
  returning id
)
select is((select count(*) from updated)::int, 0, 'an unassigned Coach cannot UPDATE the member''s progress_photos row -- no write policy exists for a coach at all, assigned or not');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009721/photo.jpg'),
  0,
  'an unassigned Coach cannot SELECT the shared photo''s Storage object -- coach_select_shared_progress_photo requires an active assignment'
);
reset role;

-- Review finding: AC #1 explicitly names Supervisor among the roles that
-- must never read this data; only Manager/Owner/Receptionist/unassigned
-- Coach were previously covered here.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009726","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"supervisor"}',
  true
);
select is(
  (select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0000-000000009731'),
  0,
  'a Supervisor cannot SELECT a member''s progress_photos row -- no staff-facing read policy exists'
);
with updated as (
  update progress_photos set shared_with_coach = false
  where member_id = '00000000-0000-0000-0000-000000009731'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Supervisor cannot UPDATE a member''s progress_photos row -- no staff-facing write policy exists');
reset role;

-- Review finding: no coverage previously proved a peer member (not the
-- owner) can't flip another member's sharing flag -- only cross-member
-- SELECT denial was tested (progress_photos.test.sql), never UPDATE.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009727","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"member"}',
  true
);
with updated as (
  update progress_photos set shared_with_coach = false
  where member_id = '00000000-0000-0000-0000-000000009731'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a peer Member cannot UPDATE another member''s progress_photos row -- self_update_own_progress_photo_sharing is member_id-scoped');
reset role;

select ok(
  (select shared_with_coach from progress_photos where id = '00000000-0000-0000-0000-000000009751') = true,
  'the photo''s shared_with_coach is unchanged (still true) after all six denied staff/unassigned-coach/peer-member update attempts'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009722","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"manager"}',
  true
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'progress-photos' and name = '00000000-0000-0000-0000-000000009721/photo.jpg'),
  0,
  'a Manager cannot SELECT the shared photo''s Storage object -- coach_select_shared_progress_photo requires app_role = coach'
);
reset role;

select * from finish();
rollback;
