-- Story 24.6: gym page media (migration 0162), positive paths and structure. Denials: gym_page_media.negative.test.sql.
-- Fixture ids: 00000000-0000-0000-0000-0000002406xx.
begin;
select plan(75);

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

create or replace function pg_temp.mid(pat text) returns uuid language sql security definer as $f$ select id from public.gym_page_media where derivative_key like pat $f$;
-- key helpers: original {gym}/{uuid}, derivative {uuid}.webp (no gym id)
create or replace function pg_temp.reg(gym text, kind text, n int, attested text default 'true', dry text default 'false') returns text language sql as $f$
  select format($q$select register_page_media('%s', '%s', '%s/aaaaaaaa-aaaa-aaaa-aaaa-%s', 'bbbbbbbb-bbbb-bbbb-bbbb-%s.webp', %s, 'v1', %s)$q$,
                gym, kind, gym, lpad(n::text, 12, '0'), lpad(n::text, 12, '0'), attested, dry) $f$;

-- ---- catalog -----------------------------------------------------------------------------------------------------
select is((select count(*)::int from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name in ('register_page_media', 'delete_page_media')), 2, 'both capability rows exist');
select is((select count(*)::int from private.support_audit_actions where action_type in ('gym_page_media_registered', 'gym_page_media_deleted')), 2, 'both audit actions are on the support allow-list');
select is(has_function_privilege('anon', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute'), false, 'anon cannot execute register');
select is(has_function_privilege('anon', 'public.delete_page_media(uuid)', 'execute'), false, 'anon cannot execute delete');
select is(has_function_privilege('authenticated', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute'), true, 'authenticated can execute register');
select is((select count(*)::int from pg_proc where proname in ('register_page_media', 'delete_page_media') and prosecdef and proconfig = array['search_path=public']), 2, 'both RPCs are security definer with a pinned search_path');
-- consumers enumerated: a new admitted role without the check fails here
select is((select (regexp_match(prosrc, 'support_rpc_role\(''register_page_media''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'register_page_media'),
          '''owner'', ''supervisor''', 'register admits exactly owner and supervisor (plus super admin and live support at the supervisor ceiling)');
select is((select (regexp_match(prosrc, 'support_rpc_role\(''delete_page_media''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'delete_page_media'),
          '''owner'', ''supervisor''', 'delete admits exactly owner and supervisor (plus super admin and live support at the supervisor ceiling)');
select is((select count(*)::int from pg_proc where proname in ('register_page_media', 'delete_page_media') and prosrc like '%is_super_admin_live%' and prosrc like '%support_rpc_gym_id(''%_page_media'')%'), 2,
          'both RPCs resolve the gym through the support helpers and the live super admin check');

-- ---- buckets and client access -------------------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'gym-page-media-src'), false, 'originals bucket is private');
select is((select public from storage.buckets where id = 'gym-page-media'), true, 'derivatives bucket is public');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (coalesce(qual, '') || coalesce(with_check, '')) like '%gym-page-media%'), 0, 'no storage policy names either page media bucket');
insert into storage.objects (bucket_id, name) values
  ('gym-page-media-src', '00000000-0000-0000-0000-000000240611/aaaaaaaa-aaaa-aaaa-aaaa-000000000001'),
  ('gym-page-media', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001.webp');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.rows($$select 1 from storage.objects where bucket_id = 'gym-page-media-src'$$), '0', 'the Owner sees no original in the private bucket');
select is(pg_temp.rows($$select 1 from storage.objects where bucket_id = 'gym-page-media'$$), '0', 'the Owner reads no derivative object through Storage RLS (public HTTP reads bypass RLS)');
select alike(pg_temp.err($$insert into storage.objects (bucket_id, name) values ('gym-page-media-src', '00000000-0000-0000-0000-000000240611/x')$$), '42501:%', 'the Owner cannot write the private bucket');
select alike(pg_temp.err($$insert into storage.objects (bucket_id, name) values ('gym-page-media', 'x.webp')$$), '42501:%', 'the Owner cannot write the public bucket');
select alike(pg_temp.err($$select 1 from gym_page_media$$), '42501:%', 'the Owner cannot read gym_page_media directly');
reset role;
set local role anon;
select ok(pg_temp.rows($$select 1 from storage.objects where bucket_id = 'gym-page-media-src'$$) in ('0', '42501:permission denied for table members'), 'anon sees nothing in the private bucket');
select alike(pg_temp.err($$insert into storage.objects (bucket_id, name) values ('gym-page-media-src', 'x')$$), '42501:%', 'anon cannot write the private bucket');
reset role;

-- ---- Owner registers a gallery image ---------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 1)), 'ok', 'owner registers a gallery image');
reset role;
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'gallery' and deleted_at is null), 1, 'one live gallery row');
select is((select uploaded_by from gym_page_media where derivative_key like '%000000000001.webp'), '00000000-0000-0000-0000-000000240621'::uuid, 'the uploader is recorded');
select is((select attestation_version || (attested_at is not null)::text from gym_page_media where derivative_key like '%000000000001.webp'), 'v1true', 'attestation time and text version are recorded');
select is((select count(*)::int from audit_log where action_type = 'gym_page_media_registered' and gym_id = '00000000-0000-0000-0000-000000240611'), 1, 'one audit row');
select is((select actor_id from audit_log where action_type = 'gym_page_media_registered' and gym_id = '00000000-0000-0000-0000-000000240611'), '00000000-0000-0000-0000-000000240621'::uuid, 'audit names the owner');
select is((select count(*)::int from gym_page_media where position(gym_id::text in derivative_key) > 0), 0, 'no derivative key contains the gym id');

-- ---- dry run writes nothing -----------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 2, 'true', 'true')), 'ok', 'a dry run is admitted');
reset role;
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611'), 1, 'a dry run adds no row');
select is((select count(*)::int from audit_log where action_type = 'gym_page_media_registered' and gym_id = '00000000-0000-0000-0000-000000240611'), 1, 'a dry run adds no audit row');

