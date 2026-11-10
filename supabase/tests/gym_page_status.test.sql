-- Story 24.9: get_gym_page_status (migration 0165), the language completeness rule in the snapshot, and the shared content fixture.
-- Fixture ids: 00000000-0000-0000-0000-0000002409xx. gyms 11-20, users 31-46, members 51-65, plans 71-86.
--
-- The refresh triggers are DEFERRED constraint triggers (they judge a transaction's final state, at commit). This whole file is one
-- transaction, so `pg_temp.settle()` stands for "commit": it fires the pending triggers now.
begin;
select plan(129);

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
  select '00000000-0000-0000-0000-0000002409' || case c when 'A' then '11' when 'B' then '12' when 'S' then '13' when 'T' then '14' when 'R' then '15'
    when 'L' then '16' when 'X' then '17' when 'N' then '18' when 'Z' then '19' when 'F' then '20' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002409' || case c when 'ownerA' then '31' when 'supA' then '32' when 'mgrA' then '33' when 'coachA' then '34'
    when 'memberA' then '35' when 'ownerB' then '36' when 'admin' then '37' when 'support' then '38' end $f$;
create or replace function pg_temp.pl(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002409' || case c when 'A1' then '71' when 'A2' then '72' when 'A3' then '73' when 'S' then '74' when 'T' then '75'
    when 'R' then '76' when 'L' then '77' when 'X1' then '78' when 'X2' then '79' when 'B' then '80' end $f$;
create or replace function pg_temp.dk(n int) returns text language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0') || '.webp' $f$;
create or replace function pg_temp.reg(gym text, kind text, n int) returns text language sql as $f$
  select format($q$select register_page_media(%L, %L, %L, %L, true, 'v1')$q$, pg_temp.g(gym), kind, pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'), pg_temp.dk(n)) $f$;
create or replace function pg_temp.mid(n int) returns text language sql security definer as $f$ select id::text from public.gym_page_media where derivative_key = pg_temp.dk(n) $f$;
create or replace function pg_temp.pub(gym text, tpl text default null) returns text language sql as $f$
  select format($q$select publish_gym_page(%L, %L)::text$q$, pg_temp.g(gym), tpl) $f$;
create or replace function pg_temp.unpub(gym text) returns text language sql as $f$ select format($q$select unpublish_gym_page(%L)::text$q$, pg_temp.g(gym)) $f$;
create or replace function pg_temp.settle() returns void language plpgsql as $f$ begin set constraints all immediate; set constraints all deferred; end $f$;
create or replace function pg_temp.page(gym text, col text) returns text language plpgsql security definer as $f$
declare v text; begin execute format('select %s::text from public.gym_pages where gym_id = %L', col, pg_temp.g(gym)) into v; return coalesce(v, 'null'); end $f$;
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
-- gate codes seen in a status answer, for the enumeration at the end
create temp table covered (code text);
-- The status as the CURRENT claims see it, called as the `authenticated` role (so the grants are exercised). An error becomes {"error": ...}.
create or replace function pg_temp.stat(gym text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role authenticated;
  begin
    v := public.get_gym_page_status(pg_temp.g(gym)::uuid);
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  insert into pg_temp.covered select jsonb_array_elements_text(v -> 'missing');
  return v;
end $f$;
create or replace function pg_temp.sstate(gym text) returns text language sql as $f$ select pg_temp.stat(gym) ->> 'state' $f$;
create or replace function pg_temp.smiss(gym text) returns text language sql as $f$
  select coalesce((select string_agg(x, ',' order by ord) from jsonb_array_elements_text(pg_temp.stat(gym) -> 'missing') with ordinality t(x, ord)), '') $f$;
-- a gym brought to publishable and published in one call (the caller's claims must be a Super Admin's)
create or replace function pg_temp.complete(gym text, nm text, plan_id text, n int) returns text language plpgsql as $f$
begin
  perform set_gym_page_content(pg_temp.g(gym)::uuid,
    jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'about_fr', repeat('Cette salle est complete. ', 6), 'services_en', 'Cardio', 'services_fr', 'Cardio FR',
                       'city', 'Douala', 'contact_phone', '+237600555000',
                       'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'is_public', true)));
  perform claim_page_name(pg_temp.g(gym)::uuid, nm);
  perform register_page_media(pg_temp.g(gym)::uuid, 'logo', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'), pg_temp.dk(n), true, 'v1');
  perform register_page_media(pg_temp.g(gym)::uuid, 'banner', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad((n + 1)::text, 12, '0'), pg_temp.dk(n + 1), true, 'v1');
  return publish_gym_page(pg_temp.g(gym)::uuid, 'classic')::text;
end $f$;

-- The shared content fixture (packages/types/src/fixtures/pageContentCases.json), also run by apps/dashboard/lib/pageContentFixture.test.ts,
-- which fails when the text between the two $fx$ markers differs from the file.
-- FIXTURE:BEGIN
create temp table fxdoc as select $fx${
  "_comment": "Story 24.9. ONE valid/invalid fixture for the page content rules, run by apps/dashboard/lib/pageContentFixture.test.ts (Zod: gymPageContentSchema) and supabase/tests/gym_page_status.test.sql (set_gym_page_content, 0161). The pgTAP file embeds this file between FIXTURE:BEGIN and FIXTURE:END markers; the vitest fails when the two differ. A case gives `content` or `gen` (key + unit repeated times, for long strings), and the expected outcome per side: `zod` and `sql` (true = accepted). `languages` is the content-language list: the TypeScript list and private.gym_page_languages() must both equal it. Where the two sides deliberately differ the case says why in `note`.",
  "languages": ["en", "fr"],
  "cases": [
    { "id": "about_2000_ascii", "gen": { "key": "about_en", "unit": "a", "times": 2000 }, "zod": true, "sql": true },
    { "id": "about_2001_ascii", "gen": { "key": "about_en", "unit": "a", "times": 2001 }, "zod": false, "sql": false },
    { "id": "about_2000_emoji", "gen": { "key": "about_fr", "unit": "😀", "times": 2000 }, "zod": true, "sql": true, "note": "2000 code points are 4000 UTF-16 units: both sides count code points" },
    { "id": "about_2001_emoji", "gen": { "key": "about_fr", "unit": "😀", "times": 2001 }, "zod": false, "sql": false },
    { "id": "services_2000_ascii", "gen": { "key": "services_en", "unit": "s", "times": 2000 }, "zod": true, "sql": true },
    { "id": "services_2001_ascii", "gen": { "key": "services_fr", "unit": "s", "times": 2001 }, "zod": false, "sql": false },
    { "id": "address_300", "gen": { "key": "address", "unit": "x", "times": 300 }, "zod": true, "sql": true },
    { "id": "address_301", "gen": { "key": "address", "unit": "x", "times": 301 }, "zod": false, "sql": false },
    { "id": "city_100_emoji", "gen": { "key": "city", "unit": "🏙", "times": 100 }, "zod": true, "sql": true },
    { "id": "city_101_emoji", "gen": { "key": "city", "unit": "🏙", "times": 101 }, "zod": false, "sql": false },
    { "id": "about_lt", "content": { "about_en": "a < b" }, "zod": false, "sql": false },
    { "id": "about_gt", "content": { "about_en": "a > b" }, "zod": false, "sql": false },
    { "id": "services_markup", "content": { "services_fr": "<b>x</b>" }, "zod": false, "sql": false },
    { "id": "address_gt", "content": { "address": "Rue 1 > Rue 2" }, "zod": false, "sql": false },
    { "id": "about_blank_clears", "content": { "about_en": "   " }, "zod": true, "sql": true },
    { "id": "about_null_clears", "content": { "about_fr": null }, "zod": true, "sql": true },
    { "id": "about_lf_kept", "content": { "about_en": "line one\nline two" }, "zod": true, "sql": true },
    { "id": "about_number", "content": { "about_en": 5 }, "zod": false, "sql": false },
    { "id": "lat_90", "content": { "lat": 90 }, "zod": true, "sql": true },
    { "id": "lat_neg_90", "content": { "lat": -90 }, "zod": true, "sql": true },
    { "id": "lat_90_0000004", "content": { "lat": 90.0000004 }, "zod": false, "sql": true, "note": "SQL rounds to 6 places first (90.000000, in range); Zod checks the number as typed and is stricter" },
    { "id": "lat_90_0000006", "content": { "lat": 90.0000006 }, "zod": false, "sql": false },
    { "id": "lat_neg_90_0000004", "content": { "lat": -90.0000004 }, "zod": false, "sql": true, "note": "as lat_90_0000004" },
    { "id": "lng_180", "content": { "lng": 180 }, "zod": true, "sql": true },
    { "id": "lng_180_0000004", "content": { "lng": 180.0000004 }, "zod": false, "sql": true, "note": "as lat_90_0000004" },
    { "id": "lng_180_0000006", "content": { "lng": 180.0000006 }, "zod": false, "sql": false },
    { "id": "lat_many_places", "content": { "lat": 4.0511231234 }, "zod": true, "sql": true, "note": "SQL stores 4.051123" },
    { "id": "lat_string", "content": { "lat": "4.05" }, "zod": false, "sql": false },
    { "id": "lat_null_clears", "content": { "lat": null }, "zod": true, "sql": true },
    { "id": "phone_valid", "content": { "contact_phone": "+237600555000" }, "zod": true, "sql": true },
    { "id": "phone_whatsapp_valid", "content": { "contact_whatsapp": "+14155550123" }, "zod": true, "sql": true },
    { "id": "phone_no_plus", "content": { "contact_phone": "237600555000" }, "zod": false, "sql": false },
    { "id": "phone_leading_zero", "content": { "contact_phone": "+0237600555" }, "zod": false, "sql": false },
    { "id": "phone_too_short", "content": { "contact_phone": "+2376005" }, "zod": false, "sql": false },
    { "id": "phone_too_long", "content": { "contact_phone": "+2376005550001234" }, "zod": false, "sql": false },
    { "id": "phone_empty_clears", "content": { "contact_whatsapp": "" }, "zod": true, "sql": true },
    { "id": "hours_valid", "content": { "hours": { "mon": { "open": "06:00", "close": "22:00" }, "sun": null } }, "zod": true, "sql": true },
    { "id": "hours_null_clears", "content": { "hours": null }, "zod": true, "sql": true },
    { "id": "hours_overnight", "content": { "hours": { "fri": { "open": "20:00", "close": "02:00" } } }, "zod": true, "sql": true },
    { "id": "hours_open_equals_close", "content": { "hours": { "mon": { "open": "06:00", "close": "06:00" } } }, "zod": false, "sql": false },
    { "id": "hours_bad_time", "content": { "hours": { "mon": { "open": "24:00", "close": "22:00" } } }, "zod": false, "sql": false },
    { "id": "hours_empty_object", "content": { "hours": {} }, "zod": false, "sql": false },
    { "id": "hours_unknown_day", "content": { "hours": { "funday": { "open": "06:00", "close": "22:00" } } }, "zod": false, "sql": false },
    { "id": "hours_extra_key", "content": { "hours": { "mon": { "open": "06:00", "close": "22:00", "note": "x" } } }, "zod": false, "sql": false }
  ]
}$fx$::jsonb as doc;
-- FIXTURE:END
create temp table fx as select c from fxdoc, jsonb_array_elements(doc -> 'cases') c;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000240901', 'Status Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('A')::uuid, 'Status Gym A', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('B')::uuid, 'Status Gym B', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('S')::uuid, 'Status Gym S', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('T')::uuid, 'Status Gym T', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('R')::uuid, 'Status Gym R', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('L')::uuid, 'Status Gym L', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('X')::uuid, 'Status Gym X', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('N')::uuid, 'Status Gym N', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('Z')::uuid, 'Status Gym Z', '00000000-0000-0000-0000-000000240901'),
  (pg_temp.g('F')::uuid, 'Status Gym F', '00000000-0000-0000-0000-000000240901');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerA')::uuid, 'ownerA-2409@x.example', now()),
  (pg_temp.u('supA')::uuid, 'supA-2409@x.example', now()),
  (pg_temp.u('mgrA')::uuid, 'mgrA-2409@x.example', now()),
  (pg_temp.u('coachA')::uuid, 'coachA-2409@x.example', now()),
  (pg_temp.u('memberA')::uuid, 'memberA-2409@x.example', now()),
  (pg_temp.u('ownerB')::uuid, 'ownerB-2409@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2409@x.example', now()),
  (pg_temp.u('support')::uuid, 'sup-2409@gymosapps.com', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000240951', pg_temp.g('A')::uuid, pg_temp.u('ownerA')::uuid, 'owner',      'ST Owner A',      '+237600240901', current_date),
  ('00000000-0000-0000-0000-000000240952', pg_temp.g('A')::uuid, pg_temp.u('supA')::uuid,   'supervisor', 'ST Supervisor A', '+237600240902', current_date),
  ('00000000-0000-0000-0000-000000240953', pg_temp.g('A')::uuid, pg_temp.u('mgrA')::uuid,   'manager',    'ST Manager A',    '+237600240903', current_date),
  ('00000000-0000-0000-0000-000000240954', pg_temp.g('A')::uuid, pg_temp.u('coachA')::uuid, 'coach',      'ST Coach A',      '+237600240904', current_date),
  ('00000000-0000-0000-0000-000000240955', pg_temp.g('A')::uuid, pg_temp.u('memberA')::uuid,'member',     'ST Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000240956', pg_temp.g('B')::uuid, pg_temp.u('ownerB')::uuid, 'owner',      'ST Owner B',      '+237600240906', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  (pg_temp.pl('A1')::uuid, pg_temp.g('A')::uuid, 'Monthly',     'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('A2')::uuid, pg_temp.g('A')::uuid, 'Per Session', 'pay_per_session', 2000, 'monthly', null),
  (pg_temp.pl('A3')::uuid, pg_temp.g('A')::uuid, 'Staff Only',  'monthly', 5000, 'monthly', 30),
  (pg_temp.pl('S')::uuid, pg_temp.g('S')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('T')::uuid, pg_temp.g('T')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('R')::uuid, pg_temp.g('R')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('L')::uuid, pg_temp.g('L')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('X1')::uuid, pg_temp.g('X')::uuid, 'Hostile <b> plan', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('X2')::uuid, pg_temp.g('X')::uuid, 'Private <i> plan', 'monthly', 12000, 'monthly', 30),
  (pg_temp.pl('B')::uuid, pg_temp.g('B')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30);
-- support: live and assigned to gym A
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u('support')::uuid, now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240981', pg_temp.u('support')::uuid, pg_temp.g('A')::uuid, 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000249a1', pg_temp.u('support')::uuid, now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000249a1', pg_temp.u('support')::uuid, now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000240981', true);

-- ---- A. catalog ----------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_gym_page_status' and prosecdef and provolatile = 's'
            and proconfig = array['search_path=public']), 1, 'get_gym_page_status is a stable security definer function with a pinned search_path');
select is(has_function_privilege('anon', 'public.get_gym_page_status(uuid)', 'execute') or has_function_privilege('public', 'public.get_gym_page_status(uuid)', 'execute'), false, 'anon and PUBLIC cannot execute it');
select is(has_function_privilege('authenticated', 'public.get_gym_page_status(uuid)', 'execute'), true, 'authenticated can execute it');
select is((select count(*)::int from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'get_gym_page_status'), 1, 'it has its capability row');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace
            and p.proname in ('gym_page_languages', 'gym_page_lang_complete', 'gym_page_bad_text_fields', 'gym_page_snapshot')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'its private helpers are not executable by a client role');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_gym_page_status'
            and prosrc ~* '(insert\s+into|update\s+\w|delete\s+from|log_audit_event|set_config|perform\s+private\.(set_|refresh))'), 0, 'its source names no writer');
select is((select (regexp_match(prosrc, 'support_rpc_role\(''get_gym_page_status''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'get_gym_page_status'), '''owner'', ''supervisor''',
          'it admits exactly owner and supervisor (plus super admin and live support at the supervisor ceiling), as get_gym_page_name does');
select is(private.gym_page_languages(), (select array_agg(l order by ord) from (select l, ord from fxdoc, jsonb_array_elements_text(doc -> 'languages') with ordinality t(l, ord)) x),
          'the SQL language list is the fixture''s list (the TypeScript list is pinned to the same file)');
select is((select count(*)::int from unnest(private.gym_page_languages()) l
            where not exists (select 1 from information_schema.columns where table_name = 'gyms' and column_name = 'page_about_' || l)
               or not exists (select 1 from information_schema.columns where table_name = 'gyms' and column_name = 'page_services_' || l)), 0,
          'every listed language has its About and Services columns');

-- ---- B. who may read (matrix: role) ------------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.sstate('A'), 'not_started', 'the gym''s Owner reads a fresh gym: not_started');
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.sstate('A'), 'not_started', 'the Supervisor reads it');
select pg_temp.as_user(pg_temp.u('mgrA'), 'manager', pg_temp.g('A'));
select is(pg_temp.stat('A') ->> 'error', 'P0001:permission denied', 'a Manager is refused');
select pg_temp.as_user(pg_temp.u('coachA'), 'coach', pg_temp.g('A'));
select is(pg_temp.stat('A') ->> 'error', 'P0001:permission denied', 'a Coach is refused');
select pg_temp.as_user(pg_temp.u('memberA'), 'member', pg_temp.g('A'));
select is(pg_temp.stat('A') ->> 'error', 'P0001:permission denied', 'a member is refused');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.stat('A') ->> 'error', 'P0001:permission denied', 'another gym''s Owner is refused');
select is(pg_temp.stat('B') ->> 'state', 'not_started', 'control: that Owner reads their own gym');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.sstate('A'), 'not_started', 'live-assigned support reads the gym it is assigned to');
select is(pg_temp.stat('B') ->> 'error', 'P0001:permission denied', 'and not another gym');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.sstate('A'), 'not_started', 'a live Super Admin reads any gym');
select is(pg_temp.stat('A') -> 'missing' is not null, true, 'control: the answer carries the missing codes');
select is(pg_temp.err($$select get_gym_page_status('00000000-0000-0000-0000-0000002409ff')$$), 'P0001:get_gym_page_status: gym not found', 'a Super Admin asking for an unknown gym gets "gym not found"');
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select get_gym_page_status(null)$$), 'P0001:permission denied', 'a null gym is "permission denied", not an error that distinguishes gyms');
select is(pg_temp.err($$select get_gym_page_status('00000000-0000-0000-0000-0000002409ff')$$), 'P0001:permission denied', 'an unknown gym is "permission denied" for a non-admin: no probing');

-- ---- C. the states, in order ---------------------------------------------------------------------------------------------
-- not_started and in_progress (matrix row "gate not met": About 60 characters, no banner)
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.smiss('A'), 'no_name,no_logo,no_banner,about_short,no_city,no_contact,no_hours,no_public_plan', 'a fresh gym misses eight things, in the gate''s fixed order');
select is(pg_temp.stat('A') ->> 'template', null, 'no page row: template is null');
select is(pg_temp.stat('A') -> 'media', '[]'::jsonb, 'and no media');
select is(pg_temp.stat('A') -> 'languages', '[{"code":"en","complete":false,"characters":0,"needed":100},{"code":"fr","complete":false,"characters":0,"needed":100}]'::jsonb,
          'every language is listed, empty and 100 short');
select is(pg_temp.stat('A') ->> 'about_min_chars', '100', 'the threshold is part of the answer, so the About counter has no second copy of it');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_en', repeat('x', 60), 'about_fr', repeat(' ', 5) || repeat('é', 99) || repeat(' ', 5)))$$), 'ok', 'owner saves 60 English characters and 99 French ones padded with spaces');
reset role;
select is(pg_temp.sstate('A'), 'in_progress', 'content entered, gate not met: in_progress');
select is(pg_temp.stat('A') -> 'languages', '[{"code":"en","complete":false,"characters":60,"needed":40},{"code":"fr","complete":false,"characters":99,"needed":1}]'::jsonb,
          'English needs 40 more, French needs 1 more (padding counts for nothing)');
select ok(pg_temp.smiss('A') like '%about_short%', 'about_short is missing');
select is(pg_temp.stat('A') -> 'snapshot' ? 'about_en', false, 'an incomplete language is not in the would-be snapshot: no English About');
select is(pg_temp.stat('A') -> 'snapshot' ? 'about_fr', false, 'nor a French About of 99 characters');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_fr', repeat('é', 100), 'services_fr', 'Cardio FR', 'services_en', 'Cardio EN'))$$), 'ok', 'owner saves 100 French characters and services in both languages');
reset role;
select is(pg_temp.stat('A') -> 'languages' -> 1, '{"code":"fr","complete":true,"characters":100,"needed":0}'::jsonb, 'French is complete at exactly 100');
select is(pg_temp.smiss('A') like '%about_short%', false, 'one complete language is enough for the gate');
select is((pg_temp.stat('A') -> 'snapshot') ->> 'about_fr' is not null and (pg_temp.stat('A') -> 'snapshot') ->> 'services_fr' = 'Cardio FR', true, 'the complete language''s About and Services are in the would-be snapshot');
select is((pg_temp.stat('A') -> 'snapshot') ->> 'services_en' is null and (pg_temp.stat('A') -> 'snapshot') ->> 'about_en' is null, true,
          'while the English Services typed beside an incomplete English About are left out (typed text is kept, not shown)');
select is((select page_services_en from gyms where id = pg_temp.g('A')::uuid), 'Cardio EN', 'control: the English Services are still stored on the gym');

-- the rest of A's checklist, through the real paths
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('address', 'Rue 1, Akwa', 'city', 'Douala', 'lat', 4.0511, 'lng', 9.7679,
    'contact_phone', '+237600111222', 'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
  jsonb_build_array(jsonb_build_object('plan_id', '$$ || pg_temp.pl('A1') || $$', 'is_public', true), jsonb_build_object('plan_id', '$$ || pg_temp.pl('A2') || $$', 'is_public', true)))$$),
          'ok', 'owner fills in the rest and makes two plans public');
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('A') || $$', 'status-alpha')->>'state'$$), 'active', 'owner claims a name');
select is(pg_temp.err(pg_temp.reg('A', 'logo', 1)), 'ok', 'owner registers the logo');
reset role;
select is(pg_temp.smiss('A'), 'no_banner', 'only the banner is left');
select is(pg_temp.sstate('A'), 'in_progress', 'in_progress until the banner is there');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.reg('A', 'banner', 2)), 'ok', 'owner registers the banner');
select is(pg_temp.err(pg_temp.reg('A', 'gallery', 3)), 'ok', 'and two gallery images');
select is(pg_temp.err(pg_temp.reg('A', 'gallery', 4)), 'ok', 'two');
reset role;
update gyms set primary_color = '#1A2B3C' where id = pg_temp.g('A')::uuid;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.sstate('A'), 'ready', 'all met, nothing published: ready');
select is(pg_temp.smiss('A'), '', 'and nothing is missing');
select is(pg_temp.stat('A') ->> 'published_at', null, 'a page that is not live has no published_at');
select is(pg_temp.stat('A') -> 'unpublished_reasons', '[]'::jsonb, 'and no unpublish reason');
select is((select array_agg(m ->> 'kind' || ':' || (m ->> 'sort_order') order by ord) from jsonb_array_elements(pg_temp.stat('A') -> 'media') with ordinality t(m, ord)),
          array['banner:0', 'gallery:1', 'gallery:2', 'logo:0'], 'the media rows list kind and sort order (gallery order is the sort order)');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(m) k from jsonb_array_elements(pg_temp.stat('A') -> 'media') m) x), array['derivative_key', 'id', 'kind', 'sort_order'],
          'a media row carries exactly id, kind, derivative key and sort order (no gym id, no uploader, no original key)');
select is(pg_temp.stat('A') -> 'snapshot', private.gym_page_snapshot(pg_temp.g('A')::uuid), 'the snapshot in the answer is the builder''s output');

-- published, then owner unpublish
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": [], "published": true}', 'owner publishes');
reset role;
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.sstate('A'), 'published', 'live: published');
select is(pg_temp.stat('A') ->> 'template', 'classic', 'the template is reported');
select is(pg_temp.stat('A') ->> 'published_at' is not null, true, 'and published_at');
select is(pg_temp.stat('A') -> 'snapshot', (select content from gym_pages where gym_id = pg_temp.g('A')::uuid), 'a live page: the would-be snapshot equals the stored one');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.unpub('A')), 'true', 'owner unpublishes');
reset role;
select is(pg_temp.sstate('A'), 'ready', 'unpublished by the Owner: not an offline state, just ready again');
select is(pg_temp.stat('A') -> 'unpublished_reasons', '["owner"]'::jsonb, 'the reason is reported as the code owner');

-- auto-unpublish: offline_gate while the reason still holds, ready once it is fixed
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": [], "published": true}', 'owner republishes');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid(2))), 'ok', 'owner deletes the banner of the live page');
reset role;
select pg_temp.settle();
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.sstate('A'), 'offline_gate', 'the page unpublished itself: offline_gate');
select is(pg_temp.stat('A') -> 'unpublished_reasons', '["no_banner"]'::jsonb, 'with the failing code as the reason');
select is(pg_temp.smiss('A'), 'no_banner', 'and the code still missing');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.reg('A', 'banner', 5)), 'ok', 'owner adds a banner again');
reset role;
select pg_temp.settle();
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.sstate('A'), 'ready', 'the reason no longer holds: ready (not offline_gate)');
select is(pg_temp.stat('A') -> 'unpublished_reasons', '["no_banner"]'::jsonb, 'the recorded reason is still a fact in the answer');

-- several codes in checklist order
update gym_pages set unpublished_at = now(), unpublished_reason = 'no_logo,no_banner,map_incomplete' where gym_id = pg_temp.g('A')::uuid;
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set page_lng = null where id = pg_temp.g('A')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);
select pg_temp.settle();
select is(pg_temp.sstate('A'), 'offline_gate', 'a stored reason with several codes: offline_gate while one of them is still missing (map_incomplete)');
select is(pg_temp.stat('A') -> 'unpublished_reasons', '["no_logo","no_banner","map_incomplete"]'::jsonb, 'the codes are parsed in stored order');
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set page_lng = 9.7679 where id = pg_temp.g('A')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);
select pg_temp.settle();
select is(pg_temp.sstate('A'), 'ready', 'fixed: ready');

-- ---- suspended gym, name released, taken down ----------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val($$select pg_temp.complete('S', 'status-sus', '$$ || pg_temp.pl('S') || $$', 10)$$), '{"missing": [], "published": true}', 'gym S is published');
select pg_temp.settle();
select is(pg_temp.sstate('S'), 'published', 'S: published');
update gyms set status = 'suspended' where id = pg_temp.g('S')::uuid;
select is(pg_temp.sstate('S'), 'offline_suspended', 'a live page of a suspended gym: offline_suspended (the saved copy is kept)');
select is(pg_temp.stat('S') ->> 'published_at' is not null, true, 'and it still reports its published_at');
update gyms set status = 'active' where id = pg_temp.g('S')::uuid;
select is(pg_temp.sstate('S'), 'published', 'reactivated: published again');

select is(pg_temp.val($$select pg_temp.complete('R', 'status-rel', '$$ || pg_temp.pl('R') || $$', 20)$$), '{"missing": [], "published": true}', 'gym R is published');
update gym_pages set unpublished_at = now(), unpublished_reason = 'name_released' where gym_id = pg_temp.g('R')::uuid;
update page_names set state = 'released' where gym_id = pg_temp.g('R')::uuid and state = 'active';
select pg_temp.settle();
select is(pg_temp.sstate('R'), 'offline_name_released', 'name released and no active name: offline_name_released');
select is(pg_temp.stat('R') -> 'unpublished_reasons', '["name_released"]'::jsonb, 'with the reason name_released');
select is(pg_temp.smiss('R'), 'no_name', 'and the name missing');
select is(pg_temp.val($$select claim_page_name('$$ || pg_temp.g('R') || $$', 'status-rel2')->>'state'$$), 'active', 'a Super Admin claims a new name');
select pg_temp.settle();
select is(pg_temp.sstate('R'), 'ready', 'a name again: the release no longer holds, so ready');

select is(pg_temp.val($$select pg_temp.complete('T', 'status-tkd', '$$ || pg_temp.pl('T') || $$', 30)$$), '{"missing": [], "published": true}', 'gym T is published');
update gym_pages set taken_down_at = now() where gym_id = pg_temp.g('T')::uuid;
select is(pg_temp.sstate('T'), 'taken_down', 'the page row taken down: taken_down');
update gym_pages set taken_down_at = null where gym_id = pg_temp.g('T')::uuid;
select is(pg_temp.sstate('T'), 'published', 'cleared: published');
update page_names set taken_down_at = now() where gym_id = pg_temp.g('T')::uuid and state = 'active';
select is(pg_temp.sstate('T'), 'taken_down', 'the page name taken down: taken_down as well');
update page_names set taken_down_at = null where gym_id = pg_temp.g('T')::uuid and state = 'active';

-- ---- bad_text_fields: every field, named; private plans are not judged ---------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.stat('A') -> 'bad_text_fields', '[]'::jsonb, 'a clean gym has no bad text fields');
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set name = 'Status <b>Gym X', page_about_fr = 'Texte' || chr(1) || ' brut', page_services_en = 'Cardio' || chr(2), page_address = 'Rue' || chr(7) || ' 5', page_city = 'Dou' || chr(5) || 'ala'
 where id = pg_temp.g('X')::uuid;
update plans set is_public = true where id = pg_temp.pl('X1')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);
create temp table x_dirty as select pg_temp.stat('X') as s;
select is((select array_agg(coalesce(e ->> 'field', '?') || coalesce(':' || (e ->> 'lang'), '') || coalesce(':' || (e ->> 'plan_name'), '') order by e ->> 'field', e ->> 'lang')
             from x_dirty, jsonb_array_elements(s -> 'bad_text_fields') e),
          array['about:fr', 'address', 'city', 'gym_name', 'plan_name:HOSTILE <B> PLAN', 'services:en'],
          'bad_text_fields names the gym name, About (fr), Services (en), address, city and the public plan by its entered name');
select ok((select (s -> 'missing') ? 'bad_text' from x_dirty), 'and bad_text is in missing');
select is((select (s -> 'bad_text_fields')::text like '%Private%' from x_dirty), false, 'a private plan with a hostile name is not judged (it is not in the snapshot)');
select is((select (s -> 'bad_text_fields')::text like '%' || pg_temp.pl('X1') || '%' from x_dirty), false, 'a plan is never named by its id');
select is((select count(*)::int from x_dirty, jsonb_array_elements(s -> 'bad_text_fields') e where e ->> 'field' = 'about'), 1, 'one entry per field, per language');
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set name = 'Status Gym X', page_about_fr = null, page_services_en = null, page_address = null, page_city = null where id = pg_temp.g('X')::uuid;
update plans set name = 'Clean plan' where id = pg_temp.pl('X1')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);
select is(pg_temp.stat('X') -> 'bad_text_fields', '[]'::jsonb, 'cleaned: no entries');
select is(pg_temp.smiss('X') like '%bad_text%', false, 'and bad_text leaves missing');

-- ---- the completeness rule and the gate agree; a live page with a half-filled French About ----------------------------------
select is(pg_temp.val($$select pg_temp.complete('L', 'status-lang', '$$ || pg_temp.pl('L') || $$', 40)$$), '{"missing": [], "published": true}', 'gym L is published with both languages complete');
select is((select content ? 'about_fr' and content ? 'services_fr' and content ? 'about_en' and content ? 'services_en' from gym_pages where gym_id = pg_temp.g('L')::uuid), true,
          'both languages are in the stored snapshot');
select set_gym_page_content(pg_temp.g('L')::uuid, jsonb_build_object('about_fr', repeat('é', 40)));
select pg_temp.settle();
select is(pg_temp.sstate('L'), 'published', 'half-filling the French About on a live page leaves it live (English is complete)');
select is((select content ? 'about_fr' or content ? 'services_fr' from gym_pages where gym_id = pg_temp.g('L')::uuid), false, 'but the stored snapshot drops the French About and the French Services');
select is((select content ? 'about_en' and content ? 'services_en' from gym_pages where gym_id = pg_temp.g('L')::uuid), true, 'and keeps the English ones');
select is((select page_services_fr from gyms where id = pg_temp.g('L')::uuid), 'Cardio FR', 'the French Services are still stored on the gym');
select is(pg_temp.stat('L') -> 'languages' -> 1, '{"code":"fr","complete":false,"characters":40,"needed":60}'::jsonb, 'the status says French needs 60 more characters');
select is(pg_temp.stat('L') -> 'snapshot', (select content from gym_pages where gym_id = pg_temp.g('L')::uuid), 'and the would-be snapshot is the stored one');
select set_gym_page_content(pg_temp.g('L')::uuid, jsonb_build_object('about_fr', null, 'services_fr', 'Seulement des services'));
select pg_temp.settle();
select is((select content ? 'services_fr' from gym_pages where gym_id = pg_temp.g('L')::uuid), false, 'French Services with no French About at all are not published either');
select set_gym_page_content(pg_temp.g('L')::uuid, jsonb_build_object('about_fr', repeat('é', 100)));
select pg_temp.settle();
select is((select content ->> 'services_fr' from gym_pages where gym_id = pg_temp.g('L')::uuid), 'Seulement des services', 'completing the French About publishes the French Services again');
-- the gate and the helper use the same threshold
select is((select array_agg(private.gym_page_lang_complete(repeat('a', n)) order by n) from unnest(array[0, 99, 100, 101]) n), array[false, false, true, true], 'the helper: 99 is short, 100 is complete');
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set page_about_en = repeat('a', 99), page_about_fr = null where id = pg_temp.g('F')::uuid;
select is(array_position(private.gym_page_gate_missing(pg_temp.g('F')::uuid), 'about_short') is not null, true, 'the gate says about_short at 99 characters');
update gyms set page_about_en = repeat('a', 100) where id = pg_temp.g('F')::uuid;
select is(array_position(private.gym_page_gate_missing(pg_temp.g('F')::uuid), 'about_short') is not null, false, 'and not at 100: the gate and the helper agree');
update gyms set page_about_en = null where id = pg_temp.g('F')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);

-- ---- every gate code appears in `missing` ----------------------------------------------------------------------------------
-- (the fresh-gym answer above covered eight; the rest here. no_category and no_country need the schema relaxed, at the very end.)
select pg_temp.settle();
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set page_lat = 4.0 where id = pg_temp.g('F')::uuid;
select ok(pg_temp.smiss('F') like '%map_incomplete%', 'map_incomplete: lat without lng');
update gyms set page_lat = null where id = pg_temp.g('F')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);
select set_config('app.gym_page_content_bypass', 'true', true);
insert into plans (gym_id, name, plan_type, price, billing_interval, duration_days, is_public, public_label_en, public_label_fr)
select pg_temp.g('Z')::uuid, 'Plan number ' || lpad(i::text, 4, '0') || ' with a long descriptive name', 'monthly', 1000 + i, 'monthly', 30, true, 'English label ' || i, 'Libelle francais ' || i
  from generate_series(1, 400) i;
select set_config('app.gym_page_content_bypass', 'false', true);
select ok(pg_temp.smiss('Z') like '%too_large%', 'too_large: 400 public plans');
select is(pg_temp.stat('Z') ->> 'state', 'in_progress', 'and the page is in_progress, not an error');
delete from plans where gym_id = pg_temp.g('Z')::uuid;
-- the missing array IS the gate's answer, for every gym touched so far
select is((select count(*)::int from unnest(array['A', 'B', 'S', 'T', 'R', 'L', 'X', 'N', 'F']) k
            where pg_temp.stat(k) -> 'missing' is distinct from to_jsonb(private.gym_page_gate_missing(pg_temp.g(k)::uuid))), 0, 'in every case `missing` equals private.gym_page_gate_missing()');

-- ---- read-only: no audit row, no change ---------------------------------------------------------------------------------------
create temp table before_counts as select (select count(*) from audit_log) a, (select count(*) from gym_pages) p, (select count(*) from gym_page_media) m, (select count(*) from page_names) n,
  (select count(*) from staff_notices) s, (select max(updated_at) from gym_pages) u;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select pg_temp.stat('A');
select pg_temp.stat('A');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select pg_temp.stat('L');
select ok((select row(a, p, m, n, s, u) from before_counts) is not distinct from
           (select row((select count(*) from audit_log), (select count(*) from gym_pages), (select count(*) from gym_page_media),
                       (select count(*) from page_names), (select count(*) from staff_notices), (select max(updated_at) from gym_pages))),
          'reading the status writes no audit row and changes no page, media, name or notice row');

-- ---- nothing identifying in the answer: every key path pinned, no id or token in the text ---------------------------------------
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is((select array_agg(x order by x) from (select distinct unnest(pg_temp.key_paths(pg_temp.stat('A'))) x
                                                  union select distinct unnest(pg_temp.key_paths((select s from x_dirty)))) y),
          (select array_agg(x order by x) from unnest(array[
             'about_min_chars', 'appeal', 'bad_text_fields', 'bad_text_fields[]', 'bad_text_fields[].field', 'bad_text_fields[].lang', 'bad_text_fields[].plan_name', 'languages', 'languages[]', 'languages[].characters', 'languages[].code', 'languages[].complete', 'languages[].needed',
             'media', 'media[]', 'media[].derivative_key', 'media[].id', 'media[].kind', 'media[].sort_order', 'missing', 'missing[]',
             'published_at', 'snapshot', 'snapshot.address', 'snapshot.banner', 'snapshot.category', 'snapshot.city', 'snapshot.color', 'snapshot.contact', 'snapshot.contact.phone',
             'snapshot.country', 'snapshot.default_language', 'snapshot.gallery', 'snapshot.gallery[]', 'snapshot.hours', 'snapshot.hours.mon', 'snapshot.hours.mon.close', 'snapshot.hours.mon.open', 'snapshot.hours.sun',
             'snapshot.logo', 'snapshot.map', 'snapshot.map.lat', 'snapshot.map.lng', 'snapshot.name', 'snapshot.plans', 'snapshot.plans[]', 'snapshot.plans[].currency',
             'snapshot.plans[].duration_days', 'snapshot.plans[].interval', 'snapshot.plans[].label_en', 'snapshot.plans[].label_fr', 'snapshot.plans[].name',
             'snapshot.plans[].price', 'snapshot.plans[].type', 'snapshot.about_fr', 'snapshot.services_fr', 'state', 'taken_down_reason', 'template', 'unpublished_reasons',
             'unpublished_reasons[]']) x),
          'STATUS KEY PATHS (pinned): an added fact, or a removed one, fails here; the TypeScript schema (gymPageStatusSchema) is strict and must change with it');
select is((select count(*)::int from (select pg_temp.stat('A')::text t union all select s::text from x_dirty union all select pg_temp.stat('L')::text) s
            where t like '%' || pg_temp.g('A') || '%' or t like '%' || pg_temp.g('X') || '%' or t like '%' || pg_temp.g('L') || '%'
               or t like '%' || pg_temp.pl('A1') || '%' or t like '%' || pg_temp.pl('A2') || '%' or t like '%' || pg_temp.pl('A3') || '%' or t like '%' || pg_temp.pl('X1') || '%'
               or t like '%' || pg_temp.u('ownerA') || '%' or t like '%' || pg_temp.u('supA') || '%' or t like '%' || pg_temp.u('support') || '%' or t like '%' || pg_temp.u('admin') || '%'
               or t like '%+237600240901%' or t like '%+237600240902%'
               or t like '%' || (select gym_token from gyms where id = pg_temp.g('A')::uuid) || '%'
               or t like '%original%' or t like '%uploaded%' or t like '%aaaaaaaa-aaaa-aaaa-aaaa%' or t like '%gym_id%' or t like '%plan_id%'), 0,
          'no gym id, plan id, user id, token, login phone, original key or uploader appears anywhere in the answer');

-- ---- the shared content fixture, run through set_gym_page_content() ---------------------------------------------------------------
create temp table fx_result (id text, expected boolean, actual boolean);
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
create or replace function pg_temp.run_fixture() returns void language plpgsql as $f$
declare
  c jsonb;
  v_content jsonb;
  v_ok boolean;
begin
  for c in select fx.c from pg_temp.fx loop
    if c ? 'gen' then
      v_content := jsonb_build_object(c -> 'gen' ->> 'key', repeat(c -> 'gen' ->> 'unit', (c -> 'gen' ->> 'times')::int));
    else
      v_content := c -> 'content';
    end if;
    begin
      perform set_gym_page_content(pg_temp.g('F')::uuid, v_content);
      v_ok := true;
    exception when others then
      v_ok := false;
    end;
    insert into pg_temp.fx_result values (c ->> 'id', (c ->> 'sql')::boolean, v_ok);
  end loop;
end $f$;
select pg_temp.run_fixture();
select is((select count(*)::int from fx_result), 44, 'the fixture ran every case');
select is((select coalesce(array_agg(id order by id), '{}') from fx_result where expected is distinct from actual), '{}'::text[], 'every fixture case behaves as pinned on the SQL side');
select is((select count(*)::int from fx_result where expected), (select count(*)::int from fx where (c ->> 'sql')::boolean), 'control: the accepted cases are counted from the pinned expectations');
select is((select count(*)::int from fx_result where not expected) > 10, true, 'control: the fixture has refusals to compare, not only acceptances');
select is((select count(*)::int from fx where (c ->> 'sql')::boolean is distinct from (c ->> 'zod')::boolean and (c ->> 'note') is null), 0,
          'a case where the two sides differ says why (a note)');
select is((select page_contact_phone from gyms where id = pg_temp.g('F')::uuid), '+237600555000', 'control: accepted cases really wrote (the phone case)');
select is((select page_lat from gyms where id = pg_temp.g('F')::uuid), null, 'and the last latitude case (null clears) wrote null');
select is((select page_contact_whatsapp from gyms where id = pg_temp.g('F')::uuid), null, 'and the last WhatsApp case (an empty string clears) wrote null');

-- ---- consumers enumerated: a gate code without a witness fails here ------------------------------------------------------------
-- no_category and no_country are defensive (NOT NULL columns): relax the schema inside this rolled-back transaction, as the 24.8 file does
select pg_temp.settle();
alter table gyms alter column category drop not null;
alter table gyms alter column country drop not null;
alter table gyms drop constraint gyms_category_valid;
alter table gyms drop constraint gyms_country_iso2;
alter table gyms disable trigger pin_gym_category;
update gyms set category = null, country = null where id = pg_temp.g('N')::uuid;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select ok(pg_temp.smiss('N') like '%no_category%' and pg_temp.smiss('N') like '%no_country%', 'no_category and no_country appear in missing');
select is((select array_agg(distinct code order by code) from covered),
          (select array_agg(distinct m[1] order by m[1]) from pg_proc, regexp_matches(prosrc, 'array_append\(v_missing, ''([a-z_]+)''\)', 'g') m where proname = 'gym_page_gate_missing'),
          'every gate code in the gate function appeared in a status answer (and the answers showed no other code)');

-- ---- deactivated support is refused on the very next call --------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.sstate('A'), 'ready', 'control: live-assigned support reads A (ready after the checks above)');
select private.support_set_membership('00000000-0000-0000-0000-000000240981', false);
update public.support_assignments set state = 'ended', ended_at = now() where id = '00000000-0000-0000-0000-000000240981';
update private.support_accounts set deactivated_at = now() where user_id = pg_temp.u('support')::uuid;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.stat('A') ->> 'error', 'P0001:permission denied', 'deactivated support is refused (the dashboard maps this to a typed not-admitted error)');

select * from finish();
rollback;
