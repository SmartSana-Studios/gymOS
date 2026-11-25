-- Story 31.2: the streak reminder N-08 (migration 0191). The I/O matrix of the story in the order of its acceptance criteria: the schema (two tables in the
-- class-reminder shape, the CHECK, the preference column, the window configuration and its one reader), the job (schedule, window, epoch, gym status,
-- eligibility row by row, once per gym-local day, a second tick, a failing member, a failing run, the preference toggle), the sender (claim, re-check,
-- history row, push payload, languages, tokens), the delivery processor branch, the wording, the privilege matrix and the gates that reach their
-- consumers (who writes the tables, who calls the sender, the check-in paths unchanged, shown failing against a mutant).
--
-- TIME. The job and the state view read the real clock (the sender takes one parameter, so there is no `now` to pass), and one pgTAP file is one
-- transaction, so now() is fixed for the whole file. Every date and hour here is therefore relative to it: the window configuration is set around the
-- hour it is in gym A (or gym X) right now, and the goal default is set to the days left in the gym's week, which is exactly the number of visits a
-- member with no visit this week still needs (the at-risk rule: visits needed = days left). Visits that must not be today go on `other_day`, any other
-- day of the same week (attendance counts them whether they are past or later in the week).
--
-- Fixture ids: 00000000-0000-0000-0045-00000000nnnn. Gym 1 (A, Africa/Douala, active), 2 (S, suspended), 3 (X, Pacific/Kiritimati, UTC+14, active).

begin;
select plan(191);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0045-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.u(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(2, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'ER Tier', 6000, 60000, null);
-- A suspended gym is seeded suspended in its INSERT (a bare UPDATE of gyms.status is silently reverted).
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'ER Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'ER Gym S', pg_temp.id(0, 1), 'suspended', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'ER Gym X', pg_temp.id(0, 1), 'active', 'Pacific/Kiritimati');
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  (pg_temp.id(4, 1), pg_temp.id(1, 1), 'ER Monthly', 'monthly', 15000, 'XAF', 'monthly', 30),
  (pg_temp.id(4, 2), pg_temp.id(1, 1), 'ER PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null),
  (pg_temp.id(4, 3), pg_temp.id(1, 2), 'ER Monthly S', 'monthly', 15000, 'XAF', 'monthly', 30),
  (pg_temp.id(4, 4), pg_temp.id(1, 3), 'ER Monthly X', 'monthly', 15000, 'XAF', 'monthly', 30);

-- Members of gym A unless noted:
--  1 at risk, English, one token        2 at risk, French, one token        3 at risk, no token          4 at risk, two tokens
--  5 opted out                          6 expired subscription              7 deactivated                8 coach
--  9 visited today                     10 one visit on another day (the goal is still reachable without today)
-- 11 Pay-per-session, at risk          12 holds a Shield, at risk          13 only visit today voided, at risk
-- 14 gym S (suspended), at risk        15 gym X, at risk                   17 owner                     18 no subscription
-- 19 sender refuses (trigger)          20, 21 at risk (batch beside 19)    24 N-06 and N-07 already sent today
-- Created later, when their case comes: 22 (claimed, then visits), 23 (opts out and back in through the app), 25 (whole-run failure), 26 (a second member of gym X)
insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'er-' || n || '@x.example', now() from generate_series(1, 30) n;
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n), pg_temp.id(1, case when n = 14 then 2 when n in (15, 26) then 3 else 1 end), pg_temp.u(n),
       (case n when 8 then 'coach' when 17 then 'owner' else 'member' end)::member_role,
       'ER Member ' || n, date '2026-01-05', case when n = 7 then now() end
from generate_series(1, 24) n where n <> 16 and n not in (22, 23);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id,
       case when m.gym_id = pg_temp.id(1, 2) then pg_temp.id(4, 3) when m.gym_id = pg_temp.id(1, 3) then pg_temp.id(4, 4)
            when m.id = pg_temp.m(11) then pg_temp.id(4, 2) else pg_temp.id(4, 1) end,
       (case when m.id = pg_temp.m(6) then 'expired' else 'active' end)::subscription_status,
       date '2026-01-05', case when m.id = pg_temp.m(11) then null else date '2030-01-01' end
from members m where m.id between pg_temp.m(1) and pg_temp.m(26) and m.id <> pg_temp.m(18);
update users set preferred_language = 'fr' where id = pg_temp.u(2);
update member_preferences set streak_reminder_opted_out = true where member_id = pg_temp.m(5);
insert into device_push_tokens (user_id, expo_push_token, platform) values
  (pg_temp.u(1), 'ExponentPushToken[ER-1]', 'android'),
  (pg_temp.u(2), 'ExponentPushToken[ER-2-FR]', 'ios'),
  (pg_temp.u(4), 'ExponentPushToken[ER-4-A]', 'android'),
  (pg_temp.u(4), 'ExponentPushToken[ER-4-B]', 'ios'),
  (pg_temp.u(11), 'ExponentPushToken[ER-11]', 'android'),
  (pg_temp.u(12), 'ExponentPushToken[ER-12]', 'android'),
  (pg_temp.u(13), 'ExponentPushToken[ER-13]', 'android'),
  (pg_temp.u(15), 'ExponentPushToken[ER-15]', 'android'),
  (pg_temp.u(19), 'ExponentPushToken[ER-19]', 'android'),
  (pg_temp.u(20), 'ExponentPushToken[ER-20]', 'android'),
  (pg_temp.u(21), 'ExponentPushToken[ER-21]', 'android'),
  (pg_temp.u(22), 'ExponentPushToken[ER-22]', 'android'),
  (pg_temp.u(23), 'ExponentPushToken[ER-23]', 'android'),
  (pg_temp.u(24), 'ExponentPushToken[ER-24]', 'android'),
  (pg_temp.u(25), 'ExponentPushToken[ER-25]', 'android'),
  (pg_temp.u(26), 'ExponentPushToken[ER-26]', 'android');

insert into public.notifications (member_id, gym_id, type, title, body) values
  (pg_temp.m(24), pg_temp.id(1, 1), 'N-06', 'Quiet gym', 'Your gym is quiet right now.'),
  (pg_temp.m(24), pg_temp.id(1, 1), 'N-07', 'Class reminder', 'Your class starts in 60 minutes.');

create function pg_temp.hr(p_tz text) returns int language sql stable as $f$ select extract(hour from now() at time zone p_tz)::int $f$;
create function pg_temp.a_today() returns date language sql stable as $f$ select private.gym_today(pg_temp.id(1, 1)) $f$;
create function pg_temp.x_today() returns date language sql stable as $f$ select private.gym_today(pg_temp.id(1, 3)) $f$;
create function pg_temp.days_left(p_today date) returns int language sql immutable as $f$ select private.week_start_of(p_today) + 6 - p_today + 1 $f$;
create function pg_temp.other_day() returns date language sql stable as $f$
  select private.week_start_of(pg_temp.a_today()) + ((pg_temp.a_today() - private.week_start_of(pg_temp.a_today()) + 1) % 7) $f$;
-- The window [p_start, p_end) of gym-local hours, and the three windows the cases need around the hour gym A is in right now.
create function pg_temp.win(p_start int, p_end int) returns void language sql as $f$
  update platform_engagement_config set reminder_window_start_hour = p_start, reminder_window_end_hour = p_end $f$;
create function pg_temp.win_open_a() returns void language sql as $f$ select pg_temp.win(pg_temp.hr('Africa/Douala'), pg_temp.hr('Africa/Douala') + 1) $f$;
create function pg_temp.win_open_x() returns void language sql as $f$ select pg_temp.win(pg_temp.hr('Pacific/Kiritimati'), pg_temp.hr('Pacific/Kiritimati') + 1) $f$;
create function pg_temp.win_elsewhere() returns void language sql as $f$ select pg_temp.win((pg_temp.hr('Africa/Douala') + 2) % 24, (pg_temp.hr('Africa/Douala') + 2) % 24 + 1) $f$;
-- The window whose END is the current hour (exclusive): [h - 1, h), or [23, 24) at midnight.
create function pg_temp.win_ends_now_a() returns void language sql as $f$
  select pg_temp.win(case when pg_temp.hr('Africa/Douala') = 0 then 23 else pg_temp.hr('Africa/Douala') - 1 end,
                     case when pg_temp.hr('Africa/Douala') = 0 then 24 else pg_temp.hr('Africa/Douala') end) $f$;
create function pg_temp.visit(p_n int, p_day date) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + time '10:00') at time zone 'Africa/Douala', (p_day + time '11:00') at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;
create function pg_temp.disp(p_n int) returns int language sql stable as $f$ select count(*)::int from private.engagement_reminder_dispatches where member_id = pg_temp.m(p_n) $f$;
create function pg_temp.hist(p_n int) returns int language sql stable as $f$ select count(*)::int from public.notifications where member_id = pg_temp.m(p_n) and type = 'N-08' $f$;
create function pg_temp.dels(p_n int) returns int language sql stable as $f$
  select count(*)::int from private.engagement_reminder_deliveries d join private.engagement_reminder_dispatches x on x.id = d.dispatch_id where x.member_id = pg_temp.m(p_n) $f$;
