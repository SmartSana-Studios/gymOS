-- Story 22.8: Super Admin recovery email.
--
-- A Super Admin registers a verified recovery email (a different mailbox from the login email). From the
-- sign-in prompt, after the password step, a one-time code sent to it can schedule a reset of the
-- account's authenticators. The code never grants a session or aal2: it only schedules the same effect
-- as scripts/reset-super-admin-factors.mjs, applied after recovery_delay_minutes, cancellable.
--
--   super_admin_recovery_email    one verified recovery address per Super Admin
--   super_admin_recovery_code     hashed single-use codes (register + recover), attempts and rate limits
--   super_admin_recovery_pending  scheduled resets (apply_at, cancel token hash, applied/cancelled)
--
-- Everything is service_role only (the app verifies the password session first and sends the mail).
-- Wrong recovery codes only kill the code (3 attempts); they do NOT feed the 22.7 lockout, so a password-only
-- attacker cannot lock the owner out by guessing.
-- After a reset applies, the account may enrol its FIRST authenticator at aal1 for
-- recovery_enrol_window_minutes (private.recovery_enrol_allowed): the 22.6 reset script solved this by
-- turning the whole flag off, which a recovery must not do.
-- Limits live in private.session_limits_config (0127). Rollback: scripts/rollback-0128-super-admin-recovery-email.sql.

insert into private.session_limits_config (key, value, note) values
  ('recovery_delay_minutes',        30, 'Super Admin recovery: minutes between an accepted code and the factor reset'),
  ('recovery_code_ttl_minutes',     10, 'Super Admin recovery: code lifetime'),
  ('recovery_max_attempts',          3, 'Super Admin recovery: wrong codes before a code is dead'),
  ('recovery_requests_per_hour',     3, 'Super Admin recovery: code requests per account per hour (per purpose)'),
  ('recovery_requests_per_day',      5, 'Super Admin recovery: code requests per account per day (per purpose)'),
  ('recovery_enrol_window_minutes', 60, 'Super Admin recovery: first-authenticator enrolment window after a reset applies')
on conflict (key) do nothing;

create table if not exists private.super_admin_recovery_email (
  user_id     uuid primary key,
  email       text not null,
  verified_at timestamptz not null default now()
);
alter table private.super_admin_recovery_email enable row level security;
revoke all on private.super_admin_recovery_email from public, anon, authenticated;

create table if not exists private.super_admin_recovery_code (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  purpose      text not null check (purpose in ('register', 'recover')),
  target_email text not null,
  code_hash    text not null,
  requested_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz
);
create index if not exists super_admin_recovery_code_user_idx
  on private.super_admin_recovery_code (user_id, purpose, requested_at desc);
alter table private.super_admin_recovery_code enable row level security;
revoke all on private.super_admin_recovery_code from public, anon, authenticated;

create table if not exists private.super_admin_recovery_pending (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  created_at        timestamptz not null default now(),
  apply_at          timestamptz not null,
  cancel_token_hash text not null,
  cancelled_at      timestamptz,
  applied_at        timestamptz
);
create index if not exists super_admin_recovery_pending_user_idx on private.super_admin_recovery_pending (user_id);
create index if not exists super_admin_recovery_pending_token_idx on private.super_admin_recovery_pending (cancel_token_hash);
alter table private.super_admin_recovery_pending enable row level security;
revoke all on private.super_admin_recovery_pending from public, anon, authenticated;

-- a***@example.com. Audit rows and responses carry only this, never the full recovery address.
create or replace function private.recovery_mask_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_email is null or position('@' in p_email) < 2 then '***'
              else left(p_email, 1) || '***' || substring(p_email from position('@' in p_email)) end;
$$;

-- p_actor_id: the signed-in Super Admin for flows the owner performs in the app (set, remove, owner
-- cancel); null for system rows (pg_cron, token links, the unauthenticated recovery prompt).
create or replace function private.recovery_audit(p_user uuid, p_action text, p_actor text, p_meta jsonb, p_actor_id uuid default null)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
  values (null, p_actor_id, p_actor, p_action, 'user', p_user::text, coalesce(p_meta, '{}'::jsonb));
