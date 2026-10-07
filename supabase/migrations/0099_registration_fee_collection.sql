-- ============================================================================
-- 0099: Registration fee collection and waiver (Epic 18, Story 18.2).
--
-- Story 18.1 left an awaiting member with no way out. This migration adds the
-- two ways out, database-only (the screens are Story 18.6):
--
--   record_registration_fee(member, method, reason)  staff collect the fee
--   waive_registration_fee(member, reason)           staff waive it
--
-- Both settle the member (members.registration_fee_settled_at = now()), and
-- both are SECURITY DEFINER so they can write the column that
-- protect_registration_fee_settled_at (0098) pins against direct client
-- writes. Supporting schema:
--
--   payments.purpose    'subscription' (default, every existing row) or
--                       'registration_fee'.
--   payments.voided_at  NULL = counts. Nothing sets it yet; the void RPC is
--                       Story 18.4. It exists now so the one-fee-per-member
--                       index below is final and 18.4 needs no index change.
--
-- Design choices worth knowing before editing this file:
--
--  * The fee amount is never a parameter. record_registration_fee reads
--    gyms.registration_fee itself, so a client cannot pick the amount.
--
--  * Fee rows cannot be created through RLS. The staff insert policy
--    gym_staff_insert_own_payments (latest: 0093) gains `purpose =
--    'subscription'`; its existing clauses are kept verbatim. The only way to
--    create a fee row is record_registration_fee (and 18.3's Tara path).
--
--  * payments.voided_at and payments.purpose are pinned against direct client
--    writes by their own BEFORE UPDATE OF trigger, SECURITY INVOKER, keyed on
--    current_user -- the 0098 style. It is NOT an edit of
--    protect_payment_columns_on_staff_verify (0031): that one is pending-only,
--    keyed on the JWT, and omits supervisor, so extending it would leave a
--    verified row and a supervisor session unpinned. The trigger function must
--    stay INVOKER: under DEFINER current_user is always the owner and the pin
--    never fires.
--
--  * Fee payments send no push notification. payments_notify_status_change
--    (0046) is dropped and recreated with `NEW.purpose = 'subscription'` in
--    its WHEN. The function body is untouched. A member who owes the fee has
--    no member-app access to be told anything in (Story 18.7 shows the receipt
--    there instead).
--
--  * One non-voided fee payment per member, enforced by a partial unique
--    index. A `flagged` fee payment (a failed Tara attempt, Story 18.3) does
--    not count, so the fee can be collected again. The RPC checks first for a
--    clean error and still maps a unique_violation from a concurrent call.
--
--  * Lowering the fee to 0 does NOT release awaiting members, and
--    set_registration_fee is unchanged. waive_registration_fee works on any
--    awaiting member whatever the gym's current fee, 0 included, and is the
--    way out. record_registration_fee at fee 0 raises
--    registration_fee_not_configured.
--
--  * Neither RPC body may mention the write statements the suspension
--    coverage test scans for before its own status guard, even in comments.
-- ============================================================================

alter table payments
  add column purpose text not null default 'subscription'
    constraint payments_purpose_check check (purpose in ('subscription', 'registration_fee')),
  add column voided_at timestamptz;

-- One non-voided, non-flagged registration fee payment per member.
create unique index payments_one_registration_fee_per_member
  on payments (member_id)
  where purpose = 'registration_fee' and voided_at is null and status <> 'flagged';

-- ----------------------------------------------------------------------------
-- Staff insert policy: 0093's definition verbatim, plus the purpose clause and
-- `voided_at is null` (the update pin never fires on INSERT, so a staff insert
-- could otherwise create an already-voided row).
-- ----------------------------------------------------------------------------
alter policy "gym_staff_insert_own_payments" on public.payments
  with check (((gym_id = private.gym_id()) AND (status = ANY (ARRAY['pending'::payment_status, 'processing'::payment_status])) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) AND (purpose = 'subscription'::text) AND (voided_at IS NULL)))
;

-- ----------------------------------------------------------------------------
-- BEFORE UPDATE OF voided_at, purpose on payments: pin against direct client
-- writes. SECURITY INVOKER on purpose -- see the header.
-- ----------------------------------------------------------------------------
create function private.protect_payment_purpose_and_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.voided_at := old.voided_at;
    new.purpose := old.purpose;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_payment_purpose_and_void() from public;

create trigger protect_payment_purpose_and_void
  before update of voided_at, purpose on payments
  for each row execute function private.protect_payment_purpose_and_void();

-- ----------------------------------------------------------------------------
-- Notification trigger: skip fee payments. 0046's definition plus the purpose
-- condition; dropped and created after the column exists.
-- ----------------------------------------------------------------------------
drop trigger payments_notify_status_change on payments;

create trigger payments_notify_status_change
  after insert or update on payments
  for each row
  when (NEW.status in ('verified', 'flagged') and NEW.purpose = 'subscription')
  execute function private.notify_payment_status_change();

