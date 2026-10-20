-- Epic 22 retro item 65 (22-7 deferral): how private.session_gate_touch scopes who and what it acts on.
--   * a caller who is not a Super Admin is decided by authorize_action, not by the session limits: ok, and no state is written;
--   * a session id that belongs to another user is not honoured: session_expired, and no state is written for the caller.
begin;
select plan(6);

update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000023801'), -- Super Admin A
  ('00000000-0000-0000-0000-000000023802'), -- Super Admin B
  ('00000000-0000-0000-0000-000000023803'); -- ordinary user
update users set is_super_admin = true where id in ('00000000-0000-0000-0000-000000023801', '00000000-0000-0000-0000-000000023802');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000238a1', '00000000-0000-0000-0000-000000023801', now(), now()),
  ('00000000-0000-0000-0000-0000000238a2', '00000000-0000-0000-0000-000000023802', now(), now()),
  ('00000000-0000-0000-0000-0000000238a3', '00000000-0000-0000-0000-000000023803', now(), now());

-- ---- a non-Super-Admin caller --------------------------------------------------------------------------------------------
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000023803', '00000000-0000-0000-0000-0000000238a3')),
  'true:ok', 'a caller who is not a Super Admin passes the gate (authorize_action decides their access)');
select is((select count(*)::int from private.support_session_state where user_id = '00000000-0000-0000-0000-000000023803'), 0,
  'and the gate writes no session state for them');
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000023803', gen_random_uuid())),
  'true:ok', 'even with a session id that does not exist, a non-Super-Admin is not held to the session limits');

-- ---- a session id that belongs to another user ----------------------------------------------------------------------------
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000023801', '00000000-0000-0000-0000-0000000238a2')),
  'false:session_expired', 'a Super Admin presenting another user''s session id is refused as session_expired');
select is((select count(*)::int from private.support_session_state where user_id = '00000000-0000-0000-0000-000000023801'), 0,
  'and no session state is written for the caller');

-- ---- control: the same Super Admin with their own session ---------------------------------------------------------------------
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000023801', '00000000-0000-0000-0000-0000000238a1')),
  'true:ok', 'control: their own live session passes');

select * from finish();
rollback;
