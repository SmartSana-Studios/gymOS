-- ============================================================================
-- 0177: Session validity setting and session record changes (Epic 28, Story 28.1; FR-236, schema half of FR-237 and FR-239, NFR-021;
-- AD-55, AD-61, AD-32, AD-28, AD-29, AD-35).
--
-- A gym chooses whether a paid guest session covers the whole gym-local day (today's behaviour) or one visit. The session record remembers
-- which rule it was consumed under. NOTHING in this migration writes a single_use row: every gym stays 'whole_day' and behaves as before.
-- Stories 28.2 (check-in) and 28.3 (classes) build the single_use consumption on these columns.
--
--   * gyms.session_validity                       text NOT NULL DEFAULT 'whole_day', CHECK in ('whole_day', 'single_use').
--   * platform_session_config.single_use_visit_limit_minutes   integer NOT NULL DEFAULT 180, CHECK 1..1440; the audit trigger function is
--     replaced so a change to ONLY the new column is audited (it hard-coded the three old keys).
--   * guest_sessions.validity_mode, covered_kind ('day' | 'visit' | 'class'), covered_booking_id (unique where not null, no cascade);
--     covered_attendance_id (0175) is reused. CHECK guest_sessions_cover_matches_kind, a DEFERRED constraint trigger requiring a consumed
--     'visit' row to have its attendance id by commit, the one-consumed-per-member-day unique index and the covered-day CHECK rebuilt for
--     whole_day rows only, every consumed row backfilled to whole_day / day, and a normalising trigger that fills mode and kind for legacy
--     writers and clears every cover column when consumed_at goes back to null (Epic 27's void needs no edit).
--   * private.consume_guest_session: the 0175 body plus validity_mode = 'whole_day', covered_kind = 'day' in its single UPDATE.
--     private.audit_session_consumed carries validity_mode and covered_kind.
--   * set_session_validity(p_gym_id, p_validity): the only write path (own pin trigger private.pin_session_validity(), own GUC
--     app.session_validity_update_bypass). Owner and Supervisor of the gym only; a Super Admin is refused (assumption A4).
--   * get_session_validity_settings(): the gym's setting and the platform visit limit, for Owner and Supervisor only.
--   * Both functions are rows of private.support_capabilities (AD-35); session_validity_changed joins private.support_audit_actions.
--
-- Deviation from the story text, found against 0175: private.record_check_in (0175, not edited here) stamps covered_attendance_id on the
-- 'consumed' whole_day row. The story's CHECK sentence "a consumed day row has neither id" would make every whole_day check-in fail, so a
-- 'day' row is allowed an attendance id (never a booking id).
--
-- Rollback: scripts/rollback-0177-session-validity.sql (refuses while any single_use row or any gym on single_use exists).
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- gyms.session_validity
-- ----------------------------------------------------------------------------
alter table public.gyms
  add column session_validity text not null default 'whole_day'
    constraint gyms_session_validity_valid check (session_validity in ('whole_day', 'single_use'));

comment on column public.gyms.session_validity is
  'Whether a paid guest session covers the whole gym-local day (whole_day) or one visit (single_use). Written only by set_session_validity().';

-- ----------------------------------------------------------------------------
-- platform_session_config.single_use_visit_limit_minutes and its audit function (replaced: old and new carry the new key)
-- ----------------------------------------------------------------------------
alter table public.platform_session_config
  add column single_use_visit_limit_minutes integer not null default 180
    constraint platform_session_config_visit_limit_range
      check (single_use_visit_limit_minutes > 0 and single_use_visit_limit_minutes <= 1440);

create or replace function private.audit_platform_session_config_update()
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
        'loyalty_idle_reset_days', old.loyalty_idle_reset_days,
        'single_use_visit_limit_minutes', old.single_use_visit_limit_minutes
      ),
      'new', jsonb_build_object(
        'paid_session_validity_days', new.paid_session_validity_days,
        'free_session_validity_days', new.free_session_validity_days,
        'loyalty_idle_reset_days', new.loyalty_idle_reset_days,
        'single_use_visit_limit_minutes', new.single_use_visit_limit_minutes
      )
    )
  );
  return null;
