-- Story 24.8: publish gate, snapshot and unpublish (migration 0164), positive paths and structure. Denials and the known-bad
-- mutations: gym_page_publish.negative.test.sql. Fixture ids: 00000000-0000-0000-0000-0000002408xx
--   gyms 11-19, users 31-45, members 51-65, plans 71-86.
--
-- The refresh triggers are DEFERRED constraint triggers (they judge a transaction's final state, at commit). This whole file is one
-- transaction, so `pg_temp.settle()` stands for "commit": it fires the pending triggers now.
begin;
select plan(263);

create or replace function pg_temp.claims(uid text, app_role text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.as_user(uid text, role_ text, gym text) returns void language sql as $f$ select pg_temp.claims(uid, role_, gym) $f$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.val(stmt text) returns text language plpgsql as $f$
declare v text; begin execute stmt into v; return coalesce(v, 'null'); exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.g(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002408' || case c when 'A' then '11' when 'B' then '12' when 'S' then '13' when 'T' then '14' when 'R' then '15'
    when 'Q' then '16' when 'Z' then '17' when 'N' then '18' when 'P' then '19' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002408' || case c when 'ownerA' then '31' when 'supA' then '32' when 'mgrA' then '33' when 'coachA' then '34'
    when 'memberA' then '35' when 'ownerB' then '36' when 'ownerS' then '37' when 'ownerR' then '38' when 'admin' then '39' when 'ownerQ' then '40'
    when 'support' then '41' when 'supQ' then '42' when 'ownerT' then '43' when 'ownerA2' then '44' when 'ownerP' then '45' end $f$;
create or replace function pg_temp.pl(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002408' || case c when 'A1' then '71' when 'A2' then '72' when 'A3' then '73' when 'S' then '74' when 'T' then '75'
    when 'R' then '76' when 'Q' then '77' when 'B' then '78' when 'P1' then '79' when 'P2' then '80' end $f$;
-- media keys: derivative {n}.webp (no gym id in it), original {gym}/{n}
create or replace function pg_temp.dk(n int) returns text language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0') || '.webp' $f$;
create or replace function pg_temp.reg(gym text, kind text, n int) returns text language sql as $f$
  select format($q$select register_page_media(%L, %L, %L, %L, true, 'v1')$q$, pg_temp.g(gym), kind, pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'), pg_temp.dk(n)) $f$;
create or replace function pg_temp.mid(n int) returns text language sql security definer as $f$ select id::text from public.gym_page_media where derivative_key = pg_temp.dk(n) $f$;
create or replace function pg_temp.pub(gym text, tpl text default null) returns text language sql as $f$
  select format($q$select publish_gym_page(%L, %L)::text$q$, pg_temp.g(gym), tpl) $f$;
create or replace function pg_temp.unpub(gym text) returns text language sql as $f$ select format($q$select unpublish_gym_page(%L)::text$q$, pg_temp.g(gym)) $f$;
-- fire the pending deferred triggers now (what COMMIT would do), then defer again
create or replace function pg_temp.pid(gym text, st text) returns text language sql security definer as $f$ select id::text from public.page_names where gym_id = pg_temp.g(gym)::uuid and state = st $f$;
create or replace function pg_temp.settle() returns void language plpgsql as $f$ begin set constraints all immediate; set constraints all deferred; end $f$;
-- definer readers: the test body runs as postgres, but a call made under `set local role authenticated` must not need table grants
create or replace function pg_temp.page(gym text, col text) returns text language plpgsql security definer as $f$
declare v text; begin execute format('select %s::text from public.gym_pages where gym_id = %L', col, pg_temp.g(gym)) into v; return coalesce(v, 'null'); end $f$;
create or replace function pg_temp.missing(gym text) returns text language sql security definer as $f$ select array_to_string(private.gym_page_gate_missing(pg_temp.g(gym)::uuid), ',') $f$;
create or replace function pg_temp.visible(gym text) returns int language sql security definer as $f$
  select count(*)::int from private.gym_page_visible v where v.page_name_id in (select id from public.page_names where gym_id = pg_temp.g(gym)::uuid) $f$;
-- all key paths of a json value: objects as a.b, array elements as a[] (and a[].b)
create or replace function pg_temp.key_paths(j jsonb) returns text[] language sql as $f$
  with recursive walk(path, val) as (
    select ''::text, j
    union all
    select w.path || case when c.arr then '[]' when w.path = '' then c.k else '.' || c.k end, c.v
      from walk w
      cross join lateral (
        select kv.key as k, kv.value as v, false as arr from jsonb_each(case when jsonb_typeof(w.val) = 'object' then w.val else '{}'::jsonb end) kv
        union all
        select ''::text, el, true from jsonb_array_elements(case when jsonb_typeof(w.val) = 'array' then w.val else '[]'::jsonb end) el
      ) c
  )
  select coalesce(array_agg(distinct path order by path) filter (where path <> ''), '{}') from walk $f$;
-- the public reader: one query as public_site_reader
grant public_site_reader to postgres with set true;
create or replace function pg_temp.as_reader(q text) returns text language plpgsql as $f$
declare v text;
begin
  set local role public_site_reader;
  execute q into v;
  reset role;
  return coalesce(v, 'NULL');
exception when others then
  reset role;
  return 'ERR:' || sqlstate;
end $f$;
-- gate codes seen failing, for the enumeration at the end
create temp table covered (code text);
create or replace function pg_temp.see(gym text) returns text language plpgsql security definer as $f$
begin
  insert into pg_temp.covered select unnest(private.gym_page_gate_missing(pg_temp.g(gym)::uuid));
  return pg_temp.missing(gym);
end $f$;
-- a gym brought to publishable in one call by a Super Admin (claims must be super admin): content, a public plan, name, logo, banner
create or replace function pg_temp.complete(gym text, nm text, plan_id text, n int) returns text language plpgsql as $f$
begin
  perform set_gym_page_content(pg_temp.g(gym)::uuid,
    jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'city', 'Douala', 'contact_phone', '+237600555000',
                       'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'is_public', true)));
  perform claim_page_name(pg_temp.g(gym)::uuid, nm);
  perform register_page_media(pg_temp.g(gym)::uuid, 'logo', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'), pg_temp.dk(n), true, 'v1');
  perform register_page_media(pg_temp.g(gym)::uuid, 'banner', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad((n + 1)::text, 12, '0'), pg_temp.dk(n + 1), true, 'v1');
  return publish_gym_page(pg_temp.g(gym)::uuid, 'classic')::text;
end $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000240801', 'Publish Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('A')::uuid, 'Publish Gym A', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('B')::uuid, 'Publish Gym B', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('S')::uuid, 'Publish Gym S', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('T')::uuid, 'Publish Gym T', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('R')::uuid, 'Publish Gym R', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('Q')::uuid, 'Publish Gym Q', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('Z')::uuid, 'Publish Gym Z', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('N')::uuid, 'Publish Gym N', '00000000-0000-0000-0000-000000240801'),
  (pg_temp.g('P')::uuid, 'Publish Gym P', '00000000-0000-0000-0000-000000240801');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerA')::uuid, 'ownerA-2408@x.example', now()),
  (pg_temp.u('supA')::uuid, 'supA-2408@x.example', now()),
  (pg_temp.u('mgrA')::uuid, 'mgrA-2408@x.example', now()),
  (pg_temp.u('coachA')::uuid, 'coachA-2408@x.example', now()),
  (pg_temp.u('memberA')::uuid, 'memberA-2408@x.example', now()),
  (pg_temp.u('ownerB')::uuid, 'ownerB-2408@x.example', now()),
  (pg_temp.u('ownerS')::uuid, 'ownerS-2408@x.example', now()),
  (pg_temp.u('ownerR')::uuid, 'ownerR-2408@x.example', now()),
  (pg_temp.u('ownerQ')::uuid, 'ownerQ-2408@x.example', now()),
  (pg_temp.u('supQ')::uuid, 'supQ-2408@x.example', now()),
  (pg_temp.u('ownerT')::uuid, 'ownerT-2408@x.example', now()),
  (pg_temp.u('ownerA2')::uuid, 'ownerA2-2408@x.example', now()),
  (pg_temp.u('ownerP')::uuid, 'ownerP-2408@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2408@x.example', now()),
  (pg_temp.u('support')::uuid, 'sup-2408@gymosapps.com', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000240851', pg_temp.g('A')::uuid, pg_temp.u('ownerA')::uuid, 'owner',      'PP Owner A',      '+237600240801', current_date),
  ('00000000-0000-0000-0000-000000240852', pg_temp.g('A')::uuid, pg_temp.u('supA')::uuid,   'supervisor', 'PP Supervisor A', '+237600240802', current_date),
  ('00000000-0000-0000-0000-000000240853', pg_temp.g('A')::uuid, pg_temp.u('mgrA')::uuid,   'manager',    'PP Manager A',    '+237600240803', current_date),
  ('00000000-0000-0000-0000-000000240854', pg_temp.g('A')::uuid, pg_temp.u('coachA')::uuid, 'coach',      'PP Coach A',      '+237600240804', current_date),
  ('00000000-0000-0000-0000-000000240855', pg_temp.g('A')::uuid, pg_temp.u('memberA')::uuid,'member',     'PP Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000240856', pg_temp.g('B')::uuid, pg_temp.u('ownerB')::uuid, 'owner',      'PP Owner B',      '+237600240806', current_date),
  ('00000000-0000-0000-0000-000000240857', pg_temp.g('S')::uuid, pg_temp.u('ownerS')::uuid, 'owner',      'PP Owner S',      '+237600240807', current_date),
  ('00000000-0000-0000-0000-000000240858', pg_temp.g('R')::uuid, pg_temp.u('ownerR')::uuid, 'owner',      'PP Owner R',      '+237600240808', current_date),
  ('00000000-0000-0000-0000-000000240859', pg_temp.g('Q')::uuid, pg_temp.u('ownerQ')::uuid, 'owner',      'PP Owner Q',      '+237600240809', current_date),
  ('00000000-0000-0000-0000-000000240860', pg_temp.g('Q')::uuid, pg_temp.u('supQ')::uuid,   'supervisor', 'PP Supervisor Q', '+237600240810', current_date),
  ('00000000-0000-0000-0000-000000240861', pg_temp.g('T')::uuid, pg_temp.u('ownerT')::uuid, 'owner',      'PP Owner T',      '+237600240811', current_date),
  ('00000000-0000-0000-0000-000000240862', pg_temp.g('A')::uuid, pg_temp.u('ownerA2')::uuid,'owner',      'PP Owner A2',     '+237600240812', current_date),
  ('00000000-0000-0000-0000-000000240863', pg_temp.g('P')::uuid, pg_temp.u('ownerP')::uuid, 'owner',      'PP Owner P',      '+237600240813', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  (pg_temp.pl('A1')::uuid, pg_temp.g('A')::uuid, 'Monthly',     'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('A2')::uuid, pg_temp.g('A')::uuid, 'Per Session', 'pay_per_session', 2000, 'monthly', null),
  (pg_temp.pl('A3')::uuid, pg_temp.g('A')::uuid, 'Staff Only',  'monthly', 5000, 'monthly', 30),
  (pg_temp.pl('S')::uuid, pg_temp.g('S')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('T')::uuid, pg_temp.g('T')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('R')::uuid, pg_temp.g('R')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('Q')::uuid, pg_temp.g('Q')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('B')::uuid, pg_temp.g('B')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('P1')::uuid, pg_temp.g('P')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('P2')::uuid, pg_temp.g('P')::uuid, 'Quarterly', 'monthly', 25000, 'monthly', 90);
-- support: live and assigned to gym A
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u('support')::uuid, now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240881', pg_temp.u('support')::uuid, pg_temp.g('A')::uuid, 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000248a1', pg_temp.u('support')::uuid, now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000248a1', pg_temp.u('support')::uuid, now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000240881', true);

-- ---- catalog -----------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('publish_gym_page', 'unpublish_gym_page')
            and prosecdef and proconfig = array['search_path=public']), 2, 'both public functions are security definer with a pinned search_path');
select is(has_function_privilege('anon', 'public.publish_gym_page(uuid,text)', 'execute') or has_function_privilege('anon', 'public.unpublish_gym_page(uuid)', 'execute'),
          false, 'anon cannot execute either');
select is(has_function_privilege('authenticated', 'public.publish_gym_page(uuid,text)', 'execute') and has_function_privilege('authenticated', 'public.unpublish_gym_page(uuid)', 'execute'),
          true, 'authenticated can execute both');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace
            and p.proname in ('gym_page_gate_missing', 'gym_page_snapshot', 'refresh_gym_page', 'notify_page_unpublished', 'gym_page_gate_phrase', 'gym_page_trimmed_length',
                              'gym_page_refresh_from_gym', 'gym_page_refresh_from_plan', 'gym_page_refresh_from_media', 'gym_page_refresh_from_name')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'no private 24.8 function is executable by a client role (refresh_gym_page has no grant to leak)');
select is((select count(*)::int from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name in ('publish_gym_page', 'unpublish_gym_page')), 2,
          'both functions have their capability row');
select is((select count(*)::int from private.support_audit_actions where action_type in ('gym_page_published', 'gym_page_unpublished')), 2, 'both audit actions are on the support allow-list');
select is((select count(*)::int from pg_trigger where tgname like 'gym\_page\_refresh%' and not tgisinternal and tgconstraint <> 0 and tgdeferrable and tginitdeferred), 8,
          'eight deferred constraint triggers: gyms, plans (update, delete), media (insert, update, delete), page names (insert, update)');
select is((select array_agg(c.relname::text || '.' || t.tgname order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where t.tgname like 'gym\_page\_refresh%' and not t.tgisinternal),
          array['gym_page_media.gym_page_refresh_delete', 'gym_page_media.gym_page_refresh_insert', 'gym_page_media.gym_page_refresh_update', 'gyms.gym_page_refresh', 'page_names.gym_page_refresh_insert',
                'page_names.gym_page_refresh_update', 'plans.gym_page_refresh_delete', 'plans.gym_page_refresh_update'],
          'the triggers sit on exactly gyms, plans, gym_page_media and page_names');
select is((select count(*)::int from pg_constraint where conname = 'gym_pages_gym_page_name_fkey' and contype = 'f') - (select count(*)::int from pg_constraint where conname = 'gym_pages_page_name_id_fkey'), 1,
          'gym_pages has the composite (gym_id, page_name_id) foreign key and no longer the single-column one');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'gym_pages' and column_name = 'unpublished_reason'), 1, 'gym_pages.unpublished_reason exists');
select is((select reloptions from pg_class where oid = 'private.gym_page_visible'::regclass), array['security_barrier=true'], 'the visibility predicate is a security_barrier view');
select is((select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) g where has_table_privilege(g, 'private.gym_page_visible', 'select')), 0,
          'no client role can read the visibility view');
select is((select count(*)::int from information_schema.columns where table_schema = 'private' and table_name = 'gym_page_visible' and column_name = 'gym_id'), 0,
          'the visibility view has no gym_id column');
select is(pg_temp.as_reader('select count(*) from private.gym_page_visible'), 'ERR:42501', 'the reader cannot read the private view directly');

-- ---- publish: typed refusals that come before the gate -------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A')), 'P0001:publish_gym_page: template_required', 'a first publish with no template is template_required');
select is((select string_agg(left(pg_temp.val(pg_temp.pub('A', t)), 44), '|' order by t) from unnest(array['Classic', 'x', 'a b', 'a_b', '1abc', '-ab', repeat('a', 32)]) t),
          (select string_agg('P0001:publish_gym_page: invalid_template', '|') from generate_series(1, 7)), 'template names outside ^[a-z][a-z0-9-]{1,30}$ are invalid_template');
reset role;
select is((select count(*)::int from gym_pages where gym_id = pg_temp.g('A')::uuid), 0, 'refusals wrote nothing');

-- ---- the gate: one failing case per code (the matrix row "gate not met") ---------------------------------------------------------
select is(pg_temp.see('A'), 'no_name,no_logo,no_banner,about_short,no_city,no_contact,no_hours,no_public_plan', 'a fresh gym misses eight things, in the fixed order');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": ["no_name", "no_logo", "no_banner", "about_short", "no_city", "no_contact", "no_hours", "no_public_plan"], "published": false}',
          'a failed gate returns the missing codes and published false');
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_en', repeat('x', 60)))$$), 'ok', 'owner saves a 60-character about');
reset role;
select is((select count(*)::int from gym_pages where gym_id = pg_temp.g('A')::uuid) + (select count(*)::int from audit_log where action_type = 'gym_page_published' and gym_id = pg_temp.g('A')::uuid), 0,
          'a failed gate writes no page row and no audit row');
select ok(pg_temp.see('A') like '%about_short%', 'about_short: 60 characters is not enough');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_fr', repeat('é', 100)))$$), 'ok', 'owner saves a 100-character French about');
reset role;
select ok(pg_temp.see('A') not like '%about_short%', 'about_short: 100 characters in the OTHER language is enough (EN or FR)');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_fr', repeat(' ', 40) || repeat('é', 60) || repeat(' ', 40)))$$), 'ok', 'a French about of 60 characters padded with spaces');
reset role;
select ok(pg_temp.see('A') like '%about_short%', 'about_short: padding counts for nothing (trimmed length)');
-- half coordinate
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"lat": 4.05}')$$), 'ok', 'the setter accepts a latitude with no longitude');
reset role;
select ok(pg_temp.see('A') like '%map_incomplete%', 'map_incomplete: lat set, lng null');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"lat": null, "lng": 9.7}')$$), 'ok', 'and the other way round');
reset role;
select ok(pg_temp.see('A') like '%map_incomplete%', 'map_incomplete: lng set, lat null');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"lat": 4.05, "lng": 9.76, "hours": {"mon": null, "tue": null}}')$$), 'ok', 'a pair of coordinates and hours with every day closed');
reset role;
select ok(pg_temp.see('A') not like '%map_incomplete%', 'both coordinates set: complete');
select ok(pg_temp.see('A') like '%no_hours%', 'no_hours: every day null is not opening hours');
-- control characters and angle brackets
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('address', 'Rue 1' || chr(1) || 'x'))$$), 'ok', 'the setter stores a control character (it only blocks angle brackets)');
reset role;
select ok(pg_temp.see('A') like '%bad_text%', 'bad_text: a control character in the address');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('address', E'Rue 1\n\tBP 12'))$$), 'ok', 'newline and tab are fine');
reset role;
select ok(pg_temp.see('A') not like '%bad_text%', 'bad_text: newline and tab pass');
update gyms set name = 'Publish <b>Gym A' where id = pg_temp.g('A')::uuid;
select ok(pg_temp.see('A') like '%bad_text%', 'bad_text: an angle bracket in the gym name (not covered by the 24.5 CHECKs)');
update gyms set name = 'Publish Gym A' where id = pg_temp.g('A')::uuid;
select ok(pg_temp.see('A') not like '%bad_text%', 'bad_text clears when the name is clean');
-- gym Z: a pile of public plans makes the snapshot too large
select set_config('app.gym_page_content_bypass', 'true', true);
insert into plans (gym_id, name, plan_type, price, billing_interval, duration_days, is_public, public_label_en, public_label_fr)
select pg_temp.g('Z')::uuid, 'Plan number ' || lpad(i::text, 4, '0') || ' with a long descriptive name', 'monthly', 1000 + i, 'monthly', 30, true, 'English label ' || i, 'Libelle francais ' || i
  from generate_series(1, 400) i;
