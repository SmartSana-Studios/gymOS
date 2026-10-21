-- Rollback for migration 0138 (support account create and invite).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0138-support-account-invite.sql
-- Accounts already created keep their private.support_accounts rows (and their audit rows); only the functions, the invite
-- table and the capability go. Invites outstanding at rollback time are lost: re-issue after re-applying.
set local lock_timeout = '5s';
drop function if exists public.activate_support_account(text);
drop function if exists public.support_invite_code_failed(text);
drop function if exists public.support_invite_mark_password_set(text);
drop function if exists public.support_invite_inspect(text);
drop function if exists public.get_support_accounts();
drop function if exists public.issue_support_invite(uuid, text, uuid);
drop function if exists public.create_support_account(uuid, text, text);
drop function if exists private.support_invite_check(text);
drop function if exists private.support_email_collision(text, uuid);
drop function if exists private.support_audit(uuid, text, text, uuid, jsonb);
drop table if exists private.support_invites;
delete from private.session_limits_config
 where key in ('support_invite_ttl_hours', 'support_invite_max_attempts', 'support_invite_max_code_attempts');

create or replace function private.capability_roles(p_capability text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_capability
    when 'staff.create'                      then array['owner','supervisor']
    when 'member.provision'                  then array['owner','manager','supervisor','receptionist']
    when 'member.registration_fee_state'      then array['owner','manager','supervisor','receptionist']
    when 'payment.initiate_own'              then array['member']
    when 'payment.initiate_staff'            then array['owner','manager','supervisor','receptionist']
    when 'billing.saas_pay'                  then array['owner']
    when 'platform.admin_access'             then array['super_admin']
    when 'platform.gym_create'               then array['super_admin']
    when 'platform.billing_retry'            then array['super_admin']
    when 'platform.super_admin_manage'       then array['super_admin']
    else null
  end;
$$;
revoke all on function private.capability_roles(text) from public, anon, authenticated;
grant execute on function private.capability_roles(text) to service_role;
