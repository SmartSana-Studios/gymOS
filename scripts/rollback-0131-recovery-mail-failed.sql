-- Rollback for migration 0131 (recovery mail_failed): restores the 0128 recovery_code_issue, drops the mail_failed functions and column.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0131-recovery-mail-failed.sql
set local lock_timeout = '5s';
drop function if exists public.recovery_code_mail_failed(uuid, text);
drop function if exists private.recovery_code_mail_failed(uuid, text);

create or replace function private.recovery_code_issue(p_user uuid, p_purpose text, p_email text, p_code text)
returns table (ok boolean, reason text, send_to text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_login text;
  v_target text;
  v_masked text;
begin
  if p_user is null or p_purpose not in ('register', 'recover') or p_code is null or p_code !~ '^[0-9]{6}$' then
    return query select false, 'invalid'::text, null::text;
    return;
  end if;
  if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select false, 'not_eligible'::text, null::text;
    return;
  end if;
  if private.super_admin_locked(p_user) then
    perform private.recovery_audit(p_user, 'super_admin_recovery_requested', 'system:recovery',
      jsonb_build_object('purpose', p_purpose, 'outcome', 'locked'));
    return query select false, 'locked'::text, null::text;
    return;
  end if;

  select lower(btrim(au.email)) into v_login from auth.users au where au.id = p_user;

  if p_purpose = 'register' then
    v_target := lower(btrim(coalesce(p_email, '')));
    if v_target !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return query select false, 'invalid_email'::text, null::text;
      return;
    end if;
    if v_target = v_login then
      return query select false, 'same_as_login'::text, null::text;
      return;
    end if;
  else
    select r.email into v_target from private.super_admin_recovery_email r where r.user_id = p_user;
    if v_target is null then
      perform private.recovery_audit(p_user, 'super_admin_recovery_requested', 'system:recovery',
        jsonb_build_object('purpose', p_purpose, 'outcome', 'no_recovery_email'));
      return query select false, 'no_recovery_email'::text, null::text;
      return;
    end if;
    if exists (select 1 from private.super_admin_recovery_pending p
                where p.user_id = p_user and p.cancelled_at is null and p.applied_at is null) then
      return query select false, 'already_pending'::text, null::text;
      return;
    end if;
  end if;

  if (select count(*) from private.super_admin_recovery_code c
       where c.user_id = p_user and c.purpose = p_purpose and c.requested_at > now() - interval '1 hour')
        >= private.session_limit('recovery_requests_per_hour')
     or (select count(*) from private.super_admin_recovery_code c
          where c.user_id = p_user and c.purpose = p_purpose and c.requested_at > now() - interval '1 day')
        >= private.session_limit('recovery_requests_per_day') then
    perform private.recovery_audit(p_user, 'super_admin_recovery_requested', 'system:recovery',
      jsonb_build_object('purpose', p_purpose, 'outcome', 'rate_limited'));
    return query select false, 'rate_limited'::text, null::text;
    return;
  end if;

  -- a new request kills the previous live code
  update private.super_admin_recovery_code set consumed_at = now()
   where user_id = p_user and purpose = p_purpose and consumed_at is null;
  insert into private.super_admin_recovery_code (user_id, purpose, target_email, code_hash, expires_at)
  values (p_user, p_purpose, v_target, extensions.crypt(p_code, extensions.gen_salt('bf', 8)),
          now() + make_interval(mins => private.session_limit('recovery_code_ttl_minutes')));

  v_masked := private.recovery_mask_email(v_target);
  perform private.recovery_audit(p_user, 'super_admin_recovery_requested', 'system:recovery',
    jsonb_build_object('purpose', p_purpose, 'outcome', 'sent', 'to', v_masked));
  return query select true, 'ok'::text, v_target;
end;
$$;
revoke all on function private.recovery_code_issue(uuid, text, text, text) from public, anon, authenticated;
grant execute on function private.recovery_code_issue(uuid, text, text, text) to service_role;

alter table private.super_admin_recovery_code drop column if exists mail_failed_at;
