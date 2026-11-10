-- Story 24.6: gym page media (migration 0162), denials and proof the checks can fail. Positive paths: gym_page_media.test.sql.
-- Every denial is paired with a positive control. Fixture ids: 00000000-0000-0000-0000-0000002406xx.
begin;
select plan(39);

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
  ('00000000-0000-0000-0000-000000240601', 'Page Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000240611', 'Page Gym A', '00000000-0000-0000-0000-000000240601'),
  ('00000000-0000-0000-0000-000000240612', 'Page Gym B', '00000000-0000-0000-0000-000000240601');
insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000240613', 'Page Gym Suspended', '00000000-0000-0000-0000-000000240601', 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000240621', 'owner-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240622', 'supervisor-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240623', 'manager-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240624', 'coach-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240625', 'member-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240626', 'ownerB-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240627', 'ownerS-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240628', 'admin-2406@x.example', now()),
  ('00000000-0000-0000-0000-000000240629', 'sup-2406@gymosapps.com', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000240628';
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000240631', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240621', 'owner',      'PG Owner A',      '+237600240001', current_date),
  ('00000000-0000-0000-0000-000000240632', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240622', 'supervisor', 'PG Supervisor A', '+237600240002', current_date),
  ('00000000-0000-0000-0000-000000240633', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240623', 'manager',    'PG Manager A',    '+237600240003', current_date),
  ('00000000-0000-0000-0000-000000240634', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240624', 'coach',      'PG Coach A',      '+237600240004', current_date),
  ('00000000-0000-0000-0000-000000240635', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240625', 'member',     'PG Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000240636', '00000000-0000-0000-0000-000000240612', '00000000-0000-0000-0000-000000240626', 'owner',      'PG Owner B',      '+237600240006', current_date),
  ('00000000-0000-0000-0000-000000240637', '00000000-0000-0000-0000-000000240613', '00000000-0000-0000-0000-000000240627', 'owner',      'PG Owner S',      '+237600240007', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000240641', '00000000-0000-0000-0000-000000240611', 'PG Monthly',     'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000240642', '00000000-0000-0000-0000-000000240611', 'PG Per Session', 'pay_per_session', 2000, 'monthly', null),
  ('00000000-0000-0000-0000-000000240643', '00000000-0000-0000-0000-000000240612', 'PG Gym B Plan',  'monthly', 7000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000240644', '00000000-0000-0000-0000-000000240613', 'PG Suspended Plan', 'monthly', 7000, 'monthly', 30);

-- support: live and assigned to gym A
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000240629', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240651', '00000000-0000-0000-0000-000000240629', '00000000-0000-0000-0000-000000240611', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000240a1', '00000000-0000-0000-0000-000000240629', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000240a1', '00000000-0000-0000-0000-000000240629', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000240651', true);

create or replace function pg_temp.mid(pat text) returns uuid language sql security definer as $f$ select id from public.gym_page_media where derivative_key = pat $f$;
create or replace function pg_temp.reg(gym text, kind text, n int, attested text default 'true', dry text default 'false') returns text language sql as $f$
  select format($q$select register_page_media('%s', '%s', '%s/aaaaaaaa-aaaa-aaaa-aaaa-%s', 'bbbbbbbb-bbbb-bbbb-bbbb-%s.webp', %s, 'v1', %s)$q$,
                gym, kind, gym, lpad(n::text, 12, '0'), lpad(n::text, 12, '0'), attested, dry) $f$;
-- a register call with explicit keys
create or replace function pg_temp.regk(gym text, okey text, dkey text) returns text language sql as $f$
  select format($q$select register_page_media('%s', 'gallery', %L, %L, true, 'v1', false)$q$, gym, okey, dkey) $f$;

-- ---- positive control: owner of A registers --------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 1)), 'ok', 'control: owner of A registers');
reset role;

-- ---- not admitted: nothing written, refused before any storage write (the dry run is what the server calls first) ---------
-- member, coach, manager, other gym's Owner, support not assigned to this gym
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240625', 'member', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2, 'true', 'true')), 'P0001:permission denied', 'member is not admitted (dry run)');
select pg_temp.as_user('00000000-0000-0000-0000-000000240624', 'coach', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2, 'true', 'true')), 'P0001:permission denied', 'coach is not admitted (dry run)');
select pg_temp.as_user('00000000-0000-0000-0000-000000240623', 'manager', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2, 'true', 'true')), 'P0001:permission denied', 'manager is not admitted (dry run)');
select pg_temp.as_user('00000000-0000-0000-0000-000000240623', 'manager', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2)), 'P0001:permission denied', 'manager is not admitted (write)');
select pg_temp.as_user('00000000-0000-0000-0000-000000240626', 'owner', '00000000-0000-0000-0000-000000240612');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2, 'true', 'true')), 'P0001:permission denied', 'another gym''s Owner is not admitted');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'gallery', 3)), 'ok', 'control: that Owner registers for their own gym');
select pg_temp.claims('00000000-0000-0000-0000-000000240629', 'support', '00000000-0000-0000-0000-000000240612', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'gallery', 4, 'true', 'true')), 'P0001:permission denied', 'support not assigned to gym B is not admitted');
select pg_temp.claims('00000000-0000-0000-0000-000000240629', 'support', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 4, 'true', 'true')), 'ok', 'control: support assigned to gym A is admitted');
-- no identity at all
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2, 'true', 'true')), 'P0001:permission denied', 'a caller with no claims is not admitted');
reset role;
select is((select count(*)::int from gym_page_media), 2, 'denied calls wrote nothing');

-- ---- suspended gym ----------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240627', 'owner', '00000000-0000-0000-0000-000000240613');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240613', 'gallery', 5)), 'P0001:register_page_media: gym 00000000-0000-0000-0000-000000240613 is not active', 'a suspended gym cannot register');
reset role;

