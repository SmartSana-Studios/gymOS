-- Story 22.4: private.authorize_action / public.authorize_action per role and capability.
begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000022401', 'Authorize Action Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-000000022411', 'Authz Gym A', '00000000-0000-0000-0000-000000022401', 30, 'active'),
  ('00000000-0000-0000-0000-000000022412', 'Authz Gym B', '00000000-0000-0000-0000-000000022401', 30, 'active'),
  ('00000000-0000-0000-0000-000000022413', 'Authz Gym C', '00000000-0000-0000-0000-000000022401', 30, 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000022421'), -- owner A
  ('00000000-0000-0000-0000-000000022422'), -- supervisor A
  ('00000000-0000-0000-0000-000000022423'), -- manager A
  ('00000000-0000-0000-0000-000000022424'), -- receptionist A
  ('00000000-0000-0000-0000-000000022425'), -- member A
  ('00000000-0000-0000-0000-000000022426'), -- deactivated manager A
  ('00000000-0000-0000-0000-000000022427'), -- owner B
  ('00000000-0000-0000-0000-000000022428'), -- super admin
  ('00000000-0000-0000-0000-000000022429'); -- owner C (suspended gym)

insert into members (id, gym_id, user_id, role, name, phone, deactivated_at) values
  ('00000000-0000-0000-0000-000000022471', '00000000-0000-0000-0000-000000022411', '00000000-0000-0000-0000-000000022421', 'owner', 'Authz Owner A', '+237600022421', null),
  ('00000000-0000-0000-0000-000000022472', '00000000-0000-0000-0000-000000022411', '00000000-0000-0000-0000-000000022422', 'supervisor', 'Authz Sup A', '+237600022422', null),
  ('00000000-0000-0000-0000-000000022473', '00000000-0000-0000-0000-000000022411', '00000000-0000-0000-0000-000000022423', 'manager', 'Authz Mgr A', '+237600022423', null),
  ('00000000-0000-0000-0000-000000022474', '00000000-0000-0000-0000-000000022411', '00000000-0000-0000-0000-000000022424', 'receptionist', 'Authz Rec A', '+237600022424', null),
  ('00000000-0000-0000-0000-000000022475', '00000000-0000-0000-0000-000000022411', '00000000-0000-0000-0000-000000022425', 'member', 'Authz Member A', '+237600022425', null),
  ('00000000-0000-0000-0000-000000022476', '00000000-0000-0000-0000-000000022411', '00000000-0000-0000-0000-000000022426', 'manager', 'Authz Deact A', '+237600022426', now()),
  ('00000000-0000-0000-0000-000000022477', '00000000-0000-0000-0000-000000022412', '00000000-0000-0000-0000-000000022427', 'owner', 'Authz Owner B', '+237600022427', null),
  ('00000000-0000-0000-0000-000000022478', '00000000-0000-0000-0000-000000022413', '00000000-0000-0000-0000-000000022429', 'owner', 'Authz Owner C', '+237600022429', null);

update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000022428';

-- helper: first column of the typed result

select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022421', '00000000-0000-0000-0000-000000022411', 'staff.create')),
  true, 'owner may create staff');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022422', '00000000-0000-0000-0000-000000022411', 'staff.create')),
  true, 'supervisor may create staff');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022423', '00000000-0000-0000-0000-000000022411', 'staff.create')),
  'role_not_permitted', 'manager may not create staff');
select is((select actor_role from public.authorize_action('00000000-0000-0000-0000-000000022423', '00000000-0000-0000-0000-000000022411', 'staff.create')),
  'manager', 'the live role is returned on a denial');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022424', '00000000-0000-0000-0000-000000022411', 'member.provision')),
  true, 'receptionist may provision members');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022425', '00000000-0000-0000-0000-000000022411', 'member.registration_fee_state')),
  false, 'a member may not use the staff registration fee state path');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022423', '00000000-0000-0000-0000-000000022411', 'member.registration_fee_state')),
  true, 'manager may read the registration fee state');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022426', '00000000-0000-0000-0000-000000022411', 'member.registration_fee_state')),
  'deactivated', 'a deactivated manager is denied with reason deactivated');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022421', '00000000-0000-0000-0000-000000022412', 'staff.create')),
  'not_member', 'owner of gym A is denied in gym B (wrong gym)');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022425', '00000000-0000-0000-0000-000000022411', 'payment.initiate_own')),
  true, 'member may initiate own payment');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022425', '00000000-0000-0000-0000-000000022411', 'payment.initiate_staff')),
  'role_not_permitted', 'member is not staff for payment initiation');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022424', '00000000-0000-0000-0000-000000022411', 'payment.initiate_staff')),
  true, 'receptionist may initiate for a member');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022421', '00000000-0000-0000-0000-000000022411', 'billing.saas_pay')),
  true, 'owner may pay SaaS billing');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022423', '00000000-0000-0000-0000-000000022411', 'billing.saas_pay')),
  'role_not_permitted', 'manager may not pay SaaS billing');
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022428', null, 'platform.gym_create')),
  true, 'live super admin passes a platform capability');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022421', null, 'platform.gym_create')),
  'not_super_admin', 'a gym owner is not a super admin');
select is((select reason from public.authorize_action(null, '00000000-0000-0000-0000-000000022411', 'staff.create')),
  'no_actor', 'null actor fails closed');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022421', '00000000-0000-0000-0000-000000022411', 'nope')),
  'unknown_capability', 'unknown capability fails closed');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022421', null, 'staff.create')),
  'no_gym', 'a gym capability without a gym fails closed');

-- flag off: denied
update users set is_super_admin = false where id = '00000000-0000-0000-0000-000000022428';
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022428', null, 'platform.admin_access')),
  false, 'super admin flag off: denied (a stale claim cannot help, no claim is read)');

-- role change takes effect on the very next call
update members set role = 'receptionist' where id = '00000000-0000-0000-0000-000000022472';
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022422', '00000000-0000-0000-0000-000000022411', 'staff.create')),
  false, 'a supervisor demoted to receptionist is denied at once');

-- suspended gym: denied like any staff account
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022429', '00000000-0000-0000-0000-000000022413', 'staff.create')),
  'gym_not_active', 'a suspended gym denies its owner');

-- suspended gym: its Owner may still start a SaaS payment, but nothing else
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000022429', '00000000-0000-0000-0000-000000022413', 'billing.saas_pay')),
  true, 'owner of a suspended gym may still pay SaaS billing');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000022429', '00000000-0000-0000-0000-000000022413', 'payment.initiate_staff')),
  'gym_not_active', 'owner of a suspended gym is still denied payment.initiate_staff');

-- privileges
select is(has_function_privilege('anon', 'public.authorize_action(uuid,uuid,text)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.authorize_action(uuid,uuid,text)', 'EXECUTE'),
  false, 'public.authorize_action is not executable by anon or authenticated');
select is(has_function_privilege('service_role', 'public.authorize_action(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'private.authorize_action(uuid,uuid,text)', 'EXECUTE'),
  true, 'service_role may execute both');

select * from finish();
rollback;