-- ---- other admitted roles --------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240622', 'supervisor', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 3)), 'ok', 'supervisor registers');
select pg_temp.claims('00000000-0000-0000-0000-000000240629', 'support', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 4)), 'ok', 'live-assigned support registers');
select pg_temp.claims('00000000-0000-0000-0000-000000240628', 'super_admin');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'gallery', 5)), 'ok', 'super admin registers for any gym');
reset role;
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'gallery'), 3, 'three rows for gym A');
select is((select array_agg(sort_order order by sort_order) from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'gallery'), array[1, 2, 3], 'gallery sort order increases');

-- ---- gallery limit: 12 live, then a freed slot ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select 1 from generate_series(10, 18) n where pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', n)) is null;
reset role;
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'gallery' and deleted_at is null), 12, 'twelve live gallery images');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 30)), 'P0001:register_page_media: limit_reached', 'the 13th gallery image is refused');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 30, 'true', 'true')), 'P0001:register_page_media: limit_reached', 'a dry run also reports limit_reached');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'banner', 31)), 'ok', 'the gallery limit does not block a banner');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000001.webp'))), 'ok', 'owner deletes one gallery image');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'gallery', 30)), 'ok', 'a deleted image frees a slot');
reset role;

-- ---- banner and logo replace the previous live row -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'banner', 32)), 'ok', 'a new banner is accepted');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'logo', 33)), 'ok', 'a logo is accepted');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'logo', 34)), 'ok', 'a second logo is accepted');
reset role;
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'banner' and deleted_at is null), 1, 'exactly one live banner');
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'banner' and deleted_at is not null), 1, 'the previous banner is marked deleted');
select is((select derivative_key from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'logo' and deleted_at is null), 'bbbbbbbb-bbbb-bbbb-bbbb-000000000034.webp', 'the newest logo is the live one');
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240611' and kind = 'logo'), 2, 'the previous logo row is kept (object removal is 24.11)');
select alike((select pg_temp.err($$insert into gym_page_media (gym_id, kind, original_key, derivative_key, attested_at, attestation_version)
  values ('00000000-0000-0000-0000-000000240611', 'banner', '00000000-0000-0000-0000-000000240611/cccccccc-cccc-cccc-cccc-000000000001', 'cccccccc-cccc-cccc-cccc-000000000001.webp', now(), 'v1')$$)),
  '23505:%', 'the database itself refuses a second live banner');

