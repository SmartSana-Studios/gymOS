-- Story 24.4 (AD-42, AD-46, NFR-024): the public site's only database door.
--
-- Schema `public_site` holds views only. Login role `public_site_reader` can read those views and nothing else, so a defect in
-- apps/landing cannot expose a member, a payment or an unpublished field. `public.gym_pages` is created here as an empty,
-- writer-less snapshot table because the view needs a base (AD-46 names it as the only one); 24.8 adds writers and triggers,
-- 24.7 adds `page_names` and the name-active predicate.

-- ---------------------------------------------------------------------------
-- Schema: views only. Nothing here is granted to client roles, now or later.
-- ---------------------------------------------------------------------------
create schema if not exists public_site;

revoke all on schema public_site from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public_site revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public_site revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public_site revoke all on functions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Role: created without a password (no secret in git). Ops sets it out of band:
--   ALTER ROLE public_site_reader PASSWORD '...';
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'public_site_reader') then
    create role public_site_reader login;
  end if;
end
$$;

-- CREATE ROLE defaults leave SUPERUSER, REPLICATION and BYPASSRLS off; restating them needs a superuser, which migrations are
-- not, so the privilege test pins them instead. Everything a migration may set is restated so a drifted role is brought back.
alter role public_site_reader login nocreatedb nocreaterole noinherit connection limit 20;

-- CONNECTION LIMIT 20 = instances x pool max 3 + 1 headroom, effectively limit minus one (24.1); revisit at 24.10.
-- Role-level settings apply through the pooler (24.1).
alter role public_site_reader set statement_timeout = '3s';
alter role public_site_reader set default_transaction_read_only = on;
alter role public_site_reader set idle_in_transaction_session_timeout = '5s';
alter role public_site_reader set lock_timeout = '1s';

-- Member of no role (the pg_auth_members row set must be empty).
do $$
declare
  r record;
begin
  for r in
    select granted.rolname as granted_role
    from pg_auth_members m
    join pg_roles granted on granted.oid = m.roleid
    join pg_roles member on member.oid = m.member
    where member.rolname = 'public_site_reader'
  loop
    execute format('revoke %I from public_site_reader', r.granted_role);
  end loop;
end
$$;

-- No schema except public_site. PUBLIC holds USAGE on `public` by default; that is the only inherited schema privilege.
-- anon, authenticated, service_role and supabase_auth_admin keep their own explicit USAGE grants on `public`.
revoke usage on schema public from public;
grant usage on schema public_site to public_site_reader;

-- ---------------------------------------------------------------------------
-- Snapshot table: skeleton only. No policy for client roles, no writers, no triggers.
-- ---------------------------------------------------------------------------
create table public.gym_pages (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  -- No foreign key until `page_names` exists (24.7).
  page_name_id uuid,
  template text not null,
  schema_version integer not null default 1,
  content jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  unpublished_at timestamptz,
  taken_down_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Allowed top-level keys (FR-197/FR-206, OQ-28): text that a gym may enter in both languages is _en/_fr, each optional.
  -- Changing this list means changing the pinned list in supabase/tests/public_site_reader_privileges.test.sql in the same change.
  constraint gym_pages_content_keys check (
    jsonb_typeof(content) = 'object'
    and (content - array[
      'about_en', 'about_fr', 'services_en', 'services_fr', 'plans', 'address', 'map', 'hours',
      'contact', 'gallery', 'banner', 'logo', 'color', 'category', 'city', 'country'
    ]) = '{}'::jsonb
  )
);

alter table public.gym_pages enable row level security;
-- Deliberately no policy: client roles see nothing. The view below is owned by the migration owner and reads the table as owner.

revoke all on table public.gym_pages from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The one view. `gym_id` is deliberately not a column. 24.7/24.8 extend it (page name, name-active predicate) and
-- update the pinned column snapshot deliberately.
-- ---------------------------------------------------------------------------
create view public_site.pages with (security_barrier = true) as
select
  gp.page_name_id,
  gp.template,
  gp.schema_version,
  gp.content,
  gp.published_at,
  gp.updated_at
from public.gym_pages gp
join public.gyms g on g.id = gp.gym_id
where gp.published_at is not null
  and gp.unpublished_at is null
  and gp.taken_down_at is null
  and g.status = 'active';

revoke all on public_site.pages from public, anon, authenticated, service_role;
grant select on public_site.pages to public_site_reader;