select set_config('app.gym_page_content_bypass', 'false', true);
select ok(pg_temp.see('Z') like '%too_large%', 'too_large: 400 public plans do not fit the 64 KiB cap, so the gate says so instead of the CHECK raising');
select ok((select octet_length(private.gym_page_snapshot(pg_temp.g('Z')::uuid)::text) > 65000), 'control: that snapshot really is over the limit');
delete from plans where gym_id = pg_temp.g('Z')::uuid;

-- ---- A is completed through the real paths, then published (matrix row "gate met") --------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object(
    'about_en', 'We are a modern gym in the heart of Douala with coaches, classes and open floor space for every level of fitness.',
    'about_fr', 'Nous sommes une salle moderne au coeur de Douala avec des coachs, des cours et un espace libre pour tous les niveaux de forme physique.',
    'services_en', 'Cardio, weights, yoga', 'services_fr', 'Cardio, poids, yoga',
    'address', 'Rue 1, Akwa', 'city', 'Douala', 'lat', 4.0511, 'lng', 9.7679,
    'contact_phone', '+237600111222', 'contact_whatsapp', '+237600111223',
    'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
  jsonb_build_array(
    jsonb_build_object('plan_id', '$$ || pg_temp.pl('A1') || $$', 'is_public', true, 'public_label_en', 'Monthly pass'),
    jsonb_build_object('plan_id', '$$ || pg_temp.pl('A2') || $$', 'is_public', true)))$$), 'ok', 'owner fills in the page and makes two plans public');
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('A') || $$', 'pub-alpha')->>'state'$$), 'active', 'owner claims a clean name');
select is(pg_temp.err(pg_temp.reg('A', 'logo', 1)), 'ok', 'owner registers the logo');
select is(pg_temp.err(pg_temp.reg('A', 'banner', 2)), 'ok', 'owner registers the banner');
select is(pg_temp.err(pg_temp.reg('A', 'gallery', 3)), 'ok', 'gallery image 1');
select is(pg_temp.err(pg_temp.reg('A', 'gallery', 4)), 'ok', 'gallery image 2');
select is(pg_temp.err(pg_temp.reg('A', 'gallery', 5)), 'ok', 'gallery image 3');
reset role;
update gyms set primary_color = '#1A2B3C' where id = pg_temp.g('A')::uuid;
select is(pg_temp.see('A'), '', 'the gate is met');
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '0', 'before publishing the reader sees no page');

