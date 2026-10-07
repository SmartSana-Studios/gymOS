-- ============================================================================
-- 0098: Registration fee foundation (Epic 18, Story 18.1).
--
-- A gym may charge a flat, one-time, whole-XAF registration fee (0 = off).
-- This migration lays the data foundation and nothing else: the setting, the
-- per-member "settled" state, and a database-level gate that stops a
-- subscription being created for a member who still owes the fee. Collecting,
-- waiving and voiding the fee are later stories (18.2+).
--
--   gyms.registration_fee                 integer not null default 0, >= 0.
--   members.registration_fee_settled_at   NULL on a role='member' row means
--                                         "awaiting registration fee".
--
-- DEFAULT 0 CHANGES NOTHING for any existing gym: every member row is
-- backfilled as settled (created_at) before the insert trigger exists, and
-- the insert trigger settles every new member immediately while the fee is 0.
--
-- Design choices worth knowing before editing this file:
--
--  * The members-column pin is its own BEFORE UPDATE trigger, SECURITY
--    INVOKER, keyed on current_user -- NOT an edit of
--    private.protect_self_managed_member_columns. That function was last
--    rewritten in 0072 on top of 0063's role/name bypass; copying 0020's body
--    back in would silently revert both, and it pins only self-updates while
--    staff direct writes are the larger hole. current_user inside an INVOKER
--    function is the role the statement runs as: 'authenticated'/'anon' for a
--    PostgREST session, the function owner inside a SECURITY DEFINER RPC, and
--    'service_role' for the service client. So only direct client writes are
--    pinned, and 18.2-18.4's definer RPCs and 18.5's service-role import can
--    write the column with no GUC. (The trigger function must stay INVOKER:
--    under SECURITY DEFINER current_user would always be the owner and the
--    pin would never fire.)
--
--  * gyms.registration_fee is pinned inside the existing
--    protect_super_admin_only_gym_columns() (latest body: 0077) using the
--    repo's GUC bypass pattern, because that function has no role exemption
--    -- service_role is pinned there too -- and
--    owner_update_own_gym lets an Owner UPDATE their own gym row directly.
--    Unlike the other pinned columns, registration_fee is pinned for
--    super admins as well: the only write path is set_registration_fee().
--
--  * enforce_member_cap (0018) and its 0093 assertion are untouched: an
--    awaiting member is a role='member' row and counts toward the cap.
--
--  * renewals (confirm_renewal, renew_subscription, complete_verified_payment)
--    are not redefined. They insert subscriptions only for existing members,
--    all of whom are settled, so the gate never fires for them. The gate
--    applies to every plan type, pay_per_session included.
-- ============================================================================

alter table gyms
  add column registration_fee integer not null default 0
    constraint gyms_registration_fee_nonnegative check (registration_fee >= 0);

alter table members
  add column registration_fee_settled_at timestamptz;

-- Backfill: every existing members row (all roles, deactivated included) is
-- settled as of the day it was created. Runs as the migration role, so the
-- pin trigger below (not yet created) would not matter either way.
update members set registration_fee_settled_at = created_at;

-- ----------------------------------------------------------------------------
-- BEFORE INSERT on members: derive the state from the gym's current fee. The
-- client-supplied value is always overwritten. SECURITY DEFINER so the fee
-- read does not depend on the inserting session's RLS on gyms; it reads the
-- row's own gym_id, never a caller claim. It writes no table, so it is not a
-- member of the suspension-guarded writer set.
-- ----------------------------------------------------------------------------
create function private.set_member_registration_fee_settled_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee integer;
begin
  if new.role is distinct from 'member' then
    new.registration_fee_settled_at := now();
    return new;
  end if;

  select g.registration_fee into v_fee from gyms g where g.id = new.gym_id;

  if coalesce(v_fee, 0) > 0 then
    new.registration_fee_settled_at := null;
  else
    new.registration_fee_settled_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function private.set_member_registration_fee_settled_at() from public;

create trigger set_member_registration_fee_settled_at
  before insert on members
  for each row execute function private.set_member_registration_fee_settled_at();

-- ----------------------------------------------------------------------------
-- BEFORE UPDATE on members: pin the column against direct client writes
-- (staff or self). SECURITY INVOKER on purpose -- see the header.
-- ----------------------------------------------------------------------------
create function private.protect_registration_fee_settled_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.registration_fee_settled_at := old.registration_fee_settled_at;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_registration_fee_settled_at() from public;

create trigger protect_registration_fee_settled_at
  before update of registration_fee_settled_at on members
  for each row execute function private.protect_registration_fee_settled_at();

-- ----------------------------------------------------------------------------
-- BEFORE INSERT on subscriptions: the first-subscription gate. SECURITY
-- DEFINER so the members read is not subject to the caller's RLS (a policy
-- that hid the row would make the gate fail open). Only role='member' rows
-- can be awaiting; a missing member row is left to the FK.
-- ----------------------------------------------------------------------------
create function private.enforce_registration_fee_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from members m
    where m.id = new.member_id
      and m.role = 'member'
      and m.registration_fee_settled_at is null
  ) then
    raise exception 'registration_fee_not_settled: member % has not settled the registration fee, so no subscription can be created', new.member_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_registration_fee_settled() from public;

