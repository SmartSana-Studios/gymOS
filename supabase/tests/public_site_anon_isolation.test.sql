-- Story 24.12 (NFR-024, PRD 10.2 release gate): what the UNAUTHENTICATED role (`anon`) can reach, pinned.
--
-- `public_site_reader` has its own strict suite (public_site_reader_privileges.test.sql). This file covers the other door a visitor
-- could use: the Supabase API key without a login. The spec wording "no privilege on any relation or function" cannot hold today, so
-- this file asserts what is TRUE and pins it, and every pin is shown able to fail by a known-bad run inside the transaction:
--
--   * relations: anon holds no SELECT, INSERT, UPDATE or DELETE on any relation of a project schema, no sequence privilege, no
--     column-level grant, and nothing at all on `public_site` or `private`. The one residue is TRUNCATE, REFERENCES and TRIGGER on the
--     `public` tables, which Supabase's default privileges hand out and which migrations have never revoked (decisions.md 2026-10
--     "TRUNCATE/REFERENCES/TRIGGER default grants are unchanged"). PostgREST cannot issue them, but they are pinned here so no OTHER
--     privilege can appear unseen, and the follow-up is recorded in deferred-work.md.
--   * functions: anon may EXECUTE only the pinned allowlist below (non-trigger functions of the project schemas). The pre-auth OTP
--     helpers and the member-cap helpers have to be callable before a login exists. A new anon-executable function fails this file.
--     `private.has_active_gym_data_escalation` is PUBLIC-executable but inert: anon has no USAGE on schema `private`.
--   * platform-owned schemas (auth, storage, realtime, extensions, ...) belong to Supabase and are not judged here; storage RLS is
--     covered by the storage policy suites. Three platform schemas ARE judged, because a stray grant there would be a secret or a network
--     door: `vault` (anon holds nothing: no USAGE, no relation privilege, no function), `cron` (anon has no USAGE, so the SELECT/DELETE
--     grants on its tables and EXECUTE on its functions that PUBLIC inherits are inert; reachability is asserted) and `net` (pg_net: a known
--     residual, decisions.md 24.4: anon has USAGE and the privileges pg_net hands to PUBLIC; pinned to exactly that set so nothing new
--     appears; unreachable through the API because PostgREST exposes only `public` and `graphql_public`, supabase/config.toml).
--
-- A schema that is not on the platform list below counts as a project schema, so a new schema is judged automatically.

begin;
select plan(30);

-- Schemas owned by the Supabase platform: out of migration control, pinned by name. Everything else is judged.
create function pg_temp.project_schemas() returns table(oid oid, nspname name) language sql as $f$
  select n.oid, n.nspname from pg_namespace n
  where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
    and n.nspname not in ('_analytics', '_realtime', 'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'net', 'pgbouncer',
                          'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault')
$f$;

-- Every privilege anon holds on a relation (table, view, materialized view, foreign table, partitioned table) of a project schema,
-- except the pinned TRUNCATE / REFERENCES / TRIGGER residue on schema `public`.
create function pg_temp.anon_relation_violations() returns table(detail text) language sql as $f$
  select s.nspname || '.' || c.relname || ' ' || p
  from pg_class c join pg_temp.project_schemas() s on s.oid = c.relnamespace,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  where c.relkind in ('r', 'v', 'm', 'f', 'p')
    and has_table_privilege('anon', c.oid, p)
    and not (s.nspname = 'public' and p in ('TRUNCATE', 'REFERENCES', 'TRIGGER'))
  union all
  select s.nspname || '.' || c.relname || '.' || a.attname || ' ' || p
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_temp.project_schemas() s on s.oid = c.relnamespace,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v', 'm', 'f', 'p')
    and has_column_privilege('anon', c.oid, a.attnum, p)
    and exists (select 1 from aclexplode(a.attacl) x where x.grantee in (0, 'anon'::regrole)) -- 0 is PUBLIC: a column grant to PUBLIC reaches anon too
  union all
  select s.nspname || '.' || c.relname || ' ' || p
  from pg_class c join pg_temp.project_schemas() s on s.oid = c.relnamespace, unnest(array['USAGE', 'SELECT', 'UPDATE']) p
  where c.relkind = 'S' and has_sequence_privilege('anon', c.oid, p)
