-- Supervisor's "Manager-plus" footprint (migration 0093).
--
-- EXPERIENCE.md:206 defines Supervisor as "everything Manager sees, plus
-- Settings and Staff -- the same footprint as Owner, minus the ability to
-- create another Supervisor". Story 9.1 shipped the role and wired only the two
-- screens it needed, so until 0093 a Supervisor was denied at the DATABASE on
-- 14 tables Manager could read, and saw less than a Receptionist.
--
-- HOW THIS FILE IS BUILT, AND WHY. Every assertion compares SUPERVISOR AGAINST
-- MANAGER on identical rows in the same transaction, rather than asserting an
-- absolute count. A count would pass vacuously the moment fixture data changed,
-- and would not express the actual rule -- which is a relationship between two
-- roles, not a number. Each comparison is paired with a RECEPTIONIST reading of
-- the same table, so a supervisor=manager equality cannot pass merely because
-- the gate was removed for everyone: where Manager is narrower than Receptionist
-- the test says so explicitly.
--
-- The anti-rot assertion is the last one: it re-derives, from pg_policies, the
-- set of policies that still name manager without supervisor. That is what
-- catches a FUTURE story reintroducing the gap on a new table, which no
-- per-table assertion here can see.

begin;
select plan(14);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000020401', 'Supervisor Access Tier', 6000, 60000, 50);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000020411', 'Supervisor Access Gym', '00000000-0000-0000-0000-000000020401', 'active', 25);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000020421'), -- supervisor
  ('00000000-0000-0000-0000-000000020422'), -- manager
  ('00000000-0000-0000-0000-000000020423'), -- receptionist
  ('00000000-0000-0000-0000-000000020424'), -- coach
  ('00000000-0000-0000-0000-000000020425'); -- member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000020431', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020421', 'supervisor',   'Access Supervisor',   current_date),
  ('00000000-0000-0000-0000-000000020432', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020422', 'manager',      'Access Manager',      current_date),
  ('00000000-0000-0000-0000-000000020433', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020423', 'receptionist', 'Access Receptionist', current_date),
  ('00000000-0000-0000-0000-000000020434', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020424', 'coach',        'Access Coach',        current_date),
  ('00000000-0000-0000-0000-000000020435', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020425', 'member',       'Access Member',       current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
values ('00000000-0000-0000-0000-000000020441', '00000000-0000-0000-0000-000000020411', 'Access Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date)
values ('00000000-0000-0000-0000-000000020451', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020435', '00000000-0000-0000-0000-000000020441', 'active', current_date, current_date + 30);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at)
values ('00000000-0000-0000-0000-000000020461', '00000000-0000-0000-0000-000000020411', '00000000-0000-0000-0000-000000020435', '00000000-0000-0000-0000-000000020434', now() - interval '10 days', null);

-- Counts each role can see, captured under its own simulated session. Written
-- as a helper so every assertion below is a like-for-like comparison rather
-- than a hand-repeated set_config block.
create temp table role_visibility (role text, tbl text, n int);

do $capture$
declare
  r record;
  v_n int;
  v_tbl text;
begin
  for r in
    select * from (values
      ('supervisor','00000000-0000-0000-0000-000000020421'),
      ('manager','00000000-0000-0000-0000-000000020422'),
      ('receptionist','00000000-0000-0000-0000-000000020423')
    ) as t(role_name, uid)
  loop
    foreach v_tbl in array array['subscriptions','plans','coach_assignments','payments','attendance_events','audit_log','classes'] loop
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.uid, 'role','authenticated',
                          'gym_id','00000000-0000-0000-0000-000000020411',
                          'app_role', r.role_name)::text, true);
      execute format('set local role authenticated');
      execute format('select count(*) from %I where gym_id = %L', v_tbl, '00000000-0000-0000-0000-000000020411') into v_n;
      execute 'reset role';
      insert into role_visibility values (r.role_name, v_tbl, v_n);
    end loop;
  end loop;
end;
$capture$;

-- ---------------------------------------------------------------------------
-- Supervisor sees exactly what Manager sees. One assertion per table so a
-- failure names the table rather than "something differs".
-- ---------------------------------------------------------------------------
select is(
  (select n from role_visibility where role='supervisor' and tbl='subscriptions'),
  (select n from role_visibility where role='manager' and tbl='subscriptions'),
  'subscriptions: Supervisor sees what Manager sees -- this returned 0 vs 4 before 0093'
);
select is(
  (select n from role_visibility where role='supervisor' and tbl='coach_assignments'),
  (select n from role_visibility where role='manager' and tbl='coach_assignments'),
  'coach_assignments: Supervisor sees what Manager sees -- the Coach Portal empty state already told members to "Ask your Manager, Owner, or Supervisor"'
);
select is(
  (select n from role_visibility where role='supervisor' and tbl='payments'),
  (select n from role_visibility where role='manager' and tbl='payments'),
  'payments: Supervisor sees what Manager sees'
);
select is(
  (select n from role_visibility where role='supervisor' and tbl='attendance_events'),
  (select n from role_visibility where role='manager' and tbl='attendance_events'),
  'attendance_events: Supervisor sees what Manager sees'
);
select is(
  (select n from role_visibility where role='supervisor' and tbl='audit_log'),
  (select n from role_visibility where role='manager' and tbl='audit_log'),
  'audit_log: Supervisor sees what Manager sees'
);
select is(
  (select n from role_visibility where role='supervisor' and tbl='classes'),
  (select n from role_visibility where role='manager' and tbl='classes'),
  'classes: Supervisor sees what Manager sees'
);
select is(
  (select n from role_visibility where role='supervisor' and tbl='plans'),
  (select n from role_visibility where role='manager' and tbl='plans'),
  'plans: Supervisor sees what Manager sees'
);

-- ---------------------------------------------------------------------------
-- Positive controls. Without these, every equality above would still pass if
-- 0093 had simply removed the role gates for everyone.
-- ---------------------------------------------------------------------------
select is(
  (select n from role_visibility where role='supervisor' and tbl='subscriptions'), 1,
  'positive control: the subscription row really is visible (1), so the equality above is not 0 = 0'
);
select is(
  (select n from role_visibility where role='receptionist' and tbl='coach_assignments'), 0,
  'positive control: Receptionist is still DENIED coach_assignments -- the widening is role-specific, not a blanket opening'
);
select is(
  (select n from role_visibility where role='receptionist' and tbl='audit_log'), 0,
  'positive control: Receptionist is still DENIED audit_log'
);

-- ---------------------------------------------------------------------------
-- The role gates in SECURITY DEFINER functions, which RLS assertions cannot
-- see -- a function bypasses RLS entirely, so its own `app_role` check is the
-- only thing standing between a Supervisor and a refusal.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('assign_coach','check_out_member','confirm_renewal','create_class','update_class','renew_subscription','materialize_class_sessions')
     and p.prosrc like '%''app_role''%'
     and p.prosrc not like '%''supervisor''%'),
  0,
  'every SECURITY DEFINER role gate that names manager now names supervisor too -- assign_coach() rejected a Supervisor outright before 0093'
);

select is(
  (select prosrc like '%''app_role''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_member_cap'),
  false,
  'enforce_member_cap() did NOT acquire a role gate -- it names manager only in a comment, and inventing one would be a silent authorization change riding along'
);

-- ---------------------------------------------------------------------------
-- Anti-rot. The per-table assertions above are blind to a table added LATER
-- with a manager-only policy -- exactly how this gap arose in the first place
-- (Epic 9 shipped the role, later stories added policies without it).
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(string_agg(tablename||'.'||policyname, ', ' order by tablename, policyname), '')
   from pg_policies
   where schemaname = 'public'
     and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%manager%'
     and (coalesce(qual,'')||coalesce(with_check,'')) not ilike '%supervisor%'),
  '',
  'no policy grants manager without also granting supervisor -- a new manager-only policy is how this gap appeared, so it fails here by name rather than passing silently'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname='public' and tablename='members' and policyname='member_read_gym_staff_members'
     and qual ilike '%supervisor%'),
  1,
  'members may now see Supervisor staff rows -- a different axis from the rest of this file (it loosens what MEMBERS read, not what Supervisors do), included because the Coach Portal copy already promises it'
);

select * from finish();
rollback;