$$;

-- Issue a code. The app generates the 6 digits (CSPRNG), passes them once, and mails them to send_to.
-- Refusals come back as a reason row (never raised) so the audit row commits. The app maps every
-- refusal except rate_limited/locked to the same generic response (no account enumeration).
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

-- Check a code. Single use; wrong codes count toward the code's own attempts only (never the account lockout).
create or replace function private.recovery_code_consume(p_user uuid, p_purpose text, p_code text)
returns table (ok boolean, reason text, target text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row private.super_admin_recovery_code%rowtype;
  v_max integer := private.session_limit('recovery_max_attempts');
begin
  if p_user is null or p_purpose not in ('register', 'recover') or p_code is null or p_code !~ '^[0-9]{6}$' then
    return query select false, 'invalid'::text, null::text;
    return;
  end if;
  if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select false, 'invalid'::text, null::text;
    return;
  end if;
  if private.super_admin_locked(p_user) then
    return query select false, 'locked'::text, null::text;
    return;
  end if;

  select * into v_row from private.super_admin_recovery_code c
   where c.user_id = p_user and c.purpose = p_purpose and c.consumed_at is null
   order by c.requested_at desc limit 1
   for update;
  if not found then
    return query select false, 'invalid'::text, null::text;
    return;
  end if;
  if v_row.expires_at <= now() or v_row.attempts >= v_max then
    update private.super_admin_recovery_code set consumed_at = now() where id = v_row.id;
    return query select false, 'invalid'::text, null::text;
    return;
  end if;

  if extensions.crypt(p_code, v_row.code_hash) <> v_row.code_hash then
    update private.super_admin_recovery_code
       set attempts = attempts + 1,
           consumed_at = case when attempts + 1 >= v_max then now() else null end
     where id = v_row.id;
    perform private.recovery_audit(p_user, 'super_admin_recovery_code_failed', 'system:recovery',
      jsonb_build_object('purpose', p_purpose, 'attempts', v_row.attempts + 1, 'max', v_max));
    return query select false, 'invalid'::text, null::text;
    return;
  end if;

  update private.super_admin_recovery_code set consumed_at = now() where id = v_row.id;
  return query select true, 'ok'::text, v_row.target_email;
end;
$$;

-- Registration: a valid code saves (or replaces) the recovery email as verified.
create or replace function private.recovery_register_verify(p_user uuid, p_code text)
returns table (ok boolean, reason text, masked text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_reason text;
  v_target text;
begin
  select c.ok, c.reason, c.target into v_ok, v_reason, v_target
    from private.recovery_code_consume(p_user, 'register', p_code) c;
  if not v_ok then
    return query select false, v_reason, null::text;
    return;
  end if;
  insert into private.super_admin_recovery_email (user_id, email, verified_at)
  values (p_user, v_target, now())
  on conflict (user_id) do update set email = excluded.email, verified_at = excluded.verified_at;
  perform private.recovery_audit(p_user, 'super_admin_recovery_email_set', 'system:recovery',
    jsonb_build_object('to', private.recovery_mask_email(v_target)), p_user);
  return query select true, 'ok'::text, private.recovery_mask_email(v_target);
end;
$$;

-- Removal also drops any scheduled reset (nothing may fire to an address that no longer exists).
create or replace function private.recovery_email_remove(p_user uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  delete from private.super_admin_recovery_email where user_id = p_user returning email into v_email;
  if v_email is null then
    return false;
  end if;
  update private.super_admin_recovery_pending set cancelled_at = now()
   where user_id = p_user and cancelled_at is null and applied_at is null;
  perform private.recovery_audit(p_user, 'super_admin_recovery_email_removed', 'system:recovery',
    jsonb_build_object('was', private.recovery_mask_email(v_email)), p_user);
  return true;
end;
$$;

-- Recovery: a valid code schedules the reset. p_cancel_token is a random token the app puts in the
-- cancel links of both notice emails; only its hash is stored.
create or replace function private.recovery_request_verify(p_user uuid, p_code text, p_cancel_token text)
returns table (ok boolean, reason text, apply_at timestamptz, login_email text, recovery_email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_reason text;
  v_target text;
  v_apply timestamptz;
begin
  if p_cancel_token is null or length(p_cancel_token) < 32 then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select c.ok, c.reason, c.target into v_ok, v_reason, v_target
    from private.recovery_code_consume(p_user, 'recover', p_code) c;
  if not v_ok then
    return query select false, v_reason, null::timestamptz, null::text, null::text;
    return;
  end if;
  v_apply := now() + make_interval(mins => private.session_limit('recovery_delay_minutes'));
  insert into private.super_admin_recovery_pending (user_id, apply_at, cancel_token_hash)
  values (p_user, v_apply, encode(extensions.digest(p_cancel_token, 'sha256'), 'hex'));
  perform private.recovery_audit(p_user, 'super_admin_recovery_accepted', 'system:recovery',
    jsonb_build_object('apply_at', v_apply, 'to', private.recovery_mask_email(v_target)));
  return query
    select true, 'ok'::text, v_apply, (select au.email::text from auth.users au where au.id = p_user), v_target;
end;
$$;

-- Cancel from an email link (unauthenticated route, service role). Unknown or used token: ok=false.
-- On success the addresses come back so the app can tell both mailboxes it was cancelled.
create or replace function private.recovery_cancel(p_token text)
returns table (ok boolean, user_id uuid, login_email text, recovery_email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_token is null or length(p_token) < 32 then
    return query select false, null::uuid, null::text, null::text;
    return;
  end if;
  update private.super_admin_recovery_pending p set cancelled_at = now()
   where p.cancel_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and p.cancelled_at is null and p.applied_at is null
  returning p.user_id into v_user;
  if v_user is null then
    return query select false, null::uuid, null::text, null::text;
    return;
  end if;
  perform private.recovery_audit(v_user, 'super_admin_recovery_cancelled', 'system:recovery',
    jsonb_build_object('by', 'email_link'));
  return query
    select true, v_user,
           (select au.email::text from auth.users au where au.id = v_user),
           (select e.email from private.super_admin_recovery_email e where e.user_id = v_user);
end;
$$;

-- The owner passed a real aal2 check while a recovery was pending: it was not an attacker's, so cancel it.
-- The app calls this only after confirming the session is aal2. Returns the addresses to notify.
create or replace function private.recovery_cancel_for_user(p_user uuid)
returns table (cancelled integer, login_email text, recovery_email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update private.super_admin_recovery_pending set cancelled_at = now()
   where user_id = p_user and cancelled_at is null and applied_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select 0, null::text, null::text;
    return;
  end if;
  perform private.recovery_audit(p_user, 'super_admin_recovery_cancelled', 'system:recovery',
    jsonb_build_object('by', 'owner_signin', 'cancelled', v_n), p_user);
  return query
    select v_n,
           (select au.email::text from auth.users au where au.id = p_user),
           (select e.email from private.super_admin_recovery_email e where e.user_id = p_user);
end;
$$;

-- pg_cron, every minute: apply due resets. A locked account is never reset by a recovery (the lock wins:
-- the pending reset is cancelled), so a security lock is not undone by an older request.
create or replace function private.recovery_apply_due()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
  v_factors integer;
  v_applied integer := 0;
begin
  for r in
    select p.id, p.user_id from private.super_admin_recovery_pending p
     where p.apply_at <= now() and p.cancelled_at is null and p.applied_at is null
     order by p.apply_at
     for update skip locked
  loop
    if private.super_admin_locked(r.user_id)
       or not exists (select 1 from private.super_admin_recovery_email e where e.user_id = r.user_id) then
      update private.super_admin_recovery_pending set cancelled_at = now() where id = r.id;
      perform private.recovery_audit(r.user_id, 'super_admin_recovery_cancelled', 'system:recovery',
        jsonb_build_object('by', 'system', 'reason', 'locked_or_no_email'));
      continue;
    end if;
    -- 0129: a recovery reset removes factors on purpose; the last-factor guard stands aside for this transaction
    perform set_config('gymos.factor_reset', 'on', true);
    delete from auth.mfa_factors where user_id = r.user_id;
    get diagnostics v_factors = row_count;
    perform set_config('gymos.factor_reset', 'off', true);
    perform private.end_user_sessions(r.user_id);
    delete from private.super_admin_lockout where user_id = r.user_id;
    delete from private.support_stepup where user_id = r.user_id;
    update private.super_admin_recovery_pending set applied_at = now() where id = r.id;
    perform private.recovery_audit(r.user_id, 'super_admin_recovery_applied', 'system:recovery',
      jsonb_build_object('factors_removed', v_factors));
    v_applied := v_applied + 1;
  end loop;

  delete from private.super_admin_recovery_code where requested_at < now() - interval '2 days';
  return v_applied;
end;
$$;

-- True while a reset has applied within the window and the account still has no verified authenticator:
-- the app may then let an aal1 session enrol the FIRST factor (never a second one).
create or replace function private.recovery_enrol_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from private.super_admin_recovery_pending p
            where p.user_id = p_user and p.applied_at is not null
              and p.applied_at > now() - make_interval(mins => private.session_limit('recovery_enrol_window_minutes')))
     and not exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified')
     and not private.super_admin_locked(p_user)
     and coalesce((select u.is_super_admin from users u where u.id = p_user), false);
$$;

create or replace function private.recovery_status(p_user uuid)
returns table (has_email boolean, masked text, pending_apply_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from private.super_admin_recovery_email e where e.user_id = p_user),
         (select private.recovery_mask_email(e.email) from private.super_admin_recovery_email e where e.user_id = p_user),
         (select p.apply_at from private.super_admin_recovery_pending p
           where p.user_id = p_user and p.cancelled_at is null and p.applied_at is null
           order by p.apply_at limit 1);
$$;

-- Step-up now also covers changing and removing the recovery email (0127 body plus two actions).
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email') then
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

-- ---- grants: service_role only ------------------------------------------------------------------------
revoke all on function private.recovery_mask_email(text) from public, anon, authenticated;
revoke all on function private.recovery_audit(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.recovery_code_issue(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.recovery_code_consume(uuid, text, text) from public, anon, authenticated;
revoke all on function private.recovery_register_verify(uuid, text) from public, anon, authenticated;
revoke all on function private.recovery_email_remove(uuid) from public, anon, authenticated;
revoke all on function private.recovery_request_verify(uuid, text, text) from public, anon, authenticated;
revoke all on function private.recovery_cancel(text) from public, anon, authenticated;
revoke all on function private.recovery_cancel_for_user(uuid) from public, anon, authenticated;
revoke all on function private.recovery_apply_due() from public, anon, authenticated;
revoke all on function private.recovery_enrol_allowed(uuid) from public, anon, authenticated;
revoke all on function private.recovery_status(uuid) from public, anon, authenticated;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
grant execute on function private.recovery_mask_email(text) to service_role;
grant execute on function private.recovery_code_issue(uuid, text, text, text) to service_role;
grant execute on function private.recovery_register_verify(uuid, text) to service_role;
grant execute on function private.recovery_email_remove(uuid) to service_role;
grant execute on function private.recovery_request_verify(uuid, text, text) to service_role;
grant execute on function private.recovery_cancel(text) to service_role;
grant execute on function private.recovery_cancel_for_user(uuid) to service_role;
grant execute on function private.recovery_enrol_allowed(uuid) to service_role;
grant execute on function private.recovery_status(uuid) to service_role;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;

-- PostgREST entry points (the private schema is not exposed): service_role only.
create or replace function public.recovery_code_issue(p_user uuid, p_purpose text, p_email text, p_code text)
returns table (ok boolean, reason text, send_to text)
language sql volatile security definer set search_path = public
as $$ select * from private.recovery_code_issue(p_user, p_purpose, p_email, p_code); $$;

create or replace function public.recovery_register_verify(p_user uuid, p_code text)
returns table (ok boolean, reason text, masked text)
language sql volatile security definer set search_path = public
as $$ select * from private.recovery_register_verify(p_user, p_code); $$;

create or replace function public.recovery_email_remove(p_user uuid)
returns boolean
language sql volatile security definer set search_path = public
as $$ select private.recovery_email_remove(p_user); $$;

create or replace function public.recovery_request_verify(p_user uuid, p_code text, p_cancel_token text)
returns table (ok boolean, reason text, apply_at timestamptz, login_email text, recovery_email text)
language sql volatile security definer set search_path = public
as $$ select * from private.recovery_request_verify(p_user, p_code, p_cancel_token); $$;

create or replace function public.recovery_cancel(p_token text)
returns table (ok boolean, user_id uuid, login_email text, recovery_email text)
language sql volatile security definer set search_path = public
as $$ select * from private.recovery_cancel(p_token); $$;

create or replace function public.recovery_cancel_for_user(p_user uuid)
returns table (cancelled integer, login_email text, recovery_email text)
language sql volatile security definer set search_path = public
as $$ select * from private.recovery_cancel_for_user(p_user); $$;

create or replace function public.recovery_enrol_allowed(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select private.recovery_enrol_allowed(p_user); $$;

create or replace function public.recovery_status(p_user uuid)
returns table (has_email boolean, masked text, pending_apply_at timestamptz)
language sql stable security definer set search_path = public
as $$ select * from private.recovery_status(p_user); $$;

revoke all on function public.recovery_code_issue(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.recovery_register_verify(uuid, text) from public, anon, authenticated;
revoke all on function public.recovery_email_remove(uuid) from public, anon, authenticated;
revoke all on function public.recovery_request_verify(uuid, text, text) from public, anon, authenticated;
revoke all on function public.recovery_cancel(text) from public, anon, authenticated;
revoke all on function public.recovery_cancel_for_user(uuid) from public, anon, authenticated;
revoke all on function public.recovery_enrol_allowed(uuid) from public, anon, authenticated;
revoke all on function public.recovery_status(uuid) from public, anon, authenticated;
grant execute on function public.recovery_code_issue(uuid, text, text, text) to service_role;
grant execute on function public.recovery_register_verify(uuid, text) to service_role;
grant execute on function public.recovery_email_remove(uuid) to service_role;
grant execute on function public.recovery_request_verify(uuid, text, text) to service_role;
grant execute on function public.recovery_cancel(text) to service_role;
grant execute on function public.recovery_cancel_for_user(uuid) to service_role;
grant execute on function public.recovery_enrol_allowed(uuid) to service_role;
grant execute on function public.recovery_status(uuid) to service_role;

-- every minute, as postgres; cron.schedule() upserts by name
select cron.schedule('super_admin_recovery_apply', '* * * * *', $$ select private.recovery_apply_due(); $$);

do $verify$
begin
  if to_regprocedure('private.recovery_apply_due()') is null
     or to_regprocedure('public.recovery_request_verify(uuid, text, text)') is null then
    raise exception '0128: recovery objects missing';
  end if;
  if has_function_privilege('anon', 'public.recovery_code_issue(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.recovery_code_issue(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.recovery_cancel(text)', 'execute')
     or has_function_privilege('authenticated', 'public.recovery_cancel_for_user(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.recovery_apply_due()', 'execute')
     or has_function_privilege('anon', 'private.recovery_audit(uuid, text, text, jsonb, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.recovery_audit(uuid, text, text, jsonb, uuid)', 'execute') then
    raise exception '0128: recovery functions must be service_role only';
  end if;
  if not exists (select 1 from cron.job where jobname = 'super_admin_recovery_apply') then
    raise exception '0128: super_admin_recovery_apply is not scheduled';
  end if;
end
$verify$;
