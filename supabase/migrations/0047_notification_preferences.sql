-- Story 6.4: Notification Preferences. FR-076's two V1.5 opt-out-able
-- categories (N-06 quiet-gym alert, N-07 class reminder) need somewhere to
-- persist a member's choice today, even though neither has a dispatch
-- mechanism yet -- so that whenever V1.5 ships N-06/N-07's actual sending
-- logic, it only needs to add a `where not (select ... from
-- member_preferences ...)` guard, no new onboarding flow, no re-asking
-- members, no schema migration required at that point. N-01-N-05 (0045/0046)
-- remain completely untouched -- mandatory notifications have no opt-out
-- path in V1.
--
-- Per-member, not per-user: member_id references members(id), not users(id)
-- -- a platform user with memberships at multiple gyms (FR-001) gets
-- independent preferences per gym, matching the architecture's explicit
-- `members (1) --< member_preferences` relationship (N-06/N-07 are inherently
-- gym-scoped concepts, not account-wide ones).
--
-- Lives in `public`, not `private`: a deliberate divergence from 0045/0046's
-- `private.notification_dispatches`/`private.payment_notification_dispatches`
-- precedent. Those are server-internal transport ledgers no client ever
-- reads. This table is the opposite -- a member must read and write their
-- own row directly via supabase-js from the mobile app (architecture's "no
-- custom API -- apps call Supabase directly through the service layer"
-- rule), so it needs real client-facing RLS, not a service_role-only grant.

create table member_preferences (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references members(id) on delete cascade,
  gym_id uuid not null references gyms(id),
  quiet_gym_alerts_opted_out boolean not null default false,
  class_reminder_opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Denormalized from members.gym_id -- not optional. The architecture's Data
-- Boundaries section states "every child table below gyms carries gym_id --
-- the column every RLS policy filters on," and every other tenant-scoped
-- table in this codebase (members, subscriptions, payments,
-- attendance_events) follows that rule, even where (as here) no gym-staff
-- RLS policy currently reads it directly.
create index idx_member_preferences_gym_id on member_preferences(gym_id);

alter table member_preferences enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS --
-- RLS-then-grant is not "RLS is redundant with grant"; both layers are
-- required.
-- No `delete` grant to `authenticated` -- matches the "no self-insert/
-- self-delete policy" design below; `service_role` keeps full access for
-- server-side/admin operations.
grant select, insert, update on member_preferences to authenticated;
grant select, insert, update, delete on member_preferences to service_role;

-- Read-only self-service, mirroring self_read_own_membership (0013)'s shape.
create policy "self_read_own_member_preferences" on member_preferences
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

-- Same shape as self_update_own_member_onboarding_fields (0020).
create policy "self_update_own_member_preferences" on member_preferences
  for update
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (member_id in (select id from members where user_id = auth.uid()));

-- No self-insert/self-delete policy -- rows are created only by the trigger
-- below, never directly by a client. Matches the "member never inserts their
-- own members row either" precedent (member rows are staff/onboarding
-- created, not self-created) and prevents a member from forging a second
-- preferences row for the same member_id (the unique constraint would block
-- it anyway, but no INSERT policy means the attempt never reaches the
-- constraint check).

-- RLS is row-level, not column-level (the recurring lesson from
-- protect_self_managed_user_columns 0015 and protect_self_managed_member_columns
-- 0020): the update policy above alone would let a member overwrite
-- member_id/gym_id on their own row via a raw client update. Unlike members
-- (which has its own user_id column to compare directly against auth.uid()),
-- member_preferences has no user_id column -- the ownership check must join
-- through members. No security definer -- only reads auth.uid() and the row
-- already in scope under the caller's own RLS, same rationale 0020's sibling
-- trigger documents.
create function private.protect_self_managed_member_preferences_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from members where id = old.member_id and user_id = auth.uid()) then
    new.member_id := old.member_id;
    new.gym_id := old.gym_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger protect_self_managed_member_preferences_columns
  before update on member_preferences
  for each row execute function private.protect_self_managed_member_preferences_columns();

-- Keeps updated_at current on every write, same pattern as 0044's
-- device_push_tokens fix -- without this, updated_at stays frozen at
-- row-creation time forever, since the pin-back trigger leaves it writable
-- but nothing else ever sets it.
create function private.set_member_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_member_preferences_updated_at
  before update on member_preferences
  for each row execute function private.set_member_preferences_updated_at();

-- Auto-create trigger: every new members row gets exactly one
-- member_preferences row, both categories defaulting opted-in (false = not
-- opted out). security definer required -- it writes into a different table
-- than the one being inserted into, from a trigger context that doesn't
-- itself carry the necessary grant, mirroring public.handle_new_user()'s
-- (0003) rationale.
create function private.create_default_member_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_preferences (member_id, gym_id)
  values (new.id, new.gym_id)
  on conflict (member_id) do nothing;
  return new;
end;
$$;

create trigger create_default_member_preferences
  after insert on members
  for each row execute function private.create_default_member_preferences();

-- Backfill: every member created by Stories 2.3/2.4/2.6 before this
-- migration must not be left without a preferences row (AC #1 must hold for
-- the whole existing dataset, not just future inserts).
insert into member_preferences (member_id, gym_id)
select id, gym_id from members
on conflict (member_id) do nothing;
