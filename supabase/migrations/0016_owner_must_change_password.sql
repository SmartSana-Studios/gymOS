-- Story 1.11: Gym Owner Activation via Temp Password (SMS/WhatsApp). Adds the
-- account-level "must change password on next login" flag. Lives on `users`
-- (the `auth.users` 1:1 mirror), not `members` -- this is an account-state
-- flag, not a gym-membership attribute (a user could in theory hold multiple
-- `members` rows; the flag must not be per-membership).

alter table users add column must_change_password boolean not null default true;

-- Backfill: the column's `default true` only governs rows inserted *after*
-- this migration runs (new owners provisioned via createGym, Story 1.11).
-- Every row that already exists at migration time already has a real,
-- self-chosen password and must not be force-redirected through
-- /auth/update-password on their next login -- code review finding, this
-- migration originally shipped without this backfill.
update users set must_change_password = false;

-- Critical, easy-to-miss fix: `private.protect_self_managed_user_columns()`
-- (0015_users_self_service_language_preference.sql) is a BEFORE UPDATE
-- trigger that pins every column except `preferred_language` back to OLD on
-- any self-update. Left unmodified, this story's AC #5 (the owner flipping
-- must_change_password to false via their own self-update after completing
-- the forced password change) would be silently reverted by this trigger --
-- the UPDATE would appear to succeed (no error) but the row would read back
-- unchanged. Add `must_change_password` to the allow-list alongside
-- `preferred_language`. Re-declares the function (0015's own file/migration
-- is not touched).
create or replace function private.protect_self_managed_user_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = new.id then
    new.phone := old.phone;
    new.is_super_admin := old.is_super_admin;
    new.display_name := old.display_name;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- No RLS policy changes needed -- 0015's `self_update_own_language`
-- (`USING (id = auth.uid())` / `WITH CHECK`) already covers any column on a
-- self-owned row; the trigger above is what gates *which* columns, not RLS.