$f$;

-- Non-trigger functions of the project schemas that anon (directly or through PUBLIC) may execute.
create function pg_temp.anon_functions() returns text[] language sql as $f$
  select coalesce(array_agg(s.nspname || '.' || pr.proname || '(' || pg_get_function_identity_arguments(pr.oid) || ')' order by s.nspname, pr.proname), array[]::text[])
  from pg_proc pr join pg_temp.project_schemas() s on s.oid = pr.pronamespace
  where has_function_privilege('anon', pr.oid, 'EXECUTE') and pr.prorettype <> 'trigger'::regtype
$f$;

-- The pinned allowlist (edit with any deliberate change) and the difference to what anon can execute: names added or missing.
create function pg_temp.anon_function_drift() returns text[] language sql as $f$
  with pinned(f) as (values
    ('private.has_active_gym_data_escalation(p_gym_id uuid)'),
    ('public.check_otp_resend_allowed(p_phone text)'),
    ('public.gym_effective_member_cap()'),
    ('public.phone_has_membership(p_phone text)'),
    ('public.phone_has_staff_membership(p_phone text)'),
    ('public.record_otp_resend(p_phone text)')
  ), actual(f) as (select unnest(pg_temp.anon_functions()))
  select coalesce(array_agg(d order by d), array[]::text[]) from (
    select 'unexpected ' || f as d from actual where f not in (select f from pinned)
    union all
    select 'missing ' || f from pinned where f not in (select f from actual)
  ) x
$f$;

-- vault, cron and net (see the header): what anon holds beyond the pins, as readable lines. Empty = nothing unexpected.
create function pg_temp.platform_schema_drift(p_net_relations text[] default array['http_request_queue', '_http_response']) returns text[] language sql as $f$
  select coalesce(array_agg(d order by d), array[]::text[]) from (
    select 'schema usage ' || n.nspname as d from pg_namespace n
     where n.nspname in ('vault', 'cron') and has_schema_privilege('anon', n.oid, 'USAGE')
    union all
    select 'vault relation ' || c.relname || ' ' || p from pg_class c join pg_namespace n on n.oid = c.relnamespace,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where n.nspname = 'vault' and c.relkind in ('r', 'v', 'm', 'f', 'p') and has_table_privilege('anon', c.oid, p)
    union all
    select 'vault function ' || pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'vault' and has_function_privilege('anon', pr.oid, 'EXECUTE')
    union all
    -- net: the pinned pg_net residual; anything else is new
    select 'net relation ' || c.relname || ' ' || p from pg_class c join pg_namespace n on n.oid = c.relnamespace,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where n.nspname = 'net' and c.relkind in ('r', 'v', 'm', 'f', 'p') and has_table_privilege('anon', c.oid, p)
       and c.relname <> all (p_net_relations)
    union all
    select 'net function ' || pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'net' and has_function_privilege('anon', pr.oid, 'EXECUTE')
       and pr.proname not in ('_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up',
                              'http_collect_response', 'http_delete', 'http_get', 'http_post', 'wait_until_running', 'wake', 'worker_restart')
  ) x
$f$;

-- Runs one query as anon and returns its first value as text, or 'ERR:<sqlstate>'.
create function pg_temp.as_anon(q text) returns text language plpgsql as $f$
declare
  v text;
begin
  set local role anon;
  execute q into v;
  reset role;
  return coalesce(v, 'NULL');
exception when others then
  reset role;
  return 'ERR:' || sqlstate;
end
$f$;