set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": [], "published": true}', 'owner publishes: {published: true, missing: []}');
reset role;
select is(pg_temp.page('A', 'template'), 'classic', 'the template is stored');
select ok(pg_temp.page('A', 'published_at') <> 'null' and pg_temp.page('A', 'unpublished_at') = 'null' and pg_temp.page('A', 'unpublished_reason') = 'null' and pg_temp.page('A', 'taken_down_at') = 'null',
          'published_at is set; unpublished_at, the reason and taken_down_at are null');
select is(pg_temp.page('A', 'page_name_id'), (select id::text from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active'), 'page_name_id is the gym''s active name');
select is((select reserved_until from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active'), null, 'the name idle clock is cleared');
select is((select count(*)::int from audit_log where action_type = 'gym_page_published' and gym_id = pg_temp.g('A')::uuid and actor_id = pg_temp.u('ownerA')::uuid
            and metadata ->> 'template' = 'classic' and metadata ->> 'name' = 'pub-alpha' and metadata ->> 'republish' = 'false'), 1, 'one audit row names the owner, template and name');
select is(pg_temp.visible('A'), 1, 'the visibility predicate returns the page');
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '1', 'the reader sees one page');
select is(pg_temp.as_reader('select name from public_site.pages'), 'pub-alpha', 'the page carries its name');
select is(pg_temp.as_reader('select count(*) from public_site.page_media'), '5', 'and five media rows (logo, banner, three gallery)');
select is(pg_temp.as_reader('select count(distinct page_name_id) from public_site.page_media'), '1', 'tied to the page by page_name_id');

-- ---- the snapshot: every key path is pinned; nothing identifying can enter ---------------------------------------------------------
select is(pg_temp.key_paths((select content from gym_pages where gym_id = pg_temp.g('A')::uuid)),
          (select array_agg(x order by x) from unnest(array[
             'about_en', 'about_fr', 'address', 'banner', 'category', 'city', 'color', 'contact', 'contact.phone', 'contact.whatsapp', 'country',
             'default_language', 'gallery', 'gallery[]', 'hours', 'hours.mon', 'hours.mon.close', 'hours.mon.open', 'hours.sun', 'logo', 'map', 'map.lat', 'map.lng', 'name',
             'plans', 'plans[]', 'plans[].currency', 'plans[].duration_days', 'plans[].interval', 'plans[].label_en', 'plans[].label_fr', 'plans[].name',
             'plans[].price', 'plans[].type', 'services_en', 'services_fr']) x),
          'SNAPSHOT KEY PATHS (pinned): an added key, or a removed one, fails here; edit this list only with the content CHECK and the privileges test');
select is(pg_temp.key_paths(private.gym_page_snapshot(pg_temp.g('A')::uuid)), pg_temp.key_paths((select content from gym_pages where gym_id = pg_temp.g('A')::uuid)),
          'the stored snapshot has the same key paths as the builder');
select is((select count(*)::int from gym_pages where gym_id = pg_temp.g('A')::uuid
            and (content::text like '%' || pg_temp.g('A') || '%'
                 or content::text like '%' || pg_temp.pl('A1') || '%' or content::text like '%' || pg_temp.pl('A2') || '%' or content::text like '%' || pg_temp.pl('A3') || '%'
                 or content::text like '%' || (select gym_token from gyms where id = pg_temp.g('A')::uuid) || '%'
                 or content::text like '%237600240801%' or content::text like '%' || pg_temp.u('ownerA') || '%' or content::text like '%uploaded_by%'
                 or content::text like '%aaaaaaaa-aaaa-aaaa%' or content::text like '%gym_id%' or content::text like '%gym_token%')), 0,
          'no gym id, plan id, gym_token, login phone, uploader id or original key appears in the snapshot');
select is((select content #>> '{plans,0,name}' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'PER SESSION', 'public plans are in the snapshot, cheapest first');
select is((select jsonb_array_length(content -> 'plans') from gym_pages where gym_id = pg_temp.g('A')::uuid), 2, 'and the private plan is not');
select is((select content #>> '{plans,1,label_en}' || '|' || (content #>> '{plans,1,label_fr}') from gym_pages where gym_id = pg_temp.g('A')::uuid), 'Monthly pass|MONTHLY', 'a missing label falls back to the plan name');
select is((select content #>> '{plans,0,duration_days}' from gym_pages where gym_id = pg_temp.g('A')::uuid), null, 'a null duration is omitted (pay per session)');
select is((select content ->> 'color' from gym_pages where gym_id = pg_temp.g('A')::uuid), '#1A2B3C', 'a valid color is carried');
select is((select content ->> 'name' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'PUBLISH GYM A', 'the gym display name is carried');
select is((select content ->> 'default_language' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'en', '24.10: the gym default language is carried');
select is((select content -> 'hours' -> 'sun' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'null'::jsonb, 'a closed day survives in hours (the one place a null is kept)');
select is((select content -> 'gallery' from gym_pages where gym_id = pg_temp.g('A')::uuid), jsonb_build_array(pg_temp.dk(3), pg_temp.dk(4), pg_temp.dk(5)), 'gallery keys are in sort order');
select ok((select content ->> 'logo' = pg_temp.dk(1) and content ->> 'banner' = pg_temp.dk(2) from gym_pages where gym_id = pg_temp.g('A')::uuid), 'logo and banner are derivative keys');

-- ---- refresh: an edit re-snapshots in the same transaction; the gate is judged on the final state -------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_en', repeat('A longer about text for the page. ', 4)))$$), 'ok', 'owner edits the about text');
reset role;
select pg_temp.settle();
select is((select content ->> 'about_en' from gym_pages where gym_id = pg_temp.g('A')::uuid), rtrim(repeat('A longer about text for the page. ', 4)), 'the snapshot has the new about text');
select ok(pg_temp.page('A', 'unpublished_at') = 'null' and pg_temp.visible('A') = 1, 'and the page is still published');

set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{}', jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('A2') || $$', 'is_public', false)))$$), 'ok', 'owner makes one of two public plans private');
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{}', jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('A1') || $$', 'public_label_fr', 'Mensuel')))$$), 'ok', 'and relabels the other');
reset role;
select pg_temp.settle();
select is((select jsonb_array_length(content -> 'plans') || '|' || (content #>> '{plans,0,label_fr}') from gym_pages where gym_id = pg_temp.g('A')::uuid), '1|Mensuel', 'the snapshot lost the private plan and has the new label');
update plans set name = 'Monthly Plus' where id = pg_temp.pl('A1')::uuid;
update plans set name = 'Not Public Rename' where id = pg_temp.pl('A3')::uuid;
select pg_temp.settle();
select is((select content #>> '{plans,0,name}' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'MONTHLY PLUS', 'a public plan rename is carried');
select is((select count(*)::int from gym_pages where gym_id = pg_temp.g('A')::uuid and content::text like '%NOT PUBLIC RENAME%'), 0, 'a private plan never enters the snapshot');
update gyms set primary_color = 'red', name = 'Publish Gym Renamed' where id = pg_temp.g('A')::uuid;
select pg_temp.settle();
select is((select (content ? 'color')::text || '|' || (content ->> 'name') from gym_pages where gym_id = pg_temp.g('A')::uuid), 'false|PUBLISH GYM RENAMED', 'a bad color is omitted and the gym name change is carried');
update gyms set primary_color = '#12345G' where id = pg_temp.g('A')::uuid;
select pg_temp.settle();
select is((select (content ? 'color')::text from gym_pages where gym_id = pg_temp.g('A')::uuid), 'false', 'a non-hex color is omitted too');
update gyms set primary_color = '#abCDef' where id = pg_temp.g('A')::uuid;
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_category('$$ || pg_temp.g('A') || $$', 'yoga_studio')$$), 'ok', 'owner changes the category');
reset role;
select pg_temp.settle();
select is((select (content ->> 'color') || '|' || (content ->> 'category') from gym_pages where gym_id = pg_temp.g('A')::uuid), '#abCDef|yoga_studio', 'a valid color and the new category are carried');
select is((select count(*)::int from gym_pages g where g.gym_id = pg_temp.g('A')::uuid and g.updated_at >= g.published_at), 1, 'updated_at moves with the snapshot');

-- media: delete a gallery image, replace the logo (two statements, one transaction)
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid(4))), 'ok', 'owner deletes a gallery image');
select is(pg_temp.err(pg_temp.reg('A', 'logo', 6)), 'ok', 'and replaces the logo (the old one is marked deleted, then the new one added)');
reset role;
select pg_temp.settle();
select is((select content -> 'gallery' from gym_pages where gym_id = pg_temp.g('A')::uuid), jsonb_build_array(pg_temp.dk(3), pg_temp.dk(5)), 'the deleted image left the snapshot');
select is((select content ->> 'logo' from gym_pages where gym_id = pg_temp.g('A')::uuid), pg_temp.dk(6), 'the new logo is in the snapshot');
select is(pg_temp.visible('A'), 1, 'replacing a logo did NOT unpublish the page (the gate is judged on the final state, not between the two statements)');
select is(pg_temp.as_reader('select count(*) from public_site.page_media where derivative_key = ' || quote_literal(pg_temp.dk(4)) || ' or derivative_key = ' || quote_literal(pg_temp.dk(1))), '0',
          'the view no longer lists the deleted image or the replaced logo');
select is(pg_temp.as_reader('select count(*) from public_site.page_media'), '4', 'it lists the new logo, the banner and two gallery images');
select is(pg_temp.as_reader('select string_agg(derivative_key, '','' order by sort_order) from public_site.page_media where kind = ''gallery'''), pg_temp.dk(3) || ',' || pg_temp.dk(5), 'gallery order is the snapshot order');

-- ---- rename: the page follows its gym's active name -------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('A') || $$', 'pub-beta')->>'state'$$), 'active', 'owner renames to a clean name');
reset role;
select pg_temp.settle();
select is(pg_temp.page('A', 'page_name_id'), (select id::text from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active' and name = 'pub-beta'), 'page_name_id moved to the new active name');
select is(pg_temp.as_reader('select name from public_site.pages'), 'pub-beta', 'the page stays visible under the new name');
select is((select state from page_names where name = 'pub-alpha'), 'redirect', 'the old name is a redirect');
select is(pg_temp.as_reader('select count(distinct page_name_id) from public_site.page_media'), '1', 'the media view follows the page name id');
-- a held rename, approved by a Super Admin
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('A') || $$', 'gym-pub')->>'state'$$), 'held', 'a name with a generic word is held');
reset role;
select is(pg_temp.visible('A'), 1, 'while it is held the page is unchanged');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val(format($q$select decide_held_page_name(%L, true, 'looks fine')->>'state'$q$, pg_temp.pid('A', 'held'))), 'active', 'Super Admin approves');
reset role;
select pg_temp.settle();
select is(pg_temp.page('A', 'page_name_id'), (select id::text from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active' and name = 'gym-pub'), 'an approved rename moves page_name_id too');
select is(pg_temp.as_reader('select name from public_site.pages'), 'gym-pub', 'and the page stays visible');
select is((select count(*)::int from page_names where gym_id = pg_temp.g('A')::uuid and state = 'redirect'), 2, 'both earlier names redirect');

-- ---- a page that stops meeting the gate unpublishes itself and says why -----------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{}', jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('A1') || $$', 'is_public', false)))$$), 'ok', 'owner makes the last public plan private');
reset role;
select is(pg_temp.visible('A'), 1, 'inside the transaction nothing has been judged yet (deferred)');
select pg_temp.settle();
select is(pg_temp.visible('A'), 0, 'at commit the page is gone from the view');
select is(pg_temp.page('A', 'unpublished_reason'), 'no_public_plan', 'the reason is the missing code');
select ok(pg_temp.page('A', 'unpublished_at') <> 'null', 'unpublished_at is set');
select ok((select content ->> 'name' is not null from gym_pages where gym_id = pg_temp.g('A')::uuid), 'the snapshot is kept');
select is(pg_temp.as_reader('select count(*) from public_site.pages') || '/' || pg_temp.as_reader('select count(*) from public_site.page_media'), '0/0', 'the reader sees no page and no media');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('A')::uuid and notice_type = 'page_unpublished'), 2, 'both active Owners are told');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('A')::uuid and notice_type = 'page_unpublished' and user_id in (pg_temp.u('ownerA')::uuid, pg_temp.u('ownerA2')::uuid)), 2, 'and they are the Owners, no one else');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('A')::uuid and notice_type = 'page_unpublished' and user_id = pg_temp.u('supA')::uuid), 0, 'the Supervisor is not sent the notice');
select ok((select bool_and(title_en = 'Your gym page was taken offline' and title_fr = 'La page de votre salle a été mise hors ligne'
                  and body_en like '%Missing: at least one public plan.%' and body_fr like '%Manquant : au moins un abonnement public.%')
            from staff_notices where gym_id = pg_temp.g('A')::uuid and notice_type = 'page_unpublished'), 'the notice is bilingual and names what is missing');
