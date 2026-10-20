-- Rollback for migration 0124 (live authorization in the database).
-- Restores the claim-only definitions: private.gym_id() and private.is_super_admin()
-- trust the token again, the 106 policies and 27 functions and the payment trigger read
-- the `app_role` claim, log_audit_event() skips its cross-gym check for a NULL gym, and
-- the payments member/gym guard is dropped. Data is untouched. A deactivated or demoted
-- staff member regains access until token expiry, so roll back only if the live checks
-- themselves are broken.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0124-live-authorization-database.sql

set local lock_timeout = '5s';

drop trigger if exists payments_member_same_gym on public.payments;
drop function if exists private.payments_member_same_gym();

-- helpers first: policies and functions below call them
create or replace function private.gym_id()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  raw text;
begin
  raw := auth.jwt() ->> 'gym_id';
  if raw is null or raw = '' then
    return null;
  end if;
  return raw::uuid;
exception
  when others then
    return null;
end;
$$;
-- Production's body before 0124 had no `raise warning` here (migration 0009 does; production had drifted from it). Rollback
-- rehearsal 2026-10-20 diffed the rolled-back definition against production as it was before the epic and found this one
-- line, so this restores what production actually had.

create or replace function private.is_super_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'app_role') = 'super_admin', false);
$$;

grant execute on function private.gym_id() to public;
grant execute on function private.is_super_admin() to public;
-- 0124 revoked this trigger function's PUBLIC execute (line 2754 of the migration); production had the default grant. A trigger
-- function's EXECUTE is only checked when the trigger is created, so this has no functional effect, but a rollback restores it.
grant execute on function private.protect_payment_columns_on_staff_verify() to public;

alter policy "gym_staff_read_own_attendance_events" on public.attendance_events
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "member_read_own_attendance_events" on public.attendance_events
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = attendance_events.member_id) AND (m.user_id = auth.uid()))))));

alter policy "manager_or_owner_read_own_audit_log" on public.audit_log
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "gym_staff_read_own_class_bookings" on public.class_bookings
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'receptionist'::text, 'supervisor'::text]))));

alter policy "member_read_own_class_bookings" on public.class_bookings
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = class_bookings.member_id) AND (m.user_id = auth.uid()))))));

alter policy "manager_or_owner_insert_own_classes" on public.classes
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "manager_or_owner_update_own_classes" on public.classes
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "manager_or_owner_read_own_coach_assignments" on public.coach_assignments
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "gym_staff_dismiss_own_front_desk_alerts" on public.front_desk_alerts
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "gym_staff_read_own_front_desk_alerts" on public.front_desk_alerts
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "owner_update_own_gym" on public.gyms
  using (((id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)))
  with check (((id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)));

alter policy "coach_read_assigned_members" on public.members
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'coach'::text) AND private.is_assigned_coach(id)));

alter policy "manager_or_owner_insert_own_members" on public.members
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['receptionist'::text, 'manager'::text, 'supervisor'::text, 'owner'::text])) AND (role = 'member'::member_role)));

alter policy "manager_or_owner_update_own_members" on public.members
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text])) AND (role = 'member'::member_role)));

alter policy "member_read_gym_staff_members" on public.members
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'member'::text) AND (role = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role, 'receptionist'::member_role]))));

alter policy "gym_staff_read_own_payment_discrepancies" on public.payment_discrepancies
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) AND (saas_billing_payment_id IS NULL)));

alter policy "gym_staff_insert_own_payments" on public.payments
  with check (((gym_id = private.gym_id()) AND (status = ANY (ARRAY['pending'::payment_status, 'processing'::payment_status])) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) AND (purpose = 'subscription'::text) AND (voided_at IS NULL)));

alter policy "gym_staff_read_own_payments" on public.payments
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "gym_staff_verify_own_payments" on public.payments
  using (((gym_id = private.gym_id()) AND (status = 'pending'::payment_status) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))))
  with check (((gym_id = private.gym_id()) AND (status = ANY (ARRAY['verified'::payment_status, 'flagged'::payment_status])) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "member_read_own_payments" on public.payments
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = payments.member_id) AND (m.user_id = auth.uid()))))));

alter policy "manager_or_owner_delete_own_plans" on public.plans
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "manager_or_owner_insert_own_plans" on public.plans
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "manager_or_owner_update_own_plans" on public.plans
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "gym_staff_read_own_refunds" on public.refunds
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "manager_or_owner_insert_own_refunds" on public.refunds
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text])) AND (EXISTS ( SELECT 1
   FROM payments p
  WHERE ((p.id = refunds.payment_id) AND (p.gym_id = refunds.gym_id) AND (p.status = 'verified'::payment_status) AND (p.purpose <> 'registration_fee'::text) AND (p.voided_at IS NULL) AND (refunds.amount <= p.amount))))));

alter policy "coach_read_own_session_notes" on public.session_notes
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'coach'::text) AND private.is_assigned_coach(member_id) AND private.is_own_coach_id(coach_id)));

alter policy "manager_or_owner_read_own_session_notes" on public.session_notes
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text]))));

alter policy "coach_read_assigned_subscriptions" on public.subscriptions
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = 'coach'::text) AND private.is_assigned_coach(member_id)));

alter policy "gym_staff_read_own_subscriptions" on public.subscriptions
  using (((gym_id = private.gym_id()) AND (((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) OR (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = subscriptions.member_id) AND (m.user_id = auth.uid())))))));

alter policy "manager_or_owner_insert_own_subscriptions" on public.subscriptions
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['receptionist'::text, 'manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "manager_or_owner_update_own_subscriptions" on public.subscriptions
  using (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))))
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'owner'::text]))));

alter policy "owner_delete_own_gym_logo" on storage.objects
  using (((bucket_id = 'gym-logos'::text) AND ((storage.foldername(name))[1] = (private.gym_id())::text) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)));

alter policy "owner_insert_own_gym_logo" on storage.objects
  with check (((bucket_id = 'gym-logos'::text) AND ((storage.foldername(name))[1] = (private.gym_id())::text) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)));

alter policy "owner_select_own_gym_logo" on storage.objects
  using (((bucket_id = 'gym-logos'::text) AND ((storage.foldername(name))[1] = (private.gym_id())::text) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)));

alter policy "owner_update_own_gym_logo" on storage.objects
  using (((bucket_id = 'gym-logos'::text) AND ((storage.foldername(name))[1] = (private.gym_id())::text) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)))
  with check (((bucket_id = 'gym-logos'::text) AND ((storage.foldername(name))[1] = (private.gym_id())::text) AND ((auth.jwt() ->> 'app_role'::text) = 'owner'::text)));


