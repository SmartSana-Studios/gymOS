-- Story 30.6 (FR-228, NFR-027): rank earns nothing, and no role can edit a count or a rank (migration 0188).
--
-- Enumerates the functions and tables of the loyalty, session, stamp, Shield and payment families by name (public and private schemas) and fails
-- when any function body reads the leaderboard (gym_leaderboard, the preference columns, the settings read or the two writers), so a prize,
-- discount, session, Shield or stamp can never be keyed to a rank. Also: no table or view stores a rank, nothing but the five known functions
-- mentions the leaderboard at all, and no role holds a privilege that could write a count or read an engagement table directly.
--
-- Each family scan is shown live (it finds functions) except Shield, whose functions arrive with Epic 31: the pattern is in place and the
-- "no reader" assertion covers it the day the first one exists.

begin;
select plan(27);

create temp table fam (family text, pattern text);
insert into fam values ('loyalty', 'loyalty'), ('session', 'session'), ('stamp', 'stamp'), ('shield', 'shield'), ('payment', 'payment');

create temp table fam_fn as
  select f.family, n.nspname::text as schema_name, p.proname::text as proname, p.prosrc
  from fam f
  join pg_proc p on p.proname ~* f.pattern
  join pg_namespace n on n.oid = p.pronamespace and n.nspname in ('public', 'private')
  where p.prokind in ('f', 'p');
create temp table fam_tbl as
  select f.family, c.relname::text as relname, c.oid
  from fam f
  join pg_class c on c.relname ~* f.pattern and c.relkind in ('r', 'p', 'v', 'm')
  join pg_namespace n on n.oid = c.relnamespace and n.nspname in ('public', 'private');

select cmp_ok((select count(*)::int from fam_fn where family = 'loyalty'), '>', 0, 'the loyalty scan is live (finds functions)');
select cmp_ok((select count(*)::int from fam_fn where family = 'session'), '>', 0, 'the session scan is live');
select cmp_ok((select count(*)::int from fam_fn where family = 'stamp'), '>', 0, 'the stamp scan is live');
select cmp_ok((select count(*)::int from fam_fn where family = 'payment'), '>', 0, 'the payment scan is live');
select cmp_ok((select count(*)::int from fam_tbl where family in ('loyalty', 'session', 'payment')), '>', 0, 'the table scan is live');

select is((select coalesce(string_agg(family || ':' || schema_name || '.' || proname, ', ' order by family, proname), '') from fam_fn
            where prosrc ~* '(gym_leaderboard|my_leaderboard_settings|leaderboard_hidden|leaderboard_notice_seen|set_leaderboard_visibility|mark_leaderboard_notice_seen)'), '',
  'no loyalty, session, stamp, Shield or payment function reads the leaderboard, a rank or the leaderboard preferences');
select is((select count(*)::int from fam_fn where family = 'loyalty' and prosrc ~* 'leaderboard'), 0, 'loyalty: no body says leaderboard');
select is((select count(*)::int from fam_fn where family = 'session' and prosrc ~* 'leaderboard'), 0, 'session: no body says leaderboard');
select is((select count(*)::int from fam_fn where family = 'stamp' and prosrc ~* 'leaderboard'), 0, 'stamp: no body says leaderboard');
select is((select count(*)::int from fam_fn where family = 'shield' and prosrc ~* 'leaderboard'), 0, 'Shield: no body says leaderboard');
select is((select count(*)::int from fam_fn where family = 'payment' and prosrc ~* 'leaderboard'), 0, 'payment: no body says leaderboard');