select is((select count(*)::int from email_outbox o join staff_notices n on n.id = o.notice_id where n.gym_id = pg_temp.g('A')::uuid and n.notice_type = 'page_unpublished'), 2, 'each notice has its e-mail');
select is((select count(*)::int from audit_log where action_type = 'gym_page_unpublished' and gym_id = pg_temp.g('A')::uuid and metadata ->> 'reason' = 'gate' and metadata -> 'missing' = '["no_public_plan"]'::jsonb), 1,
          'one audit row records the automatic unpublish');
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active'),
          'the name idle clock started');
-- a further edit while offline does not bring it back and does not notify again
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('city', 'Yaounde'))$$), 'ok', 'owner edits the city of an offline page');
reset role;
select pg_temp.settle();
select is(pg_temp.visible('A') || '|' || (select count(*)::int from staff_notices where gym_id = pg_temp.g('A')::uuid and notice_type = 'page_unpublished'), '0|2', 'still offline; no second notice');
select is((select content ->> 'city' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'Douala', 'an offline snapshot is not refreshed');

-- republish by the Supervisor with no template keeps the stored one
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{}', jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('A1') || $$', 'is_public', true)))$$), 'ok', 'owner makes the plan public again');
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'a Supervisor republishes with no template: the stored one is kept');
reset role;
select is(pg_temp.page('A', 'template') || '|' || pg_temp.page('A', 'unpublished_reason') || '|' || pg_temp.page('A', 'unpublished_at'), 'classic|null|null', 'template kept; reason and unpublished_at cleared');
select is((select content ->> 'city' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'Yaounde', 'a republish takes a fresh snapshot');
select is(pg_temp.visible('A'), 1, 'and the page is visible again');
select is((select reserved_until from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active'), null, 'the idle clock is cleared');
select is((select count(*)::int from audit_log where action_type = 'gym_page_published' and gym_id = pg_temp.g('A')::uuid), 2, 'publish and republish are both audited');
-- changing the template
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000248a1');
select is(pg_temp.val(pg_temp.pub('A', 'bold-two')), '{"missing": [], "published": true}', 'live-assigned support publishes with a new template');
reset role;
select is(pg_temp.page('A', 'template'), 'bold-two', 'the template changed');
select is((select count(*)::int from audit_log where action_type = 'gym_page_published' and gym_id = pg_temp.g('A')::uuid and metadata ->> 'republish' = 'true' and actor_display_name = 'GymOS Support'), 1,
          'the support publish is audited as the GymOS Support proxy, as a republish');

-- a logo deleted after publish: no_logo; a banner and a city together: two codes in gate order
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid(6))), 'ok', 'owner deletes the live logo');
reset role;
select pg_temp.settle();
select is(pg_temp.page('A', 'unpublished_reason'), 'no_logo', 'matrix row "media deleted": the page unpublishes with reason no_logo');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(pg_temp.reg('A', 'logo', 7)), 'ok', 'a Super Admin registers a new logo');
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'and republishes');
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid(2))), 'ok', 'owner deletes the banner');
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"city": null}')$$), 'ok', 'and clears the city, in the same transaction');
reset role;
select pg_temp.settle();
select is(pg_temp.page('A', 'unpublished_reason'), 'no_banner,no_city', 'both reasons are recorded, in the gate order');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('A')::uuid and notice_type = 'page_unpublished' and user_id = pg_temp.u('ownerA')::uuid
            and body_en like '%Missing: a banner image; a city.%' and body_fr like '%Manquant : une image de bannière; une ville.%'), 1, 'and the notice lists both, EN and FR');
