-- Story 24.5: gym page content fields and public plans (migration 0161).
-- Fixture ids: 00000000-0000-0000-0000-0000002405xx.
begin;
select plan(111);

create or replace function pg_temp.claims(uid text, app_role text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
-- 'ok' or 'sqlstate:message'
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.rows(stmt text) returns text language plpgsql as $f$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n::text; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.as_user(uid text, role_ text, gym text) returns void language sql as $f$
  select pg_temp.claims(uid, role_, gym) $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000240501', 'Page Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000240511', 'Page Gym A', '00000000-0000-0000-0000-000000240501'),
  ('00000000-0000-0000-0000-000000240512', 'Page Gym B', '00000000-0000-0000-0000-000000240501');
insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000240513', 'Page Gym Suspended', '00000000-0000-0000-0000-000000240501', 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000240521', 'owner-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240522', 'supervisor-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240523', 'manager-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240524', 'coach-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240525', 'member-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240526', 'ownerB-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240527', 'ownerS-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240528', 'admin-2405@x.example', now()),
  ('00000000-0000-0000-0000-000000240529', 'sup-2405@gymosapps.com', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000240528';
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000240531', '00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-000000240521', 'owner',      'PG Owner A',      '+237600240001', current_date),
  ('00000000-0000-0000-0000-000000240532', '00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-000000240522', 'supervisor', 'PG Supervisor A', '+237600240002', current_date),
  ('00000000-0000-0000-0000-000000240533', '00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-000000240523', 'manager',    'PG Manager A',    '+237600240003', current_date),
  ('00000000-0000-0000-0000-000000240534', '00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-000000240524', 'coach',      'PG Coach A',      '+237600240004', current_date),
  ('00000000-0000-0000-0000-000000240535', '00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-000000240525', 'member',     'PG Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000240536', '00000000-0000-0000-0000-000000240512', '00000000-0000-0000-0000-000000240526', 'owner',      'PG Owner B',      '+237600240006', current_date),
  ('00000000-0000-0000-0000-000000240537', '00000000-0000-0000-0000-000000240513', '00000000-0000-0000-0000-000000240527', 'owner',      'PG Owner S',      '+237600240007', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000240541', '00000000-0000-0000-0000-000000240511', 'PG Monthly',     'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000240542', '00000000-0000-0000-0000-000000240511', 'PG Per Session', 'pay_per_session', 2000, 'monthly', null),
  ('00000000-0000-0000-0000-000000240543', '00000000-0000-0000-0000-000000240512', 'PG Gym B Plan',  'monthly', 7000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000240544', '00000000-0000-0000-0000-000000240513', 'PG Suspended Plan', 'monthly', 7000, 'monthly', 30);

-- support: live and assigned to gym A
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000240529', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240551', '00000000-0000-0000-0000-000000240529', '00000000-0000-0000-0000-000000240511', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000240a1', '00000000-0000-0000-0000-000000240529', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000240a1', '00000000-0000-0000-0000-000000240529', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000240551', true);

-- ---- defaults: empty page, private plans -------------------------------------------------------------------------
select is((select count(*)::int from gyms where id in ('00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-000000240512')
            and page_about_en is null and page_about_fr is null and page_services_en is null and page_services_fr is null
            and page_address is null and page_lat is null and page_lng is null and page_hours is null
            and page_contact_phone is null and page_contact_whatsapp is null and page_city is null), 2,
          'every gym page field is null by default');
select is((select count(*)::int from plans where is_public or public_label_en is not null or public_label_fr is not null), 0,
          'every plan is private with no public label by default');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'gyms'
            and column_name like 'page\_%' and is_nullable = 'NO'), 0, 'all new gyms columns are nullable');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'is_public'),
          'false', 'plans.is_public defaults to false');

-- ---- catalog -----------------------------------------------------------------------------------------------------
select is((select count(*)::int from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'set_gym_page_content'), 1,
          'the capability row exists');
