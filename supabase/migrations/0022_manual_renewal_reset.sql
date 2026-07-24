-- Story 3.2: Manual Renewal Reset. Backend-only, mirroring Story 3.1's own
-- precedent (no dashboard Subscriptions page/UI -- that's Epic 4, Stories
-- 4.7/4.8). See the story file's Scope Notes for the full design rationale.

-- ============================================================================
-- renew_subscription(): resets a member's subscription to `active` with a
-- new expiry date, by INSERTing a new `subscriptions` row rather than
-- UPDATEing the member's existing row.
--
-- Renewal-as-history, not renewal-as-mutation: architecture.md's Entity
-- Relationships section is explicit ("members (1) --< subscriptions # a
-- member's plan history over time"), and apps/dashboard/services/members.ts
-- already reads subscriptions defensively via
-- `.order("created_at", ...).limit(1, ...)` ("most recent" pattern) even
-- though today exactly one row is ever created per member. The prior row is
-- left untouched -- whatever terminal status it had stays an accurate
-- historical record -- and the new row becomes "current" purely by having
-- the newest created_at.
--
-- SECURITY DEFINER with a self-enforced role+tenant check, not a widened RLS
-- policy: the existing manager_or_owner_insert_own_subscriptions policy
-- (0018_member_management.sql) only allows manager/owner to INSERT into
-- subscriptions, but this story's actor list explicitly includes
-- Receptionist. Rather than widen that policy (raw INSERT rights on
-- subscriptions for Receptionist), this function is SECURITY DEFINER and
-- self-checks the caller's role internally -- mirrors enforce_member_cap()
-- (0018) and platform_metrics()/super_admin_job_failures() (0011/0021)'s
-- established pattern in this codebase. Receptionist's blast radius stays
-- narrow: they gain the ability to call this one controlled, audited
-- function, not generic raw INSERT rights on subscriptions.
--
-- Guard ordering: role check first (cheapest, no data read), then the
-- member lookup itself is gym-scoped (folds the tenant match into the query
-- rather than a separate post-check, so a cross-gym member id reports the
-- same "not found" as a nonexistent one -- avoids a member-existence
-- enumeration channel across tenants; mirrors log_audit_event()'s own
-- tenant-isolation intent), then the deactivated-member guard, then the
-- reason guard, then the actual work.
--
-- Reuses the same plan_id as the member's most recent prior subscription --
-- no plan-switching-at-renewal in this story (no AC asks for it; YAGNI).
--
-- Does not reject renewing an already-`active` member -- no AC restricts
-- this to non-active members only, and a gym may legitimately want to let
-- someone renew early.
--
-- Deactivated members cannot be renewed: prevents an inconsistent state
-- where members.deactivated_at is set but subscriptions.status = 'active'.
-- There is no "reactivate member" feature anywhere in this codebase --
-- deactivation is one-way in V1.
--
-- Compatibility with existing constraints: start_date = current_date and
-- expiry_date = current_date + v_duration_days (v_duration_days > 0,
-- enforced by plans_duration_days_matches_plan_type, 0017) always satisfies
-- 0021's subscriptions_expiry_after_start CHECK
-- (expiry_date is null or expiry_date > start_date) and 0018's
-- enforce_subscription_expiry_matches_plan_type trigger (null iff
-- pay-per-session) without any extra handling.
--
-- Timezone note (accepted simplification, matching Story 3.1's own
-- precedent): current_date is evaluated in the DB session's default
-- timezone (UTC), not the gym's timezone column (Africa/Douala, UTC+1, no
-- DST) -- a pre-existing, accepted gap (deferred-work.md: "gyms.timezone is
-- joined but unused in the date math"), not something this story introduces.
--
-- No double-submit/concurrency guard: matches architecture.md's own
-- "Retries" convention (no automatic retry on mutations; user-initiated
-- only, mitigated at the UI submit-button layer) and Story 3.1's identical
-- precedent (no advisory lock). Not reachable in this story anyway since no
-- UI exists yet to double-click; Epic 4's future panel owns that mitigation.
-- ============================================================================
create function renew_subscription(p_member_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
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
$$;

-- Self-checks role internally (see function body) -- matches
-- super_admin_job_failures()'s exact grant shape (0021). No grant to anon or
-- service_role.
revoke execute on function renew_subscription from public;
grant execute on function renew_subscription to authenticated;