-- Nothing but the known functions mentions the leaderboard at all
select is((select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.prokind in ('f', 'p') and p.prosrc ~* 'leaderboard'),
  array['private.protect_self_managed_member_preferences_columns', 'public.gym_leaderboard', 'public.mark_leaderboard_notice_seen', 'public.my_leaderboard_settings', 'public.set_leaderboard_visibility'],
  'exactly the trigger and the four leaderboard functions mention the leaderboard (a new reader must be added here deliberately)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* 'gym_leaderboard'), 0, 'no function body calls gym_leaderboard (it is called by apps only)');
select is((select count(*)::int from pg_views where schemaname in ('public', 'private') and definition ~* 'leaderboard'), 0, 'no view reads the leaderboard');
select is((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~* 'leaderboard'), 0, 'no row-level policy reads the leaderboard');
select is((select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.prosrc ~* 'gym_leaderboard'), 0, 'no trigger reads the board');

-- No table stores a rank
select is((select coalesce(string_agg(c.table_schema || '.' || c.table_name || '.' || c.column_name, ', '), '') from information_schema.columns c
            where c.table_schema in ('public', 'private') and c.column_name ~* '(^|_)(rank|ranking|ranked|place|standing)(_|$)'), '', 'no table or view has a rank, ranking, place or standing column');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm') and c.relname ~* '(leaderboard|ranking)'), 0, 'no table or view is named for a leaderboard or a ranking');
select is((select coalesce(string_agg(t.family || ':' || t.relname, ', '), '') from fam_tbl t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped where a.attname ~* 'rank'), '', 'no loyalty, session, stamp, Shield or payment table has a rank column');

-- No role can edit a count or a rank, or read an engagement table directly
create temp table roles_t (r text);
insert into roles_t values ('anon'), ('authenticated'), ('service_role');
select is((select count(*)::int from roles_t, unnest(array['public.engagement_facts', 'public.engagement_state', 'public.member_weekly_goals']) t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
            where has_table_privilege(r, t, pr)), 0, 'anon, authenticated and service_role hold no privilege at all on engagement_facts, engagement_state and member_weekly_goals');
select cmp_ok((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ 'engagement' and c.relname <> 'platform_engagement_config'), '>=', 2, 'the engagement table scan is live');
select is((select coalesce(string_agg(r || ':' || c.relname || ':' || pr, ', '), '') from roles_t, pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
            where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ 'engagement' and c.relname <> 'platform_engagement_config' and has_table_privilege(r, c.oid, pr)), '',
  'and the same holds for every other engagement table (platform_engagement_config is the Super Admin-only configuration, not a count)');
select is((select count(*)::int from roles_t, unnest(array['public.attendance_events', 'public.attendance_counted', 'public.member_visit_days']) t, unnest(array['INSERT', 'UPDATE', 'DELETE']) pr
            where has_table_privilege(r, t, pr)), 0, 'no role can insert, update or delete attendance_events or the two count views (a visit count is edited by no one directly)');
select is((select count(*)::int from roles_t where has_table_privilege(r, 'public.attendance_counted', 'SELECT') and r <> 'authenticated'), 0, 'anon and service_role cannot read attendance_counted');
select is((select count(*)::int from information_schema.table_privileges where table_schema = 'public' and table_name in ('member_preferences') and grantee in ('anon') and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')), 0, 'anon holds no read or write privilege on member_preferences (where the leaderboard choice lives)');

-- Rank carries nothing: the leaderboard functions write nothing but the member's own two preference columns
select is((select count(*)::int from pg_proc p where p.oid in ('public.gym_leaderboard(date)'::regprocedure, 'public.my_leaderboard_settings()'::regprocedure) and p.prosrc ~* '(loyalty|stamp|shield|payment|session_|insert|update|delete)'), 0, 'the two reads touch no loyalty, stamp, Shield, payment or session object and write nothing');
select is((select count(*)::int from pg_proc p where p.oid in ('public.set_leaderboard_visibility(boolean)'::regprocedure, 'public.mark_leaderboard_notice_seen()'::regprocedure) and p.prosrc ~* '(loyalty|stamp|shield|payment|session_|engagement_facts|attendance)'), 0, 'the two writers touch only member_preferences');

select * from finish();
rollback;
