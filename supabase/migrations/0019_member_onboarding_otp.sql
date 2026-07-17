-- Story 2.6: Member App -- Phone/OTP Onboarding Through Profile Setup.
-- Three additions this story's mobile onboarding flow needs before any
-- member ever completes it:
--   1. `phone_has_membership()` -- lets MA-02 (Phone Number Entry) check
--      whether a phone is a known member BEFORE ever calling
--      `signInWithOtp`, so an unowned/attacker-controlled number never
--      triggers a real, billed Twilio send (docs/decisions.md#2026-07-15
--      "enable_signup=true ... cost-abuse" names this story as the place to
--      harden against exactly this).
--   2. `otp_resend_attempts` + two RPCs -- server-side enforcement of the
--      "3 resends -> 5 minute lockout" rule (architecture.md: "OTP
--      resend/lockout enforcement: server-side ... regardless of client
--      behavior"). No migration before this one implements it.
--   3. `users.photo_url` + loosening `protect_self_managed_user_columns`
--      (0015/0016) to also allow self-writes to `display_name` -- MA-05
--      (Profile Setup) is the first code in this project to ever populate
--      either column from the member's own input.

-- ----------------------------------------------------------------------------
-- 1. phone_has_membership(): unauthenticated existence check.
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER, boolean-only return (no row data), mirroring
-- gym_effective_member_cap()'s pattern (0003_members_and_users.sql) for a
-- narrow, purpose-built read that must not leak the underlying row to an
-- unauthenticated caller. Deliberately does NOT filter `deactivated_at is
-- null` -- FR-083 says a deactivated member "retains app history access,"
-- so their phone must still be allowed to authenticate; this check only
-- answers "is this phone known to the platform at all," not "is this
-- member currently active."
create function public.phone_has_membership(p_phone text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from members where phone = p_phone
  );
$$;

-- `anon` is deliberately excluded from every other grant in this codebase
-- (0002_gyms_and_tiers.sql's own comment) -- this is the first function that
-- genuinely needs it: MA-02 calls this before any session exists. Explicit
-- revoke-then-grant, matching log_audit_event's exact discipline
-- (0007_audit_log.sql) for documenting an intentional grant, not relying on
-- Postgres's default PUBLIC-execute.
revoke execute on function public.phone_has_membership(text) from public;
grant execute on function public.phone_has_membership(text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. OTP resend/lockout tracking.
-- ----------------------------------------------------------------------------

create table otp_resend_attempts (
  phone text primary key,
  resend_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table otp_resend_attempts enable row level security;

-- No RLS policy of any kind (deny-all default, same as every table in this
-- project) -- this table has no direct-read/-write use case for any role,
-- unlike audit_log (which grants authenticated SELECT for a later read
-- policy). The two SECURITY DEFINER functions below are the sole access
-- path, so only service_role gets a baseline table grant (parity with the
-- "baseline table-level GRANTs required alongside RLS" convention,
-- 0002_gyms_and_tiers.sql), not authenticated or anon.
grant select, insert, update on otp_resend_attempts to service_role;

-- Read-only lock-state check -- used by the lockout screen (MA-04) to
-- resync its countdown against the server's own clock after the app
-- returns from background (EXPERIENCE.md MA-04: "Countdown continues even
-- if app is backgrounded; uses elapsed time on foreground return"). Does
-- NOT increment resend_count -- only record_otp_resend (below) does that.
create function public.check_otp_resend_allowed(p_phone text)
returns table(allowed boolean, locked_until timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_locked_until timestamptz;
begin
  select o.locked_until into v_locked_until from otp_resend_attempts o where o.phone = p_phone;

  if v_locked_until is not null and v_locked_until > now() then
    return query select false, v_locked_until;
  else
    return query select true, null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.check_otp_resend_allowed(text) from public;
grant execute on function public.check_otp_resend_allowed(text) to anon, authenticated, service_role;

-- The mutating resend-tracking RPC. Rule (epics.md#Story 2.6 AC #3): the
-- first 3 "Resend code" taps succeed and re-send an OTP; the 4th is
-- rejected and locks the phone for 5 minutes. (EXPERIENCE.md's own MA-03
-- interaction note -- "After 3 'Resend code' taps: ... navigate to MA-04"
-- -- reads loosely as if the 3rd tap itself locks; epics.md's AC is the
-- precise, testable source and is what this implements: 3 successful
-- resends, the 4th request is what's blocked.) A phone whose lockout has
-- already expired gets a clean slate -- this is a rolling window, not a
-- permanent ban. The MA-02 initial send is NOT a resend and never calls
-- this function.
create function public.record_otp_resend(p_phone text)
returns table(allowed boolean, locked_until timestamptz, attempts_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row otp_resend_attempts%rowtype;
  v_max_attempts constant integer := 3;
  v_lockout_duration constant interval := interval '5 minutes';
begin
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'p_phone must not be null or empty' using errcode = '22023';
  end if;

  -- Serializes concurrent resend requests for the same phone -- without
  -- this, two rapid taps could both read resend_count = 2 and both pass
  -- the <= 3 check, allowing a 4th+ send through. Same
  -- pg_advisory_xact_lock pattern as enforce_member_cap
  -- (0003_members_and_users.sql). Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_phone));

  select * into v_row from otp_resend_attempts where phone = p_phone;

  if v_row.phone is null then
    insert into otp_resend_attempts (phone, resend_count, updated_at)
    values (p_phone, 0, now())
    returning * into v_row;
  end if;

  if v_row.locked_until is not null and v_row.locked_until <= now() then
    v_row.resend_count := 0;
    v_row.locked_until := null;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    update otp_resend_attempts set updated_at = now() where phone = p_phone;
    return query select false, v_row.locked_until, 0;
    return;
  end if;

  v_row.resend_count := v_row.resend_count + 1;

  if v_row.resend_count > v_max_attempts then
    v_row.locked_until := now() + v_lockout_duration;
    update otp_resend_attempts
      set resend_count = v_row.resend_count, locked_until = v_row.locked_until, updated_at = now()
      where phone = p_phone;
    return query select false, v_row.locked_until, 0;
  else
    update otp_resend_attempts
      set resend_count = v_row.resend_count, locked_until = null, updated_at = now()
      where phone = p_phone;
    return query select true, null::timestamptz, (v_max_attempts - v_row.resend_count);
  end if;
end;
$$;

revoke execute on function public.record_otp_resend(text) from public;
grant execute on function public.record_otp_resend(text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. users.photo_url + self-service allow-list.
-- ----------------------------------------------------------------------------

-- Account-level, not gym-level: a member with memberships at two gyms has
-- one self-photo, not one per `members` row -- mirrors why `display_name`
-- (0003) lives here and not on `members` (Story 2.6 Scope Note #2).
alter table users add column photo_url text;

-- Re-declares protect_self_managed_user_columns (0015, last touched by
-- 0016) -- same "same migration, not a follow-up" discipline 0016's own
-- comment warns about: `display_name` is removed from the pin-back list
-- (MA-05 profile setup is the first code ever writing to it) and
-- `photo_url` is a new column the trigger never mentions, so it passes
-- through unpinned by construction. `phone`/`is_super_admin`/`created_at`
-- stay protected -- unchanged from 0016. No RLS policy change needed:
-- 0015's `self_update_own_language` (`id = auth.uid()`) already covers any
-- column on a self-owned row; this trigger is what gates which columns.
create or replace function private.protect_self_managed_user_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = new.id then
    new.phone := old.phone;
    new.is_super_admin := old.is_super_admin;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. caller_has_membership(): authenticated-caller membership existence
--    check, for the member-photos Storage policies below.
-- ----------------------------------------------------------------------------

-- `members` has zero self-read RLS policy (only gym_staff_read_own_members,
-- 0018) -- a member role cannot see even its own row directly, so the
-- Storage policies below can't inline a plain `exists (select 1 from
-- members where user_id = auth.uid())` subquery; it would always evaluate
-- false under the caller's own RLS. SECURITY DEFINER bypasses that, mirroring
-- phone_has_membership()'s pattern above but keyed on the authenticated
-- auth.uid() instead of a pre-auth phone string. Deliberately does NOT
-- filter `deactivated_at is null`, for the same FR-083 reason
-- phone_has_membership() doesn't: a deactivated member "retains app history
-- access," including their own profile photo (Review finding, 2026-07-17 --
-- the original `(auth.jwt() ->> 'app_role') = 'member'` check denied a
-- deactivated-but-newly-onboarding member's own photo upload, since the JWT
-- claims hook only ever assigns `app_role` for a `deactivated_at is null`
-- membership row).
create function public.caller_has_membership()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from members where user_id = auth.uid()
  );
$$;

revoke execute on function public.caller_has_membership() from public;
grant execute on function public.caller_has_membership() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. member-photos Storage bucket (MA-05 profile photo).
-- ----------------------------------------------------------------------------

-- Mirrors gym-logos' exact bucket/policy shape (0014_gym_settings_owner_access.sql)
-- -- `public = true`, same size/mime limits, same 4-policy (SELECT/INSERT/
-- UPDATE/DELETE) set including the SELECT policy required for `upsert: true`
-- writes to work under RLS (that migration's own comment documents the
-- underlying ON CONFLICT DO UPDATE / RLS gotcha in detail; not re-derived
-- here). Folder-scoped by `auth.uid()`, not `gym_id` -- a member's own photo
-- is account-level (Story 2.6 Scope Note #2: one photo across every gym
-- membership, not one per gym), so the gym-logos precedent's `private.gym_id()`
-- scoping is replaced with the uploading user's own id. Path convention:
-- {user_id}/photo.{ext}, upsert: true, matching gym-logos' own convention.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "member_select_own_photo" on storage.objects
  for select
  using (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );

create policy "member_insert_own_photo" on storage.objects
  for insert
  with check (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );

create policy "member_update_own_photo" on storage.objects
  for update
  using (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  )
  with check (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );

create policy "member_delete_own_photo" on storage.objects
  for delete
  using (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );
