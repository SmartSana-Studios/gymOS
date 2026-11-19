-- Story 27.4: private.subscription_status_for (migration 0176) against the REAL run_subscription_lifecycle_job() (0045:389).
--
-- The job is not modified by 0176 and keeps its inline thresholds and its UTC current_date. This test is what stops the two from drifting:
-- for every expiry offset from -12 to +12 days around today, for grace values 0, 3 and 7, it inserts an 'active' subscription, runs the real
-- job, and asserts the stored status equals subscription_status_for(expiry, grace, today). Any future change to either side fails here.
-- The clock is aligned by passing the job's own current_date as p_today (the same session, so the same value).
--
-- It also pins the NULL case (Pay-per-session: always active) and the boundary days, and that the function is IMMUTABLE and reads no table.
--
-- Fixture ids: 00000000-0000-0000-0000-00000027[60-65]nn.

begin;
select plan(21);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000276001', 'SSE Tier', 5000, 50000, null);

-- one gym per grace value
insert into gyms (id, name, tier_id, status, grace_period_days) values
  ('00000000-0000-0000-0000-000000276011', 'SSE Gym G0', '00000000-0000-0000-0000-000000276001', 'active', 0),
  ('00000000-0000-0000-0000-000000276012', 'SSE Gym G3', '00000000-0000-0000-0000-000000276001', 'active', 3),
  ('00000000-0000-0000-0000-000000276013', 'SSE Gym G7', '00000000-0000-0000-0000-000000276001', 'active', 7);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000276101', 'sse-1@x.example', now()),
  ('00000000-0000-0000-0000-000000276102', 'sse-2@x.example', now()),
  ('00000000-0000-0000-0000-000000276103', 'sse-3@x.example', now());
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000276201', '00000000-0000-0000-0000-000000276011', '00000000-0000-0000-0000-000000276101', 'member', 'SSE Member G0'),
  ('00000000-0000-0000-0000-000000276202', '00000000-0000-0000-0000-000000276012', '00000000-0000-0000-0000-000000276102', 'member', 'SSE Member G3'),
  ('00000000-0000-0000-0000-000000276203', '00000000-0000-0000-0000-000000276013', '00000000-0000-0000-0000-000000276103', 'member', 'SSE Member G7');
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000276301', '00000000-0000-0000-0000-000000276011', 'SSE Monthly G0', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000276302', '00000000-0000-0000-0000-000000276012', 'SSE Monthly G3', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000276303', '00000000-0000-0000-0000-000000276013', 'SSE Monthly G7', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000276304', '00000000-0000-0000-0000-000000276012', 'SSE PPS G3', 'pay_per_session', 2000, 'monthly', null);

-- 25 offsets x 3 gyms, all inserted 'active' (the job moves them forward)
create temp table sse_rows (id uuid primary key, gym_id uuid, grace integer, off integer);
with ins as (
  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  select g.id, m.id, p.id, 'active', current_date - 60, current_date + o
  from gyms g
  join members m on m.gym_id = g.id
  join plans p on p.gym_id = g.id and p.plan_type = 'monthly'
  cross join generate_series(-12, 12) o
  where g.id in ('00000000-0000-0000-0000-000000276011', '00000000-0000-0000-0000-000000276012', '00000000-0000-0000-0000-000000276013')
  returning id, gym_id, expiry_date
)
insert into sse_rows select i.id, i.gym_id, g.grace_period_days, (i.expiry_date - current_date) from ins i join gyms g on g.id = i.gym_id;
-- the Pay-per-session row: no expiry at all
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000276401', '00000000-0000-0000-0000-000000276012', '00000000-0000-0000-0000-000000276202',
   '00000000-0000-0000-0000-000000276304', 'active', current_date - 60, null);

select is((select count(*)::int from sse_rows), 75, 'fixture: 25 offsets x 3 grace values');

-- ---- the real job ----------------------------------------------------------------------------------------------
select lives_ok($$ select run_subscription_lifecycle_job() $$, 'the real lifecycle job runs');

create temp table sse_got as
  select r.id, r.grace, r.off, s.status as job_status, private.subscription_status_for(s.expiry_date, r.grace, current_date) as fn_status
  from sse_rows r join subscriptions s on s.id = r.id;

select is((select count(*)::int from sse_got where job_status is distinct from fn_status), 0,
          'every row: the status the real job stored equals subscription_status_for (75 rows, offsets -12..+12, grace 0/3/7)');
select is((select count(*)::int from sse_got where grace = 0 and job_status is distinct from fn_status), 0, 'grace 0: job and function agree on all 25 offsets');
select is((select count(*)::int from sse_got where grace = 3 and job_status is distinct from fn_status), 0, 'grace 3: job and function agree on all 25 offsets');
select is((select count(*)::int from sse_got where grace = 7 and job_status is distinct from fn_status), 0, 'grace 7: job and function agree on all 25 offsets');

-- the comparison is not vacuous: every status the job can produce is reached
select is((select count(distinct job_status)::int from sse_got where grace = 0), 3, 'grace 0 reaches expired, expiring_soon and active (no grace_period window exists)');
select is((select count(distinct job_status)::int from sse_got where grace = 3), 4, 'grace 3 reaches all four statuses');
select is((select count(distinct job_status)::int from sse_got where grace = 7), 4, 'grace 7 reaches all four statuses');

-- ---- the NULL case -----------------------------------------------------------------------------------------------
select is((select status::text from subscriptions where id = '00000000-0000-0000-0000-000000276401'), 'active', 'the job leaves a Pay-per-session row (no expiry) active');
select is(private.subscription_status_for(null, 0, current_date)::text, 'active', 'NULL expiry is active (grace 0)');
select is(private.subscription_status_for(null, 7, current_date)::text, 'active', 'NULL expiry is active (grace 7)');
select is(private.subscription_status_for(null, null, null)::text, 'active', 'NULL expiry is active whatever else is NULL');

-- ---- boundary days, pinned directly --------------------------------------------------------------------------------
select is(private.subscription_status_for(date '2026-06-17', 3, date '2026-06-10')::text, 'expiring_soon', 'expiry = today + 7 is expiring_soon');
select is(private.subscription_status_for(date '2026-06-18', 3, date '2026-06-10')::text, 'active', 'expiry = today + 8 is active');
select is(private.subscription_status_for(date '2026-06-10', 3, date '2026-06-10')::text, 'expiring_soon', 'expiry = today is still expiring_soon (not yet past)');
select is(private.subscription_status_for(date '2026-06-09', 3, date '2026-06-10')::text, 'grace_period', 'expiry = yesterday is grace_period');
select is(private.subscription_status_for(date '2026-06-07', 3, date '2026-06-10')::text, 'grace_period', 'expiry + grace = today is still grace_period (strict boundary)');
select is(private.subscription_status_for(date '2026-06-06', 3, date '2026-06-10')::text, 'expired', 'expiry + grace = yesterday is expired');

-- ---- nature of the function -----------------------------------------------------------------------------------------
select is((select provolatile::text from pg_proc where oid = 'private.subscription_status_for(date, integer, date)'::regprocedure), 'i', 'subscription_status_for is IMMUTABLE');
select is((select prosrc ~* '\m(from|join)\M' from pg_proc where oid = 'private.subscription_status_for(date, integer, date)'::regprocedure), false,
          'subscription_status_for reads no table (no from or join in the body)');

select * from finish();
rollback;
