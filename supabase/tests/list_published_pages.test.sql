-- Migration 0168: public.list_published_pages(), the Super Admin list of published pages and their domains.
-- Fixture ids: 00000000-0000-0000-0000-0000002412xx. gyms 11-17, users 31-34, page names a1-a7.
-- Pages are inserted directly (this file proves the READ, not the publish gate, which page_takedown.test.sql and gym_page_publish.test.sql cover).
begin;
select plan(33);

create or replace function pg_temp.claims(uid text, app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end || '}', true);
end $f$;
create or replace function pg_temp.g(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002412' || case c when 'L' then '11' when 'D' then '12' when 'N' then '13' when 'P' then '14' when 'U' then '15' when 'W' then '16' when 'B' then '17' when 'R' then '18' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002412' || case c when 'admin' then '31' when 'owner' then '32' when 'support' then '33' when 'plain' then '34' end $f$;
create or replace function pg_temp.asauth(stmt text) returns text language plpgsql as $f$
declare v text;
begin
  set local role authenticated;
  begin
    execute stmt into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return coalesce(v, 'null');
end $f$;
grant public_site_reader to postgres with set true;
create or replace function pg_temp.asrole(r text, stmt text) returns text language plpgsql as $f$
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
-- the row of one gym, as the Super Admin sees it: "page_name|template|status", or "none"
create or replace function pg_temp.row_of(gym text) returns text language plpgsql as $f$
declare v text;
begin
  set local role authenticated;
  select coalesce(page_name, '~') || '|' || template || '|' || status into v from list_published_pages() where gym_id = pg_temp.g(gym)::uuid;
  reset role;
  return coalesce(v, 'none');
end $f$;
create or replace function pg_temp.count_rows() returns integer language plpgsql as $f$
declare v integer;
begin
  set local role authenticated;
  select count(*)::int into v from list_published_pages();
  reset role;
  return v;
end $f$;
create temp table orig_defs (sig text primary key, def text not null);
create or replace function pg_temp.mutate(sig regprocedure, pat text, rep text) returns void language plpgsql as $f$
declare d text; n text;
begin
  d := pg_get_functiondef(sig);
  insert into orig_defs values (sig::text, d) on conflict do nothing;
  n := regexp_replace(d, pat, rep, 'g');
  if n = d then raise exception 'mutation of % matched nothing', sig; end if;
  execute n;
end $f$;
create or replace function pg_temp.restore(sig regprocedure) returns void language plpgsql as $f$
begin execute (select def from orig_defs where orig_defs.sig = restore.sig::text); end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000241201', 'Published List Tier', 5000, 50000, null);
-- the suspended gym is seeded suspended at insert: a bare UPDATE of gyms.status is silently reverted for non Super Admins
insert into gyms (id, name, tier_id, status) values
  (pg_temp.g('L')::uuid, 'PL Live Gym',        '00000000-0000-0000-0000-000000241201', 'active'),
  (pg_temp.g('D')::uuid, 'PL Page Down Gym',   '00000000-0000-0000-0000-000000241201', 'active'),
  (pg_temp.g('N')::uuid, 'PL Name Down Gym',   '00000000-0000-0000-0000-000000241201', 'active'),
  (pg_temp.g('P')::uuid, 'PL Paused Gym',      '00000000-0000-0000-0000-000000241201', 'suspended'),
  (pg_temp.g('U')::uuid, 'PL Unpublished Gym', '00000000-0000-0000-0000-000000241201', 'active'),
  (pg_temp.g('W')::uuid, 'PL Draft Gym',       '00000000-0000-0000-0000-000000241201', 'active'),
  (pg_temp.g('B')::uuid, 'PL Both Gym',        '00000000-0000-0000-0000-000000241201', 'suspended'),
  (pg_temp.g('R')::uuid, 'PL Released Gym',    '00000000-0000-0000-0000-000000241201', 'active');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('admin')::uuid,   'admin-2412@x.example', now()),
  (pg_temp.u('owner')::uuid,   'owner-2412@x.example', now()),
  (pg_temp.u('support')::uuid, 'support-2412@x.example', now()),
  (pg_temp.u('plain')::uuid,   'plain-2412@x.example', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000241251', pg_temp.g('L')::uuid, pg_temp.u('owner')::uuid, 'owner', 'PL Owner', '+237600241201', current_date);

insert into page_names (id, gym_id, name, state, origin, taken_down_at) values
  ('00000000-0000-0000-0000-0000002412a1', pg_temp.g('L')::uuid, 'plist-live',    'active', 'claim', null),
  ('00000000-0000-0000-0000-0000002412a2', pg_temp.g('D')::uuid, 'plist-pagedown', 'active', 'claim', null),
  ('00000000-0000-0000-0000-0000002412a3', pg_temp.g('N')::uuid, 'plist-namedown', 'active', 'claim', now()),
  ('00000000-0000-0000-0000-0000002412a4', pg_temp.g('P')::uuid, 'plist-paused',   'active', 'claim', null),
  ('00000000-0000-0000-0000-0000002412a5', pg_temp.g('U')::uuid, 'plist-unpub',    'active', 'claim', null),
  ('00000000-0000-0000-0000-0000002412a7', pg_temp.g('B')::uuid, 'plist-both',     'active', 'claim', now()),
  -- an active gym whose published page points at a name that is no longer the active one: not served, so not live
  ('00000000-0000-0000-0000-0000002412a8', pg_temp.g('R')::uuid, 'plist-released', 'released', 'claim', null);
insert into gym_pages (gym_id, page_name_id, template, published_at, unpublished_at, taken_down_at) values
  (pg_temp.g('L')::uuid, '00000000-0000-0000-0000-0000002412a1', 'classic', now() - interval '1 day',  null, null),
  (pg_temp.g('D')::uuid, '00000000-0000-0000-0000-0000002412a2', 'bold',    now() - interval '2 days', null, now()),
  (pg_temp.g('N')::uuid, '00000000-0000-0000-0000-0000002412a3', 'classic', now() - interval '3 days', null, null),
  (pg_temp.g('P')::uuid, '00000000-0000-0000-0000-0000002412a4', 'bold',    now() - interval '4 days', null, null),
  (pg_temp.g('U')::uuid, '00000000-0000-0000-0000-0000002412a5', 'classic', now() - interval '5 days', now() - interval '1 hour', null),
  (pg_temp.g('B')::uuid, '00000000-0000-0000-0000-0000002412a7', 'classic', now() - interval '6 days', null, null),
  (pg_temp.g('R')::uuid, '00000000-0000-0000-0000-0000002412a8', 'classic', now() - interval '7 days', null, null);
-- gym W has a name but no page row (a draft that was never published)
insert into page_names (id, gym_id, name, state, origin) values ('00000000-0000-0000-0000-0000002412a6', pg_temp.g('W')::uuid, 'plist-draft', 'active', 'claim');

select is((select status::text from gyms where id = pg_temp.g('P')::uuid), 'suspended', 'control: the paused fixture gym really is suspended');
select is((select status::text from gyms where id = pg_temp.g('L')::uuid), 'active', 'control: the live fixture gym is active');

-- ---- A. the Super Admin sees the right rows ----------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.row_of('L'), 'plist-live|classic|live', 'a published page of an active gym is live, with its name and template');
select is(pg_temp.row_of('D'), 'plist-pagedown|bold|taken_down', 'a taken-down page row is taken_down');
select is(pg_temp.row_of('N'), 'plist-namedown|classic|taken_down', 'a taken-down name is taken_down');
select is(pg_temp.row_of('P'), 'plist-paused|bold|paused', 'a page of a suspended gym is paused');
select is(pg_temp.row_of('B'), 'plist-both|classic|taken_down', 'taken down wins over paused');
select is(pg_temp.row_of('R'), 'plist-released|classic|paused', 'a published page whose name is not active is not live (review finding: live must equal what the public view serves)');
select is(pg_temp.row_of('U'), 'none', 'an unpublished page is not listed');
select is(pg_temp.row_of('W'), 'none', 'a draft with no page row is not listed');
select is(pg_temp.count_rows(), (select count(*)::int from gym_pages where published_at is not null and unpublished_at is null), 'the list is exactly the published pages');
select is((select count(*)::int from private.gym_page_visible where name like 'plist-%'), 1, 'control: only the live page is on the public view');
select is((select array_agg(page_name order by page_name) from list_published_pages() where status = 'live' and page_name like 'plist-%'),
          (select array_agg(name::text order by name) from private.gym_page_visible where name like 'plist-%'), 'the live rows are exactly the pages the public view serves');
