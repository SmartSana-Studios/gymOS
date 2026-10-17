-- Migration 0130: a gym owner can never be a Super Admin, and a Super Admin can never be a gym owner.
begin;
select plan(9);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000230301', 'Owner Guard Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000230001', 'Owner Guard Gym', '00000000-0000-0000-0000-000000230301', 30);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000230101', 'owner230@x.example'),
  ('00000000-0000-0000-0000-000000230102', 'coach230@x.example'),
  ('00000000-0000-0000-0000-000000230103', 'sa230@x.example'),
  ('00000000-0000-0000-0000-000000230104', 'exowner230@x.example');
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000230201', '00000000-0000-0000-0000-000000230001', '00000000-0000-0000-0000-000000230101', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000230202', '00000000-0000-0000-0000-000000230001', '00000000-0000-0000-0000-000000230102', 'coach', 'Coach'),
  ('00000000-0000-0000-0000-000000230204', '00000000-0000-0000-0000-000000230001', '00000000-0000-0000-0000-000000230104', 'owner', 'Ex Owner');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000230103';

-- promoting an owner is refused
select throws_ok($$update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000230101'$$,
                 'P0001', null, 'an active gym owner cannot be promoted to Super Admin');
select is((select is_super_admin from users where id = '00000000-0000-0000-0000-000000230101'), false, 'and stays a normal user');

-- promoting a non-owner member is still allowed (only owners are barred)
select lives_ok($$update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000230102'$$, 'a coach can be promoted');

-- a Super Admin cannot become an owner, by insert or by changing role
select throws_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000230001', '00000000-0000-0000-0000-000000230103', 'owner', 'SA Owner')$$,
                 'P0001', null, 'a Super Admin cannot be made a gym owner (insert)');
select throws_ok($$update members set role = 'owner' where id = '00000000-0000-0000-0000-000000230202'$$,
                 'P0001', null, 'a Super Admin member cannot be turned into an owner (role change)');
select lives_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000230001', '00000000-0000-0000-0000-000000230103', 'coach', 'SA Coach')$$,
                'a Super Admin may hold a non-owner membership (not barred here)');

-- a deactivated ex-owner no longer blocks promotion
update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000230204';
select lives_ok($$update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000230104'$$, 'a deactivated ex-owner can be promoted');
-- ...but cannot be reactivated as an owner while a Super Admin
select throws_ok($$update members set deactivated_at = null where id = '00000000-0000-0000-0000-000000230204'$$,
                 'P0001', null, 'a Super Admin ex-owner cannot be reactivated as owner');

select is(has_function_privilege('authenticated', 'private.guard_owner_not_super_admin()', 'execute'), false, 'guard functions are not client-callable');

select * from finish();
rollback;