select is(has_function_privilege('anon', 'public.set_gym_page_content(uuid, jsonb, jsonb)', 'execute'), false, 'anon cannot execute the setter');
select is(has_function_privilege('authenticated', 'public.set_gym_page_content(uuid, jsonb, jsonb)', 'execute'), true, 'authenticated can execute the setter');
select is((select prosecdef from pg_proc where proname = 'set_gym_page_content'), true, 'the setter is security definer');
select is((select proconfig from pg_proc where proname = 'set_gym_page_content'), array['search_path=public'], 'the setter pins search_path');

-- ---- consumers: the roles that may call the setter, enumerated ---------------------------------------------------
-- A new role admitted to the setter without the check fails here: the body must name exactly owner and supervisor.
select is((select (regexp_match(prosrc, 'support_rpc_role\(''set_gym_page_content''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'set_gym_page_content'),
          '''owner'', ''supervisor''', 'the setter admits exactly owner and supervisor (plus super admin and live support at the supervisor ceiling)');
select is((select count(*)::int from pg_proc where proname = 'set_gym_page_content' and prosrc like '%is_super_admin_live%' and prosrc like '%support_rpc_gym_id(''set_gym_page_content'')%'), 1,
          'the setter resolves the gym through the support helpers and the live super admin check');

-- ---- Owner saves content -----------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511',
  '{"about_en":"  We are a gym.  ","about_fr":"Nous sommes une salle.","address":"Rue 1, Douala","lat":4.0511,"lng":9.7679,
    "hours":{"mon":{"open":"06:00","close":"22:00"},"sun":null},"contact_phone":"+237600111222","contact_whatsapp":"+237600111223","city":"Douala"}'::jsonb,
  '[{"plan_id":"00000000-0000-0000-0000-000000240541","is_public":true,"public_label_en":"Monthly"},
    {"plan_id":"00000000-0000-0000-0000-000000240542","is_public":true}]'::jsonb)$$), 'ok', 'owner saves content and two public plans');
reset role;
select is((select page_about_en from gyms where id = '00000000-0000-0000-0000-000000240511'), 'We are a gym.', 'text is trimmed and stored');
select is((select page_lat::text || ',' || page_lng::text from gyms where id = '00000000-0000-0000-0000-000000240511'), '4.051100,9.767900', 'position stored');
select is((select page_hours from gyms where id = '00000000-0000-0000-0000-000000240511'), '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb, 'hours stored');
select is((select count(*)::int from plans where gym_id = '00000000-0000-0000-0000-000000240511' and is_public), 2, 'both plans are public');
select is((select public_label_en from plans where id = '00000000-0000-0000-0000-000000240541'), 'Monthly', 'plan label stored');
select is((select count(*)::int from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), 1, 'exactly one audit row');
select is((select metadata -> 'new' ->> 'city' from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), 'Douala', 'audit holds the new value');
select is((select metadata -> 'old' -> 'city' from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), 'null'::jsonb, 'audit holds the old value (null)');
select is((select jsonb_array_length(metadata -> 'plans') from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), 2, 'audit lists both plan changes');
select is((select actor_id from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), '00000000-0000-0000-0000-000000240521'::uuid, 'audit names the owner');
select is((select phone from members where id = '00000000-0000-0000-0000-000000240531'), '+237600240001', 'the Owner login phone is untouched');

-- ---- same input again --------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511',
  '{"about_en":"We are a gym.","lat":4.0511,"hours":{"sun":null,"mon":{"close":"22:00","open":"06:00"}}}'::jsonb,
  '[{"plan_id":"00000000-0000-0000-0000-000000240541","is_public":true,"public_label_en":"Monthly"}]'::jsonb)$$), 'ok', 'identical input is accepted');
reset role;
select is((select count(*)::int from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), 1, 'identical input writes no second audit row');