-- the half coordinate and the control character unpublish too
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.reg('A', 'banner', 8)), 'ok', 'owner adds a banner again');
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"city": "Douala"}')$$), 'ok', 'and the city');
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'republished');
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"lng": null}')$$), 'ok', 'owner clears the longitude only');
reset role;
select pg_temp.settle();
select is(pg_temp.page('A', 'unpublished_reason'), 'map_incomplete', 'a half coordinate unpublishes a live page (reason map_incomplete)');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"lng": 9.7679}')$$), 'ok', 'owner restores the longitude');
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'republished');
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_fr', 'Texte' || chr(7) || ' avec un caractere de controle'))$$), 'ok', 'owner saves text with a control character');
reset role;
select pg_temp.settle();
select is(pg_temp.page('A', 'unpublished_reason'), 'bad_text', 'a control character unpublishes a live page (reason bad_text)');

-- ---- unpublish ------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"about_fr": null}')$$), 'ok', 'owner removes the bad text');
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'republished by the owner');
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.unpub('A')), 'true', 'a Supervisor unpublishes: true');
reset role;
select is(pg_temp.page('A', 'unpublished_reason'), 'owner', 'the reason is owner');
select ok(pg_temp.page('A', 'unpublished_at') <> 'null' and pg_temp.visible('A') = 0, 'unpublished_at is set and the view returns no row');
select is(pg_temp.as_reader('select count(*) from public_site.pages'), '0', 'the reader sees nothing');
select ok((select reserved_until is not null from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active'), 'the name idle clock started');
select is((select count(*)::int from audit_log where action_type = 'gym_page_unpublished' and gym_id = pg_temp.g('A')::uuid and metadata ->> 'reason' = 'owner' and actor_id = pg_temp.u('supA')::uuid), 1, 'audited with the Supervisor as actor');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.unpub('A')), 'false', 'unpublishing an offline page is a quiet no-op (false)');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000248a1');
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'live-assigned support republishes');
select is(pg_temp.val(pg_temp.unpub('A')), 'true', 'and unpublishes');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'a Super Admin publishes');
select is(pg_temp.val(pg_temp.unpub('A')), 'true', 'and unpublishes');
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'the Owner publishes again');
reset role;
select is((select reserved_until from page_names where gym_id = pg_temp.g('A')::uuid and state = 'active'), null, 'the idle clock is cleared again');

