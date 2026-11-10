-- Rollback for migration 0160 (the public site's database door, Story 24.4).
-- DESTRUCTIVE: drops the public_site schema, the public.gym_pages snapshot table (every published page) and the login role
-- public_site_reader, and gives PUBLIC its USAGE on schema public back (the Postgres and Supabase default that 0160 revoked).
-- Roll back every later 24.x migration (0167 .. 0161) FIRST, newest first: they add objects to public_site and gym_pages and
-- depend on both. Roll back the landing app code first as well (it connects as public_site_reader).
-- The role is cluster-level: the DROP ROLE below also removes its password; a re-apply of 0160 creates it again without one.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0160-public-site-reader.sql

-- Fail fast rather than queue writes behind a long transaction.
set local lock_timeout = '5s';

-- The view, then its base table, then the schema (nothing else may be left in public_site by now).
drop view if exists public_site.pages;
drop table if exists public.gym_pages;
drop schema if exists public_site;

-- The role: its grants and default privileges first, then the role itself. It owns nothing. On Supabase `postgres` is not a true
-- superuser, so it must be a member of the role (with inherit and set) before it may drop what the role holds; the membership goes
-- away with the role. (The migration created the role as postgres, so postgres may grant itself this.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'public_site_reader') then
    execute 'grant public_site_reader to postgres with inherit true, set true';
    execute 'drop owned by public_site_reader';
    execute 'drop role public_site_reader';
  end if;
end
$$;

-- What 0160 revoked: PUBLIC holds USAGE on schema public again.
grant usage on schema public to public;
