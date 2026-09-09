-- Supervisor gets the "Manager-plus" footprint EXPERIENCE.md already specifies.
--
-- THE GAP. EXPERIENCE.md:206 defines the V1.5 Supervisor role as sitting
-- between Owner and Manager, with nav access that is "Manager-plus: everything
-- Manager sees, plus Settings and Staff -- the same footprint as Owner, minus
-- the ability to create another Supervisor". Story 9.1 shipped the role and
-- Stories 9.x wired the two screens Supervisor needed (Staff, Settings). Nothing
-- ever widened the rest, so a Supervisor today sees LESS than a Receptionist.
--
-- This is not a UI oversight -- it is denial at the database. Measured against
-- identical seed data, one session per role, same query:
--
--     table               manager   supervisor   owner
--     members                  10           10      10
--     subscriptions             4            0       4
--     coach_assignments         1            0       1
--
-- Those zeros are RLS refusing the read, not empty tables. Before this
-- migration Supervisor appeared in policies on exactly 2 tables (members,
-- class_bookings); Manager appeared on 14 where Supervisor did not.
--
-- The role-check contradiction is visible in the product's own copy: the Coach
-- Portal empty state (EXPERIENCE.md:1651, amended by Story 9.4) reads "Ask your
-- Manager, Owner, or Supervisor to assign members" -- while assign_coach()
-- rejects a Supervisor outright.
--
-- WHAT THIS MIGRATION DOES
--   Part 1 -- widens 26 RLS policies to include 'supervisor' alongside
--   'manager'. Every statement was GENERATED from the live pg_policies catalog
--   and its role array widened mechanically, never transcribed, so each policy
--   keeps its exact existing predicate and gains one array element.
--
--   Part 2 -- widens the 7 SECURITY DEFINER role gates that named manager but
--   not supervisor. Bodies come from pg_get_functiondef(), so the before/after
--   diff is exactly 7 lines, one per function, purely additive.
--   enforce_member_cap() was deliberately NOT touched: it mentions "manager"
--   only in a comment and carries no role gate.
--
-- ONE CHANGE HERE IS A DIFFERENT AXIS, CALLED OUT DELIBERATELY.
-- `member_read_gym_staff_members` does not grant Supervisor anything -- it
-- controls which staff rows a MEMBER may read, and previously listed
-- owner/manager/receptionist only, so Supervisors were invisible to members.
-- It is widened here because the product already promises otherwise in the copy
-- quoted above, but note it loosens what members see rather than what
-- Supervisors can do. Everything else in Part 1 is strictly about Supervisor.
--
-- NOT CHANGED, deliberately: nothing grants Supervisor the ability to create or
-- promote another Supervisor. update_staff_role()/create_staff_member()'s
-- role-ceiling allowlist (NFR-013, EXPERIENCE.md:1591) already restricts a
-- Supervisor to assigning Manager/Receptionist/Coach, which is exactly the
-- "minus the ability to create another Supervisor" clause of the spec, and it
-- already carries supervisor in its own logic -- so it is correct as-is.

-- ================================================================
-- PART 1 -- RLS policies
-- ================================================================

alter policy "gym_staff_read_own_attendance_events" on public.attendance_events
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "manager_or_owner_read_own_audit_log" on public.audit_log
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "manager_or_owner_insert_own_classes" on public.classes
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "manager_or_owner_update_own_classes" on public.classes
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "manager_or_owner_read_own_coach_assignments" on public.coach_assignments
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "gym_staff_dismiss_own_front_desk_alerts" on public.front_desk_alerts
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "gym_staff_read_own_front_desk_alerts" on public.front_desk_alerts
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "manager_or_owner_insert_own_members" on public.members
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text])) AND (role = 'member'::member_role)))
;
alter policy "manager_or_owner_update_own_members" on public.members
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text])) AND (role = 'member'::member_role)))
;
alter policy "gym_staff_read_own_payment_discrepancies" on public.payment_discrepancies
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) AND (saas_billing_payment_id IS NULL)))
;
alter policy "gym_staff_insert_own_payments" on public.payments
  with check (((gym_id = private.gym_id()) AND (status = ANY (ARRAY['pending'::payment_status, 'processing'::payment_status])) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "gym_staff_read_own_payments" on public.payments
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "gym_staff_verify_own_payments" on public.payments
  using (((gym_id = private.gym_id()) AND (status = 'pending'::payment_status) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
  with check (((gym_id = private.gym_id()) AND (status = ANY (ARRAY['verified'::payment_status, 'flagged'::payment_status])) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "manager_or_owner_delete_own_plans" on public.plans
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "manager_or_owner_insert_own_plans" on public.plans
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "manager_or_owner_update_own_plans" on public.plans
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "gym_staff_read_own_refunds" on public.refunds
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
;
alter policy "manager_or_owner_insert_own_refunds" on public.refunds
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text])) AND (EXISTS ( SELECT 1
   FROM payments p
  WHERE ((p.id = refunds.payment_id) AND (p.gym_id = refunds.gym_id) AND (p.status = 'verified'::payment_status) AND (refunds.amount <= p.amount))))))
;
alter policy "manager_or_owner_read_own_session_notes" on public.session_notes
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text]))))
;
alter policy "gym_staff_read_own_subscriptions" on public.subscriptions
  using (((gym_id = private.gym_id()) AND (((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) OR (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = subscriptions.member_id) AND (m.user_id = auth.uid())))))))
