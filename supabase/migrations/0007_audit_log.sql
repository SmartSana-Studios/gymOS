-- Append-only audit log foundation (Story 1.4). This table and the grant-level
-- REVOKE below exist before any feature epic ships, so every subsequent story
-- that needs an "audit-logged" acceptance criterion (Epic 1 Stories 1.5-1.7,
-- Epic 2 member management, Epic 4 payments/refunds, Epic 5 coach assignments,
-- pg_cron job failures) has somewhere trustworthy to write to from day one.

create table audit_log (
  -- Plain UUID PK, not architecture.md's literal "bigint identity + separate
  -- UUID" text for high-write append-only tables -- attendance_events
  -- (0006_attendance.sql, Story 1.3) already set the real in-repo precedent
  -- with a plain UUID PK, undocumented at the time. Matching that precedent
  -- here avoids making audit_log the one bigint-PK table in the entire schema,
  -- which would be a bigger inconsistency than the one it avoids. Recorded in
  -- docs/decisions.md.
  id uuid primary key default gen_random_uuid(),
  -- Nullable, unlike every other gym-scoped table's `gym_id not null`:
  -- pg_cron job-failure audit records (FR-027/FR-080) aren't scoped to any
  -- one gym -- job_runs itself has no gym_id either (architecture.md Entity
  -- Relationships: "global, not gym-scoped"). Recorded in docs/decisions.md.
  gym_id uuid references gyms(id),
  -- Nullable for the same reason: a pg_cron job has no authenticated session
  -- to derive an actor from. actor_display_name (below) still captures a
  -- human-readable label ("system:<job_name>") even when actor_id is null.
  actor_id uuid references users(id),
  -- Denormalized at write time -- must survive even if the users row's
  -- display_name later changes, since the audit trail describes what
  -- happened at the time, not the actor's current profile state.
  actor_display_name text not null,
  -- Free text, not an enum, unlike every other closed-set column in this
  -- schema (gym_status, member_role, etc. in 0001_extensions_and_enums.sql).
  -- The full list of action types spans five future epics that don't exist
  -- yet, and Postgres enum values, once added, cannot be removed or
  -- reordered without recreating the type -- free text avoids forcing every
  -- future epic's story to modify this migration's enum.
  action_type text not null,
  -- Deliberately not foreign keys: a target can be any entity type (member,
  -- payment, job_runs row, etc.), and architecture.md's Entity Relationships
  -- section explicitly notes "no reverse FK constraints needed" for audit_log
  -- targets -- the log must survive even if the target row is later deleted.
  target_entity_id text,
  target_entity_type text,
  -- Holds the varying "relevant fields" AC #3 requires (amount/method/reason/
  -- etc.) without needing a column per action type.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- FR-081 (filter by date range and actor) and FR-068 (paginate) -- index
-- these now, at creation time, per the same discipline Story 1.3 applied to
-- every gym_id column.
create index idx_audit_log_gym_id on audit_log(gym_id);
create index idx_audit_log_actor_id on audit_log(actor_id);
create index idx_audit_log_created_at on audit_log(created_at);

-- RLS enabled with a deny-all default in the same migration as CREATE TABLE,
-- no "open table" window (NFR-001 pattern, applied to every table so far).
-- Zero policies added here, matching Story 1.3's Scope Boundary precedent --
-- the Audit Log page's read policy (Manager/Owner-only, FR-068/081) belongs
-- to Epic 7 Story 7.2, not this story.
alter table audit_log enable row level security;

