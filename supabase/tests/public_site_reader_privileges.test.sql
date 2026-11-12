-- Story 24.4 (AD-42, NFR-024): public_site_reader may read the views in schema public_site and nothing else.
--
-- The enumeration below walks every relation, column, sequence, function, schema, database, default privilege and role
-- membership, so a stray grant anywhere (including one inherited from PUBLIC) fails this file. It is shown able to fail by
-- granting a stray privilege inside the transaction. The view columns and the allowed `content` keys are pinned: changing
-- either means editing the pinned list below in the same change (24.7/24.8 extend the view on purpose).

begin;
select plan(77);

-- The migration owner is not allowed to SET ROLE to the reader by default; grant it inside this rolled-back transaction so the
-- denial assertions below prove a missing privilege, not a missing SET ROLE right.
grant public_site_reader to postgres with set true;

-- Runs one query as the reader and returns its first value as text, or 'ERR:<sqlstate>'. Defined as postgres, so the test
-- harness (pgtap lives in a schema the reader cannot use) never runs as the reader.
create function pg_temp.as_reader(q text) returns text language plpgsql as $f$
declare
  v text;
begin
  set local role public_site_reader;
  execute q into v;
  reset role;
  return coalesce(v, 'NULL');
exception when others then
  reset role;
  return 'ERR:' || sqlstate;
end
$f$;

-- Every privilege the reader holds (own, via PUBLIC, via any role) that is not USAGE on public_site or SELECT on its views.
-- Functions and relations count only when the reader can also reach their schema (a PUBLIC EXECUTE on an unreachable schema
-- is inert), but the schema list itself is checked separately and strictly.
create function pg_temp.reader_violations() returns table(kind text, detail text) language sql as $f$
  with r as (select 'public_site_reader'::name as role),
  user_schemas as (
    select n.oid, n.nspname from pg_namespace n
    where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
  ),
  -- Objects count where the reader can reach their schema, or where the reader itself holds an explicit grant (so a stray grant in an
  -- unreachable schema is still caught). A PUBLIC grant on an object in a schema the reader has no USAGE on is inert. Schema `net` (pg_net) is the one platform-owned exception: supabase_admin owns it and grants USAGE to PUBLIC, which
  -- migrations cannot revoke (WARNING: no privileges could be revoked). It is pinned in its own assertion below, not hidden.
  reachable as (
    select s.oid, s.nspname from user_schemas s, r
    where has_schema_privilege(r.role, s.oid, 'USAGE') and s.nspname <> 'net'
  )
  -- schemas
  select 'schema', s.nspname || ' ' || p
  from user_schemas s, r, unnest(array['USAGE', 'CREATE']) p
  where has_schema_privilege(r.role, s.oid, p) and s.nspname <> 'net' and not (s.nspname = 'public_site' and p = 'USAGE')
  union all
  -- tables, views, sequences (table-level privileges)
  select 'relation', s.nspname || '.' || c.relname || ' ' || p
  from pg_class c join user_schemas s on s.oid = c.relnamespace, r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  where c.relkind in ('r', 'v', 'm', 'f', 'p')
    and has_table_privilege(r.role, c.oid, p)
    and s.nspname <> 'net' and (s.oid in (select oid from reachable) or exists (select 1 from aclexplode(c.relacl) x where x.grantee = r.role::regrole))
    and not (s.nspname = 'public_site' and c.relkind = 'v' and p = 'SELECT')
  union all
  select 'sequence', s.nspname || '.' || c.relname || ' ' || p
  from pg_class c join user_schemas s on s.oid = c.relnamespace, r, unnest(array['USAGE', 'SELECT', 'UPDATE']) p
  where c.relkind = 'S' and has_sequence_privilege(r.role, c.oid, p) and s.nspname <> 'net'
    and (s.oid in (select oid from reachable) or exists (select 1 from aclexplode(c.relacl) x where x.grantee = r.role::regrole))
  union all
  -- columns (catches column-level grants that no table-level check sees)
  select 'column', s.nspname || '.' || c.relname || '.' || a.attname || ' ' || p
  from pg_attribute a join pg_class c on c.oid = a.attrelid join user_schemas s on s.oid = c.relnamespace, r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v', 'm', 'f', 'p')
    and has_column_privilege(r.role, c.oid, a.attnum, p)
    and s.nspname <> 'net'
    and (s.oid in (select oid from reachable) or exists (select 1 from aclexplode(c.relacl) x where x.grantee = r.role::regrole)
         or exists (select 1 from aclexplode(a.attacl) x where x.grantee = r.role::regrole))
    and not (s.nspname = 'public_site' and c.relkind = 'v' and p = 'SELECT')
  union all
  -- functions and procedures (PUBLIC grants EXECUTE by default)
  select 'function', s.nspname || '.' || pr.proname
  from pg_proc pr join user_schemas s on s.oid = pr.pronamespace, r
  where has_function_privilege(r.role, pr.oid, 'EXECUTE') and s.nspname <> 'net'
    -- 24.11: the ONE function the reader may execute (changed deliberately; pinned by name and signature below)
    and not (s.nspname = 'public_site' and pr.oid = 'public_site.submit_page_report(text,text,text,text)'::regprocedure)
    and (s.oid in (select oid from reachable) or exists (select 1 from aclexplode(pr.proacl) x where x.grantee = r.role::regrole))
  union all
  -- database: CONNECT is the point of a login role; TEMPORARY comes from PUBLIC and is inert under default_transaction_read_only
  select 'database', 'CREATE'
  from r where has_database_privilege(r.role, current_database(), 'CREATE')
  union all
  -- default privileges that would hand anything in public_site to the reader or a client role
  select 'default_acl', d.defaclobjtype::text
  from pg_default_acl d, aclexplode(d.defaclacl) x
  where d.defaclnamespace = 'public_site'::regnamespace
    and (x.grantee = 0 or x.grantee::regrole::text in ('public_site_reader', 'anon', 'authenticated', 'service_role'))
  union all
  -- role membership, direct or inherited
  select 'membership', ro.rolname
  from pg_roles ro, r
  where ro.rolname <> r.role and (pg_has_role(r.role, ro.oid, 'MEMBER') or pg_has_role(r.role, ro.oid, 'USAGE'))
  union all
  -- schema net is exempt from the branches above (PUBLIC-granted, platform-owned, pinned below), but an ACL entry naming the reader itself is not
  select 'net_explicit', c.relname::text
  from pg_class c, r where c.relnamespace = 'net'::regnamespace
    and (exists (select 1 from aclexplode(c.relacl) x where x.grantee = r.role::regrole)
         or exists (select 1 from pg_attribute a, aclexplode(a.attacl) x where a.attrelid = c.oid and x.grantee = r.role::regrole))
  union all
  select 'net_explicit', pr.proname::text
  from pg_proc pr, r where pr.pronamespace = 'net'::regnamespace
    and exists (select 1 from aclexplode(pr.proacl) x where x.grantee = r.role::regrole)