CREATE OR REPLACE FUNCTION public.add_session_note(p_member_id uuid, p_note_text text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_coach_id uuid;
  v_assignment_id uuid;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'coach') then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'add_session_note: gym % is not active', v_caller_gym_id;
  end if;

  if p_note_text is null or btrim(p_note_text) = '' then
    raise exception 'add_session_note: note text is required';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_caller_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'add_session_note: caller is not a coach in this gym';
  end if;

  select id into v_assignment_id
  from coach_assignments
  where member_id = p_member_id and coach_id = v_coach_id and ended_at is null;

  if v_assignment_id is null then
    raise exception 'add_session_note: member % is not currently assigned to caller', p_member_id;
  end if;

  insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
  values (v_caller_gym_id, p_member_id, v_coach_id, v_assignment_id, btrim(p_note_text))
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.book_class_session(p_class_session_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_sub_status subscription_status;
  v_scheduled_at timestamptz;
  v_capacity integer;
  v_count integer;
  v_row class_bookings;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'book_class_session: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'book_class_session: caller is not a member';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'book_class_session: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'book_class_session: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring check_in()'s own deactivated_at guard: this
  -- RPC is reachable by any holder of a valid session token, not just
  -- through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'book_class_session: member is deactivated';
  end if;

  -- Subscription eligibility (AC #1) -- mirrors check_in()'s broader
  -- null/expired-only rejection, not a strict status = 'active' filter. See
  -- the story's Dev Notes "Subscription Eligibility" for the reasoning --
  -- this is a judgment call, flagged in docs/decisions.md.
  select status into v_sub_status
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_sub_status is null or v_sub_status = 'expired' then
    raise exception 'book_class_session: member has no active subscription';
  end if;

  -- Row-locked capacity check (AC #2, AD-21): locks the contested row (the
  -- session), matching check_in()'s lock-the-contested-row shape exactly.
  -- Uniform not-found failure covers nonexistent id and cross-gym id
  -- identically, matching this schema's uniform-deny-all-failure
  -- convention.
  select cs.scheduled_at, c.capacity into v_scheduled_at, v_capacity
  from class_sessions cs
  join classes c on c.id = cs.class_id
  where cs.id = p_class_session_id and cs.gym_id = v_gym_id
  for update of cs;

  if v_scheduled_at is null then
    raise exception 'book_class_session: session % not found', p_class_session_id;
  end if;

  if v_scheduled_at <= now() then
    raise exception 'book_class_session: cannot book a session that has already started or passed';
  end if;

  -- Duplicate-booking pre-check (friendly error, unique index is the
  -- concurrency backstop -- same dual-layer pattern check_in()'s
  -- open-session check plays against its own unique index). Checked before
  -- the capacity count below: the member's own existing booking already
  -- counts toward v_count, so checking capacity first would surface "class
  -- is full" instead of "already booked" for a member re-attempting to book
  -- a session they hold the last spot in.
  if exists (select 1 from class_bookings where class_session_id = p_class_session_id and member_id = v_member_id) then
    raise exception 'book_class_session: member already booked this session';
  end if;

  select count(*) into v_count from class_bookings where class_session_id = p_class_session_id;

  if v_count >= v_capacity then
    raise exception 'book_class_session: class is full';
  end if;

  insert into class_bookings (gym_id, class_session_id, member_id)
  values (v_gym_id, p_class_session_id, v_member_id)
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_class_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_found_id uuid;
  v_scheduled_at timestamptz;
  v_cutoff_minutes integer;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'cancel_class_booking: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'cancel_class_booking: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'cancel_class_booking: member is deactivated';
  end if;

  -- Gym- and member-scoped lookup, joined to its session's scheduled_at.
  -- This one query collapses "doesn't exist," "someone else's booking," and
  -- "wrong gym" into the same generic message -- deliberately matching
  -- updateClass's (Story 12.1) already-accepted not-found convention, not a
  -- new gap.
  select cb.id, cs.scheduled_at into v_found_id, v_scheduled_at
  from class_bookings cb
  join class_sessions cs on cs.id = cb.class_session_id
  where cb.id = p_booking_id and cb.gym_id = v_gym_id and cb.member_id = v_member_id;

  if v_found_id is null then
    raise exception 'cancel_class_booking: booking % not found', p_booking_id;
  end if;

  select class_booking_cancellation_cutoff_minutes into v_cutoff_minutes
  from gyms
  where id = v_gym_id;

  if now() >= v_scheduled_at - make_interval(mins => v_cutoff_minutes) then
    raise exception 'cancel_class_booking: cancellation cutoff has passed';
  end if;

  -- No row lock needed here (unlike booking): freeing a spot has no
  -- capacity race to guard against; a duplicate cancel attempt on an
  -- already-deleted row simply re-hits the not-found branch above.
  delete from class_bookings where id = v_found_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_in(p_scanned_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_client_scan_id uuid DEFAULT NULL::uuid)
 RETURNS attendance_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_status subscription_status;
  v_expiry_date date;
  v_timeout_hours integer;
  v_open_id uuid;
  v_open_checked_in_at timestamptz;
  v_checked_in_at timestamptz;
  v_row attendance_events;
  v_charging boolean;
  v_gate_outcome text;
  v_session_created_at timestamptz;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_in: no member record found for the caller';
  end if;

  -- Idempotent-replay short-circuit (Story 3.9 Scope Note #3). Must run
  -- immediately after v_member_id is resolved and before every guard/lock
  -- below -- if a sync retry (app killed after the server insert but before
  -- the local queue delete) reached the open-session lock block first, it
  -- would see ITS OWN prior successful insert as a blocking "already open"
  -- session and reject the replay with 'already has an open check-in'
  -- permanently, since retrying can never resolve a block caused by the
  -- retry's own earlier success. Short-circuiting here, before that block
  -- ever runs, avoids the trap entirely. The member_id match is a
  -- defense-in-depth ownership check (client_scan_id is a client-generated
  -- random UUID scoped to one member's one scan; this just guarantees a
  -- SECURITY DEFINER function can never hand back a different member's row
  -- even in a contrived collision).
  if p_client_scan_id is not null then
    select * into v_row from attendance_events
    where client_scan_id = p_client_scan_id and member_id = v_member_id;
    if v_row.id is not null then
      return v_row;
    end if;
  end if;

  -- Story 11.8: suspension gate, placed deliberately BELOW the replay
  -- short-circuit above and above every write below. Code review 2026-09-09:
  -- the guard originally sat before the member lookup, which put it ahead of
  -- the short-circuit and re-opened the exact trap that block exists to
  -- prevent -- a sync retry whose own earlier insert succeeded could never be
  -- confirmed, and apps/mobile's offline queue deleted the record as
  -- unrecoverable. Returning an already-committed row is a pure read, so
  -- AC #1's "raises and writes nothing" is not weakened by this placement.
  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'check_in: gym % is not active', v_gym_id;
  end if;

  -- Defense in depth, mirroring renew_subscription()'s deactivated_at guard
  -- (0022): the mobile root-layout session gate (use-session.ts) already
  -- excludes deactivated members from ever reaching this screen in the app
  -- UI, but this function is reachable by any holder of a valid session
  -- token, not just through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_in: member is deactivated';
  end if;

  -- Story 3.8 AC #3 / FR-031: reject expired (and no-subscription) members
  -- before doing any locking work below.
  select status, expiry_date into v_status, v_expiry_date
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    -- Story 4.6 AC #2 / FR-031: fire a red front-desk alert for the denied
    -- check-in instead of raising -- a null v_status (zero subscription
    -- rows, the "no plan" defensive case from 0027's own comment) maps to
    -- alert status 'expired', matching the existing "treated identically to
    -- expired" precedent.
    -- on conflict: idx_front_desk_alerts_one_active_per_member_kind_status
    -- (Review finding) -- a member who scans repeatedly while still
    -- expired gets one standing alert, not a fresh row per scan.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    return null;
  end if;

  -- 0111 kill switch: the charging flag is read here, before any V1.6 call
  -- or lock. Off (or null) keeps every line below byte-for-byte the 0110 path.
  select checkin_timeout_hours, charge_guests_per_session
  into v_timeout_hours, v_charging
  from gyms where id = v_gym_id;
  v_charging := coalesce(v_charging, false);

  -- 0111 canonical lock order: the member row (FOR NO KEY UPDATE) is taken
  -- before the open-session attendance_events lock below. Only when charging
  -- is on; consume_guest_session() re-locks it harmlessly.
  if v_charging then
    perform 1 from members where id = v_member_id for no key update;
  end if;

  -- for update: without this lock, two concurrent check_in() calls hitting
  -- the stale branch below could both read the same open row before either
  -- writes it, each auto-closing it and each calling log_audit_event() --
  -- duplicate audit rows for one auto-close. Locking here makes the second
  -- transaction block until the first commits, then re-evaluate the where
  -- clause against the now-closed row, correctly falling through to the
  -- unique-index rejection instead of double-processing it.
  select id, checked_in_at into v_open_id, v_open_checked_in_at
  from attendance_events
  where member_id = v_member_id and checked_out_at is null
  order by checked_in_at desc
  limit 1
  for update;

  if v_open_id is not null then
    if v_open_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
      -- Stale: auto-close it (AC #3) before recording the new check-in.
      update attendance_events
      set checked_out_at = v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          checkout_type = 'auto'
      where id = v_open_id;

      perform log_audit_event(
        p_action_type => 'attendance_stale_check_in_auto_closed',
        p_gym_id => v_gym_id,
        p_target_entity_id => v_open_id::text,
        p_target_entity_type => 'attendance_event',
        p_metadata => jsonb_build_object(
          'member_id', v_member_id,
          'original_checked_in_at', v_open_checked_in_at,
          'auto_closed_checked_out_at', v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          'timeout_hours', v_timeout_hours
        )
      );
    else
      -- Not stale: AC #2's rejection. The partial unique index above is the
      -- concurrent-request backstop for this same outcome, not the primary
      -- path -- this pre-check is what makes the common case a clean,
      -- specific error message rather than a raw constraint-violation string.
      raise exception 'check_in: member % already has an open check-in', v_member_id;
    end if;
  end if;

  -- 0111 gate (charging gyms only). Placed after the open-session handling
  -- so a stale auto-close above commits with a denied scan, and before the
  -- insert so a consumed session and its attendance row commit together.
  -- A denied scan returns null (never raises) so its attempt row and alert
  -- commit; the old contract reads null as "blocked". Never a coded row.
  if v_charging then
    select c.outcome, c.session_created_at
    into v_gate_outcome, v_session_created_at
    from private.consume_guest_session(v_member_id, v_gym_id, now()) c;

    if v_gate_outcome = 'denied' then
      -- One attempt per scan id (a retry of the same offline scan is
      -- conflict-skipped); a null scan id always records a new attempt.
      insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at)
      values (v_gym_id, v_member_id, p_client_scan_id, 'check_in', least(p_scanned_at, now()))
      on conflict (gym_id, member_id, scan_id) where scan_id is not null do nothing;

      -- One active session_required alert per member (status is null; the
      -- (member_id, kind, status) NULLS NOT DISTINCT index dedupes it).
      insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
      values (v_gym_id, v_member_id, 'session_required', null, null)
      on conflict (member_id, kind, status) where dismissed_at is null do nothing;

      return null;
    end if;
  end if;

  -- Clamp a future-dated client scan (clock skew) to now(); Story 3.9 Scope
  -- Note #2 -- checked_in_at must be the true scan time (arithmetic in the
  -- offline-immediate-stale-close block below only works against the real
  -- scan moment), a corrupted future-dated row from a wrong device clock is
  -- worse than silently treating it as "now".
  v_checked_in_at := coalesce(p_scanned_at, now());
  if v_checked_in_at > now() then
    v_checked_in_at := now();
  end if;

  -- 0111: for a session-covered check-in an offline scan time is trusted
  -- only inside the auto-timeout window of receipt and not before the
  -- covering session existed; otherwise server receipt time governs. An
  -- exempt member (or a flag-off gym) keeps the clamped scan time as before.
  if v_gate_outcome in ('consumed', 'covered')
    and p_scanned_at is not null
    and not (
      v_checked_in_at + make_interval(hours => v_timeout_hours) > now()
      and v_checked_in_at >= v_session_created_at
    )
  then
    v_checked_in_at := now();
  end if;

  insert into attendance_events (gym_id, member_id, checked_in_at, client_scan_id)
  values (v_gym_id, v_member_id, v_checked_in_at, p_client_scan_id)
  returning * into v_row;
  -- No ON CONFLICT needed -- the short-circuit above already handles the
  -- ordinary replay case. The partial unique index on client_scan_id still
  -- stands as a backstop against a true concurrency race (two simultaneous
  -- sync attempts for the same queued record); a 23505 in that narrow window
  -- surfaces as an ordinary RPC error, which the client's sync loop already
  -- treats as "leave queued, retry later" -- the next retry resolves cleanly
  -- via the short-circuit.

  -- Story 4.6 AC #1: fire a yellow front-desk alert for an accepted
  -- at-risk check-in, immediately after the attendance_events insert above
  -- succeeds -- not earlier. This ordering matters: an at-risk member who
  -- already has a non-stale open check-in is rejected by the `raise
  -- exception` in the open-session lock block further up, well before this
  -- line -- so this insert is simply never reached for that case, rather
  -- than being inserted and then silently rolled back by that later,
  -- unrelated exception.
  if v_status in ('expiring_soon', 'grace_period') then
    -- on conflict: same dedup guard as the expired branch above.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, v_status, v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
  end if;

  -- Offline-sync immediate-stale case (AC #2): only reachable for a freshly
  -- inserted row -- the replay path above already returned earlier.
  if p_scanned_at is not null and v_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
    update attendance_events
    set checked_out_at = v_checked_in_at + make_interval(hours => v_timeout_hours),
        checkout_type = 'auto'
    where id = v_row.id
    returning * into v_row;

    perform log_audit_event(
      p_action_type => 'attendance_stale_check_in_auto_closed',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_row.id::text,
      p_target_entity_type => 'attendance_event',
      p_metadata => jsonb_build_object(
        'member_id', v_member_id,
        'original_checked_in_at', v_checked_in_at,
        'auto_closed_checked_out_at', v_row.checked_out_at,
        'timeout_hours', v_timeout_hours,
        'source', 'offline_sync'
      )
    );
  end if;

  return v_row;
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.check_out()
 RETURNS attendance_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'check_out: gym % is not active', v_gym_id;
  end if;

  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_out: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring check_in()'s identical guard (0023): this
  -- function is reachable by any holder of a valid session token, not just
  -- through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_out: member is deactivated';
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = v_member_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out: member % has no open check-in', v_member_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.connect_gym_payment_credentials(p_provider_key text, p_api_key text, p_business_id text, p_webhook_secret text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_existing_id uuid;
  v_existing_secret_id uuid;
  v_secret_id uuid;
  v_masked text;
  v_plain text;
  v_secret_json text;
  v_platform_business_id text;
begin
  if (auth.jwt() ->> 'app_role') is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if not exists (select 1 from payment_providers where provider_key = p_provider_key) then
    raise exception 'connect_gym_payment_credentials: unknown provider_key %', p_provider_key;
  end if;

  if p_api_key is null or btrim(p_api_key) = ''
    or p_business_id is null or btrim(p_business_id) = ''
    or p_webhook_secret is null or btrim(p_webhook_secret) = '' then
    raise exception 'connect_gym_payment_credentials: credential values must not be blank';
  end if;

  -- Server-side bound matching the client's Zod max() guards -- the RPC is
  -- directly callable by any authenticated owner session, bypassing the
  -- client schema, so it must not rely solely on client-side validation
  -- (this codebase's own "Server Actions never trust client input"
  -- principle, applied here too).
  if length(p_api_key) > 500 or length(p_business_id) > 200 or length(p_webhook_secret) > 500 then
    raise exception 'connect_gym_payment_credentials: a credential value exceeds the maximum length';
  end if;

  v_plain := btrim(p_business_id);

  -- Platform-collision guard (Story 4.16), scoped to TaraMoney only -- the
  -- whole justification (TaraMoneyProvider.ts's businessId-based webhook
  -- routing) and the Vault secret name are TaraMoney-specific; a future
  -- second provider must not be rejected for an unrelated ID namespace.
  -- Absent secret => no-op, not a hard failure, so an unseeded environment's
  -- connect flow behaves exactly as it did before this story shipped.
  -- order by + limit 1 is defensive: this is the first name-keyed Vault
  -- lookup in this codebase (existing lookups join by primary-key id
  -- instead), so a re-seed resolves deterministically (most-recent wins)
  -- regardless of whether name-uniqueness is enforced upstream.
  -- btrim on the read side matches v_plain's own btrim, so a stray
  -- whitespace/newline introduced while seeding the secret can't silently
  -- defeat the comparison.
  if p_provider_key = 'taramoney' then
    select btrim(v.decrypted_secret) into v_platform_business_id
    from vault.decrypted_secrets v
    where v.name = 'platform:taramoney:business_id'
    order by v.created_at desc
    limit 1;

    if v_platform_business_id is not null and v_plain = v_platform_business_id then
      raise exception 'connect_gym_payment_credentials: business_id_plain matches the platform''s own account';
    end if;
  end if;

  -- A business_id of 4 characters or fewer would otherwise be fully
  -- revealed by right(x, 4) despite the "••••" prefix visually implying
  -- redaction -- NFR-017 says businessId must never be returned to any
  -- client. Real Tara Money business ids are far longer, so this only
  -- guards a defensive/direct-RPC-call edge case.
  v_masked := case
    when length(v_plain) > 4 then '•••• ' || right(v_plain, 4)
    else '••••'
  end;
  v_secret_json := jsonb_build_object(
    'apiKey', p_api_key,
    'businessId', p_business_id,
    'webhookSecret', p_webhook_secret
  )::text;

  -- Serialize concurrent connects for the same (gym, provider) so a
  -- first-time double-connect (double-click, two tabs) can't race between
  -- the existence check and the insert below -- `for update` alone cannot
  -- lock a row that doesn't exist yet, so without this lock both concurrent
  -- calls could see "no existing row" and both attempt `insert`, the second
  -- raising a raw unique-constraint violation instead of resolving cleanly.
  perform pg_advisory_xact_lock(hashtextextended(v_gym_id::text || ':' || p_provider_key, 0));

  select id, credentials_secret_id into v_existing_id, v_existing_secret_id
  from gym_payment_credentials
  where gym_id = v_gym_id and provider_key = p_provider_key
  for update;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_secret_id, v_secret_json);
    -- connected_at is also bumped here (not just set at insert time) --
    -- run_payment_reconciliation_job()'s wrong_account_settlement check
    -- anchors its comparison to this timestamp (review finding), so an
    -- in-place credential change (e.g. rotating to a different Tara Money
    -- account without an explicit disconnect first) must move the anchor
    -- too, or payments settled under the prior account would be retroactively
    -- flagged against the new one.
    update gym_payment_credentials
    set business_id_masked = v_masked,
      business_id_plain = v_plain,
      needs_attention = false,
      connected_by = auth.uid(),
      connected_at = now(),
      updated_at = now()
    where id = v_existing_id;
  else
    v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key);
    insert into gym_payment_credentials (
      gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain, connected_by
    )
    values (v_gym_id, p_provider_key, v_secret_id, v_masked, v_plain, auth.uid());
  end if;

  -- Metadata must never include the raw apiKey/businessId/webhookSecret
  -- values -- NFR-017's "never logged" extends to the audit trail.
  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_connected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked)
  );
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.create_staff_member(p_user_id uuid, p_name text, p_phone text, p_role member_role)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_existing members;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'create_staff_member: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();

  if v_caller_role = 'owner' then
    if p_role not in ('supervisor', 'manager', 'receptionist', 'coach') then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if p_role not in ('manager', 'receptionist', 'coach') then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  else
    raise exception 'create_staff_member: caller is not authorized to create staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_staff_member: gym % is not active', v_gym_id;
  end if;

  -- Story 9.4 (AC #1/#2): does `p_user_id` already have an *active* binding
  -- at this caller's own gym? Deliberately no `role` filter -- this matches
  -- `idx_members_active_gym_user` (0003_members_and_users.sql:39), the
  -- unique index this whole story is built around, which is itself
  -- role-agnostic. Matching a `role = 'member'` row here is intentional:
  -- it's what makes "promote an existing gym member to staff" fall through
  -- to the same replace-in-place branch as a staff-to-staff role change,
  -- closing the exact gap deferred-work.md's story-9-1 entry flagged.
  select *
  into v_existing
  from members
  where gym_id = v_gym_id
    and user_id = p_user_id
    and deactivated_at is null;

  if v_existing.id is not null then
    -- New self-targeting path (Story 9.4): before this story, this RPC
    -- could never legitimately target the caller's own row (there was no
    -- lookup-and-replace branch at all). An Owner/Supervisor typing their
    -- own phone number into the Add Staff form now resolves to their own
    -- `user_id`, finds their own active binding, and would otherwise
    -- silently rewrite their own name/role. Mirrors
    -- `update_staff_role()`'s self-edit block (0063:88-90) in spirit, but
    -- simpler -- no name-only carve-out, since there is no meaningful
    -- reason to "re-add yourself" through this specific form.
    if v_existing.user_id = auth.uid() then
      raise exception 'create_staff_member: cannot replace your own binding';
    end if;

    -- Target-role ceiling (security fix found while writing this story's own
    -- pgTAP suite -- see docs/decisions.md): the ceiling check above only
    -- constrains p_role (the *new* role being assigned), not the *existing*
    -- row's current role. Without this guard, a Supervisor could target an
    -- Owner's or another Supervisor's own active binding at this gym and
    -- replace it with e.g. 'manager', demoting them -- p_role = 'manager' is
    -- within the Supervisor's own allowlist, so the check above alone would
    -- let it through. Mirrors `deactivate_staff_member()`'s existing
    -- target-role ceiling shape (0063:234-240): Owner may replace any
    -- non-owner target; Supervisor may replace Manager/Receptionist/Coach/
    -- Member targets only, never Owner or another Supervisor.
    if v_existing.role = 'owner' then
      raise exception 'create_staff_member: caller is not authorized to replace a staff member with role %', v_existing.role;
    end if;
    if v_caller_role = 'supervisor' and v_existing.role = 'supervisor' then
      raise exception 'create_staff_member: caller is not authorized to replace a staff member with role %', v_existing.role;
    end if;

    -- AC #2: replace the existing binding in place, not a second row.
    -- Includes phone -- p_phone is the identity phone that resolved
    -- p_user_id in the first place, but v_existing.phone (this gym's own
    -- denormalized snapshot from whenever this row was originally created)
    -- can have drifted from it since, so refresh it here too (review finding).
    update members
    set name = p_name, role = p_role, phone = p_phone
    where id = v_existing.id
    returning * into v_row;

    -- Reuses update_staff_role()'s own 'staff_role_updated' action type
    -- (0063) for the identical underlying fact (a members row's role/name
    -- changed) rather than inventing a new audit action type -- see story
    -- Dev Notes "Reusing staff_role_updated, Not a New Audit Action Type".
    perform log_audit_event(
      p_action_type => 'staff_role_updated',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_row.id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'previous_role', v_existing.role,
        'new_role', p_role,
        'previous_name', v_existing.name,
        'new_name', p_name,
        'replaced_via', 'create_staff_member'
      )
    );

    return v_row;
  end if;

  -- No active binding at this gym for this user -- AC #1's cross-gym case
  -- (a brand-new binding for a person already bound at a different gym)
  -- and the genuinely-new-person case both fall through here, unchanged
  -- from 0061's original behavior.
  insert into members (gym_id, user_id, role, name, phone)
  values (v_gym_id, p_user_id, p_role, p_name, p_phone)
  returning * into v_row;

  perform log_audit_event(
    p_action_type => 'staff_created',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('target_role', p_role, 'target_name', p_name)
  );

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_gym_payment_credentials(p_provider_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_row_id uuid;
  v_secret_id uuid;
  v_masked text;
begin
  if (auth.jwt() ->> 'app_role') is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  delete from gym_payment_credentials
  where gym_id = v_gym_id and provider_key = p_provider_key
  returning id, credentials_secret_id, business_id_masked into v_row_id, v_secret_id, v_masked;

  if v_row_id is null then
    return;
  end if;

  delete from vault.secrets where id = v_secret_id;

  -- Review fix (Story 4.13): mirror connect's audit metadata shape --
  -- without it, an investigator reading the audit trail after a disconnect
  -- has no record of which masked business id was disconnected (the
  -- gym_payment_credentials row and the Vault secret are both already gone
  -- by this point).
  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_disconnected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.edit_session_note(p_note_id uuid, p_note_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_coach_id uuid;
  v_member_id uuid;
  v_updated_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'coach') then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'edit_session_note: gym % is not active', v_caller_gym_id;
  end if;

  if p_note_text is null or btrim(p_note_text) = '' then
    raise exception 'edit_session_note: note text is required';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_caller_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'edit_session_note: caller is not a coach in this gym';
  end if;

  select member_id into v_member_id
  from session_notes
  where id = p_note_id and gym_id = v_caller_gym_id and coach_id = v_coach_id;

  if v_member_id is null or not private.is_assigned_coach(v_member_id) then
    raise exception 'edit_session_note: note % not found or not owned by caller', p_note_id;
  end if;

  update session_notes
  set note_text = btrim(p_note_text), edited_at = now()
  where id = p_note_id and gym_id = v_caller_gym_id and coach_id = v_coach_id
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'edit_session_note: note % not found or not owned by caller', p_note_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.initiate_member_payment()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_subscription_status text;
  v_plan_price integer;
  v_plan_currency text;
  v_provider_key text;
  v_payment_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_member_payment: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: same idx_members_active_gym_user
  -- (0003) uniqueness caveat check_in() already documents -- prefer an
  -- active row over a deactivated historical one if both somehow coexist.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'initiate_member_payment: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'initiate_member_payment: member is deactivated';
  end if;

  -- Review finding: without this, a double-tap, a retry after a client-side
  -- failure, or two devices on the same account could each create their own
  -- `processing` row and fire a second real USSD prompt -- the one-open-
  -- payment-at-a-time analogue of check_in()'s one-open-session enforcement
  -- this function otherwise mirrors.
  if exists (
    select 1 from payments where member_id = v_member_id and status = 'processing'
  ) then
    raise exception 'initiate_member_payment: payment_already_pending for member %', v_member_id;
  end if;

  -- Mirrors apps/dashboard/services/payments.ts's initiatePayment() join
  -- exactly: subscriptions -> plans is a many-to-one FK, so a plain join
  -- (not an array) is correct here. Most-recent-by-created_at, same
  -- "renewal resolves to the new row" precedent as check_in()'s own
  -- subscription-status guard.
  select s.status, p.price, p.currency into v_subscription_status, v_plan_price, v_plan_currency
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.gym_id = v_gym_id and s.member_id = v_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_price is null then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  -- Review finding: the Home CTA only *offers* Renew for expiring_soon/
  -- grace_period/expired -- without this check, any member session could
  -- call this RPC directly (bypassing the UI) and self-initiate a charge
  -- while their subscription is still fully active.
  if v_subscription_status not in ('expiring_soon', 'grace_period', 'expired') then
    raise exception 'initiate_member_payment: not_eligible_for_renewal for member %', v_member_id;
  end if;

  -- Review finding: planSchema explicitly allows a zero-price (free/comp)
  -- plan -- without this, a free-plan member would still get a real
  -- `processing` row and a real 0-amount mobile-money charge attempt.
  if v_plan_price <= 0 then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  select active_payment_provider() into v_provider_key;
  if v_provider_key is null then
    raise exception 'initiate_member_payment: no_active_provider';
  end if;

  insert into payments (gym_id, member_id, amount, currency, method, status, provider)
  values (v_gym_id, v_member_id, v_plan_price, v_plan_currency, 'mobile_money', 'processing', v_provider_key)
  returning id into v_payment_id;

  return v_payment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.initiate_registration_fee_payment(p_member_id uuid)
 RETURNS TABLE(payment_id uuid, provider_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_fee integer;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_fee_status payment_status;
  v_provider text;
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
    raise exception 'initiate_registration_fee_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := auth.uid();

  -- Payment row before member row (lock order), so an expired attempt is
  -- flagged before the member lock is taken.
  perform private.expire_stale_registration_fee_payment(p_member_id, v_gym_id);

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

  select p.status into v_fee_status
  from payments p
  where p.member_id = p_member_id
    and p.purpose = 'registration_fee'
    and p.voided_at is null
    and p.status <> 'flagged'
  limit 1;

  if found then
    if v_fee_status = 'processing' then
      raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
    end if;
    raise exception 'registration_fee_already_recorded: member % already has a registration fee payment', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  select g.registration_fee into v_fee from gyms g where g.id = v_gym_id;

  if coalesce(v_fee, 0) <= 0 then
    raise exception 'registration_fee_not_configured: gym % charges no registration fee', v_gym_id;
  end if;

  select active_payment_provider() into v_provider;
  if v_provider is null then
    raise exception 'initiate_registration_fee_payment: no_active_provider';
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose)
    values (v_gym_id, p_member_id, null, v_fee, 'XAF', 'mobile_money', 'processing', v_provider, v_actor_id, 'registration_fee')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
  end;

  payment_id := v_payment_id;
  provider_key := v_provider;
  return next;
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_bookable_class_sessions()
 RETURNS TABLE(class_session_id uuid, class_name text, description text, coach_name text, scheduled_at timestamp with time zone, capacity integer, booked_count bigint, my_booking_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'list_bookable_class_sessions: caller is not a member';
  end if;
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'list_bookable_class_sessions: caller is not a member';
  end if;
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first limit 1;
  if v_member_id is null then
    raise exception 'list_bookable_class_sessions: no member record found for the caller';
  end if;
  if v_deactivated_at is not null then
    raise exception 'list_bookable_class_sessions: member is deactivated';
  end if;

  return query
  select cs.id, c.name, c.description, coach.name, cs.scheduled_at, c.capacity,
         (select count(*) from class_bookings cb where cb.class_session_id = cs.id),
         (select cb.id from class_bookings cb where cb.class_session_id = cs.id and cb.member_id = v_member_id)
  from class_sessions cs
  join classes c on c.id = cs.class_id
  join members coach on coach.id = c.coach_id
  where cs.gym_id = v_gym_id and cs.scheduled_at > now()
  order by cs.scheduled_at asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_class_bookings()
 RETURNS TABLE(booking_id uuid, class_name text, scheduled_at timestamp with time zone, can_cancel boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'list_my_class_bookings: caller is not a member';
  end if;
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'list_my_class_bookings: caller is not a member';
  end if;
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first limit 1;
  if v_member_id is null then
    raise exception 'list_my_class_bookings: no member record found for the caller';
  end if;
  if v_deactivated_at is not null then
    raise exception 'list_my_class_bookings: member is deactivated';
  end if;

  return query
  select cb.id, c.name, cs.scheduled_at,
         (now() < cs.scheduled_at - make_interval(mins => g.class_booking_cancellation_cutoff_minutes))
  from class_bookings cb
  join class_sessions cs on cs.id = cb.class_session_id
  join classes c on c.id = cs.class_id
  join gyms g on g.id = cb.gym_id
  where cb.member_id = v_member_id and cb.gym_id = v_gym_id and cs.scheduled_at > now()
  order by cs.scheduled_at asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_class_attendance(p_booking_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_booking_id uuid;
  v_member_id uuid;
  v_class_session_id uuid;
  v_attended_at timestamptz;
  v_status subscription_status;
  v_expiry_date date;
  v_row class_bookings;
  v_charging boolean;
  v_gate_outcome text;
begin
  -- Include supervisor here too, for the same reason as the RLS widening
  -- above (this is new code; match the current UX matrix, don't perpetuate
  -- the pre-Supervisor gap into it). Explicitly excludes coach, matching
  -- the Attendance/Classes-attendance role matrix row.
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'supervisor'])) then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'mark_class_attendance: gym % is not active', v_gym_id;
  end if;

  -- Gym-scoped booking lookup. Uniform not-found failure covers a
  -- nonexistent id and a cross-gym id identically, matching
  -- cancel_class_booking()'s collapsed not-found convention.
  select cb.id, cb.member_id, cb.class_session_id, cb.attended_at
  into v_booking_id, v_member_id, v_class_session_id, v_attended_at
  from class_bookings cb
  where cb.id = p_booking_id and cb.gym_id = v_gym_id;

  if v_booking_id is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
  end if;

  -- 0112: an already-attended booking returns the stored row and consumes
  -- nothing (also with the charging flag off); attended_at is never rewritten.
  if v_attended_at is not null then
    select * into v_row from class_bookings where id = v_booking_id;
    return v_row;
  end if;

  -- Subscription eligibility (AC #3), copied from book_class_session()'s
  -- exact query/branch -- reject only null/expired, not a stricter
  -- active-only filter (expiring_soon/grace_period can still be marked
  -- attended).
  select status, expiry_date into v_status, v_expiry_date
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    -- Copies check_in()'s exact rejection branch verbatim (0034), including
    -- the on-conflict dedup and the null-v_status-maps-to-'expired'-alert
    -- reasoning -- a booked member with zero subscription rows is the same
    -- defensive "no plan" case check_in() already handles. Does not raise --
    -- returning null on rejection matches check_in()'s own contract, which
    -- callers must handle explicitly.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    return null;
  end if;

  -- 0112 kill switch: the charging flag is read here, before any V1.6 call
  -- or lock. Off (or null) skips the consume/gate/attempt/alert/lock path below
  -- (the already-attended return above and the update guard below still
  -- apply to every gym).
  select g.charge_guests_per_session into v_charging
  from gyms g where g.id = v_gym_id;
  v_charging := coalesce(v_charging, false);

  if v_charging then
    -- Canonical lock order: class_sessions, then member (FOR NO KEY UPDATE).
    perform 1 from class_sessions where id = v_class_session_id for no key update;
    perform 1 from members where id = v_member_id for no key update;

    -- A concurrent mark of the same booking may have committed while this
    -- call waited for the locks: return the stored row, consume nothing.
    select * into v_row from class_bookings where id = v_booking_id;
    if v_row.id is null then
      raise exception 'mark_class_attendance: booking % not found', p_booking_id;
    end if;
    if v_row.attended_at is not null then
      return v_row;
    end if;

    select c.outcome into v_gate_outcome
    from private.consume_guest_session(v_member_id, v_gym_id, now()) c;

    if v_gate_outcome = 'denied' then
      -- A denied class mark commits (never raises): one attempt row (fresh
      -- scan id, so every refusal counts) and one active session_required
      -- alert per member (null status; NULLS NOT DISTINCT one-active index).
      insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at, class_session_id)
      values (v_gym_id, v_member_id, gen_random_uuid(), 'class', now(), v_class_session_id);

      insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
      values (v_gym_id, v_member_id, 'session_required', null, null)
      on conflict (member_id, kind, status) where dismissed_at is null do nothing;

      -- attended_at stays null: that is the refusal signal to the caller.
      return v_row;
    end if;
  end if;

  -- Review fix: the booking could still be deleted (cancel_class_booking())
  -- between the existence check above and this update -- without the
  -- not-found recheck, a 0-row update leaves v_row an all-null composite,
  -- indistinguishable from the expired-member rejection shape once it
  -- crosses the PostgREST/JSON boundary.
  update class_bookings set attended_at = now()
  where id = v_booking_id and attended_at is null
  returning * into v_row;

  if v_row.id is null then
    -- Either deleted, or a concurrent mark won the race (flag-off path).
    select * into v_row from class_bookings where id = v_booking_id;
    if v_row.id is null then
      raise exception 'mark_class_attendance: booking % not found', p_booking_id;
    end if;
  end if;

  return v_row;
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.member_occupancy_band()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  return private.gym_occupancy_band(v_gym_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.guest_sessions_period(p_period text)
 RETURNS TABLE(window_start timestamp with time zone, window_end timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tz text;
begin
  if private.current_member_role() is null
     or private.current_member_role() not in ('owner', 'supervisor', 'manager') then
    raise exception 'guest_sessions: permission denied' using errcode = '42501';
  end if;

  if p_period is null or p_period not in ('today', 'month') then
    raise exception 'guest_sessions: invalid period %', coalesce(p_period, '<null>') using errcode = '22023';
  end if;

  select g.timezone into v_tz from gyms g where g.id = private.gym_id();
  if v_tz is null then
    return;
  end if;

  if p_period = 'today' then
    return query
      select b.day_start, b.next_day_start
      from private.gym_local_day_bounds(v_tz, now()) b;
  else
    return query
      select b.month_start, b.next_month_start
      from private.gym_local_month_bounds(v_tz, now()) b;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_payment_columns_on_staff_verify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.status = 'pending' and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist']) then
    new.gym_id := old.gym_id;
    new.member_id := old.member_id;
    new.amount := old.amount;
    new.currency := old.currency;
    new.method := old.method;
    new.reason := old.reason;
    new.actor_id := old.actor_id;
    new.subscription_id := old.subscription_id;
    new.provider := old.provider;
    new.provider_transaction_ref := old.provider_transaction_ref;
    new.provider_fee_amount := old.provider_fee_amount;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_registration_fee(p_member_id uuid, p_method text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_fee integer;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_reason text;
  v_fee_status payment_status;
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

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or v_reason = '' then
    raise exception 'record_registration_fee: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'record_registration_fee: reason is too long';
  end if;

  -- Payment row before member row (lock order): flag an expired Tara attempt
  -- before the member lock is taken.
  perform private.expire_stale_registration_fee_payment(p_member_id, v_gym_id);

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

  select p.status into v_fee_status
  from payments p
  where p.member_id = p_member_id
    and p.purpose = 'registration_fee'
    and p.voided_at is null
    and p.status <> 'flagged'
  limit 1;

  if found then
    if v_fee_status = 'processing' then
      raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
    end if;
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
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.set_registration_fee(p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old integer;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_registration_fee: gym % is not active', v_gym_id;
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'set_registration_fee: invalid_amount';
  end if;

  select g.registration_fee into v_old from gyms g where g.id = v_gym_id for update;

  if v_old is not distinct from p_amount then
    return;
  end if;

  perform set_config('app.registration_fee_update_bypass', 'true', true);

  update gyms set registration_fee = p_amount where id = v_gym_id;

  perform set_config('app.registration_fee_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'registration_fee_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_amount', v_old, 'new_amount', p_amount)
  );
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.update_staff_role(p_member_id uuid, p_name text, p_role member_role)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_target members;
  v_row members;
  v_is_self_edit boolean;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'update_staff_role: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();

  select *
  into v_target
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'update_staff_role: target not found or not eligible';
  end if;

  v_is_self_edit := (v_target.user_id = auth.uid());

  if v_is_self_edit and p_role is distinct from v_target.role then
    raise exception 'update_staff_role: cannot edit your own role';
  end if;

  -- New (Story 9.4): target-role ceiling, scoped to skip the self-edit case
  -- (a legitimate name-only self-edit of an Owner's/Supervisor's own row
  -- must not be blocked by a check on their own row's role -- the self-edit
  -- block immediately above already governs that case).
  if not v_is_self_edit then
    if v_target.role = 'owner' then
      raise exception 'update_staff_role: caller is not authorized to edit a staff member with role %', v_target.role;
    end if;
    if v_caller_role = 'supervisor' and v_target.role = 'supervisor' then
      raise exception 'update_staff_role: caller is not authorized to edit a staff member with role %', v_target.role;
    end if;
  end if;

  if p_role is null then
    raise exception 'update_staff_role: p_role is required';
  end if;

  if v_caller_role = 'owner' then
    if not (v_is_self_edit and p_role = v_target.role) and p_role not in ('supervisor', 'manager', 'receptionist', 'coach') then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if not (v_is_self_edit and p_role = v_target.role) and p_role not in ('manager', 'receptionist', 'coach') then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  else
    raise exception 'update_staff_role: caller is not authorized to edit staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_staff_role: gym % is not active', v_gym_id;
  end if;

  perform set_config('app.staff_role_update_bypass', 'true', true);
  update members
  set name = p_name, role = p_role
  where id = p_member_id
  returning * into v_row;
  perform set_config('app.staff_role_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'staff_role_updated',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'previous_role', v_target.role,
      'new_role', p_role,
      'previous_name', v_target.name,
      'new_name', p_name
    )
  );

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_registration_fee_payment(p_payment_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.waive_registration_fee(p_member_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or v_reason = '' then
    raise exception 'waive_registration_fee: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'waive_registration_fee: reason is too long';
  end if;

  -- Payment row before member row (lock order).
  perform private.expire_stale_registration_fee_payment(p_member_id, v_gym_id);

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
      and p.status = 'processing'
  ) then
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.log_audit_event(p_action_type text, p_gym_id uuid DEFAULT NULL::uuid, p_target_entity_id text DEFAULT NULL::text, p_target_entity_type text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_system_actor_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id uuid;
  v_actor_display_name text;
  v_caller_gym_id uuid;
  v_caller_is_super_admin boolean;
  v_id uuid;
begin
  v_actor_id := auth.uid();

  if v_actor_id is not null then
    select u.display_name into v_actor_display_name
    from public.users u
    where u.id = v_actor_id;

    if v_actor_display_name is null or v_actor_display_name = '' then
      select m.name into v_actor_display_name
      from members m
      where m.user_id = v_actor_id
        and m.gym_id = private.gym_id()
        and m.deactivated_at is null
      order by m.created_at desc, m.id desc
      limit 1;
    end if;

    v_actor_display_name := coalesce(nullif(v_actor_display_name, ''), 'Unknown User');

    v_caller_gym_id := private.gym_id();
    v_caller_is_super_admin := private.is_super_admin_live();

    if not v_caller_is_super_admin
       and v_caller_gym_id is not null
       and p_gym_id is not null
       and p_gym_id is distinct from v_caller_gym_id then
      raise exception 'log_audit_event: p_gym_id does not match the caller''s own gym';
    end if;
  else
    v_actor_display_name := coalesce(p_system_actor_label, 'system:' || p_action_type);
  end if;

  insert into audit_log (
    gym_id, actor_id, actor_display_name, action_type,
    target_entity_id, target_entity_type, metadata
  )
  values (
    p_gym_id, v_actor_id, v_actor_display_name, p_action_type,
    p_target_entity_id, p_target_entity_type, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$function$;

alter policy "tenant_active_gate" on public.attendance_events
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_audit_log" on public.audit_log
  using (private.is_super_admin());

alter policy "tenant_active_gate" on public.audit_log
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "tenant_active_gate" on public.class_bookings
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "gym_staff_read_own_class_sessions" on public.class_sessions
  using ((gym_id = private.gym_id()));

alter policy "tenant_active_gate" on public.class_sessions
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "gym_staff_read_own_classes" on public.classes
  using ((gym_id = private.gym_id()));

alter policy "tenant_active_gate" on public.classes
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "tenant_active_gate" on public.coach_assignments
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "authenticated_read_exercise_library" on public.exercise_library
  using (((gym_id IS NULL) OR (gym_id = private.gym_id())));

alter policy "coach_insert_own_gym_exercise_library" on public.exercise_library
  with check (((gym_id = private.gym_id()) AND (private.current_member_role() = 'coach'::member_role)));

alter policy "tenant_active_gate" on public.front_desk_alerts
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "gym_staff_read_own_guest_sessions" on public.guest_sessions
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role, 'receptionist'::member_role]))));

alter policy "member_read_own_guest_sessions" on public.guest_sessions
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'member'::member_role) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = guest_sessions.member_id) AND (m.user_id = auth.uid()))))));

