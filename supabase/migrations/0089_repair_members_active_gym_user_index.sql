-- Story 1.17: repair `idx_members_active_gym_user` where it has gone missing.
--
-- NOT a new constraint. `0003_members_and_users.sql:39` already creates this
-- exact index, with this exact name and definition, and at least ten later
-- migrations name it as a load-bearing invariant they rely on -- 0023, 0027,
-- 0028, 0034, 0039, 0055, 0058 and 0064 all cite it, and
-- `create_staff_member()` (0064:59) depends on "at most one active membership
-- per (gym, user)" being true when it decides between inserting a new binding
-- and replacing one in place.
--
-- WHY THIS MIGRATION EXISTS: the deployed project (vfxezibagiznrirdwkwh) has
-- `0003` recorded as applied in `supabase_migrations.schema_migrations`, but
-- does NOT have this index -- verified 2026-09-08 via `pg_index`, which
-- returned only `members_pkey`, `idx_members_gym_id` and `idx_members_user_id`
-- for `public.members`. So an invariant the codebase treats as guaranteed was
-- not actually enforced there. Cause unknown (the index is not dropped by any
-- migration in this repo); the fix is to converge the schema regardless of how
-- it diverged.
--
-- `if not exists` makes this a no-op on every environment that already has the
-- index -- local dev and CI, which build from migrations and therefore always
-- do -- so this is safe to run everywhere and safe to re-run.
--
-- SAFE TO APPLY: checked for violations on the deployed project before
-- writing this (`select gym_id, user_id from members where deactivated_at is
-- null group by 1,2 having count(*) > 1` returned zero rows), so the index
-- builds without a data-repair step. Re-run that check before applying to any
-- other environment -- a duplicate pair anywhere will fail the build.
--
-- PARTIAL on `deactivated_at is null`, matching 0003 exactly:
-- `0063_staff_edit_deactivation.sql` made deactivation a SOFT state, so a
-- total unique index would permanently block re-adding a once-deactivated
-- staff member and break 0064's rehire path.

create unique index if not exists idx_members_active_gym_user
  on members (gym_id, user_id)
  where deactivated_at is null;