$f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000a04', 'Public Site Test Tier', 5000, 50000, 30);

-- Visibility matrix: one gym per row (gym_pages is one row per gym). Suspended is seeded at insert (a later UPDATE reverts).
insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-00000000a401', 'Page Gym Visible',     '00000000-0000-0000-0000-000000000a04', 30, 'active'),
  ('00000000-0000-0000-0000-00000000a402', 'Page Gym Unpublished', '00000000-0000-0000-0000-000000000a04', 30, 'active'),
  ('00000000-0000-0000-0000-00000000a403', 'Page Gym Unpub At',    '00000000-0000-0000-0000-000000000a04', 30, 'active'),
  ('00000000-0000-0000-0000-00000000a404', 'Page Gym Taken Down',  '00000000-0000-0000-0000-000000000a04', 30, 'active'),
  ('00000000-0000-0000-0000-00000000a405', 'Page Gym Suspended',   '00000000-0000-0000-0000-000000000a04', 30, 'suspended'),
  ('00000000-0000-0000-0000-00000000a406', 'Page Gym Deactivated', '00000000-0000-0000-0000-000000000a04', 30, 'deactivated');

-- 24.7: gym_pages.page_name_id has a foreign key to page_names, so each page gets a real name row first
insert into public.page_names (id, gym_id, name, state, origin) values
  ('00000000-0000-0000-0000-0000000a4a01', '00000000-0000-0000-0000-00000000a401', 'psr-visible', 'active', 'claim'),
  ('00000000-0000-0000-0000-0000000a4a02', '00000000-0000-0000-0000-00000000a402', 'psr-unpublished', 'active', 'claim'),
  ('00000000-0000-0000-0000-0000000a4a03', '00000000-0000-0000-0000-00000000a403', 'psr-unpub-at', 'active', 'claim'),
  ('00000000-0000-0000-0000-0000000a4a04', '00000000-0000-0000-0000-00000000a404', 'psr-taken-down', 'active', 'claim'),
  ('00000000-0000-0000-0000-0000000a4a05', '00000000-0000-0000-0000-00000000a405', 'psr-suspended', 'active', 'claim'),
  ('00000000-0000-0000-0000-0000000a4a06', '00000000-0000-0000-0000-00000000a406', 'psr-deactivated', 'active', 'claim');