alter policy "tenant_active_gate" on public.guest_sessions
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_gym_data_escalations" on public.gym_data_escalations
  using (private.is_super_admin());

alter policy "read own gym" on public.gyms
  using ((id = private.gym_id()));

alter policy "super_admin_delete_orphaned_gyms" on public.gyms
  using ((private.is_super_admin() AND (NOT (EXISTS ( SELECT 1
   FROM members m
  WHERE (m.gym_id = gyms.id))))));

alter policy "super_admin_insert_gyms" on public.gyms
  with check (private.is_super_admin());

alter policy "super_admin_read_all_gyms" on public.gyms
  using (private.is_super_admin());

alter policy "super_admin_update_gyms" on public.gyms
  using (private.is_super_admin())
  with check (private.is_super_admin());

alter policy "gym_staff_read_own_loyalty_events" on public.loyalty_events
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role, 'receptionist'::member_role]))));

alter policy "member_read_own_loyalty_events" on public.loyalty_events
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'member'::member_role) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = loyalty_events.member_id) AND (m.user_id = auth.uid()))))));

alter policy "tenant_active_gate" on public.loyalty_events
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "gym_staff_read_own_loyalty_progress" on public.loyalty_progress
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role, 'receptionist'::member_role]))));

alter policy "member_read_own_loyalty_progress" on public.loyalty_progress
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'member'::member_role) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = loyalty_progress.member_id) AND (m.user_id = auth.uid()))))));