select is((select gym_name from (select * from list_published_pages()) l where gym_id = pg_temp.g('L')::uuid), (select name::text from gyms where id = pg_temp.g('L')::uuid), 'the gym name is returned');
select is((select published_at from list_published_pages() where gym_id = pg_temp.g('L')::uuid), (select published_at from gym_pages where gym_id = pg_temp.g('L')::uuid), 'the publish date is the snapshot''s');
select is((select array_agg(page_name order by ord) from (select page_name, row_number() over () ord from list_published_pages() where page_name like 'plist-%') s),
          array['plist-live', 'plist-pagedown', 'plist-namedown', 'plist-paused', 'plist-both', 'plist-released'], 'newest published first');
select is((select count(*)::int from list_published_pages() where gym_id = pg_temp.g('L')::uuid), 1, 'a gym appears once');

-- the cap
select is((select pg_get_functiondef('public.list_published_pages()'::regprocedure) ~ 'limit 1000'), true, 'the result is capped at 1000 rows');

-- ---- B. who is refused -------------------------------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('owner'), 'owner');
select is(pg_temp.asauth('select count(*) from list_published_pages()'), 'P0001:permission denied', 'an Owner is refused');
select pg_temp.claims(pg_temp.u('support'), 'support');
select is(pg_temp.asauth('select count(*) from list_published_pages()'), 'P0001:permission denied', 'a support caller is refused');
select pg_temp.claims(pg_temp.u('plain'), null);
select is(pg_temp.asauth('select count(*) from list_published_pages()'), 'P0001:permission denied', 'a signed-in user with no role is refused');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.asauth('select count(*) from list_published_pages()') <> 'P0001:permission denied', true, 'control: the Super Admin is not refused');
select is(pg_temp.asrole('anon', 'select count(*) from list_published_pages()'), '42501:permission denied for function list_published_pages', 'anon cannot execute it');
select is(pg_temp.asrole('public_site_reader', 'select count(*) from public.list_published_pages()'), '42501:permission denied for schema public', 'the public site reader cannot execute it');

