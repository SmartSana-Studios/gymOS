-- Story 2.7: Member App -- Goal, Experience & Plan Confirmation. MA-06/07/08
-- need somewhere to persist goal/experience level and a marker of onboarding
-- completion, none of which exist anywhere on `members` today
-- (0003_members_and_users.sql through 0019). Placed on `members`, not
-- `users` -- these are gym-membership-level facts (coach visibility is
-- scoped through `coach_assignments` -> `members`, FR-054), the opposite of
-- Story 2.6's `display_name`/`photo_url` (account-level, hence `users`).
--
-- `members` has zero self-update RLS policy today -- only
-- `self_read_own_membership` (SELECT, 0013) and
-- `manager_or_owner_update_own_members` (UPDATE, gated to Manager/Owner,
-- 0018). Without the policy + trigger pair below, a member has no path to
-- write their own goal/experience_level/onboarding_completed_at at all, and
-- (once the policy alone existed) could self-elevate `role` or
-- un-deactivate their own row via a raw UPDATE -- RLS is row-level, not
-- column-level, so a BEFORE UPDATE trigger is the only mechanism that can
-- say "this column, not that one" (same lesson
-- `protect_self_managed_user_columns`, 0015/0019, already applied to
-- `users`). Both additions ship in this same migration, not a follow-up
-- (docs/decisions.md#2026-07-16 Story 1.11 Decision 4).

alter table members add column goal text;
alter table members add column experience_level text;
alter table members add column onboarding_completed_at timestamptz;

-- No CHECK constraint on goal/experience_level's values -- mirrors the
-- existing gyms.default_language/users.preferred_language precedent
-- (validated only by a Zod enum at the app layer, packages/types/src/schemas/
-- memberOnboarding.ts), keeping future value additions migration-free.

create policy "self_update_own_member_onboarding_fields" on members
  for update
  using (user_id = auth.uid() and gym_id = private.gym_id())
  with check (user_id = auth.uid() and gym_id = private.gym_id());

-- Pins every column except goal/experience_level/onboarding_completed_at
-- back to OLD on a self-update (auth.uid() = old.user_id) -- exact same
-- shape as private.protect_self_managed_user_columns (0015/0019). Guarding
-- on `old.user_id` (not `new.user_id`) matters: `user_id` itself is one of
-- the pinned columns, so either read gives the same row-identity check, but
-- `old` is the unambiguous "whose row is this really" source before this
-- trigger's own pin-back runs. No security definer needed -- only reads
-- auth.uid() and the row already in scope under the caller's own RLS,
-- same rationale 0015's sibling trigger documents.
create function private.protect_self_managed_member_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = old.user_id then
    new.gym_id := old.gym_id;
    new.user_id := old.user_id;
    new.role := old.role;
    new.name := old.name;
    new.phone := old.phone;
    new.email := old.email;
    new.dob := old.dob;
    new.photo_url := old.photo_url;
    new.join_date := old.join_date;
    new.emergency_contact := old.emergency_contact;
    new.deactivated_at := old.deactivated_at;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger protect_self_managed_member_columns
  before update on members
  for each row execute function private.protect_self_managed_member_columns();

-- No RLS/policy change needed for MA-08's other two reads (Scope Note #3):
-- `gym_staff_read_own_subscriptions` (0018) already includes an `exists`
-- branch for `m.user_id = auth.uid()`, and `gym_staff_read_own_plans`
-- (0017) has no role check at all -- both already cover a member reading
-- their own subscription/plan.
--
-- No RLS/trigger change needed for MA-08's users.preferred_language write
-- either (Scope Note #4): `preferred_language` was never added to
-- `protect_self_managed_user_columns`'s pin-back list at any point (0015
-- through 0019 pin only phone/is_super_admin/created_at, plus display_name
-- until 0019 removed it) -- self-writable since Story 1.10.
