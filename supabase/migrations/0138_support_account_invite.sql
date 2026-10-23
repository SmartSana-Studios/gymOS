-- Story 23.4: create a GymOS support account and invite it (FR-175, FR-176, FR-193; AD-38).
--
-- Owner decisions 2026-10-21 (docs/decisions.md): the invite link is emailed to the @gymosapps.com address (the link is the
-- only secret, the mailbox is the binding); the account is an email + password auth user with NO phone (this deviates from
-- the phone-bound wording of FR-175/FR-176/AD-38); the email is GymOS-controlled and verified at creation, so the account is
-- assignable from creation; assignable is not live: private.support_accounts.activated_at is set only by
-- activate_support_account, after a verified TOTP factor, and private.support_live denies until then.
--
--   private.support_invites           hashed (SHA-256), single-use, 24 h invite; attempts counters
--   private.support_email_collision   the one collision check (creation and activation)
--   create_support_account            Super Admin, aal2, flag ON: inactive, assignable account (writer of support_accounts)
--   issue_support_invite              service_role only (the Super Admin app, explicit live-checked p_actor): new invite, earlier ones superseded
--   get_support_accounts              Super Admin: account state list (assignable and activated reported separately)
--   support_invite_inspect / _mark_password_set / _code_failed
--                                     service_role, called by the invite page's server functions
--   activate_support_account          service_role: only writer of activated_at (second writer of support_accounts)
--
-- The auth user itself (no password, email confirmed) is created by the Super Admin app through the Admin API; the SQL
-- functions verify it. Every function is revoked from public and anon. Rollback: scripts/rollback-0138-support-account-invite.sql.

-- ===== limits (the single configuration location from 22.7) =====
insert into private.session_limits_config (key, value, note) values
  ('support_invite_ttl_hours',      24, 'Support invite: lifetime in hours'),
  ('support_invite_max_attempts',    5, 'Support invite: wrong link secrets before the invite is dead'),
  ('support_invite_max_code_attempts', 5, 'Support invite: wrong TOTP codes before the invite is dead')
on conflict (key) do nothing;