-- shown able to fail: without its guard the function answers a plain Owner
select pg_temp.mutate('public.list_published_pages()'::regprocedure, 'if not coalesce\(private\.is_super_admin_live\(\), false\) then', 'if false then');
select pg_temp.claims(pg_temp.u('owner'), 'owner');
select isnt(pg_temp.asauth('select count(*) from list_published_pages()'), 'P0001:permission denied', 'mutation: with the guard removed an Owner is no longer refused (the denial checks above can fail)');
select pg_temp.restore('public.list_published_pages()'::regprocedure);
select is(pg_temp.asauth('select count(*) from list_published_pages()'), 'P0001:permission denied', 'restored: the Owner is refused again');

-- ---- C. shape ----------------------------------------------------------------------------------------------------------------
select is((select p.provolatile::text from pg_proc p where p.oid = 'public.list_published_pages()'::regprocedure), 's', 'it is stable');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.list_published_pages()'::regprocedure), true, 'it is security definer');
select is((select p.proconfig from pg_proc p where p.oid = 'public.list_published_pages()'::regprocedure), array['search_path=public'], 'its search_path is pinned to public');
select is((select p.prosrc ~* '(insert\s+into|update\s+\w|delete\s+from|truncate)' from pg_proc p where p.oid = 'public.list_published_pages()'::regprocedure), false, 'its body writes nothing');
select is((select pg_get_function_result('public.list_published_pages()'::regprocedure)),
          'TABLE(gym_id uuid, gym_name text, page_name text, template text, published_at timestamp with time zone, status text)', 'its columns are pinned');
select is(has_function_privilege('authenticated', 'public.list_published_pages()', 'execute') and not has_function_privilege('anon', 'public.list_published_pages()', 'execute')
          and not has_function_privilege('public_site_reader', 'public.list_published_pages()', 'execute'), true, 'executable by authenticated, not by anon or the public site reader');
select is((select count(*)::int from information_schema.routine_privileges where routine_name = 'list_published_pages' and grantee = 'PUBLIC'), 0, 'and not by PUBLIC');

select * from finish();
rollback;