end;
$$;

revoke execute on function private.audit_platform_session_config_update() from public, anon;

-- ----------------------------------------------------------------------------
-- guest_sessions: the cover columns, backfill, then the constraints that need them.
-- ----------------------------------------------------------------------------
alter table public.guest_sessions
  add column validity_mode text
    constraint guest_sessions_validity_mode_check check (validity_mode in ('whole_day', 'single_use')),
  add column covered_kind text
    constraint guest_sessions_covered_kind_check check (covered_kind in ('day', 'visit', 'class')),
  -- No cascade: deleting a booking never silently deletes or rewrites the session that covered it.
  add column covered_booking_id uuid references public.class_bookings (id);

create unique index guest_sessions_covered_booking_id_unique
  on public.guest_sessions (covered_booking_id)
  where covered_booking_id is not null;

-- Every consumed row (voided or not) was consumed under today's rule. No other value changes.
update public.guest_sessions
set validity_mode = 'whole_day', covered_kind = 'day'
where consumed_at is not null;

-- The normalising trigger: legacy writers (and the shipped consume function until it is replaced below) write consumed_at and covered_day
-- with no mode. A row released from consumed (consumed_at set back to null, Epic 27's void) loses every cover column.
create function private.guest_sessions_normalise_cover()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.consumed_at is not null and new.consumed_at is null then
    new.validity_mode := null;
    new.covered_kind := null;
    new.covered_day := null;
    new.covered_attendance_id := null;
    new.covered_booking_id := null;
    return new;
  end if;

  if new.consumed_at is not null
     and new.covered_day is not null
     and new.validity_mode is null
     and new.covered_kind is null then
    new.validity_mode := 'whole_day';
    new.covered_kind := 'day';
  end if;

  return new;
end;
$$;

revoke execute on function private.guest_sessions_normalise_cover() from public, anon, authenticated;

create trigger guest_sessions_normalise_cover
  before insert or update on public.guest_sessions
  for each row execute function private.guest_sessions_normalise_cover();

-- The cover rule (AD-55). A 'day' row may carry covered_attendance_id: private.record_check_in (0175) stamps it on the consumed whole_day
-- row. A 'visit' row must have an attendance id by commit (the deferred constraint trigger below; a CHECK cannot be deferred).
alter table public.guest_sessions
  add constraint guest_sessions_cover_matches_kind check (
    (
      consumed_at is null
      and validity_mode is null and covered_kind is null and covered_day is null
      and covered_attendance_id is null and covered_booking_id is null
    )
    or (
      consumed_at is not null
      -- coalesce: a NULL kind or mode makes every branch NULL, and a CHECK passes on NULL; a consumed row with no kind must fail.
      and coalesce(
        (covered_kind = 'day' and validity_mode = 'whole_day'
          and covered_day is not null and covered_booking_id is null)
        or (covered_kind = 'visit' and validity_mode = 'single_use'
          and covered_day is null and covered_booking_id is null)
        or (covered_kind = 'class' and validity_mode = 'single_use'
          and covered_booking_id is not null and covered_day is null and covered_attendance_id is null),
        false)
    )
  );

-- The shipped covered-day CHECK and one-per-member-day index now apply to whole_day rows only (a single_use row has no covered_day).
alter table public.guest_sessions drop constraint guest_sessions_consumed_has_covered_day;
alter table public.guest_sessions
  add constraint guest_sessions_consumed_has_covered_day
  check (consumed_at is null or validity_mode is distinct from 'whole_day' or covered_day is not null);

drop index public.guest_sessions_one_consumed_per_member_day;
create unique index guest_sessions_one_consumed_per_member_day
  on public.guest_sessions (member_id, covered_day)
  where consumed_at is not null and voided_at is null and validity_mode = 'whole_day';

-- Deferred: a consumed 'visit' row must have covered_attendance_id by commit. Judged on the row as it stands at commit (read back by id),
-- not on the tuple of the event, because 28.2 consumes the row and sets the id afterwards in one transaction.
create function private.guest_sessions_check_visit_has_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from guest_sessions s
    where s.id = new.id
      and s.consumed_at is not null
      and s.covered_kind = 'visit'
      and s.covered_attendance_id is null
  ) then
    raise exception 'guest_sessions: consumed visit session % has no covered_attendance_id', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function private.guest_sessions_check_visit_has_attendance() from public, anon, authenticated;