-- ---- partial patch changes only what is sent; changed fields only in audit ---------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240522', 'supervisor', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Yaounde","address":null}'::jsonb)$$), 'ok', 'supervisor patches two fields');
reset role;
select is((select page_city || '|' || coalesce(page_address, 'NULL') || '|' || page_about_fr from gyms where id = '00000000-0000-0000-0000-000000240511'), 'Yaounde|NULL|Nous sommes une salle.', 'only sent keys changed');
select is((select (select array_agg(k order by k) from jsonb_object_keys(metadata -> 'new') k) from audit_log
           where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511' and metadata -> 'old' ->> 'address' = 'Rue 1, Douala'),
          array['address', 'city'], 'the audit row lists only changed fields');
select is((select count(*)::int from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'), 2, 'supervisor change added one row');
-- making a plan private again
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240522', 'supervisor', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240542","is_public":false}]'::jsonb)$$), 'ok', 'a plan can be made private again');
reset role;
select is((select is_public from plans where id = '00000000-0000-0000-0000-000000240542'), false, 'the plan is private');

-- ---- refused callers ---------------------------------------------------------------------------------------------
create temp table pg_before as select to_jsonb(g) as g from gyms g where id = '00000000-0000-0000-0000-000000240511';
grant select on pg_before to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240523', 'manager', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Hacked"}'::jsonb)$$), 'P0001:permission denied', 'manager refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000240524', 'coach', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Hacked"}'::jsonb)$$), 'P0001:permission denied', 'coach refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000240525', 'member', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Hacked"}'::jsonb)$$), 'P0001:permission denied', 'member refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000240526', 'owner', '00000000-0000-0000-0000-000000240512');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Hacked"}'::jsonb)$$), 'P0001:permission denied', 'another gym''s owner refused');
select is(pg_temp.err($$select set_gym_page_content(null, '{"city":"Hacked"}'::jsonb)$$), 'P0001:permission denied', 'null gym refused');
reset role;
set local role anon;
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Hacked"}'::jsonb)$$), '42501:permission denied for function set_gym_page_content', 'anon refused');
reset role;
select is((select to_jsonb(g) from gyms g where id = '00000000-0000-0000-0000-000000240511'), (select g from pg_before), 'refused calls changed nothing');

-- ---- support -----------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240529', 'support', '00000000-0000-0000-0000-000000240511', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Limbe"}'::jsonb)$$), 'ok', 'assigned live support is admitted');
select pg_temp.claims('00000000-0000-0000-0000-000000240529', 'support', '00000000-0000-0000-0000-000000240512', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', '{"city":"Limbe"}'::jsonb)$$), 'P0001:permission denied', 'support with no assignment to that gym is refused');
reset role;
select is((select page_city from gyms where id = '00000000-0000-0000-0000-000000240511'), 'Limbe', 'support change stored');
select is((select count(*)::int from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511'
            and actor_id = (select id from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000240511')), 1, 'support change audited under the support identity');
select is((select page_city from gyms where id = '00000000-0000-0000-0000-000000240512'), null, 'the unassigned gym is untouched');

-- ---- super admin, suspended gym ----------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', '{"city":"Buea"}'::jsonb)$$), 'ok', 'super admin can write any gym');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240513', '{"city":"Buea"}'::jsonb)$$), 'ok', 'super admin can write a suspended gym');
select pg_temp.as_user('00000000-0000-0000-0000-000000240527', 'owner', '00000000-0000-0000-0000-000000240513');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240513', '{"city":"Nope"}'::jsonb)$$), 'P0001:set_gym_page_content: gym % is not active', 'a suspended gym''s owner is refused');
reset role;
select is((select page_city from gyms where id = '00000000-0000-0000-0000-000000240513'), 'Buea', 'the suspended gym still reads the super admin value');
-- support assigned to the suspended gym is refused too
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240552', '00000000-0000-0000-0000-000000240529', '00000000-0000-0000-0000-000000240513', 'active', now());
select private.support_set_membership('00000000-0000-0000-0000-000000240552', true);
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240529', 'support', '00000000-0000-0000-0000-000000240513', '00000000-0000-0000-0000-0000000240a1');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240513', '{"city":"Nope"}'::jsonb)$$), 'P0001:permission denied', 'assigned live support is refused on a suspended gym');
reset role;
select is((select page_city from gyms where id = '00000000-0000-0000-0000-000000240513'), 'Buea', 'the suspended gym is untouched by support');

