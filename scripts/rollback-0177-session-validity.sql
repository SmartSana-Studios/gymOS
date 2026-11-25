-- Rollback for migration 0177: session validity setting and session record changes (Epic 28, Story 28.1).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0177-session-validity.sql
--
-- VALID ONLY WHILE NO GYM IS ON single_use AND NO guest_sessions ROW IS single_use. Either would lose information the older schema cannot hold
-- (a single_use row has no covered_day, which the restored covered-day CHECK and one-per-day index assume). The script refuses, naming the count.
-- The session_validity_changed audit rows already written stay (audit_log is append-only).
--
-- Drops: public.set_session_validity, public.get_session_validity_settings, the two registry rows and the audit action row, the pin trigger and
-- function, the normalising and deferred-visit triggers and functions, the cover CHECK, the covered_booking_id index and column, validity_mode,
-- covered_kind, gyms.session_validity, platform_session_config.single_use_visit_limit_minutes.
-- Restores: the 0107 covered-day index, the 0111 covered-day CHECK, private.consume_guest_session as 0175 left it, private.audit_session_consumed
-- as 0113 left it, private.audit_platform_session_config_update as 0107 left it.
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.gyms where session_validity = 'single_use') then
    raise exception '0177 rollback refused: % gym(s) are on single_use', (select count(*) from public.gyms where session_validity = 'single_use');
  end if;
  if exists (select 1 from public.guest_sessions where validity_mode = 'single_use') then
    raise exception '0177 rollback refused: % guest_sessions row(s) are single_use', (select count(*) from public.guest_sessions where validity_mode = 'single_use');
  end if;
end;
$$;

delete from private.support_capabilities where kind = 'rpc' and object_name in ('set_session_validity', 'get_session_validity_settings');
delete from private.support_audit_actions where action_type = 'session_validity_changed';

drop function public.set_session_validity(uuid, text);
drop function public.get_session_validity_settings();

drop trigger pin_session_validity on public.gyms;
drop function private.pin_session_validity();

-- The 0175 body of the consume function (without the mode and kind columns); the 0113 audit trigger function.
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

  perform 1 from members m where m.id = p_member_id for no key update;

  select b.day_start into v_day_start
  from private.gym_local_day_bounds(v_timezone, p_receipt_at) b;
  v_day := (v_day_start at time zone v_timezone)::date;

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
  set consumed_at = p_receipt_at, covered_day = v_day
  where id = v_session_id;

  perform private.on_session_consumed(v_session_id, p_member_id, p_gym_id);

  return query select 'consumed'::text, v_created_at, v_session_id;
end;
$$;

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz) from public, anon, authenticated;

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
      'source', case when new.payment_id is not null then 'paid' else 'free' end
    )
  );
  return new;
end;
$$;

revoke execute on function private.audit_session_consumed() from public, anon, authenticated;

drop trigger guest_sessions_visit_has_attendance on public.guest_sessions;
drop function private.guest_sessions_check_visit_has_attendance();
drop trigger guest_sessions_normalise_cover on public.guest_sessions;
drop function private.guest_sessions_normalise_cover();

alter table public.guest_sessions drop constraint guest_sessions_cover_matches_kind;
alter table public.guest_sessions drop constraint guest_sessions_consumed_has_covered_day;
alter table public.guest_sessions
  add constraint guest_sessions_consumed_has_covered_day
  check (consumed_at is null or covered_day is not null);

drop index public.guest_sessions_one_consumed_per_member_day;
create unique index guest_sessions_one_consumed_per_member_day
  on public.guest_sessions (member_id, covered_day)
  where consumed_at is not null and voided_at is null;

drop index public.guest_sessions_covered_booking_id_unique;
alter table public.guest_sessions
  drop column covered_booking_id,
  drop column covered_kind,
  drop column validity_mode;

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

alter table public.platform_session_config drop column single_use_visit_limit_minutes;
alter table public.gyms drop column session_validity;
