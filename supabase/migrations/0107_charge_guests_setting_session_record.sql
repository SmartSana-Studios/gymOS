-- ============================================================================
-- 0107: Charge-guests setting, session record & plan-type rules
-- (Epic 19, Story 19.3).
--
-- Foundation only: no gym changes behavior, because the flag defaults false and
-- nothing reads it yet. Later stories create sessions (19.4+), consume them and
-- gate check-in on them.
--
--   gyms.charge_guests_per_session   boolean NOT NULL DEFAULT false. One write
--                                    path: set_guest_charging(), the only
--                                    holder of the GUC the pin trigger checks.
--   guest_sessions                   the session record. XOR of payment_id or
--                                    loyalty_grant_id (no FK on the grant yet,
--                                    Epic 20). Read-only to every client role.
--   platform_session_config          one-row platform defaults (7 / 60 / 90
--                                    days), Super Admin read and update.
--   payments_purpose_check           admits 'session'.
--   plans.plan_type / plans.price    pinned against direct client UPDATE;
--                                    changed through update_plan_pricing().
--
-- Design choices worth knowing before editing this file:
--
--  * The flag pin is its OWN trigger function, not a branch of
--    protect_super_admin_only_gym_columns(), and it has no super-admin or
--    service_role exemption: only the GUC set inside set_guest_charging()
--    opens it. 0098 did the same for registration_fee, but inside the shared
--    function; Epic 20 adds a second pinned setting, so each gets its own.
--
--  * update_plan_pricing() also writes duration_days, billing_interval and
--    annual_discount_percent. The 0017 CHECKs couple those three columns to
--    plan_type, so a type change cannot be satisfied across two statements;
--    the RPC sets all five columns in one UPDATE and lets the CHECKs judge.
--
--  * The plan pin keys on current_user in ('authenticated','anon') like 0099's
--    purpose pin: the RPC is SECURITY DEFINER and runs as the table owner, so
--    it needs no GUC, and service_role maintenance (seeds, support) is not
--    blocked.
--
--  * "Active member" for guest_charging_impact(): role = 'member', not
--    deactivated, latest subscription by created_at sits on a pay_per_session
--    plan with price > 0. No status filter: pay-per-session rows have no
--    meaningful expiry.
--
--  * Session payments are created only by definer RPCs (19.4+). The staff
--    INSERT policy on payments already requires purpose = 'subscription' and
--    the notification trigger already allow-lists 'subscription', so neither
--    is redefined here.
--
--  * guest_sessions carries tenant_active_gate (the 11.8 coverage test pins
--    the ungated table set; this table is tenant data, not an escape valve).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The flag. ADD COLUMN ... NOT NULL DEFAULT false backfills every existing gym
-- to off in the same statement. 19.12 will SET DEFAULT true afterward; never
-- ADD COLUMN ... DEFAULT true.
-- ----------------------------------------------------------------------------
alter table gyms
  add column charge_guests_per_session boolean not null default false;

-- ----------------------------------------------------------------------------
-- Pin trigger: reverts every write to the flag unless set_guest_charging()
-- holds the GUC. SECURITY INVOKER on purpose; fires for super admin and
-- service_role too. UPDATE only: an INSERT pin could not tell the column
-- default from an explicit value, so it would force every gym created after
-- 19.12's SET DEFAULT true to off. Gym INSERT is never granted to clients.
-- ----------------------------------------------------------------------------
create function private.protect_charge_guests_per_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.guest_charging_update_bypass', true), 'false') <> 'true' then
    new.charge_guests_per_session := old.charge_guests_per_session;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_charge_guests_per_session() from public, anon;

create trigger protect_charge_guests_per_session
  before update of charge_guests_per_session on gyms
  for each row execute function private.protect_charge_guests_per_session();