-- ---- invalid input writes nothing --------------------------------------------------------------------------------
-- ---- whitespace, limits, explicit clearing, label-only plan change ------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', jsonb_build_object('about_en', E'  x\n', 'contact_phone', E' +237600111222\n'))$$);
reset role;
select is((select page_about_en from gyms where id = '00000000-0000-0000-0000-000000240512'), 'x', 'all surrounding whitespace is trimmed ("  x\n" stored as "x")');
select is((select page_contact_phone from gyms where id = '00000000-0000-0000-0000-000000240512'), '+237600111222', 'a phone with surrounding whitespace is trimmed and accepted');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', jsonb_build_object('about_en', E'\n'))$$);
reset role;
select is((select page_about_en from gyms where id = '00000000-0000-0000-0000-000000240512'), null, 'a whitespace-only string clears to null');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', jsonb_build_object('about_en', repeat('a', 2000)))$$), 'ok', 'a 2000-character about is accepted');
reset role;
select is((select char_length(page_about_en) from gyms where id = '00000000-0000-0000-0000-000000240512'), 2000, 'the at-limit text is stored whole');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', '{"lat":1.5,"lng":2.5,"hours":{"mon":{"open":"06:00","close":"22:00"}},"contact_phone":"+237600111222","contact_whatsapp":"+237600111223"}'::jsonb)$$), 'ok', 'set lat, lng, hours and both phones');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', '{"lat":null,"lng":null,"hours":null,"contact_phone":null,"contact_whatsapp":null}'::jsonb)$$), 'ok', 'explicit nulls clear them');
reset role;
select is((select count(*)::int from gyms where id = '00000000-0000-0000-0000-000000240512' and page_lat is null and page_lng is null and page_hours is null and page_contact_phone is null and page_contact_whatsapp is null), 1, 'lat, lng, hours and both phones read null');
create temp table pg_audit_n as select count(*)::int as n from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511';
grant select on pg_audit_n to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240541","public_label_fr":"Mensuel"}]'::jsonb)$$), 'ok', 'a label-only plan change is accepted');
reset role;
select is((select is_public from plans where id = '00000000-0000-0000-0000-000000240541'), true, 'the label-only change left is_public untouched');
select is((select public_label_fr from plans where id = '00000000-0000-0000-0000-000000240541'), 'Mensuel', 'the label changed');
select is((select count(*)::int from audit_log where action_type = 'gym_page_content_changed' and gym_id = '00000000-0000-0000-0000-000000240511') - (select n from pg_audit_n), 1, 'the label-only change wrote one audit row');