-- The real cron job runs every 15 minutes on this database and records its own committed rows; the rows of THIS transaction are the ones stamped with its start
-- time (the job stamps now()), so every count of runs here is of those.
create function pg_temp.runs(p_status text) returns int language sql stable as $f$ select count(*)::int from job_runs where job_name = 'engagement_reminder' and status::text = p_status and started_at = now() $f$;
create function pg_temp.sent(p_lo int, p_hi int) returns text language sql stable as $f$
  select coalesce(string_agg(((right(member_id::text, 4))::int - 3000)::text, ',' order by member_id), '-')
  from private.engagement_reminder_dispatches where member_id between pg_temp.m(p_lo) and pg_temp.m(p_hi) $f$;
create function pg_temp.risk(p_n int) returns text language sql stable as $f$
  select coalesce((select v.at_risk_weekly::text || '|' || v.visits_needed from private.engagement_state_view(pg_temp.m(p_n)) v), 'null') $f$;
create function pg_temp.payload(p_n int) returns jsonb language sql stable as $f$
  select convert_from(q.body, 'UTF8')::jsonb
  from net.http_request_queue q
  join private.engagement_reminder_deliveries d on d.push_request_id = q.id
  join private.engagement_reminder_dispatches x on x.id = d.dispatch_id
  where x.member_id = pg_temp.m(p_n) order by d.expo_push_token limit 1 $f$;

-- ============================================================================
-- Schema: the two tables (the class-reminder shape), the CHECK, the preference column, the configuration, the reader
-- ============================================================================
select is((select count(*)::int from information_schema.tables where table_schema = 'private' and table_name in ('engagement_reminder_dispatches', 'engagement_reminder_deliveries')), 2, 'both reminder tables exist in the private schema');
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by column_name)
   from information_schema.columns where table_schema = 'private' and table_name = 'engagement_reminder_deliveries'),
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by column_name)
   from information_schema.columns where table_schema = 'private' and table_name = 'class_reminder_deliveries'),
  'the delivery table has the column shape of the class-reminder delivery table, name for name, type, nullability and default');
select is(
  (select string_agg(replace(replace(regexp_replace(indexdef, 'INDEX \S+ ON ', 'INDEX ON '), 'engagement_reminder', 'X'), 'class_reminder', 'X'), ' | ' order by replace(replace(indexname, 'engagement_reminder', 'X'), 'class_reminder', 'X'))
   from pg_indexes where schemaname = 'private' and tablename = 'engagement_reminder_deliveries' and indexname not like '%pkey' and indexname not like '%key'),
  (select string_agg(replace(replace(regexp_replace(indexdef, 'INDEX \S+ ON ', 'INDEX ON '), 'engagement_reminder', 'X'), 'class_reminder', 'X'), ' | ' order by replace(replace(indexname, 'engagement_reminder', 'X'), 'class_reminder', 'X'))
   from pg_indexes where schemaname = 'private' and tablename = 'class_reminder_deliveries' and indexname not like '%pkey' and indexname not like '%key'),
  'and the same three indexes (due status, the two unique request-id indexes), definitions equal after the table name');
select is(
  (select string_agg(pg_get_constraintdef(oid), ' | ' order by pg_get_constraintdef(oid)) from pg_constraint
   where conrelid = 'private.engagement_reminder_dispatches'::regclass and contype in ('c', 'u')),
  $$CHECK ((status = ANY (ARRAY['pending'::text, 'queued'::text, 'no_tokens'::text]))) | UNIQUE (member_id, gym_local_date)$$,
  'the dispatch claim is unique on (member_id, gym_local_date) and its status is pending, queued or no_tokens');
select is((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) from information_schema.columns
           where table_schema = 'private' and table_name = 'engagement_reminder_dispatches'),
  'id:uuid:NO,member_id:uuid:NO,gym_id:uuid:NO,gym_local_date:date:NO,sent_at:timestamp with time zone:NO,status:text:NO,updated_at:timestamp with time zone:NO',
  'the dispatch columns are exactly the spec''s');
select is((select count(*)::int from pg_constraint where conrelid = 'private.engagement_reminder_dispatches'::regclass and contype = 'f' and confdeltype = 'c'), 1, 'a dispatch goes with its member (on delete cascade)');
select is((select count(*)::int from pg_constraint where conrelid = 'private.engagement_reminder_deliveries'::regclass and contype = 'f' and confdeltype = 'c'), 1, 'a delivery goes with its dispatch (on delete cascade)');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname like 'engagement_reminder_%' and c.relkind = 'r' and c.relrowsecurity), 2, 'row level security is on for both tables');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'public']) r, unnest(array['private.engagement_reminder_dispatches', 'private.engagement_reminder_deliveries']) t,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege(r, t, p)),
  0, 'no client role holds any privilege on either table');
select is(
  (select count(*)::int from unnest(array['private.engagement_reminder_dispatches', 'private.engagement_reminder_deliveries']) t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege('service_role', t, p)),
  8, 'service_role holds all four privileges on both (the 0059 posture)');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check'
                  and pg_get_constraintdef(oid) like '%N-01%N-02%N-03%N-04%N-05%N-06%N-07%N-08%'), 'notifications.type allows N-01 to N-08');
select throws_ok($$insert into public.notifications (member_id, gym_id, type, title, body) values ('00000000-0000-0000-0045-000000003001', '00000000-0000-0000-0045-000000001001', 'N-09', 't', 'b')$$,
  '23514', null, 'and still refuses N-09');
select is((select column_default || ':' || is_nullable || ':' || data_type from information_schema.columns where table_schema = 'public' and table_name = 'member_preferences' and column_name = 'streak_reminder_opted_out'),
  'false:NO:boolean', 'member_preferences.streak_reminder_opted_out is boolean not null default false');