-- ----------------------------------------------------------------------------
-- record_registration_fee(): collect the fee from an awaiting member.
-- Owner, manager, supervisor or receptionist, own gym only (from the
-- JWT-derived private.gym_id(), never an argument). Suspension-gated with the
-- fail-closed `is distinct from` form before any write. Returns the new
-- payment id.
--
-- Check order after the member row is locked: not found (other gym, or not
-- role 'member'), deactivated, an existing fee payment (already recorded),
-- already settled (not due, e.g. waived), fee 0 (not configured).
-- ----------------------------------------------------------------------------
create function record_registration_fee(p_member_id uuid, p_method text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_fee integer;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_reason text;
  v_payment_id uuid;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'record_registration_fee: gym % is not active', v_gym_id;
  end if;

  v_actor_id := auth.uid();

  if p_method is null or p_method not in ('cash', 'bank_transfer', 'manual_momo') then
    raise exception 'record_registration_fee: invalid_method';
  end if;

  v_reason := btrim(p_reason);
  if v_reason is null or v_reason = '' then
    raise exception 'record_registration_fee: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'record_registration_fee: reason is too long';
  end if;

  -- The row lock serializes two concurrent calls for the same member.
  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  if exists (
    select 1 from payments p
    where p.member_id = p_member_id
      and p.purpose = 'registration_fee'
      and p.voided_at is null
      and p.status <> 'flagged'
  ) then
    raise exception 'registration_fee_already_recorded: member % already has a registration fee payment', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  select g.registration_fee into v_fee from gyms g where g.id = v_gym_id;

  if coalesce(v_fee, 0) <= 0 then
    raise exception 'registration_fee_not_configured: gym % charges no registration fee', v_gym_id;
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason, purpose)
    values (v_gym_id, p_member_id, null, v_fee, 'XAF', p_method, 'verified', v_actor_id, v_reason, 'registration_fee')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'registration_fee_already_recorded: member % already has a registration fee payment', p_member_id;
  end;

  update members set registration_fee_settled_at = now()
  where id = p_member_id and registration_fee_settled_at is null;

  perform log_audit_event(
    p_action_type => 'registration_fee_recorded',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'amount', v_fee, 'currency', 'XAF', 'method', p_method,
      'reason', v_reason, 'payment_id', v_payment_id
    )
  );

  return v_payment_id;
end;
$$;

revoke execute on function record_registration_fee(uuid, text, text) from public;
grant execute on function record_registration_fee(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- waive_registration_fee(): settle an awaiting member without a payment.
-- Owner, supervisor or manager. Works on any awaiting member whatever the
-- gym's current fee (0 included). Writes no payment row, and is not undoable.
-- ----------------------------------------------------------------------------
create function waive_registration_fee(p_member_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_reason text;
begin
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['owner', 'supervisor', 'manager']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'waive_registration_fee: gym % is not active', v_gym_id;
  end if;

  v_reason := btrim(p_reason);
  if v_reason is null or v_reason = '' then
    raise exception 'waive_registration_fee: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'waive_registration_fee: reason is too long';
  end if;

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  update members set registration_fee_settled_at = now()
  where id = p_member_id and registration_fee_settled_at is null;

  perform log_audit_event(
    p_action_type => 'registration_fee_waived',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('reason', v_reason)
  );
end;
$$;

revoke execute on function waive_registration_fee(uuid, text) from public;
grant execute on function waive_registration_fee(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0093/0094/0095/0098's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'purpose'
      and is_nullable = 'NO' and column_default like '''subscription''%'
  ) then
    raise exception '0099: payments.purpose must be NOT NULL default ''subscription''';
  end if;

  if exists (select 1 from payments where purpose is distinct from 'subscription') then
    raise exception '0099: a pre-existing payments row did not take purpose ''subscription''';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'voided_at'
  ) then
    raise exception '0099: payments.voided_at was not created';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payments_purpose_check' and contype = 'c') then
    raise exception '0099: payments_purpose_check was not created';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'payments_one_registration_fee_per_member'
      and indexdef like 'CREATE UNIQUE INDEX%'
      and indexdef like '%voided_at IS NULL%'
  ) then
    raise exception '0099: payments_one_registration_fee_per_member must be a partial unique index';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'gym_staff_insert_own_payments'
      and with_check like '%purpose = ''subscription''%'
      and with_check like '%voided_at IS NULL%'
      and with_check like '%supervisor%'
  ) then
    raise exception '0099: gym_staff_insert_own_payments must require purpose = subscription and voided_at is null, and still name supervisor';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'payments' and t.tgname = 'protect_payment_purpose_and_void' and not t.tgisinternal
  ) then
    raise exception '0099: protect_payment_purpose_and_void trigger was not created';
  end if;

  -- The pin keys on current_user; a DEFINER function would always see the
  -- owner and never pin.
  if (select p.prosecdef from pg_proc p where p.oid = 'private.protect_payment_purpose_and_void()'::regprocedure) then
    raise exception '0099: private.protect_payment_purpose_and_void() must be SECURITY INVOKER -- current_user would be the owner under DEFINER and the pin would never fire';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'payments' and t.tgname = 'payments_notify_status_change' and not t.tgisinternal
      and pg_get_triggerdef(t.oid) like '%purpose%subscription%'
  ) then
    raise exception '0099: payments_notify_status_change must skip non-subscription payments';
  end if;

  if not (select bool_and(p.prosecdef) from pg_proc p
          where p.oid in ('public.record_registration_fee(uuid, text, text)'::regprocedure,
                          'public.waive_registration_fee(uuid, text)'::regprocedure)) then
    raise exception '0099: record_registration_fee() and waive_registration_fee() must be SECURITY DEFINER';
  end if;

  -- A NULL proacl is the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.protect_payment_purpose_and_void()'::regprocedure,
                    'public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0099: EXECUTE on the registration-fee collection functions must not be granted to PUBLIC';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure)
      and not (p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''')
  ) then
    raise exception '0099: both registration-fee RPCs must carry the fail-closed suspension guard';
  end if;

  -- Whoever names manager names supervisor too (0093's rule).
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure)
      and p.prosrc like '%''manager''%'
      and p.prosrc not like '%''supervisor''%'
  ) then
    raise exception '0099: a role gate that names manager must name supervisor too';
  end if;
end;
$verify$;
