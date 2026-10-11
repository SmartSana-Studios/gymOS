-- ============================================================================
-- 0113: Session refunds & revenue line (Epic 19, Story 19.8).
--
--   private.on_session_refunded_after_consumption()  no-op hook, Epic 20 fills it
--   private.apply_session_refund()                    AFTER INSERT trigger on refunds:
--                                                     a full refund voids an unused
--                                                     session; a partial refund or a
--                                                     consumed session is kept
--   private.audit_session_consumed()                  AFTER UPDATE trigger on guest_sessions
--   private.audit_session_attempt_blocked()           AFTER INSERT trigger on session_attempts
--   gym_revenue_mtd()                                 same signature/ACL; excludes session
--                                                     payments and refunds of them
--   gym_session_revenue_mtd()                         net session figure, month to date
--
-- Lock order in the refund trigger follows the epic's canonical order: the
-- member row (FOR NO KEY UPDATE) is taken before the guest_sessions row
-- (FOR UPDATE), the same order consume_guest_session() uses. Whichever of a
-- refund and a consumption takes the member lock first wins; the loser then
-- reads the winner's committed state (READ COMMITTED), so a session is never
-- both voided and consumed.
--
-- Audit lives in triggers so every writer (check_in online/sync, class
-- attendance, service_role refunds) is covered without rewriting 0111/0112.
--
-- Rollback: scripts/rollback-0113-session-refunds-revenue-line.sql
-- ============================================================================

-- 1. Hook ---------------------------------------------------------------------

-- No-op today; Epic 20 reverses the loyalty stamp here.
create function private.on_session_refunded_after_consumption(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  null;
end;
$$;

revoke execute on function private.on_session_refunded_after_consumption(uuid, uuid, uuid) from public, anon, authenticated;

-- 2. Refund trigger -------------------------------------------------------------

create function private.apply_session_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purpose text;
  v_member_id uuid;
  v_payment_amount integer;
  v_session_id uuid;
  v_consumed_at timestamptz;
  v_voided_at timestamptz;
  v_outcome text;
begin
  select p.purpose, p.member_id, p.amount
  into v_purpose, v_member_id, v_payment_amount
  from payments p
  where p.id = new.payment_id;

  if not found or v_purpose is distinct from 'session' then
    return new;
  end if;

  -- Canonical order: member lock first, then the session row.
  perform 1 from members m where m.id = v_member_id for no key update;

  select s.id, s.consumed_at, s.voided_at
  into v_session_id, v_consumed_at, v_voided_at
  from guest_sessions s
  where s.payment_id = new.payment_id
  for update;

  if v_session_id is null then
    return new;
  end if;

  if v_consumed_at is not null then
    v_outcome := 'kept_consumed';
    perform private.on_session_refunded_after_consumption(v_session_id, v_member_id, new.gym_id);
  elsif new.amount = v_payment_amount then
    if v_voided_at is null then
      update guest_sessions set voided_at = now() where id = v_session_id;
    end if;
    v_outcome := 'voided';
  else
    v_outcome := 'kept_partial';
  end if;

  perform log_audit_event(
    p_action_type => 'session_refund_applied',
    p_gym_id => new.gym_id,
    p_target_entity_id => v_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'outcome', v_outcome,
      'refund_id', new.id,
      'payment_id', new.payment_id,
      'guest_session_id', v_session_id,
      'refund_amount', new.amount,
      'payment_amount', v_payment_amount
    )
  );

  return new;
end;
$$;

revoke execute on function private.apply_session_refund() from public, anon, authenticated;

create trigger apply_session_refund
  after insert on refunds
  for each row execute function private.apply_session_refund();

-- 3. Consumption and blocked-attempt audit ---------------------------------------

create function private.audit_session_consumed()
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

create trigger audit_session_consumed
  after update on guest_sessions
  for each row
  when (old.consumed_at is null and new.consumed_at is not null)
  execute function private.audit_session_consumed();

create function private.audit_session_attempt_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_audit_event(
    p_action_type => 'session_attempt_blocked',
    p_gym_id => new.gym_id,
    p_target_entity_id => new.member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'attempt_id', new.id,
      'scan_id', new.scan_id,
      'source', new.source,
      'class_session_id', new.class_session_id,
      'scanned_at', new.scanned_at
    )
  );
  return new;
end;
$$;

revoke execute on function private.audit_session_attempt_blocked() from public, anon, authenticated;