select is((select count(*)::int from member_preferences where streak_reminder_opted_out and member_id <> pg_temp.m(5)), 0, 'every row but the one opted out here reads false (on by default)');
select is((select count(*)::int from member_preferences where member_id between pg_temp.m(1) and pg_temp.m(26)), 21, 'every fixture member got a preferences row from the existing trigger');
select is(
  (select string_agg(column_name || ':' || data_type || ':' || column_default, ',' order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'platform_engagement_config' and column_name like 'reminder_window%'),
  'reminder_window_end_hour:smallint:21,reminder_window_start_hour:smallint:18', 'the window is config: smallint columns defaulting to 18 and 21');
select throws_ok($$update platform_engagement_config set reminder_window_start_hour = 21$$, '23514', null, 'the window needs start < end (equal refused)');
select throws_ok($$update platform_engagement_config set reminder_window_start_hour = 22$$, '23514', null, 'the window needs start < end (start after end refused)');
select throws_ok($$update platform_engagement_config set reminder_window_end_hour = 25$$, '23514', null, 'the window ends at 24 at the latest');
select throws_ok($$update platform_engagement_config set reminder_window_start_hour = -1$$, '23514', null, 'the window starts at 0 at the earliest');
select lives_ok($$update platform_engagement_config set reminder_window_start_hour = 0, reminder_window_end_hour = 24$$, 'the whole day is a valid window');
select pg_temp.win(18, 21);
select is((select count(*)::int from audit_log a where a.action_type = 'platform_engagement_config_updated' and a.metadata #>> '{new,reminder_window_end_hour}' = '24'), 1, 'a window change is audited with the whole row (the existing trigger covers the new columns)');

-- my_streak_reminder_hour: the start hour, for any signed-in caller, nobody else.
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.u(p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
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
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select public.my_streak_reminder_hour()::text$$), '18', 'my_streak_reminder_hour returns the configured start hour to a member');
select pg_temp.claims(17, 1, 'owner');
select is(pg_temp.asrole('authenticated', $$select public.my_streak_reminder_hour()::text$$), '18', 'and to an owner (any signed-in caller)');
select is(left(pg_temp.asrole('anon', $$select public.my_streak_reminder_hour()::text$$), 6), '42501:', 'anon is refused');
select is(left(pg_temp.asrole('service_role', $$select public.my_streak_reminder_hour()::text$$), 6), '42501:', 'and service_role');
select ok((select p.provolatile = 's' and p.prosecdef and not p.proretset from pg_proc p where p.oid = 'public.my_streak_reminder_hour()'::regprocedure), 'it is stable, security definer and returns one value');
select pg_temp.win(20, 22);
select is(pg_temp.asrole('authenticated', $$select public.my_streak_reminder_hour()::text$$), '20', 'it follows the configuration the job uses, not a constant');
select pg_temp.win(18, 21);

-- ============================================================================
-- Wording (the pure text function): the four strings, exactly the catalog's (the Vitest drift test pins them against the locale files)
-- ============================================================================
select is((select title || '|' || body from private.engagement_reminder_text('en', 1)), 'Your week is in reach|Come in today: 1 visit left to close your ring.', 'EN, one visit left');
select is((select title || '|' || body from private.engagement_reminder_text('en', 2)), 'Your week is in reach|Come in today: 2 visits left to close your ring.', 'EN, two visits left');
select is((select title || '|' || body from private.engagement_reminder_text('fr', 1)), $$Votre semaine est à portée|Venez aujourd'hui : encore 1 visite pour fermer votre cercle.$$, 'FR, one visit left');
select is((select title || '|' || body from private.engagement_reminder_text('fr', 7)), $$Votre semaine est à portée|Venez aujourd'hui : encore 7 visites pour fermer votre cercle.$$, 'FR, seven visits left');
select is((select body from private.engagement_reminder_text('de', 3)), 'Come in today: 3 visits left to close your ring.', 'any other language reads English (fr, else en)');
select is((select count(*)::int from private.engagement_reminder_text('en', 2) t where t.title ~* '\m(danger|streak|lose|lost|fail|failed|miss|missed|forget)\M' or t.body ~* '\m(danger|streak|lose|lost|fail|failed|miss|missed|forget)\M'), 0, 'no failure, guilt or "streak in danger" wording');

-- ============================================================================
-- The schedule and the shape of the job and the sender
-- ============================================================================
select is((select count(*)::int from cron.job where jobname = 'engagement_reminder'), 1, 'exactly one engagement_reminder cron job');
select is((select schedule from cron.job where jobname = 'engagement_reminder'), '*/15 * * * *', 'it runs every 15 minutes');
select is((select btrim(command) from cron.job where jobname = 'engagement_reminder'), 'select private.run_engagement_reminder_job();', 'and calls the private job function');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~* 'engagement_reminder|streak_reminder' and p.proname <> 'my_streak_reminder_hour'), 0, 'no other public function carries the reminder (the job lives in private)');
select is(
  (select count(*)::int from unnest(array['private.run_engagement_reminder_job()', 'private.send_engagement_reminder(uuid)', 'private.engagement_reminder_text(text, integer)']) f,
     unnest(array['anon', 'authenticated', 'service_role', 'public']) r where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'the job, the sender and the text function are executable by anon, authenticated, service_role and PUBLIC: none');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'public']) r where has_function_privilege(r, 'public.my_streak_reminder_hour()', 'execute')),
  1, 'my_streak_reminder_hour is executable by exactly one of those roles (authenticated)');
select ok(has_function_privilege('authenticated', 'public.my_streak_reminder_hour()', 'execute'), 'and that role is authenticated');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.prosrc ~* 'engagement_reminder|streak_reminder' and p.proname <> 'process_notification_deliveries'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  0, 'no function that names the reminder is executable by anon or PUBLIC');
select is((select count(*)::int from pg_proc p where p.oid = 'private.process_notification_deliveries()'::regprocedure
           and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  0, 'the delivery processor is still not executable by a client role');
select ok(has_function_privilege('service_role', 'private.process_notification_deliveries()', 'execute'), 'and service_role keeps it, as before');
select ok((select p.prosecdef from pg_proc p where p.oid = 'private.send_engagement_reminder(uuid)'::regprocedure), 'the sender is security definer');
select ok((select position('engagement_state_view' in p.prosrc) < position('insert into private.engagement_reminder_dispatches' in p.prosrc)
                  and position('insert into private.engagement_reminder_dispatches' in p.prosrc) < position('send_engagement_reminder(' in p.prosrc)
           from pg_proc p where p.oid = 'private.run_engagement_reminder_job()'::regprocedure),
  'the job reads the state view, then claims, then sends (the re-read sits right before the claim, inside the member''s own block)');
select ok((select p.prosrc ~* 'on conflict \(member_id, gym_local_date\) do nothing\s+returning id' from pg_proc p where p.oid = 'private.run_engagement_reminder_job()'::regprocedure),
  'the claim is on conflict (member_id, gym_local_date) do nothing returning id');
select ok((select p.prosrc ~* 'begin\s+select s\.at_risk_weekly' and p.prosrc ~* 'exception when others then\s+v_failed' from pg_proc p where p.oid = 'private.run_engagement_reminder_job()'::regprocedure),
  'the per-member work sits inside its own begin ... exception block (a savepoint)');

-- ============================================================================
-- The engagement area is dark: the epoch is unset. One job_runs row per run and nothing else.
-- ============================================================================
select is((select release_week_start from platform_engagement_config), null::date, 'the epoch is unset (dark)');
select pg_temp.win_open_a();
select pg_temp.visit(10, pg_temp.other_day());
select pg_temp.visit(9, pg_temp.a_today());
select pg_temp.visit(13, pg_temp.a_today());
update attendance_events set voided_at = now(), voided_by = pg_temp.u(13), void_reason = 'test void' where member_id = pg_temp.m(13);
select is((select count(*)::int from job_runs where job_name = 'engagement_reminder' and started_at = now()), 0, 'this transaction has recorded no engagement_reminder run before the first call');
select lives_ok($$select private.run_engagement_reminder_job()$$, 'the job runs with the epoch unset');
select is(pg_temp.runs('success'), 1, 'one success row');
select is((select count(*)::int from private.engagement_reminder_dispatches where gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2), pg_temp.id(1, 3))), 0, 'no dispatch row');
select is((select count(*)::int from public.notifications where type = 'N-08'), 0, 'no history row');
select is((select count(*)::int from private.engagement_reminder_deliveries), 0, 'no delivery row');
select is((select count(*)::int from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%N-08%'), 0, 'no push request');

-- The epoch is a Monday at or after the gym-local date: nothing is sent (the area is not on yet).
update platform_engagement_config set release_week_start = private.week_start_of(greatest(pg_temp.a_today(), pg_temp.x_today())) + 7;
select pg_temp.win_open_a();
select lives_ok($$select private.run_engagement_reminder_job()$$, 'the job runs with the epoch in the future');
select is((select count(*)::int from private.engagement_reminder_dispatches where gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2), pg_temp.id(1, 3))), 0, 'the gym-local date is before the epoch: no dispatch');
select is(pg_temp.runs('success'), 2, 'and a second success row');