insert into public.gym_pages (gym_id, page_name_id, template, published_at, unpublished_at, taken_down_at, content) values
  ('00000000-0000-0000-0000-00000000a401', '00000000-0000-0000-0000-0000000a4a01', 'classic', now(), null, null, '{"city":"Douala"}'),
  ('00000000-0000-0000-0000-00000000a402', '00000000-0000-0000-0000-0000000a4a02', 'classic', null,  null, null, '{}'),
  ('00000000-0000-0000-0000-00000000a403', '00000000-0000-0000-0000-0000000a4a03', 'classic', now(), now(), null, '{}'),
  ('00000000-0000-0000-0000-00000000a404', '00000000-0000-0000-0000-0000000a4a04', 'classic', now(), null, now(), '{}'),
  ('00000000-0000-0000-0000-00000000a405', '00000000-0000-0000-0000-0000000a4a05', 'classic', now(), null, null, '{}'),
  ('00000000-0000-0000-0000-00000000a406', '00000000-0000-0000-0000-0000000a4a06', 'classic', now(), null, null, '{}');

-- ---------------------------------------------------------------------------
-- Role shape
-- ---------------------------------------------------------------------------
select is(
  (select concat_ws(',', rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolconnlimit)
   from pg_roles where rolname = 'public_site_reader'),
  't,f,f,f,f,f,f,20',
  'role: login, not superuser, NOINHERIT, no CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS, CONNECTION LIMIT 20'
);
select is(
  (select array(select unnest(rolconfig) order by 1) from pg_roles where rolname = 'public_site_reader'),
  array['default_transaction_read_only=on', 'idle_in_transaction_session_timeout=5s', 'lock_timeout=1s', 'statement_timeout=3s'],
  'role settings: statement_timeout 3s, idle_in_transaction_session_timeout 5s, lock_timeout 1s, default_transaction_read_only on, nothing else'
);
select is(
  (select count(*)::int from pg_auth_members m join pg_roles mem on mem.oid = m.member where mem.rolname = 'public_site_reader'),
  0, 'role is a member of no role'
);

