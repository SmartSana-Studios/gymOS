-- Story 6.7: public.notifications RLS coverage. This is new, member-facing
-- PII-adjacent data (notification copy can reference payment amounts, gym
-- names) -- the cross-member read-visibility proof below is the single
-- highest-value assertion in this file.

begin;
select plan(11);

select ok(to_regclass('public.notifications') is not null, 'public.notifications exists');
select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('public.notifications')),
  'notifications has RLS enabled'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.notifications')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%N-01%N-02%N-03%N-04%N-05%N-06%N-07%'
  ),
  'notification type is restricted to N-01..N-07'
);

-- ============================================================================
-- Fixtures: two members in the same active gym (A, B) for cross-member
-- read/update isolation, plus one member in a suspended gym (C) for the
-- tenant_active_gate proof.
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-00000000aa01', 'Notif History Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-00000000aa02', 'Notif History Active Gym', '00000000-0000-0000-0000-00000000aa01', 'active'),
  ('00000000-0000-0000-0000-00000000aa03', 'Notif History Suspended Gym', '00000000-0000-0000-0000-00000000aa01', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000aa10'), -- A
  ('00000000-0000-0000-0000-00000000aa11'), -- B
  ('00000000-0000-0000-0000-00000000aa12'); -- C (suspended gym)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-00000000aa20', '00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000aa10', 'member', 'Member A'),
  ('00000000-0000-0000-0000-00000000aa21', '00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000aa11', 'member', 'Member B'),
  ('00000000-0000-0000-0000-00000000aa22', '00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000aa12', 'member', 'Member C');

insert into public.notifications (id, member_id, gym_id, type, title, body) values
  ('00000000-0000-0000-0000-00000000aa30', '00000000-0000-0000-0000-00000000aa20', '00000000-0000-0000-0000-00000000aa02', 'N-01', 'A Title', 'A Body'),
  ('00000000-0000-0000-0000-00000000aa31', '00000000-0000-0000-0000-00000000aa21', '00000000-0000-0000-0000-00000000aa02', 'N-01', 'B Title', 'B Body'),
  ('00000000-0000-0000-0000-00000000aa32', '00000000-0000-0000-0000-00000000aa22', '00000000-0000-0000-0000-00000000aa03', 'N-01', 'C Title', 'C Body');

-- ============================================================================
-- Cross-member read isolation -- the highest-value proof in this file.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000aa10","role":"authenticated","gym_id":"00000000-0000-0000-0000-00000000aa02","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from public.notifications),
  1,
  'a member sees exactly one row: their own -- not gym-mate B''s'
);

select is(
  (select id::text from public.notifications limit 1),
  '00000000-0000-0000-0000-00000000aa30',
  'the one visible row is specifically the member''s own, not a random/other row'
);

-- ============================================================================
-- read_at is the only mutable column, and only on the member's own row.
-- ============================================================================
update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-00000000aa30';
select ok(
  (select read_at is not null from public.notifications where id = '00000000-0000-0000-0000-00000000aa30'),
  'a member can mark their own row read'
);

-- RLS silently filters out a row the caller cannot see -- this UPDATE
-- targets B's row by id but must affect zero rows, not error.
update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-00000000aa31';

select throws_like(
  $$update public.notifications set title = 'HACKED' where id = '00000000-0000-0000-0000-00000000aa30'$$,
  '%permission denied%',
  'a member cannot rewrite their own notification''s title -- no column privilege, whole statement denied'
);

-- Review finding: docs/decisions.md's Decision 3 claims this was confirmed
-- "even when read_at is also included in the same statement" -- the test
-- above never actually exercised that combination. This one does.
select throws_like(
  $$update public.notifications set read_at = now(), title = 'HACKED' where id = '00000000-0000-0000-0000-00000000aa30'$$,
  '%permission denied%',
  'combining an allowed column (read_at) with a disallowed one (title) in the same statement still denies the whole statement'
);

reset role;

-- Verified as the superuser connection (bypasses RLS) since A's own session
-- cannot see B's row at all to check it directly.
select ok(
  (select read_at is null from public.notifications where id = '00000000-0000-0000-0000-00000000aa31'),
  'attempting to mark another member''s row read affected zero rows -- B''s row is still unread'
);

-- ============================================================================
-- tenant_active_gate: a suspended gym's member is denied both read and
-- update, mirroring member_preferences' identical existing gate.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000aa12","role":"authenticated","gym_id":"00000000-0000-0000-0000-00000000aa03","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from public.notifications),
  0,
  'a suspended gym''s member cannot read their own notifications row'
);

-- Targets the row by id -- RLS + tenant_active_gate must silently exclude
-- it from the update, affecting zero rows, not error.
update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-00000000aa32';

reset role;

-- Confirm the row itself is untouched (still unread) -- proves the denial
-- above was a real no-op, not a silently-successful write under a
-- different session.
select ok(
  (select read_at is null from public.notifications where id = '00000000-0000-0000-0000-00000000aa32'),
  'the suspended member''s row is still unread -- the denied update above truly wrote nothing'
);

select * from finish();
rollback;
