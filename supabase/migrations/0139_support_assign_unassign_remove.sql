-- Story 23.5: assign, confirm, unassign, deactivate and remove GymOS support people (FR-177, FR-185, FR-193).
--
--   private.support_accounts.deactivated_at   set by deactivate_support_account; refuses later assign, confirm and invite
--   support_assignments state facts          CHECK (activated_at for active/suspended, ended_at iff ended) and a transition
--                                            trigger (ended is terminal; pending -> active|ended; active <-> suspended; ... -> ended)
--   assign_support / confirm_support_assignment / unassign_support / deactivate_support_account / remove_support_account
--                                            Super Admin at aal2 with the flag ON; mandatory reason (3-500 chars); each takes
--                                            private.support_gym_lock(gym) first (the Owner setter takes the same key); one audit
--                                            row, gym_id NULL (an Owner can read gym-scoped audit rows), gym / assignment / reason
--                                            in metadata. Business refusals come back as a typed row (so the refusal audit row
--                                            commits); a wrong caller raises 'permission denied'.
--   get_support_assignments                  Super Admin read, with the individual's name (shown nowhere else)
--   private.support_invite_check, issue_support_invite, get_support_accounts
--                                            redefined: a deactivated account is refused an invite; the list reports it as
--                                            invite_state 'deactivated'
--
-- Nothing activates an assignment automatically: not enrollment, not the Owner turning the switch on.
-- Rollback: scripts/rollback-0139-support-assign-unassign-remove.sql.

-- ===== account: deactivated_at =====
alter table private.support_accounts add column deactivated_at timestamptz;

-- ===== assignment state facts =====
do $pre$
begin
  if exists (select 1 from public.support_assignments a
              where (a.state in ('active', 'suspended') and a.activated_at is null)
                 or ((a.state = 'ended') is distinct from (a.ended_at is not null))) then
    raise exception '0139: existing support_assignments rows violate the new state facts; repair them first';
  end if;
end
$pre$;

alter table public.support_assignments
  add constraint support_assignments_state_facts_chk check (
    (state not in ('active', 'suspended') or activated_at is not null)
    and ((state = 'ended') = (ended_at is not null))
  );

create or replace function private.guard_support_assignment_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.support_user_id is distinct from old.support_user_id or new.gym_id is distinct from old.gym_id then
    raise exception 'support_assignments: the person and the gym of an assignment cannot change' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'pending'   and new.state in ('active', 'ended'))
    or (old.state = 'active'    and new.state in ('suspended', 'ended'))
    or (old.state = 'suspended' and new.state in ('active', 'ended'))
  ) then
    raise exception 'support_assignments: transition % -> % is not allowed', old.state, new.state using errcode = 'P0001';
  end if;
  if old.state = 'ended' and (new.ended_at is distinct from old.ended_at) then
    raise exception 'support_assignments: ended is terminal' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_support_assignment_transition() from public, anon, authenticated;

create trigger guard_support_assignment_transition
  before update on public.support_assignments
  for each row execute function private.guard_support_assignment_transition();

-- ===== helpers =====

-- Super Admin at aal2 with the flag ON, as in create_support_account. Raises for anyone else.
create or replace function private.support_admin_required()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not private.is_super_admin() or not private.super_admin_aal2_required() then
    raise exception 'permission denied';
  end if;
end;
$$;
revoke all on function private.support_admin_required() from public, anon, authenticated;