-- ---------------------------------------------------------------------------
-- Full privilege enumeration
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_temp.reader_violations()), 0,
  'reader holds no privilege beyond USAGE on public_site and SELECT on its views (relations, columns, sequences, functions, schemas, database, defaults, memberships)'
);
select is(
  (select array(select schema_name::text from information_schema.schemata where has_schema_privilege('public_site_reader', schema_name, 'USAGE')
                and schema_name not like 'pg\_%' and schema_name <> 'information_schema' order by 1)),
  array['net', 'public_site'],
  'reader has USAGE on public_site and on no other schema except platform-owned net (public, private, auth, extensions excluded); see decisions.md 24.4'
);
select is((select reloptions from pg_class where oid = 'public_site.pages'::regclass), array['security_barrier=true'], 'public_site.pages is a security_barrier view');
select is((select reloptions from pg_class where oid = 'public_site.page_media'::regclass), array['security_barrier=true'], 'public_site.page_media is a security_barrier view');
select is((select reloptions from pg_class where oid = 'public_site.page_redirects'::regclass), array['security_barrier=true'], 'public_site.page_redirects is a security_barrier view (24.10)');
select is((select reloptions from pg_class where oid = 'public_site.directory_gym'::regclass), array['security_barrier=true'], 'public_site.directory_gym is a security_barrier view (25.2)');
select is((select reloptions from pg_class where oid = 'public_site.directory_city'::regclass), array['security_barrier=true'], 'public_site.directory_city is a security_barrier view (25.2)');
select is((select reloptions from pg_class where oid = 'public_site.directory_country'::regclass), array['security_barrier=true'], 'public_site.directory_country is a security_barrier view (25.2)');
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relkind <> 'v'), 0,
  'public_site holds views only'
);
select is(
  (select array_agg(relname::text order by relname) from pg_class c where c.relnamespace = 'public_site'::regnamespace),
  array['directory_city', 'directory_country', 'directory_gym', 'page_media', 'page_redirects', 'pages'],
  'public_site holds exactly the views pages, page_media, page_redirects and directory_gym, directory_city, directory_country (24.6 added page_media, 24.10 page_redirects, 25.2 the three directory views); edit this list with any view change'
);
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public_site'::regnamespace),
  array['public_site.submit_page_report(text,text,text,text)'],
  'public_site holds exactly one function, submit_page_report (24.11, changed deliberately); the reader executes it and nothing else'
);
select is(
  (select count(*)::int from pg_roles r, unnest(array['USAGE', 'CREATE']) p
   where r.rolname in ('anon', 'authenticated', 'service_role') and has_schema_privilege(r.rolname, 'public_site', p)),
  0, 'anon, authenticated, service_role hold nothing on schema public_site'
);
select is(
  (select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) g, unnest(array['public_site.pages', 'public_site.page_media', 'public_site.page_redirects', 'public_site.directory_gym', 'public_site.directory_city', 'public_site.directory_country', 'public.gym_pages', 'public.gym_page_media', 'public.page_names', 'public.page_name_words']) t,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
   where has_table_privilege(g, t, p)),
  0, 'PUBLIC, anon, authenticated, service_role hold no privilege on the public_site views or the tables behind them'
);
-- Pre-existing and outside migration control: pg_net objects are owned by supabase_admin and PUBLIC-readable (also to anon and
-- authenticated). Version-independent: the reader must hold on schema net exactly what a role with no grants of its own holds
-- (i.e. only what PUBLIC gives). PRODUCTION MUST BE CHECKED (decisions.md 24.4 checklist).
create role public_site_net_probe nologin;
create function pg_temp.net_privs(p_role name) returns text language sql as $f$
  select concat_ws(',',
    (select count(*) from pg_class c, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     where c.relnamespace = 'net'::regnamespace and c.relkind in ('r','v','m','f','p') and has_table_privilege(p_role, c.oid, p)),
    (select count(*) from pg_proc where pronamespace = 'net'::regnamespace and has_function_privilege(p_role, oid, 'EXECUTE')),
    (select count(*) from pg_class c, unnest(array['USAGE','SELECT','UPDATE']) p
     where c.relnamespace = 'net'::regnamespace and c.relkind = 'S' and has_sequence_privilege(p_role, c.oid, p)))
$f$;
select is(
  pg_temp.net_privs('public_site_reader'),
  pg_temp.net_privs('public_site_net_probe'),
  'reader holds on schema net only what a role with no grants holds (PUBLIC-inherited), independent of the pg_net version'
);
select is(
  (select count(*)::int from pg_default_acl where defaclnamespace = 'public_site'::regnamespace
     and exists (select 1 from aclexplode(defaclacl) x where x.grantee = 0 or x.grantee::regrole::text in ('anon', 'authenticated', 'service_role', 'public_site_reader'))),
  0, 'default privileges in public_site grant nothing to PUBLIC, anon, authenticated, service_role or the reader'
);

-- ---------------------------------------------------------------------------
-- The enumeration can fail: a stray grant inside this transaction must be reported (then removed)
-- ---------------------------------------------------------------------------
grant select on public.members to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray SELECT grant on a tenant table is reported by the enumeration');
revoke select on public.members from public_site_reader;
grant execute on function private.gym_id() to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray EXECUTE grant on a function is reported by the enumeration');
revoke execute on function private.gym_id() from public_site_reader;
grant usage on schema private to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray schema USAGE grant is reported by the enumeration');
revoke usage on schema private from public_site_reader;
-- column-level, sequence, database CREATE and role-membership branches
grant select (id) on public.members to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray column-level grant is reported by the enumeration');
revoke select (id) on public.members from public_site_reader;
create sequence public.zz_stray_seq;
grant usage on sequence public.zz_stray_seq to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray sequence grant is reported by the enumeration');
revoke usage on sequence public.zz_stray_seq from public_site_reader;
grant create on database postgres to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray CREATE on the database is reported by the enumeration');
revoke create on database postgres from public_site_reader;
grant authenticated to public_site_reader;
select cmp_ok((select count(*)::int from pg_temp.reader_violations()), '>', 0, 'a stray role membership is reported by the enumeration');
revoke authenticated from public_site_reader;
select is((select count(*)::int from pg_temp.reader_violations()), 0, 'after removing the stray grants the enumeration is clean again');