-- ----------------------------------------------------------------------------
-- set_guest_charging(): the only write path for the flag. Owner or Supervisor
-- of the caller's own gym (gym from the JWT-derived private.gym_id(), never an
-- argument). Role is read through private.current_member_role(), which returns
-- NULL for a missing or deactivated membership; NULL fails closed below.
-- Suspension guard (0090's fail-closed `is distinct from` form) comes after the
-- role checks and before any write. An unchanged value writes and logs nothing.
-- ----------------------------------------------------------------------------
create function set_guest_charging(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_old boolean;
begin
  if not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_guest_charging: gym % is not active', v_gym_id;
  end if;

  if p_enabled is null then
    raise exception 'set_guest_charging: invalid_value';
  end if;

  select g.charge_guests_per_session into v_old
  from gyms g where g.id = v_gym_id for update;

  if v_old is not distinct from p_enabled then
    return;
  end if;

  perform set_config('app.guest_charging_update_bypass', 'true', true);

  update gyms set charge_guests_per_session = p_enabled where id = v_gym_id;

  perform set_config('app.guest_charging_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'guest_charging_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_enabled', v_old, 'new_enabled', p_enabled)
  );
end;
$$;

revoke execute on function set_guest_charging(boolean) from public, anon;
grant execute on function set_guest_charging(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- guest_charging_impact(): members who would start needing a paid session if
-- charging were switched on. Owner or Supervisor, own gym only.
-- ----------------------------------------------------------------------------
create function guest_charging_impact()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_count integer;
begin
  if not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select count(*)::integer into v_count
  from members m
  where m.gym_id = v_gym_id
    and m.role = 'member'
    and m.deactivated_at is null
    and exists (
      select 1
      from (
        select s.plan_id
        from subscriptions s
        where s.member_id = m.id
        order by s.created_at desc, s.id desc
        limit 1
      ) latest
      join plans p on p.id = latest.plan_id
      where p.plan_type = 'pay_per_session' and p.price > 0
    );

  return v_count;
end;
$$;

revoke execute on function guest_charging_impact() from public, anon;
grant execute on function guest_charging_impact() to authenticated;

-- ----------------------------------------------------------------------------
-- guest_sessions: the session record. No write policy and no write grant for
-- any client role; every writer is a SECURITY DEFINER function (19.4+).
-- ----------------------------------------------------------------------------
create table guest_sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  payment_id uuid references payments(id),
  loyalty_grant_id uuid,
  usable_until timestamptz not null,
  consumed_at timestamptz,
  covered_day date,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint guest_sessions_exactly_one_source
    check (num_nonnulls(payment_id, loyalty_grant_id) = 1)
);

create index idx_guest_sessions_gym_id on guest_sessions (gym_id);
create index idx_guest_sessions_member_id on guest_sessions (member_id);

-- One consumed, non-voided session per member per gym-local day.
create unique index guest_sessions_one_consumed_per_member_day
  on guest_sessions (member_id, covered_day)
  where consumed_at is not null and voided_at is null;

-- A payment backs at most one session.
create unique index guest_sessions_payment_id_unique
  on guest_sessions (payment_id)
  where payment_id is not null;

alter table guest_sessions enable row level security;

-- Read-only grants: nothing but SELECT is ever granted to a client role. The
-- default privileges also hand out TRUNCATE (which bypasses RLS), so strip all.
revoke all on guest_sessions from anon, authenticated, service_role;
grant select on guest_sessions to authenticated, service_role;

create policy "gym_staff_read_own_guest_sessions" on guest_sessions
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist')
  );

create policy "member_read_own_guest_sessions" on guest_sessions
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'member'
    and exists (
      select 1 from members m
      where m.id = guest_sessions.member_id and m.user_id = auth.uid()
    )
  );

create policy "tenant_active_gate" on guest_sessions
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

-- ----------------------------------------------------------------------------
-- platform_session_config: one row of platform defaults, stored as data.
-- 0050's shape: seeded once, no INSERT/DELETE grant, so the row count is fixed.
-- The unique index on a constant makes a second row impossible even for the
-- table owner.
-- ----------------------------------------------------------------------------
create table platform_session_config (
  id uuid primary key default gen_random_uuid(),
  paid_session_validity_days integer not null check (paid_session_validity_days > 0),
  free_session_validity_days integer not null check (free_session_validity_days > 0),
  loyalty_idle_reset_days integer not null check (loyalty_idle_reset_days > 0)
);

create unique index platform_session_config_singleton on platform_session_config ((true));

insert into platform_session_config
  (paid_session_validity_days, free_session_validity_days, loyalty_idle_reset_days)
values (7, 60, 90);

alter table platform_session_config enable row level security;

revoke all on platform_session_config from anon, authenticated, service_role;
grant select, update on platform_session_config to authenticated, service_role;

create policy "super_admin_read_platform_session_config" on platform_session_config
  for select
  using (private.is_super_admin());

create policy "super_admin_update_platform_session_config" on platform_session_config
  for update
  using (private.is_super_admin())
  with check (private.is_super_admin());

-- Audited writes: gym_id null (platform-level), old and new values.
create function private.audit_platform_session_config_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform log_audit_event(
    p_action_type => 'platform_session_config_updated',
    p_gym_id => null,
    p_target_entity_id => new.id::text,
    p_target_entity_type => 'platform_session_config',
    p_metadata => jsonb_build_object(
      'old', jsonb_build_object(
        'paid_session_validity_days', old.paid_session_validity_days,
        'free_session_validity_days', old.free_session_validity_days,
        'loyalty_idle_reset_days', old.loyalty_idle_reset_days
      ),
      'new', jsonb_build_object(
        'paid_session_validity_days', new.paid_session_validity_days,
        'free_session_validity_days', new.free_session_validity_days,
        'loyalty_idle_reset_days', new.loyalty_idle_reset_days
      )
    )
  );
  return null;
