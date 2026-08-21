-- Story 10.2: Progress Data & Photo Privacy (FR-095, NFR-011, NFR-016, AD-24).
--
-- Splits the progress photo out of progress_entries into its own
-- progress_photos table. Postgres RLS is row-level, not column-level: the
-- weight/measurements/note fields are coach-visible whenever a coach
-- assignment is active (no per-item consent), while the photo specifically
-- needs a narrower, default-off, explicitly-toggled per-item consent gate.
-- Both the member and the coach connect as the same `authenticated`
-- Postgres role -- there is no way to keep photo_path on progress_entries
-- and still make a coach's read of that row's other columns unconditional
-- while gating just that one column via RLS. A security-invoker view/RPC
-- that nulls the column for non-owners was rejected -- it doesn't stop a
-- coach client from querying the base table directly for photo_path,
-- silently defeating the gate. Moving the photo into its own table makes
-- "shared" a genuine row-existence condition a coach's query either
-- satisfies or doesn't, actually enforced by RLS (AD-1) rather than by
-- client discipline. See docs/decisions.md for the full reasoning trail.
--
-- All new policies use private.current_member_role() (0061), not
-- auth.jwt() ->> 'app_role' -- AD-3 retires the JWT-claim role-check form
-- for every new RLS policy/SECURITY DEFINER function (grandfathering only
-- the 27 migrations that already used it before Epic 9). This is a
-- deliberate divergence from the literal Epic 5 coach-policy shape
-- (coach_read_assigned_members/coach_read_assigned_subscriptions, 0040)
-- this migration otherwise mirrors, not an inconsistency to reconcile back.

-- ----------------------------------------------------------------------------
-- 1. progress_photos
-- ----------------------------------------------------------------------------

create table progress_photos (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id) on delete cascade,
  progress_entry_id uuid not null references progress_entries(id) on delete cascade,
  photo_path text not null,
  shared_with_coach boolean not null default false,
  created_at timestamptz not null default now()
);

-- gym_id denormalized directly onto the table, mirroring progress_entries'
-- own precedent (0066), itself following 0047's stated rule.
create index idx_progress_photos_gym_id on progress_photos(gym_id);
create index idx_progress_photos_member_id on progress_photos(member_id);

-- One photo per entry (FR-094's singular "a progress photo") -- this
-- unique index doubles as the one-photo-per-entry invariant and the
-- idempotent-upsert target for the mobile write path
-- (progress.ts:logProgressEntry/syncOneProgressEntry).
create unique index idx_progress_photos_entry_id on progress_photos(progress_entry_id);

alter table progress_photos enable row level security;

-- Baseline table-level GRANTs alongside RLS (0002's rule -- RLS-then-grant
-- is required, not RLS-is-redundant-with-grant). No delete for
-- authenticated -- photo removal only ever happens via the parent entry's
-- cascade, mirroring progress_entries' own grant shape (0066).
grant select, insert, update on progress_photos to authenticated;
grant select, insert, update, delete on progress_photos to service_role;

-- Four explicit per-action policies, never `for all` (AD-1).

-- Mirrors progress_entries' own self_read_own_progress_entries shape (0066).
create policy "self_read_own_progress_photos" on progress_photos
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

-- The `exists` clause is a data-correctness guard preventing a caller from
-- attaching a photo row to another member's entry -- not a cross-tenant
-- read risk (SELECT is member_id-scoped regardless), same rationale
-- progress_entries' own gym_id guard clause documents (0066).
create policy "self_insert_own_progress_photos" on progress_photos
  for insert
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and gym_id = (select gym_id from members where id = member_id)
    and exists (
      select 1 from progress_entries pe
      where pe.id = progress_entry_id and pe.member_id = progress_photos.member_id
    )
  );

-- Paired with the pin-back trigger below so the only column an UPDATE can
-- actually change is shared_with_coach.
create policy "self_update_own_progress_photo_sharing" on progress_photos
  for update
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (member_id in (select id from members where user_id = auth.uid()));

-- Coach read, gated on a live sharing flag -- the "shared" row-existence
-- condition that makes this whole split-table design actually RLS-enforced.
create policy "coach_read_shared_progress_photos" on progress_photos
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'coach'
    and private.is_assigned_coach(member_id)
    and shared_with_coach = true
  );

