-- Epic 22 retro item 62 (finding F9, migration 0132): billing.saas_pay is exempt from the gym-status check for a SUSPENDED
-- gym only. A suspended gym's Owner must still reach billing to pay the bill that lifts the suspension; a deactivated gym is
-- refused (only a Super Admin reinstates one), and every other capability is refused for any non-active gym.
begin;
select plan(11);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000023201', 'SaaS Pay Tier', 5000, 50000, 20);

-- Status is set at INSERT: an UPDATE of gyms.status by a non-Super-Admin silently reverts (protect_super_admin_only_gym_columns).
insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-000000023211', 'SaaS Pay Active',      '00000000-0000-0000-0000-000000023201', 30, 'active'),
  ('00000000-0000-0000-0000-000000023212', 'SaaS Pay Suspended',   '00000000-0000-0000-0000-000000023201', 30, 'suspended'),
  ('00000000-0000-0000-0000-000000023213', 'SaaS Pay Deactivated', '00000000-0000-0000-0000-000000023201', 30, 'deactivated');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000023221'), -- owner, active gym
  ('00000000-0000-0000-0000-000000023222'), -- owner, suspended gym
  ('00000000-0000-0000-0000-000000023223'), -- owner, deactivated gym
  ('00000000-0000-0000-0000-000000023224'), -- manager, suspended gym
  ('00000000-0000-0000-0000-000000023225'); -- manager, deactivated gym

insert into members (id, gym_id, user_id, role, name, phone, deactivated_at) values
  ('00000000-0000-0000-0000-000000023271', '00000000-0000-0000-0000-000000023211', '00000000-0000-0000-0000-000000023221', 'owner',   'Pay Owner Active',  '+237600023221', null),
  ('00000000-0000-0000-0000-000000023272', '00000000-0000-0000-0000-000000023212', '00000000-0000-0000-0000-000000023222', 'owner',   'Pay Owner Susp',    '+237600023222', null),
  ('00000000-0000-0000-0000-000000023273', '00000000-0000-0000-0000-000000023213', '00000000-0000-0000-0000-000000023223', 'owner',   'Pay Owner Deact',   '+237600023223', null),
  ('00000000-0000-0000-0000-000000023274', '00000000-0000-0000-0000-000000023212', '00000000-0000-0000-0000-000000023224', 'manager', 'Pay Manager Susp',  '+237600023224', null),
  ('00000000-0000-0000-0000-000000023275', '00000000-0000-0000-0000-000000023213', '00000000-0000-0000-0000-000000023225', 'manager', 'Pay Manager Deact', '+237600023225', null);

create function pg_temp.verdict(p_actor uuid, p_gym uuid, p_cap text) returns text
language sql stable as $$
  select a.allowed || ':' || a.reason || ':' || coalesce(a.actor_role, '-') from public.authorize_action(p_actor, p_gym, p_cap) a
$$;

select is(pg_temp.verdict('00000000-0000-0000-0000-000000023221', '00000000-0000-0000-0000-000000023211', 'billing.saas_pay'),
  'true:allowed:owner', 'the Owner of an active gym may pay SaaS billing');
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023222', '00000000-0000-0000-0000-000000023212', 'billing.saas_pay'),
  'true:allowed:owner', 'the Owner of a SUSPENDED gym may still pay SaaS billing (the payment that lifts the suspension)');
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023223', '00000000-0000-0000-0000-000000023213', 'billing.saas_pay'),
  'false:gym_not_active:owner', 'the Owner of a DEACTIVATED gym is refused, with the reason gym_not_active');

-- the role check still applies inside the exemption
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023224', '00000000-0000-0000-0000-000000023212', 'billing.saas_pay'),
  'false:role_not_permitted:manager', 'a manager of a suspended gym still may not pay SaaS billing');
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023225', '00000000-0000-0000-0000-000000023213', 'billing.saas_pay'),
  'false:gym_not_active:manager', 'a manager of a deactivated gym is refused for the gym status first');

-- every other gym capability is unchanged: refused for any non-active gym
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023222', '00000000-0000-0000-0000-000000023212', 'staff.create'),
  'false:gym_not_active:owner', 'staff.create is still refused for a suspended gym');
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023223', '00000000-0000-0000-0000-000000023213', 'staff.create'),
  'false:gym_not_active:owner', 'staff.create is still refused for a deactivated gym');
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023221', '00000000-0000-0000-0000-000000023211', 'staff.create'),
  'true:allowed:owner', 'staff.create is still allowed for the Owner of an active gym');

-- no regression in the neighbours: unknown capability and wrong gym
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023222', '00000000-0000-0000-0000-000000023211', 'billing.saas_pay'),
  'false:not_member:-', 'the Owner of a suspended gym has no billing access to another gym');
select is(pg_temp.verdict('00000000-0000-0000-0000-000000023222', null, 'billing.saas_pay'),
  'false:no_gym:-', 'billing.saas_pay with no gym is refused');

select ok(not has_function_privilege('anon', 'public.authorize_action(uuid, uuid, text, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.authorize_action(uuid, uuid, text, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.authorize_action(uuid, uuid, text, uuid)', 'execute'),
  'authorize_action stays callable by service_role only');

select * from finish();
rollback;
