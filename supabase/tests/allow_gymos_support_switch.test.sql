-- Story 23.3: Allow GymOS Support switch and status read (migration 0137).
begin;
select plan(39);

create or replace function pg_temp.claims(uid text, gym text, app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated"'
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end || '}', true);
end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000233301', 'Switch Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000233001', 'Switch Gym', '00000000-0000-0000-0000-000000233301', 30),
  ('00000000-0000-0000-0000-000000233002', 'Other Gym', '00000000-0000-0000-0000-000000233301', 30);
insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-000000233003', 'Suspended Gym', '00000000-0000-0000-0000-000000233301', 30, 'suspended');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000233101', 'sup1-233@x.example'),
  ('00000000-0000-0000-0000-000000233102', 'owner-233@x.example'),
  ('00000000-0000-0000-0000-000000233103', 'sv-233@x.example'),
  ('00000000-0000-0000-0000-000000233104', 'sup2-233@x.example'),
  ('00000000-0000-0000-0000-000000233105', 'mgr-233@x.example'),
  ('00000000-0000-0000-0000-000000233106', 'owner2-233@x.example'),
  ('00000000-0000-0000-0000-000000233107', 'admin-233@x.example'),
  ('00000000-0000-0000-0000-000000233108', 'sup3-233@x.example'),
  ('00000000-0000-0000-0000-000000233109', 'owner3-233@x.example');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000233107';
insert into members (gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000233001', '00000000-0000-0000-0000-000000233102', 'owner', 'Owner 233'),
  ('00000000-0000-0000-0000-000000233001', '00000000-0000-0000-0000-000000233103', 'supervisor', 'Supervisor 233'),
  ('00000000-0000-0000-0000-000000233001', '00000000-0000-0000-0000-000000233105', 'manager', 'Manager 233'),
  ('00000000-0000-0000-0000-000000233002', '00000000-0000-0000-0000-000000233106', 'owner', 'Owner Two 233'),
  ('00000000-0000-0000-0000-000000233003', '00000000-0000-0000-0000-000000233109', 'owner', 'Owner Susp 233');

-- the switch is on for the fixture gym (setting the guarded column needs the GUC, as only the setter has it)
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id in ('00000000-0000-0000-0000-000000233001', '00000000-0000-0000-0000-000000233003');
select set_config('gymos.allow_support_setter', 'off', true);

insert into private.support_accounts (user_id, activated_at) values
  ('00000000-0000-0000-0000-000000233101', now()), ('00000000-0000-0000-0000-000000233104', now()), ('00000000-0000-0000-0000-000000233108', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000233401', '00000000-0000-0000-0000-000000233101', '00000000-0000-0000-0000-000000233001', 'active', now()),
  ('00000000-0000-0000-0000-000000233402', '00000000-0000-0000-0000-000000233104', '00000000-0000-0000-0000-000000233001', 'pending', null),
  ('00000000-0000-0000-0000-000000233404', '00000000-0000-0000-0000-000000233108', '00000000-0000-0000-0000-000000233001', 'suspended', now());
select private.support_set_membership('00000000-0000-0000-0000-000000233401', true);

-- ---- schema shape and ACLs --------------------------------------------------------------------------------------
select has_column('public', 'support_assignments', 'suspended_by_switch', 'suspended_by_switch exists');
select is(has_function_privilege('anon', 'public.set_allow_gymos_support(uuid, boolean)', 'execute'), false, 'setter: not callable by anon');
select is(has_function_privilege('authenticated', 'public.set_allow_gymos_support(uuid, boolean)', 'execute'), true, 'setter: callable by authenticated');
select is(has_function_privilege('anon', 'public.get_gymos_support_status(uuid)', 'execute'), false, 'status: not callable by anon');
select is(has_function_privilege('authenticated', 'private.support_gym_lock(uuid)', 'execute'), false, 'lock helper: not callable by authenticated');

-- ---- refusals ---------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000233103', '00000000-0000-0000-0000-000000233001', 'supervisor');
select throws_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'P0001', 'permission denied', 'supervisor refused');
select throws_ok($$select * from get_gymos_support_status('00000000-0000-0000-0000-000000233001')$$, 'P0001', 'permission denied', 'supervisor: status refused');
select pg_temp.claims('00000000-0000-0000-0000-000000233105', '00000000-0000-0000-0000-000000233001', 'manager');
select throws_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'P0001', 'permission denied', 'manager refused');
select pg_temp.claims('00000000-0000-0000-0000-000000233101', '00000000-0000-0000-0000-000000233001', 'support');
select throws_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'P0001', 'permission denied', 'support refused');
select pg_temp.claims('00000000-0000-0000-0000-000000233107', null, 'super_admin');
select throws_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'P0001', 'permission denied', 'super admin refused');
select pg_temp.claims('00000000-0000-0000-0000-000000233106', '00000000-0000-0000-0000-000000233002', 'owner');
select throws_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'P0001', 'permission denied', 'other gym''s owner refused');
select pg_temp.claims('00000000-0000-0000-0000-000000233109', '00000000-0000-0000-0000-000000233003', 'owner');
select throws_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233003', false)$$, 'P0001', 'set_allow_gymos_support: gym 00000000-0000-0000-0000-000000233003 is not active', 'suspended gym refused');
reset role;
select is((select allow_gymos_support from gyms where id = '00000000-0000-0000-0000-000000233001'), true, 'refusals wrote nothing');
select is((select count(*)::int from audit_log where action_type = 'allow_gymos_support_changed'), 0, 'refusals logged nothing');

