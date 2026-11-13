-- Rollback for migration 0172 (directory city-slug redirects, Story 25.7).
-- Drops public_site.directory_city_redirect. Nothing else changed in 0172. Roll back the 25.7 landing code that reads it first (the old-slug 301):
-- it would answer the uniform not-found on a database error, but it logs directory_db_error for every unknown city slug.
-- ORDER: run this BEFORE rollback-0170 (and 0169). rollback-0170 drops private.gym_page_visible without cascade, which fails while this view exists.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0172-directory-city-slug-redirects.sql

set local lock_timeout = '5s';

drop view if exists public_site.directory_city_redirect;

do $verify$
begin
  if to_regclass('public_site.directory_city_redirect') is not null then
    raise exception 'rollback-0172: the view is still there';
  end if;
  if (select count(*) from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relkind = 'v') <> 6 then
    raise exception 'rollback-0172: public_site should hold six views again';
  end if;
end
$verify$;
