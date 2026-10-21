-- Epic 22 retro item 60 (finding F4): every platform.* capability of private/public.authorize_action, per actor type,
-- and the recorded contract that this decision is blind to the aal2 flag, the session and the lockout.
--
-- authorize_action('platform.*') answers ONE question: is this actor a live users.is_super_admin. aal2, idle/age limits and
-- the step-up lockout are enforced in apps/super-admin/lib/authz.ts (authorizePlatformAction) on top of it. The
-- flag-on assertions below pin that boundary so nobody "fixes" it in only one layer.
begin;
select plan(12);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000023601', 'Platform Authz Tier', 5000, 50000, 20);
insert into gyms (id, name, tier_id, capacity, status)
values ('00000000-0000-0000-0000-000000023611', 'Platform Authz Gym', '00000000-0000-0000-0000-000000023601', 30, 'active');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000023621'), -- live super admin
  ('00000000-0000-0000-0000-000000023622'), -- plain user, no membership, not a super admin
  ('00000000-0000-0000-0000-000000023623'), -- gym owner
  ('00000000-0000-0000-0000-000000023624'); -- former super admin, demoted
update users set is_super_admin = true  where id = '00000000-0000-0000-0000-000000023621';
update users set is_super_admin = false where id = '00000000-0000-0000-0000-000000023624';
insert into members (id, gym_id, user_id, role, name, phone, deactivated_at)
values ('00000000-0000-0000-0000-000000023671', '00000000-0000-0000-0000-000000023611', '00000000-0000-0000-0000-000000023623',
        'owner', 'Platform Authz Owner', '+237600023623', null);

-- One line per capability: "capability=allowed:reason".
create function pg_temp.verdicts(p_actor uuid, p_gym uuid) returns text
language sql stable as $$
  select string_agg(cap || '=' || a.allowed || ':' || a.reason, ', ' order by cap)
    from unnest(array['platform.admin_access', 'platform.billing_retry', 'platform.gym_create', 'platform.super_admin_manage']) as cap,
         lateral public.authorize_action(p_actor, p_gym, cap) a
$$;

-- ---- the allow side: a live Super Admin passes every platform capability ---------------------------------------------------
select is(pg_temp.verdicts('00000000-0000-0000-0000-000000023621', null),
  'platform.admin_access=true:allowed, platform.billing_retry=true:allowed, platform.gym_create=true:allowed, platform.super_admin_manage=true:allowed',
  'a live Super Admin is allowed every platform capability');
select is(pg_temp.verdicts('00000000-0000-0000-0000-000000023621', '00000000-0000-0000-0000-000000023611'),
  'platform.admin_access=true:allowed, platform.billing_retry=true:allowed, platform.gym_create=true:allowed, platform.super_admin_manage=true:allowed',
  'a gym id passed with a platform capability is ignored');

-- ---- the deny side ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.verdicts('00000000-0000-0000-0000-000000023622', null),
  'platform.admin_access=false:not_super_admin, platform.billing_retry=false:not_super_admin, platform.gym_create=false:not_super_admin, platform.super_admin_manage=false:not_super_admin',
  'a plain user is denied every platform capability');
select is(pg_temp.verdicts('00000000-0000-0000-0000-000000023623', '00000000-0000-0000-0000-000000023611'),
  'platform.admin_access=false:not_super_admin, platform.billing_retry=false:not_super_admin, platform.gym_create=false:not_super_admin, platform.super_admin_manage=false:not_super_admin',
  'a gym owner is denied every platform capability, even for their own gym');
select is(pg_temp.verdicts('00000000-0000-0000-0000-000000023624', null),
  'platform.admin_access=false:not_super_admin, platform.billing_retry=false:not_super_admin, platform.gym_create=false:not_super_admin, platform.super_admin_manage=false:not_super_admin',
  'a demoted Super Admin is denied at once (the live flag, not a stale claim)');
select is((select reason from public.authorize_action('00000000-0000-0000-0000-000000023621', null, 'platform.not_a_capability')),
  'unknown_capability', 'an unknown platform capability is denied even for a Super Admin');
select is((select reason from public.authorize_action(null, null, 'platform.admin_access')),
  'no_actor', 'no actor is denied');

-- ---- pin the set: adding a platform capability must come with a test here ------------------------------------------------------
select is((select array_agg(m[1] order by m[1])
             from regexp_matches(pg_get_functiondef('private.capability_roles(text)'::regprocedure), '''(platform\.[a-z_]+)''', 'g') as m),
  array['platform.admin_access', 'platform.billing_retry', 'platform.gym_create', 'platform.super_admin_manage', 'platform.support_manage'],
  'the platform capabilities in capability_roles are exactly the five covered here (platform.support_manage: support_account_invite.test.sql)');
select is((select string_agg(cap || '=' || private.capability_roles(cap)::text, ', ' order by cap)
             from unnest(array['platform.admin_access', 'platform.billing_retry', 'platform.gym_create', 'platform.super_admin_manage']) as cap),
  'platform.admin_access={super_admin}, platform.billing_retry={super_admin}, platform.gym_create={super_admin}, platform.super_admin_manage={super_admin}',
  'every platform capability is allowed to super_admin and nothing else');

-- ---- the recorded contract: flag-blind, lock-blind (the TypeScript layer enforces aal2, limits and the lock) -------------------
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
select is(pg_temp.verdicts('00000000-0000-0000-0000-000000023621', null),
  'platform.admin_access=true:allowed, platform.billing_retry=true:allowed, platform.gym_create=true:allowed, platform.super_admin_manage=true:allowed',
  'with the aal2 flag ON authorize_action is still flag-blind: aal2 is enforced by lib/authz.ts, not here');
insert into private.super_admin_lockout (user_id, failed_count, locked_at)
values ('00000000-0000-0000-0000-000000023621', 5, now());
select is((select allowed from public.authorize_action('00000000-0000-0000-0000-000000023621', null, 'platform.admin_access')),
  true, 'a locked Super Admin is still allowed here: the lock is enforced by touchSessionGate in lib/authz.ts');

-- ---- who can call it ----------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.authorize_action(uuid, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.authorize_action(uuid, uuid, text)', 'execute')
      and has_function_privilege('service_role', 'public.authorize_action(uuid, uuid, text)', 'execute'),
  'public.authorize_action is callable by service_role only');

select * from finish();
rollback;