;
alter policy "manager_or_owner_insert_own_subscriptions" on public.subscriptions
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "manager_or_owner_update_own_subscriptions" on public.subscriptions
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
;
alter policy "member_read_gym_staff_members" on public.members
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'member'::text) AND (role = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role, 'receptionist'::member_role]))))
;
alter policy "manager_or_owner_read_own_workout_plan_completions" on public.workout_plan_completions
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role]))))
;
alter policy "manager_or_owner_read_own_workout_plan_exercises" on public.workout_plan_exercises
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role]))))
;
alter policy "manager_or_owner_read_own_workout_plan" on public.workout_plans
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role]))))
;

-- ================================================================
-- PART 2 -- SECURITY DEFINER role gates
-- ================================================================

CREATE OR REPLACE FUNCTION public.assign_coach(p_member_id uuid, p_coach_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_coach_gym_id uuid;
  v_previous_coach_id uuid;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'assign_coach: gym % is not active', v_caller_gym_id;
  end if;

  -- Folds "wrong gym" and "not actually a member" into one not-found
  -- outcome, same principle as renew_subscription's member lookup.
  select gym_id into v_member_gym_id
  from members
  where id = p_member_id and gym_id = v_caller_gym_id and role = 'member';

  if v_member_gym_id is null then
    raise exception 'assign_coach: member % not found', p_member_id;
  end if;

  -- Folds "wrong gym" and "not actually a coach" into one not-found
  -- outcome for the same reason.
  select gym_id into v_coach_gym_id
  from members
  where id = p_coach_id and gym_id = v_caller_gym_id and role = 'coach';

  if v_coach_gym_id is null then
    raise exception 'assign_coach: coach % not found', p_coach_id;
  end if;

  -- AC #2: end the prior active assignment (ended_at, not deleted) before
  -- starting the new one -- the partial unique index above would reject
  -- a second concurrently-active row for this member anyway, but this
  -- makes the "end-then-start" ordering explicit and atomic within this
  -- one function call.
  update coach_assignments
  set ended_at = now()
  where member_id = p_member_id and ended_at is null
  returning coach_id into v_previous_coach_id;

  insert into coach_assignments (gym_id, member_id, coach_id, started_at)
  values (v_member_gym_id, p_member_id, p_coach_id, now())
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => case when v_previous_coach_id is null then 'coach_assigned' else 'coach_reassigned' end,
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'coach_id', p_coach_id,
      'previous_coach_id', v_previous_coach_id,
      'assignment_id', v_new_id
    )
  );

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_out_member(p_member_id uuid)
 RETURNS attendance_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'check_out_member: gym % is not active', v_caller_gym_id;
  end if;

  select gym_id into v_member_gym_id
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'check_out_member: member % not found', p_member_id;
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = p_member_id and gym_id = v_member_gym_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out_member: member % has no open check-in', p_member_id;
  end if;

  perform log_audit_event(
    p_action_type => 'attendance_manual_checkout',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'attendance_event_id', v_row.id,
      'checked_out_at', v_row.checked_out_at
    )
  );

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_renewal(p_member_id uuid, p_method text, p_reason text, p_backdate boolean DEFAULT false, OUT payment_id uuid, OUT subscription_id uuid, OUT amount integer, OUT currency text, OUT new_expiry_date date)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_actor_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_current_status subscription_status;
  v_current_expiry_date date;
  v_start_date date;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := auth.uid();

  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'confirm_renewal: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'confirm_renewal: reason is required';
  end if;

  select s.plan_id, s.status, s.expiry_date
    into v_plan_id, v_current_status, v_current_expiry_date
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_id is null then
    raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
  end if;

  if p_backdate then
    if v_current_status not in ('grace_period', 'expired') then
      raise exception 'confirm_renewal: back-dating is only available for grace_period or expired subscriptions';
    end if;
    if v_current_expiry_date is null then
      raise exception 'confirm_renewal: cannot back-date a subscription with no expiry date';
    end if;
    v_start_date := v_current_expiry_date;
  else
    v_start_date := current_date;
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  -- Review finding: back-dating a member expired longer than one plan cycle
  -- (e.g. expired 100 days ago on a 30-day plan) would otherwise insert a
  -- new subscription already marked 'active' with an expiry_date already in
  -- the past. Reject rather than silently produce an already-expired
  -- "active" row -- consistent with this block's other eligibility guards.
  if p_backdate and v_duration_days is not null and (v_start_date + v_duration_days) < current_date then
    raise exception 'confirm_renewal: back-dated renewal would still be expired';
  end if;

  new_expiry_date := case when v_duration_days is null then null else v_start_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', v_start_date, new_expiry_date)
  returning id into subscription_id;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason)
  values (v_member_gym_id, p_member_id, subscription_id, amount, currency, p_method, 'verified', v_actor_id, p_reason)
  returning id into payment_id;

  perform log_audit_event(
    p_action_type => 'renewal_confirmed',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason, 'method', p_method, 'amount', amount, 'currency', currency,
      'payment_id', payment_id, 'subscription_id', subscription_id, 'plan_id', v_plan_id,
      'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_class(p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_class_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'supervisor', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_class: gym % is not active', v_gym_id;
  end if;

  insert into classes (
    gym_id, name, description, coach_id, capacity, schedule_type,
    one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  ) values (
    v_gym_id, p_name, p_description, p_coach_id, p_capacity, p_schedule_type,
    p_one_off_session_at, p_recurrence_days, p_recurrence_time, p_recurrence_start_date
  )
  returning id into v_class_id;

  perform private.materialize_sessions_for_class(v_class_id);

  return v_class_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.materialize_class_sessions(p_class_id uuid, p_reschedule boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_class_gym_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'supervisor', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'materialize_class_sessions: gym % is not active', v_caller_gym_id;
  end if;

  select gym_id into v_class_gym_id
  from classes
  where id = p_class_id and gym_id = v_caller_gym_id;

  if v_class_gym_id is null then
    raise exception 'materialize_class_sessions: class % not found', p_class_id;
  end if;

  if p_reschedule then
    if exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    ) then
      raise exception 'materialize_class_sessions: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
    end if;

    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
  end if;

  perform private.materialize_sessions_for_class(p_class_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.renew_subscription(p_member_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
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

  if v_deactivated_at is not null then
    raise exception 'renew_subscription: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'renew_subscription: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'renew_subscription: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', current_date, v_new_expiry)
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_class(p_class_id uuid, p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old record;
  v_schedule_changed boolean;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'supervisor', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_class: gym % is not active', v_gym_id;
  end if;

  select schedule_type, one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  into v_old
  from classes
  where id = p_class_id and gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'update_class: class % not found', p_class_id;
  end if;

  v_schedule_changed :=
    v_old.schedule_type is distinct from p_schedule_type
    or v_old.one_off_session_at is distinct from p_one_off_session_at
    or v_old.recurrence_days is distinct from p_recurrence_days
    or v_old.recurrence_time is distinct from p_recurrence_time
    or v_old.recurrence_start_date is distinct from p_recurrence_start_date;

  if v_schedule_changed then
    if exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    ) then
      raise exception 'update_class: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
    end if;
  end if;

  update classes set
    name = p_name,
    description = p_description,
    coach_id = p_coach_id,
    capacity = p_capacity,
    schedule_type = p_schedule_type,
    one_off_session_at = p_one_off_session_at,
    recurrence_days = p_recurrence_days,
    recurrence_time = p_recurrence_time,
    recurrence_start_date = p_recurrence_start_date
  where id = p_class_id and gym_id = v_gym_id;

  if v_schedule_changed then
    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
    perform private.materialize_sessions_for_class(p_class_id);
  end if;
end;
$function$
;


-- ================================================================
-- Post-condition assertions
-- ================================================================
-- 0090/0091/0092's discipline: a migration that widens an authorization
-- boundary should assert the result rather than trust that 33 hand-checked
-- statements all landed. If any policy or function above were edited in a way
-- that dropped the new role, this fails loudly at apply time instead of
-- shipping a half-widened Supervisor.
do $verify$
declare
  v_missing text[];
  v_gated_fns text[] := array[
    'assign_coach','check_out_member','confirm_renewal','create_class',
    'update_class','renew_subscription','materialize_class_sessions'
  ];
begin
  -- 1. No policy may still name 'manager' without also naming 'supervisor'.
  --    This is the whole point of the migration, expressed as an invariant
  --    rather than a count, so a policy added later by another story is caught
  --    too rather than silently reintroducing the gap.
  select array_agg(tablename||'.'||policyname order by tablename, policyname)
    into v_missing
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%manager%'
    and (coalesce(qual,'')||coalesce(with_check,'')) not ilike '%supervisor%';

  if v_missing is not null then
    raise exception '0093: these policies still grant manager without supervisor: %', array_to_string(v_missing, ', ');
  end if;

  -- 2. Every widened role gate must actually carry the new role. Matching on
  --    the app_role array rather than a bare 'supervisor' substring, so a
  --    mention in a comment cannot satisfy this.
  select array_agg(fn order by fn) into v_missing
  from unnest(v_gated_fns) as fn
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn
      and p.prosrc like '%''app_role''%'
      and p.prosrc like '%''supervisor''%'
  );

  if v_missing is not null then
    raise exception '0093: suspension of the supervisor widening -- these functions still exclude it: %', array_to_string(v_missing, ', ');
  end if;

  -- 3. enforce_member_cap() must NOT have acquired a supervisor role gate --
  --    it never had a role gate at all, and inventing one here would be a
  --    silent authorization change riding along with a widening migration.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_member_cap'
      and p.prosrc like '%''app_role''%'
  ) then
    raise exception '0093: enforce_member_cap must stay ungated -- it mentions manager only in a comment';
  end if;
end;
$verify$;
