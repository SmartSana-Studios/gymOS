-- Story 1.17: idx_members_active_gym_user -- created by 0003_members_and_users.sql:39
-- and repaired where missing by 0089_repair_members_active_gym_user_index.sql.
--
-- Three properties, because the index is PARTIAL and getting that wrong in
-- either direction is a real regression:
--   1. a second ACTIVE row for the same (gym_id, user_id) is rejected
--   2. a second row is ALLOWED once the first is deactivated -- the rehire
--      path 0063/0064 depend on, which a total unique index would break
--   3. the same user in a DIFFERENT gym is untouched -- multi-gym membership
--      (FR-001) is the whole point and must not be constrained

begin;
select plan(3);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000017001', 'One Active Membership Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000017011', 'One Active Membership Gym A', '00000000-0000-0000-0000-000000017001', 30),
  ('00000000-0000-0000-0000-000000017012', 'One Active Membership Gym B', '00000000-0000-0000-0000-000000017001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000017021'); -- the multi-gym person

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000017071', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017021', 'owner', 'One Active Membership Owner');

-- 1. Second ACTIVE row in the same gym is rejected.
select throws_like(
  $$insert into members (id, gym_id, user_id, role, name) values
      ('00000000-0000-0000-0000-000000017072', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017021', 'manager', 'Duplicate Active Row')$$,
  '%idx_members_active_gym_user%',
  'a second active membership for the same (gym_id, user_id) is rejected'
);

-- 3. The SAME user in a DIFFERENT gym is allowed -- asserted before the
-- deactivation below so it proves multi-gym membership works while the gym A
-- row is still active, which is the real-world shape Story 1.17 creates.
select lives_ok(
  $$insert into members (id, gym_id, user_id, role, name) values
      ('00000000-0000-0000-0000-000000017073', '00000000-0000-0000-0000-000000017012', '00000000-0000-0000-0000-000000017021', 'owner', 'Same Person Second Gym')$$,
  'the same user may hold an active membership in a different gym'
);

-- 2. Once the gym A row is deactivated, a replacement is allowed.
update members
   set deactivated_at = now()
 where id = '00000000-0000-0000-0000-000000017071';

select lives_ok(
  $$insert into members (id, gym_id, user_id, role, name) values
      ('00000000-0000-0000-0000-000000017074', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017021', 'manager', 'Rehired After Deactivation')$$,
  'a new membership is allowed once the previous one is deactivated (rehire path)'
);

select * from finish();
rollback;