alter policy "tenant_active_gate" on public.loyalty_progress
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "tenant_active_gate" on public.member_preferences
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "gym_staff_read_own_members" on public.members
  using (((gym_id = private.gym_id()) AND (private.current_gym_status() = 'active'::gym_status) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'receptionist'::member_role, 'supervisor'::member_role]))));

alter policy "self_update_own_member_onboarding_fields" on public.members
  using (((user_id = auth.uid()) AND (gym_id = private.gym_id())))
  with check (((user_id = auth.uid()) AND (gym_id = private.gym_id())));

alter policy "super_admin_escalated_read_members" on public.members
  using ((private.is_super_admin() AND private.has_active_gym_data_escalation(gym_id)));

alter policy "super_admin_insert_owner_member" on public.members
  with check ((private.is_super_admin() AND (role = 'owner'::member_role)));

alter policy "super_admin_read_owner_members" on public.members
  using ((private.is_super_admin() AND (role = 'owner'::member_role)));

alter policy "tenant_active_gate" on public.members
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_messaging_config" on public.messaging_provider_config
  using (private.is_super_admin());

alter policy "tenant_active_gate" on public.notifications
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_payment_discrepancies" on public.payment_discrepancies
  using (private.is_super_admin());

alter policy "tenant_active_gate" on public.payment_discrepancies
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_payment_providers" on public.payment_providers
  using (private.is_super_admin());

