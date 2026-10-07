-- ============================================================================
-- 0101: Registration fee void, refund block and revenue line (Epic 18,
-- Story 18.4). Database only; the void screens are Story 18.6.
--
--   void_registration_fee_payment(payment, reason)  a correction for a fee
--                                                   recorded in error
--   refunds insert policy + BEFORE INSERT trigger   no refund of a fee or of a
--                                                   voided payment
--   gym_revenue_mtd()                               skips voided payments
--   gym_registration_fee_revenue_mtd()              the "of which registration
--                                                   fees" figure
--
-- Design choices worth knowing before editing this file:
--
--  * A void is a correction, never a refund and never a delete. The payment
--    row is kept with voided_at set; the member goes back to awaiting. The
--    0099 unique index ignores a voided row, so the fee can be collected again.
--    voided_at is written by this DEFINER function as the table owner:
--    protect_payment_purpose_and_void (0099) only pins authenticated/anon, so
--    that trigger is not edited here.
--
--  * Who and when: owner or supervisor only (a manager may waive but not void),
--    manual payments only (a Tara fee is corrected outside the platform), and
--    only while the member has no subscription of any status -- voiding the fee
--    of a member who already has a plan would leave an awaiting member holding
--    a subscription.
--
--  * Lock order is payment row first, member row second, as in every function
--    touching both (0100).
--
--  * Refunds of fee payments are blocked in the data layer twice. The staff
--    insert policy gains a purpose / voided clause, and a BEFORE INSERT trigger
--    raises a named error for every writer, service_role included. The trigger
--    function is SECURITY DEFINER so the payment is visible whatever the
--    caller's RLS (a policy hiding the row would make the gate fail open, the
--    0098 gate style); it writes nothing. It checks "voided" before "fee":
--    today only a fee payment can be voided, so the other order would leave
--    payment_voided_not_refundable unreachable.
--
--  * Both revenue functions stay SECURITY INVOKER, so RLS and the suspension
--    gate keep applying (0095's reasoning). The month window comes from
--    private.gym_local_month_bounds only; never inline that arithmetic.
--    gym_revenue_mtd() keeps verified fee payments in its total: a registration
--    fee is money taken. Only voided rows leave it.
--
--  * The void RPC body may not mention the write statements the suspension
--    coverage test scans for before its own status guard, even in comments.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- void_registration_fee_payment(): owner or supervisor, own gym only (from the
-- JWT-derived private.gym_id(), never an argument). Suspension-gated with the
-- fail-closed `is distinct from` form before any write.
--
-- Check order after the payment row is locked: not voidable (other gym, not a
-- fee, not verified, already voided -> not_found), Tara fee, then (member row
-- locked) member has a subscription.
-- ----------------------------------------------------------------------------
create function void_registration_fee_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_reason text;
  v_member_id uuid;
  v_amount integer;
  v_method text;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['owner', 'supervisor']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'void_registration_fee_payment: gym % is not active', v_gym_id;
  end if;

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or v_reason = '' then
    raise exception 'void_registration_fee_payment: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'void_registration_fee_payment: reason is too long';
  end if;

  select p.member_id, p.amount, p.method
    into v_member_id, v_amount, v_method
  from payments p
  where p.id = p_payment_id
    and p.gym_id = v_gym_id
    and p.purpose = 'registration_fee'
    and p.status = 'verified'
    and p.voided_at is null
  for update;

  if not found then
    raise exception 'not_found: payment % not found', p_payment_id;
  end if;

  if v_method = 'mobile_money' then
    raise exception 'tara_fee_cannot_be_voided: payment % was collected through Tara Money', p_payment_id;
  end if;

  perform 1 from members m where m.id = v_member_id for update;

  if exists (select 1 from subscriptions s where s.member_id = v_member_id) then
    raise exception 'member_already_has_subscription: member % already has a subscription', v_member_id;
  end if;

  update payments set voided_at = now() where id = p_payment_id;

  update members set registration_fee_settled_at = null where id = v_member_id;

  perform log_audit_event(
    p_action_type => 'registration_fee_voided',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'payment_id', p_payment_id, 'amount', v_amount,
      'method', v_method, 'reason', v_reason
    )
  );
end;
$$;

revoke execute on function void_registration_fee_payment(uuid, text) from public;
grant execute on function void_registration_fee_payment(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Refund block, RLS side: 0093's manager_or_owner_insert_own_refunds verbatim,
-- plus the purpose / voided clause inside its `exists`.
-- ----------------------------------------------------------------------------
alter policy "manager_or_owner_insert_own_refunds" on public.refunds
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text])) AND (EXISTS ( SELECT 1
   FROM payments p
  WHERE ((p.id = refunds.payment_id) AND (p.gym_id = refunds.gym_id) AND (p.status = 'verified'::payment_status) AND (p.purpose <> 'registration_fee'::text) AND (p.voided_at IS NULL) AND (refunds.amount <= p.amount))))))
;

-- ----------------------------------------------------------------------------
-- Refund block, trigger side: covers every writer, including service_role.
-- A missing payment is left to the foreign key.
-- ----------------------------------------------------------------------------
create function private.block_fee_and_voided_refunds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purpose text;
  v_voided_at timestamptz;
