-- Story 22.7: Super Admin session limits, step-up and wrong-code lockout (migration 0127).
begin;
select plan(62);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000022701');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000022701';
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000227a1', '00000000-0000-0000-0000-000000022701', now(), now());

-- ---- config table is the single source of the limits -------------------------------------------
select is((select count(*)::int from private.session_limits_config
            where key in ('absolute_session_minutes','idle_minutes','stepup_ttl_minutes','stepup_failure_threshold')),
          4, 'limits live in session_limits_config');
select is(private.session_limit('idle_minutes'), 30, 'idle default 30');
select is(private.session_limit('absolute_session_minutes'), 480, 'absolute default 480');
select is(private.session_limit('stepup_ttl_minutes'), 5, 'step-up ttl default 5');

-- ---- flag off: nothing written, no limits ------------------------------------------------------
update private.platform_flags set enabled = false where flag = 'super_admin_aal2';
select is((select ok from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a1')),
          true, 'flag off: touch ok');
select is((select count(*)::int from private.support_session_state), 0, 'flag off: no session state written');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'x@y.z'), true,
          'flag off: step-up not required');
select is((select count(*)::int from private.support_stepup), 0, 'flag off: no step-up row written');
select is(private.stepup_issue('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'x@y.z'), null,
          'flag off: issue is a no-op');

-- ---- flag on: active session -------------------------------------------------------------------
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
select is((select ok from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a1')),
          true, 'active session passes');
select is((select count(*)::int from private.support_session_state where session_id = '00000000-0000-0000-0000-0000000227a1'),
          1, 'first touch records state');
update private.support_session_state set last_seen_at = now() - interval '10 minutes';
select private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a1');
select ok((select last_seen_at > now() - interval '1 minute' from private.support_session_state), 'touch updates last_seen_at');

-- ---- idle ----------------------------------------------------------------------------------------
update private.support_session_state set last_seen_at = now() - interval '31 minutes';
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a1')),
          'session_expired', 'idle over 30 min is denied');
select is((select count(*)::int from auth.sessions where id = '00000000-0000-0000-0000-0000000227a1'), 0, 'idle: auth session deleted');
select is((select count(*)::int from private.support_session_state), 0, 'idle: state deleted');

-- ---- too old (and the gate reads the limit from the table) ------------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000227a2', '00000000-0000-0000-0000-000000022701', now() - interval '9 hours', now());
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a2')),
          'session_expired', 'older than 8 h is denied');

insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000227a3', '00000000-0000-0000-0000-000000022701', now() - interval '2 hours', now());
select is((select ok from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a3')),
          true, '2 h old session passes under the default limit');
update private.session_limits_config set value = 60 where key = 'absolute_session_minutes';
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a3')),
          'session_expired', 'lowering the configured limit changes the decision (gate reads the table)');
update private.session_limits_config set value = 480 where key = 'absolute_session_minutes';

-- unknown session id is denied
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000022701', gen_random_uuid())),
          'session_expired', 'unknown session denied');

-- ---- helpers require the session row while the flag is on -----------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000227a4', '00000000-0000-0000-0000-000000022701', now(), now());
create or replace function pg_temp.claims(sid text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000022701","role":"authenticated","app_role":"super_admin","aal":"aal2"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end || '}', true);
end $f$;
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-0000000227a4');
select is(private.is_super_admin(), true, 'flag on, aal2, live session: true');
select is(private.is_super_admin_live(), true, 'flag on, aal2, live session: live true');
select pg_temp.claims(null);
select is(private.is_super_admin(), false, 'flag on, no session_id claim: false');
select pg_temp.claims('00000000-0000-0000-0000-0000000227ff');
select is(private.is_super_admin_live(), false, 'flag on, session_id not in auth.sessions: false');
reset role;

-- ---- step-up -------------------------------------------------------------------------------------------
select ok(private.stepup_issue('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'a@b.c') is not null,
          'issue returns an expiry');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'remove_super_admin_factor', 'a@b.c'), false,
          'other action refused');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'other@b.c'), false,
          'other subject refused');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022702', 'create_super_admin', 'a@b.c'), false,
          'other user refused');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'a@b.c'), true,
          'bound action and subject consumes once');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'a@b.c'), false,
          'reuse refused');
select private.stepup_issue('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'old@b.c');
update private.support_stepup set expires_at = now() - interval '1 second' where subject_id = 'old@b.c';
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'old@b.c'), false,
          'expired refused');
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000022701', 'billing.retry', 'x')$$,
                 '42501', 'permission_denied', 'unlisted action cannot be issued');

