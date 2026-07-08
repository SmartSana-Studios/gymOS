-- Platform-wide tiers (not gym-owned) and gyms (the tenant root table).
-- Every table below this one carries gym_id, the column every RLS policy filters on.

create table tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_price integer not null,
  annual_price integer not null,
  member_cap integer not null,
  created_at timestamptz not null default now()
);

create table gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier_id uuid not null references tiers(id),
  status gym_status not null default 'active',
  logo_url text,
  primary_color text,
  timezone text not null default 'Africa/Douala',
  default_language text not null default 'en',
  grace_period_days integer not null default 3,
  capacity integer,
  alert_auto_dismiss_minutes integer not null default 30,
  -- gen_random_uuid() (core Postgres, no pgcrypto needed) doubles as a non-guessable,
  -- unique token for the QR code (FR-043) without pulling in gen_random_bytes()/pgcrypto.
  gym_token text not null unique default gen_random_uuid()::text,
  created_at timestamptz not null default now()
);

create index idx_gyms_tier_id on gyms(tier_id);

-- RLS enabled with a deny-all default in the same migration as CREATE TABLE, per the
-- "no open table window" rule (NFR-001) -- no business policies added here.
-- The one canary policy this story adds to `gyms` lives in 0009, once the auth.gym_id()-
-- equivalent helper it depends on actually exists (see 0009 for why and where).
alter table tiers enable row level security;
alter table gyms enable row level security;

-- Table-level GRANTs are a separate, lower layer than RLS: Postgres checks the base
-- privilege before RLS ever runs, so without these, a denied query returns a hard
-- "permission denied for table" error instead of the intended "0 rows, no error"
-- deny-all behavior (confirmed via manual end-to-end verification against a real
-- PostgREST request during this story). `anon` is deliberately not granted here --
-- no unauthenticated flow in this app touches gym/tier data.
grant select, insert, update, delete on tiers to authenticated, service_role;
grant select, insert, update, delete on gyms to authenticated, service_role;