-- ---- delete on a suspended gym: the Owner is refused (the row is seeded directly, register would refuse) ----------------------
insert into gym_page_media (id, gym_id, kind, original_key, derivative_key, attested_at, attestation_version) values
  ('00000000-0000-0000-0000-0000002406d1', '00000000-0000-0000-0000-000000240613', 'gallery', '00000000-0000-0000-0000-000000240613/aaaaaaaa-aaaa-aaaa-aaaa-0000000000d1', 'dddddddd-dddd-dddd-dddd-000000000001.webp', now(), 'v1');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240627', 'owner', '00000000-0000-0000-0000-000000240613');
select is(pg_temp.err($$select delete_page_media('00000000-0000-0000-0000-0000002406d1')$$), 'P0001:delete_page_media: gym 00000000-0000-0000-0000-000000240613 is not active', 'a suspended gym''s Owner cannot delete');
reset role;
select is((select deleted_at is null from gym_page_media where id = '00000000-0000-0000-0000-0000002406d1'), true, 'the row of the suspended gym is untouched');

-- ---- attestation -------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 6, 'false')), 'P0001:register_page_media: attestation_required', 'attestation false is refused');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 6, 'null')), 'P0001:register_page_media: attestation_required', 'attestation absent (null) is refused');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 6, 'false', 'true')), 'P0001:register_page_media: attestation_required', 'attestation false is refused on a dry run too');
select is(pg_temp.err($$select register_page_media('00000000-0000-0000-0000-000000240611', 'gallery', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006.webp', true, '', false)$$),
          'P0001:register_page_media: attestation_required', 'an empty attestation version is refused');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 6)), 'ok', 'control: attested, the same call succeeds');

-- ---- kind and keys -------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'avatar', 7)), 'P0001:register_page_media: invalid_kind', 'an unknown kind is refused');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000008', '00000000-0000-0000-0000-000000240611.webp')),
          'P0001:register_page_media: invalid_derivative_key', 'a derivative key that is the gym id is refused');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000008', '00000000-0000-0000-0000-000000240611/x.webp')),
          'P0001:register_page_media: invalid_derivative_key', 'a derivative key in a gym folder is refused');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000008.png')),
          'P0001:register_page_media: invalid_derivative_key', 'a non-webp derivative key is refused');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240612/aaaaaaaa-aaaa-aaaa-aaaa-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000008.webp')),
          'P0001:register_page_media: invalid_original_key', 'an original key in another gym''s folder is refused');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000008.webp')),
          'P0001:register_page_media: invalid_original_key', 'an original key with no gym folder is refused');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001.webp')),
          '23505:duplicate key value violates unique constraint "gym_page_media_derivative_key_unique"', 'a derivative key can be registered once');
select is(pg_temp.err(pg_temp.regk('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000008.webp')), 'ok', 'control: well-formed keys are accepted');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 9, 'true', 'true')), 'ok', 'control: dry run is still accepted');
reset role;

-- ---- delete ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240626', 'owner', '00000000-0000-0000-0000-000000240612');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('bbbbbbbb-bbbb-bbbb-bbbb-000000000001.webp'))), 'P0001:permission denied', 'another gym''s Owner cannot delete');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, gen_random_uuid())), 'P0001:permission denied', 'an unknown id gives the same answer as another gym''s row');
select is(pg_temp.err($$select delete_page_media(null)$$), 'P0001:permission denied', 'a null id is refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000240623', 'manager', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('bbbbbbbb-bbbb-bbbb-bbbb-000000000001.webp'))), 'P0001:permission denied', 'a manager cannot delete');
select pg_temp.claims('00000000-0000-0000-0000-000000240629', 'support', '00000000-0000-0000-0000-000000240612', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('bbbbbbbb-bbbb-bbbb-bbbb-000000000001.webp'))), 'P0001:permission denied', 'unassigned support cannot delete');
reset role;
select is((select count(*)::int from gym_page_media where deleted_at is not null), 0, 'denied deletes changed nothing');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('bbbbbbbb-bbbb-bbbb-bbbb-000000000001.webp'))), 'ok', 'control: the gym''s own Owner deletes');
reset role;

-- ---- the checks can fail --------------------------------------------------------------------------------------------------
-- 1. A stray storage policy naming a page media bucket is found by the same query the migration's verify block uses.
create policy zz_stray on storage.objects for select using (bucket_id = 'gym-page-media-src');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (coalesce(qual, '') || coalesce(with_check, '')) like '%gym-page-media%'), 1, 'a stray policy on the private bucket is detected');
drop policy zz_stray on storage.objects;
-- 2. The admission enumeration: a role list widened to include coach no longer matches the pinned list.
select isnt((select (regexp_match(replace(prosrc, '''owner'', ''supervisor''', '''owner'', ''supervisor'', ''coach'''),
                                  'support_rpc_role\(''register_page_media''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'register_page_media'),
            '''owner'', ''supervisor''', 'widening the admitted roles would fail the enumeration test');
-- 3. The reader cannot reach the table or the storage buckets' rows, only the view.
grant public_site_reader to postgres with set true;
create function pg_temp.as_reader(q text) returns text language plpgsql as $f$
begin
  set local role public_site_reader;
  execute q;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate || ':' || sqlerrm;
end
$f$;
select is(pg_temp.as_reader($$select 1 from public.gym_page_media$$), '42501:permission denied for schema public', 'the public reader cannot read gym_page_media');
select is(pg_temp.as_reader($$select 1 from public_site.page_media$$), 'ok', 'control: the reader can read the view');
select * from finish();
rollback;