create constraint trigger guest_sessions_visit_has_attendance
  after insert or update on public.guest_sessions
  deferrable initially deferred
  for each row
  when (new.covered_kind = 'visit' and new.covered_attendance_id is null)
  execute function private.guest_sessions_check_visit_has_attendance();

-- ----------------------------------------------------------------------------
-- private.consume_guest_session: the 0175 body, plus validity_mode = 'whole_day', covered_kind = 'day' in the single UPDATE.
-- Same signature, same return columns, same outcomes.
-- ----------------------------------------------------------------------------
create or replace function private.consume_guest_session(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz)
returns table (outcome text, session_created_at timestamptz, session_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_charging boolean;
  v_timezone text;
  v_plan_type plan_type;
  v_price integer;
  v_day_start timestamptz;
  v_day date;
  v_session_id uuid;
  v_created_at timestamptz;
begin
  -- Re-check before any lock: flag, current plan type, price.
  select g.charge_guests_per_session, g.timezone into v_charging, v_timezone
  from gyms g where g.id = p_gym_id;

  if not coalesce(v_charging, false) then
    return query select 'exempt'::text, null::timestamptz, null::uuid;
    return;
  end if;

  select p.plan_type, p.price into v_plan_type, v_price
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_type is distinct from 'pay_per_session' or coalesce(v_price, 0) <= 0 then
    return query select 'exempt'::text, null::timestamptz, null::uuid;
    return;
  end if;

  -- Canonical order: member (FOR NO KEY UPDATE) before guest_sessions.
  perform 1 from members m where m.id = p_member_id for no key update;

  select b.day_start into v_day_start
  from private.gym_local_day_bounds(v_timezone, p_receipt_at) b;
  v_day := (v_day_start at time zone v_timezone)::date;

  -- Already covered today by a consumed, non-voided session.
  select s.created_at, s.id into v_created_at, v_session_id
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is not null
    and s.voided_at is null
    and s.covered_day = v_day
  limit 1;

  if found then
    return query select 'covered'::text, v_created_at, v_session_id;
    return;
  end if;

  -- Soonest-lapsing usable session; paid (payment_id) before free on a tie.
  select s.id, s.created_at into v_session_id, v_created_at
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is null
    and s.voided_at is null
    and s.usable_until > p_receipt_at
  order by s.usable_until asc, (s.payment_id is null) asc, s.created_at asc, s.id asc
  limit 1
  for update;

  if v_session_id is null then
    return query select 'denied'::text, null::timestamptz, null::uuid;
    return;
  end if;

  update guest_sessions
  set consumed_at = p_receipt_at, covered_day = v_day, validity_mode = 'whole_day', covered_kind = 'day'
  where id = v_session_id;

  perform private.on_session_consumed(v_session_id, p_member_id, p_gym_id);

  return query select 'consumed'::text, v_created_at, v_session_id;
end;
$$;

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- private.audit_session_consumed: the 0113 body, plus validity_mode and covered_kind.
-- ----------------------------------------------------------------------------
create or replace function private.audit_session_consumed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_audit_event(
    p_action_type => 'session_consumed',
    p_gym_id => new.gym_id,
    p_target_entity_id => new.member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'guest_session_id', new.id,
      'payment_id', new.payment_id,
      'covered_day', new.covered_day,
      'consumed_at', new.consumed_at,
      'source', case when new.payment_id is not null then 'paid' else 'free' end,
      'validity_mode', new.validity_mode,
      'covered_kind', new.covered_kind
    )
  );
  return new;
end;
$$;