-- ---------------------------------------------------------------------------
-- Relations
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_temp.anon_relation_violations()), 0,
  'anon holds no table, view, column or sequence privilege in any project schema (SELECT, INSERT, UPDATE, DELETE, sequences, columns), except the pinned TRUNCATE/REFERENCES/TRIGGER residue on public'
);
select is(
  (select count(*)::int from pg_class c join pg_temp.project_schemas() s on s.oid = c.relnamespace,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where c.relkind in ('r', 'v', 'm', 'f', 'p') and has_table_privilege('anon', c.oid, p)),
  0, 'anon has no SELECT, INSERT, UPDATE or DELETE on any relation of a project schema (the residue below is not data access)'
);
select is(
  (select count(*)::int from pg_class c join pg_temp.project_schemas() s on s.oid = c.relnamespace,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
   where s.nspname in ('public_site', 'private') and c.relkind in ('r', 'v', 'm', 'f', 'p', 'S') and has_table_privilege('anon', c.oid, p)),
  0, 'anon holds nothing at all on any relation of public_site or private'
);
select is(
  (select count(*)::int from pg_roles r, unnest(array['USAGE', 'CREATE']) p
   where r.rolname = 'anon' and (has_schema_privilege(r.rolname, 'public_site', p) or has_schema_privilege(r.rolname, 'private', p))),
  0, 'anon has neither USAGE nor CREATE on schema public_site or private (functions there are unreachable)'
);
select is(
  (select count(*)::int from pg_temp.project_schemas() s, unnest(array['CREATE']) p where has_schema_privilege('anon', s.oid, p)),
  0, 'anon has CREATE on no project schema'
);
select is(
  (select array_agg(nspname::text order by nspname) from pg_temp.project_schemas() s where has_schema_privilege('anon', s.oid, 'USAGE')),
  array['public'], 'anon has USAGE on exactly one project schema, public'
);
select is(
  (select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) x
   where d.defaclnamespace in ('public_site'::regnamespace, 'private'::regnamespace) and (x.grantee = 0 or x.grantee = 'anon'::regrole)),
  0, 'no default privilege in public_site or private hands anything to PUBLIC or anon'
);

-- ---------------------------------------------------------------------------
-- Functions: the pinned allowlist
-- ---------------------------------------------------------------------------
select is(
  pg_temp.anon_function_drift(), array[]::text[],
  'anon may EXECUTE exactly the pinned non-trigger functions: the pre-auth OTP helpers (check_otp_resend_allowed, record_otp_resend, phone_has_membership, phone_has_staff_membership), gym_effective_member_cap, and the inert private.has_active_gym_data_escalation; edit the list in anon_function_drift with any deliberate change (decisions.md 24.12)'
);
select is(
  (select count(*)::int from pg_proc pr join pg_temp.project_schemas() s on s.oid = pr.pronamespace
   where s.nspname = 'public_site' and has_function_privilege('anon', pr.oid, 'EXECUTE')),
  0, 'anon cannot execute the public_site function (submit_page_report is the reader''s alone)'
);
select is(
  has_schema_privilege('anon', 'private', 'USAGE'), false,
  'reachability: the one PUBLIC-executable function in private is inert because anon has no USAGE on schema private'
);
select is(
  pg_temp.as_anon($q$select private.has_active_gym_data_escalation('00000000-0000-0000-0000-000000000000')$q$), 'ERR:42501',
  'reachability: calling private.has_active_gym_data_escalation as anon is refused (permission denied for schema private)'
);
select is(
  pg_temp.platform_schema_drift(), array[]::text[],
  'anon holds nothing in vault, has no USAGE on vault or cron, and nothing in net beyond the pinned pg_net residual (decisions.md 24.4; unreachable through the API: PostgREST exposes only public and graphql_public)'
);
select is(pg_temp.as_anon($q$select cron.schedule('zz-anon', '* * * * *', 'select 1')$q$), 'ERR:42501', 'reachability: anon cannot call cron.schedule (PUBLIC-executable, but no USAGE on schema cron)');
select is(pg_temp.as_anon($q$select public_site.submit_page_report('x', 'privacy', 'x', 'x')$q$), 'ERR:42501', 'anon cannot call the report function');
select is(pg_temp.as_anon($q$select public.check_in(now(), '00000000-0000-0000-0000-000000000000')$q$), 'ERR:42501', 'anon cannot call a tenant RPC (check_in)');
select is(pg_temp.as_anon($q$select count(*) from public.members$q$), 'ERR:42501', 'anon cannot read members');
select is(pg_temp.as_anon($q$select count(*) from public.gym_pages$q$), 'ERR:42501', 'anon cannot read gym_pages');
select is(pg_temp.as_anon($q$select count(*) from public_site.pages$q$), 'ERR:42501', 'anon cannot read the public_site view');