begin
  select p.purpose, p.voided_at into v_purpose, v_voided_at
  from payments p
  where p.id = new.payment_id;

  if not found then
    return new;
  end if;

  if v_voided_at is not null then
    raise exception 'payment_voided_not_refundable: payment % was voided and cannot be refunded', new.payment_id
      using errcode = 'check_violation';
  end if;

  if v_purpose = 'registration_fee' then
    raise exception 'registration_fee_not_refundable: payment % is a registration fee, which is not refundable', new.payment_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function private.block_fee_and_voided_refunds() from public;

create trigger block_fee_and_voided_refunds
  before insert on refunds
  for each row execute function private.block_fee_and_voided_refunds();

-- ----------------------------------------------------------------------------
-- gym_revenue_mtd(): 0095's body plus `p.voided_at is null`. Same signature,
-- so the ACL is kept (re-stated below).
-- ----------------------------------------------------------------------------
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
        and p.status = 'verified'
        and p.voided_at is null
        and p.created_at >= b.month_start
        and p.created_at <  b.next_month_start
    ), 0)
    -
    coalesce((
      select sum(r.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, refunds r
      where g.id = private.gym_id()
        and r.gym_id = g.id
        and r.created_at >= b.month_start
        and r.created_at <  b.next_month_start
    ), 0);
$$;

revoke execute on function gym_revenue_mtd from public;
grant execute on function gym_revenue_mtd to authenticated;

-- ----------------------------------------------------------------------------
-- gym_registration_fee_revenue_mtd(): the registration-fee part of the same
-- window. Verified, non-voided fee payments only.
-- ----------------------------------------------------------------------------
create function gym_registration_fee_revenue_mtd()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(p.amount)
    from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, payments p
    where g.id = private.gym_id()
      and p.gym_id = g.id
      and p.purpose = 'registration_fee'
      and p.status = 'verified'
      and p.voided_at is null
      and p.created_at >= b.month_start
      and p.created_at <  b.next_month_start
  ), 0);
$$;

revoke execute on function gym_registration_fee_revenue_mtd from public;
grant execute on function gym_registration_fee_revenue_mtd to authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0093/0095/0098/0099's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not (select p.prosecdef from pg_proc p
          where p.oid = 'public.void_registration_fee_payment(uuid, text)'::regprocedure) then
    raise exception '0101: void_registration_fee_payment() must be SECURITY DEFINER';
  end if;

  if not (select p.prosecdef from pg_proc p
          where p.oid = 'private.block_fee_and_voided_refunds()'::regprocedure) then
    raise exception '0101: private.block_fee_and_voided_refunds() must be SECURITY DEFINER -- an invoker read of payments could be hidden by RLS and the block would fail open';
  end if;

  -- A NULL proacl is the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.void_registration_fee_payment(uuid, text)'::regprocedure,
                    'private.block_fee_and_voided_refunds()'::regprocedure,
                    'public.gym_revenue_mtd()'::regprocedure,
                    'public.gym_registration_fee_revenue_mtd()'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0101: EXECUTE on the void, refund-block and revenue functions must not be granted to PUBLIC';
  end if;

  if not (select p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
          from pg_proc p where p.oid = 'public.void_registration_fee_payment(uuid, text)'::regprocedure) then
    raise exception '0101: void_registration_fee_payment() must carry the fail-closed suspension guard';
  end if;

  if (select p.prosrc like '%''manager''%' or p.prosrc like '%''receptionist''%'
      from pg_proc p where p.oid = 'public.void_registration_fee_payment(uuid, text)'::regprocedure) then
    raise exception '0101: void_registration_fee_payment() is owner/supervisor only and must not name manager or receptionist';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_revenue_mtd()'::regprocedure,
                    'public.gym_registration_fee_revenue_mtd()'::regprocedure)
      and p.prosecdef
  ) then
    raise exception '0101: the revenue functions must be SECURITY INVOKER -- DEFINER rights would bypass the payments/refunds RLS they rely on';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_revenue_mtd()'::regprocedure,
                    'public.gym_registration_fee_revenue_mtd()'::regprocedure)
      and (p.prosrc not like '%private.gym_local_month_bounds(%'
           or p.prosrc not like '%voided_at is null%')
  ) then
    raise exception '0101: both revenue functions must take their window from private.gym_local_month_bounds() and exclude voided payments';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'refunds' and policyname = 'manager_or_owner_insert_own_refunds'
      and with_check like '%purpose <> ''registration_fee''%'
      and with_check like '%voided_at IS NULL%'
      and with_check like '%supervisor%'
  ) then
    raise exception '0101: manager_or_owner_insert_own_refunds must exclude fee and voided payments and still name supervisor';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'refunds' and t.tgname = 'block_fee_and_voided_refunds' and not t.tgisinternal
  ) then
    raise exception '0101: block_fee_and_voided_refunds trigger was not created';
  end if;

  if (select row(b.month_start, b.next_month_start)
      from private.gym_local_month_bounds('Africa/Douala', '2026-03-15 12:00+00') b)
     is distinct from row('2026-02-28 23:00+00'::timestamptz, '2026-03-31 23:00+00'::timestamptz) then
    raise exception '0101: private.gym_local_month_bounds() must still place March 2026 in Africa/Douala at [2026-02-28 23:00+00, 2026-03-31 23:00+00)';
  end if;
end;
$verify$;
