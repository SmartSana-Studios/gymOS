-- Rollback for migration 0139 (assign, unassign, remove).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0139-support-assign-unassign-remove.sql
-- Data effects: assignments already ended stay ended (the CHECK and transition trigger go, the rows stay); accounts
-- deactivated by 0139 lose their deactivated_at and become activatable/invitable again (their auth users stay banned, review them);
-- accounts removed are gone. Restores the 0138 bodies of support_invite_check, issue_support_invite and get_support_accounts.
set local lock_timeout = '5s';
drop function if exists public.get_support_assignments(uuid, uuid);
drop function if exists public.remove_support_account(uuid, text);
drop function if exists public.deactivate_support_account(uuid, text);
drop function if exists public.unassign_support(uuid, text);
drop function if exists public.confirm_support_assignment(uuid, text);
drop function if exists public.assign_support(uuid, uuid, text);
drop function if exists private.support_admin_audit(text, uuid, jsonb);
drop function if exists private.support_reason_ok(text);
drop function if exists private.support_admin_required();
drop trigger if exists guard_support_assignment_transition on public.support_assignments;
drop function if exists private.guard_support_assignment_transition();
alter table public.support_assignments drop constraint if exists support_assignments_state_facts_chk;

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

alter table private.support_accounts drop column if exists deactivated_at;
