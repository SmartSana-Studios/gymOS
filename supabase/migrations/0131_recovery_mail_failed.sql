-- Recovery email: a failed send no longer locks the owner out (epic 22 retro action item 71).
--
-- Found on 2026-10-19 in production: Resend refused the message, the code stayed live, and the three failed sends used
-- up the 3-requests-per-hour limit, so the owner could not retry for an hour. The audit row said "sent" for a code that was
-- only issued.
--
--   * private.super_admin_recovery_code.mail_failed_at: set when the app reports that the mail could not be sent.
--   * private.recovery_code_mail_failed(user, purpose): voids the live code, marks it failed, audits outcome 'mail_failed'.
--   * recovery_code_issue: failed sends are excluded from the per-hour / per-day limits, with a wider cap (3x) over all
--     requests so a broken mail server cannot create unlimited codes.
-- Rollback: scripts/rollback-0131-recovery-mail-failed.sql.

alter table private.super_admin_recovery_code add column if not exists mail_failed_at timestamptz;

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
  v_hour_ok integer;
  v_hour_all integer;
  v_day_ok integer;
  v_day_all integer;
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

  -- A send that failed on OUR side (mail_failed_at) does not use up the owner's attempts, but a broken mail
  -- server must not become unlimited code creation, so every request still counts toward a wider cap
  -- (3x the limit). Sent or unsent-but-pending requests count as before.
  select count(*) filter (where c.requested_at > now() - interval '1 hour' and c.mail_failed_at is null),
         count(*) filter (where c.requested_at > now() - interval '1 hour'),
         count(*) filter (where c.mail_failed_at is null),
         count(*)
    into v_hour_ok, v_hour_all, v_day_ok, v_day_all
    from private.super_admin_recovery_code c
   where c.user_id = p_user and c.purpose = p_purpose and c.requested_at > now() - interval '1 day';
  if v_hour_ok >= private.session_limit('recovery_requests_per_hour')
     or v_hour_all >= private.session_limit('recovery_requests_per_hour') * 3
     or v_day_ok >= private.session_limit('recovery_requests_per_day')
     or v_day_all >= private.session_limit('recovery_requests_per_day') * 3 then
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

create or replace function private.recovery_code_mail_failed(p_user uuid, p_purpose text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user is null or p_purpose not in ('register', 'recover') then
    return false;
  end if;
  select c.id into v_id
    from private.super_admin_recovery_code c
   where c.user_id = p_user and c.purpose = p_purpose and c.consumed_at is null and c.mail_failed_at is null
   order by c.requested_at desc
   limit 1
   for update;
  if v_id is null then
    return false;
  end if;
  update private.super_admin_recovery_code set consumed_at = now(), mail_failed_at = now() where id = v_id;
  perform private.recovery_audit(p_user, 'super_admin_recovery_requested', 'system:recovery',
    jsonb_build_object('purpose', p_purpose, 'outcome', 'mail_failed'));
  return true;
end;
$$;

revoke all on function private.recovery_code_mail_failed(uuid, text) from public, anon, authenticated;
grant execute on function private.recovery_code_mail_failed(uuid, text) to service_role;
-- create or replace keeps the grants 0128 gave recovery_code_issue; restated so this migration stands alone.
revoke all on function private.recovery_code_issue(uuid, text, text, text) from public, anon, authenticated;
grant execute on function private.recovery_code_issue(uuid, text, text, text) to service_role;

create or replace function public.recovery_code_mail_failed(p_user uuid, p_purpose text)
returns boolean
language sql volatile security definer set search_path = public
as $$ select private.recovery_code_mail_failed(p_user, p_purpose); $$;
revoke all on function public.recovery_code_mail_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.recovery_code_mail_failed(uuid, text) to service_role;

do $verify$
begin
  if to_regprocedure('private.recovery_code_mail_failed(uuid, text)') is null
     or to_regprocedure('public.recovery_code_mail_failed(uuid, text)') is null then
    raise exception '0131: mail_failed functions missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'private' and table_name = 'super_admin_recovery_code' and column_name = 'mail_failed_at') then
    raise exception '0131: mail_failed_at column missing';
  end if;
  if has_function_privilege('anon', 'public.recovery_code_mail_failed(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.recovery_code_mail_failed(uuid, text)', 'execute')
     or has_function_privilege('anon', 'private.recovery_code_mail_failed(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'private.recovery_code_mail_failed(uuid, text)', 'execute') then
    raise exception '0131: mail_failed functions must be service_role only';
  end if;
end
$verify$;
