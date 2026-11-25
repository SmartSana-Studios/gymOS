-- Story 30.1: platform_engagement_config and the member_weekly_goals privileges (migration 0184).
--
-- Proves: the seed and every CHECK; the singleton; Super Admin only (select and update), insert and delete refused for everyone; an update by the Super Admin
-- is audited with the WHOLE row, and every column in turn (read from information_schema, so a column added later is covered by a candidate rule here or the
-- test fails) is named in an audit entry with its old and new value; member_weekly_goals grants nothing to anon, authenticated or service_role, has RLS and no
-- policy; the new functions are not callable by anon.
--
-- Fixture ids: 00000000-0000-0000-0030-0000000001xx.

begin;
select plan(50);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0030-000000000101', 'EC Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  ('00000000-0000-0000-0030-000000000111', 'EC Gym A', '00000000-0000-0000-0030-000000000101', 'active', 'Africa/Douala');
insert into auth.users (id) values
  ('00000000-0000-0000-0030-000000000121'), -- owner A
  ('00000000-0000-0000-0030-000000000122'), -- member A
  ('00000000-0000-0000-0030-000000000123'); -- super admin
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0030-000000000131', '00000000-0000-0000-0030-000000000111', '00000000-0000-0000-0030-000000000121', 'owner',  'EC Owner',  current_date),
  ('00000000-0000-0000-0030-000000000132', '00000000-0000-0000-0030-000000000111', '00000000-0000-0000-0030-000000000122', 'member', 'EC Member', current_date);
update users set is_super_admin = true where id = '00000000-0000-0000-0030-000000000123';

create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

