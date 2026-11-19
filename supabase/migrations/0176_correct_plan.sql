-- ============================================================================
-- 0176: Correct plan (Epic 27, Story 27.4; FR-241, FR-242, FR-243, FR-251; AD-59, AD-35, AD-39, AD-29, AD-30).
--
-- A plan assigned by mistake could only be fixed by a developer editing the database. This migration adds the database half of the fix:
--
--   * private.subscription_status_for(expiry, grace, today)  -- the lifecycle thresholds of FR-027 as one pure function (IMMUTABLE, no table
--     access). run_subscription_lifecycle_job() (0045:389) is NOT modified: it keeps its inline thresholds and its UTC current_date.
--     subscription_status_equivalence.test.sql runs the real job against this function for every offset -12..+12 and grace 0, 3, 7, so a
--     future change to either side fails the test. The correction is the only writer that can move a row's status BACKWARDS (an expired
--     row corrected to a longer plan goes back to active), which is why the function, not the job, computes the status.
--   * private.subscription_standing_payments(subscription_id)  -- the ONE definition of "a payment stands" (FR-242), called by both
--     public.correct_plan_eligibility (the modal's opening check) and public.correct_subscription_plan (the authority), so the UI and the
--     database cannot split the rule. A subscription payment of the member stands unless it is voided or fully refunded. It belongs to the
--     current subscription when payments.subscription_id says so, OR when subscription_id is still NULL and the payment was created at or
--     after the current subscription row (owner decision 2026-11-18, widening the epic's "pending or processing": verified, pending,
--     processing and flagged all count, because a manual cash entry and the dashboard Tara initiation never link subscription_id, and
--     complete_verified_payment links it late). That widening errs towards refusing, but it has a limit: an unlinked payment created BEFORE
--     the current subscription row (cash recorded, then the plan assigned or renewed) is not counted, because it cannot be told from the
--     previous period's payment. Registration-fee and session payments (purpose) never count.
--   * public.correct_plan_eligibility(member)  -- read-only: the current subscription and the most recent standing payment, if any.
--   * public.correct_subscription_plan(member, new plan, reason, subscription_id default null)  -- the correction. A deactivated member is refused (no_current_subscription): deactivation expired the row and a correction would revive it. The optional
--     p_subscription_id (the id the modal showed) is how a renewal that landed while the modal was open is told apart (refusal
--     subscription_changed); it is the one parameter spine AD-59 did not list. Lock order (AD-29): the member row (FOR NO KEY UPDATE), then
--     the current subscription row (FOR UPDATE); the standing-payment rule is re-checked under both. Refusals raise P0001 with the code as
--     the message and a JSON detail (the epic's choice; 0175 returned coded rows instead).
--   * public.renew_subscription is re-created as the 0157 body plus one statement: the member lock (FOR NO KEY UPDATE) after the member
--     lookup and before the plan read. It also picks the latest row by (created_at, id), as the correction does, so both name the same current subscription on a created_at tie. It took no lock, so a correction committing between its plan read and its insert would leave a
--     renewal row on the pre-correction plan.
--
-- Expiry arithmetic: new expiry = the current row's start_date + the new plan's duration_days + the loyalty reward days already granted on
-- THAT row (loyalty_events 'reward_granted', counter 'subscriber', details->>'subscription_id', details->>'reward_days'; written by 0122's
-- private.award_renewal_stamp_impl), so a granted reward is never taken away. A Pay-per-session target gets a NULL expiry and status active.
-- start_date never changes.
--
-- KNOWN LIMITATION (owner decision 2026-11-18, recorded in docs/decisions.md): an EARLY renewal carries the remaining days of the period it
-- renews into expiry_date (0121) but keeps start_date = the renewal day. The formula does not re-add those carried days. It is reachable
-- only after that renewal's payment was voided or fully refunded (otherwise the payment stands and the correction is refused), and the
-- audit row's basis_start_date makes the basis visible.
--
-- Clocks: the correction uses private.gym_today(gym_id) (gym-local, as every renewal since 0157); the lifecycle job uses the UTC
-- current_date. Around midnight the two can differ by a day; the next job run only moves a status forward, never back.
--
-- What a correction never touches: payments, refunds, notifications, loyalty_events, loyalty_progress, guest_sessions, attendance_events,
-- session_attempts, front_desk_alerts, start_date, the registration fee. It earns no stamp and sends no notification. Exactly one audit row
-- (subscription_plan_corrected).
--
-- GymOS Support acts as a Supervisor through the registry (AD-35) behind a single-use step-up bound to the member (support_correct_plan).
--
-- Rollback: scripts/rollback-0176-correct-plan.sql (a corrected subscription stays corrected).
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- private.subscription_status_for: FR-027 as a pure function. A NULL expiry (Pay-per-session) is always active.
-- ----------------------------------------------------------------------------
create function private.subscription_status_for(p_expiry_date date, p_grace_days integer, p_today date)
returns subscription_status
language sql
immutable
set search_path = public
as $$
  select case
    when p_expiry_date is null then 'active'::subscription_status
    when p_today is null then null
    when p_expiry_date + coalesce(p_grace_days, 0) < p_today then 'expired'::subscription_status
    when p_expiry_date < p_today then 'grace_period'::subscription_status
    when p_expiry_date <= p_today + 7 then 'expiring_soon'::subscription_status
    else 'active'::subscription_status
  end;
$$;

-- ----------------------------------------------------------------------------
-- private.subscription_standing_payments: the payments that still stand on a subscription, most recent first.
-- state: verified | pending (also flagged: it awaits a decision like a pending one) | in_flight (processing) | partly_refunded.
-- A payment with one refund row equal to its amount is fully refunded and does not stand (refunds.payment_id is unique).
-- ----------------------------------------------------------------------------
create function private.subscription_standing_payments(p_subscription_id uuid)
returns table (
  payment_id uuid,
  state text,
  amount integer,
  method text,
  created_at timestamptz,
  refunded_amount integer
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         case when r.amount is not null then 'partly_refunded'
              when p.status = 'verified' then 'verified'
              when p.status = 'processing' then 'in_flight'
              else 'pending' end,
         p.amount,
         p.method,
         p.created_at,
         coalesce(r.amount, 0)
  from subscriptions s
  join payments p on p.member_id = s.member_id and p.gym_id = s.gym_id
  left join refunds r on r.payment_id = p.id
  where s.id = p_subscription_id
    and p.purpose = 'subscription'
    and p.voided_at is null
    and (r.amount is null or r.amount < p.amount)
    and (p.subscription_id = s.id or (p.subscription_id is null and p.created_at >= s.created_at))
  order by p.created_at desc, p.id desc;
$$;

-- ----------------------------------------------------------------------------
-- public.correct_plan_eligibility: what the modal asks on open. Role and gym resolved live; every other caller, a member of another
-- gym, a missing member and a member without a subscription all get the same empty result (no existence oracle).
-- ----------------------------------------------------------------------------
create function public.correct_plan_eligibility(p_member_id uuid)
returns table (
  subscription_id uuid,
  plan_id uuid,
  plan_name text,
  plan_type plan_type,
  billing_interval billing_interval,
  price integer,
  duration_days integer,
  start_date date,
  expiry_date date,
  status subscription_status,
  block_state text,
  block_payment_id uuid,
  block_amount integer,
  block_method text,
  block_at timestamptz,
  block_refunded_amount integer,
  block_more integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role member_role;
  v_gym_id uuid;
  v_sub subscriptions;
  v_plan plans;
begin
  v_role := private.support_rpc_role('correct_plan_eligibility');
  if not coalesce(v_role in ('owner', 'manager', 'supervisor'), false) then
    return;
  end if;

  v_gym_id := private.support_rpc_gym_id('correct_plan_eligibility');
  if v_gym_id is null then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'correct_plan_eligibility: gym % is not active', v_gym_id;
  end if;

  -- "Current" is the row subscriptions_current and the member page show: the newest by (created_at, id).
  select s.* into v_sub
  from subscriptions s
  join members m on m.id = s.member_id and m.gym_id = v_gym_id and m.deactivated_at is null
  where s.member_id = p_member_id and s.gym_id = v_gym_id
  order by s.created_at desc, s.id desc
  limit 1;

  if not found then
    return;
  end if;

  select p.* into v_plan from plans p where p.id = v_sub.plan_id;

  return query
  select v_sub.id, v_plan.id, v_plan.name, v_plan.plan_type, v_plan.billing_interval, v_plan.price, v_plan.duration_days,
         v_sub.start_date, v_sub.expiry_date, v_sub.status,
         b.state, b.payment_id, b.amount, b.method, b.created_at, b.refunded_amount,
         (select case when count(*) > 0 then (count(*) - 1)::integer end from private.subscription_standing_payments(v_sub.id))
  from (select 1) one
  left join lateral (select * from private.subscription_standing_payments(v_sub.id) limit 1) b on true;
end;
$$;

-- ----------------------------------------------------------------------------
-- public.correct_subscription_plan: the correction.
-- ----------------------------------------------------------------------------
create function public.correct_subscription_plan(
  p_member_id uuid,
  p_new_plan_id uuid,
  p_reason text,
  p_subscription_id uuid default null
)
returns table (
  subscription_id uuid,
  plan_id uuid,
  plan_name text,
  plan_type plan_type,
  expiry_date date,
  status subscription_status
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role member_role;
  v_gym_id uuid;
  v_member_gym uuid;
  v_deactivated_at timestamptz;
  v_sub subscriptions;
  v_latest uuid;
  v_old_plan plans;
  v_new_plan plans;
  v_grace integer;
  v_reason text;
  v_stand record;
  v_stand_count integer;
  v_lapse timestamptz;
  v_loyalty_days integer;
  v_new_expiry date;
  v_new_status subscription_status;
begin
  v_role := private.support_rpc_role('correct_subscription_plan');
  if not coalesce(v_role in ('owner', 'manager', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.support_rpc_gym_id('correct_subscription_plan');
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- A live support caller needs a single-use grant bound to this member; a no-op for everyone else.
  perform private.support_stepup_require('support_correct_plan', p_member_id::text);

  -- AD-29: the member row first. Another gym's member and a missing id are the same answer.
  select m.gym_id, m.deactivated_at into v_member_gym, v_deactivated_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for no key update;

  if not found then
    raise exception 'permission denied';
  end if;

  -- A deactivated member has no correctable subscription (owner decision 2026-11-18, review of 27-4): deactivation set the current row to
  -- expired, and a correction would move it back to a live status. The same refusal as a member without a subscription, so no new code.
  if v_deactivated_at is not null then
    raise exception 'no_current_subscription' using errcode = 'P0001', detail = '{}';
  end if;

  -- Then the current subscription row (the newest by created_at, id, as subscriptions_current), FOR UPDATE.
  select s.* into v_sub
  from subscriptions s
  where s.member_id = p_member_id and s.gym_id = v_gym_id
  order by s.created_at desc, s.id desc
  limit 1
  for update;

  if not found then
    raise exception 'no_current_subscription' using errcode = 'P0001', detail = '{}';
  end if;

  -- A renewal path that takes no member lock (renew_subscription) can insert a newer row between the pick and the lock.
  select s.id into v_latest
  from subscriptions s
  where s.member_id = p_member_id and s.gym_id = v_gym_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_latest is distinct from v_sub.id
     or (p_subscription_id is not null and p_subscription_id is distinct from v_sub.id) then
    raise exception 'subscription_changed' using errcode = 'P0001',
      detail = jsonb_build_object('subscription_id', v_latest)::text;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'correct_subscription_plan: gym % is not active', v_gym_id;
  end if;

  select p.* into v_new_plan from plans p where p.id = p_new_plan_id and p.gym_id = v_gym_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001', detail = '{}';
  end if;

  select p.* into v_old_plan from plans p where p.id = v_sub.plan_id;

  if v_new_plan.id = v_sub.plan_id then
    raise exception 'same_plan' using errcode = 'P0001', detail = '{}';
  end if;

  -- The standing-payment rule, re-checked under both locks. The most recent standing payment is named, the others are counted.
  select count(*) into v_stand_count from private.subscription_standing_payments(v_sub.id);
  if v_stand_count > 0 then
    select * into v_stand from private.subscription_standing_payments(v_sub.id) limit 1;
    raise exception 'payment_stands' using errcode = 'P0001',
      detail = jsonb_build_object(
        'state', v_stand.state,
        'payment_id', v_stand.payment_id,
        'amount', v_stand.amount,
        'method', v_stand.method,
        'created_at', v_stand.created_at,
        'on', private.gym_local_date(v_gym_id, v_stand.created_at),
        'refunded_amount', v_stand.refunded_amount,
        'more', v_stand_count - 1)::text;
  end if;

  -- A move across the Pay-per-session boundary (to or from it) while an unused paid session is held. Free sessions (loyalty grants)
  -- do not block. The detail carries the soonest lapse.
  if (v_old_plan.plan_type = 'pay_per_session') is distinct from (v_new_plan.plan_type = 'pay_per_session') then
    select min(gs.usable_until) into v_lapse
    from guest_sessions gs
    where gs.member_id = p_member_id and gs.gym_id = v_gym_id
      and gs.payment_id is not null and gs.consumed_at is null and gs.voided_at is null and gs.usable_until > now();
    if v_lapse is not null then
      raise exception 'session_held' using errcode = 'P0001',
        detail = jsonb_build_object('lapses_at', v_lapse, 'lapses_on', private.gym_local_date(v_gym_id, v_lapse))::text;
    end if;
  end if;

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'invalid_reason' using errcode = 'P0001', detail = '{}';
  end if;

  -- Reward days already granted on THIS row stay granted.
  select coalesce(sum((e.details ->> 'reward_days')::integer), 0)::integer into v_loyalty_days
  from loyalty_events e
  where e.member_id = p_member_id and e.gym_id = v_gym_id
    and e.event_type = 'reward_granted' and e.counter = 'subscriber'
    and e.details ->> 'subscription_id' = v_sub.id::text;

  if v_new_plan.plan_type = 'pay_per_session' then
    -- No expiry, so no reward days are applied: the audit row says 0 (the loyalty_events rows stay, so a move back re-adds them).
    v_new_expiry := null;
    v_loyalty_days := 0;
  else
    v_new_expiry := v_sub.start_date + v_new_plan.duration_days + v_loyalty_days;
  end if;

  select g.grace_period_days into v_grace from gyms g where g.id = v_gym_id;
  v_new_status := private.subscription_status_for(v_new_expiry, v_grace, private.gym_today(v_gym_id));

  -- One UPDATE: the 0018 trigger needs plan and expiry to change together. start_date is never written.
  update subscriptions s
  set plan_id = v_new_plan.id, expiry_date = v_new_expiry, status = v_new_status
  where s.id = v_sub.id;

  perform log_audit_event(
    p_action_type => 'subscription_plan_corrected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'member_id', p_member_id,
      'subscription_id', v_sub.id,
      'old_plan_id', v_old_plan.id,
      'new_plan_id', v_new_plan.id,
      'old_plan_name', v_old_plan.name,
      'new_plan_name', v_new_plan.name,
      'old_price', v_old_plan.price,
      'new_price', v_new_plan.price,
      'old_expiry_date', v_sub.expiry_date,
      'new_expiry_date', v_new_expiry,
      'old_status', v_sub.status,
      'new_status', v_new_status,
      'basis_start_date', v_sub.start_date,
      'loyalty_days_added', v_loyalty_days,
      'reason', v_reason));

  return query select v_sub.id, v_new_plan.id, v_new_plan.name, v_new_plan.plan_type, v_new_expiry, v_new_status;
end;
$$;

-- ----------------------------------------------------------------------------
-- public.renew_subscription: the 0157 body (live; no later migration redefines it) plus the member lock and the id tie-break in the plan pick; the lock (FOR NO KEY UPDATE)
-- right after the member lookup and before the plan read. Signature, grants and the support_rpc_role / support_rpc_gym_id calls are
-- unchanged. confirm_renewal and complete_verified_payment already take that lock, so with this every renewal path that reads the
-- current plan serialises against a correction (rollback restores the 0157 body).
-- ----------------------------------------------------------------------------
create or replace function public.renew_subscription(p_member_id uuid, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not coalesce((select private.support_rpc_role('renew_subscription'))::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.support_rpc_gym_id('renew_subscription');
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'renew_subscription: gym % is not active', v_caller_gym_id;
  end if;

  -- Gym-scoped in the query itself (not a separate post-check) so a member
  -- belonging to another gym produces the exact same "not found" outcome as
  -- a truly nonexistent id -- avoids letting a caller enumerate whether a
  -- given member id exists in some other gym, matching this codebase's own
  -- established "uniform 0-rows failure mode" tenant-isolation philosophy
  -- (see 0002/0007/0008's table-grant comments on the same principle).
  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'renew_subscription: member % not found', p_member_id;
  end if;

  -- Story 27.4 (AD-29, member first): one of the two changes to the 0157 body (the other is the id tie-break in the plan pick below). correct_subscription_plan locks the member row and then the
  -- current subscription; without this lock a correction could commit between the plan_id read below and the insert, leaving a renewal
  -- row on the pre-correction plan. Taken after the lookup and before the plan read; nothing else in the body changed beyond the tie-break.
  perform 1 from members where id = p_member_id and gym_id = v_caller_gym_id for no key update;

  if v_deactivated_at is not null then
    raise exception 'renew_subscription: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'renew_subscription: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_id is null then
    raise exception 'renew_subscription: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else private.gym_today(v_member_gym_id) + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', private.gym_today(v_member_gym_id), v_new_expiry)
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => 'subscription_manual_renewal',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason,
      'subscription_id', v_new_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry
    )
  );

  return v_new_id;
end;
$function$;

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------
revoke execute on function private.subscription_status_for(date, integer, date) from public, anon, authenticated;
revoke execute on function private.subscription_standing_payments(uuid) from public, anon, authenticated;
revoke execute on function public.renew_subscription(uuid, text) from public, anon;
grant execute on function public.renew_subscription(uuid, text) to authenticated;
revoke execute on function public.correct_plan_eligibility(uuid) from public, anon;
revoke execute on function public.correct_subscription_plan(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.correct_plan_eligibility(uuid) to authenticated;
grant execute on function public.correct_subscription_plan(uuid, uuid, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The registry (AD-35): the two RPCs admit a live support caller, by name. The audit action a support caller can now cause.
-- ----------------------------------------------------------------------------
insert into private.support_capabilities (capability, kind, object_name) values
  ('plan_correction', 'rpc', 'correct_plan_eligibility'),
  ('plan_correction', 'rpc', 'correct_subscription_plan');

insert into private.support_audit_actions (action_type) values
  ('subscription_plan_corrected')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Step-up: the writing RPC needs a fresh authenticator code for a support caller (0175's list plus support_correct_plan).
-- ----------------------------------------------------------------------------
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset', 'take_down_gym_page', 'lift_gym_page_takedown', 'support_staff_check_in', 'support_void_staff_check_in', 'support_correct_plan') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action like 'support\_%' then
    -- Story 23.6: a support grant goes to an activated, unlocked, non-deactivated support account, whatever the Super Admin flag says.
    if not exists (select 1 from private.support_accounts sa
                    where sa.user_id = p_user and sa.activated_at is not null and sa.locked_at is null
                      and sa.reset_pending_at is null and sa.deactivated_at is null) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
  else
    if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
      return null;
    end if;
  end if;

  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);

  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$$;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- Verify.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.correct_subscription_plan(uuid, uuid, text, uuid)'::regprocedure;
  if position('subscription_standing_payments' in v_src) = 0 or position('support_stepup_require' in v_src) = 0
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' or position('support_rpc_gym_id(''correct_subscription_plan'')' in v_src) = 0
     or position('subscription_status_for' in v_src) = 0 or position('for no key update' in v_src) = 0 or position('for update' in v_src) = 0 then
    raise exception '0176: correct_subscription_plan lost its standing-payment rule, step-up, status guard, gym resolution, status function or locks';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.correct_plan_eligibility(uuid)'::regprocedure;
  if position('subscription_standing_payments' in v_src) = 0 or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
     or position('support_rpc_gym_id(''correct_plan_eligibility'')' in v_src) = 0 then
    raise exception '0176: correct_plan_eligibility lost its standing-payment rule, status guard or gym resolution';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.correct_plan_eligibility(uuid)'::regprocedure, 'public.correct_subscription_plan(uuid, uuid, text, uuid)'::regprocedure)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception '0176: the two RPCs must be executable by authenticated and not by anon';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.subscription_status_for(date, integer, date)'::regprocedure, 'private.subscription_standing_payments(uuid)'::regprocedure)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception '0176: the private helpers must not be executable by clients';
  end if;
  if (select count(*) from private.support_capabilities
      where kind = 'rpc' and object_name in ('correct_plan_eligibility', 'correct_subscription_plan')) <> 2 then
    raise exception '0176: the two RPCs are not both in the support registry';
  end if;
  if not exists (select 1 from private.support_audit_actions where action_type = 'subscription_plan_corrected') then
    raise exception '0176: subscription_plan_corrected is not an allowed support audit action';
  end if;
  if (select provolatile from pg_proc where oid = 'private.subscription_status_for(date, integer, date)'::regprocedure) <> 'i' then
    raise exception '0176: subscription_status_for must be IMMUTABLE';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.renew_subscription(uuid, text)'::regprocedure;
  if position('for no key update' in v_src) = 0 or v_src !~ 'order by s\.created_at desc, s\.id desc' then
    raise exception '0176: renew_subscription lost its member lock or its (created_at, id) current-subscription order';
  end if;
  if position('run_subscription_lifecycle_job' in (select prosrc from pg_proc where proname = 'correct_subscription_plan')) <> 0 then
    raise exception '0176: the correction must not call the lifecycle job';
  end if;
end
$verify$;