-- ---------------------------------------------------------------------------
-- Pinned shapes
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'pages'),
  array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name'],
  'public_site.pages columns are pinned (gym_id is deliberately absent; 24.8 added name, the page name); edit this list with any view change'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'page_media'),
  array['derivative_key', 'kind', 'sort_order', 'page_name_id'],
  'public_site.page_media columns are pinned (gym_id and the original key are deliberately absent; 24.8 added page_name_id); edit this list with any view change'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'page_redirects'),
  array['old_name', 'name'],
  'public_site.page_redirects columns are pinned (24.10: the old name and the current name; no gym id); edit this list with any view change'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'directory_gym'),
  array['country_code', 'city_slug', 'city_name', 'category', 'name', 'page_name', 'logo_key'],
  'public_site.directory_gym columns are pinned (25.2: no gym_id, city_id, page_name_id, banner, hours, plans, contact, address, map or colour); edit this list with any view change'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'directory_city'),
  array['country_code', 'city_slug', 'city_name', 'lat', 'lng', 'published_count', 'indexable'],
  'public_site.directory_city columns are pinned (25.2: the city''s own lat/lng, never a gym position, no ids); edit this list with any view change'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'directory_country'),
  array['country_code', 'name_en', 'name_fr', 'published_count', 'indexable'],
  'public_site.directory_country columns are pinned (25.2); edit this list with any view change'
);
select is(
  (select array(select (regexp_matches(substring(pg_get_constraintdef(oid) from 'ARRAY\[(.*)\]'), '''([a-z_]+)''', 'g'))[1] order by 1)
   from pg_constraint where conname = 'gym_pages_content_keys'),
  array['about_en', 'about_fr', 'address', 'banner', 'category', 'city', 'color', 'contact', 'country', 'default_language', 'gallery', 'hours',
        'logo', 'map', 'name', 'plans', 'services_en', 'services_fr'],
  'allowed top-level content keys are pinned; edit this list with any CHECK change'
);
select throws_ok(
  $$ insert into public.gym_pages (gym_id, template, content) values ('00000000-0000-0000-0000-00000000a402', 'x', '{"members": []}') on conflict (gym_id) do update set content = excluded.content $$,
  '23514', null, 'a content key outside the allowed list violates the CHECK'
);
select throws_ok(
  $$ update public.gym_pages set content = '[]' where gym_id = '00000000-0000-0000-0000-00000000a402' $$,
  '23514', null, 'content must be a JSON object'
);
select lives_ok(
  $$ update public.gym_pages set content = '{"about_en":"a","about_fr":"a","services_en":"s","services_fr":"s","plans":[],"address":{},"map":{},"hours":{},"contact":{},"gallery":[],"banner":"b","logo":"l","color":"#fff","category":"gym","city":"c","country":"CM","default_language":"en"}'
     where gym_id = '00000000-0000-0000-0000-00000000a402' $$,
  'every allowed key is accepted'
);
update public.gym_pages set content = '{}' where gym_id = '00000000-0000-0000-0000-00000000a402';
select is(
  (select relrowsecurity from pg_class where oid = 'public.gym_pages'::regclass), true, 'gym_pages has row level security enabled'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'gym_pages'), 0,
  'gym_pages has no policy for any client role'
);

select is(
  (select count(*)::int from unnest(array['anon','authenticated','service_role','supabase_auth_admin']) r join pg_roles on rolname = r where not has_schema_privilege(r, 'public', 'USAGE')),
  0, 'intended holders (anon, authenticated, service_role, supabase_auth_admin) keep USAGE on schema public after the PUBLIC revoke'
);
select is(
  (select count(*)::int from unnest(array['INSERT','UPDATE','DELETE']) p where has_table_privilege('public_site_reader', 'public_site.pages', p)),
  0, 'reader holds no INSERT, UPDATE or DELETE privilege on public_site.pages (the real write-denial proof)'
);

-- ---------------------------------------------------------------------------
-- Visibility matrix (read as the reader)
-- ---------------------------------------------------------------------------
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '1',
  'only the published, not unpublished, not taken down, active-gym row is visible');