-- ---- direct write refused by the 23-1 guard --------------------------------------------------------------------
select throws_ok($$update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-000000233001'$$, 'P0001', 'allow_gymos_support: only the audited setter may change this column', 'direct update refused');

-- ---- status readout ---------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000233102', '00000000-0000-0000-0000-000000233001', 'owner');
select is((select state from get_gymos_support_status('00000000-0000-0000-0000-000000233001')), 'assigned', 'status: on, assigned');
select is((select last_acted_at from get_gymos_support_status('00000000-0000-0000-0000-000000233001')), null, 'status: no session yet -> null');
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-0000000233a1', '00000000-0000-0000-0000-000000233101', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000233a1', '00000000-0000-0000-0000-000000233101', now() - interval '1 hour', now() - interval '5 minutes');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000233102', '00000000-0000-0000-0000-000000233001', 'owner');
select ok((select last_acted_at from get_gymos_support_status('00000000-0000-0000-0000-000000233001')) is not null, 'status: last acted from session activity');

-- a non-owner staff role can read the switch value of its own gym (the staff row)
select pg_temp.claims('00000000-0000-0000-0000-000000233103', '00000000-0000-0000-0000-000000233001', 'supervisor');
select is((select allow_gymos_support from gyms where id = '00000000-0000-0000-0000-000000233001'), true, 'supervisor can read allow_gymos_support of its own gym');
select pg_temp.claims('00000000-0000-0000-0000-000000233102', '00000000-0000-0000-0000-000000233001', 'owner');

-- ---- owner turns off --------------------------------------------------------------------------------------------
select lives_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'owner turns off');
select ok(exists (select 1 from pg_locks l, (select hashtextextended('gymos_support_gym:' || '00000000-0000-0000-0000-000000233001', 0) as k) h
             where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
               and l.classid::bigint = ((h.k >> 32) & 4294967295) and l.objid::bigint = (h.k & 4294967295)),
          'setter holds the per-gym advisory lock for this gym');
select is((select state from get_gymos_support_status('00000000-0000-0000-0000-000000233001')), 'off', 'status: off');
reset role;
select is((select allow_gymos_support from gyms where id = '00000000-0000-0000-0000-000000233001'), false, 'column false');
select is((select state || ':' || suspended_by_switch from support_assignments where id = '00000000-0000-0000-0000-000000233401'), 'suspended:true', 'active -> suspended with marker');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000233101' and role = 'support' and deactivated_at is null), 0, 'support membership deactivated');
select is((select state || ':' || suspended_by_switch from support_assignments where id = '00000000-0000-0000-0000-000000233402'), 'pending:false', 'pending untouched');
select is((select state || ':' || suspended_by_switch from support_assignments where id = '00000000-0000-0000-0000-000000233404'), 'suspended:false', 'other suspended untouched');
select is((select count(*)::int from audit_log where action_type = 'allow_gymos_support_changed' and gym_id = '00000000-0000-0000-0000-000000233001'
            and metadata = '{"old": true, "new": false}'::jsonb), 1, 'one audit row with old and new');
-- updated_at: back-date it with triggers off, then update with the trigger on; now() is constant in this transaction, so comparing to created_at proves nothing
set local session_replication_role = replica;
update support_assignments set updated_at = '2000-01-01' where id = '00000000-0000-0000-0000-000000233402';
set local session_replication_role = origin;
update support_assignments set suspended_by_switch = false where id = '00000000-0000-0000-0000-000000233402';
select ok((select updated_at from support_assignments where id = '00000000-0000-0000-0000-000000233402') > '2000-01-01', 'updated_at maintained by the trigger');

-- no change: no write, no audit
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000233102', '00000000-0000-0000-0000-000000233001', 'owner');
select lives_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', false)$$, 'same value is a no-op');
reset role;
select is((select count(*)::int from audit_log where action_type = 'allow_gymos_support_changed'), 1, 'no-op logged nothing');

-- a pending one created while off stays pending on re-enable
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000233109', now());
insert into public.support_assignments (id, support_user_id, gym_id, state) values
  ('00000000-0000-0000-0000-000000233403', '00000000-0000-0000-0000-000000233109', '00000000-0000-0000-0000-000000233001', 'pending');

-- ---- owner turns on ---------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000233102', '00000000-0000-0000-0000-000000233001', 'owner');
select lives_ok($$select set_allow_gymos_support('00000000-0000-0000-0000-000000233001', true)$$, 'owner turns on');
reset role;
select is((select count(*)::int from audit_log where action_type = 'allow_gymos_support_changed' and gym_id = '00000000-0000-0000-0000-000000233001'
            and metadata = '{"old": false, "new": true}'::jsonb), 1, 'one audit row for the switch-on');
select is((select state || ':' || suspended_by_switch from support_assignments where id = '00000000-0000-0000-0000-000000233401'), 'active:false', 'marked one restored, marker cleared');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000233101' and role = 'support' and deactivated_at is null), 1, 'support membership restored');
select is((select count(*)::int from support_assignments where gym_id = '00000000-0000-0000-0000-000000233001' and state = 'pending'), 2, 'both pending stay pending');
select is((select state from support_assignments where id = '00000000-0000-0000-0000-000000233404'), 'suspended', 'unmarked suspended stays suspended');

-- ---- writer scan (retro 66) ------------------------------------------------------------------------------------
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* 'update\s+(only\s+)?(public\.)?gyms(\s+(as\s+)?\w+)?\s+set[^;]*allow_gymos_support'),
          array['set_allow_gymos_support'], 'only the setter updates allow_gymos_support');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ilike '%allow_support_setter%'),
          array['guard_allow_gymos_support', 'set_allow_gymos_support'], 'only the guard and the setter name the setter GUC');

select * from finish();
rollback;