create temp table pg_before2 as select to_jsonb(g) as g from gyms g where id = '00000000-0000-0000-0000-000000240511';
grant select on pg_before2 to authenticated;
create temp table pg_before_plans as select jsonb_agg(to_jsonb(p) order by id) as p from plans p where gym_id = '00000000-0000-0000-0000-000000240511';
grant select on pg_before_plans to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Fine","about_en":"<script>alert(1)</script>"}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_about_en', 'markup rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"a>b"}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_city', 'a lone > rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"contact_phone":"0600111222"}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_contact_phone', 'non-E.164 phone rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"contact_whatsapp":"+0600111222"}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_contact_whatsapp', 'leading-zero country code rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"lat":90.5}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_lat', 'lat out of range');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"lng":-180.1}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_lng', 'lng out of range');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"lat":"4.0"}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_lat', 'lat as a string rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"about_en":"x","owner_phone":"+237600000000"}'::jsonb)$$), 'P0001:set_gym_page_content: unknown_key owner_phone', 'extra key rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', jsonb_build_object('about_en', repeat('a', 2001)))$$), 'P0001:set_gym_page_content: invalid_about_en', 'over-long text rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"hours":{"mon":{"open":"25:00","close":"22:00"}}}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_hours', 'bad time rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"hours":{"xyz":null}}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_hours', 'bad day key rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"hours":{}}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_hours', 'empty hours object rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"hours":{"mon":{"open":"06:00","close":"06:00"}}}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_hours', 'open equal to close rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Fine"}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240543","is_public":true}]'::jsonb)$$), 'P0001:set_gym_page_content: plan_not_in_gym', 'another gym''s plan id rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Fine"}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240541","is_public":"yes"}]'::jsonb)$$), 'P0001:set_gym_page_content: invalid_is_public', 'non-boolean flag rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{"city":"Fine"}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240541","is_public":true,"public_label_en":"<b>"}]'::jsonb)$$), 'P0001:set_gym_page_content: invalid_public_label_en', 'markup in a plan label rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', jsonb_build_object('services_en', repeat('a', 2001)))$$), 'P0001:set_gym_page_content: invalid_services_en', 'over-long services rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', jsonb_build_object('address', repeat('a', 301)))$$), 'P0001:set_gym_page_content: invalid_address', 'over-long address rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', jsonb_build_object('city', repeat('a', 101)))$$), 'P0001:set_gym_page_content: invalid_city', 'over-long city rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, jsonb_build_array(jsonb_build_object('plan_id', '00000000-0000-0000-0000-000000240541', 'public_label_en', repeat('a', 81))))$$), 'P0001:set_gym_page_content: invalid_public_label_en', 'over-long plan label (en) rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, jsonb_build_array(jsonb_build_object('plan_id', '00000000-0000-0000-0000-000000240541', 'public_label_fr', repeat('a', 81))))$$), 'P0001:set_gym_page_content: invalid_public_label_fr', 'over-long plan label (fr) rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240541"},{"plan_id":"00000000-0000-0000-0000-000000240541"}]'::jsonb)$$), 'P0001:set_gym_page_content: duplicate_plan_id', 'a duplicate plan id is rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, '[{"plan_id":"00000000-0000-0000-0000-000000240541","price":1}]'::jsonb)$$), 'P0001:set_gym_page_content: unknown_plan_key price', 'an unknown plan key is rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '{}'::jsonb, '{}'::jsonb)$$), 'P0001:set_gym_page_content: invalid_plans', 'a non-array p_plans is rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', null)$$), 'P0001:set_gym_page_content: invalid_content', 'a null p_content is rejected');
select alike(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240511', '[]'::jsonb)$$), 'P0001:set_gym_page_content: invalid_content', 'a non-object p_content is rejected');
reset role;
select is((select to_jsonb(g) from gyms g where id = '00000000-0000-0000-0000-000000240511'), (select g from pg_before2), 'invalid input wrote nothing to the gym');
select is((select jsonb_agg(to_jsonb(p) order by id) from plans p where gym_id = '00000000-0000-0000-0000-000000240511'), (select p from pg_before_plans), 'invalid input wrote nothing to plans');

-- ---- the pins: direct writes are reverted ------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.rows($$update gyms set page_about_en = 'direct', page_lat = 1 where id = '00000000-0000-0000-0000-000000240511'$$), '1', 'a direct owner UPDATE of the gym row runs');
select is(pg_temp.rows($$update plans set is_public = true where id = '00000000-0000-0000-0000-000000240542'$$), '1', 'a direct owner UPDATE of a plan runs');
select is(pg_temp.err($$insert into plans (gym_id, name, plan_type, price, billing_interval, duration_days, is_public, public_label_en) values ('00000000-0000-0000-0000-000000240511', 'PG Direct', 'monthly', 1, 'monthly', 30, true, 'x')$$), 'ok', 'a direct owner INSERT of a plan runs');
reset role;
select is((select page_about_en || '|' || page_lat::text from gyms where id = '00000000-0000-0000-0000-000000240511'), 'We are a gym.|4.051100', 'the pin reverted the direct gym write');
select is((select is_public from plans where id = '00000000-0000-0000-0000-000000240542'), false, 'the pin reverted the direct plan write');
select is((select is_public::text || coalesce(public_label_en, '-') from plans where name = 'PG DIRECT'), 'false-', 'a plan inserted public reads private');

