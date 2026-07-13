-- Story 1.9: Gym Branding & Operational Settings. Closes the write-path gap
-- 0011_super_admin_tier_gym_lifecycle.sql explicitly deferred: "owner/manager
-- gym-settings edits (FR-069) are Story 1.9's job on a different table
-- scope." No new SELECT policy needed -- "read own gym" (0009) already
-- exposes every column (logo_url, primary_color, timezone, default_language,
-- grace_period_days, capacity, alert_auto_dismiss_minutes, gym_token -- all
-- added in 0002_gyms_and_tiers.sql, unused by any write path until now).
-- No table/column changes -- every settings field already exists on `gyms`.
-- This migration is pure RLS + Storage.

create policy "owner_update_own_gym" on gyms
  for update
  using (id = private.gym_id() and (auth.jwt() ->> 'app_role') = 'owner')
  with check (id = private.gym_id() and (auth.jwt() ->> 'app_role') = 'owner');

-- RLS is row-level, not column-level: the policy above authorizes an owner
-- to UPDATE their own gym row, but says nothing about *which* columns. Left
-- alone, that would let an owner flip status/tier_id/member_cap_override --
-- all Super Admin-exclusive lifecycle/tier controls (0011,
-- super_admin_update_gyms) -- via a raw UPDATE that bypasses the app's own
-- updateGymSettings column allow-list. Postgres column-level GRANTs can't
-- fix this here: super_admin and owner sessions both run as the same
-- `authenticated` Postgres role (the JWT's `role` claim, distinct from
-- `app_role`, is what PostgREST uses for SET ROLE), so a GRANT UPDATE
-- (cols) restriction would bind to that shared role, not to `app_role`.
-- A BEFORE UPDATE trigger is the only mechanism that can key off `app_role`
-- per-statement: for any non-super_admin session, pin the three
-- Super-Admin-only columns back to their current values before the row is
-- written, silently discarding an attempted change to them rather than
-- rejecting the whole UPDATE -- the app itself never sends these columns
-- from Settings (gymSettingsSchema has no status/tierId/capOverride field),
-- so this only ever fires against a direct-bypass attempt, not real usage.
create function private.protect_super_admin_only_gym_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- created_at is never legitimately mutable via any write path (not just
  -- the Super Admin-exclusive trio below) -- pinned back unconditionally.
  new.created_at := old.created_at;
  if not private.is_super_admin() then
    new.status := old.status;
    new.tier_id := old.tier_id;
    new.member_cap_override := old.member_cap_override;
  end if;
  return new;
end;
$$;

create trigger protect_super_admin_only_gym_columns
  before update on gyms
  for each row execute function private.protect_super_admin_only_gym_columns();

-- ----------------------------------------------------------------------------
-- gym-logos Storage bucket. `public = true` is deliberate, not a shortcut:
-- the member app's 24h branding cache (FR-011/012) reads the logo
-- unauthenticated, and V1 has no signed-URL refresh mechanism to build
-- instead (out of scope, matches FR-013's "full theme systems out of V1
-- scope" discipline).
-- ----------------------------------------------------------------------------
-- `file_size_limit`/`allowed_mime_types` enforce the same 5MB/image-type
-- rules Next.js's `uploadGymLogo`/`uploadLogo` already apply, but at the
-- Storage layer itself -- the app-side checks alone are bypassable by any
-- caller hitting the Storage HTTP API directly with a valid owner JWT.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-logos', 'gym-logos', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Upload path convention: {gym_id}/logo.{ext} with upsert: true (app layer)
-- so re-uploads overwrite rather than orphan old files -- no separate
-- cleanup logic needed.
--
-- A SELECT policy IS required here, despite the bucket's own public=true
-- setting serving unauthenticated reads via the Storage HTTP API regardless
-- of RLS -- that only covers *reads*. `uploadGymLogo`'s `upsert: true` makes
-- Storage perform the write as `INSERT ... ON CONFLICT (bucket_id, name) DO
-- UPDATE`, and Postgres's RLS enforcement for that statement shape needs a
-- SELECT policy to resolve the conflict target's visibility -- confirmed
-- hands-on: with no SELECT policy, `INSERT ... ON CONFLICT DO UPDATE` fails
-- with "new row violates row-level security policy" even for a brand-new,
-- never-before-inserted path with no real conflict, while both a plain
-- INSERT (no ON CONFLICT clause) and a raw HTTP upload with `x-upsert`
-- omitted succeed under the exact same INSERT/UPDATE policies. Adding this
-- SELECT policy (same owner/own-gym-folder scope as the others) resolved it.
create policy "owner_select_own_gym_logo" on storage.objects
  for select
  using (
    bucket_id = 'gym-logos'
    and (storage.foldername(name))[1] = private.gym_id()::text
    and (auth.jwt() ->> 'app_role') = 'owner'
  );

create policy "owner_insert_own_gym_logo" on storage.objects
  for insert
  with check (
    bucket_id = 'gym-logos'
    and (storage.foldername(name))[1] = private.gym_id()::text
    and (auth.jwt() ->> 'app_role') = 'owner'
  );

create policy "owner_update_own_gym_logo" on storage.objects
  for update
  using (
    bucket_id = 'gym-logos'
    and (storage.foldername(name))[1] = private.gym_id()::text
    and (auth.jwt() ->> 'app_role') = 'owner'
  )
  with check (
    bucket_id = 'gym-logos'
    and (storage.foldername(name))[1] = private.gym_id()::text
    and (auth.jwt() ->> 'app_role') = 'owner'
  );

create policy "owner_delete_own_gym_logo" on storage.objects
  for delete
  using (
    bucket_id = 'gym-logos'
    and (storage.foldername(name))[1] = private.gym_id()::text
    and (auth.jwt() ->> 'app_role') = 'owner'
  );
