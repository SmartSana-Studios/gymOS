-- Story 30.6 (FR-227, FR-228, NFR-027): the two member_preferences columns, the extended protect trigger and the two writers (migration 0188).
--
-- Covers: the columns (type, default, nullability, NULL for every row that exists or is created); the trigger (a direct UPDATE of either column is
-- refused with leaderboard_columns_write_protected whoever writes, only the transaction-local flag lets it through, the flag is off again after a
-- writer, the three pins and the two notification opt-outs behave as before); set_leaderboard_visibility (own row, hidden only, NULL refused, no
-- member id parameter); mark_leaderboard_notice_seen (own row, notice only, set once, idempotent, opening the board never marks it, one notice
-- per gym for a member of two gyms); the caller matrix (an Owner, Manager, Supervisor, Receptionist, Coach, a Support session, an anon caller, a
-- deactivated member, a member of a suspended gym, a forged claim, a member of gym B naming gym A, no gym claim, no members row: both writers
-- refused, nothing written); and the source scans (suspension guard text, no support registration, privileges).
-- The existing notification_preferences.test.sql and .negative.test.sql pass unedited (run by the suite).
--
-- Fixture ids: 00000000-0000-0000-0042-nnnnnnnnnnnn.

begin;
select plan(71);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0042-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
-- One statement as a database role: 'ok', or sqlstate:message (the statement's own effects are undone when it fails).
create function pg_temp.run(p_role text, p_sql text) returns text language plpgsql as $f$
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return 'ok';
end $f$;
create function pg_temp.hid(p_n int) returns text language sql as $f$ select leaderboard_hidden::text from member_preferences where member_id = pg_temp.m(p_n) $f$;
create function pg_temp.seen(p_n int) returns text language sql as $f$ select coalesce(leaderboard_notice_seen_at::text, 'null') from member_preferences where member_id = pg_temp.m(p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'LBV Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'LBV Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'LBV Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'LBV Gym S (suspended)', pg_temp.id(0, 1), 'suspended', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'lbv-' || n || '@x.example', now() from generate_series(1, 40) n;
-- 1 member A (the subject), 2 member A (a neighbour), 3 owner, 4 manager, 5 supervisor, 6 receptionist, 7 coach, 8 deactivated member,
-- 9 member B, 10 member of suspended gym S, 11 support (below), 12 member of BOTH gym A and gym B (two member rows).
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at) values
  (pg_temp.m(1), pg_temp.id(1, 1), pg_temp.id(2, 1), 'member', 'LBV ONE', date '2026-01-05', null),
  (pg_temp.m(2), pg_temp.id(1, 1), pg_temp.id(2, 2), 'member', 'LBV TWO', date '2026-01-05', null),
  (pg_temp.m(3), pg_temp.id(1, 1), pg_temp.id(2, 3), 'owner', 'LBV OWNER', date '2026-01-05', null),
  (pg_temp.m(4), pg_temp.id(1, 1), pg_temp.id(2, 4), 'manager', 'LBV MANAGER', date '2026-01-05', null),
  (pg_temp.m(5), pg_temp.id(1, 1), pg_temp.id(2, 5), 'supervisor', 'LBV SUPERVISOR', date '2026-01-05', null),
  (pg_temp.m(6), pg_temp.id(1, 1), pg_temp.id(2, 6), 'receptionist', 'LBV RECEPTIONIST', date '2026-01-05', null),
  (pg_temp.m(7), pg_temp.id(1, 1), pg_temp.id(2, 7), 'coach', 'LBV COACH', date '2026-01-05', null),
  (pg_temp.m(8), pg_temp.id(1, 1), pg_temp.id(2, 8), 'member', 'LBV DEACTIVATED', date '2026-01-05', now()),
  (pg_temp.m(9), pg_temp.id(1, 2), pg_temp.id(2, 9), 'member', 'LBV NINE', date '2026-01-05', null),
  (pg_temp.m(10), pg_temp.id(1, 3), pg_temp.id(2, 10), 'member', 'LBV TEN', date '2026-01-05', null),
  (pg_temp.m(12), pg_temp.id(1, 1), pg_temp.id(2, 12), 'member', 'LBV TWELVE', date '2026-01-05', null),
  (pg_temp.m(13), pg_temp.id(1, 2), pg_temp.id(2, 12), 'member', 'LBV TWELVE', date '2026-01-05', null);
insert into private.support_accounts (user_id, activated_at) values (pg_temp.id(2, 11), now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values (pg_temp.id(9, 1), pg_temp.id(2, 11), pg_temp.id(1, 1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.id(8, 1), pg_temp.id(2, 11), now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values (pg_temp.id(8, 1), pg_temp.id(2, 11), now(), now());
select private.support_set_membership(pg_temp.id(9, 1), true);

-- ============================================================================
-- The columns
-- ============================================================================
select is((select data_type || ',' || is_nullable || ',' || coalesce(column_default, 'none') from information_schema.columns where table_schema = 'public' and table_name = 'member_preferences' and column_name = 'leaderboard_hidden'),
  'boolean,NO,false', 'leaderboard_hidden is boolean not null default false');
select is((select data_type || ',' || is_nullable || ',' || coalesce(column_default, 'none') from information_schema.columns where table_schema = 'public' and table_name = 'member_preferences' and column_name = 'leaderboard_notice_seen_at'),
  'timestamp with time zone,YES,none', 'leaderboard_notice_seen_at is a nullable timestamptz with no default');
select is((select count(*)::int from member_preferences where leaderboard_notice_seen_at is not null), 0, 'no row, existing or created above, has seen the notice');
select is((select count(*)::int from member_preferences where leaderboard_hidden), 0, 'and none is hidden');
select is((select count(*)::int from member_preferences mp where mp.gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2), pg_temp.id(1, 3))), 13, 'every member has exactly one preferences row (the support row included)');

-- ============================================================================
-- The trigger: a direct write is refused, not pinned back
-- ============================================================================
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.run('authenticated', format('update member_preferences set leaderboard_hidden = true where member_id = %L', pg_temp.m(1))), '42501:leaderboard_columns_write_protected', 'a member''s direct UPDATE of leaderboard_hidden is refused');
select is(pg_temp.run('authenticated', format('update member_preferences set leaderboard_notice_seen_at = now() where member_id = %L', pg_temp.m(1))), '42501:leaderboard_columns_write_protected', 'a member''s direct UPDATE of leaderboard_notice_seen_at is refused');
select is(pg_temp.run('authenticated', format('update member_preferences set leaderboard_hidden = true, quiet_gym_alerts_opted_out = true where member_id = %L', pg_temp.m(1))), '42501:leaderboard_columns_write_protected', 'a statement that also moves an opt-out is refused as a whole');
select is((select quiet_gym_alerts_opted_out::text from member_preferences where member_id = pg_temp.m(1)), 'false', 'and the opt-out did not move');
select is(pg_temp.run('authenticated', format('update member_preferences set quiet_gym_alerts_opted_out = true, class_reminder_opted_out = true where member_id = %L', pg_temp.m(1))), 'ok', 'the two notification opt-outs are still writable');
select is((select quiet_gym_alerts_opted_out::text || class_reminder_opted_out::text from member_preferences where member_id = pg_temp.m(1)), 'truetrue', 'and they changed');
select is(pg_temp.run('authenticated', format('update member_preferences set leaderboard_hidden = false where member_id = %L', pg_temp.m(1))), 'ok', 'writing the value a column already holds is not a change (no refusal)');
select is(pg_temp.run('authenticated', format('update member_preferences set gym_id = %L, member_id = %L where member_id = %L', pg_temp.id(1, 2), pg_temp.m(9), pg_temp.m(1))), 'ok', 'the three pins still pin silently (gym_id and member_id)');
select is((select gym_id::text from member_preferences where member_id = pg_temp.m(1)), pg_temp.id(1, 1)::text, 'and the row did not move');
-- Whoever the writer is: the table owner and service_role included
select is(pg_temp.run('postgres', format('update member_preferences set leaderboard_hidden = true where member_id = %L', pg_temp.m(2))), '42501:leaderboard_columns_write_protected', 'the table owner is refused as well');
select is(pg_temp.run('service_role', format('update member_preferences set leaderboard_notice_seen_at = now() where member_id = %L', pg_temp.m(2))), '42501:leaderboard_columns_write_protected', 'service_role is refused as well');
select is(pg_temp.run('authenticated', format('insert into member_preferences (member_id, gym_id) values (%L, %L)', pg_temp.m(2), pg_temp.id(1, 1))), '42501:new row violates row-level security policy for table "member_preferences"', 'a member still cannot insert a preferences row (no insert policy)');
-- The flag
select set_config('app.leaderboard_write', 'on', true);
select is(pg_temp.run('postgres', format('update member_preferences set leaderboard_hidden = true where member_id = %L', pg_temp.m(2))), 'ok', 'with the transaction-local flag on, the write passes');
select set_config('app.leaderboard_write', 'off', true);
select is(pg_temp.hid(2), 'true', 'and it landed');
select is(pg_temp.run('postgres', format('update member_preferences set leaderboard_hidden = false where member_id = %L', pg_temp.m(2))), '42501:leaderboard_columns_write_protected', 'flag off: refused again');
select set_config('app.leaderboard_write', 'on', true);
update member_preferences set leaderboard_hidden = false where member_id = pg_temp.m(2);
select set_config('app.leaderboard_write', 'off', true);

-- ============================================================================
-- set_leaderboard_visibility
-- ============================================================================
select is((select pronargs::int from pg_proc where oid = 'public.set_leaderboard_visibility(boolean)'::regprocedure), 1, 'set_leaderboard_visibility takes one argument (no member id)');
select is((select pronargs::int from pg_proc where oid = 'public.mark_leaderboard_notice_seen()'::regprocedure), 0, 'mark_leaderboard_notice_seen takes none');
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(true)'), 'ok', 'a live member hides');
select is(pg_temp.hid(1) || ',' || pg_temp.seen(1), 'true,null', 'hidden is written on their own row and the notice column is untouched');
select is(pg_temp.hid(2) || ',' || pg_temp.seen(2), 'false,null', 'a neighbour''s row is untouched');
select is(current_setting('app.leaderboard_write', true), 'off', 'the transaction-local flag is switched off again after the writer');
select is(pg_temp.run('authenticated', format('update member_preferences set leaderboard_hidden = false where member_id = %L', pg_temp.m(1))), '42501:leaderboard_columns_write_protected', 'so a direct write right after a writer is refused');
select is(pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(false)'), 'ok', 'and the member shows again');
select is(pg_temp.hid(1) || ',' || pg_temp.seen(1), 'false,null', 'hidden false, notice still untouched (choosing visibility never marks the notice seen)');
select is(pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(null)'), '22023:invalid_hidden', 'p_hidden NULL is refused');
select is(pg_temp.hid(1), 'false', 'and nothing changed');

-- ============================================================================
-- mark_leaderboard_notice_seen
-- ============================================================================
select is(pg_temp.run('authenticated', 'select count(*) from public.gym_leaderboard(date_trunc(''month'', now())::date)'), 'ok', 'opening the board (a read)');
select is(pg_temp.seen(1), 'null', 'never marks the notice seen');
select is(pg_temp.run('authenticated', 'select public.mark_leaderboard_notice_seen()'), 'ok', 'a live member marks the notice seen');
select isnt(pg_temp.seen(1), 'null', 'the notice stamp is set');
select is(pg_temp.hid(1), 'false', 'and the hidden choice is not touched');
select is(pg_temp.seen(2), 'null', 'a neighbour''s notice is untouched');
-- Idempotent: set a known earlier stamp, call again, the stamp does not move.
select set_config('app.leaderboard_write', 'on', true);
update member_preferences set leaderboard_notice_seen_at = timestamptz '2026-01-01 10:00+00' where member_id = pg_temp.m(1);
select set_config('app.leaderboard_write', 'off', true);
select is(pg_temp.run('authenticated', 'select public.mark_leaderboard_notice_seen()'), 'ok', 'marking again');
select is(pg_temp.seen(1), (timestamptz '2026-01-01 10:00+00')::text, 'does not move the stamp (idempotent)');
select is(pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(true)'), 'ok', 'hiding after seeing the notice');
select is(pg_temp.hid(1) || ',' || pg_temp.seen(1), 'true,' || (timestamptz '2026-01-01 10:00+00')::text, 'changes the hidden flag and leaves the stamp alone');

-- One notice per gym: a member of two gyms
select pg_temp.claims(12, 1, 'member');
select is(pg_temp.run('authenticated', 'select public.mark_leaderboard_notice_seen()'), 'ok', 'a member of two gyms marks the notice in gym A');
select is(pg_temp.seen(12) <> 'null' and pg_temp.seen(13) = 'null', true, 'gym A''s row has the stamp and gym B''s row still has not (the notice is once per gym)');
select pg_temp.claims(12, 2, 'member');
select is(pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(true)'), 'ok', 'the same user hides in gym B');
select is(pg_temp.hid(12) || ',' || pg_temp.hid(13), 'false,true', 'only gym B''s row is hidden');

-- ============================================================================
-- The caller matrix: both writers refused, nothing written
-- ============================================================================
create temp table prefs_base as select * from member_preferences;
create function pg_temp.writers(p_n int, p_gym int, p_app_role text) returns text language plpgsql as $f$
begin
  perform pg_temp.claims(p_n, p_gym, p_app_role);
  return pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(true)') || '|' || pg_temp.run('authenticated', 'select public.mark_leaderboard_notice_seen()');
end $f$;
select is(pg_temp.writers(3, 1, 'owner'), '42501:permission denied|42501:permission denied', 'an Owner is refused');
select is(pg_temp.writers(4, 1, 'manager'), '42501:permission denied|42501:permission denied', 'a Manager is refused');
select is(pg_temp.writers(5, 1, 'supervisor'), '42501:permission denied|42501:permission denied', 'a Supervisor is refused');
select is(pg_temp.writers(6, 1, 'receptionist'), '42501:permission denied|42501:permission denied', 'a Receptionist is refused');
select is(pg_temp.writers(7, 1, 'coach'), '42501:permission denied|42501:permission denied', 'a Coach is refused');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(2, 11), 'role', 'authenticated', 'aal', 'aal2', 'session_id', pg_temp.id(8, 1), 'app_role', 'support', 'gym_id', pg_temp.id(1, 1))::text, true);
select is(pg_temp.run('authenticated', 'select public.set_leaderboard_visibility(true)') || '|' || pg_temp.run('authenticated', 'select public.mark_leaderboard_notice_seen()'), '42501:permission denied|42501:permission denied', 'a GymOS Support session is refused');
select is(pg_temp.writers(8, 1, 'member'), '42501:permission denied|42501:permission denied', 'a deactivated member whose token still says member is refused');
select is(pg_temp.writers(10, 3, 'member'),
  '42501:permission denied: gym ' || pg_temp.id(1, 3) || ' is not active|42501:permission denied: gym ' || pg_temp.id(1, 3) || ' is not active', 'a member of a suspended gym is refused, with the phrase isGymSuspendedError reads');
select is(pg_temp.writers(3, 1, 'member'), '42501:permission denied|42501:permission denied', 'an Owner holding a forged member claim is refused (the role is read live)');
select is(pg_temp.writers(9, 1, 'member'), '42501:permission denied|42501:permission denied', 'a member of gym B naming gym A is refused');
select is(pg_temp.writers(1, 0, 'member'), '42501:permission denied|42501:permission denied', 'a member with no gym claim is refused');
select is(pg_temp.writers(40, 1, 'member'), '42501:permission denied|42501:permission denied', 'a user with no members row is refused');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.run('anon', 'select public.set_leaderboard_visibility(true)') || '|' || pg_temp.run('anon', 'select public.mark_leaderboard_notice_seen()'),
  '42501:permission denied for function set_leaderboard_visibility|42501:permission denied for function mark_leaderboard_notice_seen', 'anon is refused at the privilege');
select is(pg_temp.run('service_role', 'select public.set_leaderboard_visibility(true)'), '42501:permission denied for function set_leaderboard_visibility', 'service_role is refused (authenticated only)');
select is((select count(*)::int from (select * from member_preferences except select * from prefs_base) d) + (select count(*)::int from (select * from prefs_base except select * from member_preferences) d), 0, 'no preferences row changed for anyone through any refused call');

-- ============================================================================
-- Privileges and source scans
-- ============================================================================
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.set_leaderboard_visibility(boolean)', 'execute')), array['authenticated'], 'set_leaderboard_visibility: EXECUTE for authenticated only');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.mark_leaderboard_notice_seen()', 'execute')), array['authenticated'], 'mark_leaderboard_notice_seen: EXECUTE for authenticated only');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.my_leaderboard_settings()', 'execute')), array['authenticated'], 'my_leaderboard_settings: EXECUTE for authenticated only');
select ok(not has_function_privilege('public', 'public.set_leaderboard_visibility(boolean)', 'execute') and not has_function_privilege('public', 'public.mark_leaderboard_notice_seen()', 'execute') and not has_function_privilege('public', 'public.my_leaderboard_settings()', 'execute'), 'and PUBLIC is revoked on all');
select is((select count(*)::int from pg_proc p where p.oid in ('public.set_leaderboard_visibility(boolean)'::regprocedure, 'public.mark_leaderboard_notice_seen()'::regprocedure)
            and p.prosrc like '%private.current_gym_status() is distinct from ''active''%' and p.prosrc like '%is not active%'), 2, 'both writers carry the exact suspension guard text and the "is not active" message');