-- the pins also bind a super admin and service_role
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select pg_temp.err($$update gyms set page_city = 'SA direct', page_lat = 7 where id = '00000000-0000-0000-0000-000000240511'$$);
select pg_temp.err($$update plans set is_public = true where id = '00000000-0000-0000-0000-000000240542'$$);
reset role;
select is((select page_city || '|' || page_lat::text from gyms where id = '00000000-0000-0000-0000-000000240511'), 'Limbe|4.051100', 'the pin reverted a super admin direct gym write');
select is((select is_public from plans where id = '00000000-0000-0000-0000-000000240542'), false, 'the pin reverted a super admin direct plan write');
set local role service_role;
select pg_temp.err($$update gyms set page_city = 'SR direct', page_lat = 8 where id = '00000000-0000-0000-0000-000000240511'$$);
select pg_temp.err($$update plans set is_public = true where id = '00000000-0000-0000-0000-000000240542'$$);
reset role;
select is((select page_city || '|' || page_lat::text from gyms where id = '00000000-0000-0000-0000-000000240511'), 'Limbe|4.051100', 'the pin reverted a service_role direct gym write');
select is((select is_public from plans where id = '00000000-0000-0000-0000-000000240542'), false, 'the pin reverted a service_role direct plan write');

-- the pin is what blocks it: with the triggers off the same writes land
-- (24.8: the page refresh triggers are deferred; ALTER TABLE refuses while events are pending, so fire them now. No page exists here, so they do nothing.)
set constraints all immediate;
alter table gyms disable trigger pin_gym_page_content;
alter table plans disable trigger pin_plan_public_update;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.rows($$update gyms set page_about_en = 'direct' where id = '00000000-0000-0000-0000-000000240511'$$), '1', 'pins off: the gym write runs');
select is(pg_temp.rows($$update plans set is_public = true where id = '00000000-0000-0000-0000-000000240542'$$), '1', 'pins off: the plan write runs');
reset role;
select is((select page_about_en from gyms where id = '00000000-0000-0000-0000-000000240511') || (select is_public::text from plans where id = '00000000-0000-0000-0000-000000240542'), 'directtrue', 'with the pins removed the direct writes land (the pins are what blocked them)');
-- the table CHECKs hold on their own (pins off, so the value reaches the constraint)
select throws_ok($$update gyms set page_contact_phone = '0600111222' where id = '00000000-0000-0000-0000-000000240511'$$, '23514', null, 'CHECK: a non-E.164 page phone');
select throws_ok($$update gyms set page_lat = 91 where id = '00000000-0000-0000-0000-000000240511'$$, '23514', null, 'CHECK: latitude 91');
select throws_ok($$update gyms set page_about_en = '<b>' where id = '00000000-0000-0000-0000-000000240511'$$, '23514', null, 'CHECK: markup in page text');
select throws_ok($$update gyms set page_hours = '{"xyz":1}'::jsonb where id = '00000000-0000-0000-0000-000000240511'$$, '23514', null, 'CHECK: a bad hours object');
select throws_ok($$update plans set public_label_en = '<b>' where id = '00000000-0000-0000-0000-000000240541'$$, '23514', null, 'CHECK: markup in a plan label');
-- the insert pin is what forces a new plan private
set constraints all immediate;
alter table plans disable trigger pin_plan_public_insert;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240521', 'owner', '00000000-0000-0000-0000-000000240511');
select is(pg_temp.err($$insert into plans (gym_id, name, plan_type, price, billing_interval, duration_days, is_public) values ('00000000-0000-0000-0000-000000240511', 'PG Direct Two', 'monthly', 1, 'monthly', 30, true)$$), 'ok', 'insert pin off: a direct insert with is_public = true runs');
reset role;
select is((select is_public from plans where name = 'PG DIRECT TWO'), true, 'with the insert pin removed the plan lands public (the insert pin is what blocked it)');
set constraints all immediate;
alter table plans enable trigger pin_plan_public_insert;
alter table gyms enable trigger pin_gym_page_content;
alter table plans enable trigger pin_plan_public_update;

-- ---- Unicode whitespace trims like Zod trim() ----------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000240528', 'super_admin');
select is(pg_temp.err($$select set_gym_page_content('00000000-0000-0000-0000-000000240512', jsonb_build_object('city', chr(160) || 'Kribi' || chr(12288)))$$), 'ok', 'NBSP and ideographic-space wrapped text accepted');
reset role;
select is((select page_city from gyms where id = '00000000-0000-0000-0000-000000240512'), 'Kribi', 'SQL trims the same Unicode whitespace as Zod');

select * from finish();
rollback;
