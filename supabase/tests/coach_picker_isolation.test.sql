-- Story 29.4 (FR-247, NFR-011, NFR-016, FR-251): the pgTAP twin of scripts/check-coach-picker-isolation.mjs. No picker function (found by name pattern and by
-- the list below, which must match scripts/coach-picker-functions.json) reaches a deny-listed relation, a deny-listed column or the progress-photos bucket,
-- walking transitively over pg_depend edges (functions and view rewrite rules) and over every public or private function or relation whose name appears in the
-- text of an object on the walk. pg_depend does not record table references inside a plpgsql body, so the name walk is the part that matters.
-- A NEW BODY-DATA TABLE OR COLUMN MUST BE ADDED to the deny list below (and to the script): the check only knows what it is told.
-- The deny-listed tables are progress_entries (0066), progress_photos (0067), workout_plan_completions (0081). The Coach Overview feed is a PostgREST embed of
-- progress_entries and session_notes, so no database object stands behind it; there is no separate progress-notes table (the FR-098 note is session_notes, a
-- picker output).
-- The twin proves it can fail: it creates a probe picker function that reaches progress_entries through two helper views and requires the walk to find it.

begin;
select plan(12);

create function pg_temp.reached(p_start text) returns table (id text, kind text, schema_name text, name text, txt text)
language sql stable as $f$
  with recursive nodes as (
    select 'f:' || p.oid as id, 'function'::text as kind, n.nspname::text as schema_name, p.proname::text as name,
           regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') as txt
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    union all
    select 'r:' || c.oid, 'relation', n.nspname::text, c.relname::text,
           case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
  ),
  dep as (
    select distinct
           case when d.classid = 'pg_proc'::regclass then 'f:' || d.objid
                when d.classid = 'pg_rewrite'::regclass then 'r:' || rw.ev_class end as src,
           case when d.refclassid = 'pg_proc'::regclass then 'f:' || d.refobjid
                when d.refclassid = 'pg_class'::regclass then 'r:' || d.refobjid end as dst
      from pg_depend d left join pg_rewrite rw on d.classid = 'pg_rewrite'::regclass and rw.oid = d.objid
     where d.deptype = 'n'
  ),
  walk(id) as (
    select nodes.id from nodes where nodes.id = p_start
    union
    select n.id
      from walk w
      join nodes cur on cur.id = w.id
      join nodes n on n.id <> cur.id
       and (
         exists (select 1 from dep where dep.src = cur.id and dep.dst = n.id)
         or (n.kind = 'function' and cur.txt ~* ('(^|[^a-z0-9_$])' || n.name || '[[:space:]]*\('))
         or (n.kind = 'relation' and cur.txt ~* ('(^|[^a-z0-9_$])' || n.name || '([^a-z0-9_$]|$)'))
       )
  )
  select nodes.id, nodes.kind, nodes.schema_name, nodes.name, nodes.txt from nodes join walk on walk.id = nodes.id
$f$;

create temp table pickers (fn_id text primary key, name text);
insert into pickers
select 'f:' || p.oid, p.proname::text from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.proname ~ '^(list_coach_|get_coach_|list_picker_)'
        or p.proname in ('list_picker_coaches', 'list_coach_classes', 'list_coach_class_session_roster', 'list_coach_assigned_members',
                         'get_coach_assigned_member', 'list_coach_member_session_notes', 'get_coach_member_workout_plan'));

create temp table deny_relations (name text primary key);
insert into deny_relations values ('progress_entries'), ('progress_photos'), ('workout_plan_completions');
create temp table deny_columns (name text primary key);
insert into deny_columns values ('starting_weight_kg'), ('height_cm'), ('birth_year'), ('dob'), ('emergency_contact'), ('email'), ('neighborhood'), ('profession');

create function pg_temp.offenders(p_ids text[]) returns text language sql stable as $f$
  select coalesce(string_agg(distinct pk.name || ' -> ' || r.name, ', '), '')
    from pickers pk
    cross join lateral pg_temp.reached(pk.fn_id) r
   where pk.fn_id = any (p_ids)
     and (
       (r.kind = 'relation' and r.name in (select name from deny_relations))
       or exists (select 1 from deny_columns c where r.txt ~* ('(^|[^a-z0-9_$])' || c.name || '([^a-z0-9_$]|$)'))
       or r.txt ~* 'progress-photos'
     )
