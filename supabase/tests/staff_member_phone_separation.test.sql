-- One phone is either a STAFF account or a MEMBER account, never both
-- (migration 0094).
--
-- THE RULE: a phone holding an active staff row may not also hold a member
-- row, and vice versa. A staff member who also wants to train uses a second
-- number. A session carries exactly one `app_role` claim, so one account being
-- both is ambiguous -- the claims hook would have to pick, and 0065's fallback
-- picks whichever membership was created most recently.
--
-- WHAT THIS RULE MUST NOT BREAK, and why those assertions matter as much as
-- the refusals: FR-001 (epics.md:26) states "a user may be a member at
-- multiple gyms via separate `members` rows". A one-membership-per-user
-- constraint was drafted alongside this rule and DROPPED for contradicting it
-- -- it would have killed per-gym member notification preferences
-- (notification_preferences.test.sql:242-258) and the subscription-expiry copy
-- that names the gym (subscription_lifecycle_notifications.test.sql:294-304).
-- The multi-gym assertions below are the guard against that being re-attempted
-- without amending the requirement first.

begin;
select plan(9);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000020501', 'Phone Separation Tier', 6000, 60000, 50);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000020511', 'Phone Separation Gym A', '00000000-0000-0000-0000-000000020501', 'active', 25),
  ('00000000-0000-0000-0000-000000020512', 'Phone Separation Gym B', '00000000-0000-0000-0000-000000020501', 'active', 25);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000020521'), -- member at Gym A
  ('00000000-0000-0000-0000-000000020522'), -- coach at Gym A
  ('00000000-0000-0000-0000-000000020523'), -- former coach at Gym A (deactivated)
  ('00000000-0000-0000-0000-000000020524'); -- unused

insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at) values
  ('00000000-0000-0000-0000-000000020531', '00000000-0000-0000-0000-000000020511', '00000000-0000-0000-0000-000000020521', 'member', 'Separation Member',    current_date, null),
  ('00000000-0000-0000-0000-000000020532', '00000000-0000-0000-0000-000000020511', '00000000-0000-0000-0000-000000020522', 'coach',  'Separation Coach',     current_date, null),
  ('00000000-0000-0000-0000-000000020533', '00000000-0000-0000-0000-000000020511', '00000000-0000-0000-0000-000000020523', 'coach',  'Separation Ex-Coach',  current_date, now());

-- ---------------------------------------------------------------------------
-- The rule, both directions.
-- ---------------------------------------------------------------------------
select throws_like(
  $$insert into members (gym_id, user_id, role, name, join_date)
    values ('00000000-0000-0000-0000-000000020512', '00000000-0000-0000-0000-000000020522', 'member', 'Coach wants to train', current_date)$$,
  '%already belongs to a staff account%',
  'a phone holding a STAFF row cannot become a member -- a coach who also wants to train needs a second number'
);

select throws_like(
  $$insert into members (gym_id, user_id, role, name, join_date)
    values ('00000000-0000-0000-0000-000000020512', '00000000-0000-0000-0000-000000020521', 'coach', 'Member gets hired', current_date)$$,
  '%already belongs to a member account%',
  'and in reverse -- a phone holding a MEMBER row cannot become staff, with its own distinct message so the UI can say which way round it is'
);

-- ---------------------------------------------------------------------------
-- FR-001 MUST SURVIVE. Without these, the refusals above would still pass if
-- the rule had been implemented as "one membership per person" instead.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into members (gym_id, user_id, role, name, join_date)
    values ('00000000-0000-0000-0000-000000020512', '00000000-0000-0000-0000-000000020521', 'member', 'Member at a second gym', current_date)$$,
  'FR-001: a MEMBER may still belong to a SECOND gym -- per-gym notification preferences and the gym-named expiry copy both depend on this'
);

select lives_ok(
  $$insert into members (gym_id, user_id, role, name, join_date)
    values ('00000000-0000-0000-0000-000000020512', '00000000-0000-0000-0000-000000020522', 'coach', 'Coach at a second gym', current_date)$$,
  'STAFF may still hold rows at a SECOND gym -- Story 9.4''s multi-gym binding and 9.6''s switcher are untouched'
);

select is(
  (select count(*)::int from members
   where user_id = '00000000-0000-0000-0000-000000020521' and deactivated_at is null),
  2,
  'positive control: that member really does now hold two active memberships, so the lives_ok above was not a no-op'
);

-- ---------------------------------------------------------------------------
-- Deactivated rows are history and must not constrain anything, otherwise a
-- departing coach could never join as a member on their own number.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into members (gym_id, user_id, role, name, join_date)
    values ('00000000-0000-0000-0000-000000020512', '00000000-0000-0000-0000-000000020523', 'member', 'Ex-coach now trains', current_date)$$,
  'a DEACTIVATED staff row does not block the same number becoming a member -- a coach who leaves can join as a member'
);

select lives_ok(
  $$insert into members (gym_id, user_id, role, name, join_date)
    values ('00000000-0000-0000-0000-000000020511', '00000000-0000-0000-0000-000000020524', 'member', 'Brand new', current_date)$$,
  'an unused phone can still become a member -- the ordinary path is unaffected'
);

-- ---------------------------------------------------------------------------
-- Structural.
-- ---------------------------------------------------------------------------
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_staff_member_phone_separation'),
  true,
  'the trigger function is SECURITY DEFINER -- members is RLS-gated, so under invoker rights a caller who cannot see the conflicting row would find none and the guard would FAIL OPEN'
);

select is(
  (select count(*)::int from pg_indexes
   where schemaname = 'public' and indexdef ilike '%unique%'
     and indexdef ilike '%ON public.members%' and indexdef ilike '%(user_id)%'
     and indexdef not ilike '%gym_id%'),
  0,
  'no unique index on members(user_id) alone -- one would contradict FR-001 and silently kill per-gym preferences and the gym-named expiry copy'
);

select * from finish();
rollback;