-- ===== capability =====
create or replace function private.capability_roles(p_capability text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_capability
    -- dashboard service paths
    when 'staff.create'                      then array['owner','supervisor']
    when 'member.provision'                  then array['owner','manager','supervisor','receptionist']
    when 'member.registration_fee_state'      then array['owner','manager','supervisor','receptionist']
    -- payment initiation at the edge, evaluated against the payment row's gym
    when 'payment.initiate_own'              then array['member']
    when 'payment.initiate_staff'            then array['owner','manager','supervisor','receptionist']
    when 'billing.saas_pay'                  then array['owner']
    -- platform (Super Admin app)
    when 'platform.admin_access'             then array['super_admin']
    when 'platform.gym_create'               then array['super_admin']
    when 'platform.billing_retry'            then array['super_admin']
    when 'platform.super_admin_manage'       then array['super_admin']
    when 'platform.support_manage'           then array['super_admin']
    else null
  end;
$$;
revoke all on function private.capability_roles(text) from public, anon, authenticated;
grant execute on function private.capability_roles(text) to service_role;

-- ===== invite table =====
create table private.support_invites (
  id             uuid primary key,
  user_id        uuid not null references public.users(id) on delete cascade,
  token_hash     text not null,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default clock_timestamp(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  superseded_at  timestamptz,
  attempts       integer not null default 0,
  code_attempts  integer not null default 0,
  password_set_at timestamptz
);
create index support_invites_user_idx on private.support_invites (user_id, created_at desc);
alter table private.support_invites enable row level security;
revoke all on private.support_invites from public, anon, authenticated;

-- ===== helpers =====

-- Audit row written outside a Super Admin session (the invitee has no Super Admin actor). Never carries a link, token, code or password.
create or replace function private.support_audit(p_actor uuid, p_label text, p_action text, p_user uuid, p_meta jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
  values (null, p_actor, p_label, p_action, 'user', p_user::text, coalesce(p_meta, '{}'::jsonb));
$$;
revoke all on function private.support_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- True when the email matches ANYTHING else: another auth user, a gym member record, a linked identity, a Super Admin; or,
-- for the account being checked (p_ignore), when it has become a Super Admin, holds a non-support membership or has a phone.
-- One function, run at creation and again at activation; callers raise the same message whichever leg matched.
create or replace function private.support_email_collision(p_email text, p_ignore uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_email, '')));
begin
  if v = '' then
    return true;
  end if;
  return
    exists (select 1 from auth.users au where lower(au.email) = v and au.id is distinct from p_ignore)
    or exists (select 1 from public.members m where lower(m.email) = v and m.user_id is distinct from p_ignore)
    or exists (select 1 from auth.identities i
                where i.user_id is distinct from p_ignore
                  and (lower(i.identity_data ->> 'email') = v))
    or exists (select 1 from public.users u join auth.users au on au.id = u.id
                where u.is_super_admin and lower(au.email) = v and au.id is distinct from p_ignore)
    or (p_ignore is not null and (
          coalesce((select u.is_super_admin from public.users u where u.id = p_ignore), false)
          or exists (select 1 from public.members m where m.user_id = p_ignore and m.role <> 'support')
          or exists (select 1 from auth.users au where au.id = p_ignore and coalesce(au.phone, '') <> '')
        ));
end;
$$;
revoke all on function private.support_email_collision(text, uuid) from public, anon, authenticated;
grant execute on function private.support_email_collision(text, uuid) to service_role;

-- Token = '<invite id>.<64 hex secret>'. Returns the live invite row for a correct token. A wrong secret for a known invite
-- counts toward the invite's attempts (the invite dies at the limit). Returns nothing for any failure; never raises, so the
-- counter commits.
create or replace function private.support_invite_check(p_token text)
returns table (invite_id uuid, user_id uuid, password_set boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_row private.support_invites%rowtype;
  v_max integer := private.session_limit('support_invite_max_attempts');
begin
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    return;
  end if;
  v_id := split_part(p_token, '.', 1)::uuid;

  select * into v_row from private.support_invites i where i.id = v_id for update;
  if not found
     or v_row.consumed_at is not null
     or v_row.superseded_at is not null
     or v_row.expires_at <= now()
     or v_row.attempts >= v_max
     or v_row.code_attempts >= private.session_limit('support_invite_max_code_attempts') then
    return;
  end if;

  if v_row.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex') then
    update private.support_invites set attempts = attempts + 1 where id = v_id;
    return;
  end if;

  return query select v_row.id, v_row.user_id, v_row.password_set_at is not null;
end;
$$;
revoke all on function private.support_invite_check(text) from public, anon, authenticated;
grant execute on function private.support_invite_check(text) to service_role;

-- ===== Super Admin side =====

create or replace function public.create_support_account(p_user_id uuid, p_display_name text, p_email text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_display_name, ''));
begin
  -- Super Admin at aal2 only, and only while the aal2 flag is ON (is_super_admin() adds the aal2 requirement while it is on).
  if p_user_id is null or not private.is_super_admin() or not private.super_admin_aal2_required() then
    raise exception 'permission denied';
  end if;
  if v_name = '' or char_length(v_name) > 100 or v_email !~ '^[^@[:space:]]+@gymosapps\.com$' then
    raise exception 'support_account_refused';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support_account_email:' || v_email, 0));

  -- The auth user was just created by the app (no password, email confirmed). Verify it; the email is the trusted binding.
  if not exists (select 1 from auth.users au
                  where au.id = p_user_id and lower(au.email) = v_email and au.email_confirmed_at is not null)
     or not exists (select 1 from public.users u where u.id = p_user_id)
     or exists (select 1 from private.support_accounts sa where sa.user_id = p_user_id)
     or private.support_email_collision(v_email, p_user_id) then
    raise exception 'support_account_refused';
  end if;

  update public.users set display_name = v_name where id = p_user_id;
  insert into private.support_accounts (user_id) values (p_user_id);

  perform log_audit_event(
    p_action_type => 'support_account_created',
    p_target_entity_id => p_user_id::text,
    p_target_entity_type => 'user'
  );
  return p_user_id;
end;
$$;
revoke all on function public.create_support_account(uuid, text, text) from public, anon;
grant execute on function public.create_support_account(uuid, text, text) to authenticated, service_role;

-- Server-only (service_role): the Super Admin app generates the token on the server, never hands it to a browser session, and
-- mails it to the account's own address, so the mailbox stays the binding. p_actor is the already-authorised Super Admin; it
-- is re-verified live here and is the actor of the audit row. Only the SHA-256 of the token is stored.
create or replace function public.issue_support_invite(p_user_id uuid, p_token text, p_actor uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
  v_name    text;
begin
  if p_user_id is null or p_actor is null
     or not coalesce((select u.is_super_admin from public.users u where u.id = p_actor), false) then
    raise exception 'permission denied';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    raise exception 'support_invite_refused';
  end if;

  -- lock the account row so two invites for one account serialise
  perform 1 from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found or exists (select 1 from private.support_accounts sa where sa.user_id = p_user_id and sa.activated_at is not null) then
    raise exception 'support_invite_refused';
  end if;

  update private.support_invites set superseded_at = now()
   where user_id = p_user_id and consumed_at is null and superseded_at is null;

  v_expires := now() + make_interval(hours => private.session_limit('support_invite_ttl_hours'));
  insert into private.support_invites (id, user_id, token_hash, created_by, expires_at)
  values (split_part(p_token, '.', 1)::uuid, p_user_id, encode(extensions.digest(p_token, 'sha256'), 'hex'), p_actor, v_expires);

  select coalesce(nullif(u.display_name, ''), 'Super Admin') into v_name from public.users u where u.id = p_actor;
  perform private.support_audit(p_actor, v_name, 'support_invite_issued', p_user_id,
    jsonb_build_object('expires_at', v_expires));
  return v_expires;
end;
$$;
revoke all on function public.issue_support_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_support_invite(uuid, text, uuid) to service_role;

-- assignable is true from creation (the email is verified and GymOS-controlled); activated only after TOTP enrollment.
create or replace function public.get_support_accounts()
returns table (
  user_id uuid,
  display_name text,
  email text,
  assignable boolean,
  activated boolean,
  activated_at timestamptz,
  invite_state text,
  invite_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;
  return query
    select sa.user_id,
           u.display_name,
           au.email::text,
           (au.email_confirmed_at is not null),
           (sa.activated_at is not null),
           sa.activated_at,
           case
             when inv.id is null then 'none'
             when inv.consumed_at is not null then 'used'
             when inv.superseded_at is not null
                  or inv.attempts >= private.session_limit('support_invite_max_attempts')
                  or inv.code_attempts >= private.session_limit('support_invite_max_code_attempts') then 'dead'
             when inv.expires_at <= now() then 'expired'
             else 'pending'
           end,
           inv.expires_at
      from private.support_accounts sa
      join public.users u on u.id = sa.user_id
      join auth.users au on au.id = sa.user_id
      left join lateral (
        select i.* from private.support_invites i where i.user_id = sa.user_id order by i.created_at desc limit 1
      ) inv on true
     order by u.display_name nulls last, au.email;
end;
$$;
revoke all on function public.get_support_accounts() from public, anon;
grant execute on function public.get_support_accounts() to authenticated, service_role;

-- ===== invite side (service_role: the dashboard's server functions) =====

create or replace function public.support_invite_inspect(p_token text)
returns table (ok boolean, step text, user_id uuid, email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return query select false, null::text, null::uuid, null::text;
    return;
  end if;
  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null) then
    return query select false, null::text, null::uuid, null::text;
    return;
  end if;
  return query
    select true,
           case when v.password_set then 'totp' else 'password' end,
           v.user_id,
           (select lower(au.email)::text from auth.users au where au.id = v.user_id);
end;
$$;
revoke all on function public.support_invite_inspect(text) from public, anon, authenticated;
grant execute on function public.support_invite_inspect(text) to service_role;

create or replace function public.support_invite_mark_password_set(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return false;
  end if;
  update private.support_invites set password_set_at = coalesce(password_set_at, now()) where id = v.invite_id;
  return true;
end;
$$;
revoke all on function public.support_invite_mark_password_set(text) from public, anon, authenticated;
grant execute on function public.support_invite_mark_password_set(text) to service_role;

-- A wrong TOTP code during enrollment. The invite dies at the limit. Returns true while the invite is still usable.
create or replace function public.support_invite_code_failed(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
  v_count integer;
  v_max integer := private.session_limit('support_invite_max_code_attempts');
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return false;
  end if;
  update private.support_invites set code_attempts = code_attempts + 1 where id = v.invite_id
  returning code_attempts into v_count;
  perform private.support_audit(v.user_id, 'support:invite', 'support_activation_refused', v.user_id,
    jsonb_build_object('reason', 'code_failed', 'attempts', v_count, 'max', v_max));
  return v_count < v_max;
end;
$$;
revoke all on function public.support_invite_code_failed(text) from public, anon, authenticated;
grant execute on function public.support_invite_code_failed(text) to service_role;

-- The only writer of activated_at. Refusals come back as a reason row (never raised) so the audit row commits.
create or replace function public.activate_support_account(p_token text)
returns table (ok boolean, reason text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
  v_email text;
  v_reason text;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return query select false, 'invalid'::text;
    return;
  end if;

  select lower(au.email) into v_email from auth.users au where au.id = v.user_id;

  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null) then
    v_reason := 'already_active';
  elsif not v.password_set then
    v_reason := 'password_not_set';
  elsif private.support_email_collision(v_email, v.user_id) then
    v_reason := 'collision';
  elsif not exists (select 1 from auth.mfa_factors f
                     where f.user_id = v.user_id and f.factor_type = 'totp' and f.status = 'verified') then
    v_reason := 'no_verified_factor';
  end if;

  if v_reason is not null then
    perform private.support_audit(v.user_id, 'support:invite', 'support_activation_refused', v.user_id,
      jsonb_build_object('reason', v_reason));
    return query select false, v_reason;
    return;
  end if;

  update private.support_accounts set activated_at = now() where user_id = v.user_id and activated_at is null;
  update private.support_invites set consumed_at = now() where id = v.invite_id;
  -- the aal1 session used to enrol the factor must not survive: later sign-ins are email + password, then TOTP
  perform private.end_user_sessions(v.user_id);
  perform private.support_audit(v.user_id, 'support:invite', 'support_account_activated', v.user_id, '{}'::jsonb);
  return query select true, 'ok'::text;
end;
$$;
revoke all on function public.activate_support_account(text) from public, anon, authenticated;
grant execute on function public.activate_support_account(text) to service_role;
