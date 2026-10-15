-- Story 22.5: super_admin_aal2 flag. is_super_admin(), is_super_admin_live() and the claims hook
-- require aal2 while the flag is on; nothing changes while it is off or the row is missing.
begin;
select plan(18);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000022501');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000022501';

create or replace function pg_temp.claims(aal text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    case when aal is null
      then '{"sub":"00000000-0000-0000-0000-000000022501","role":"authenticated","app_role":"super_admin"}'
      else '{"sub":"00000000-0000-0000-0000-000000022501","role":"authenticated","app_role":"super_admin","aal":"' || aal || '"}'
    end, true);
end $f$;

create or replace function pg_temp.hook_role(aal text) returns text language sql as $f$
  select public.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000022501',
    'claims', case when aal is null then '{}'::jsonb else jsonb_build_object('aal', aal) end
  )) -> 'claims' ->> 'app_role';
$f$;

-- seeded off
select is((select enabled from private.platform_flags where flag = 'super_admin_aal2'), false, 'flag seeded off');
select is(private.super_admin_aal2_required(), false, 'helper reports off');

-- flag off: unchanged at aal1 / no aal
set local role authenticated;
select pg_temp.claims('aal1');
select is(private.is_super_admin(), true, 'flag off, aal1: is_super_admin true');
select pg_temp.claims(null);
select is(private.is_super_admin_live(), true, 'flag off, no aal: live true');
reset role;
select is(pg_temp.hook_role('aal1'), 'super_admin', 'flag off, aal1: hook emits claim');
select is(pg_temp.hook_role(null), 'super_admin', 'flag off, missing aal: hook emits claim');

-- flag on
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
select is(private.super_admin_aal2_required(), true, 'helper reports on');

set local role authenticated;
select pg_temp.claims('aal1');
select is(private.is_super_admin(), false, 'flag on, aal1: is_super_admin false');
select is(private.is_super_admin_live(), false, 'flag on, aal1: live false');
select pg_temp.claims(null);
select is(private.is_super_admin(), false, 'flag on, missing aal fails closed');
select pg_temp.claims('aal2');
select is(private.is_super_admin(), true, 'flag on, aal2: true');
select is(private.is_super_admin_live(), true, 'flag on, aal2: live true');
reset role;

select is(pg_temp.hook_role('aal1'), null, 'flag on, aal1: hook omits super_admin');
select is(pg_temp.hook_role(null), null, 'flag on, missing aal: hook omits super_admin');
select is(pg_temp.hook_role('aal2'), 'super_admin', 'flag on, aal2: hook emits super_admin');

-- missing flag row = off
delete from private.platform_flags where flag = 'super_admin_aal2';
select is(private.super_admin_aal2_required(), false, 'missing flag row reads as off');

-- privileges
select is(has_table_privilege('authenticated', 'private.platform_flags', 'SELECT')
  or has_table_privilege('anon', 'private.platform_flags', 'SELECT'), false,
  'flag table has no client grants');
select is(has_function_privilege('authenticated', 'public.super_admin_aal2_required()', 'EXECUTE'), false,
  'public flag reader is service_role only');

select * from finish();
rollback;