-- The epoch is on, four weeks back: member 12 has four met weeks, hence holds one Shield (settled with the default goal of 3).
update platform_engagement_config set release_week_start = private.week_start_of(least(pg_temp.a_today(), pg_temp.x_today())) - 28;
select pg_temp.visit(12, d.day)
from (select private.week_start_of(pg_temp.a_today()) - 7 * w + k as day from generate_series(1, 4) w, generate_series(0, 2) k) d;
select is(private.settle_engagement(pg_temp.m(12), pg_temp.id(1, 1), private.week_start_of(pg_temp.a_today())), 4, 'member 12: four met weeks are settled');
select is((select shields_held from private.engagement_state_view(pg_temp.m(12))), 1, 'and member 12 holds one Shield');

-- ============================================================================
-- Eligibility, read from the state view alone. The goal default is the days left, so a member with no visit this week is at risk exactly when
-- visits needed = days left, whatever day of the week the file runs on.
-- ============================================================================
update platform_engagement_config set goal_default = pg_temp.days_left(pg_temp.a_today());
select is(pg_temp.risk(1), 'true|' || pg_temp.days_left(pg_temp.a_today()), 'member 1 is at risk and needs as many visits as there are days left (the state view)');
select is(pg_temp.risk(11) || ' ' || pg_temp.risk(12) || ' ' || pg_temp.risk(13) || ' ' || pg_temp.risk(14),
  (select string_agg('true|' || pg_temp.days_left(pg_temp.a_today()), ' ') from generate_series(1, 4)), 'a Pay-per-session member, a Shield holder, a voided-visit member and a member of the suspended gym are all at risk by the view');
select is(pg_temp.risk(9) || ' ' || pg_temp.risk(10) || ' ' || pg_temp.risk(6) || ' ' || pg_temp.risk(18),
  'false|' || (pg_temp.days_left(pg_temp.a_today()) - 1) || ' false|' || (pg_temp.days_left(pg_temp.a_today()) - 1) || ' false|' || pg_temp.days_left(pg_temp.a_today()) || ' false|' || pg_temp.days_left(pg_temp.a_today()),
  'a visit today (9), a visit on another day (10), an expired subscription (6) and no subscription (18) are not at risk by the view');
-- (member 9's and 10's visits count one day each; 18 and 6 have the full number still needed, and are excluded by the subscription rule)
select is((select count(*)::int from private.engagement_state_view(pg_temp.m(13)) v where v.visited_today), 0, 'a voided visit today is not a visit (member 13 has not visited today)');

-- Outside the window, nothing is sent: a window two hours away, then one that ENDS this hour (the end is exclusive).
select pg_temp.win_elsewhere();
select lives_ok($$select private.run_engagement_reminder_job()$$, 'a run outside the window');
select is((select count(*)::int from private.engagement_reminder_dispatches where gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2), pg_temp.id(1, 3))), 0, 'gym-local time outside the window: nothing sent although members are at risk');
select pg_temp.win_ends_now_a();
select lives_ok($$select private.run_engagement_reminder_job()$$, 'a run in the hour a window has just closed');
select is((select count(*)::int from private.engagement_reminder_dispatches where gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2), pg_temp.id(1, 3))), 0, 'the window end is exclusive (the case at 21:00)');

-- Counts of everything the job must never touch, taken before the first send.
create temp table before_counts as
  select (select count(*) from engagement_facts) as facts, (select count(*) from loyalty_events) as loyalty_events, (select count(*) from loyalty_progress) as loyalty_progress,
         (select count(*) from guest_sessions) as guests, (select count(*) from attendance_events) as attendance,
         (select count(*) from member_weekly_goals) as goals, (select count(*) from engagement_state) as states;
select is(pg_temp.runs('success'), 4, 'four success runs so far (epoch unset, epoch in the future, outside the window, window ended)');

-- ============================================================================
-- The main run. The window opens at this hour (the start is inclusive). Member 19's history insert is refused by a trigger: only 19 is lost.
-- ============================================================================
create function public.zz_er_refuse() returns trigger language plpgsql as $f$ begin raise exception 'zz_er_refuse: no history row for this member'; end $f$;
create trigger zz_er_refuse before insert on public.notifications for each row when (new.member_id = '00000000-0000-0000-0045-000000003019') execute function public.zz_er_refuse();
select pg_temp.win_open_a();
select lives_ok($$select private.run_engagement_reminder_job()$$, 'the main run: the window start is inclusive');
select is(pg_temp.runs('success'), 5, 'a run in which one member failed is a success run (the failure is a warning, as in the class job)');
select is(pg_temp.runs('failure'), 0, 'and no failure row');
select is((select error from job_runs where job_name = 'engagement_reminder' and status::text = 'success' and error is not null and started_at = now()), '1 of 15 member(s) failed; first: zz_er_refuse: no history row for this member', 'the success row carries the count of members that failed and the first error');
select is((select count(*)::int from job_runs where job_name = 'engagement_reminder' and status::text = 'success' and error is null and started_at = now()), 4, 'and the four success runs without a failed member carry no error');
select is(pg_temp.sent(1, 24), '1,2,3,4,11,12,13,20,21,24', 'reminded: 1, 2, 3, 4, 11 (Pay-per-session), 12 (Shield), 13 (voided visit), 20, 21, 24 (N-06 and N-07 already sent)');
select is(pg_temp.disp(19) + pg_temp.hist(19), 0, 'member 19 failed: no claim and no history row survive (the member''s savepoint rolled the claim back)');
select is(pg_temp.disp(5), 0, 'opted out: nothing');
select is(pg_temp.disp(6), 0, 'expired subscription: nothing');
select is(pg_temp.disp(7), 0, 'deactivated member: nothing');
select is(pg_temp.disp(8) + pg_temp.disp(17), 0, 'a coach and an owner: nothing');
select is(pg_temp.disp(9), 0, 'a visit today: nothing');
select is(pg_temp.disp(10), 0, 'the goal is still reachable without today: nothing');
select is(pg_temp.disp(14), 0, 'a member of a suspended gym: nothing, although the view says at risk');
select is(pg_temp.disp(15), 0, 'a member of gym X, whose local hour is not in the window: nothing (the window is gym-local)');
select is(pg_temp.disp(18), 0, 'no subscription: nothing');
select is(pg_temp.disp(11) + pg_temp.hist(11), 2, 'a Pay-per-session member is reminded like anyone else (no plan gating)');
select is(pg_temp.disp(12) + pg_temp.hist(12), 2, 'a member who holds a Shield is reminded (the Shield does not suppress it)');
select is(pg_temp.disp(13) + pg_temp.hist(13), 2, 'a member whose only visit today was voided is reminded');
select is((select count(*)::int from private.engagement_reminder_dispatches where gym_local_date = pg_temp.a_today() and gym_id = pg_temp.id(1, 1)), 10, 'ten dispatches, each stamped with the gym-local date (private.gym_today)');
select is((select string_agg(status, ',' order by m.name) from private.engagement_reminder_dispatches d join members m on m.id = d.member_id where d.member_id in (pg_temp.m(1), pg_temp.m(2), pg_temp.m(3), pg_temp.m(4))),
  'queued,queued,no_tokens,queued', 'queued with a token, no_tokens without one');
