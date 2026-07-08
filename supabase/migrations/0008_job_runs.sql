-- Global, not gym-scoped: one row per background job execution across all gyms
-- (architecture.md #Entity Relationships). No gym_id column, by design.
create table job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status job_status,
  error text
);

alter table job_runs enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS. Granting
-- here does not expose job_runs to any client -- RLS deny-all (no policies) still
-- blocks every row for every role until a future story adds one; this only keeps the
-- deny-all failure mode uniform ("0 rows", not "permission denied for table") across
-- every table in the schema, which the cross-cutting pgTAP test asserts for all of them.
grant select, insert, update, delete on job_runs to authenticated, service_role;