-- ---- taken down: hidden, and publish is refused ---------------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val($$select pg_temp.complete('T', 'take-down', '$$ || pg_temp.pl('T') || $$', 20)$$), '{"missing": [], "published": true}', 'gym T is brought to a published page by a Super Admin');
reset role;
select is(pg_temp.visible('T'), 1, 'T is visible');
update gym_pages set taken_down_at = now() where gym_id = pg_temp.g('T')::uuid;
select is(pg_temp.visible('T'), 0, 'taken_down_at hides the page');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.val(pg_temp.pub('T', 'classic')), 'P0001:publish_gym_page: taken_down', 'publish is refused with the typed taken_down error');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.pub('T', 'classic')), 'P0001:publish_gym_page: taken_down', 'a Super Admin is refused too');
reset role;
select is(pg_temp.visible('T') || '|' || pg_temp.page('T', 'unpublished_at'), '0|null', 'the refusals changed nothing');
update gym_pages set taken_down_at = null where gym_id = pg_temp.g('T')::uuid;
select is(pg_temp.visible('T'), 1, 'control: clearing the takedown shows the page again');
-- the name must be ACTIVE: a page still pointing at a name row that is no longer active is hidden before any refresh runs (mutation proof)
savepoint name_state;
update page_names set state = 'redirect' where gym_id = pg_temp.g('T')::uuid and state = 'active';
select is(pg_temp.visible('T'), 0, 'a page whose name row is no longer active is hidden');
rollback to savepoint name_state;
select is(pg_temp.visible('T'), 1, 'control: undoing the state change shows the page again');
-- a taken-down NAME: the page is hidden and the gate then fails with no_name
update page_names set taken_down_at = now() where gym_id = pg_temp.g('T')::uuid and state = 'active';
select is(pg_temp.visible('T'), 0, 'a taken-down name hides the page');
select pg_temp.settle();
select is(pg_temp.page('T', 'unpublished_reason'), 'no_name', 'and the page unpublishes itself with no_name');
insert into covered select unnest(private.gym_page_gate_missing(pg_temp.g('T')::uuid));

-- ---- suspension keeps the snapshot and the name (option B) -----------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val($$select pg_temp.complete('S', 'sleep-gym-s', '$$ || pg_temp.pl('S') || $$', 30)$$), '{"missing": [], "published": true}', 'gym S is published');
reset role;
select is(pg_temp.visible('S'), 1, 'S is visible');
update gyms set status = 'suspended' where id = pg_temp.g('S')::uuid;
select pg_temp.settle();
select is(pg_temp.visible('S'), 0, 'suspending the gym hides the page');
select is(pg_temp.page('S', 'unpublished_at') || '|' || (select (content ->> 'name') from gym_pages where gym_id = pg_temp.g('S')::uuid), 'null|PUBLISH GYM S', 'the snapshot is kept and the page is not unpublished');
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('S')::uuid and state = 'active'), 'the name idle clock started at suspension');
update page_names set reserved_until = now() + interval '1 month' where gym_id = pg_temp.g('S')::uuid and state = 'active';
select private.page_names_sweep();
select is((select state from page_names where gym_id = pg_temp.g('S')::uuid and name = 'sleep-gym-s'), 'active', '11 months in: the sweep keeps the name');
select is(pg_temp.page('S', 'unpublished_at'), 'null', 'and the page');
update gyms set status = 'active' where id = pg_temp.g('S')::uuid;
select pg_temp.settle();
select is(pg_temp.visible('S'), 1, 'reactivation under 12 months: the page is back, the name still held');
select is((select reserved_until from page_names where gym_id = pg_temp.g('S')::uuid and state = 'active'), null, 'and the idle clock is cleared');

-- 13 months: the sweep unpublishes, releases the name and its redirects, tells the Owner
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val($$select pg_temp.complete('R', 'rest-box-r', '$$ || pg_temp.pl('R') || $$', 40)$$), '{"missing": [], "published": true}', 'gym R is published');
select pg_temp.as_user(pg_temp.u('ownerR'), 'owner', pg_temp.g('R'));
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('R') || $$', 'rest-box-r2')->>'state'$$), 'active', 'and renamed once by its Owner (so a redirect exists)');
reset role;
select pg_temp.settle();
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
update gyms set status = 'suspended' where id = pg_temp.g('R')::uuid;
select pg_temp.settle();
update page_names set reserved_until = now() - interval '1 month' where gym_id = pg_temp.g('R')::uuid and state = 'active';
select set_config('request.jwt.claims', '', true);
select private.page_names_sweep();
select is(pg_temp.page('R', 'unpublished_reason'), 'name_released', '13 months in: the sweep unpublishes the page (reason name_released)');
select is((select string_agg(name || ':' || state, ',' order by name) from page_names where gym_id = pg_temp.g('R')::uuid), 'rest-box-r:released,rest-box-r2:released', 'the name and its redirect are released');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('R')::uuid and notice_type = 'page_unpublished' and user_id = pg_temp.u('ownerR')::uuid
            and title_en = 'Your page name was released' and title_fr = 'Le nom de votre page a été libéré' and body_en like '%not active for 12 months%' and body_fr like '%pendant 12 mois%'), 1,
          'the Owner is told, EN and FR');
select is((select count(*)::int from audit_log where action_type = 'gym_page_unpublished' and gym_id = pg_temp.g('R')::uuid and metadata ->> 'reason' = 'name_released' and actor_display_name = 'system:page_names_sweep'), 1,
          'the sweep audits the unpublish');
select is((select count(*)::int from audit_log where action_type = 'page_name_released' and gym_id = pg_temp.g('R')::uuid and metadata ->> 'from_state' = 'active'), 1, 'and the name release (as before)');
select is((select string_agg(status::text, ',') from job_runs where job_name = 'page_names_sweep' and started_at = now()), 'success,success', 'both sweeps logged success');
select private.page_names_sweep();
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('R')::uuid and notice_type = 'page_unpublished'), 1, 'a second sweep tells no one again');
-- reactivation after release: the page does not come back; the Owner must claim a name and publish again
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
update gyms set status = 'active' where id = pg_temp.g('R')::uuid;
select pg_temp.settle();
select is(pg_temp.visible('R'), 0, 'reactivation after release: the page stays offline');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerR'), 'owner', pg_temp.g('R'));
select is(pg_temp.val(pg_temp.pub('R')), '{"missing": ["no_name"], "published": false}', 'publish says no_name');
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('R') || $$', 'rest-box-new')->>'state'$$), 'active', 'the Owner claims a name');
select is(pg_temp.val(pg_temp.pub('R')), '{"missing": [], "published": true}', 'and publishes');
reset role;
select is(pg_temp.visible('R'), 1, 'the page is back under the new name');