select is(pg_temp.dels(1) || '|' || pg_temp.dels(2) || '|' || pg_temp.dels(3) || '|' || pg_temp.dels(4), '1|1|0|2', 'one delivery per device token');
select is((select count(*)::int from public.notifications where type = 'N-08'), 10, 'one N-08 history row per dispatch, including the one without a token');
select is((select count(*)::int from public.notifications where member_id = pg_temp.m(24) and type in ('N-06', 'N-07')) || '|' || pg_temp.hist(24), '2|1',
          'N-08 is sent although N-06 and N-07 were already sent today, and neither of them is touched');
select is((select count(*)::int from private.engagement_reminder_deliveries where status <> 'push_pending'), 0, 'every new delivery waits for its ticket (push_pending)');
select is((select count(*)::int from before_counts b where b.facts = (select count(*) from engagement_facts) and b.loyalty_events = (select count(*) from loyalty_events)
            and b.loyalty_progress = (select count(*) from loyalty_progress) and b.guests = (select count(*) from guest_sessions) and b.attendance = (select count(*) from attendance_events)
            and b.goals = (select count(*) from member_weekly_goals) and b.states = (select count(*) from engagement_state)), 1,
  'after the run the facts, loyalty ledger, stamps, guest sessions, attendance, goals and engagement state have identical row counts');

-- The text and the payload.
create function pg_temp.en_body() returns text language sql stable as $f$
  select 'Come in today: ' || pg_temp.days_left(pg_temp.a_today()) || case when pg_temp.days_left(pg_temp.a_today()) = 1 then ' visit' else ' visits' end || ' left to close your ring.' $f$;
create function pg_temp.fr_body() returns text language sql stable as $f$
  select 'Venez aujourd''hui : encore ' || pg_temp.days_left(pg_temp.a_today()) || case when pg_temp.days_left(pg_temp.a_today()) = 1 then ' visite' else ' visites' end || ' pour fermer votre cercle.' $f$;
