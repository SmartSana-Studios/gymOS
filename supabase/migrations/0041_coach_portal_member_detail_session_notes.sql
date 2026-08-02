-- Story 5.3: Coach Portal -- Member Detail & Session Notes (AD-15, FR-054, FR-055).
--
-- `session_notes`: authored by a coach, scoped to a `coach_assignment`
-- (architecture.md's ER note, verbatim). `coach_assignment_id` (not just
-- `coach_id`/`member_id`) records which assignment the note was written
-- under, matching that note.
create table session_notes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  coach_id uuid not null references members(id),
  coach_assignment_id uuid not null references coach_assignments(id),
  note_text text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint session_notes_note_text_not_blank check (char_length(btrim(note_text)) > 0),
  constraint session_notes_note_text_len check (char_length(note_text) <= 2000)
);

create index idx_session_notes_gym_id on session_notes(gym_id);
create index idx_session_notes_member_id on session_notes(member_id);
create index idx_session_notes_coach_id on session_notes(coach_id);

alter table session_notes enable row level security;

grant select, insert, update, delete on session_notes to authenticated, service_role;

-- `private.is_own_coach_id()`: second SECURITY DEFINER, RLS-bypassing
-- `private`-schema helper (after `private.is_assigned_coach()`, 0040), same
-- justification -- a coach has no direct SELECT access to their own
-- `members` row (0040 narrowed `gym_staff_read_own_members` to exclude
-- 'coach', and `coach_read_assigned_members` only covers *assigned members*,
-- never the coach's own row), so a plain correlated subquery written
-- directly inside a `session_notes` RLS policy comparing `coach_id` against
-- the caller's own identity would silently return false for every coach,
-- always. This helper answers "is this `members.id` mine," not "am I
-- assigned to this member" -- see docs/decisions.md for the full record.
create function private.is_own_coach_id(p_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from members m
    where m.id = p_coach_id and m.user_id = auth.uid()
  );
$$;

revoke execute on function private.is_own_coach_id from public;
grant execute on function private.is_own_coach_id to authenticated;

-- SELECT policies. Resolves a genuine spec tension between FR-055/Story 5.1
-- AC#2 ("previous coach's notes stay visible to Owner/Manager only, not the
-- new coach") and this story's own AC#4 (read literally, implies a
-- reassigned note is visible-but-uneditable). FR-055 and 5.1's AC#2 win:
-- a coach's own SELECT is scoped to currently-assigned member AND
-- self-authored notes only, so a reassigned member's prior notes never
-- reach the new coach's query at all -- see docs/decisions.md.
create policy "coach_read_own_session_notes" on session_notes
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'coach'
    and private.is_assigned_coach(member_id)
    and private.is_own_coach_id(coach_id)
  );

create policy "manager_or_owner_read_own_session_notes" on session_notes
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])
  );

-- Writes go through SECURITY DEFINER RPCs, not direct RLS INSERT/UPDATE
-- policies -- matching `assign_coach()`'s (0039) RPC pattern, not `refunds`'
-- (0033) direct-RLS-`with check` pattern. Both RPCs must resolve the
-- caller's own `coach_id` and their currently-active `coach_assignments` row
-- entirely server-side (never trust a client-supplied id); doing that
-- resolution inside a plain RLS `with check` clause hits the same
-- RLS-blocking-its-own-helper problem this migration's SELECT policies work
-- around, this time against `coach_assignments`, which a coach has zero
-- direct SELECT access to at all (0039). No INSERT/UPDATE policy is added
-- for `authenticated` -- the RPC is the only real write path, matching
-- `coach_assignments`' own established shape.
--
-- No audit log entry: FR-080's action-type list (manual payment entries,
-- verifications, refunds, member deactivations, coach assignment changes,
-- Super Admin escalations, pg_cron job failures) does not include session
-- notes.
create function add_session_note(p_member_id uuid, p_note_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke execute on function add_session_note from public;
grant execute on function add_session_note to authenticated;

-- `edit_session_note()`'s `where sn.id = p_note_id and sn.gym_id =
-- v_caller_gym_id and sn.coach_id = v_coach_id` clause is the AC #4
-- enforcement backstop: a coach attempting to edit a note that isn't their
-- own resolved `coach_id` matches zero rows and raises not-found,
-- regardless of what the client sends. It also re-checks
-- `private.is_assigned_coach(member_id)` -- matching `coach_read_own_session_notes`'s
-- SELECT policy exactly -- so a coach's edit access to their own note is
-- revoked the same moment the member is reassigned away from them, not just
-- their visibility of it (code review finding, story 5.3).
create function edit_session_note(p_note_id uuid, p_note_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke execute on function edit_session_note from public;
grant execute on function edit_session_note to authenticated;

-- Not touched by this migration: `coach_assignments`, `members`, and
-- `subscriptions` RLS -- only `session_notes` and its two new `private`
-- helpers/RPCs are added here.