alter policy "super_admin_escalated_read_payments" on public.payments
  using ((private.is_super_admin() AND private.has_active_gym_data_escalation(gym_id)));

alter policy "tenant_active_gate" on public.payments
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "gym_staff_read_own_plans" on public.plans
  using ((gym_id = private.gym_id()));

alter policy "tenant_active_gate" on public.plans
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_platform_session_config" on public.platform_session_config
  using (private.is_super_admin());

alter policy "super_admin_update_platform_session_config" on public.platform_session_config
  using (private.is_super_admin())
  with check (private.is_super_admin());

alter policy "coach_read_assigned_progress_entries" on public.progress_entries
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'coach'::member_role) AND private.is_assigned_coach(member_id)));

alter policy "tenant_active_gate" on public.progress_entries
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "coach_read_shared_progress_photos" on public.progress_photos
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'coach'::member_role) AND private.is_assigned_coach(member_id) AND (shared_with_coach = true)));

alter policy "tenant_active_gate" on public.progress_photos
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "tenant_active_gate" on public.refunds
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_read_saas_billing_notices" on public.saas_billing_notices
  using (private.is_super_admin());

alter policy "owner_read_own_gym_saas_billing_payments" on public.saas_billing_payments
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'owner'::member_role)));

alter policy "super_admin_read_saas_billing_payments" on public.saas_billing_payments
  using (private.is_super_admin());