-- Runs one statement as `role` and returns its first value, or sqlstate:message.
create function pg_temp.asrole(r text, stmt text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', r);
  begin
    execute stmt into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return coalesce(v, 'null');
end $f$;

-- ============================================================================
-- Seed, singleton, CHECKs
-- ============================================================================
select is((select count(*)::int from platform_engagement_config), 1, 'one config row');
select is(
  (select row(goal_min, goal_max, goal_default, shield_every_weeks, shield_cap, comeback_visits, comeback_window_days, daily_streak_min, release_week_start)::text
   from platform_engagement_config),
  '(1,7,3,4,2,3,10,3,)',
  'seeded 1 / 7 / 3 / 4 / 2 / 3 / 10 / 3 and release_week_start NULL (dark)'
);
select throws_ok($$insert into platform_engagement_config (goal_min, goal_max, goal_default, shield_every_weeks, shield_cap, comeback_visits, comeback_window_days, daily_streak_min)
  values (1, 7, 3, 4, 2, 3, 10, 3)$$, '23505', null, 'a second row is impossible even for the table owner');

select throws_ok($$update platform_engagement_config set goal_min = 0$$, '23514', null, 'goal_min >= 1');
select throws_ok($$update platform_engagement_config set goal_min = 4$$, '23514', null, 'goal_min <= goal_default');
select throws_ok($$update platform_engagement_config set goal_default = 8$$, '23514', null, 'goal_default <= goal_max');
select throws_ok($$update platform_engagement_config set goal_max = 2$$, '23514', null, 'goal_default <= goal_max (max below default)');
select throws_ok($$update platform_engagement_config set goal_max = 8$$, '23514', null, 'goal_max <= 7 (the goal table and the ring stop at 7)');
select throws_ok($$update platform_engagement_config set shield_every_weeks = 0$$, '23514', null, 'shield_every_weeks > 0');
select throws_ok($$update platform_engagement_config set shield_cap = -1$$, '23514', null, 'shield_cap >= 0');
select throws_ok($$update platform_engagement_config set comeback_visits = 0$$, '23514', null, 'comeback_visits > 0');
select throws_ok($$update platform_engagement_config set comeback_window_days = 0$$, '23514', null, 'comeback_window_days > 0');
select throws_ok($$update platform_engagement_config set daily_streak_min = 0$$, '23514', null, 'daily_streak_min > 0');
select throws_ok($$update platform_engagement_config set release_week_start = date '2026-12-08'$$, '23514', null, 'release_week_start must be a Monday (a Tuesday is refused)');
select lives_ok($$update platform_engagement_config set shield_cap = 0$$, 'shield_cap 0 is allowed');
select lives_ok($$update platform_engagement_config set release_week_start = date '2026-12-07'$$, 'a Monday release_week_start is allowed');
select lives_ok($$update platform_engagement_config set shield_cap = 2, release_week_start = null$$, 'and the row is put back');

-- ============================================================================
-- Grants and policies
-- ============================================================================
select is(
  (select array_agg(p order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('authenticated', 'public.platform_engagement_config', p)),
  array['SELECT', 'UPDATE'],
  'authenticated holds select and update only'
);
select is(
  (select array_agg(p order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('service_role', 'public.platform_engagement_config', p)),
  array['SELECT', 'UPDATE'],
  'service_role holds select and update only'
);
select is(
  (select count(*)::int from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('anon', 'public.platform_engagement_config', p)),
  0,
  'anon holds nothing'
);
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'platform_engagement_config'), 2, 'exactly two policies');
select is(
  (select bool_and(qual ~ '\( SELECT private\.is_super_admin\(\)' and (with_check is null or with_check ~ '\( SELECT private\.is_super_admin\(\)'))
   from pg_policies where schemaname = 'public' and tablename = 'platform_engagement_config'),
  true,
  'both policies are Super Admin only, in the wrapped form'
);

-- ============================================================================
-- Who can read and update
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0030-000000000123', null, 'super_admin');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from platform_engagement_config$$), '1', 'the Super Admin reads the row');
select is(pg_temp.asrole('authenticated', $$with u as (update platform_engagement_config set daily_streak_min = 4 returning 1) select count(*)::text from u$$), '1', 'the Super Admin updates it');
select is(pg_temp.asrole('authenticated', $$with d as (delete from platform_engagement_config returning 1) select count(*)::text from d$$), '42501:permission denied for table platform_engagement_config', 'the Super Admin cannot delete');
select is(pg_temp.asrole('authenticated', $$insert into platform_engagement_config (goal_min, goal_max, goal_default, shield_every_weeks, shield_cap, comeback_visits, comeback_window_days, daily_streak_min) values (1, 7, 3, 4, 2, 3, 10, 3)$$), '42501:permission denied for table platform_engagement_config', 'the Super Admin cannot insert');
select is((select daily_streak_min from platform_engagement_config), 4, 'the update held');

select pg_temp.claims('00000000-0000-0000-0030-000000000121', '00000000-0000-0000-0030-000000000111', 'owner');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from platform_engagement_config$$), '0', 'an Owner reads nothing');
select is(pg_temp.asrole('authenticated', $$with u as (update platform_engagement_config set daily_streak_min = 5 returning 1) select count(*)::text from u$$), '0', 'an Owner updates nothing');
select pg_temp.claims('00000000-0000-0000-0030-000000000122', '00000000-0000-0000-0030-000000000111', 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from platform_engagement_config$$), '0', 'a member reads nothing');
select is(pg_temp.asrole('authenticated', $$with u as (update platform_engagement_config set daily_streak_min = 5 returning 1) select count(*)::text from u$$), '0', 'a member updates nothing');
select is(pg_temp.asrole('authenticated', $$with d as (delete from platform_engagement_config returning 1) select count(*)::text from d$$), '42501:permission denied for table platform_engagement_config', 'a member cannot delete');
select is(pg_temp.asrole('anon', $$select count(*)::text from platform_engagement_config$$), '42501:permission denied for table platform_engagement_config', 'anon is refused');
select is(pg_temp.asrole('anon', $$update platform_engagement_config set daily_streak_min = 5$$), '42501:permission denied for table platform_engagement_config', 'anon cannot update');
select is((select daily_streak_min from platform_engagement_config), 4, 'and nothing changed under those callers');

-- ============================================================================
-- Audit: the whole row, and every column in turn
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0030-000000000123', null, 'super_admin');
select pg_temp.asrole('authenticated', $$with u as (update platform_engagement_config set daily_streak_min = 6 returning 1) select count(*)::text from u$$);