select is((select title || '|' || body from public.notifications where member_id = pg_temp.m(1) and type = 'N-08'), 'Your week is in reach|' || pg_temp.en_body(), 'the English history row carries the catalog title and the visits still needed (the days left)');
select is((select title || '|' || body from public.notifications where member_id = pg_temp.m(2) and type = 'N-08'), 'Votre semaine est à portée|' || pg_temp.fr_body(), 'the French history row follows users.preferred_language');
select is(pg_temp.payload(1) ->> 'title' || '|' || (pg_temp.payload(1) ->> 'body'), (select title || '|' || body from public.notifications where member_id = pg_temp.m(1) and type = 'N-08'), 'the push has the same title and body as its history row');
select is(pg_temp.payload(2) ->> 'title' || '|' || (pg_temp.payload(2) ->> 'body'), 'Votre semaine est à portée|' || pg_temp.fr_body(), 'the French push too');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.payload(1) -> 'data') k), array['gymId', 'notificationCode'], 'the push data carries notificationCode and gymId and nothing else (no deep link)');
select is(pg_temp.payload(1) #>> '{data,notificationCode}' || '|' || (pg_temp.payload(1) #>> '{data,gymId}'), 'N-08|' || pg_temp.id(1, 1), 'N-08 and the member''s gym');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.payload(1)) k), array['body', 'data', 'sound', 'title', 'to'], 'the request has the same keys as N-07 minus nothing it needs: to, title, body, sound, data');
select isnt(pg_temp.payload(1) ->> 'title', (select name from gyms where id = pg_temp.id(1, 1)), 'the push title is never the gym name');
select ok((select q.url = 'https://exp.host/--/api/v2/push/send' and q.headers ->> 'Content-Type' = 'application/json'
           from net.http_request_queue q join private.engagement_reminder_deliveries d on d.push_request_id = q.id join private.engagement_reminder_dispatches x on x.id = d.dispatch_id
           where x.member_id = pg_temp.m(1)), 'the request goes to the Expo endpoint only, as JSON');
select is((select array_agg(convert_from(q.body, 'UTF8')::jsonb ->> 'to' order by convert_from(q.body, 'UTF8')::jsonb ->> 'to') from net.http_request_queue q join private.engagement_reminder_deliveries d on d.push_request_id = q.id
           join private.engagement_reminder_dispatches x on x.id = d.dispatch_id where x.member_id = pg_temp.m(4)), array['ExponentPushToken[ER-4-A]', 'ExponentPushToken[ER-4-B]'], 'one request per token of the member');

-- ============================================================================
-- Ticks after the first: once per gym-local day; a failed member is retried by the next tick; a dispatch without deliveries is never re-sent
-- ============================================================================
create temp table tick1 as select (select count(*) from private.engagement_reminder_dispatches) as dispatches, (select count(*) from public.notifications where type = 'N-08') as history,
  (select count(*) from private.engagement_reminder_deliveries) as deliveries, (select count(*) from net.http_request_queue) as requests;
drop trigger zz_er_refuse on public.notifications;
select lives_ok($$select private.run_engagement_reminder_job()$$, 'the next tick runs');
select is(pg_temp.sent(1, 24), '1,2,3,4,11,12,13,19,20,21,24', 'the member that failed is reminded on the next tick (its claim was rolled back, so nothing blocked it)');
select is((select count(*)::int from private.engagement_reminder_dispatches) - (select dispatches from tick1)::int, 1, 'and only that member: one more dispatch');
select is((select count(*)::int from public.notifications where type = 'N-08') - (select history from tick1)::int, 1, 'one more history row');
select is((select count(*)::int from private.engagement_reminder_deliveries) - (select deliveries from tick1)::int, 1, 'one more delivery');
select is((select count(*)::int from net.http_request_queue) - (select requests from tick1)::int, 1, 'one more push request, so every other member was not sent a second one');
select is(pg_temp.hist(1) || '|' || pg_temp.hist(2) || '|' || pg_temp.hist(13) || '|' || pg_temp.hist(24), '1|1|1|1', 'a second tick on the same day gives nobody a second history row');
select lives_ok($$select private.run_engagement_reminder_job()$$, 'and a third tick');
select is((select count(*)::int from public.notifications where type = 'N-08'), 11, 'still 11 history rows');
insert into device_push_tokens (user_id, expo_push_token, platform) values (pg_temp.u(3), 'ExponentPushToken[ER-3-LATE]', 'android');
select lives_ok($$select private.run_engagement_reminder_job()$$, 'a token registered after the claim');
select is(pg_temp.dels(3) || '|' || (select status from private.engagement_reminder_dispatches where member_id = pg_temp.m(3)) || '|' || pg_temp.hist(3), '0|no_tokens|1',
          'a dispatch with no deliveries is never re-sent that day (at most once beats at least once)');
select is(pg_temp.runs('success'), 8, 'every tick wrote its own success row');
select is((select count(*)::int from job_runs where job_name = 'engagement_reminder' and started_at = now() and finished_at is null), 0, 'each with a finish time');

-- ============================================================================
-- The sender on its own: no claim, no send; a member who is no longer at risk is not reminded
-- ============================================================================
insert into members (id, gym_id, user_id, role, name, join_date) values (pg_temp.m(22), pg_temp.id(1, 1), pg_temp.u(22), 'member', 'ER Member 22', date '2026-01-05');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values (pg_temp.id(1, 1), pg_temp.m(22), pg_temp.id(4, 1), 'active', date '2026-01-05', date '2030-01-01');
select is(pg_temp.risk(22), 'true|' || pg_temp.days_left(pg_temp.a_today()), 'member 22 is at risk');
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000003022')$$, '%no pending engagement reminder dispatch%', 'the sender refuses a member whose claim does not exist (it is not a way round the claim)');
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000009999')$$, '%member not found%', 'and an unknown member');
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000003001')$$, '%no pending engagement reminder dispatch%', 'and a member whose reminder is already queued (a second call sends nothing)');
select is(pg_temp.hist(1) || '|' || pg_temp.dels(1), '1|1', 'so member 1 still has one history row and one delivery');
insert into private.engagement_reminder_dispatches (member_id, gym_id, gym_local_date) values (pg_temp.m(22), pg_temp.id(1, 1), pg_temp.a_today());
select pg_temp.visit(22, pg_temp.a_today());
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000003022')$$, '%no longer at risk%', 'a member who visited after the claim is re-checked by the sender, which raises (the job''s savepoint then rolls the claim back)');
select is(pg_temp.hist(22) || '|' || pg_temp.dels(22) || '|' || (select status from private.engagement_reminder_dispatches where member_id = pg_temp.m(22)), '0|0|pending', 'and it wrote no history row and queued no push');

-- The batch was chosen earlier: a claim exists, and the member has since switched the reminder off, been deactivated, or the gym suspended (seeded
-- suspended at insert). The sender re-checks and raises (the job's savepoint then rolls the claim back); nothing is written.
insert into private.engagement_reminder_dispatches (member_id, gym_id, gym_local_date) values
  (pg_temp.m(5), pg_temp.id(1, 1), pg_temp.a_today()),
  (pg_temp.m(7), pg_temp.id(1, 1), pg_temp.a_today()),
  (pg_temp.m(14), pg_temp.id(1, 2), private.gym_today(pg_temp.id(1, 2)));
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000003005')$$, '%not eligible%', 'the sender re-checks the off-switch: an opted-out member with a claim is not sent anything');
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000003007')$$, '%not eligible%', 'a deactivated member with a claim is not sent anything');
select throws_like($$select private.send_engagement_reminder('00000000-0000-0000-0045-000000003014')$$, '%not eligible%', 'a member of a suspended gym with a claim is not sent anything');
select is(pg_temp.hist(5) + pg_temp.hist(7) + pg_temp.hist(14) + pg_temp.dels(5) + pg_temp.dels(7) + pg_temp.dels(14), 0, 'and none of them got a history row or a delivery');

-- ============================================================================
-- The preference: the member's own row, through the app's path (RLS); the next tick follows it
-- ============================================================================
insert into members (id, gym_id, user_id, role, name, join_date) values (pg_temp.m(23), pg_temp.id(1, 1), pg_temp.u(23), 'member', 'ER Member 23', date '2026-01-05');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values (pg_temp.id(1, 1), pg_temp.m(23), pg_temp.id(4, 1), 'active', date '2026-01-05', date '2030-01-01');
select pg_temp.claims(23, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select streak_reminder_opted_out::text from member_preferences where member_id = '00000000-0000-0000-0045-000000003023'$$), 'false', 'a member reads their own preference: on by default');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from member_preferences where member_id = '00000000-0000-0000-0045-000000003001'$$), '0', 'and cannot read another member''s row');
select is(pg_temp.asrole('authenticated', $$with u as (update member_preferences set streak_reminder_opted_out = true where member_id = '00000000-0000-0000-0045-000000003023' returning 1) select count(*)::text from u$$), '1', 'opting out updates their own row');
select is(pg_temp.asrole('authenticated', $$with u as (update member_preferences set streak_reminder_opted_out = true where member_id = '00000000-0000-0000-0045-000000003001' returning 1) select count(*)::text from u$$), '0', 'and no other member''s');
select is((select streak_reminder_opted_out::text from member_preferences where member_id = pg_temp.m(1)), 'false', 'member 1''s row is untouched');
select is(pg_temp.risk(23), 'true|' || pg_temp.days_left(pg_temp.a_today()), 'member 23 is at risk and has not been claimed');
select lives_ok($$select private.run_engagement_reminder_job()$$, 'a tick after the opt-out');
select is(pg_temp.disp(23) + pg_temp.hist(23), 0, 'the next tick sends nothing to a member who opted out, although no claim had happened');
select is(pg_temp.asrole('authenticated', $$with u as (update member_preferences set streak_reminder_opted_out = false where member_id = '00000000-0000-0000-0045-000000003023' returning 1) select count(*)::text from u$$), '1', 'turning it on again');
select lives_ok($$select private.run_engagement_reminder_job()$$, 'a tick after opting back in');
select is(pg_temp.disp(23) + pg_temp.hist(23), 2, 'resumes: the member is reminded');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from member_preferences where member_id <> '00000000-0000-0000-0045-000000003023'$$), '0', 'the app still sees no other member''s preferences row');

-- ============================================================================
-- A run that fails as a whole: one failure row with the error, an audit event, and nothing half-sent
-- ============================================================================
insert into members (id, gym_id, user_id, role, name, join_date) values (pg_temp.m(25), pg_temp.id(1, 1), pg_temp.u(25), 'member', 'ER Member 25', date '2026-01-05');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values (pg_temp.id(1, 1), pg_temp.m(25), pg_temp.id(4, 1), 'active', date '2026-01-05', date '2030-01-01');
create function public.zz_er_boom() returns trigger language plpgsql as $f$ begin raise exception 'zz_er_boom: the success row is refused'; end $f$;
create trigger zz_er_boom before insert on public.job_runs for each row when (new.job_name = 'engagement_reminder' and new.status::text = 'success') execute function public.zz_er_boom();
select lives_ok($$select private.run_engagement_reminder_job()$$, 'the job does not raise out of cron when it fails; it records the failure');
select is(pg_temp.runs('failure'), 1, 'one failure row');
select is((select error from job_runs where job_name = 'engagement_reminder' and status::text = 'failure' and started_at = now()), 'zz_er_boom: the success row is refused', 'with the error text');
select is((select count(*)::int from audit_log where action_type = 'engagement_reminder_job_failure' and metadata ->> 'error' = 'zz_er_boom: the success row is refused'), 1, 'and one audit event');
select is(pg_temp.disp(25) + pg_temp.hist(25), 0, 'the failed run left no claim and no history row behind (the next tick retries)');
drop trigger zz_er_boom on public.job_runs;
select lives_ok($$select private.run_engagement_reminder_job()$$, 'the next run');
select is(pg_temp.disp(25) + pg_temp.hist(25), 2, 'sends it');
select is(pg_temp.runs('failure'), 1, 'and the failure row stays the only one');

