-- Migration 0158: a gym with no opening hours is judged on 06:00-22:00 gym-local time (it used to be "always open",
-- so members got "your gym is quiet" at midnight). Deterministic at any wall-clock time: the "day" and "night" gyms
-- use timezones picked from pg_timezone_names whose local time right now is mid-day or in the small hours.

begin;
select plan(6);

create temp table zones as
  select
    (select name from pg_timezone_names
      where name !~ '^(posix|Etc|SystemV|right)' and (now() at time zone name)::time between '10:00' and '17:00'
      order by name limit 1) as day_zone,
    (select name from pg_timezone_names
      where name !~ '^(posix|Etc|SystemV|right)' and (now() at time zone name)::time between '00:30' and '04:30'
      order by name limit 1) as night_zone;

select ok((select day_zone is not null and night_zone is not null from zones), 'a mid-day and a small-hours timezone exist right now');

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-0000000c8000', 'Quiet Default Hours Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, status, capacity, timezone, opening_time, closing_time) values
  ('00000000-0000-0000-0000-0000000c8001', 'Day No Hours Gym',   '00000000-0000-0000-0000-0000000c8000', 'active', 10, (select day_zone from zones),   null, null),
  ('00000000-0000-0000-0000-0000000c8002', 'Night No Hours Gym', '00000000-0000-0000-0000-0000000c8000', 'active', 10, (select night_zone from zones), null, null),
  ('00000000-0000-0000-0000-0000000c8003', 'Night All Day Gym',  '00000000-0000-0000-0000-0000000c8000', 'active', 10, (select night_zone from zones), '00:00:00', '23:59:59.999999'),
  ('00000000-0000-0000-0000-0000000c8004', 'Night Only Open Gym', '00000000-0000-0000-0000-0000000c8000', 'active', 10, (select night_zone from zones), '00:00:00', null);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000c8011'),
  ('00000000-0000-0000-0000-0000000c8012'),
  ('00000000-0000-0000-0000-0000000c8013'),
  ('00000000-0000-0000-0000-0000000c8014');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-0000000c8021', '00000000-0000-0000-0000-0000000c8001', '00000000-0000-0000-0000-0000000c8011', 'member', 'Day No Hours Member'),
  ('00000000-0000-0000-0000-0000000c8022', '00000000-0000-0000-0000-0000000c8002', '00000000-0000-0000-0000-0000000c8012', 'member', 'Night No Hours Member'),
  ('00000000-0000-0000-0000-0000000c8023', '00000000-0000-0000-0000-0000000c8003', '00000000-0000-0000-0000-0000000c8013', 'member', 'Night All Day Member'),
  ('00000000-0000-0000-0000-0000000c8024', '00000000-0000-0000-0000-0000000c8004', '00000000-0000-0000-0000-0000000c8014', 'member', 'Night Open Only Member');

select lives_ok($$select run_quiet_gym_alert_job()$$, 'the quiet-gym job runs');

select is((select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-0000000c8021'), 1,
          'no hours set, local time mid-day: the alert is sent (inside the 06:00-22:00 default)');
select is((select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-0000000c8022'), 0,
          'no hours set, local time in the small hours: NO alert (the midnight notification)');
select is((select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-0000000c8023'), 1,
          'hours set to all day: judged on the gym''s own hours, so the alert is sent at night');
select is((select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-0000000c8024'), 1,
          'only an opening time set (00:00): the missing closing time defaults to 22:00, so the 00:30-04:30 local time is inside 00:00-22:00 and the alert is sent');

select * from finish();
rollback;