end;
$$;

revoke execute on function private.audit_platform_session_config_update() from public, anon;

create trigger audit_platform_session_config_update
  after update on platform_session_config
  for each row execute function private.audit_platform_session_config_update();

-- ----------------------------------------------------------------------------
-- payments.purpose admits 'session'. The auto-named constraint from 0099's
-- column definition is payments_purpose_check.
-- ----------------------------------------------------------------------------
alter table payments drop constraint payments_purpose_check;
alter table payments
  add constraint payments_purpose_check
    check (purpose in ('subscription', 'registration_fee', 'session'));

-- ----------------------------------------------------------------------------
-- plans: pin plan_type and price against direct client writes. The other
-- columns, and manager_or_owner_update_own_plans, are untouched.
-- ----------------------------------------------------------------------------
create function private.protect_plan_type_and_price()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.plan_type := old.plan_type;
    new.price := old.price;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_plan_type_and_price() from public, anon;

create trigger protect_plan_type_and_price
  before update of plan_type, price on plans
  for each row execute function private.protect_plan_type_and_price();

-- ----------------------------------------------------------------------------
-- update_plan_pricing(): the only client path for a plan's type and price.
-- Manager, Supervisor or Owner of the plan's own gym. Order: role, gym,
-- suspension, plan lookup (locked), type-lock check, write, audit.
--
-- plan_type_locked: once any subscription references the plan its type cannot
-- change (create a new plan instead). A price change is always allowed and
-- never touches guest_sessions: a paid session keeps the amount it was paid at.
-- ----------------------------------------------------------------------------
create function update_plan_pricing(
  p_plan_id uuid,
  p_plan_type plan_type,
  p_price integer,
  p_duration_days integer,
  p_billing_interval billing_interval,
  p_annual_discount_percent integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_old_type plan_type;
  v_old_price integer;
begin
  if not coalesce(private.current_member_role() in ('owner', 'manager', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_plan_pricing: gym % is not active', v_gym_id;
  end if;

  if p_plan_type is null or p_price is null or p_billing_interval is null or p_price < 0 then
    raise exception 'update_plan_pricing: invalid_input';
  end if;

  select pl.plan_type, pl.price into v_old_type, v_old_price
  from plans pl
  where pl.id = p_plan_id and pl.gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'update_plan_pricing: plan_not_found';
  end if;

  if v_old_type is distinct from p_plan_type
     and exists (select 1 from subscriptions s where s.plan_id = p_plan_id) then
    raise exception 'plan_type_locked: this plan has subscriptions, so its type cannot change; create a new plan instead'
      using errcode = 'check_violation';
  end if;

  update plans
  set plan_type = p_plan_type,
      price = p_price,
      duration_days = p_duration_days,
      billing_interval = p_billing_interval,
      annual_discount_percent = p_annual_discount_percent
  where id = p_plan_id;

  if v_old_type is distinct from p_plan_type then
    perform log_audit_event(
      p_action_type => 'plan_type_changed',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_plan_id::text,
      p_target_entity_type => 'plan',
      p_metadata => jsonb_build_object('old_plan_type', v_old_type, 'new_plan_type', p_plan_type)
    );
  end if;

  if v_old_price is distinct from p_price then
    perform log_audit_event(
      p_action_type => 'plan_price_changed',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_plan_id::text,
      p_target_entity_type => 'plan',
      p_metadata => jsonb_build_object('old_price', v_old_price, 'new_price', p_price)
    );
  end if;
end;
$$;

revoke execute on function update_plan_pricing(uuid, plan_type, integer, integer, billing_interval, integer) from public, anon;
grant execute on function update_plan_pricing(uuid, plan_type, integer, integer, billing_interval, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0098's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if exists (select 1 from gyms where charge_guests_per_session is distinct from false) then
    raise exception '0107: a gym is not off after the flag backfill';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms'
      and column_name = 'charge_guests_per_session'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception '0107: gyms.charge_guests_per_session must be NOT NULL DEFAULT false';
  end if;

  if (select count(*) from platform_session_config) <> 1 then
    raise exception '0107: platform_session_config must hold exactly one row';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.guest_sessions'::regclass) then
    raise exception '0107: guest_sessions must have RLS enabled';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'guest_sessions'
      and grantee in ('authenticated', 'service_role', 'anon')
      and privilege_type <> 'SELECT'
  ) then
    raise exception '0107: guest_sessions must be SELECT-only for client roles';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_purpose_check'
      and pg_get_constraintdef(oid) like '%session%'
  ) then
    raise exception '0107: payments_purpose_check must admit session';
  end if;

  if (select count(*) from pg_trigger
      where tgname in ('protect_charge_guests_per_session', 'protect_plan_type_and_price')
        and not tgisinternal) <> 2 then
    raise exception '0107: pin triggers missing';
  end if;
end;
$verify$;