-- Pins every column back to OLD except shared_with_coach on a self-update.
-- Mirrors private.protect_progress_entry_immutable_columns()'s shape
-- exactly (0066) -- ownership checked via member_id in (select id from
-- members where user_id = auth.uid()), no SECURITY DEFINER (only reads
-- auth.uid() and the row already in scope under the caller's own RLS).
create function private.protect_progress_photo_immutable_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.member_id in (select id from members where user_id = auth.uid()) then
    new.gym_id := old.gym_id;
    new.member_id := old.member_id;
    new.progress_entry_id := old.progress_entry_id;
    new.photo_path := old.photo_path;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger protect_progress_photo_immutable_columns
  before update on progress_photos
  for each row execute function private.protect_progress_photo_immutable_columns();

-- ----------------------------------------------------------------------------
-- 2. Coach read grant on progress_entries (AC #1's weight/measurements/note
--    visibility -- no photo-consent gate, that lives entirely in
--    progress_photos above).
-- ----------------------------------------------------------------------------

-- Additive: same-table SELECT policies are OR'd (0040's own established
-- convention). Does NOT filter on deactivated_at -- consistent with
-- self_read_own_progress_entries' own existing behavior (RLS doesn't hide
-- soft-deleted rows from an owner; client-side filtering decides display).
-- Story 10.4's coach-facing query must apply the same client-side
-- deactivated_at is null filter Story 10.3 applies for the member's own
-- view.
create policy "coach_read_assigned_progress_entries" on progress_entries
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'coach'
    and private.is_assigned_coach(member_id)
  );

-- ----------------------------------------------------------------------------
-- 3. Migrate existing photo data, then drop the old column.
-- ----------------------------------------------------------------------------

-- created_at is backfilled from the owning entry's logged_at (Review
-- finding) -- otherwise every migrated photo would carry this migration's
-- run timestamp instead of its real chronological position, which Story
-- 10.3's planned photo timeline would then order incorrectly.
insert into progress_photos (gym_id, member_id, progress_entry_id, photo_path, shared_with_coach, created_at)
select gym_id, member_id, id, photo_path, false, logged_at
from progress_entries
where photo_path is not null;

alter table progress_entries drop column photo_path;

-- Re-declare private.protect_progress_entry_immutable_columns() (0066) with
-- the `new.photo_path := old.photo_path;` line removed -- the column no
-- longer exists, and plpgsql doesn't statically check column references at
-- CREATE FUNCTION time, so leaving it would raise at the next UPDATE, not
-- at migration time.
create or replace function private.protect_progress_entry_immutable_columns()
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
    new.note := old.note;
    new.client_entry_id := old.client_entry_id;
    new.logged_at := old.logged_at;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Coach storage read policy on the existing progress-photos bucket
--    (0066). The four existing member-only policies are folder-scoped to
--    the uploading member's own auth.uid() -- structurally this can never
--    match a coach's auth.uid(), so a coach's read must be a genuinely new,
--    differently-shaped policy, not a copy of the existing four. This is
--    what makes AC #4's revoke "immediate" in the only way actually
--    achievable: signed URLs aren't live-revocable once minted, but no new
--    signed URL can ever be minted once shared_with_coach flips to false,
--    re-checked live on every createSignedUrl call, zero caching window.
-- ----------------------------------------------------------------------------

create policy "coach_select_shared_progress_photo" on storage.objects
  for select
  using (
    bucket_id = 'progress-photos'
    and private.current_member_role() = 'coach'
    and exists (
      select 1 from progress_photos pp
      where pp.photo_path = storage.objects.name
        and pp.shared_with_coach = true
        and pp.gym_id = private.gym_id()
        and private.is_assigned_coach(pp.member_id)
    )
  );

-- No new SECURITY DEFINER RPC for the sharing toggle -- a pure
-- ownership-gated column flip with no cross-row invariant to protect (no
-- capacity check, no state machine, no second row that must change
-- atomically with it). The pin-back trigger above already restricts a
-- self-update to touching only shared_with_coach. See docs/decisions.md
-- ("Why a Plain RLS Update, Not an RPC (Again)").
