-- Story 24.4 (AD-42, NFR-024): public_site_reader may read the views in schema public_site and nothing else.
--
-- The enumeration below walks every relation, column, sequence, function, schema, database, default privilege and role
-- membership, so a stray grant anywhere (including one inherited from PUBLIC) fails this file. It is shown able to fail by
-- granting a stray privilege inside the transaction. The view columns and the allowed `content` keys are pinned: changing
-- either means editing the pinned list below in the same change (24.7/24.8 extend the view on purpose).

begin;
select plan(47);

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
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relkind <> 'v'), 0,
  'public_site holds views only'
);
select is(
  (select array_agg(relname::text order by relname) from pg_class c where c.relnamespace = 'public_site'::regnamespace),
  array['page_media', 'pages'], 'public_site holds exactly the views pages and page_media (24.6 added page_media); edit this list with any view change'
);
select is(
  (select count(*)::int from pg_proc where pronamespace = 'public_site'::regnamespace), 0,
  'public_site holds no functions'
);
select is(
  (select count(*)::int from pg_roles r, unnest(array['USAGE', 'CREATE']) p
   where r.rolname in ('anon', 'authenticated', 'service_role') and has_schema_privilege(r.rolname, 'public_site', p)),
  0, 'anon, authenticated, service_role hold nothing on schema public_site'
);
select is(
  (select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) g, unnest(array['public_site.pages', 'public_site.page_media', 'public.gym_pages', 'public.gym_page_media']) t,
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
  array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at'],
  'public_site.pages columns are pinned (gym_id is deliberately absent); edit this list with any view change'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public_site' and table_name = 'page_media'),
  array['derivative_key', 'kind', 'sort_order'],
  'public_site.page_media columns are pinned (gym_id and the original key are deliberately absent); edit this list with any view change'
);
select is(
  (select array(select (regexp_matches(substring(pg_get_constraintdef(oid) from 'ARRAY\[(.*)\]'), '''([a-z_]+)''', 'g'))[1] order by 1)
   from pg_constraint where conname = 'gym_pages_content_keys'),
  array['about_en', 'about_fr', 'address', 'banner', 'category', 'city', 'color', 'contact', 'country', 'gallery', 'hours',
        'logo', 'map', 'plans', 'services_en', 'services_fr'],
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
  $$ update public.gym_pages set content = '{"about_en":"a","about_fr":"a","services_en":"s","services_fr":"s","plans":[],"address":{},"map":{},"hours":{},"contact":{},"gallery":[],"banner":"b","logo":"l","color":"#fff","category":"gym","city":"c","country":"CM"}'
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

-- ---------------------------------------------------------------------------
-- Denied reads, writes, role changes and functions (as the reader)
-- ---------------------------------------------------------------------------
select is(pg_temp.as_reader('select count(*) from public.members'), 'ERR:42501', 'select on members is refused');
select is(pg_temp.as_reader('select count(*) from public.gyms'), 'ERR:42501', 'select on gyms is refused');
select is(pg_temp.as_reader('select count(*) from public.gym_pages'), 'ERR:42501', 'select on gym_pages is refused');
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
select ok(pg_temp.as_reader('select auth.uid()') = 'ERR:42501', 'calling an auth function is refused');

select * from finish();
rollback;