$f$;

select is((select count(*)::int from pickers), 7, 'the seven picker functions are found by name pattern and by list');
select is((select array_agg(name order by name) from pickers),
  array['get_coach_assigned_member', 'get_coach_member_workout_plan', 'list_coach_assigned_members', 'list_coach_class_session_roster', 'list_coach_classes', 'list_coach_member_session_notes', 'list_picker_coaches'],
  'exactly the names in scripts/coach-picker-functions.json (a new picker function must be added there and here)');

select cmp_ok((select count(*)::int from pg_temp.reached((select fn_id from pickers where name = 'list_coach_assigned_members'))), '>', 3,
  'the walk is not empty: list_coach_assigned_members reaches its helper functions, its view and tables (subscriptions_current, private.gym_id, members ...)');
select ok(exists (select 1 from pg_temp.reached((select fn_id from pickers where name = 'list_coach_assigned_members')) where name = 'subscriptions_current'),
  'the walk reaches subscriptions_current from list_coach_assigned_members (a body-text reference, which pg_depend does not record)');
select ok(exists (select 1 from pg_temp.reached((select fn_id from pickers where name = 'list_coach_classes')) where name = 'class_sessions_with_match'),
  'the walk reaches the class_sessions_with_match view from list_coach_classes');

select is(pg_temp.offenders((select array_agg(fn_id) from pickers)), '',
  'no picker function reaches progress_entries, progress_photos, workout_plan_completions, a body or contact column or the progress-photos bucket');

select is((select count(*)::int from private.support_capabilities c join pickers p on p.name = c.object_name), 0,
  'no picker function is a support capability (FR-251)');
select is((select count(*)::int from pickers p join pg_proc f on 'f:' || f.oid = p.fn_id where f.prosrc ~* 'support_rpc_(gym_id|role)|support_gym_id'), 0,
  'no picker function resolves the live support gym');

-- The twin can fail: a probe picker function that reaches progress_entries only through two helper views.
create view public.zz_probe_inner as select e.id from public.progress_entries e;
create view public.zz_probe_outer as select i.id from public.zz_probe_inner i;
create function public.list_coach_zz_probe(p_coach_id uuid)
returns table (probe_id uuid) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select o.id from zz_probe_outer o;
end;
$$;
insert into pickers select 'f:' || p.oid, p.proname::text from pg_proc p where p.proname = 'list_coach_zz_probe';

select is(pg_temp.offenders(array(select fn_id from pickers where name = 'list_coach_zz_probe')), 'list_coach_zz_probe -> progress_entries',
  'a probe picker function reaching progress_entries through two helper views is caught');
select is(pg_temp.offenders((select array_agg(fn_id) from pickers where name <> 'list_coach_zz_probe')), '', 'and the real functions are still clean beside it');

create function public.list_coach_zz_probe_two(p_coach_id uuid)
returns table (probe_id uuid) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select m.starting_weight_kg::text::uuid from members m;
end;
$$;
insert into pickers select 'f:' || p.oid, p.proname::text from pg_proc p where p.proname = 'list_coach_zz_probe_two';
select is(pg_temp.offenders(array(select fn_id from pickers where name = 'list_coach_zz_probe_two')), 'list_coach_zz_probe_two -> list_coach_zz_probe_two',
  'a probe picker function naming a body column is caught');

create function public.list_coach_zz_probe_three(p_coach_id uuid)
returns table (probe_id uuid) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select x.probe_id from public.list_coach_zz_probe(p_coach_id) x;
end;
$$;
insert into pickers select 'f:' || p.oid, p.proname::text from pg_proc p where p.proname = 'list_coach_zz_probe_three';
select is(pg_temp.offenders(array(select fn_id from pickers where name = 'list_coach_zz_probe_three')), 'list_coach_zz_probe_three -> progress_entries',
  'a probe picker function that reaches progress_entries only through another picker function is caught');

select * from finish();
rollback;