create trigger enforce_registration_fee_settled
  before insert on subscriptions
  for each row execute function private.enforce_registration_fee_settled();

-- ----------------------------------------------------------------------------
-- private.protect_super_admin_only_gym_columns(): 0077's body verbatim, plus
-- the registration_fee pin outside the super-admin exemption, bypassed only
-- by set_registration_fee()'s own GUC.
-- ----------------------------------------------------------------------------
create or replace function private.protect_super_admin_only_gym_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := old.created_at;

  if coalesce(current_setting('app.registration_fee_update_bypass', true), 'false') <> 'true' then
    new.registration_fee := old.registration_fee;
  end if;

  if not private.is_super_admin() then
    new.member_cap_override := old.member_cap_override;

    if coalesce(current_setting('app.saas_billing_lifecycle_job_bypass', true), 'false') <> 'true'
       and coalesce(current_setting('app.saas_billing_payment_reset_bypass', true), 'false') <> 'true' then
      new.status := old.status;
      new.saas_billing_status := old.saas_billing_status;
    end if;

    if coalesce(current_setting('app.saas_billing_payment_reset_bypass', true), 'false') <> 'true' then
      new.saas_billing_anchor_date := old.saas_billing_anchor_date;
      new.tier_id := old.tier_id;
      new.saas_billing_interval := old.saas_billing_interval;
    end if;

    new.saas_grace_period_days := old.saas_grace_period_days;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- set_registration_fee(): the only write path for gyms.registration_fee.
-- Owner or Supervisor, own gym only (from the JWT-derived private.gym_id(),
-- never an argument). Suspension-gated with the fail-closed `is distinct
-- from` form (0090's header) before any write. A fee change affects only
-- members created afterward -- no members row is touched here. An unchanged
-- amount writes nothing and logs nothing.
-- ----------------------------------------------------------------------------
create function set_registration_fee(p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_old integer;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_registration_fee: gym % is not active', v_gym_id;
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'set_registration_fee: invalid_amount';
  end if;

  select g.registration_fee into v_old from gyms g where g.id = v_gym_id for update;

  if v_old is not distinct from p_amount then
    return;
  end if;

  perform set_config('app.registration_fee_update_bypass', 'true', true);

  update gyms set registration_fee = p_amount where id = v_gym_id;

  perform set_config('app.registration_fee_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'registration_fee_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_amount', v_old, 'new_amount', p_amount)
  );
end;
$$;

revoke execute on function set_registration_fee(integer) from public;
grant execute on function set_registration_fee(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0093/0094/0095's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if exists (select 1 from members where registration_fee_settled_at is null) then
    raise exception '0098: backfill left members rows awaiting the registration fee -- every pre-existing member must be settled';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms' and column_name = 'registration_fee'
      and is_nullable = 'NO' and column_default = '0'
  ) then
    raise exception '0098: gyms.registration_fee must be NOT NULL default 0';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'gyms_registration_fee_nonnegative' and contype = 'c'
  ) then
    raise exception '0098: gyms_registration_fee_nonnegative check was not created';
  end if;

  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and (
        (c.relname = 'members' and t.tgname in ('set_member_registration_fee_settled_at', 'protect_registration_fee_settled_at'))
        or (c.relname = 'subscriptions' and t.tgname = 'enforce_registration_fee_settled')
      )) <> 3 then
    raise exception '0098: one of the three registration-fee triggers was not created';
  end if;

  -- The pin keys on current_user; a DEFINER function would always see the
  -- owner and never pin. The other two read tables the caller may not see.
  if (select p.prosecdef from pg_proc p where p.oid = 'private.protect_registration_fee_settled_at()'::regprocedure) then
    raise exception '0098: private.protect_registration_fee_settled_at() must be SECURITY INVOKER -- current_user would be the owner under DEFINER and the pin would never fire';
  end if;

  if not (select bool_and(p.prosecdef) from pg_proc p
          where p.oid in ('private.set_member_registration_fee_settled_at()'::regprocedure,
                          'private.enforce_registration_fee_settled()'::regprocedure,
                          'public.set_registration_fee(integer)'::regprocedure)) then
    raise exception '0098: the fee trigger functions and set_registration_fee() must be SECURITY DEFINER';
  end if;

  -- A NULL proacl is the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.set_member_registration_fee_settled_at()'::regprocedure,
                    'private.protect_registration_fee_settled_at()'::regprocedure,
                    'private.enforce_registration_fee_settled()'::regprocedure,
                    'public.set_registration_fee(integer)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0098: EXECUTE on the registration-fee functions must not be granted to PUBLIC';
  end if;

  if not (select p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
          from pg_proc p where p.oid = 'public.set_registration_fee(integer)'::regprocedure) then
    raise exception '0098: set_registration_fee() must carry the fail-closed suspension guard';
  end if;

  -- enforce_member_cap must stay ungated and unchanged in spirit (0093:689).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_member_cap'
      and p.prosrc like '%''app_role''%'
  ) then
    raise exception '0098: enforce_member_cap must stay ungated';
  end if;
end;
$verify$;