create or replace function private.support_reason_ok(p_reason text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select char_length(btrim(coalesce(p_reason, ''))) between 3 and 500;
$$;
revoke all on function private.support_reason_ok(text) from public, anon, authenticated;

-- One audit row under the real Super Admin. gym_id stays NULL: gym-scoped audit rows are readable by that gym's Owner.
create or replace function private.support_admin_audit(p_action text, p_user uuid, p_meta jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform log_audit_event(
    p_action_type => p_action,
    p_gym_id => null,
    p_target_entity_id => p_user::text,
    p_target_entity_type => 'user',
    p_metadata => coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;
revoke all on function private.support_admin_audit(text, uuid, jsonb) from public, anon, authenticated;

-- ===== invite side: a deactivated account is refused =====

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
     or v_row.code_attempts >= private.session_limit('support_invite_max_code_attempts')
     or exists (select 1 from private.support_accounts sa where sa.user_id = v_row.user_id and sa.deactivated_at is not null) then
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
  if not found or exists (select 1 from private.support_accounts sa
                           where sa.user_id = p_user_id and (sa.activated_at is not null or sa.deactivated_at is not null)) then
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

-- invite_state 'deactivated' takes precedence over the invite's own state.
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
           (au.email_confirmed_at is not null and sa.deactivated_at is null),
           (sa.activated_at is not null),
           sa.activated_at,
           case
             when sa.deactivated_at is not null then 'deactivated'
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

-- ===== assign =====
-- Result: ok, code, assignment_id. code is 'active' | 'pending' on success, else the refusal:
--   reason_invalid | gym_not_active | target_super_admin | not_assignable | deactivated | already_assigned | other_membership
create or replace function public.assign_support(p_user_id uuid, p_gym_id uuid, p_reason text)
returns table (ok boolean, code text, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_gym     record;
  v_acct    record;
  v_refusal text;
  v_state   text;
  v_acct_found boolean;
  v_id      uuid;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;

  if p_gym_id is not null then
    perform private.support_gym_lock(p_gym_id);
  end if;
  select sa.activated_at, sa.deactivated_at into v_acct
    from private.support_accounts sa where sa.user_id = p_user_id for update;
  v_acct_found := found;
  select g.status, g.allow_gymos_support into v_gym from public.gyms g where g.id = p_gym_id;

  v_refusal := case
    when p_gym_id is null or p_user_id is null or v_gym is null or v_gym.status is distinct from 'active' then 'gym_not_active'
    when coalesce((select u.is_super_admin from public.users u where u.id = p_user_id), false) then 'target_super_admin'
    when not v_acct_found or not exists (select 1 from auth.users au where au.id = p_user_id and au.email_confirmed_at is not null) then 'not_assignable'
    when v_acct.deactivated_at is not null then 'deactivated'
    when exists (select 1 from public.support_assignments a
                  where a.support_user_id = p_user_id and a.gym_id = p_gym_id and a.state <> 'ended') then 'already_assigned'
    when exists (select 1 from public.members m
                  where m.user_id = p_user_id and m.gym_id = p_gym_id and m.role <> 'support' and m.deactivated_at is null) then 'other_membership'
    else null
  end;
  if v_refusal is not null then
    perform private.support_admin_audit('support_assignment_refused', p_user_id,
      jsonb_build_object('gym_id', p_gym_id, 'code', v_refusal, 'reason', v_reason));
    return query select false, v_refusal, null::uuid;
    return;
  end if;

  -- Active only when the account is activated and the Owner switch is on; otherwise it waits for an explicit confirm.
  v_state := case when v_acct.activated_at is not null and v_gym.allow_gymos_support then 'active' else 'pending' end;
  insert into public.support_assignments (support_user_id, gym_id, state, reason, created_by, activated_at)
  values (p_user_id, p_gym_id, v_state, v_reason, auth.uid(), case when v_state = 'active' then now() end)
  returning id into v_id;
  if v_state = 'active' then
    perform private.support_set_membership(v_id, true);
  end if;

  perform private.support_admin_audit('support_assigned', p_user_id,
    jsonb_build_object('gym_id', p_gym_id, 'assignment_id', v_id, 'state', v_state, 'reason', v_reason));
  return query select true, v_state, v_id;
end;
$$;
revoke all on function public.assign_support(uuid, uuid, text) from public, anon;
grant execute on function public.assign_support(uuid, uuid, text) to authenticated, service_role;

-- ===== confirm =====
-- Moves one pending assignment to active, re-checking every leg. Refusal codes:
--   reason_invalid | not_found | not_pending | gym_not_active | deactivated | not_activated | switch_off | other_membership
create or replace function public.confirm_support_assignment(p_assignment_id uuid, p_reason text)
returns table (ok boolean, code text, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_pre     record;
  v_a       public.support_assignments;
  v_gym     record;
  v_acct    record;
  v_refusal text;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;

  select a.gym_id into v_pre from public.support_assignments a where a.id = p_assignment_id;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  perform private.support_gym_lock(v_pre.gym_id);

  select * into v_a from public.support_assignments a where a.id = p_assignment_id for update;
  select g.status, g.allow_gymos_support into v_gym from public.gyms g where g.id = v_a.gym_id;
  select sa.activated_at, sa.deactivated_at into v_acct from private.support_accounts sa where sa.user_id = v_a.support_user_id;

  v_refusal := case
    when v_a.state <> 'pending' then 'not_pending'
    when v_gym.status is distinct from 'active' then 'gym_not_active'
    when v_acct.deactivated_at is not null then 'deactivated'
    when v_acct.activated_at is null then 'not_activated'
    when not coalesce(v_gym.allow_gymos_support, false) then 'switch_off'
    when exists (select 1 from public.members m
                  where m.user_id = v_a.support_user_id and m.gym_id = v_a.gym_id and m.role <> 'support' and m.deactivated_at is null) then 'other_membership'
    else null
  end;
  if v_refusal is not null then
    perform private.support_admin_audit('support_assignment_refused', v_a.support_user_id,
      jsonb_build_object('gym_id', v_a.gym_id, 'assignment_id', v_a.id, 'code', v_refusal, 'reason', v_reason));
    return query select false, v_refusal, v_a.id;
    return;
  end if;

  update public.support_assignments set state = 'active', activated_at = now(), suspended_by_switch = false where id = v_a.id;
  perform private.support_set_membership(v_a.id, true);
  perform private.support_admin_audit('support_assignment_confirmed', v_a.support_user_id,
    jsonb_build_object('gym_id', v_a.gym_id, 'assignment_id', v_a.id, 'reason', v_reason));
  return query select true, 'active'::text, v_a.id;
end;
$$;
revoke all on function public.confirm_support_assignment(uuid, text) from public, anon;
grant execute on function public.confirm_support_assignment(uuid, text) to authenticated, service_role;

-- ===== unassign =====
-- Codes: reason_invalid | not_found | already_ended | ended
create or replace function public.unassign_support(p_assignment_id uuid, p_reason text)
returns table (ok boolean, code text, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_pre    record;
  v_a      public.support_assignments;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;

  select a.gym_id into v_pre from public.support_assignments a where a.id = p_assignment_id;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  perform private.support_gym_lock(v_pre.gym_id);

  select * into v_a from public.support_assignments a where a.id = p_assignment_id for update;
  if v_a.state = 'ended' then
    return query select false, 'already_ended'::text, v_a.id;
    return;
  end if;

  update public.support_assignments
     set state = 'ended', ended_at = now(), suspended_by_switch = false
   where id = v_a.id;
  perform private.support_set_membership(v_a.id, false);
  perform private.support_admin_audit('support_unassigned', v_a.support_user_id,
    jsonb_build_object('gym_id', v_a.gym_id, 'assignment_id', v_a.id, 'previous_state', v_a.state, 'reason', v_reason));
  return query select true, 'ended'::text, v_a.id;
end;
$$;
revoke all on function public.unassign_support(uuid, text) from public, anon;
grant execute on function public.unassign_support(uuid, text) to authenticated, service_role;

-- ===== deactivate =====
-- Ends every non-ended assignment, deactivates the memberships, kills invites and sessions, and records deactivated_at.
-- Irreversible in this story. The app then bans the auth user. Codes: reason_invalid | not_found | already_deactivated | deactivated
create or replace function public.deactivate_support_account(p_user_id uuid, p_reason text)
returns table (ok boolean, code text, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_gym    record;
  v_a      record;
  v_acct   record;
  v_ended  jsonb := '[]'::jsonb;
  v_gyms   jsonb := '[]'::jsonb;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;
  if p_user_id is null then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  -- gym locks first, in a fixed order; the account row second
  for v_gym in
    select distinct a.gym_id from public.support_assignments a
     where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);
  end loop;

  select sa.deactivated_at into v_acct from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_acct.deactivated_at is not null then
    return query select false, 'already_deactivated'::text, null::uuid;
    return;
  end if;

  for v_a in
    select a.id, a.gym_id from public.support_assignments a
     where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id, a.id for update
  loop
    perform private.support_gym_lock(v_a.gym_id);   -- re-entrant; covers an assignment added after the first read
    update public.support_assignments set state = 'ended', ended_at = now(), suspended_by_switch = false where id = v_a.id;
    perform private.support_set_membership(v_a.id, false);
    v_ended := v_ended || to_jsonb(v_a.id);
    v_gyms  := v_gyms || to_jsonb(v_a.gym_id);
  end loop;

  update private.support_accounts set deactivated_at = clock_timestamp() where user_id = p_user_id;
  update private.support_invites set superseded_at = now()
   where user_id = p_user_id and consumed_at is null and superseded_at is null;
  perform private.end_user_sessions(p_user_id);

  perform private.support_admin_audit('support_account_deactivated', p_user_id,
    jsonb_build_object('reason', v_reason, 'ended_assignments', v_ended, 'gym_ids', v_gyms));
  return query select true, 'deactivated'::text, null::uuid;
end;
$$;
revoke all on function public.deactivate_support_account(uuid, text) from public, anon;
grant execute on function public.deactivate_support_account(uuid, text) to authenticated, service_role;

-- ===== remove =====
-- Only an account that was never activated (the mistyped-address case): deletes its invites, assignments (all pending or
-- ended), the support_accounts row and the auth user (public.users cascades). An activated account is deactivated instead.
-- Codes: reason_invalid | not_found | activated | removed
create or replace function public.remove_support_account(p_user_id uuid, p_reason text)
returns table (ok boolean, code text, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_gym    record;
  v_acct   record;
  v_gyms   jsonb;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;
  if p_user_id is null then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  for v_gym in
    select distinct a.gym_id from public.support_assignments a where a.support_user_id = p_user_id order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);
  end loop;

  select sa.activated_at into v_acct from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_acct.activated_at is not null then
    perform private.support_admin_audit('support_account_remove_refused', p_user_id,
      jsonb_build_object('code', 'activated', 'reason', v_reason));
    return query select false, 'activated'::text, null::uuid;
    return;
  end if;

  select coalesce(jsonb_agg(distinct a.gym_id), '[]'::jsonb) into v_gyms
    from public.support_assignments a where a.support_user_id = p_user_id;

  delete from public.support_assignments where support_user_id = p_user_id;
  delete from private.support_invites where user_id = p_user_id;
  delete from private.support_accounts where user_id = p_user_id;
  perform private.end_user_sessions(p_user_id);

  -- audit first (its target is text, so it survives the user), then the auth user and, by cascade, public.users
  perform private.support_admin_audit('support_account_removed', p_user_id,
    jsonb_build_object('reason', v_reason, 'gym_ids', v_gyms));
  delete from auth.users where id = p_user_id;
  return query select true, 'removed'::text, null::uuid;
end;
$$;
revoke all on function public.remove_support_account(uuid, text) from public, anon;
grant execute on function public.remove_support_account(uuid, text) to authenticated, service_role;

-- ===== read (Super Admin only; the individual's name is shown here and nowhere an Owner can reach) =====
create or replace function public.get_support_assignments(p_gym_id uuid default null, p_user_id uuid default null)
returns table (
  assignment_id uuid,
  support_user_id uuid,
  display_name text,
  email text,
  gym_id uuid,
  gym_name text,
  state text,
  reason text,
  created_at timestamptz,
  activated_at timestamptz,
  ended_at timestamptz,
  suspended_by_switch boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.support_admin_required();
  return query
    select a.id, a.support_user_id, u.display_name, au.email::text, a.gym_id, g.name, a.state, a.reason,
           a.created_at, a.activated_at, a.ended_at, a.suspended_by_switch
      from public.support_assignments a
      join public.gyms g on g.id = a.gym_id
      join public.users u on u.id = a.support_user_id
      left join auth.users au on au.id = a.support_user_id
     where (p_gym_id is null or a.gym_id = p_gym_id)
       and (p_user_id is null or a.support_user_id = p_user_id)
     order by (a.state = 'ended'), g.name, u.display_name nulls last, a.created_at desc
     limit 500;
end;
$$;
revoke all on function public.get_support_assignments(uuid, uuid) from public, anon;
grant execute on function public.get_support_assignments(uuid, uuid) to authenticated, service_role;

do $verify$
begin
  if exists (select 1 from unnest(array[
       'public.assign_support(uuid, uuid, text)', 'public.confirm_support_assignment(uuid, text)',
       'public.unassign_support(uuid, text)', 'public.deactivate_support_account(uuid, text)',
       'public.remove_support_account(uuid, text)', 'public.get_support_assignments(uuid, uuid)',
       'private.support_admin_required()', 'private.support_admin_audit(text, uuid, jsonb)',
       'private.support_reason_ok(text)']) f
     where has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute')) then
    raise exception '0139: a support function is callable by anon or public';
  end if;
  if has_function_privilege('authenticated', 'private.support_admin_audit(text, uuid, jsonb)', 'execute') then
    raise exception '0139: private audit helper is client-reachable';
  end if;
end
$verify$;
