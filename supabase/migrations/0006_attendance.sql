create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  checkout_type text check (checkout_type in ('manual', 'auto')),
  created_at timestamptz not null default now()
);

-- The partial unique index enforcing "one open check-in per member" (FR-044) is
-- Epic 3's concern once check-in flows actually exist -- not added here.

create index idx_attendance_events_gym_id on attendance_events(gym_id);
create index idx_attendance_events_member_id on attendance_events(member_id);

alter table attendance_events enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on attendance_events to authenticated, service_role;
