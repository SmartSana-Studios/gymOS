-- One phone number is either a STAFF account or a MEMBER account, never both.
--
-- THE RULE, as decided with the product owner:
--   a phone that holds an active staff row (owner / supervisor / manager /
--   receptionist / coach) may not also hold a member row, and vice versa. A
--   staff member who also wants to train at the gym uses a second number.
--
-- WHAT THIS DELIBERATELY DOES **NOT** DO. It does not limit anyone to one gym.
--   * Staff keep multi-gym binding and the 9.6 switcher (Stories 9.4 / 9.6 /
--     1.17).
--   * A MEMBER may still belong to several gyms. That was drafted as part of
--     this rule and then dropped, because it contradicts FR-001 outright:
--     "Phone number is the primary identity; one phone maps to one platform
--     user account; a user may be a member at multiple gyms via separate
--     `members` rows" (epics.md:26). Two features implement that requirement
--     and would have been silently killed: per-gym member notification
--     preferences (member_preferences' self policy has no gym_id filter, by
--     design -- notification_preferences.test.sql:242-258) and the
--     subscription-expiry copy that names which gym is expiring
--     (subscription_lifecycle_notifications.test.sql:294-304). Forbidding
--     multi-gym members is a requirements change, not a constraint to add in
--     a migration; it would need FR-001 amended first.
--
-- WHY THE RULE THAT REMAINS IS WORTH HAVING. A session carries exactly ONE
-- `app_role` claim. If one account is both a coach and a member, the claims
-- hook has to pick, and it picks whichever membership was created most
-- recently (0065's fallback) -- effectively arbitrary. That single choice
-- decides which dashboard the person sees and how the mobile app treats them.
-- Two numbers means two unambiguous identities.
--
-- Note this closes a genuinely small remaining gap: at a SINGLE gym, being
-- both was already impossible via idx_members_active_gym_user (unique on
-- gym_id + user_id where not deactivated, whatever the roles). The only way to
-- be staff-and-member today is to be them at DIFFERENT gyms, which is exactly
-- what the trigger below catches.

-- ----------------------------------------------------------------------------
-- 0. Pre-flight. FAIL LOUDLY rather than "repair" anything.
--
-- Deactivating somebody's membership or staff binding is not a migration's
-- decision to make silently -- it is a real relationship, possibly with a paid
-- subscription attached. This reports the offending numbers and stops; an
-- operator resolves them deliberately, then re-runs.
-- ----------------------------------------------------------------------------
do $preflight$
declare
  v_mixed text[];
begin
  select array_agg(distinct coalesce(u.phone, m.user_id::text) order by coalesce(u.phone, m.user_id::text))
    into v_mixed
  from members m
  left join auth.users u on u.id = m.user_id
  where m.deactivated_at is null
    and m.user_id in (
      select user_id from members
      where deactivated_at is null
      group by user_id
      having count(*) filter (where role = 'member') > 0
         and count(*) filter (where role <> 'member') > 0
    );

  if v_mixed is not null then
    raise exception '0094: these phone numbers hold BOTH a staff row and a member row and must be resolved before this constraint can apply: %. Per the rule, a staff member who also trains uses a second number -- deactivate whichever row should not survive (members.deactivated_at), then re-run.', array_to_string(v_mixed, ', ');
  end if;
end;
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. The guard.
--
-- This CANNOT be an index or a check constraint: it is a condition across
-- sibling rows, not a property of the row being written, so it needs a trigger.
--
-- ⚠ SECURITY DEFINER IS LOAD-BEARING, AND THIS IS THE TRAP. `members` is
-- RLS-gated. A SECURITY INVOKER trigger would evaluate its EXISTS check under
-- the caller's own policies -- so a Manager at gym A, who cannot see gym B's
-- rows, would find no conflicting row and the guard would FAIL OPEN, silently
-- permitting exactly what it exists to prevent. Running as the definer makes
-- the check see the whole table, which is the only way it can be correct.
-- Same reasoning as phone_has_staff_membership() in 0092.
-- ----------------------------------------------------------------------------
create function private.enforce_staff_member_phone_separation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A deactivated row is history; it constrains nothing, so a former coach can
  -- later join as a member on the same number, and vice versa.
  if new.deactivated_at is not null then
    return new;
  end if;

  if new.role = 'member' then
    if exists (
      select 1 from members
      where user_id = new.user_id
        and deactivated_at is null
        and role <> 'member'
        and id is distinct from new.id
    ) then
      raise exception 'staff_member_phone_separation: this phone number already belongs to a staff account; a staff member who also trains must use a different number'
        using errcode = 'check_violation';
    end if;
  else
    if exists (
      select 1 from members
      where user_id = new.user_id
        and deactivated_at is null
        and role = 'member'
        and id is distinct from new.id
    ) then
      raise exception 'staff_member_phone_separation: this phone number already belongs to a member account; a staff account must use a different number'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_staff_member_phone_separation_trigger
  before insert or update of role, user_id, deactivated_at on members
  for each row execute function private.enforce_staff_member_phone_separation();

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0091/0092/0093's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'members' and t.tgname = 'enforce_staff_member_phone_separation_trigger'
  ) then
    raise exception '0094: enforce_staff_member_phone_separation_trigger was not created';
  end if;

  -- See the trigger's own comment: invoker rights make this guard fail OPEN
  -- for any caller who cannot see the conflicting row under RLS.
  if not (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'enforce_staff_member_phone_separation'
  ) then
    raise exception '0094: enforce_staff_member_phone_separation() must be SECURITY DEFINER -- members is RLS-gated, so invoker rights would let the cross-row check fail open';
  end if;

  -- FR-001 guard. If a later change ever adds a one-membership-per-user index,
  -- it contradicts "a user may be a member at multiple gyms via separate
  -- members rows" and kills per-gym notification preferences and the
  -- gym-named expiry copy. Amend FR-001 first if that is really intended.
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexdef ilike '%unique%'
      and indexdef ilike '%ON public.members%'
      and indexdef ilike '%(user_id)%'
      and indexdef not ilike '%gym_id%'
  ) then
    raise exception '0094: a unique index on members(user_id) alone contradicts FR-001 (a user may be a member at multiple gyms) -- amend the requirement before adding one';
  end if;
end;
$verify$;