-- ---- public view ------------------------------------------------------------------------------------------------------
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'page_media'),
          array['derivative_key', 'kind', 'sort_order', 'page_name_id'], 'public_site.page_media columns are pinned (24.8 added page_name_id; no gym_id)');
select is((select count(*)::int from public_site.page_media), 0, 'media of a gym with no published page is not exposed');
-- 24.8: the view is a projection of the page snapshot, so the page needs an active name and a snapshot
insert into public.page_names (id, gym_id, name, state, origin) values ('00000000-0000-0000-0000-0000002406a1', '00000000-0000-0000-0000-000000240611', 'media-gym-a', 'active', 'claim');
insert into public.gym_pages (gym_id, page_name_id, template, content, published_at)
  values ('00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-0000002406a1', 'classic', private.gym_page_snapshot('00000000-0000-0000-0000-000000240611'), now());
select is((select count(*)::int from public_site.page_media), 14, 'once the page is published only live media is exposed (12 gallery + banner + logo)');
select is((select count(*)::int from public_site.page_media where derivative_key like '%000000000031.webp'), 0, 'the replaced banner is absent');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000033.webp'))), 'P0001:delete_page_media: not found', 'deleting an already deleted row is refused');
reset role;
select is((select count(*)::int from public_site.page_media where derivative_key like '%000000000034.webp'), 1, 'the live logo is exposed');
-- taken down: the view hides the media, and shows it again once cleared
update public.gym_pages set taken_down_at = now() where gym_id = '00000000-0000-0000-0000-000000240611';
select is((select count(*)::int from public_site.page_media), 0, 'a taken-down page exposes no media');
update public.gym_pages set taken_down_at = null where gym_id = '00000000-0000-0000-0000-000000240611';
select is((select count(*)::int from public_site.page_media), 14, 'clearing the takedown exposes the media again');
-- suspended gym (seeded suspended at insert): published page and live media, still not exposed
insert into public.gym_page_media (gym_id, kind, original_key, derivative_key, attested_at, attestation_version) values
  ('00000000-0000-0000-0000-000000240613', 'gallery', '00000000-0000-0000-0000-000000240613/aaaaaaaa-aaaa-aaaa-aaaa-0000000000d1', 'dddddddd-dddd-dddd-dddd-000000000001.webp', now(), 'v1');
insert into public.page_names (id, gym_id, name, state, origin) values ('00000000-0000-0000-0000-0000002406a3', '00000000-0000-0000-0000-000000240613', 'media-gym-s', 'active', 'claim');
insert into public.gym_pages (gym_id, page_name_id, template, content, published_at)
  values ('00000000-0000-0000-0000-000000240613', '00000000-0000-0000-0000-0000002406a3', 'classic', private.gym_page_snapshot('00000000-0000-0000-0000-000000240613'), now());
select is((select count(*)::int from public.gym_page_media where derivative_key = 'dddddddd-dddd-dddd-dddd-000000000001.webp' and deleted_at is null), 1,
          'control: the suspended gym has a live media row and a published page');
select is((select count(*)::int from public_site.page_media where derivative_key = 'dddddddd-dddd-dddd-dddd-000000000001.webp'), 0, 'a suspended gym''s media is not exposed');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000034.webp'))), 'ok', 'owner deletes the live logo');
reset role;
-- the refresh trigger is deferred to commit; fire it as a Super Admin (pending events of two gyms fire together, and an audit row for a gym needs its own caller or a Super Admin)
select pg_temp.claims('00000000-0000-0000-0000-000000240628', 'super_admin');
set constraints all immediate;
select is((select count(*)::int from public_site.page_media where derivative_key like '%000000000034.webp'), 0, 'a deleted image leaves the view as soon as the refresh runs (this fixture page is not publishable, so the gate also takes it offline)');
select is((select count(*)::int from audit_log where action_type = 'gym_page_media_deleted' and gym_id = '00000000-0000-0000-0000-000000240611'), 2, 'each delete is audited');
update public.gym_pages set unpublished_at = now() where gym_id = '00000000-0000-0000-0000-000000240611';
select is((select count(*)::int from public_site.page_media), 0, 'unpublishing the page hides all its media');

