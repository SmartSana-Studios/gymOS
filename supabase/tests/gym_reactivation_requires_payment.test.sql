-- Migration 0193: a gym may not go from status 'suspended' or 'deactivated' to 'active' while its billing is due (saas_billing_status not 'active'); a billing credit
-- or a payment lifts that, and a credit also works on a deactivated gym (it leaves the status alone). Rows are written with the lifecycle bypass GUC set, the way
-- private.protect_super_admin_only_gym_columns() lets a status write through for a session that is not a Super Admin; the guard under test sits behind it.

begin;
select plan(15);

insert into gyms (id, name, tier_id, status, capacity, saas_billing_status, saas_billing_anchor_date, saas_grace_period_days) values
  ('00000000-0000-0000-0000-000000193001', 'Reactivation A (billing suspended)',        '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'suspended',    current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193002', 'Reactivation A2 (deactivated, drifted)',    '00000000-0000-4000-8000-000000000104', 'deactivated', 30, 'grace_period', current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193003', 'Reactivation A3 (manual, past due)',        '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'past_due',     current_date - 3,  7),
  ('00000000-0000-0000-0000-000000193004', 'Reactivation B (manual, billing current)',  '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'active',       current_date + 10, 7),
  ('00000000-0000-0000-0000-000000193005', 'Reactivation B2 (deactivated, current)',    '00000000-0000-4000-8000-000000000104', 'deactivated', 30, 'active',       current_date + 10, 7),
  ('00000000-0000-0000-0000-000000193006', 'Reactivation C (payment shape)',            '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'suspended',    current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193007', 'Reactivation D (deactivated, credited)',    '00000000-0000-4000-8000-000000000104', 'deactivated', 30, 'grace_period', current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193008', 'Reactivation E (already inconsistent)',     '00000000-0000-4000-8000-000000000104', 'active',      30, 'suspended',    current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193009', 'Reactivation F (job suspends)',             '00000000-0000-4000-8000-000000000104', 'active',      30, 'grace_period', current_date - 30, 7);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000193100'); -- the Super Admin caller of the credit in D
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000193100';

select set_config('app.saas_billing_lifecycle_job_bypass', 'true', true);

-- A: the Reinstate action's shape (status alone) is refused while billing is suspended, and the raise names the due date.
select throws_like(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193001'$$,
  'gym_reactivation_requires_payment: ' || (current_date - 30)::text,
  'suspended -> active with billing suspended is refused, naming the due date');
select is((select status::text || '/' || saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193001'), 'suspended/suspended',
  'the refused gym is unchanged');

-- A2: a deactivated gym whose billing status drifted to grace_period is refused too (the label is what is checked, not only 'suspended').
select throws_like(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193002'$$,
  'gym_reactivation_requires_payment%',
  'deactivated -> active with billing in grace_period is refused');

-- A3: a gym suspended by hand while its billing is past due is refused as well.
select throws_like(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193003'$$,
  'gym_reactivation_requires_payment%',
  'suspended -> active with billing past_due is refused');

-- B: not due (billing active): the plain action continues, suspended or deactivated.
select lives_ok(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193004'$$,
  'a suspended gym with billing up to date is reinstated by status alone');
select is((select status::text from gyms where id = '00000000-0000-0000-0000-000000193004'), 'active', 'and it is active');
select lives_ok(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193005'$$,
  'a deactivated gym with billing up to date is reinstated by status alone');

-- C: the credit and payment shape (status, billing status and a new due date in one UPDATE) lifts a billing suspension.
select lives_ok(
  $$update gyms set status = 'active', saas_billing_status = 'active', saas_billing_anchor_date = current_date + 30 where id = '00000000-0000-0000-0000-000000193006'$$,
  'a credit or payment, which sets status and billing status together, lifts the suspension');
select is((select status::text || '/' || saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193006'), 'active/active', 'and both columns are active');

-- D: a billing credit on a deactivated gym updates its billing and leaves its status; reinstating it afterwards then passes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000193100","role":"authenticated","app_role":"super_admin"}', true);
select previous_anchor_date from apply_saas_billing_credit('00000000-0000-0000-0000-000000193007'::uuid, 30);
reset role;
select is((select status::text || '/' || saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193007'), 'deactivated/active',
  'a credit on a deactivated gym brings billing up to date and leaves the gym deactivated');
select lives_ok(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193007'$$,
  'and reinstating it afterwards passes, because it is no longer due');
select is((select status::text from gyms where id = '00000000-0000-0000-0000-000000193007'), 'active', 'and it is active');

-- E: an update that does not move status to active leaves an already inconsistent row alone.
select lives_ok(
  $$update gyms set name = 'Reactivation E renamed' where id = '00000000-0000-0000-0000-000000193008'$$,
  'an unrelated update of an active/billing-suspended row is not refused');

-- F: the nightly job still suspends (active -> suspended is not the guarded transition).
select set_config('app.saas_billing_lifecycle_job_bypass', 'true', true);
select run_saas_billing_lifecycle_job();
select is((select status::text || '/' || saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193009'), 'suspended/suspended',
  'the lifecycle job still suspends a gym past its grace period');

-- The trigger function is not callable by clients.
select is(has_function_privilege('authenticated', 'private.guard_gym_reactivation()', 'execute') or has_function_privilege('anon', 'private.guard_gym_reactivation()', 'execute'), false,
  'private.guard_gym_reactivation() is not executable by anon or authenticated');

select * from finish();
rollback;
