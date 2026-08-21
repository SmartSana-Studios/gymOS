-- Story 10.1: Body Profile & Progress Entry Logging. FR-093/FR-094/FR-097.
--
-- Two independent additions:
-- 1. members.height_cm/starting_weight_kg -- one-time baseline facts about
--    the member (FR-093's "height, starting weight"), following 0020's exact
--    precedent for adding new self-editable columns to `members` (goal/
--    experience_level). No CHECK constraint, same as that precedent --
--    validated only by a Zod schema at the app layer
--    (packages/types/src/schemas/progressEntry.ts).
-- 2. progress_entries -- the ongoing time-series log (FR-094: weight,
--    measurements, photo, note), offline-safe via client_entry_id
--    idempotency (FR-097). Plain RLS, no SECURITY DEFINER RPC -- unlike
--    check_in() (0028), there is no cross-row invariant to protect here
--    (any number of entries, no capacity check), only row ownership +
--    idempotent replay, both fully expressible as RLS + a partial unique
--    index.
--
-- AC #1's RLS baseline is member-own-row-only; Story 10.2 later adds the
-- assigned-coach read grant on top of this, not from scratch.

-- ----------------------------------------------------------------------------
-- 1. members.height_cm / members.starting_weight_kg
-- ----------------------------------------------------------------------------

alter table members add column height_cm numeric;
alter table members add column starting_weight_kg numeric;

-- Deliberately NOT added to private.protect_self_managed_member_columns()'s
-- (0020) pin-back list. That trigger pins back only the columns it
-- explicitly lists in its body -- a column not mentioned passes through
-- unpinned by construction, exactly how goal/experience_level/
-- onboarding_completed_at became self-editable in 0020 without a
-- special-case branch. Same mechanism applies here: no trigger change
-- needed for these two columns to be self-writable. The existing
-- self_update_own_member_onboarding_fields policy (0020) already covers
-- writing them (using/with check (user_id = auth.uid() and gym_id =
-- private.gym_id())) -- no new members RLS policy needed either.

-- ----------------------------------------------------------------------------
-- 2. progress_entries
-- ----------------------------------------------------------------------------

create table progress_entries (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id) on delete cascade,
  weight_kg numeric,
  waist_cm numeric,
  chest_cm numeric,
  hips_cm numeric,
  arms_cm numeric,
  thighs_cm numeric,
  -- Bucket-relative object path, not a URL -- the bucket is private, so a
  -- persisted URL would go stale. The app resolves a signed URL from this
  -- path at render time (getProgressPhotoSignedUrl).
  photo_path text,
  note text,
  client_entry_id uuid,
  -- Client-provided timestamp for offline-safe entries, mirroring
  -- check_in(p_scanned_at ...)'s pattern -- no separate created_at, matching
  -- attendance_events' own single-timestamp economy.
  logged_at timestamptz not null default now(),
  -- Soft-delete marker. `deactivated_at`, not `deleted_at`: the
  -- architecture's Consistency Conventions table names one soft-delete
  -- column convention for the whole codebase ("deactivated_at timestamp,
  -- never a boolean flag"), with no carve-out for log-type rows.
  deactivated_at timestamptz
);

-- gym_id denormalized directly onto the table (not joined through members),
-- per 0047's stated rule that every child table below gyms carries its own
-- gym_id column.
create index idx_progress_entries_gym_id on progress_entries(gym_id);
create index idx_progress_entries_member_id on progress_entries(member_id);

-- Idempotency-enforcing partial unique index -- mirrors
-- attendance_events.client_scan_id's exact shape (0028). The client-side
-- idempotent-replay contract (logProgressEntry's unique-violation fallback)
-- depends on this.
create unique index idx_progress_entries_client_entry_id
  on progress_entries(client_entry_id) where client_entry_id is not null;

alter table progress_entries enable row level security;

-- Baseline table-level GRANTs alongside RLS (see 0002 for why RLS-then-grant
-- is required, not RLS-is-redundant-with-grant).
grant select, insert, update on progress_entries to authenticated;
grant select, insert, update, delete on progress_entries to service_role;

-- Three explicit per-action policies, never `for all` (AD-1).

-- Mirrors member_preferences' self-read shape (0047) exactly.
create policy "self_read_own_progress_entries" on progress_entries
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

-- The second gym_id clause is a data-correctness guard (a caller could
-- otherwise pass a gym_id that doesn't match their own member row's real
-- gym) -- not a cross-tenant read risk since SELECT is member_id-scoped
-- regardless, but it would corrupt the denormalized column.
create policy "self_insert_own_progress_entries" on progress_entries
  for insert
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and gym_id = (select gym_id from members where id = member_id)
  );

-- Paired with the pin-back trigger below so the only column an UPDATE can
-- actually change is deactivated_at -- a logged entry is otherwise
-- immutable (no AC allows editing a past entry's values, only removing it).
create policy "self_soft_delete_own_progress_entries" on progress_entries
  for update
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (member_id in (select id from members where user_id = auth.uid()));

-- Pins every column back to OLD except deactivated_at on a self-update.
-- progress_entries has no user_id column of its own, so ownership is
-- checked via the same member_id in (select id from members where user_id =
-- auth.uid()) shape the policies above use, not a direct column match. No
-- SECURITY DEFINER -- only reads auth.uid() and the row already in scope
-- under the caller's own RLS, same rationale 0047's sibling trigger
-- documents.
create function private.protect_progress_entry_immutable_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.member_id in (select id from members where user_id = auth.uid()) then
    new.gym_id := old.gym_id;
    new.member_id := old.member_id;
    new.weight_kg := old.weight_kg;
    new.waist_cm := old.waist_cm;
    new.chest_cm := old.chest_cm;
    new.hips_cm := old.hips_cm;
    new.arms_cm := old.arms_cm;
    new.thighs_cm := old.thighs_cm;
    new.photo_path := old.photo_path;
    new.note := old.note;
    new.client_entry_id := old.client_entry_id;
    new.logged_at := old.logged_at;
  end if;
  return new;
end;
$$;

create trigger protect_progress_entry_immutable_columns
  before update on progress_entries
  for each row execute function private.protect_progress_entry_immutable_columns();

-- ----------------------------------------------------------------------------
-- 3. progress-photos Storage bucket (private -- the one setting that must
--    NOT be copied from member-photos' public=true, per AD-24/NFR-011).
-- ----------------------------------------------------------------------------

-- image/gif included to match member-photos' (0019) exact allowlist, per
-- this bucket's own stated "reuses member-photos' exact policy shape" intent
-- (Review finding -- it had been omitted, silently rejecting gif uploads
-- that photo-upload.ts's shared EXTENSION_TO_MIME map still resolves).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Reuses member-photos' exact policy shape (0019) -- folder-scoped to
-- (storage.foldername(name))[1] = auth.uid()::text, gated by the existing
-- public.caller_has_membership() helper (already SECURITY DEFINER, no new
-- helper needed). Member-only access -- no coach grant, no sharing/consent,
-- no revoke; that layer is 100% Story 10.2's. Object path convention:
-- {auth.uid()}/{client_entry_id}.{ext} -- ties each photo to the
-- offline-safe client-generated ID so a retried upload after a sync failure
-- overwrites (upsert: true) rather than orphaning a duplicate file.

create policy "member_select_own_progress_photo" on storage.objects
  for select
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );

create policy "member_insert_own_progress_photo" on storage.objects
  for insert
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );

create policy "member_update_own_progress_photo" on storage.objects
  for update
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  )
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );

create policy "member_delete_own_progress_photo" on storage.objects
  for delete
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.caller_has_membership()
  );
