-- Migration 0159: typed names and short labels are SAVED IN CAPITALS by BEFORE INSERT/UPDATE triggers, on every write
-- path. Emails, phones and long free text are left alone.

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-0000000d9000', 'Mixed Case Tier', 5000, 50000, 100);
select is((select name from tiers where id = '00000000-0000-0000-0000-0000000d9000'), 'MIXED CASE TIER', 'tiers.name is stored in capitals');

insert into gyms (id, name, tier_id, status, capacity)
values ('00000000-0000-0000-0000-0000000d9001', 'Martin''s Fitness Center', '00000000-0000-0000-0000-0000000d9000', 'active', 20);
select is((select name from gyms where id = '00000000-0000-0000-0000-0000000d9001'), 'MARTIN''S FITNESS CENTER', 'gyms.name is stored in capitals');

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000d9011');
insert into members (id, gym_id, user_id, role, name, email, profession, neighborhood, emergency_contact)
values ('00000000-0000-0000-0000-0000000d9021', '00000000-0000-0000-0000-0000000d9001', '00000000-0000-0000-0000-0000000d9011', 'owner',
        'Tamufor Martin', 'Tamufor.Martin@Example.com', 'Électricien', 'Bastos', 'Marie Nkoa');
select is((select name from members where id = '00000000-0000-0000-0000-0000000d9021'), 'TAMUFOR MARTIN', 'members.name is stored in capitals');
select is((select profession from members where id = '00000000-0000-0000-0000-0000000d9021'), 'ÉLECTRICIEN', 'members.profession is capitals, accents kept');
select is((select neighborhood from members where id = '00000000-0000-0000-0000-0000000d9021'), 'BASTOS', 'members.neighborhood is stored in capitals');
select is((select emergency_contact from members where id = '00000000-0000-0000-0000-0000000d9021'), 'MARIE NKOA', 'members.emergency_contact is stored in capitals');
select is((select email from members where id = '00000000-0000-0000-0000-0000000d9021'), 'Tamufor.Martin@Example.com', 'members.email is NOT changed');

update members set name = 'Jean Pierre', profession = null where id = '00000000-0000-0000-0000-0000000d9021';
select is((select name from members where id = '00000000-0000-0000-0000-0000000d9021'), 'JEAN PIERRE', 'an UPDATE of members.name is capitalised too');
select is((select profession from members where id = '00000000-0000-0000-0000-0000000d9021'), null, 'a null stays null');

update users set display_name = 'Super Admin Local' where id = '00000000-0000-0000-0000-0000000d9011';
select is((select display_name from users where id = '00000000-0000-0000-0000-0000000d9011'), 'SUPER ADMIN LOCAL', 'users.display_name is stored in capitals');

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
values ('00000000-0000-0000-0000-0000000d9031', '00000000-0000-0000-0000-0000000d9001', 'Basic Prime', 'monthly', 15000, 'XAF', 'monthly', 30);
select is((select name from plans where id = '00000000-0000-0000-0000-0000000d9031'), 'BASIC PRIME', 'plans.name is stored in capitals');

select throws_ok(
  $$insert into plans (gym_id, name, plan_type, price, currency, billing_interval, duration_days)
    values ('00000000-0000-0000-0000-0000000d9001', 'basic prime', 'monthly', 15000, 'XAF', 'monthly', 30)$$,
  '23505', null, 'the case-insensitive unique plan name still applies (a differently cased duplicate is refused)');

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000d9012');
insert into members (id, gym_id, user_id, role, name) values ('00000000-0000-0000-0000-0000000d9022', '00000000-0000-0000-0000-0000000d9001', '00000000-0000-0000-0000-0000000d9012', 'coach', 'Coach Test');
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
values ('00000000-0000-0000-0000-0000000d9041', '00000000-0000-0000-0000-0000000d9001', 'Morning Yoga', '00000000-0000-0000-0000-0000000d9022', 10, 'one_off', now() + interval '1 day');
select is((select name from classes where id = '00000000-0000-0000-0000-0000000d9041'), 'MORNING YOGA', 'classes.name is stored in capitals');

update gyms set name = 'Renamed Gym' where id = '00000000-0000-0000-0000-0000000d9001';
select is((select name from gyms where id = '00000000-0000-0000-0000-0000000d9001'), 'RENAMED GYM', 'renaming a gym is capitalised');

select is(
  (select count(*)::int from pg_trigger where not tgisinternal and tgname in ('uppercase_member_text', 'uppercase_user_text', 'uppercase_name')),
  7,
  'the seven uppercase triggers exist (members, users, gyms, plans, classes, tiers, workout_plans)');

select is(
  (select count(*)::int from pg_proc where proname in ('uppercase_member_text', 'uppercase_user_text', 'uppercase_name')
     and has_function_privilege('authenticated', oid, 'execute')),
  0,
  'the trigger functions are not callable by signed-in users');

select * from finish();
rollback;
