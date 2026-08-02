-- Story 5.3: Coach Portal -- Member Detail & Session Notes. Tests
-- `private.is_own_coach_id()`, `add_session_note()`, `edit_session_note()`,
-- and the `session_notes` RLS policies (0041_coach_portal_member_detail_
-- session_notes.sql). Mirrors coach_portal_member_list.test.sql's (Story
-- 5.2) fixture-seeding/session-simulation conventions (`set local role
-- authenticated` + `set_config('request.jwt.claims', ...)`, fixtures seeded
-- up front as the connecting role, `reset role` before switching sessions).
--
-- The single most important test in this file is the reassignment/FR-055
-- regression (section (e) below): a wrong RLS policy on session_notes
-- fails silently (returns a wrong-but-plausible-looking row set), exactly
-- like coach_portal_member_list.test.sql's own central bug for
-- private.is_assigned_coach() -- not with an exception or a typecheck
-- error. See docs/decisions.md for the full design record.

begin;
select plan(29);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000015001', 'Session Notes Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000015011', 'Session Notes Gym A', '00000000-0000-0000-0000-000000015001', 30),
  ('00000000-0000-0000-0000-000000015012', 'Session Notes Gym B', '00000000-0000-0000-0000-000000015001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000015021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000015022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000015024'), -- Gym A coach 1
  ('00000000-0000-0000-0000-000000015025'), -- Gym A coach 2
  ('00000000-0000-0000-0000-000000015026'), -- Gym A coach 3 (reassignment target only)
  ('00000000-0000-0000-0000-000000015027'), -- Gym A member 1 (assigned to coach 1, later reassigned to coach 2)
  ('00000000-0000-0000-0000-000000015028'), -- Gym A member 2 (assigned to coach 2, later reassigned to coach 3)
  ('00000000-0000-0000-0000-000000015031'), -- Gym B owner
  ('00000000-0000-0000-0000-000000015032'), -- Gym B coach 1
  ('00000000-0000-0000-0000-000000015033'); -- Gym B member 1 (assigned to Gym B coach 1)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000015071', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015021', 'owner', 'Session Notes Gym A Owner', current_date),
  ('00000000-0000-0000-0000-000000015072', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015022', 'manager', 'Session Notes Gym A Manager', current_date),
  ('00000000-0000-0000-0000-000000015074', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015024', 'coach', 'Session Notes Gym A Coach 1', current_date),
  ('00000000-0000-0000-0000-000000015075', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015025', 'coach', 'Session Notes Gym A Coach 2', current_date),
  ('00000000-0000-0000-0000-000000015076', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015026', 'coach', 'Session Notes Gym A Coach 3', current_date),
  ('00000000-0000-0000-0000-000000015077', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015027', 'member', 'Session Notes Gym A Member 1', current_date),
  ('00000000-0000-0000-0000-000000015078', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015028', 'member', 'Session Notes Gym A Member 2', current_date),
  ('00000000-0000-0000-0000-000000015091', '00000000-0000-0000-0000-000000015012', '00000000-0000-0000-0000-000000015031', 'owner', 'Session Notes Gym B Owner', current_date),
  ('00000000-0000-0000-0000-000000015092', '00000000-0000-0000-0000-000000015012', '00000000-0000-0000-0000-000000015032', 'coach', 'Session Notes Gym B Coach 1', current_date),
  ('00000000-0000-0000-0000-000000015093', '00000000-0000-0000-0000-000000015012', '00000000-0000-0000-0000-000000015033', 'member', 'Session Notes Gym B Member 1', current_date);

-- Member 1 -> Coach 1 (reassigned to Coach 2 in section (e), FR-055).
-- Member 2 -> Coach 2 (reassigned to Coach 3 in section (d), "neither
-- coach currently assigned" case). B Member 1 -> B Coach 1.
insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000015121', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015077', '00000000-0000-0000-0000-000000015074', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000015122', '00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015078', '00000000-0000-0000-0000-000000015075', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000015123', '00000000-0000-0000-0000-000000015012', '00000000-0000-0000-0000-000000015093', '00000000-0000-0000-0000-000000015092', now() - interval '30 days', null);

-- ============================================================================
-- (a) private.is_own_coach_id() called directly, as Coach 1.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select is(
  (select private.is_own_coach_id('00000000-0000-0000-0000-000000015074')),
  true,
  'private.is_own_coach_id() returns true for the calling coach''s own members.id'
);

select is(
  (select private.is_own_coach_id('00000000-0000-0000-0000-000000015075')),
  false,
  'private.is_own_coach_id() returns false for a different coach''s members.id'
);

select is(
  (select private.is_own_coach_id('00000000-0000-0000-0000-000000015077')),
  false,
  'private.is_own_coach_id() returns false for a non-coach member''s members.id'
);

select lives_ok(
  $$select private.is_own_coach_id('00000000-0000-0000-0000-000000000999')$$,
  'private.is_own_coach_id() never raises for a nonexistent members.id'
);

select is(
  (select private.is_own_coach_id('00000000-0000-0000-0000-000000000999')),
  false,
  'private.is_own_coach_id() returns false for a nonexistent members.id'
);

-- ============================================================================
-- (b) add_session_note(): as Coach 1, for their assigned Member 1.
-- ============================================================================
select isnt(
  (select add_session_note('00000000-0000-0000-0000-000000015077', 'First session: good energy, form needs work on squats.')),
  null,
  'add_session_note() returns a non-null uuid for Coach 1''s assigned Member 1'
);

select is(
  (select coach_id from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  '00000000-0000-0000-0000-000000015074'::uuid,
  'the new session_notes row''s coach_id is Coach 1''s own resolved members.id'
);

select is(
  (select coach_assignment_id from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  '00000000-0000-0000-0000-000000015121'::uuid,
  'the new session_notes row''s coach_assignment_id matches Coach 1''s active assignment to Member 1'
);

select throws_like(
  $$select add_session_note('00000000-0000-0000-0000-000000015078', 'trying to note someone else''s client')$$,
  '%is not currently assigned%',
  'add_session_note() rejects Coach 1 writing a note for Member 2, who is assigned to Coach 2'
);

select throws_like(
  $$select add_session_note('00000000-0000-0000-0000-000000000999', 'nonexistent member')$$,
  '%is not currently assigned%',
  'add_session_note() rejects a nonexistent member id (no matching active assignment either)'
);

select throws_like(
  $$select add_session_note('00000000-0000-0000-0000-000000015077', '')$$,
  '%note text is required%',
  'add_session_note() rejects an empty note_text'
);

select throws_like(
  $$select add_session_note('00000000-0000-0000-0000-000000015077', '    ')$$,
  '%note text is required%',
  'add_session_note() rejects a whitespace-only note_text'
);

-- ============================================================================
-- (c) edit_session_note(): as Coach 1, editing their own note (from (b)).
-- ============================================================================
select lives_ok(
  $$select edit_session_note(
    (select id from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
    'Updated: squat form improved significantly this session.'
  )$$,
  'edit_session_note() succeeds without raising for Coach 1 editing their own note'
);

select is(
  (select note_text from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  'Updated: squat form improved significantly this session.',
  'note_text was updated by edit_session_note()'
);

select isnt(
  (select edited_at from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  null,
  'edited_at is set (non-null) after edit_session_note()'
);

-- >= not > : both created_at and edited_at default to now(), which is
-- transaction_timestamp() in Postgres -- constant for every statement
-- inside this file's single begin/rollback transaction, so the INSERT and
-- the later UPDATE resolve to the identical instant here. In production
-- (separate transactions) edited_at is strictly later; this assertion
-- confirms edit_session_note() never moves it backwards.
select ok(
  (select edited_at >= created_at from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  'edited_at is at least as recent as created_at after edit_session_note() (same-transaction now() is constant, see comment)'
);

-- ============================================================================
-- (d) AC #4's actual enforcement test: as Coach 1, attempting to edit
-- Coach 2's note on Member 2 -- first while Member 2 is still currently
-- assigned to Coach 2, then again after Member 2 is reassigned to Coach 3
-- (so the note sits on a member neither Coach 1 nor Coach 2 is currently
-- assigned to). Both must raise -- the RPC's coach_id-ownership check does
-- not depend on assignment status at all.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select isnt(
  (select add_session_note('00000000-0000-0000-0000-000000015078', 'Coach 2''s note on their own assigned Member 2.')),
  null,
  'add_session_note() returns a non-null uuid for Coach 2''s assigned Member 2'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select throws_like(
  $$select edit_session_note((select id from session_notes where member_id = '00000000-0000-0000-0000-000000015078'), 'Coach 1 trying to edit Coach 2''s note')$$,
  '%not found or not owned%',
  'edit_session_note() rejects Coach 1 editing Coach 2''s note on Coach 2''s own currently-assigned Member 2'
);

-- Owner reassigns Member 2 from Coach 2 to Coach 3 -- now neither Coach 1
-- nor Coach 2 is currently assigned to Member 2, but Coach 2's note on
-- Member 2 still exists.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"owner"}',
  true
);
select assign_coach('00000000-0000-0000-0000-000000015078', '00000000-0000-0000-0000-000000015076');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select throws_like(
  $$select edit_session_note((select id from session_notes where member_id = '00000000-0000-0000-0000-000000015078'), 'Coach 1 still trying to edit Coach 2''s stale note')$$,
  '%not found or not owned%',
  'edit_session_note() rejects Coach 1 editing Coach 2''s note on Member 2 even after Member 2 is reassigned to Coach 3 (neither Coach 1 nor Coach 2 currently assigned)'
);

-- ============================================================================
-- (e) The FR-055 reassignment regression test -- this file's single most
-- important assertion. Member 1 is assigned to Coach 1, who wrote a note on
-- them in (b)/(c). Owner reassigns Member 1 to Coach 2. Coach 2's own query
-- must return ZERO rows for Member 1's session_notes (Coach 1's note stays
-- invisible to the new coach); Owner/Manager's query must still return the
-- full history.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"owner"}',
  true
);
select assign_coach('00000000-0000-0000-0000-000000015077', '00000000-0000-0000-0000-000000015075');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  0,
  'FR-055: Coach 2 (the new coach after reassignment) sees zero rows for Member 1''s session_notes -- Coach 1''s prior note stays invisible'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from session_notes where member_id = '00000000-0000-0000-0000-000000015077'),
  1,
  'FR-055: an owner-claim session still sees Member 1''s full session-note history, including Coach 1''s note, after reassignment'
);

-- Edit-authorization must be revoked the same moment visibility is (code
-- review finding): Coach 1 authored this note and could edit it freely
-- before the reassignment (see (c)), but now that Member 1 is reassigned to
-- Coach 2, Coach 1's own edit_session_note() call on their own note must
-- also fail -- not just Coach 1's SELECT query.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select throws_like(
  $$select edit_session_note((select id from session_notes where member_id = '00000000-0000-0000-0000-000000015077'), 'Coach 1 trying to edit own note after losing the assignment')$$,
  '%not found or not owned%',
  'edit_session_note() rejects Coach 1 editing their own note on Member 1 after Member 1 is reassigned to Coach 2 (FR-055 applies to writes too)'
);

-- ============================================================================
-- (f) Owner/Manager full SELECT visibility across all coaches' notes in
-- their own gym; denied cross-gym (tenant isolation).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from session_notes where gym_id = '00000000-0000-0000-0000-000000015011'),
  2,
  'an owner-claim session sees all 2 Gym A session_notes rows (Coach 1''s and Coach 2''s), across both coaches'
);

select is(
  (select count(*)::int from session_notes where gym_id = '00000000-0000-0000-0000-000000015012'),
  0,
  'a Gym A owner-claim session sees 0 rows for Gym B''s session_notes -- tenant isolation'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from session_notes where gym_id = '00000000-0000-0000-0000-000000015011'),
  2,
  'a manager-claim session sees all 2 Gym A session_notes rows too'
);

-- ============================================================================
-- (g) Compounded denial: direct RLS SELECT as Coach 1 for a note authored
-- by Coach 2 on Member 2, a member never assigned to Coach 1 at any point
-- -- both is_assigned_coach() and is_own_coach_id() must fail.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from session_notes where member_id = '00000000-0000-0000-0000-000000015078'),
  0,
  'Coach 1 sees 0 rows for Coach 2''s note on Member 2 -- compounded denial (never assigned + not own note)'
);

