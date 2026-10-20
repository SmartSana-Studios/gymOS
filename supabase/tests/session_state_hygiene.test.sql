-- Migration 0133 (Epic 22 retro items 81 and 83): the session gate cannot wipe another user's state, and a nightly job removes
-- gate-state rows whose session has ended.
begin;
select plan(10);

update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000023901'), -- Super Admin A
  ('00000000-0000-0000-0000-000000023902'); -- Super Admin B
update users set is_super_admin = true where id in ('00000000-0000-0000-0000-000000023901', '00000000-0000-0000-0000-000000023902');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000239a1', '00000000-0000-0000-0000-000000023901', now(), now()),
  ('00000000-0000-0000-0000-0000000239a2', '00000000-0000-0000-0000-000000023902', now(), now());

-- ---- 83: presenting someone else's session id must not touch their state ---------------------------------------------------
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000023902', '00000000-0000-0000-0000-0000000239a2')),
  'true:ok', 'B''s own session passes the gate and records its state');
create temp table before_state as
  select started_at from private.support_session_state where session_id = '00000000-0000-0000-0000-0000000239a2';
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000023901', '00000000-0000-0000-0000-0000000239a2')),
  'false:session_expired', 'A presenting B''s session id is refused as session_expired');
select is((select count(*)::int from private.support_session_state where session_id = '00000000-0000-0000-0000-0000000239a2'), 1,
  'and B''s gate state is NOT deleted by A''s call');
select is((select s.started_at = b.started_at from private.support_session_state s, before_state b where s.session_id = '00000000-0000-0000-0000-0000000239a2'),
  true, 'B''s timers are unchanged');

-- ---- 81: the purge removes state for sessions that no longer exist --------------------------------------------------------
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000239b1', '00000000-0000-0000-0000-000000023901', now(), now()),   -- session ended
       ('00000000-0000-0000-0000-0000000239b2', '00000000-0000-0000-0000-000000023902', now(), now());   -- session ended
create temp table orphans as
  select count(*)::int as n from private.support_session_state s where not exists (select 1 from auth.sessions a where a.id = s.session_id);
select ok((select n from orphans) >= 2, 'precondition: at least the two rows we added are orphans');
select is(private.support_session_state_purge(), (select n from orphans), 'the purge returns how many rows it removed');
select is((select count(*)::int from private.support_session_state s where not exists (select 1 from auth.sessions a where a.id = s.session_id)), 0,
  'and no orphan is left');
select is((select count(*)::int from private.support_session_state where session_id = '00000000-0000-0000-0000-0000000239a2'), 1,
  'a row whose session is still alive is kept');
select is(private.support_session_state_purge(), 0, 'a second run removes nothing');

-- ---- scheduled, and not client-callable -----------------------------------------------------------------------------------------
select ok(exists (select 1 from cron.job where jobname = 'support_session_state_purge' and schedule = '15 3 * * *')
      and not has_function_privilege('anon', 'private.support_session_state_purge()', 'execute')
      and not has_function_privilege('authenticated', 'private.support_session_state_purge()', 'execute')
      and has_function_privilege('service_role', 'private.support_session_state_purge()', 'execute'),
  'the purge is scheduled daily at 03:15 UTC and is service_role only');

select * from finish();
rollback;