-- ============================================================================
-- Gym-local, never UTC: gym X is 13 hours ahead of gym A. The window is moved to the hour it is in gym X right now.
-- ============================================================================
insert into members (id, gym_id, user_id, role, name, join_date) values (pg_temp.m(26), pg_temp.id(1, 3), pg_temp.u(26), 'member', 'ER Member 26', date '2026-01-05');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values (pg_temp.id(1, 3), pg_temp.m(26), pg_temp.id(4, 4), 'active', date '2026-01-05', date '2030-01-01');
select isnt(pg_temp.hr('Pacific/Kiritimati'), extract(hour from now() at time zone 'UTC')::int, 'gym X''s local hour is not the UTC hour (so a UTC-based window could not pass this)');
select isnt(pg_temp.hr('Pacific/Kiritimati'), pg_temp.hr('Africa/Douala'), 'nor gym A''s');
update platform_engagement_config set goal_default = pg_temp.days_left(pg_temp.x_today());
select pg_temp.win_open_x();
select is(pg_temp.risk(15) || ' ' || pg_temp.risk(26), 'true|' || pg_temp.days_left(pg_temp.x_today()) || ' true|' || pg_temp.days_left(pg_temp.x_today()), 'the two gym X members are at risk by their own gym-local week');
select lives_ok($$select private.run_engagement_reminder_job()$$, 'a run in gym X''s evening');
select is(pg_temp.disp(15) || '|' || pg_temp.disp(26), '1|1', 'gym X''s members are reminded');
select is((select string_agg(distinct gym_local_date::text, ',') from private.engagement_reminder_dispatches where gym_id = pg_temp.id(1, 3)), pg_temp.x_today()::text, 'with gym X''s own local date');
select is((select count(*)::int from private.engagement_reminder_dispatches where gym_id = pg_temp.id(1, 1)), 16, 'and gym A, whose hour is not in the window, got no further dispatch (16 so far: the ten of the main run, 19 on the retry, 22, 5 and 7 by hand, 23 and 25)');

-- ============================================================================
-- The delivery processor, fifth branch: ticket ok then receipt ok, a ticket error, DeviceNotRegistered, a transport error, a receipt error
-- ============================================================================
create function pg_temp.respond(p_n int, p_token text, p_status int, p_content text, p_timed_out boolean default false, p_error text default null) returns void language sql as $f$
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
  select d.push_request_id, p_status, 'application/json', '{}'::jsonb, p_content, p_timed_out, p_error
  from private.engagement_reminder_deliveries d join private.engagement_reminder_dispatches x on x.id = d.dispatch_id
  where x.member_id = pg_temp.m(p_n) and d.expo_push_token = p_token $f$;
create function pg_temp.dstatus(p_n int, p_token text) returns text language sql stable as $f$
  select d.status || coalesce(':' || d.error_code, '') from private.engagement_reminder_deliveries d join private.engagement_reminder_dispatches x on x.id = d.dispatch_id
  where x.member_id = pg_temp.m(p_n) and d.expo_push_token = p_token $f$;
select pg_temp.respond(1, 'ExponentPushToken[ER-1]', 200, '{"data":{"status":"ok","id":"ER-TICKET-1"}}');
select pg_temp.respond(2, 'ExponentPushToken[ER-2-FR]', 200, '{"data":{"status":"error","message":"Message too big","details":{"error":"MessageTooBig"}}}');
select pg_temp.respond(4, 'ExponentPushToken[ER-4-A]', 200, '{"data":{"status":"error","message":"The device is not registered","details":{"error":"DeviceNotRegistered"}}}');
select pg_temp.respond(11, 'ExponentPushToken[ER-11]', 500, 'server error');
select pg_temp.respond(12, 'ExponentPushToken[ER-12]', null, null, true, 'timed out');
select pg_temp.respond(13, 'ExponentPushToken[ER-13]', 200, '{"data":{"status":"ok","id":"ER-TICKET-13"}}');
select lives_ok($$select private.process_notification_deliveries()$$, 'the shared processor handles the engagement-reminder ledger');
select is(pg_temp.dstatus(1, 'ExponentPushToken[ER-1]'), 'receipt_pending', 'a ticket ok moves the delivery to receipt_pending');
select is((select d.expo_ticket_id || '|' || (d.receipt_request_id is not null)::text from private.engagement_reminder_deliveries d join private.engagement_reminder_dispatches x on x.id = d.dispatch_id
           where x.member_id = pg_temp.m(1)), 'ER-TICKET-1|true', 'with its ticket id and a queued receipt request');