-- ---------------------------------------------------------------------------
-- The suite can fail: known-bad changes inside this transaction must be reported (then removed)
-- ---------------------------------------------------------------------------
grant select on public.members to anon;
select cmp_ok((select count(*)::int from pg_temp.anon_relation_violations()), '>', 0, 'known-bad: a stray SELECT grant on a tenant table to anon is reported');
revoke select on public.members from anon;
grant update (name) on public.members to anon;
select cmp_ok((select count(*)::int from pg_temp.anon_relation_violations()), '>', 0, 'known-bad: a stray column-level UPDATE grant to anon is reported');
revoke update (name) on public.members from anon;
grant update (name) on public.members to public;
select cmp_ok((select count(*)::int from pg_temp.anon_relation_violations()), '>', 0, 'known-bad: a column-level grant TO PUBLIC (which anon inherits) is reported');
revoke update (name) on public.members from public;
grant usage on schema vault to anon;
select is(pg_temp.platform_schema_drift(), array['schema usage vault'], 'known-bad: USAGE on vault granted to anon is reported');
revoke usage on schema vault from anon;
grant usage on schema cron to anon;
select is(pg_temp.platform_schema_drift(), array['schema usage cron'], 'known-bad: USAGE on cron granted to anon is reported');
revoke usage on schema cron from anon;
-- postgres cannot create objects in net (owned by supabase_admin), so the "new table" is simulated: with one pinned table fewer, the other counts as new
select ok(pg_temp.platform_schema_drift(array['http_request_queue']) @> array['net relation _http_response SELECT'], 'known-bad: a table in net that anon can read and that is not pinned is reported');
grant select on public_site.pages to anon;
select cmp_ok((select count(*)::int from pg_temp.anon_relation_violations()), '>', 0, 'known-bad: SELECT on a public_site view granted to anon is reported');
revoke select on public_site.pages from anon;
-- no grant at all: a new function in public is PUBLIC-executable by default, which is exactly what a forgotten revoke looks like
create function public.zz_anon_stray() returns int language sql as 'select 1';
select is(pg_temp.anon_function_drift(), array['unexpected public.zz_anon_stray()'], 'known-bad: a new anon-executable function makes the allowlist assertion fail, naming it');
revoke execute on function public.zz_anon_stray() from public, anon;
grant usage on schema private to anon;
select is(has_schema_privilege('anon', 'private', 'USAGE'), true, 'known-bad: USAGE on private granted to anon makes the reachability assertion false (so it would fail)');
revoke usage on schema private from anon;

select is((select count(*)::int from pg_temp.anon_relation_violations()), 0, 'after removing the stray grants the relation enumeration is clean again');
select is(pg_temp.anon_function_drift(), array[]::text[], 'after revoking the stray function the allowlist matches again');
select is(pg_temp.platform_schema_drift(), array[]::text[], 'after removing the stray vault, cron and net grants the platform schema check is clean again');

select * from finish();
rollback;
