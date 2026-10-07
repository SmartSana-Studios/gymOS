-- 0102: receptionist may INSERT members (role = 'member' only) and
-- subscriptions; every other write stays manager-plus; the Epic 18 gate still
-- applies to receptionists.
begin;
select plan(10);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000010201', 'Rcp Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity, registration_fee) values
  ('00000000-0000-0000-0000-000000010211', 'Rcp Gym', '00000000-0000-0000-0000-000000010201', 30, 0),
  ('00000000-0000-0000-0000-000000010212', 'Rcp Fee Gym', '00000000-0000-0000-0000-000000010201', 30, 5000);
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000010221'), -- receptionist
  ('00000000-0000-0000-0000-000000010222'), -- existing member
  ('00000000-0000-0000-0000-000000010223'), -- new member A
  ('00000000-0000-0000-0000-000000010224'), -- new member B (awaiting)
  ('00000000-0000-0000-0000-000000010225'); -- attempted staff row
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000010231', '00000000-0000-0000-0000-000000010211', '00000000-0000-0000-0000-000000010221', 'receptionist', 'Rcp'),
  ('00000000-0000-0000-0000-000000010232', '00000000-0000-0000-0000-000000010211', '00000000-0000-0000-0000-000000010222', 'member', 'Existing');
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0000-000000010241', '00000000-0000-0000-0000-000000010211', 'Monthly', 'monthly', 15000, 'monthly', 30);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000010221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000010211","app_role":"receptionist"}', true);

select lives_ok($$insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000010233','00000000-0000-0000-0000-000000010211','00000000-0000-0000-0000-000000010223','member','New A')$$,
  'receptionist can create a member row');

select lives_ok($$insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values ('00000000-0000-0000-0000-000000010211','00000000-0000-0000-0000-000000010233','00000000-0000-0000-0000-000000010241','active',current_date,current_date+30)$$,
  'receptionist can assign a plan');

select throws_like($$insert into members (gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000010211','00000000-0000-0000-0000-000000010225','manager','Sneaky')$$,
  '%row-level security%', 'receptionist cannot create a staff-role member row');

select throws_like($$insert into members (gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000999999','00000000-0000-0000-0000-000000010225','member','Other gym')$$,
  '%row-level security%', 'receptionist cannot create a member in another gym');

with u as (update members set name = 'Renamed' where id = '00000000-0000-0000-0000-000000010232' returning 1)
select is(count(*)::int, 0, 'receptionist still cannot UPDATE members') from u;

with u as (update subscriptions set status = 'expired' where member_id = '00000000-0000-0000-0000-000000010233' returning 1)
select is(count(*)::int, 0, 'receptionist still cannot UPDATE subscriptions') from u;

with d as (delete from plans where id = '00000000-0000-0000-0000-000000010241' returning 1)
select is(count(*)::int, 0, 'receptionist still cannot delete plans') from d;

-- Epic 18 gate still binds a receptionist: fee gym, awaiting member.
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000010226');
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000010236', '00000000-0000-0000-0000-000000010212', '00000000-0000-0000-0000-000000010226', 'receptionist', 'Rcp2');
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0000-000000010242', '00000000-0000-0000-0000-000000010212', 'Monthly', 'monthly', 15000, 'monthly', 30);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000010226","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000010212","app_role":"receptionist"}', true);

select lives_ok($$insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000010234','00000000-0000-0000-0000-000000010212','00000000-0000-0000-0000-000000010224','member','New B')$$,
  'receptionist can create a member in a fee gym (starts awaiting)');

select throws_like($$insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values ('00000000-0000-0000-0000-000000010212','00000000-0000-0000-0000-000000010234','00000000-0000-0000-0000-000000010242','active',current_date,current_date+30)$$,
  '%registration_fee_not_settled%', 'receptionist cannot assign a plan to an awaiting member');

select lives_ok($$select record_registration_fee('00000000-0000-0000-0000-000000010234','cash','paid at desk')$$,
  'receptionist can then collect the fee');

select * from finish();
rollback;
