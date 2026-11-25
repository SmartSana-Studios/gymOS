-- Migration 0193: a gym billing suspended may not go from status 'suspended' to 'active' until a payment or a credit sets the billing status too.
-- Rows are written as the test role with the lifecycle bypass GUC set, the way private.protect_super_admin_only_gym_columns() lets a status write through for a
-- session that is not a Super Admin; the guard under test sits behind it (trigger zz_guard_gym_reactivation).

begin;
select plan(11);

insert into gyms (id, name, tier_id, status, capacity, saas_billing_status, saas_billing_anchor_date, saas_grace_period_days) values
  ('00000000-0000-0000-0000-000000193001', 'Reactivation A (billing suspended)',  '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'suspended', current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193002', 'Reactivation B (manual suspension)',  '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'active',    current_date + 10, 7),
  ('00000000-0000-0000-0000-000000193003', 'Reactivation C (credit shape)',       '00000000-0000-4000-8000-000000000104', 'suspended',   30, 'suspended', current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193004', 'Reactivation D (deactivated)',        '00000000-0000-4000-8000-000000000104', 'deactivated', 30, 'suspended', current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193005', 'Reactivation E (already inconsistent)', '00000000-0000-4000-8000-000000000104', 'active',     30, 'suspended', current_date - 30, 7),
  ('00000000-0000-0000-0000-000000193006', 'Reactivation F (job suspends)',       '00000000-0000-4000-8000-000000000104', 'active',      30, 'grace_period', current_date - 30, 7);

select set_config('app.saas_billing_lifecycle_job_bypass', 'true', true);

-- A: the Reinstate action's shape (status alone) is refused while billing is suspended.
select throws_ok(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193001'$$,
  'P0001', 'gym_reactivation_requires_payment',
  'status suspended -> active with billing suspended is refused');
select is((select status::text from gyms where id = '00000000-0000-0000-0000-000000193001'), 'suspended',
  'the refused gym is still suspended');
select is((select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193001'), 'suspended',
  'and its billing status is untouched');

-- B: a gym a Super Admin suspended by hand (billing not suspended) is reinstated by the plain action.
select lives_ok(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193002'$$,
  'a manually suspended gym with billing active can be reinstated by status alone');
select is((select status::text from gyms where id = '00000000-0000-0000-0000-000000193002'), 'active', 'and it is active');

-- C: the credit and payment shape (status, billing status and a new due date in one UPDATE) passes.
select lives_ok(
  $$update gyms set status = 'active', saas_billing_status = 'active', saas_billing_anchor_date = current_date + 30 where id = '00000000-0000-0000-0000-000000193003'$$,
  'a credit or payment, which sets status and billing status together, lifts the suspension');
select is((select status::text || '/' || saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193003'), 'active/active',
  'and both columns are active');

-- D: a deactivated gym is not blocked (the credit refuses a deactivated gym, so refusing here would leave no way out).
select lives_ok(
  $$update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000193004'$$,
  'a deactivated gym can be reinstated whatever its billing status (documented scope)');

-- E: an update that does not move status to active leaves an already inconsistent row alone.
select lives_ok(
  $$update gyms set name = 'Reactivation E renamed' where id = '00000000-0000-0000-0000-000000193005'$$,
  'an unrelated update of an active/billing-suspended row is not refused');

-- F: the nightly job still suspends (active -> suspended is not the guarded transition).
select run_saas_billing_lifecycle_job();
select is((select status::text || '/' || saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000193006'), 'suspended/suspended',
  'the lifecycle job still suspends a gym past its grace period');

-- The trigger function is not callable by clients.
select is(has_function_privilege('authenticated', 'private.guard_gym_reactivation()', 'execute') or has_function_privilege('anon', 'private.guard_gym_reactivation()', 'execute'), false,
  'private.guard_gym_reactivation() is not executable by anon or authenticated');

select * from finish();
rollback;