alter policy "gym_staff_read_own_session_attempts" on public.session_attempts
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role, 'receptionist'::member_role]))));

alter policy "tenant_active_gate" on public.session_attempts
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "tenant_active_gate" on public.session_notes
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "tenant_active_gate" on public.subscriptions
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "super_admin_delete_tiers" on public.tiers
  using (private.is_super_admin());

alter policy "super_admin_insert_tiers" on public.tiers
  with check (private.is_super_admin());

alter policy "super_admin_read_tiers" on public.tiers
  using (private.is_super_admin());

alter policy "super_admin_update_tiers" on public.tiers
  using (private.is_super_admin())
  with check (private.is_super_admin());

alter policy "coach_read_assigned_workout_plan_completions" on public.workout_plan_completions
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'coach'::member_role) AND private.is_assigned_coach(member_id)));

alter policy "manager_or_owner_read_own_workout_plan_completions" on public.workout_plan_completions
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role]))));

alter policy "tenant_active_gate" on public.workout_plan_completions
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "coach_read_assigned_workout_plan_exercises" on public.workout_plan_exercises
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'coach'::member_role) AND private.is_assigned_coach(member_id)));

alter policy "manager_or_owner_read_own_workout_plan_exercises" on public.workout_plan_exercises
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role]))));

alter policy "tenant_active_gate" on public.workout_plan_exercises
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "coach_read_assigned_workout_plan" on public.workout_plans
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = 'coach'::member_role) AND private.is_assigned_coach(member_id)));

