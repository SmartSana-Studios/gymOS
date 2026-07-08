-- `users` mirrors `auth.users` 1:1 (never an independent identity) and carries
-- platform-level fields (FR-001: phone-based identity, FR-004: Super Admin flag,
-- FR-015: language preference). `members` bridges a `users` row to a specific gym
-- with a gym-scoped role (FR-001: one user may be a member at multiple gyms via
-- separate `members` rows).

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  display_name text,
  preferred_language text not null default 'en',
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  user_id uuid not null references users(id) on delete cascade,
  role member_role not null,
  name text not null,
  phone text,
  email text,
  dob date,
  photo_url text,
  join_date date not null default current_date,
  emergency_contact text,
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_members_gym_id on members(gym_id);
-- Not just an RLS-filter index: the claims hook (0009) looks up a user's active
-- membership by user_id on every login, so this index is on the hot path for auth itself.
create index idx_members_user_id on members(user_id);
-- A user may hold at most one *active* membership per gym at a time (role changes go
-- through deactivate-then-recreate, not two simultaneously-active rows) -- also keeps
-- the claims hook's tie-break (0009) deterministic within a single gym.
create unique index idx_members_active_gym_user on members(gym_id, user_id) where deactivated_at is null;

alter table users enable row level security;
alter table members enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on users to authenticated, service_role;
grant select, insert, update, delete on members to authenticated, service_role;

-- Foundational plumbing for the `users` table this story owns: without this trigger,
-- no `public.users` row would ever exist for a real auth.users signup, which means no
-- `members` row could ever be created either (FK violation) -- blocking every later
-- story that creates a user (Epic 2 onboarding, Story 1.5 gym/staff creation).
-- SECURITY DEFINER is required because this function must write into `public.users`
-- as a side effect of an insert into `auth.users`, which the triggering context
-- (supabase_auth_admin) does not itself have privileges on.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone)
  values (new.id, new.phone);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