select is(
  (select count(*)::int from audit_log
   where action_type = 'platform_engagement_config_updated' and gym_id is null
     and metadata #>> '{old,daily_streak_min}' = '4' and metadata #>> '{new,daily_streak_min}' = '6'
     and actor_id = '00000000-0000-0000-0030-000000000123'),
  1,
  'the Super Admin update wrote one audit entry with gym_id null, the actor and the old and new value'
);
select is(
  (select array_agg(k order by k) from audit_log a, jsonb_object_keys(a.metadata -> 'old') k
   where a.action_type = 'platform_engagement_config_updated' and a.metadata #>> '{new,daily_streak_min}' = '6'),
  (select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'platform_engagement_config'),
  'the old side of the entry holds every column of the table, not a hand-listed set'
);
select is(
  (select array_agg(k order by k) from audit_log a, jsonb_object_keys(a.metadata -> 'new') k
   where a.action_type = 'platform_engagement_config_updated' and a.metadata #>> '{new,daily_streak_min}' = '6'),
  (select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'platform_engagement_config'),
  'and so does the new side'
);

-- One update per column, driven by information_schema. A column of a type this probe has no rule for fails the test on purpose: whoever adds
-- a column adds the rule, so no column goes unaudited.
create temp table audit_probe (col text primary key, old_v text, new_v text, found boolean not null, note text);

create function pg_temp.probe_audit() returns void language plpgsql as $f$
declare
  c record;
  v_old jsonb;
  v_cands text[];
  v_cand text;
  v_new text;
  v_found boolean;
begin
  for c in
    select column_name::text as col, data_type::text as typ from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_engagement_config' order by ordinal_position
  loop
    select to_jsonb(t) into v_old from platform_engagement_config t;
    v_cands := case c.typ
      when 'integer' then array[((v_old ->> c.col)::int + 1)::text, ((v_old ->> c.col)::int - 1)::text]
      when 'smallint' then array[((v_old ->> c.col)::int + 1)::text, ((v_old ->> c.col)::int - 1)::text]
      when 'date' then case when v_old ->> c.col is null then array['2026-12-07'] else array[null::text] end
      when 'uuid' then array[gen_random_uuid()::text]
      else array[]::text[]
    end;
    v_new := 'unset';
    foreach v_cand in array v_cands loop
      begin
        execute format('update platform_engagement_config set %I = %L::%s', c.col, v_cand, c.typ);
        v_new := v_cand;
        exit;
      exception when check_violation then
        continue;
      end;
    end loop;
    if v_new = 'unset' then
      insert into audit_probe values (c.col, v_old ->> c.col, null, false, 'no update rule or every candidate refused for type ' || c.typ);
      continue;
    end if;
    select exists (
      select 1 from audit_log a
      where a.action_type = 'platform_engagement_config_updated'
        and a.metadata #>> array['old', c.col] is not distinct from (v_old ->> c.col)
        and a.metadata #>> array['new', c.col] is not distinct from v_new
        and a.metadata -> 'new' ->> c.col is not distinct from v_new
    ) into v_found;
    insert into audit_probe values (c.col, v_old ->> c.col, v_new, v_found, null);
  end loop;
end $f$;

select pg_temp.probe_audit();

select is(
  (select count(*)::int from audit_probe),
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'platform_engagement_config'),
  'every column was probed'
);
select is(
  (select string_agg(col || coalesce(' (' || note || ')', ''), ', ' order by col) from audit_probe where not found),
  null,
  'every column update is named, with its old and new value, in an audit entry'
);
select is(
  (select count(*)::int from audit_probe where found and old_v is distinct from new_v),
  (select count(*)::int from audit_probe),
  'and each probe changed its column'
);
select is(
  (select count(*)::int from audit_log where action_type = 'platform_engagement_config_updated' and gym_id is not null),
  0,
  'platform audit entries carry no gym'
);

-- ============================================================================
-- member_weekly_goals: privileges, RLS, no policy; the functions are not for anon
-- ============================================================================
select is(
  (select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) g, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(g, 'public.member_weekly_goals', p)),
  0,
  'no client role holds any privilege on member_weekly_goals'
);
select is((select relrowsecurity from pg_class where oid = 'public.member_weekly_goals'::regclass), true, 'member_weekly_goals has row level security');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'member_weekly_goals'), 0, 'and no policy');
select pg_temp.claims('00000000-0000-0000-0030-000000000122', '00000000-0000-0000-0030-000000000111', 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from member_weekly_goals$$), '42501:permission denied for table member_weekly_goals', 'a member cannot select the goals table');
select is(pg_temp.asrole('authenticated', $$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values ('00000000-0000-0000-0030-000000000132', '00000000-0000-0000-0030-000000000111', date '2099-01-05', 4)$$), '42501:permission denied for table member_weekly_goals', 'a member cannot insert');
select is(pg_temp.asrole('service_role', $$select count(*)::text from member_weekly_goals$$), '42501:permission denied for table member_weekly_goals', 'service_role cannot select');
select is(
  (select bool_and(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'))
   from unnest(array['public.set_weekly_goal(smallint)', 'public.my_weekly_goal()', 'private.gym_local_week_bounds(text,timestamptz)', 'private.week_start_of(date)',
                     'private.member_weekly_goals_history_guard()', 'private.audit_platform_engagement_config_update()']) f),
  true,
  'anon and public execute none of the new functions'
);
select is(
  (select bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('service_role', f, 'execute'))
   from unnest(array['private.member_weekly_goals_history_guard()', 'private.audit_platform_engagement_config_update()']) f),
  true,
  'the two trigger functions are executable by no client role'
);

select * from finish();
rollback;