revoke execute on function private.audit_session_consumed() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- The pin: reverts every UPDATE of gyms.session_validity unless set_session_validity() holds the GUC. SECURITY INVOKER on purpose; fires for
-- Super Admin and service_role too. Its own function and its own GUC (AD-32), never a branch of another setting's pin.
-- ----------------------------------------------------------------------------
create function private.pin_session_validity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.session_validity_update_bypass', true), 'false') <> 'true' then
    new.session_validity := old.session_validity;
  end if;
  return new;
end;
$$;

revoke execute on function private.pin_session_validity() from public, anon, authenticated;

create trigger pin_session_validity
  before update of session_validity on public.gyms
  for each row execute function private.pin_session_validity();

-- ----------------------------------------------------------------------------
-- set_session_validity(): the only write path. Owner and Supervisor of the gym (or a live GymOS Support caller, whose role the registry
-- sets at the Supervisor ceiling). A Super Admin is refused on purpose (A4): the role gate has no is_super_admin branch.
-- ----------------------------------------------------------------------------
create function public.set_session_validity(p_gym_id uuid, p_validity text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_status gym_status;
begin
  if p_gym_id is null
     or p_gym_id is distinct from private.support_rpc_gym_id('set_session_validity')
     or not coalesce(private.support_rpc_role('set_session_validity') in ('owner', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  if p_validity is null or p_validity not in ('whole_day', 'single_use') then
    raise exception 'set_session_validity: invalid_session_validity';
  end if;

  select g.session_validity, g.status into v_old, v_status
  from gyms g where g.id = p_gym_id for update;

  if not found then
    raise exception 'set_session_validity: gym not found';
  end if;

  if v_status is distinct from 'active' then
    raise exception 'set_session_validity: gym % is not active', p_gym_id;
  end if;

  if v_old is not distinct from p_validity then
    return;
  end if;

  perform set_config('app.session_validity_update_bypass', 'true', true);

  update gyms set session_validity = p_validity where id = p_gym_id;

  perform set_config('app.session_validity_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'session_validity_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_validity', v_old, 'new_validity', p_validity)
  );
end;
$$;

revoke execute on function public.set_session_validity(uuid, text) from public, anon;
grant execute on function public.set_session_validity(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- get_session_validity_settings(): the gym's setting and the platform visit limit (Owners cannot read platform_session_config).
-- Own gym only; no row for any other role.
-- ----------------------------------------------------------------------------
create function public.get_session_validity_settings()
returns table (session_validity text, single_use_visit_limit_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  if not coalesce(private.support_rpc_role('get_session_validity_settings') in ('owner', 'supervisor'), false) then
    return;
  end if;

  v_gym_id := private.support_rpc_gym_id('get_session_validity_settings');
  if v_gym_id is null then
    return;
  end if;

  return query
    select g.session_validity, c.single_use_visit_limit_minutes
    from gyms g
    cross join (select pc.single_use_visit_limit_minutes from platform_session_config pc limit 1) c
    where g.id = v_gym_id;
end;
$$;

revoke execute on function public.get_session_validity_settings() from public, anon;
grant execute on function public.get_session_validity_settings() to authenticated;

-- ----------------------------------------------------------------------------
-- The registry (AD-35) and the audit action a support caller can now cause.
-- ----------------------------------------------------------------------------
insert into private.support_capabilities (capability, kind, object_name) values
  ('session_validity', 'rpc', 'set_session_validity'),
  ('session_validity', 'rpc', 'get_session_validity_settings');

insert into private.support_audit_actions (action_type) values
  ('session_validity_changed')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Self-check.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.gyms where session_validity <> 'whole_day') then
    raise exception '0177: a gym is not whole_day after the migration';
  end if;

  if exists (select 1 from public.guest_sessions where consumed_at is not null and (validity_mode is null or covered_kind is null)) then
    raise exception '0177: a consumed guest_sessions row has no mode';
  end if;

  if (select single_use_visit_limit_minutes from public.platform_session_config limit 1) <> 180 then
    raise exception '0177: the visit limit is not 180';
  end if;

  if has_function_privilege('anon', 'public.set_session_validity(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.get_session_validity_settings()', 'execute') then
    raise exception '0177: anon can execute a session validity function';
  end if;
end;
$$;