-- unpublish is always allowed, also for a suspended gym; publish is not
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val($$select pg_temp.complete('Q', 'quiet-gym-q', '$$ || pg_temp.pl('Q') || $$', 50)$$), '{"missing": [], "published": true}', 'gym Q is published');
reset role;
update gyms set status = 'suspended' where id = pg_temp.g('Q')::uuid;
select pg_temp.settle();
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerQ'), 'owner', pg_temp.g('Q'));
select alike(pg_temp.val(pg_temp.pub('Q', 'classic')), 'P0001:publish_gym_page: gym % is not active', 'an Owner of a suspended gym cannot publish');
select pg_temp.as_user(pg_temp.u('supQ'), 'supervisor', pg_temp.g('Q'));
select is(pg_temp.val(pg_temp.unpub('Q')), 'true', 'matrix row "unpublish, Supervisor, suspended gym": allowed');
reset role;
select ok(pg_temp.page('Q', 'unpublished_at') <> 'null' and pg_temp.page('Q', 'unpublished_reason') = 'owner' and pg_temp.visible('Q') = 0, 'unpublished_at set, reason owner, and the view returns no row');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.pub('Q')), '{"missing": [], "published": true}', 'a Super Admin may publish for a suspended gym');
reset role;
select is(pg_temp.visible('Q'), 0, 'but the suspended gym''s page stays hidden by the predicate');

-- ---- every refresh trigger on a PUBLISHED gym (gym P): plans, contact, hours, text, position, country, media delete -------------------------------
-- Flush everything pending from the sections above as a Super Admin first (an audit row for a gym needs its own caller or a Super Admin).
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select pg_temp.settle();
set local role authenticated;
select is(pg_temp.val($$select pg_temp.complete('P', 'pulse-box', '$$ || pg_temp.pl('P1') || $$', 70)$$), '{"missing": [], "published": true}', 'gym P is published');
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"services_en":"Cardio","address":"Rue 5","contact_whatsapp":"+237600555001","lat":4.0,"lng":9.0}',
  jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('P2') || $$', 'is_public', true)))$$), 'ok', 'owner adds services, address, WhatsApp, a position and a second public plan');
reset role;
select pg_temp.settle();
select is(pg_temp.visible('P') || '|' || jsonb_array_length((select content -> 'plans' from gym_pages where gym_id = pg_temp.g('P')::uuid)), '1|2', 'P is live with two public plans in its snapshot');

-- (a) every plan column in the snapshot: price, currency, interval, type, duration_days
select is((select content -> 'plans' @> '[{"name":"MONTHLY","price":12000,"currency":"EUR","interval":"annual","type":"class_only","duration_days":60}]'::jsonb
             from gym_pages where gym_id = pg_temp.g('P')::uuid), false, 'control: the snapshot does not have the new plan values yet');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select update_plan_pricing('$$ || pg_temp.pl('P1') || $$', 'class_only', 12000, 60, 'annual', 10)$$), 'ok', 'owner changes type, price, duration and interval of a public plan');
reset role;
update plans set currency = 'EUR' where id = pg_temp.pl('P1')::uuid;
select pg_temp.settle();
select is((select content -> 'plans' @> '[{"name":"MONTHLY","price":12000,"currency":"EUR","interval":"annual","type":"class_only","duration_days":60}]'::jsonb
             from gym_pages where gym_id = pg_temp.g('P')::uuid), true, 'price, currency, billing interval, plan type and duration all reached the snapshot');
select is(pg_temp.visible('P'), 1, 'and the page is still live');

