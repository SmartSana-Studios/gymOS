-- ============================================================================
-- 0108: Desk session payment (Epic 19, Story 19.4).
--
-- Staff can sell a paid session at the front desk. Database side only: the
-- Record Session Payment panel is 19.9, the in-app Tara payment is 19.5, and
-- nothing consumes a session yet (19.6b / 19.7).
--
--   record_session_payment(member, method, reason)   the desk sale
--   private.create_guest_session_for_payment()       the one place a paid
--                                                    guest_sessions row is made
--                                                    (19.5 reuses it)
--   private.expire_stale_payment(member, gym, purpose)  0106's fee helper made
--                                                    purpose-generic
--
-- Design choices worth knowing before editing this file:
--
--  * The amount and currency are never a parameter. They come from the plan of
--    the member's latest subscription (created_at desc, id desc), the same
--    "latest" the 0107 impact count uses.
--
--  * Check order after the role and suspension guards: method, reason, the gym
--    flag, then the expiry flag (payment rows) and the member lock, then the
--    member checks (not found, deactivated, awaiting the registration fee),
--    then the plan checks, then the in-flight check. An awaiting member has no
--    subscription yet, so the fee check must precede the plan check or it would
--    never be reachable.
--
--  * Lock order is payment rows first, member row second (FOR NO KEY UPDATE),
--    the canonical order of Epic 19. Two calls for one member serialize on the
--    member row and both succeed: a double desk entry is allowed by design.
--
--  * The two private helpers are SECURITY INVOKER on purpose, like 0100's
--    expiry helper: they are only called from definer functions (so they run
--    as the owner), and a definer helper writing a gated table would need an
--    entry on the suspension coverage test's exclusion list. Every caller
--    carries the status guard.
--
--  * The fee helper stays, as a thin wrapper, so record/waive/initiate for the
--    registration fee keep working byte for byte.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Purpose-generic expiry helper. Flags this member's `processing` payments of
-- the given purpose that are older than ten minutes as `flagged` /
-- `expired_attempt` and audits each one as <purpose>_attempt_expired.
-- ----------------------------------------------------------------------------
create function private.expire_stale_payment(p_member_id uuid, p_gym_id uuid, p_purpose text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  for v_payment_id in
    update payments
    set status = 'flagged', flagged_reason = 'expired_attempt'
    where member_id = p_member_id
      and gym_id = p_gym_id
      and purpose = p_purpose
      and voided_at is null
      and status = 'processing'
      and created_at < now() - interval '10 minutes'
    returning id
  loop
    perform log_audit_event(
      p_action_type => p_purpose || '_attempt_expired',
      p_gym_id => p_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object('payment_id', v_payment_id)
    );
  end loop;
end;
$$;

revoke execute on function private.expire_stale_payment(uuid, uuid, text) from public, anon;

-- The fee helper delegates, identical behavior (audit registration_fee_attempt_expired).
create or replace function private.expire_stale_registration_fee_payment(p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform private.expire_stale_payment(p_member_id, p_gym_id, 'registration_fee');
end;
$$;

revoke execute on function private.expire_stale_registration_fee_payment(uuid, uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- The shared session-creation function. One paid session for one verified
-- session payment, usable for platform_session_config.paid_session_validity_days
-- from now. The unique index on guest_sessions.payment_id keeps a payment from
-- backing two sessions.
-- ----------------------------------------------------------------------------
create function private.create_guest_session_for_payment(p_payment_id uuid, p_member_id uuid, p_gym_id uuid)
returns guest_sessions
language plpgsql
set search_path = public
as $$
declare
  v_days integer;
  v_session guest_sessions;
begin
  select c.paid_session_validity_days into v_days from platform_session_config c limit 1;

  if v_days is null then
    raise exception 'session_config_missing: platform_session_config has no row';
  end if;

  insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
  values (p_gym_id, p_member_id, p_payment_id, now() + make_interval(days => v_days))
  returning * into v_session;

  return v_session;
end;
$$;

revoke execute on function private.create_guest_session_for_payment(uuid, uuid, uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- record_session_payment(): the desk sale.
-- ----------------------------------------------------------------------------
create function record_session_payment(p_member_id uuid, p_method text, p_reason text default null)
returns guest_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_caller_role member_role;
  v_charging boolean;
  v_reason text;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_plan_type plan_type;
  v_price integer;
  v_currency text;
  v_payment_id uuid;
  v_session guest_sessions;
begin
  v_caller_role := private.current_member_role();

  if not coalesce(v_caller_role in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Bank transfer is a manager-and-above method.
  if p_method = 'bank_transfer' and v_caller_role = 'receptionist' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'record_session_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := auth.uid();

  if p_method is null or p_method not in ('cash', 'bank_transfer', 'manual_momo') then
    raise exception 'record_session_payment: invalid_method';
  end if;

  v_reason := nullif(btrim(p_reason, E' \t\r\n'), '');
  if char_length(v_reason) > 200 then
    raise exception 'record_session_payment: reason is too long';
  end if;

  select g.charge_guests_per_session into v_charging from gyms g where g.id = v_gym_id;
  if not coalesce(v_charging, false) then
    raise exception 'charging_disabled: this gym does not charge guests per session';
  end if;

  -- Payment rows before the member row (lock order): flag an expired Tara
  -- attempt before the member lock is taken.
  perform private.expire_stale_payment(p_member_id, v_gym_id, 'session');

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for no key update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  if v_settled_at is null then
    raise exception 'registration_fee_not_settled: member % has not settled the registration fee', p_member_id;
  end if;

  select pl.plan_type, pl.price, pl.currency
    into v_plan_type, v_price, v_currency
  from subscriptions s
  join plans pl on pl.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if not found or v_plan_type is distinct from 'pay_per_session' then
    raise exception 'plan_not_per_session: member % is not on a pay-per-session plan', p_member_id;
  end if;

  if coalesce(v_price, 0) <= 0 then
    raise exception 'session_price_not_set: the pay-per-session plan has no price';
  end if;

  if exists (
    select 1 from payments p
    where p.member_id = p_member_id
      and p.gym_id = v_gym_id
      and p.purpose = 'session'
      and p.voided_at is null
      and p.status in ('pending', 'processing')
  ) then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', p_member_id;
  end if;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason, purpose)
  values (v_gym_id, p_member_id, null, v_price, v_currency, p_method, 'verified', v_actor_id, v_reason, 'session')
  returning id into v_payment_id;

  v_session := private.create_guest_session_for_payment(v_payment_id, p_member_id, v_gym_id);

  perform log_audit_event(
    p_action_type => 'session_payment_recorded',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'amount', v_price, 'currency', v_currency, 'method', p_method,
      'reason', v_reason, 'payment_id', v_payment_id, 'guest_session_id', v_session.id
    )
  );

  return v_session;
end;
$$;

revoke execute on function record_session_payment(uuid, text, text) from public, anon;
grant execute on function record_session_payment(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0098/0100's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not (select p.prosecdef from pg_proc p
          where p.oid = 'public.record_session_payment(uuid, text, text)'::regprocedure) then
    raise exception '0108: record_session_payment must be SECURITY DEFINER';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.expire_stale_payment(uuid, uuid, text)'::regprocedure,
                    'private.expire_stale_registration_fee_payment(uuid, uuid)'::regprocedure,
                    'private.create_guest_session_for_payment(uuid, uuid, uuid)'::regprocedure)
      and p.prosecdef
  ) then
    raise exception '0108: the private session and expiry helpers must stay SECURITY INVOKER';
  end if;

  -- A NULL proacl is the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.expire_stale_payment(uuid, uuid, text)'::regprocedure,
                    'private.expire_stale_registration_fee_payment(uuid, uuid)'::regprocedure,
                    'private.create_guest_session_for_payment(uuid, uuid, uuid)'::regprocedure,
                    'public.record_session_payment(uuid, text, text)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
        or exists (
          select 1 from aclexplode(p.proacl) a
          where a.privilege_type = 'EXECUTE'
            and a.grantee in (select oid from pg_roles where rolname = 'anon')
        )
      )
  ) then
    raise exception '0108: EXECUTE on the session payment functions must not be granted to PUBLIC or anon';
  end if;

  if not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.record_session_payment(uuid, text, text)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee = (select oid from pg_roles where rolname = 'authenticated')
  ) then
    raise exception '0108: record_session_payment must be executable by authenticated';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.record_session_payment(uuid, text, text)'::regprocedure
      and not (p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''')
  ) then
    raise exception '0108: record_session_payment must carry the fail-closed suspension guard';
  end if;

  -- Expiry flag before the member lock (payment rows first, member row second).
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.record_session_payment(uuid, text, text)'::regprocedure
      and (position('expire_stale_payment' in p.prosrc) = 0
           or position('expire_stale_payment' in p.prosrc) > position('for no key update' in p.prosrc))
  ) then
    raise exception '0108: the expiry flag must run before the member row lock';
  end if;

  -- The fee helper still delegates.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'private.expire_stale_registration_fee_payment(uuid, uuid)'::regprocedure
      and p.prosrc like '%expire_stale_payment%'
  ) then
    raise exception '0108: the fee expiry helper must delegate to expire_stale_payment';
  end if;
end;
$verify$;