-- re-issue replaces the live grant: two issues give one use
select private.stepup_issue('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'dup@b.c');
select private.stepup_issue('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'dup@b.c');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'dup@b.c'), true,
          'double issue: first consume succeeds');
select is(private.stepup_consume('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'dup@b.c'), false,
          'double issue: second consume refused (one use)');

-- ---- a successful step-up clears the wrong-code counter (separate user) --------------------------------
insert into auth.users (id) values ('00000000-0000-0000-0000-000000022702');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000022702';
select private.stepup_record_failure('00000000-0000-0000-0000-000000022702');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022702');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022702');
select private.stepup_issue('00000000-0000-0000-0000-000000022702', 'create_super_admin', 'reset@b.c');
select is((select failed_count from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-000000022702'),
          0, 'successful issue zeroes failed_count');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022702');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022702');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022702');
select is((select locked from private.stepup_record_failure('00000000-0000-0000-0000-000000022702')), false,
          'counter restarted after a successful step-up: 4 more failures do not lock');

-- ---- lockout ---------------------------------------------------------------------------------------------
select private.stepup_record_failure('00000000-0000-0000-0000-000000022701');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022701');
select private.stepup_record_failure('00000000-0000-0000-0000-000000022701');
select is((select locked from private.stepup_record_failure('00000000-0000-0000-0000-000000022701')), false, 'below threshold: not locked');
select is((select locked from private.stepup_record_failure('00000000-0000-0000-0000-000000022701')), true, 'threshold: locked, returned as a row');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000022701'), 0, 'lock removes sessions');
select is(private.super_admin_locked('00000000-0000-0000-0000-000000022701'), true, 'account locked');
select is((select count(*)::int from audit_log where action_type = 'super_admin_stepup_failed'
            and target_entity_id = '00000000-0000-0000-0000-000000022701'
            and metadata ?& array['attempts','threshold'] and not (metadata ? 'code')), 5, 'attempts audited with counts only');
select is((select count(*)::int from audit_log where action_type = 'super_admin_locked'
            and target_entity_id = '00000000-0000-0000-0000-000000022701'), 1, 'lock audited');

-- a locked account fails the helpers even with a live session and aal2
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000227a5', '00000000-0000-0000-0000-000000022701', now(), now());
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-0000000227a5');
select is(private.is_super_admin(), false, 'locked, live session, aal2: is_super_admin false');
select is(private.is_super_admin_live(), false, 'locked, live session, aal2: live false');
reset role;

-- the gate itself refuses a locked account and removes its session and state
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000227a5', '00000000-0000-0000-0000-000000022701', now(), now());
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000022701', '00000000-0000-0000-0000-0000000227a5')),
          'locked', 'locked account: gate returns locked');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000022701'), 0,
          'locked account: gate removed the session');
select is((select count(*)::int from private.support_session_state where user_id = '00000000-0000-0000-0000-000000022701'), 0,
          'locked account: gate removed the session state');
select is(private.stepup_issue('00000000-0000-0000-0000-000000022701', 'create_super_admin', 'locked@b.c'), null,
          'locked account: step-up issue refused');

-- privileges: no anon or authenticated EXECUTE on any gate / step-up function
select is(has_function_privilege('anon', 'public.session_gate_touch(uuid,uuid)', 'EXECUTE'), false, 'anon cannot execute public.session_gate_touch(uuid,uuid)');
select is(has_function_privilege('authenticated', 'public.session_gate_touch(uuid,uuid)', 'EXECUTE'), false, 'authenticated cannot execute public.session_gate_touch(uuid,uuid)');
select is(has_function_privilege('anon', 'public.stepup_issue(uuid,text,text)', 'EXECUTE'), false, 'anon cannot execute public.stepup_issue(uuid,text,text)');
select is(has_function_privilege('authenticated', 'public.stepup_issue(uuid,text,text)', 'EXECUTE'), false, 'authenticated cannot execute public.stepup_issue(uuid,text,text)');
select is(has_function_privilege('anon', 'public.stepup_consume(uuid,text,text)', 'EXECUTE'), false, 'anon cannot execute public.stepup_consume(uuid,text,text)');
select is(has_function_privilege('authenticated', 'public.stepup_consume(uuid,text,text)', 'EXECUTE'), false, 'authenticated cannot execute public.stepup_consume(uuid,text,text)');
select is(has_function_privilege('anon', 'public.stepup_record_failure(uuid)', 'EXECUTE'), false, 'anon cannot execute public.stepup_record_failure(uuid)');
select is(has_function_privilege('authenticated', 'public.stepup_record_failure(uuid)', 'EXECUTE'), false, 'authenticated cannot execute public.stepup_record_failure(uuid)');
select is(has_function_privilege('anon', 'private.stepup_issue(uuid,text,text)', 'EXECUTE'), false, 'anon cannot execute private.stepup_issue(uuid,text,text)');
select is(has_function_privilege('authenticated', 'private.stepup_issue(uuid,text,text)', 'EXECUTE'), false, 'authenticated cannot execute private.stepup_issue(uuid,text,text)');
select is(has_function_privilege('anon', 'private.stepup_record_failure(uuid)', 'EXECUTE'), false, 'anon cannot execute private.stepup_record_failure(uuid)');
select is(has_function_privilege('authenticated', 'private.stepup_record_failure(uuid)', 'EXECUTE'), false, 'authenticated cannot execute private.stepup_record_failure(uuid)');
select is(has_function_privilege('anon', 'private.end_user_sessions(uuid)', 'EXECUTE'), false, 'anon cannot execute private.end_user_sessions(uuid)');
select is(has_function_privilege('authenticated', 'private.end_user_sessions(uuid)', 'EXECUTE'), false, 'authenticated cannot execute private.end_user_sessions(uuid)');

select is(has_function_privilege('authenticated', 'private.super_admin_locked(uuid)', 'EXECUTE'), false, 'authenticated cannot execute private.super_admin_locked(uuid)');

select * from finish();
rollback;