create trigger audit_session_attempt_blocked
  after insert on session_attempts
  for each row execute function private.audit_session_attempt_blocked();

-- 4. Revenue ---------------------------------------------------------------------

-- 0101's body with session payments (and refunds of them) taken out; they
-- move to gym_session_revenue_mtd(). Same signature, so the ACL is kept
-- (re-stated below).
create or replace function gym_revenue_mtd()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(p.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, payments p
      where g.id = private.gym_id()
        and p.gym_id = g.id
        and p.purpose <> 'session'
        and p.status = 'verified'
        and p.voided_at is null
        and p.created_at >= b.month_start
        and p.created_at <  b.next_month_start
    ), 0)
    -
    coalesce((
      select sum(r.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, refunds r
      join payments rp on rp.id = r.payment_id
      where g.id = private.gym_id()
        and r.gym_id = g.id
        and rp.purpose <> 'session'
        and r.created_at >= b.month_start
        and r.created_at <  b.next_month_start
    ), 0);
$$;

revoke execute on function gym_revenue_mtd from public, anon;
grant execute on function gym_revenue_mtd to authenticated;

-- Net session money in the same window. Voided payments are excluded; refunds
-- of session payments subtract by refund date, as in gym_revenue_mtd().
create function gym_session_revenue_mtd()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(p.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, payments p
      where g.id = private.gym_id()
        and p.gym_id = g.id
        and p.purpose = 'session'
        and p.status = 'verified'
        and p.voided_at is null
        and p.created_at >= b.month_start
        and p.created_at <  b.next_month_start
    ), 0)
    -
    coalesce((
      select sum(r.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, refunds r
      join payments rp on rp.id = r.payment_id
      where g.id = private.gym_id()
        and r.gym_id = g.id
        and rp.purpose = 'session'
        and r.created_at >= b.month_start
        and r.created_at <  b.next_month_start
    ), 0);
$$;

revoke execute on function gym_session_revenue_mtd from public, anon;
grant execute on function gym_session_revenue_mtd to authenticated;

-- 5. Self-check -----------------------------------------------------------------

do $verify$
begin
  if to_regprocedure('private.on_session_refunded_after_consumption(uuid, uuid, uuid)') is null then
    raise exception '0113: on_session_refunded_after_consumption hook missing';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = 'private.apply_session_refund()'::regprocedure) then
    raise exception '0113: apply_session_refund() must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'refunds' and t.tgname = 'apply_session_refund' and not t.tgisinternal
  ) then
    raise exception '0113: apply_session_refund trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'guest_sessions' and t.tgname = 'audit_session_consumed' and not t.tgisinternal
  ) or not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'session_attempts' and t.tgname = 'audit_session_attempt_blocked' and not t.tgisinternal
  ) then
    raise exception '0113: audit triggers missing';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_revenue_mtd()'::regprocedure,
                    'public.gym_session_revenue_mtd()'::regprocedure,
                    'private.apply_session_refund()'::regprocedure,
                    'private.audit_session_consumed()'::regprocedure,
                    'private.audit_session_attempt_blocked()'::regprocedure,
                    'private.on_session_refunded_after_consumption(uuid, uuid, uuid)'::regprocedure)
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0113: EXECUTE must not be granted to PUBLIC';
  end if;

  if has_function_privilege('anon', 'public.gym_session_revenue_mtd()', 'execute') then
    raise exception '0113: anon can execute gym_session_revenue_mtd()';
  end if;

  if not has_function_privilege('authenticated', 'public.gym_revenue_mtd()', 'execute')
    or not has_function_privilege('authenticated', 'public.gym_session_revenue_mtd()', 'execute') then
    raise exception '0113: authenticated lost EXECUTE on a revenue function';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_revenue_mtd()'::regprocedure, 'public.gym_session_revenue_mtd()'::regprocedure)
      and (p.prosecdef
           or p.prosrc not like '%private.gym_local_month_bounds(%'
           or p.prosrc not like '%voided_at is null%')
  ) then
    raise exception '0113: revenue functions must be SECURITY INVOKER, use gym_local_month_bounds and exclude voided payments';
  end if;

  if (select p.prosrc not like '%purpose <> ''session''%'
      from pg_proc p where p.oid = 'public.gym_revenue_mtd()'::regprocedure) then
    raise exception '0113: gym_revenue_mtd() must exclude session payments';
  end if;
end;
$verify$;