select is(pg_temp.as_reader('select page_name_id from public_site.pages'), '00000000-0000-0000-0000-0000000a4a01',
  'the visible row is the published one');
select is(pg_temp.as_reader('select content->>''city'' from public_site.pages'), 'Douala', 'content is readable through the view');
select is(pg_temp.as_reader('select gym_id from public_site.pages'), 'ERR:42703', 'gym_id is not a view column');
select is(pg_temp.as_reader('select name from public_site.pages'), 'psr-visible', '24.8: the page name is a view column');
-- 24.8: the one visibility predicate also requires the page name to be active and not taken down, and the name to be the page's own gym's
update public.page_names set state = 'released' where id = '00000000-0000-0000-0000-0000000a4a01';
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '0', 'a page whose name is not active is hidden');
update public.page_names set state = 'active' where id = '00000000-0000-0000-0000-0000000a4a01';
update public.page_names set taken_down_at = now() where id = '00000000-0000-0000-0000-0000000a4a01';
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '0', 'a page whose name is taken down is hidden');
update public.page_names set taken_down_at = null where id = '00000000-0000-0000-0000-0000000a4a01';
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '1', 'control: with the name active again the page is visible');
-- the media view is built from the snapshot of the visible page, keyed by page_name_id
update public.gym_pages set content = '{"logo":"11111111-1111-1111-1111-111111111111.webp","banner":"22222222-2222-2222-2222-222222222222.webp","gallery":["33333333-3333-3333-3333-333333333333.webp","44444444-4444-4444-4444-444444444444.webp"]}'
 where gym_id = '00000000-0000-0000-0000-00000000a401';
select is(pg_temp.as_reader('select string_agg(kind || ''/'' || sort_order || ''/'' || left(derivative_key, 2), '','' order by kind, sort_order) from public_site.page_media'), 'banner/0/22,gallery/1/33,gallery/2/44,logo/0/11',
  'page_media lists the snapshot''s logo, banner and gallery keys in gallery order');
select is(pg_temp.as_reader('select count(distinct page_name_id) from public_site.page_media'), '1', 'all of it keyed by the one page_name_id');

-- ---------------------------------------------------------------------------
-- 24.10: public_site.page_redirects (old name -> current name, only while the current page is visible)
-- ---------------------------------------------------------------------------
insert into public.page_names (id, gym_id, name, state, origin, reserved_until) values
  ('00000000-0000-0000-0000-0000000a4b01', '00000000-0000-0000-0000-00000000a401', 'psr-old-name', 'redirect', 'rename', now() + interval '6 months');
select is(pg_temp.as_reader('select old_name || ''>'' || name from public_site.page_redirects'), 'psr-old-name>psr-visible',
  'a redirect inside its 12 months resolves to the current visible name, in one hop');
select is(pg_temp.as_reader('select gym_id from public_site.page_redirects'), 'ERR:42703', 'gym_id is not a page_redirects column');
update public.page_names set reserved_until = now() - interval '1 minute' where id = '00000000-0000-0000-0000-0000000a4b01';
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects'), '0', 'an expired redirect is not offered (the sweep has not run yet)');
update public.page_names set reserved_until = now() + interval '6 months', taken_down_at = now() where id = '00000000-0000-0000-0000-0000000a4b01';
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects'), '0', 'a taken-down old name is not offered');
update public.page_names set taken_down_at = null, state = 'released' where id = '00000000-0000-0000-0000-0000000a4b01';
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects'), '0', 'a released old name is not offered');
update public.page_names set state = 'redirect' where id = '00000000-0000-0000-0000-0000000a4b01';
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects'), '1', 'control: back in the redirect state it resolves again');
update public.gym_pages set unpublished_at = now() where gym_id = '00000000-0000-0000-0000-00000000a401';
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects'), '0', 'the current page is unpublished: no redirect (the public site answers the uniform not-found)');
update public.gym_pages set unpublished_at = null where gym_id = '00000000-0000-0000-0000-00000000a401';
update public.page_names set taken_down_at = now() where id = '00000000-0000-0000-0000-0000000a4a01';
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects'), '0', 'the current name is taken down: no redirect');
update public.page_names set taken_down_at = null where id = '00000000-0000-0000-0000-0000000a4a01';
select ok(pg_temp.as_reader('insert into public_site.page_redirects (old_name) values (''x'')') = 'ERR:55000', 'insert into page_redirects is refused');