-- (d) hours, services, address, position, country
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"hours":{"tue":{"open":"07:00","close":"20:00"}}}')$$), 'ok', 'owner edits the hours');
reset role;
select pg_temp.settle();
select is((select content -> 'hours' from gym_pages where gym_id = pg_temp.g('P')::uuid), '{"tue":{"open":"07:00","close":"20:00"}}'::jsonb, 'the hours changed in the snapshot');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"services_en":"Cardio and yoga"}')$$), 'ok', 'owner edits the services');
reset role;
select pg_temp.settle();
select is((select content ->> 'services_en' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'Cardio and yoga', 'the services changed in the snapshot');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"address":"Rue 9, Bonanjo"}')$$), 'ok', 'owner edits the address');
reset role;
select pg_temp.settle();
select is((select content ->> 'address' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'Rue 9, Bonanjo', 'the address changed in the snapshot');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"lat":5.5,"lng":10.5}')$$), 'ok', 'owner moves the position (both coordinates)');
reset role;
select pg_temp.settle();
select is((select (content -> 'map' ->> 'lat') || '|' || (content -> 'map' ->> 'lng') from gym_pages where gym_id = pg_temp.g('P')::uuid), '5.500000|10.500000', 'the position changed in the snapshot');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
update gyms set country = 'GA' where id = pg_temp.g('P')::uuid;
select pg_temp.settle();
select is((select content ->> 'country' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'GA', 'the country changed in the snapshot');

-- (e) ONE watched column at a time on the live page (review pass 2). Each edit below changes exactly one column and settles alone, so a
-- column dropped from a refresh trigger's UPDATE OF list or WHEN clause cannot be covered by a sibling column changed in the same statement.
update gyms set name = 'Solo Name' where id = pg_temp.g('P')::uuid;
select pg_temp.settle();
select is((select content ->> 'name' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'SOLO NAME', 'single column: the gym name alone refreshes the snapshot');
update gyms set primary_color = '#010203' where id = pg_temp.g('P')::uuid;
select pg_temp.settle();
select is((select content ->> 'color' from gym_pages where gym_id = pg_temp.g('P')::uuid), '#010203', 'single column: the brand color alone refreshes the snapshot');
update gyms set default_language = 'fr' where id = pg_temp.g('P')::uuid;
select pg_temp.settle();
select is((select content ->> 'default_language' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'fr', '24.10, single column: the default language alone refreshes the snapshot');
update gyms set default_language = 'es' where id = pg_temp.g('P')::uuid;
select pg_temp.settle();
select is((select content ->> 'default_language' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'en', '24.10: a default language outside private.gym_page_languages() is written as the first language');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_category('$$ || pg_temp.g('P') || $$', 'pilates_studio')$$), 'ok', 'owner changes only the category');
reset role;
select pg_temp.settle();
select is((select content ->> 'category' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'pilates_studio', 'single column: the category alone refreshes the snapshot');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"city":"Solo City"}')$$), 'ok', 'owner changes only the city');
reset role;
select pg_temp.settle();
select is((select content ->> 'city' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'Solo City', 'single column: the city alone refreshes the snapshot');
-- 24.9 (owner decision 2026-11-08): the snapshot leaves out the text of a language whose About is under 100 characters, so P gets a
-- complete French About first (and that single column refreshes the snapshot on its own); the French services step below then shows up.
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', jsonb_build_object('about_fr', repeat('é', 100)))$$), 'ok', 'owner gives gym P a complete French About');
reset role;
select pg_temp.settle();
select is((select char_length(content ->> 'about_fr') from gym_pages where gym_id = pg_temp.g('P')::uuid), 100, 'single column: the French About alone refreshes the snapshot (it is complete, so it is published)');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"services_fr":"Cardio solo"}')$$), 'ok', 'owner changes only the French services');
reset role;
select pg_temp.settle();
select is((select content ->> 'services_fr' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'Cardio solo', 'single column: the French services alone refresh the snapshot');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{}', jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('P1') || $$', 'public_label_en', 'Solo label')))$$), 'ok', 'owner changes only the English plan label');
reset role;
select pg_temp.settle();
select is((select content #>> '{plans,0,label_en}' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'Solo label', 'single column: the English plan label alone refreshes the snapshot');
update plans set price = 13000 where id = pg_temp.pl('P1')::uuid;
select pg_temp.settle();
select is((select content #> '{plans,0,price}' = '13000'::jsonb from gym_pages where gym_id = pg_temp.g('P')::uuid), true, 'single column: the plan price alone refreshes the snapshot');
update plans set plan_type = 'monthly' where id = pg_temp.pl('P1')::uuid;
select pg_temp.settle();
select is((select content #>> '{plans,0,type}' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'monthly', 'single column: the plan type alone refreshes the snapshot');
update plans set duration_days = 90 where id = pg_temp.pl('P1')::uuid;
select pg_temp.settle();
select is((select content #> '{plans,0,duration_days}' = '90'::jsonb from gym_pages where gym_id = pg_temp.g('P')::uuid), true, 'single column: the plan duration alone refreshes the snapshot');
update plans set billing_interval = 'monthly', annual_discount_percent = null where id = pg_temp.pl('P1')::uuid; -- the CHECK ties the discount to the interval; the discount is not a watched column, so the interval is still the only term that can fire
select pg_temp.settle();
select is((select content #>> '{plans,0,interval}' from gym_pages where gym_id = pg_temp.g('P')::uuid), 'monthly', 'single column: the plan billing interval alone refreshes the snapshot');
select is(pg_temp.visible('P'), 1, 'and the page is still live after the ten single-column edits');

-- (c) clearing both contact numbers unpublishes with no_contact
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"contact_phone":null,"contact_whatsapp":null}')$$), 'ok', 'owner clears both contact numbers');
reset role;
select pg_temp.settle();
select is(pg_temp.page('P', 'unpublished_reason') || '|' || pg_temp.visible('P'), 'no_contact|0', 'the page unpublishes itself with no_contact');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('P') || $$', '{"contact_whatsapp":"+237600555002"}')$$), 'ok', 'owner adds a WhatsApp number');
select is(pg_temp.val(pg_temp.pub('P')), '{"missing": [], "published": true}', 'and republishes');
reset role;

-- settle first: a deferred event left over from the edits above would fire at the settle below and unpublish the page, masking a missing delete trigger
select pg_temp.settle();
-- hard delete of a LIVE media row (no client can; an operator or a purge can): the snapshot key would point at a gone object
delete from gym_page_media where gym_id = pg_temp.g('P')::uuid and kind = 'logo' and deleted_at is null;
select is(pg_temp.visible('P'), 1, 'control: inside the transaction nothing has been judged yet');
select pg_temp.settle();
select is(pg_temp.page('P', 'unpublished_reason') || '|' || pg_temp.visible('P'), 'no_logo|0', 'hard-deleting the live logo unpublishes the page with no_logo');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.err(pg_temp.reg('P', 'logo', 72)), 'ok', 'owner registers a new logo');
select is(pg_temp.val(pg_temp.pub('P')), '{"missing": [], "published": true}', 'and republishes');
reset role;
delete from gym_page_media where gym_id = pg_temp.g('P')::uuid and kind = 'logo' and deleted_at is not null;
select pg_temp.settle();
select is(pg_temp.visible('P'), 1, 'hard-deleting an already soft-deleted row does not touch the page (no trigger fires)');

-- (b) deleting public plans: one of two shrinks the snapshot, the last one unpublishes with a notice
delete from plans where id = pg_temp.pl('P2')::uuid;
select pg_temp.settle();
select is((select jsonb_array_length(content -> 'plans') from gym_pages where gym_id = pg_temp.g('P')::uuid) || '|' || pg_temp.visible('P'), '1|1', 'deleting one of two public plans shrinks the snapshot; the page stays live');
delete from plans where id = pg_temp.pl('P1')::uuid;
select pg_temp.settle();
select is(pg_temp.page('P', 'unpublished_reason') || '|' || pg_temp.visible('P'), 'no_public_plan|0', 'deleting the last public plan unpublishes the page with no_public_plan');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('P')::uuid and notice_type = 'page_unpublished' and user_id = pg_temp.u('ownerP')::uuid
            and body_en like '%at least one public plan%' and body_fr like '%au moins un abonnement public%'), 1, 'and the Owner is told, EN and FR');

-- ---- witnesses that need the schema relaxed: category and country are NOT NULL with CHECKs, so these two codes are defensive ----------------------------
select pg_temp.settle();
alter table gyms alter column category drop not null;
alter table gyms alter column country drop not null;
alter table gyms drop constraint gyms_category_valid;
alter table gyms drop constraint gyms_country_iso2;
alter table gyms disable trigger pin_gym_category;
update gyms set category = null, country = null where id = pg_temp.g('N')::uuid;
select ok(pg_temp.see('N') like '%no_category%', 'no_category: a gym with no category');
select ok(pg_temp.see('N') like '%no_country%', 'no_country: a gym with no country');

-- ---- consumers enumerated: a new writer, a new gate code without a failing case, or a new reader fails here ----------------------------------------------------
select is((select array_agg(proname::text order by proname) from pg_proc
            where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f'
              and prosrc ~* '(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(public\.)?gym_pages\M'),
          array['page_names_sweep', 'publish_gym_page', 'refresh_gym_page', 'unpublish_gym_page']::text[],
          'the functions that write gym_pages are exactly the four allowlisted (24.11 adds its takedown writer here deliberately)');
select is((select array_agg(proname::text order by proname) from pg_proc
            where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f' and prosrc ~* '\mgym_pages\M'),
          array['get_gym_page_status', 'page_name_has_published_page', 'page_names_sweep', 'publish_gym_page', 'refresh_gym_page', 'unpublish_gym_page']::text[],
          'the functions that mention gym_pages at all are those four, the name-published predicate and the 24.9 status read (a new reader is listed deliberately)');
select is((select count(*)::int from pg_proc where proname in ('publish_gym_page', 'unpublish_gym_page', 'refresh_gym_page', 'page_names_sweep') and prosecdef and proconfig = array['search_path=public']), 4,
          'every gym_pages writer is security definer with a pinned search_path');
select is((select array_agg(distinct m[1] order by m[1]) from pg_proc, regexp_matches(prosrc, 'array_append\(v_missing, ''([a-z_]+)''\)', 'g') m where proname = 'gym_page_gate_missing'),
          (select array_agg(distinct code order by code) from covered),
          'every gate code in the function has a failing case in this file (and this file saw no other code)');
select is((select count(*)::int from (select distinct m[1] c from pg_proc, regexp_matches(prosrc, 'array_append\(v_missing, ''([a-z_]+)''\)', 'g') m where proname = 'gym_page_gate_missing') x
            where private.gym_page_gate_phrase(c, 'en') is null or private.gym_page_gate_phrase(c, 'fr') is null), 0, 'every gate code has English and French notice copy');
select is((select count(*)::int from pg_proc where proname = 'publish_gym_page' and prosrc ~* 'is_super_admin_live' and prosrc ~* 'support_rpc_gym_id\(''publish_gym_page''\)'
            and prosrc ~* 'support_rpc_role\(''publish_gym_page''\) in \(''owner'', ''supervisor''\)' and prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''), 1,
          'publish_gym_page admits exactly owner and supervisor (plus super admin and live support at the supervisor ceiling) and requires an active gym');
select is((select count(*)::int from pg_proc where proname = 'unpublish_gym_page' and prosrc ~* 'is_super_admin_live' and prosrc ~* 'support_rpc_gym_id\(''unpublish_gym_page''\)'
            and prosrc ~* 'support_rpc_role\(''unpublish_gym_page''\) in \(''owner'', ''supervisor''\)' and prosrc !~* 'current_gym_status'), 1,
          'unpublish_gym_page admits the same roles and has no gym-status check (always allowed)');
select is((select array_agg(distinct c.relname::text order by c.relname::text) from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
            where d.refobjid = 'private.gym_page_visible'::regclass and c.relnamespace = 'public_site'::regnamespace and c.relkind = 'v' and c.oid <> d.refobjid),
          array['page_media', 'page_redirects', 'pages'], 'the public_site views (pages, page_media and, from 24.10, page_redirects) are all built on the one visibility predicate');
select is((select count(*)::int from pg_class c join pg_depend d on d.refobjid = 'public.gym_pages'::regclass and d.deptype = 'n' join pg_rewrite r on r.oid = d.objid and r.ev_class = c.oid
            where c.relnamespace = 'public_site'::regnamespace), 0, 'neither public_site view reads gym_pages directly');

select * from finish();
rollback;