-- ============================================================================
-- (h) session_notes_note_text_not_blank CHECK constraint: a direct insert
-- (as service_role, bypassing add_session_note() entirely) with an empty or
-- all-whitespace note_text fails.
-- ============================================================================
set local role service_role;
select throws_like(
  $$insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
    values ('00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015077', '00000000-0000-0000-0000-000000015074', '00000000-0000-0000-0000-000000015121', '')$$,
  '%session_notes_note_text_not_blank%',
  'a raw INSERT with an empty note_text violates session_notes_note_text_not_blank'
);

select throws_like(
  $$insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
    values ('00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015077', '00000000-0000-0000-0000-000000015074', '00000000-0000-0000-0000-000000015121', '   ')$$,
  '%session_notes_note_text_not_blank%',
  'a raw INSERT with an all-whitespace note_text violates session_notes_note_text_not_blank'
);

-- session_notes_note_text_len CHECK constraint (code review finding: the
-- 2000-char cap was previously enforced only by the client-side Zod schema,
-- not the database, so a direct insert bypassing add_session_note() could
-- write unbounded text).
select throws_like(
  $$insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
    values ('00000000-0000-0000-0000-000000015011', '00000000-0000-0000-0000-000000015077', '00000000-0000-0000-0000-000000015074', '00000000-0000-0000-0000-000000015121', repeat('x', 2001))$$,
  '%session_notes_note_text_len%',
  'a raw INSERT with note_text longer than 2000 chars violates session_notes_note_text_len'
);
reset role;

select * from finish();
rollback;