-- Table-level GRANTs are checked before RLS (Story 1.3, Debug Log
-- References) -- without these, even an allowed query would hard-fail with
-- "permission denied for table" instead of the intended RLS-mediated
-- behavior. `anon` is deliberately not granted -- no unauthenticated flow
-- touches audit data. `update`/`delete` are deliberately never granted here:
-- this table has no update/delete path for any role, ever (AC #1/#2).
grant select, insert on audit_log to authenticated, service_role;

-- Explicit REVOKE even though update/delete were never granted above: this
-- is the permanent, in-migration record of intent (AC #1's "enforced at the
-- grant level beneath RLS") that survives a future migration accidentally
-- adding a broader `grant ... on all tables in schema public` statement,
-- which would otherwise silently re-open UPDATE/DELETE on this one table.
-- This is what actually stops `service_role`: service_role bypasses RLS
-- entirely in Supabase (BYPASSRLS), so RLS alone could never enforce AC #1
-- for it -- only a grant-level REVOKE can.
--
-- Note on scope: this cannot and does not attempt to block the Postgres
-- superuser (`postgres`) role itself, which runs migrations and inherently
-- bypasses all GRANT/REVOKE privilege checks -- a Postgres platform
-- invariant, not a gap. AC #1's "no role -- including Super Admin" refers to
-- the application-level `super_admin` app_role (the JWT claim from Story
-- 1.3's hook), which only ever reaches Postgres as `authenticated` or
-- `service_role` -- both of which this REVOKE correctly blocks.
revoke update, delete on audit_log from authenticated, service_role, anon, public;

-- ============================================================================
-- log_audit_event(): the single canonical write path into audit_log.
--
-- Why this exists: callers running as `authenticated` cannot INSERT directly
-- (deny-all RLS above, no INSERT policy) -- only `service_role` can, via
-- table grant + RLS bypass. Rather than making every future epic's story
-- either hand-roll its own SECURITY DEFINER insert wrapper or route every
-- audit write through service_role-only server code, this single function
-- is the one recommended write path (Dev Notes Open Question 3), mirroring
-- the SECURITY DEFINER pattern already established by
-- private.gym_id()/custom_access_token_hook (0009_auth_hook_gym_claims.sql).
--
-- Actor derivation: actor_id/actor_display_name are derived from auth.uid()
-- and public.users.display_name inside the function, NOT accepted as
-- caller-supplied parameters -- a caller-supplied actor would let any caller
-- spoof the audit trail's own actor field, defeating AC #3's trustworthiness
-- guarantee. System/cron callers (no auth.uid() session) pass an explicit
-- p_system_actor_label instead; actor_id stays null in that case.
--
-- Deliberately does NOT swallow exceptions (unlike private.gym_id()/
-- custom_access_token_hook, which must never break login and so fail closed
-- silently). This function has no equivalent "must not break the caller's
-- flow at all costs" requirement, and a malformed call (e.g. a missing
-- action_type) is a genuine caller bug that should surface immediately at
-- the call site -- silently swallowing it would produce a false sense that
-- an audit record was written when it wasn't, undermining the very
-- trustworthiness this story exists to build. Documented here since it's a
-- deliberate deviation from the "never raise" convention noted in Story
-- 1.3's Dev Notes, not an oversight.
-- ============================================================================

create function log_audit_event(
  p_action_type text,
  p_gym_id uuid default null,
  p_target_entity_id text default null,
  p_target_entity_type text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_system_actor_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_display_name text;
  v_id uuid;
begin
  v_actor_id := auth.uid();

  if v_actor_id is not null then
    -- Real session: keep actor_id set regardless of what display_name
    -- resolves to below. A user who simply hasn't set a display_name yet
    -- (users.display_name is nullable, 0003_members_and_users.sql) is still
    -- a real, identifiable actor -- falling back to a generic label must
    -- NOT also null out actor_id, or a genuine user's action would be
    -- misattributed to "system" merely because their profile is incomplete.
    select u.display_name into v_actor_display_name
    from public.users u
    where u.id = v_actor_id;

    v_actor_display_name := coalesce(v_actor_display_name, 'Unknown User');
  else
    -- No session at all -- the pg_cron/system-caller case. actor_id stays
    -- null (already is, from auth.uid() above); actor_display_name falls
    -- back to the caller-supplied label since there is no users row to
    -- look up in the first place.
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
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default (see
-- private.gym_id()'s comment in 0009) -- explicitly revoke that default,
-- then grant only to the two roles that should call this: `anon` is
-- deliberately excluded, matching every other grant in this table's
-- migration.
revoke execute on function log_audit_event from public;
grant execute on function log_audit_event to authenticated, service_role;