select is(pg_temp.dstatus(2, 'ExponentPushToken[ER-2-FR]'), 'failed:MessageTooBig', 'a ticket error is failed, with the Expo code');
select is(pg_temp.dstatus(4, 'ExponentPushToken[ER-4-A]'), 'device_not_registered:DeviceNotRegistered', 'DeviceNotRegistered is terminal');
select is((select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[ER-4-A]'), 0, 'and the stale token is removed (cleanup_invalid_device_push_token)');
select is((select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[ER-4-B]'), 1, 'the member''s other token is untouched');
select is(pg_temp.dstatus(4, 'ExponentPushToken[ER-4-B]'), 'push_pending', 'a delivery with no response yet stays push_pending');
select is(pg_temp.dstatus(11, 'ExponentPushToken[ER-11]'), 'failed:HTTP_500', 'an HTTP error is failed');
select is(pg_temp.dstatus(12, 'ExponentPushToken[ER-12]'), 'failed:TRANSPORT_ERROR', 'a transport error is failed');
create function pg_temp.respond_receipt(p_n int, p_content text) returns void language sql as $f$
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
  select d.receipt_request_id, 200, 'application/json', '{}'::jsonb, p_content, false, null
  from private.engagement_reminder_deliveries d join private.engagement_reminder_dispatches x on x.id = d.dispatch_id where x.member_id = pg_temp.m(p_n) $f$;
select pg_temp.respond_receipt(1, '{"data":{"ER-TICKET-1":{"status":"ok"}}}');
select lives_ok($$select private.process_notification_deliveries()$$, 'the next pass reads the receipt');
select is(pg_temp.dstatus(1, 'ExponentPushToken[ER-1]'), 'delivered', 'a receipt ok is delivered');
select is((select (d.completed_at is not null)::text from private.engagement_reminder_deliveries d join private.engagement_reminder_dispatches x on x.id = d.dispatch_id where x.member_id = pg_temp.m(1)), 'true', 'with a completion time');
select is(pg_temp.dstatus(13, 'ExponentPushToken[ER-13]'), 'receipt_pending', 'a receipt that has no response yet stays receipt_pending (member 13)');
select pg_temp.respond_receipt(13, '{"data":{"ER-TICKET-13":{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}}}}');
select lives_ok($$select private.process_notification_deliveries()$$, 'and once the receipt answers');
select is(pg_temp.dstatus(13, 'ExponentPushToken[ER-13]'), 'device_not_registered:DeviceNotRegistered', 'a receipt DeviceNotRegistered is terminal too');
select is((select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[ER-13]'), 0, 'and its token is removed');

-- The processor is the 0059 definition plus the one branch: take the branch out and what is left is byte for byte what ran before 0191.
select is(md5(regexp_replace((select prosrc from pg_proc where oid = 'private.process_notification_deliveries()'::regprocedure),
  E'\n\n      union all\n\n      select\n        ''engagement_reminder_deliveries''::text as source_table,.*?from private\\.engagement_reminder_deliveries d\n      join net\\._http_response r\n        on r\\.id = case\n          when d\\.status = ''push_pending'' then d\\.push_request_id\n          when d\\.status = ''receipt_pending'' then d\\.receipt_request_id\n        end\n      where d\\.status in \\(''push_pending'', ''receipt_pending''\\)', '', 's')),
  '66eb25bf392d80e07b99d69233c6effb', 'the processor without its new branch is byte for byte the 0059 definition that production runs (md5 of its source)');
select is((select count(*)::int from regexp_matches((select prosrc from pg_proc where oid = 'private.process_notification_deliveries()'::regprocedure), '''(notification_deliveries|payment_notification_deliveries|quiet_gym_alert_deliveries|class_reminder_deliveries|engagement_reminder_deliveries)''::text as source_table', 'g')), 5,
  'five union all branches: the four earlier families and the new one');

-- ============================================================================
-- Gates that reach their consumers
-- ============================================================================
create function pg_temp.table_writers() returns text[] language sql as $f$
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* '(insert\s+into|update|delete\s+from)\s+(private\.)?engagement_reminder_(dispatches|deliveries)\M'
$f$;
select is(pg_temp.table_writers(), array['private.run_engagement_reminder_job()', 'private.send_engagement_reminder(uuid)'], 'gate: only the job and the sender write the two tables (the processor updates its ledgers through a dynamic statement and is covered by its own branch above)');
create function pg_temp.sender_callers() returns text[] language sql as $f$
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p') and p.proname <> 'send_engagement_reminder'
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'send_engagement_reminder\s*\('
$f$;
select is(pg_temp.sender_callers(), array['private.run_engagement_reminder_job()'], 'gate: the job is the only caller of the sender');

-- The same scans against a mutant: record_check_in calling the sender must be reported, and the original comes back byte for byte.
create temp table original_def as select pg_get_functiondef('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure) as def;
do $mutate$
declare v_def text;
begin
  select def into v_def from original_def;
  v_def := regexp_replace(v_def, E'\\mbegin\\M', E'begin\n  perform private.send_engagement_reminder(p_member_id);', '');
  execute v_def;
end
$mutate$;
select is(pg_temp.sender_callers(), array['private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)', 'private.run_engagement_reminder_job()'],
          'gate: against a mutant that makes record_check_in call the sender, the scan names it');
select is((select md5(prosrc) from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure) = '34523741f9ee74e91b1c0c4ee73eb70f', false, 'gate: and the hash pin of record_check_in fails for the mutant');
do $restore$
begin
  execute (select def from original_def);
end
$restore$;
select is(pg_temp.sender_callers(), array['private.run_engagement_reminder_job()'], 'gate: with record_check_in restored the scan is clean again');
select is(
  (select string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname) from pg_proc p where p.oid in ('public.check_in(timestamptz, uuid)'::regprocedure, 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure, 'public.void_staff_check_in(uuid, text)'::regprocedure)),
  'check_in:be1582e0a0bef49aa852c13205d7938c,record_check_in:34523741f9ee74e91b1c0c4ee73eb70f,void_staff_check_in:957d0d3f7afcb0ff7f857f697d4d53fb',
  'gate: check_in(), record_check_in and void_staff_check_in are untouched (source hashes pinned)');
select is((select count(*)::int from unnest(array['public.check_in(timestamptz, uuid)', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)', 'public.void_staff_check_in(uuid, text)']) f
           where pg_get_functiondef(to_regprocedure(f)) ~* 'engagement_reminder|streak_reminder|N-08'), 0, 'gate: the three check-in paths name nothing of the reminder');

select is((select count(*)::int from pg_proc p where p.oid in ('private.run_engagement_reminder_job()'::regprocedure, 'private.send_engagement_reminder(uuid)'::regprocedure)
             and p.prosrc ~* 'engagement_facts|loyalty|guest_sessions|\mstamps?\M|attendance_events|attendance_counted|member_visit_days|settle_engagement|engagement_fold'), 0,
  'gate: neither function names a fact, the loyalty ledger, guest sessions, stamps, attendance or a visit-day read (eligibility is the state view alone)');
select is((select count(*)::int from pg_proc p where p.oid = 'private.run_engagement_reminder_job()'::regprocedure and p.prosrc ~* 'for\s+(no\s+key\s+)?update|pg_advisory|lock\s+table|skip\s+locked'), 0, 'gate: the job takes no lock (no member lock, no advisory lock)');
select is((select (regexp_matches(p.prosrc, 'for update', 'g'))[1] from pg_proc p where p.oid = 'private.send_engagement_reminder(uuid)'::regprocedure limit 1), 'for update', 'gate: the sender''s one row lock is on its own dispatch row');
select ok((select position('private.engagement_reminder_dispatches d' in p.prosrc) < position('for update' in p.prosrc) and position('for update' in p.prosrc) < position('insert into public.notifications' in p.prosrc)
           from pg_proc p where p.oid = 'private.send_engagement_reminder(uuid)'::regprocedure), 'gate: that lock is taken on the dispatch before anything is written');
select is((select count(*)::int from pg_proc p where p.oid = 'private.run_engagement_reminder_job()'::regprocedure and p.prosrc ~* 'class_reminder|quiet_gym|N-06|N-07|payment_notification'), 0, 'gate: the job reads no other notification family (N-08 shares no limit)');
select is((select count(*)::int from pg_proc p where p.proname in ('send_class_reminder', 'send_quiet_gym_alert', 'send_push_notification', 'send_payment_push_notification', 'run_class_reminder_job', 'run_quiet_gym_alert_job')
             and p.prosrc ~* 'engagement_reminder|N-08'), 0, 'gate: no other notification sender or job reads N-08 (a sent N-08 suppresses nothing)');
select is((select count(*)::int from private.support_capabilities where object_name ~* 'engagement_reminder|streak_reminder'), 0, 'gate: none of the new functions is a support capability');
select is((select count(*)::int from before_counts b where b.facts = (select count(*) from engagement_facts) and b.loyalty_events = (select count(*) from loyalty_events)
            and b.loyalty_progress = (select count(*) from loyalty_progress) and b.guests = (select count(*) from guest_sessions)
            and b.goals = (select count(*) from member_weekly_goals) and b.states = (select count(*) from engagement_state)), 1,
  'gate: after every run in this file the facts, loyalty ledger, stamps, guest sessions, goals and engagement state are unchanged (the attendance rows added since are this file''s own fixtures)');

-- Cost, recorded not bounded: the members that reach the state view in one tick are the active, non-opted-out members of gyms inside their window who
-- have no dispatch today, 12 ticks in a 3-hour window. Here, with the window on gym A:
select pg_temp.win_open_a();
select diag('engagement_reminder cost note: a tick evaluates ' || (
  select count(*) from public.members m join public.gyms g on g.id = m.gym_id
  where g.status = 'active' and m.deactivated_at is null and m.role = 'member'
    and extract(hour from now() at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC')) >= (select reminder_window_start_hour from platform_engagement_config)
    and extract(hour from now() at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC')) < (select reminder_window_end_hour from platform_engagement_config)
    and not exists (select 1 from private.engagement_reminder_dispatches d where d.member_id = m.id and d.gym_local_date = private.gym_today(g.id))
) || ' member(s) here; the state view is the cost Home pays per open, and no bound is added');

select * from finish();
rollback;