alter policy "manager_or_owner_read_own_workout_plan" on public.workout_plans
  using (((gym_id = private.gym_id()) AND (private.current_member_role() = ANY (ARRAY['owner'::member_role, 'manager'::member_role, 'supervisor'::member_role]))));

alter policy "tenant_active_gate" on public.workout_plans
  using (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()))
  with check (((private.current_gym_status() = 'active'::gym_status) OR private.is_super_admin()));

alter policy "coach_select_shared_progress_photo" on storage.objects
  using (((bucket_id = 'progress-photos'::text) AND (private.current_member_role() = 'coach'::member_role) AND (EXISTS ( SELECT 1
   FROM progress_photos pp
  WHERE ((pp.photo_path = objects.name) AND (pp.shared_with_coach = true) AND (pp.gym_id = private.gym_id()) AND private.is_assigned_coach(pp.member_id))))));


do $verify$
begin
  if exists (select 1 from pg_trigger where tgname = 'payments_member_same_gym') then
    raise exception 'rollback 0124: payments_member_same_gym trigger still present';
  end if;
  if (select prosrc from pg_proc where oid = 'private.is_super_admin()'::regprocedure) like '%users%' then
    raise exception 'rollback 0124: is_super_admin() still reads users';
  end if;
end
$verify$;
