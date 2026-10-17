-- Rollback for migration 0128 (Super Admin recovery email). Restores the 0127 stepup_issue body.
-- Roll back the Super Admin app code first (its recovery RPC calls fail closed once these are gone).
-- Any scheduled reset that has not applied is discarded.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0128-super-admin-recovery-email.sql
set local lock_timeout = '5s';
select cron.unschedule('super_admin_recovery_apply') where exists (select 1 from cron.job where jobname = 'super_admin_recovery_apply');

drop function if exists public.recovery_code_issue(uuid, text, text, text);
drop function if exists public.recovery_register_verify(uuid, text);
drop function if exists public.recovery_email_remove(uuid);
drop function if exists public.recovery_request_verify(uuid, text, text);
drop function if exists public.recovery_cancel(text);
drop function if exists public.recovery_cancel_for_user(uuid);
drop function if exists public.recovery_enrol_allowed(uuid);
drop function if exists public.recovery_status(uuid);

create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
    return null;
  end if;
  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);
  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$$;

drop function if exists private.recovery_status(uuid);
drop function if exists private.recovery_enrol_allowed(uuid);
drop function if exists private.recovery_apply_due();
drop function if exists private.recovery_cancel(text);
drop function if exists private.recovery_cancel_for_user(uuid);
drop function if exists private.recovery_request_verify(uuid, text, text);
drop function if exists private.recovery_email_remove(uuid);
drop function if exists private.recovery_register_verify(uuid, text);
drop function if exists private.recovery_code_consume(uuid, text, text);
drop function if exists private.recovery_code_issue(uuid, text, text, text);
drop function if exists private.recovery_audit(uuid, text, text, jsonb, uuid);
drop function if exists private.recovery_mask_email(text);
drop table if exists private.super_admin_recovery_pending;
drop table if exists private.super_admin_recovery_code;
drop table if exists private.super_admin_recovery_email;
delete from private.session_limits_config where key like 'recovery\_%';
