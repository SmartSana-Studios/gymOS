-- Story 5.1: Coach Member Assignment (FR-055, FR-080). Manager/Owner assigns
-- an existing coach-role `members` row to an existing member-role `members`
-- row. `assign_coach()` is both the "assign" and "reassign" path -- ending
-- the member's current active assignment (if any) and starting a new one
-- atomically in one SECURITY DEFINER call, mirroring `renew_subscription()`'s
-- (0022) shape: role check first, then a gym-scoped lookup with a uniform
-- not-found failure mode, then the write, then an embedded log_audit_event()
-- call. No "unassign" operation exists -- no AC asks for one.

create table coach_assignments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  coach_id uuid not null references members(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_coach_assignments_gym_id on coach_assignments(gym_id);
create index idx_coach_assignments_member_id on coach_assignments(member_id);
create index idx_coach_assignments_coach_id on coach_assignments(coach_id);

-- FR-055: "at most one active coach per member" -- enforced the same way
-- idx_members_active_gym_user (0003) enforces "at most one active
-- membership per gym per user": a partial unique index, not an app-side check.
create unique index idx_coach_assignments_active_member on coach_assignments(member_id) where ended_at is null;

alter table coach_assignments enable row level security;

-- Full CRUD grant, same as every deny-all table in this schema (job_runs,
-- 0008) -- writes are blocked by RLS having zero write policies, not by
-- withholding the grant. A direct authenticated UPDATE/DELETE attempt is
-- silently filtered to 0 affected rows, matching every other table's
-- write-path deny-all shape; a direct INSERT still raises a real
-- "row-level security" error regardless (WITH CHECK's implicit `false` when
-- no policy applies -- INSERT has no existing row to filter against, unlike
-- UPDATE/DELETE, per rls_tenant_isolation.test.sql's own documented
-- distinction), but it is that RLS-flavored error -- the one every other
-- table's INSERT-denial test in this codebase expects
-- (throws_like('%row-level security%')) -- not a bare grant-level
-- "permission denied for table" a SELECT-only grant would have produced
-- instead. assign_coach() below is the sole write path in practice
-- (SECURITY DEFINER, runs as the owning role,
-- unaffected by the caller's own grants) -- no INSERT/UPDATE/DELETE RLS
-- policy is ever added for `authenticated`, only the SELECT policy below.
grant select, insert, update, delete on coach_assignments to authenticated, service_role;

-- AC #3: Manager/Owner can query a member's full assignment history.
-- Coach's own narrower self-read (their assigned members only) is
-- explicitly Story 5.2's job -- do not add it here.
create policy "manager_or_owner_read_own_coach_assignments" on coach_assignments
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

-- assign_coach(): sole write path into coach_assignments. Modeled directly on
-- renew_subscription()'s (0022_manual_renewal_reset.sql) shape -- role check
-- first (cheapest, no data read), then a gym-scoped lookup with a uniform
-- not-found failure mode (never let a cross-gym id distinguish "wrong gym"
-- from "doesn't exist" -- same tenant-isolation-enumeration-avoidance
-- principle renew_subscription's own comment documents), then the write,
-- then an embedded log_audit_event() call (satisfies AC #4 atomically in the
-- same transaction as the state change).
create function assign_coach(p_member_id uuid, p_coach_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_coach_gym_id uuid;
  v_previous_coach_id uuid;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
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
$$;

revoke execute on function assign_coach from public;
grant execute on function assign_coach to authenticated;