-- ---- delete: every admitted role is exercised (review patch; the prosrc regex above only pins the list) ------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240622', 'supervisor', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000003.webp'))), 'ok', 'supervisor deletes');
select pg_temp.claims('00000000-0000-0000-0000-000000240629', 'support', '00000000-0000-0000-0000-000000240611', '00000000-0000-0000-0000-0000000240a1');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000004.webp'))), 'ok', 'live-assigned support deletes');
select pg_temp.claims('00000000-0000-0000-0000-000000240628', 'super_admin');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000010.webp'))), 'ok', 'super admin deletes another gym''s live media');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('dddddddd-dddd-dddd-dddd-000000000001.webp'))), 'ok', 'super admin deletes media of a suspended gym');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, gen_random_uuid())), 'P0001:delete_page_media: not found', 'super admin gets not found for an unknown id');
select is(pg_temp.err(format($q$select delete_page_media(%L)$q$, pg_temp.mid('%000000000003.webp'))), 'P0001:delete_page_media: not found', 'super admin deleting an already deleted row gets not found');
reset role;
select is((select count(*)::int from gym_page_media where deleted_at is not null and derivative_key in
            ('bbbbbbbb-bbbb-bbbb-bbbb-000000000003.webp', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004.webp', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000010.webp', 'dddddddd-dddd-dddd-dddd-000000000001.webp')),
          4, 'each admitted role''s delete set deleted_at');

-- ---- 24.9 (migration 0165): at most 30 uploads per gym per rolling 24 hours, every kind, deleted rows counted ------------------------------
-- Gym B holds one row (super admin, above). 28 more rows, all already deleted, bring it to 29 inside the window.
insert into public.gym_page_media (gym_id, kind, original_key, derivative_key, attested_at, attestation_version, deleted_at)
select '00000000-0000-0000-0000-000000240612', 'gallery',
       '00000000-0000-0000-0000-000000240612/ffffffff-ffff-ffff-ffff-' || lpad(n::text, 12, '0'),
       'eeeeeeee-eeee-eeee-eeee-' || lpad(n::text, 12, '0') || '.webp', now(), 'v1', now()
  from generate_series(1, 28) n;
select is((select count(*)::int from gym_page_media where gym_id = '00000000-0000-0000-0000-000000240612'), 29, 'control: gym B holds 29 rows (28 of them deleted) inside the window');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240626', 'owner', '00000000-0000-0000-0000-000000240612');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'gallery', 60)), 'ok', 'the 30th upload in 24 hours is accepted');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'gallery', 61)), 'P0001:register_page_media: limit_reached', 'the 31st is refused with limit_reached (deleted rows counted)');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'banner', 62, 'true', 'true')), 'P0001:register_page_media: limit_reached', 'a dry run reports it too, whatever the kind');
select pg_temp.as_user('00000000-0000-0000-0000-000000240621', 'owner', '00000000-0000-0000-0000-000000240611');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240611', 'logo', 64)), 'ok', 'the cap is per gym: gym B being at its cap does not stop gym A');
reset role;
update public.gym_page_media set created_at = now() - interval '25 hours' where derivative_key in
  (select derivative_key from public.gym_page_media where derivative_key like 'eeeeeeee-%' order by derivative_key limit 5);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000240626', 'owner', '00000000-0000-0000-0000-000000240612');
select is(pg_temp.err(pg_temp.reg('00000000-0000-0000-0000-000000240612', 'banner', 63)), 'ok', 'rows older than 24 hours no longer count');
reset role;

select * from finish();
rollback;
