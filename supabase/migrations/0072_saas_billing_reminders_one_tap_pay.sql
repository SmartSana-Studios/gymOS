-- Story 11.3: Payment-Due Reminders & One-Tap Pay. Closes the two gaps
-- Story 11.2's own Dev Notes explicitly left open:
--   1. complete_verified_saas_billing_payment() (0069) has no side effect on
--      `gyms` today -- a verified Flow B payment just flips the payment row,
--      it never resets the billing clock it was paying off.
--   2. Nothing yet creates a saas_billing_payments row on any trigger --
--      this migration adds initiate_saas_billing_payment(), the Owner's own
--      "Pay Now" entry point (Task 6, apps/dashboard).
-- Also adds the missing Owner-self-write path for a notification email
-- (members.email already exists, FR-020 -- no RLS/RPC lets an Owner touch
-- their own row today) and saas_billing_notices, the Node-runtime-written
-- audit trail for Task 4's reminder job.

-- ----------------------------------------------------------------------------
-- complete_verified_saas_billing_payment(): extended, not replaced in shape.
-- The existing `where status = 'processing'` UPDATE is still the sole
-- idempotency guard -- `returning gym_id into v_gym_id` on that same
-- statement lets us read `found` immediately after it and only touch `gyms`
-- when this call actually transitioned the row (a replayed webhook on an
-- already-verified payment is a 0-row no-op, so the anchor date is never
-- advanced twice for one real payment).
--
-- The reset advances saas_billing_anchor_date forward one full cycle from
-- its own current value (never `current_date + interval`), mirroring how a
-- subscription renewal computes its next expiry off the old expiry -- a
-- late payment doesn't get a full fresh cycle stacked on top of the days
-- already elapsed as `past_due`/`grace_period`.
--
-- `and status <> 'deactivated'` on the reset UPDATE mirrors
-- run_saas_billing_lifecycle_job()'s own identical guard on the suspend
-- transition (0071) -- applied symmetrically here at the WHERE-clause level
-- (not a per-column CASE) so a gym a Super Admin separately deactivated has
-- none of saas_billing_status/status/saas_billing_anchor_date silently
-- reset by an incoming payment either; that is a distinct admin action this
-- billing clock must not overwrite in either direction.
-- ----------------------------------------------------------------------------
create or replace function complete_verified_saas_billing_payment(p_payment_id uuid, p_fee_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_interval billing_interval;
begin
  update saas_billing_payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing'
  returning gym_id into v_gym_id;

  if not found then
    raise notice 'complete_verified_saas_billing_payment: payment % already verified or not found -- no-op', p_payment_id;
    return;
  end if;

  select saas_billing_interval into v_interval from gyms where id = v_gym_id;

  -- See private.protect_super_admin_only_gym_columns() below for why this
  -- bypass is required -- this RPC runs from payment-webhook's service-role
  -- client, with no JWT/session context, so private.is_super_admin() reads
  -- false and the trigger would otherwise silently pin this write back.
  perform set_config('app.saas_billing_payment_reset_bypass', 'true', true);

  update gyms
  set saas_billing_status = 'active',
      status = 'active',
      saas_billing_anchor_date = saas_billing_anchor_date
        + (case v_interval when 'annual' then interval '1 year' else interval '1 month' end)
  where id = v_gym_id
    and status <> 'deactivated';

  perform set_config('app.saas_billing_payment_reset_bypass', 'false', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Second, separately-named bypass GUC. `app.saas_billing_lifecycle_job_bypass`
-- (0071) exempts exactly `status`/`saas_billing_status` for
-- run_saas_billing_lifecycle_job()'s own writes. This story's
-- `app.saas_billing_payment_reset_bypass` is a distinct GUC (not a reuse of
-- the lifecycle job's) exempting `status`/`saas_billing_status`/
-- `saas_billing_anchor_date` -- one extra column, since the payment-reset
-- path is the only writer that ever needs to advance the anchor date
-- outside of a super_admin session. Keeping each system writer's bypass
-- independently named/scoped keeps each one independently provable in
-- pgTAP, matching this trigger's own established "narrow to exactly what
-- this specific write touches" discipline, applied per-caller rather than
-- widening a shared bypass.
-- `saas_billing_interval`/`saas_grace_period_days` are never written by
-- either system caller, so they stay unconditionally pinned back for any
-- non-super_admin session regardless of either bypass -- unchanged from
-- 0071.
-- ----------------------------------------------------------------------------
create or replace function private.protect_super_admin_only_gym_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  if not private.is_super_admin() then
    new.tier_id := old.tier_id;
    new.member_cap_override := old.member_cap_override;

    if coalesce(current_setting('app.saas_billing_lifecycle_job_bypass', true), 'false') <> 'true'
       and coalesce(current_setting('app.saas_billing_payment_reset_bypass', true), 'false') <> 'true' then
      new.status := old.status;
      new.saas_billing_status := old.saas_billing_status;
    end if;

    if coalesce(current_setting('app.saas_billing_payment_reset_bypass', true), 'false') <> 'true' then
      new.saas_billing_anchor_date := old.saas_billing_anchor_date;
    end if;

    new.saas_billing_interval := old.saas_billing_interval;
    new.saas_grace_period_days := old.saas_grace_period_days;
  end if;
  return new;
end;
$$;

-- deferred-work.md-flagged guard, this story's to add: money columns must
-- never go negative. amount=0 is legitimate (Free/Test tier, price_locked)
-- so this is `>= 0`, not `> 0`.
alter table saas_billing_payments add constraint saas_billing_payments_amount_nonneg
  check (amount >= 0 and (provider_fee_amount is null or provider_fee_amount >= 0));

-- ----------------------------------------------------------------------------
-- initiate_saas_billing_payment(): the Flow B analog of initiate_member_payment()
-- (0055) -- saas_billing_payments has exactly one RLS policy (Super-Admin
-- SELECT-only), so a SECURITY DEFINER RPC is the only way an Owner's own
-- session can get a `processing` row into existence. Self-scoping via
-- private.gym_id()/private.current_member_role() only -- never a
-- client-supplied gym id, and the client never supplies `amount` either
-- (server-derived from the gym's own tier + saas_billing_interval, live at
-- call time -- a live join, not a cached price, is what makes this
-- no-proration by construction, mirroring Story 11.2's own Task 3
-- reasoning for changeGymTier()).
--
-- Uses `is distinct from` (NULL-safe), not initiate_member_payment()'s own
-- plain `<>` -- a caller with no resolvable member row would otherwise make
-- `private.current_member_role() <> 'owner'` evaluate to NULL (falsy),
-- silently skipping the permission check instead of denying. This is the
-- same NULL-unsafe bug class already flagged in deferred-work.md for
-- create_staff_member()'s p_role check and already fixed this exact way for
-- staff_account_for_reset() (0062 code review) -- applied proactively here
-- rather than shipping a known-bad pattern and re-finding it in review.
--
-- AD-3 binding: `private.current_member_role()`, never
-- `auth.jwt() ->> 'app_role'` (the retired pattern initiate_member_payment()
-- itself still uses, grandfathered pre-AD-3).
--
-- Free/Test tier (price_locked, Story 11.2) is NOT special-cased -- a
-- resolved price of 0 is legitimate and must still insert a real `processing`
-- row, unlike initiate_member_payment()'s own review-added rejection of a
-- 0-price plan (that guard doesn't apply here, Story 11.6 explicitly
-- requires the full billing machinery to keep running at the 0 XAF price
-- point).
--
-- No DB-level guard against a second concurrent `processing` row for the
-- same gym -- flagged, not fixed, matching initiate_member_payment()'s own
-- already-documented identical gap (Story 4.15 code review, never fixed
-- there either). Task 6's UI-level button-disable-while-pending is the only
-- mitigation; see this story's Dev Notes.
-- ----------------------------------------------------------------------------
create function initiate_saas_billing_payment()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_interval billing_interval;
  v_monthly_price integer;
  v_annual_price integer;
  v_amount integer;
  v_provider_key text;
  v_payment_id uuid;
begin
  if private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied: caller is not this gym''s owner';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied: caller is not this gym''s owner';
  end if;

  select g.saas_billing_interval, t.monthly_price, t.annual_price
  into v_interval, v_monthly_price, v_annual_price
  from gyms g
  join tiers t on t.id = g.tier_id
  where g.id = v_gym_id;

  v_amount := case v_interval when 'annual' then v_annual_price else v_monthly_price end;

  select active_payment_provider() into v_provider_key;
  if v_provider_key is null then
    raise exception 'initiate_saas_billing_payment: no_active_provider';
  end if;

  insert into saas_billing_payments (gym_id, amount, currency, status, provider)
  values (v_gym_id, v_amount, 'XAF', 'processing', v_provider_key)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- Owner-callable by design, mirrors initiate_member_payment()'s own grant
-- shape (never revoked from authenticated, unlike the service-role-only
-- completion RPCs above).
revoke execute on function initiate_saas_billing_payment from public;
grant execute on function initiate_saas_billing_payment to authenticated;

-- ----------------------------------------------------------------------------
-- private.protect_self_managed_member_columns() (0020, extended 0063 for
-- role/name): unconditionally pins `email` back to OLD on any self-update
-- (auth.uid() = old.user_id) today -- discovered by this story's own pgTAP
-- run (not hypothetical): without this extension,
-- update_own_owner_notification_email() below would silently no-op every
-- time, exactly the same "system writer's own authorized write gets pinned
-- back by a trigger that can't tell it apart from a raw client UPDATE"
-- bug class the gyms-table bypass GUCs above (and 0063's own
-- app.staff_role_update_bypass, for the identical trigger's role/name
-- columns) already exist to solve. A third, separately-scoped bypass GUC --
-- app.owner_notification_email_update_bypass -- exempts exactly `email`,
-- mirroring app.staff_role_update_bypass's shape one column over. No other
-- self-managed column (phone/role/name/etc.) is exempted by this GUC.
-- ----------------------------------------------------------------------------
create or replace function private.protect_self_managed_member_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = old.user_id then
    new.gym_id := old.gym_id;
    new.user_id := old.user_id;
    new.phone := old.phone;
    new.dob := old.dob;
    new.photo_url := old.photo_url;
    new.join_date := old.join_date;
    new.emergency_contact := old.emergency_contact;
    new.deactivated_at := old.deactivated_at;
    new.created_at := old.created_at;

    if coalesce(current_setting('app.staff_role_update_bypass', true), 'false') <> 'true' then
      new.role := old.role;
      new.name := old.name;
    end if;

    if coalesce(current_setting('app.owner_notification_email_update_bypass', true), 'false') <> 'true' then
      new.email := old.email;
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- update_own_owner_notification_email(): the missing write path --
-- manager_or_owner_update_own_members (0018) explicitly restricts its own
-- `with check` to `role = 'member'` rows, so an Owner can edit other
-- members but never their own row. An RPC (not a second RLS policy) is the
-- established fit for a narrow single-column self-write in this codebase
-- (initiate_member_payment(), switch_active_gym()) -- a raw UPDATE policy
-- has no clean way to restrict which *columns* an Owner may touch on their
-- own row without a second pin-back trigger -- and, as it turns out, even a
-- SECURITY DEFINER RPC's write needs the bypass GUC above, since
-- private.protect_self_managed_member_columns() fires on the underlying
-- UPDATE regardless of the calling function's own privilege level.
--
-- `nullif(trim(p_email), '')` lets the Owner clear the field back to null by
-- submitting an empty string -- this is an optional field (AC #2's "if I
-- have one on file" implies "may not"). The format guard here is a DB-layer
-- backstop only (bare non-empty/contains-'@'); real validation is the
-- exported emailSchema Zod check at the Server Action boundary (Task 7).
-- ----------------------------------------------------------------------------
create function update_own_owner_notification_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied: caller is not this gym''s owner';
  end if;

  if p_email is not null and trim(p_email) <> '' and position('@' in trim(p_email)) = 0 then
    raise exception 'update_own_owner_notification_email: invalid_email';
  end if;

  perform set_config('app.owner_notification_email_update_bypass', 'true', true);

  update members
  set email = nullif(trim(p_email), '')
  where user_id = auth.uid() and gym_id = private.gym_id() and role = 'owner';

  perform set_config('app.owner_notification_email_update_bypass', 'false', true);
end;
$$;

revoke execute on function update_own_owner_notification_email from public;
grant execute on function update_own_owner_notification_email to authenticated;

-- ----------------------------------------------------------------------------
-- saas_billing_notices: AC #4's audit trail. Deliberately `public` schema,
-- not `private` -- unlike private.notification_dispatches/
-- class_reminder_dispatches/quiet_gym_alert_dispatches (all written
-- exclusively from inside Postgres via a trigger calling net.http_post),
-- this table is written from Task 4's Node-runtime Vercel Cron route via a
-- service-role supabase-js/PostgREST client, which cannot reach a
-- `private`-schema table without a wrapping RPC. `public` + Super-Admin-only
-- RLS mirrors saas_billing_payments' own already-established shape in this
-- same story family.
--
-- The unique index is the real dedup guard Task 4's job relies on to
-- survive a Vercel Cron retry or an overlapping invocation --
-- `billing_anchor_date_at_notice` snapshots gyms.saas_billing_anchor_date at
-- send time so the (gym, cycle, offset) key survives the anchor advancing
-- on the gym's next payment.
-- ----------------------------------------------------------------------------
create table saas_billing_notices (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  notice_day_offset integer not null, -- 0 (due date), 1, 3, or 5
  billing_anchor_date_at_notice date not null,
  sms_status text not null, -- 'sent' | 'failed'
  sms_error text,
  whatsapp_status text not null, -- 'sent' | 'failed'
  whatsapp_error text,
  email_status text not null, -- 'sent' | 'failed' | 'skipped_no_email_on_file' | 'skipped_no_provider'
  email_error text,
  created_at timestamptz not null default now()
);

create unique index idx_saas_billing_notices_dedup on saas_billing_notices(gym_id, billing_anchor_date_at_notice, notice_day_offset);

alter table saas_billing_notices enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on saas_billing_notices to authenticated, service_role;

create policy "super_admin_read_saas_billing_notices" on saas_billing_notices
  for select
  using (private.is_super_admin());

-- No INSERT/UPDATE/DELETE policy for any role -- service_role's writes
-- bypass RLS at the Postgres-role level regardless (Task 4's job uses a
-- service-role client). The grant above matches the baseline-GRANT-
-- alongside-RLS discipline from 0002, not a functional requirement specific
-- to service_role.