-- Two gyms: an old name resolves only to the current name of ITS OWN gym (the a.gym_id = r.gym_id join). With one visible gym every
-- assertion above passes without that join; here gym a402 has an old name of its own and both pages are visible at the same time.
insert into public.page_names (id, gym_id, name, state, origin, reserved_until) values
  ('00000000-0000-0000-0000-0000000a4b02', '00000000-0000-0000-0000-00000000a402', 'psr-old-two', 'redirect', 'rename', now() + interval '6 months');
select is(pg_temp.as_reader('select count(*) from public_site.page_redirects where old_name = ''psr-old-two'''), '0',
  'an old name of a gym whose page is hidden resolves to nothing, not to the other gym''s visible page');
update public.gym_pages set published_at = now() where gym_id = '00000000-0000-0000-0000-00000000a402';
select is(pg_temp.as_reader('select string_agg(old_name || ''>'' || name, '','' order by old_name) from public_site.page_redirects'),
  'psr-old-name>psr-visible,psr-old-two>psr-unpublished',
  'with two visible gyms each old name resolves to its own gym''s current name only (no cross-gym match)');
update public.gym_pages set published_at = null where gym_id = '00000000-0000-0000-0000-00000000a402';
delete from public.page_names where id = '00000000-0000-0000-0000-0000000a4b02';

-- ---------------------------------------------------------------------------
-- Denied reads, writes, role changes and functions (as the reader)
-- ---------------------------------------------------------------------------
select is(pg_temp.as_reader('select count(*) from public.members'), 'ERR:42501', 'select on members is refused');
select is(pg_temp.as_reader('select count(*) from public.gyms'), 'ERR:42501', 'select on gyms is refused');
select is(pg_temp.as_reader('select count(*) from public.gym_pages'), 'ERR:42501', 'select on gym_pages is refused');
select is(pg_temp.as_reader('select count(*) from public.page_names'), 'ERR:42501', 'select on page_names is refused (24.7)');
select is(pg_temp.as_reader('select count(*) from public.page_name_words'), 'ERR:42501', 'select on page_name_words is refused (24.7)');
select is(pg_temp.as_reader('select count(*) from public.audit_log'), 'ERR:42501', 'select on audit_log is refused');
select ok(pg_temp.as_reader('insert into public_site.pages (template) values (''x'')') = 'ERR:55000', 'insert into the view is refused (non-updatable join view; privilege denial is proved by the count above)');
select ok(pg_temp.as_reader('insert into public.gym_pages (gym_id, template) values (gen_random_uuid(), ''x'')') = 'ERR:42501', 'insert into gym_pages is refused');
select ok(pg_temp.as_reader('update public_site.pages set template = ''x''') = 'ERR:55000', 'update through the view is refused (non-updatable join view)');
select ok(pg_temp.as_reader('delete from public_site.pages') = 'ERR:55000', 'delete through the view is refused (non-updatable join view)');
-- SET ROLE is checked against the session user, which in this harness is postgres, so it cannot be exercised here; ask the catalog.
select is(
  (select count(*)::int from unnest(array['postgres', 'anon', 'authenticated', 'service_role', 'supabase_admin', 'authenticator']) r
   where pg_has_role('public_site_reader', r, 'SET')),
  0, 'the reader may SET ROLE to no platform role'
);
select ok(pg_temp.as_reader('select private.gym_id()') = 'ERR:42501', 'calling a private function is refused');
select is(pg_temp.as_reader($q$select public_site.submit_page_report('psr-visible', 'privacy', 'A report', '$q$ || repeat('ab', 32) || $q$')$q$), 'ok',
  '24.11: the reader executes submit_page_report (the only function it may call) and a report on the visible page is stored');
select is(pg_temp.as_reader('select count(*) from private.page_reports'), 'ERR:42501', '24.11: the reader cannot read the reports table (no USAGE on private, no grant)');
select is(pg_temp.as_reader($q$select public.take_down_gym_page('00000000-0000-0000-0000-00000000a401', 'privacy', null)$q$), 'ERR:42501', '24.11: the reader cannot call the takedown function');
select ok(pg_temp.as_reader('select auth.uid()') = 'ERR:42501', 'calling an auth function is refused');

select * from finish();
rollback;