select is((select count(*)::int from pg_proc p where p.oid in ('public.set_leaderboard_visibility(boolean)'::regprocedure, 'public.mark_leaderboard_notice_seen()'::regprocedure)
            and position('current_gym_status' in p.prosrc) < position('member_preferences' in p.prosrc)), 2, 'in both, the guard comes before the first write');
select is((select count(*)::int from pg_proc p where p.oid in ('public.set_leaderboard_visibility(boolean)'::regprocedure, 'public.mark_leaderboard_notice_seen()'::regprocedure, 'public.my_leaderboard_settings()'::regprocedure, 'public.gym_leaderboard(date)'::regprocedure)
            and (p.prosrc ~* 'supervisor' or p.prosrc ~* 'support_rpc_')), 0, 'no body names supervisor or support_rpc_');
select is((select count(*)::int from pg_proc p where p.oid in ('public.set_leaderboard_visibility(boolean)'::regprocedure, 'public.mark_leaderboard_notice_seen()'::regprocedure, 'public.my_leaderboard_settings()'::regprocedure, 'public.gym_leaderboard(date)'::regprocedure) and p.prosecdef and p.proconfig = array['search_path=public']), 4, 'all four are SECURITY DEFINER with a pinned search_path');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'leaderboard'), 0, 'nothing is registered in private.support_capabilities');
select is((select count(*)::int from private.support_capabilities), 50, 'and the allow-list still holds its 50 objects');
select is((select count(*)::int from pg_proc p where p.oid = 'private.protect_self_managed_member_preferences_columns()'::regprocedure and p.prosrc like '%leaderboard_columns_write_protected%' and p.prosrc like '%app.leaderboard_write%' and p.prosrc like '%new.gym_id := old.gym_id%'), 1, 'the trigger function keeps its pins and holds the new refusal');

select * from finish();
rollback;
