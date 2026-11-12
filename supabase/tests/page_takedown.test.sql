-- Story 24.11: takedown, lift, reports, appeals and the media purge (migration 0167).
-- Fixture ids: 00000000-0000-0000-0000-0000002411xx. gyms 11-20, users 31-40, members 51-60, plans 71-80.
--
-- The refresh triggers are DEFERRED constraint triggers: this whole file is one transaction, so `pg_temp.settle()` stands for "commit".
-- Every consumer of the takedown predicate is pinned by an effect check AND shown able to fail by breaking that consumer inside the
-- transaction (section D); the original definitions are restored from pg_get_functiondef before the next section.
begin;
select plan(294);

create or replace function pg_temp.claims(uid text, app_role text, gym text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.g(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002411' || case c when 'T' then '11' when 'U' then '12' when 'P' then '13' when 'K' then '14' when 'S' then '15'
    when 'D' then '16' when 'N' then '17' when 'X' then '18' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002411' || case c when 'ownerT' then '31' when 'supT' then '32' when 'ownerU' then '33' when 'admin' then '34'
    when 'ownerP' then '35' when 'ownerK' then '36' when 'ownerN' then '37' when 'ownerS' then '38' when 'ownerX' then '39' end $f$;
create or replace function pg_temp.pl(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002411' || case c when 'T' then '71' when 'U' then '72' when 'P' then '73' when 'K' then '74' when 'S' then '75' end $f$;
create or replace function pg_temp.dk(n int) returns text language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0') || '.webp' $f$;
create or replace function pg_temp.ok_(n int) returns text language sql immutable as $f$ select 'aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0') $f$;
create or replace function pg_temp.hash(n int) returns text language sql immutable as $f$ select encode(sha256(convert_to('source-' || n, 'utf8')), 'hex') $f$;
create or replace function pg_temp.plan_public(p text, v boolean) returns void language plpgsql as $f$
begin
  perform set_config('app.gym_page_content_bypass', 'true', true);
  update public.plans set is_public = v where id = pg_temp.pl(p)::uuid;
  perform set_config('app.gym_page_content_bypass', 'false', true);
end $f$;
create or replace function pg_temp.settle() returns void language plpgsql as $f$ begin set constraints all immediate; set constraints all deferred; end $f$;
-- Runs one statement as `authenticated` (so the grants are exercised) and returns its first value, or sqlstate:message.
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
create or replace function pg_temp.page(gym text, col text) returns text language plpgsql security definer as $f$
declare v text; begin execute format('select (%s)::text from public.gym_pages where gym_id = %L', col, pg_temp.g(gym)) into v; return coalesce(v, 'null'); end $f$;
create or replace function pg_temp.mid(n int) returns uuid language sql security definer as $f$ select id from public.gym_page_media where derivative_key = pg_temp.dk(n) $f$;
create or replace function pg_temp.pn_id(nm text) returns uuid language sql security definer as $f$ select id from public.page_names where name = nm $f$;
create or replace function pg_temp.visible(nm text) returns integer language sql security definer as $f$ select count(*)::int from private.gym_page_visible where name = nm $f$;
create or replace function pg_temp.notices(gym text, typ text) returns integer language sql security definer as $f$
  select count(*)::int from public.staff_notices where gym_id = pg_temp.g(gym)::uuid and notice_type = typ $f$;
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
  return v;
end $f$;
-- a gym brought to publishable and published in one call (the caller's claims must be a Super Admin's)
create or replace function pg_temp.complete(gym text, nm text, plan_id text, n int) returns text language plpgsql as $f$
begin
  perform set_gym_page_content(pg_temp.g(gym)::uuid,
    jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'about_fr', repeat('Cette salle est complete. ', 6), 'services_en', 'Cardio', 'services_fr', 'Cardio FR',
                       'contact_phone', '+237600555000',
                       'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'is_public', true)));
  perform set_gym_location(pg_temp.g(gym)::uuid, 'CM', (select id from cities where country_code = 'CM' and slug = 'douala'));
  perform claim_page_name(pg_temp.g(gym)::uuid, nm);
  perform register_page_media(pg_temp.g(gym)::uuid, 'logo', pg_temp.g(gym) || '/' || pg_temp.ok_(n), pg_temp.dk(n), true, 'v1');
  perform register_page_media(pg_temp.g(gym)::uuid, 'banner', pg_temp.g(gym) || '/' || pg_temp.ok_(n + 1), pg_temp.dk(n + 1), true, 'v1');
  return publish_gym_page(pg_temp.g(gym)::uuid, 'classic')::text;
end $f$;
-- The reader role, as the landing app connects: SET ROLE is not granted to the migration owner by default.
grant public_site_reader to postgres with set true;
create or replace function pg_temp.report(nm text, reason text, details text, h text) returns text language plpgsql as $f$
declare v text;
begin
  set local role public_site_reader;
  begin
    v := public_site.submit_page_report(nm, reason, details, h);
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;
create or replace function pg_temp.val_claim(gym text, nm text) returns text language sql as $f$ select claim_page_name(pg_temp.g(gym)::uuid, nm)->>'state' $f$;
create or replace function pg_temp.reports(gym text) returns integer language sql security definer as $f$
  select count(*)::int from private.page_reports where gym_id = pg_temp.g(gym)::uuid $f$;
-- a step-up grant for a user, with the Super Admin second-factor flag on for this call only (rolled back inside), or ERR:<sqlstate>
create or replace function pg_temp.stepup(uid text, act text, subj text) returns text language plpgsql as $f$
declare v text;
begin
  begin
    update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
    v := coalesce(private.stepup_issue(uid::uuid, act, subj)::text, 'null');
    raise exception 'RESULT:%', v;
  exception when others then
    if sqlerrm like 'RESULT:%' then return substr(sqlerrm, 8); end if;
    return 'ERR:' || sqlstate;
  end;
end $f$;
-- mutation helpers: break a function in place, restore it from the saved definition
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
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000241101', 'Takedown Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('T')::uuid, 'Takedown Gym T', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('U')::uuid, 'Takedown Gym U', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('P')::uuid, 'Takedown Gym P', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('K')::uuid, 'Takedown Gym K', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('S')::uuid, 'Takedown Gym S', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('D')::uuid, 'Takedown Gym D', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('N')::uuid, 'Takedown Gym N', '00000000-0000-0000-0000-000000241101'),
  (pg_temp.g('X')::uuid, 'Takedown Gym X', '00000000-0000-0000-0000-000000241101');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerT')::uuid, 'ownerT-2411@x.example', now()),
  (pg_temp.u('supT')::uuid, 'supT-2411@x.example', now()),
  (pg_temp.u('ownerU')::uuid, 'ownerU-2411@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2411@x.example', now()),
  (pg_temp.u('ownerP')::uuid, 'ownerP-2411@x.example', now()),
  (pg_temp.u('ownerK')::uuid, 'ownerK-2411@x.example', now()),
  (pg_temp.u('ownerN')::uuid, 'ownerN-2411@x.example', now()),
  (pg_temp.u('ownerS')::uuid, 'ownerS-2411@x.example', now()),
  (pg_temp.u('ownerX')::uuid, 'ownerX-2411@x.example', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000241151', pg_temp.g('T')::uuid, pg_temp.u('ownerT')::uuid, 'owner',      'TD Owner T',      '+237600241101', current_date),
  ('00000000-0000-0000-0000-000000241152', pg_temp.g('T')::uuid, pg_temp.u('supT')::uuid,   'supervisor', 'TD Supervisor T', '+237600241102', current_date),
  ('00000000-0000-0000-0000-000000241153', pg_temp.g('U')::uuid, pg_temp.u('ownerU')::uuid, 'owner',      'TD Owner U',      '+237600241103', current_date),
  ('00000000-0000-0000-0000-000000241154', pg_temp.g('P')::uuid, pg_temp.u('ownerP')::uuid, 'owner',      'TD Owner P',      '+237600241104', current_date),
  ('00000000-0000-0000-0000-000000241155', pg_temp.g('K')::uuid, pg_temp.u('ownerK')::uuid, 'owner',      'TD Owner K',      '+237600241105', current_date),
  ('00000000-0000-0000-0000-000000241156', pg_temp.g('N')::uuid, pg_temp.u('ownerN')::uuid, 'owner',      'TD Owner N',      '+237600241106', current_date),
  ('00000000-0000-0000-0000-000000241157', pg_temp.g('S')::uuid, pg_temp.u('ownerS')::uuid, 'owner',      'TD Owner S',      '+237600241107', current_date),
  ('00000000-0000-0000-0000-000000241158', pg_temp.g('X')::uuid, pg_temp.u('ownerX')::uuid, 'owner',      'TD Owner X',      '+237600241108', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  (pg_temp.pl('T')::uuid, pg_temp.g('T')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('U')::uuid, pg_temp.g('U')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('P')::uuid, pg_temp.g('P')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('K')::uuid, pg_temp.g('K')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  (pg_temp.pl('S')::uuid, pg_temp.g('S')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30);

select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is((select pg_temp.complete('T', 'tkd-t', pg_temp.pl('T'), 10)), '{"missing": [], "published": true}', 'gym T is published');
select is((select pg_temp.complete('U', 'tkd-u', pg_temp.pl('U'), 20)), '{"missing": [], "published": true}', 'gym U is published');
select is((select pg_temp.complete('P', 'tkd-p', pg_temp.pl('P'), 30)), '{"missing": [], "published": true}', 'gym P is published');
select is((select pg_temp.complete('K', 'tkd-k', pg_temp.pl('K'), 40)), '{"missing": [], "published": true}', 'gym K is published');
select is((select pg_temp.complete('S', 'tkd-s', pg_temp.pl('S'), 50)), '{"missing": [], "published": true}', 'gym S is published');
select pg_temp.settle();
-- an old name of T that redirects (a rename in the past)
insert into page_names (id, gym_id, name, state, origin, reserved_until) values
  ('00000000-0000-0000-0000-0000002411a1', pg_temp.g('T')::uuid, 'tkd-t-old', 'redirect', 'rename', now() + interval '6 months');
select is((select count(*)::int from private.gym_page_visible where name in ('tkd-t', 'tkd-u', 'tkd-p', 'tkd-k', 'tkd-s')), 5, 'control: five visible pages');

-- ---- A. who may take a page down, and what is refused ------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'privacy', null)$$), 'P0001:permission denied', 'an Owner cannot take their own page down');
select is(pg_temp.asauth($$select lift_gym_page_takedown('$$ || pg_temp.g('T') || $$', 'a good reason')$$), 'P0001:permission denied', 'an Owner cannot lift');
select pg_temp.claims(pg_temp.u('supT'), 'supervisor', pg_temp.g('T'));
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'privacy', null)$$), 'P0001:permission denied', 'a Supervisor cannot take a page down');
select is(pg_temp.asauth($$select list_page_reports()$$), 'P0001:permission denied', 'a Supervisor cannot read the report queue');
select is(pg_temp.asauth($$select list_page_appeals()$$), 'P0001:permission denied', 'a Supervisor cannot read the appeals');
select is(pg_temp.asauth($$select close_page_report(gen_random_uuid(), 'dismissed', 'a note')$$), 'P0001:permission denied', 'a Supervisor cannot close a report');
select is(pg_temp.asauth($$select decide_page_appeal(gen_random_uuid(), 'lift', 'a reason')$$), 'P0001:permission denied', 'a Supervisor cannot decide an appeal');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'privacy', null)$$), 'P0001:permission denied', 'still refused');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.asrole('anon', $$select take_down_gym_page(gen_random_uuid(), 'privacy', null)$$), '42501:permission denied for function take_down_gym_page', 'anon cannot execute take_down_gym_page');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'spam', null)$$), 'P0001:take_down_gym_page: invalid_reason', 'a reason outside the six codes is refused');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', null, null)$$), 'P0001:take_down_gym_page: invalid_reason', 'a null reason is refused');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'other', null)$$), 'P0001:take_down_gym_page: note_required', '"other" needs a note');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'other', ' ab ')$$), 'P0001:take_down_gym_page: note_required', 'a note under 3 characters (after trimming) is not enough');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'privacy', '$$ || repeat('x', 501) || $$')$$), 'P0001:take_down_gym_page: note_invalid', 'a note over 500 characters is refused');
select is(pg_temp.asauth($$select take_down_gym_page(gen_random_uuid(), 'privacy', null)$$), 'P0001:take_down_gym_page: gym not found', 'an unknown gym is refused');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('D') || $$', 'privacy', null)$$), 'P0001:take_down_gym_page: no_page', 'a gym with no page row has nothing to take down');
select is(pg_temp.page('T', 'taken_down_at'), 'null', 'nothing above changed the page');
-- the step-up allowlist (private.stepup_issue): the two takedown actions are issued to a Super Admin, refused to anyone else, and an unknown action is still refused
select isnt(pg_temp.stepup(pg_temp.u('admin'), 'take_down_gym_page', pg_temp.g('T')), 'null', 'step-up: take_down_gym_page is issued to a Super Admin');
select isnt(pg_temp.stepup(pg_temp.u('admin'), 'lift_gym_page_takedown', pg_temp.g('T')), 'null', 'step-up: lift_gym_page_takedown is issued to a Super Admin');
select is(pg_temp.stepup(pg_temp.u('ownerT'), 'take_down_gym_page', pg_temp.g('T')), 'ERR:42501', 'step-up: take_down_gym_page is refused (permission_denied) to anyone who is not a Super Admin');
select is(pg_temp.stepup(pg_temp.u('ownerT'), 'lift_gym_page_takedown', pg_temp.g('T')), 'ERR:42501', 'step-up: and lift_gym_page_takedown');
select is(pg_temp.stepup(pg_temp.u('admin'), 'take_down_the_moon', pg_temp.g('T')), 'ERR:42501', 'step-up: an action outside the list is refused');

-- ---- B. reports on visible pages (before any takedown) ------------------------------------------------------------------------
select is(pg_temp.report('tkd-p', 'privacy', repeat('a', 200), pg_temp.hash(1)), 'ok', 'a report on a visible page is stored');
select is((select count(*)::int from private.page_reports where gym_id = pg_temp.g('P')::uuid and source_hash = pg_temp.hash(1) and reason = 'privacy' and page_name = 'tkd-p' and status = 'open'), 1,
          'the row holds the reason, the page name and the keyed hash');
select is((select due_at = private.add_business_days(created_at, 5) from private.page_reports where gym_id = pg_temp.g('P')::uuid limit 1), true, 'due_at is 5 business days after the report');
select is((select count(*)::int from information_schema.columns where table_schema = 'private' and table_name = 'page_reports' and column_name ~* '(^|_)(ip|addr|address|agent|ua|cookie|email|phone)(_|$)'), 0, 'the reports table has no column that could hold an address or an identity');
select is(pg_temp.report('TKD-P', 'impersonation', ' mixed case name ', pg_temp.hash(2)), 'ok', 'the page name is matched case-insensitively and trimmed');
select is(pg_temp.report('tkd-p', 'nonsense', 'x', pg_temp.hash(3)), 'invalid', 'a reason outside the six codes is invalid');
select is(pg_temp.report('tkd-p', null, 'x', pg_temp.hash(3)), 'invalid', 'a null reason is invalid');
select is(pg_temp.report('tkd-p', 'privacy', repeat('a', 1001), pg_temp.hash(3)), 'invalid', 'details over 1000 characters are invalid');
select is(pg_temp.report('tkd-p', 'privacy', repeat('a', 1000), pg_temp.hash(3)), 'ok', 'details of exactly 1000 characters are accepted');
select is(pg_temp.report('tkd-p', 'privacy', '   ', pg_temp.hash(4)), 'invalid', 'empty details are invalid');
select is(pg_temp.report('tkd-p', 'privacy', null, pg_temp.hash(4)), 'invalid', 'null details are invalid');
select is(pg_temp.report('tkd-p', 'privacy', 'bad' || chr(1) || 'text', pg_temp.hash(4)), 'invalid', 'control characters in details are invalid');
select is(pg_temp.report('tkd-p', 'privacy', 'two' || E'\n' || 'lines', pg_temp.hash(4)), 'ok', 'a line break is allowed');
select is(pg_temp.report('tkd-p', 'privacy', 'x', 'not-a-hash'), 'invalid', 'a source hash that is not 64 hex characters is invalid');
select is(pg_temp.report('tkd-p', 'privacy', 'x', null), 'invalid', 'a null source hash is invalid');
select is(pg_temp.reports('P'), 4, 'only the four valid reports were stored; nothing from the invalid ones');
select is(pg_temp.report('no-such-page', 'privacy', 'x', pg_temp.hash(5)), 'not_found', 'an unknown page is not_found');
select is(pg_temp.report('', 'privacy', 'x', pg_temp.hash(5)), 'not_found', 'an empty name is not_found');
select is(pg_temp.report(null, 'privacy', 'x', pg_temp.hash(5)), 'not_found', 'a null name is not_found');
select is(pg_temp.report('tkd-p', 'privacy', 'x', pg_temp.hash(5)), 'ok', 'control: a fresh source can report');
-- rate limit: 5 per source hash per hour (hash 1 has one report; add four more, then the sixth is limited)
select is(pg_temp.report('tkd-u', 'privacy', 'r1', pg_temp.hash(9)) || pg_temp.report('tkd-u', 'privacy', 'r2', pg_temp.hash(9)) || pg_temp.report('tkd-u', 'privacy', 'r3', pg_temp.hash(9))
          || pg_temp.report('tkd-u', 'privacy', 'r4', pg_temp.hash(9)) || pg_temp.report('tkd-u', 'privacy', 'r5', pg_temp.hash(9)), 'okokokokok', 'a source may send five reports in an hour');
select is(pg_temp.report('tkd-u', 'privacy', 'r6', pg_temp.hash(9)), 'rate_limited', 'the sixth from the same source in the hour is rate_limited');
select is(pg_temp.reports('U'), 5, 'and nothing was stored for it');
select is(pg_temp.report('tkd-p', 'privacy', 'other page, same source', pg_temp.hash(9)), 'rate_limited', 'the limit is per source, across pages');
select is(pg_temp.report('tkd-u', 'privacy', 'other source', pg_temp.hash(10)), 'ok', 'another source is not limited');
update private.page_reports set created_at = now() - interval '2 hours' where source_hash = pg_temp.hash(9);
select is(pg_temp.report('tkd-u', 'privacy', 'an hour later', pg_temp.hash(9)), 'ok', 'reports older than an hour no longer count');
-- 30 per gym per day: fill gym P up to 30 in the last day with distinct sources, the next one is limited
insert into private.page_reports (gym_id, page_name, reason, details, source_hash, due_at)
select pg_temp.g('P')::uuid, 'tkd-p', 'privacy', 'filler', pg_temp.hash(1000 + i), now() + interval '5 days' from generate_series(1, 30 - pg_temp.reports('P')) i;
select is(pg_temp.reports('P'), 30, 'gym P holds 30 reports from the last day');
select is(pg_temp.report('tkd-p', 'privacy', 'one too many', pg_temp.hash(2000)), 'rate_limited', 'the 31st report on one gym in a day is rate_limited');
select is(pg_temp.report('tkd-u', 'privacy', 'a different gym', pg_temp.hash(2000)), 'ok', 'the per-gym limit does not touch another gym');
update private.page_reports set created_at = now() - interval '2 days' where gym_id = pg_temp.g('P')::uuid;
select is(pg_temp.report('tkd-p', 'privacy', 'a new day', pg_temp.hash(2001)), 'ok', 'reports older than a day no longer count');
-- the function is the reader's only door; other roles cannot call it
select is(pg_temp.asauth($$select public_site.submit_page_report('tkd-p', 'privacy', 'x', '$$ || pg_temp.hash(7) || $$')$$), '42501:permission denied for schema public_site', 'authenticated cannot reach public_site.submit_page_report');
select is(pg_temp.asrole('anon', $$select public_site.submit_page_report('tkd-p', 'privacy', 'x', '$$ || pg_temp.hash(7) || $$')$$), '42501:permission denied for schema public_site', 'anon cannot reach public_site.submit_page_report');
select is(pg_temp.asrole('service_role', $$select public_site.submit_page_report('tkd-p', 'privacy', 'x', '$$ || pg_temp.hash(7) || $$')$$), '42501:permission denied for schema public_site', 'service_role cannot reach public_site.submit_page_report');

-- ---- C. take T down ------------------------------------------------------------------------------------------------------------
select is(pg_temp.visible('tkd-t'), 1, 'control: T is visible');
select is(pg_temp.asrole('public_site_reader', $$select count(*) from public_site.page_redirects where old_name = 'tkd-t-old'$$), '1', 'control: the old name of T redirects');
select lives_ok($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'impersonation', 'Pretends to be a bank; see the report')$$, 'a live Super Admin takes T down');
select pg_temp.settle();
select is(pg_temp.page('T', 'taken_down_at is not null and published_at is not null and unpublished_at is null'), 'true', 'the page stays published but hidden (not unpublished)');
select is(pg_temp.page('T', 'taken_down_reason'), 'impersonation', 'the reason code is stored on the page row');
select is(pg_temp.page('T', 'taken_down_note'), 'Pretends to be a bank; see the report', 'and the note');
select is((select count(*)::int from page_names where gym_id = pg_temp.g('T')::uuid and state <> 'released' and taken_down_at is null), 0, 'every non-released name row of the gym is flagged (the redirect too)');
select is((select state from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), 'active', 'the active name is still the gym''s (reserved, not released)');
select is(pg_temp.visible('tkd-t'), 0, 'the visibility predicate hides the page at once');
select is(pg_temp.asrole('public_site_reader', $$select count(*) from public_site.pages where name = 'tkd-t'$$), '0', 'public_site.pages hides it');
select is((select count(*)::int from private.gym_page_visible v where v.name = 'tkd-t'), 0, 'private.gym_page_visible has no row for it');
select is(pg_temp.asrole('public_site_reader', $$select count(*) from public_site.page_redirects where old_name = 'tkd-t-old'$$), '0', 'the old name no longer redirects (FR-203: redirects drop at once)');
select is(pg_temp.asrole('public_site_reader', format($$select count(*) from public_site.page_media m where m.page_name_id = %L$$, pg_temp.pn_id('tkd-t'))), '0', 'public_site.page_media lists none of its images');
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.asauth($$select publish_gym_page('$$ || pg_temp.g('T') || $$', 'classic')$$), 'P0001:publish_gym_page: taken_down', 'publish raises taken_down');
select is(pg_temp.stat('T') ->> 'state', 'taken_down', 'the status is taken_down');
select is(pg_temp.stat('T') ->> 'taken_down_reason', 'impersonation', 'the status carries the reason code');
select is(pg_temp.stat('T') -> 'appeal' ->> 'state', 'none', 'and the appeal state (none yet)');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.stat('T') -> 'appeal') k), array['decided_at','decision_reason','state','submitted_at'], 'the appeal object has exactly the four keys the strict schema requires (none)');
select is((pg_temp.stat('T'))::text like '%Pretends%' or (pg_temp.stat('T'))::text like '%bank%', false, 'the status carries no note');
select is(pg_temp.notices('T', 'page_taken_down'), 1, 'the Owner got one takedown notice');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('T')::uuid and notice_type = 'page_taken_down' and user_id = pg_temp.u('ownerT')::uuid
            and body_en = 'GymOS took your page down: Impersonation. Your page name stays reserved for you. You can appeal from your page settings.'
            and body_fr = 'GymOS a retiré votre page : Usurpation d''identité. Le nom de votre page reste réservé pour vous. Vous pouvez faire appel depuis les paramètres de votre page.'), 1,
          'the notice carries the reason label in English and French (AD-27 copy)');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('T')::uuid and (body_en like '%bank%' or body_fr like '%bank%')), 0, 'the notice carries no internal note');
select is((select count(*)::int from email_outbox o join staff_notices n on n.id = o.notice_id where n.gym_id = pg_temp.g('T')::uuid and n.notice_type = 'page_taken_down' and o.recipient_email = 'ownerT-2411@x.example'), 1, 'and an e-mail is queued for the Owner');
select is((select count(*)::int from audit_log where action_type = 'gym_page_taken_down' and gym_id = pg_temp.g('T')::uuid and metadata ->> 'reason' = 'impersonation' and (metadata ->> 'has_note')::boolean), 1, 'the takedown is audited with the code');
select is((select count(*)::int from audit_log where gym_id = pg_temp.g('T')::uuid and metadata::text like '%bank%'), 0, 'the audit rows (readable by the Owner) carry no note text');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.asauth($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'privacy', null)$$), 'P0001:take_down_gym_page: already_taken_down', 'a second takedown of the same page is refused');
select is((select count(*)::int from private.page_takedowns where gym_id = pg_temp.g('T')::uuid and lifted_at is null and reason = 'impersonation' and page_name = 'tkd-t'), 1, 'one open takedown record');
-- the gate failing on a taken-down page: no reason write, no "fix it" notice (refresh_gym_page)
select pg_temp.plan_public('T', false);
select pg_temp.settle();
select is(private.gym_page_gate_missing(pg_temp.g('T')::uuid), array['no_name', 'no_public_plan'], 'control: with its plan private (and its active name taken down) the gate of T fails');
select pg_temp.plan_public('T', true);
select pg_temp.settle();
select pg_temp.plan_public('T', false);
select pg_temp.settle();
select is(pg_temp.page('T', 'unpublished_at is null and unpublished_reason is null'), 'true', 'refresh: a gate failure does not rewrite the takedown as an unpublish');
select is(pg_temp.notices('T', 'page_unpublished'), 0, 'refresh: no "fix it and publish again" notice for a taken-down page');
select pg_temp.plan_public('T', true);
select pg_temp.settle();
-- the sweep and the idle clock never release or age the name
update page_names set reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('T')::uuid and name in ('tkd-t', 'tkd-t-old');
select private.page_names_sweep();
select is((select state from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), 'active', 'the sweep does not release the name of a taken-down page');
select is((select state from page_names where name = 'tkd-t-old'), 'redirect', 'nor the EXPIRED flagged redirect of a gym that is still taken down');
-- the Owner cannot rename while the page is taken down (a rename would turn the flagged name into a redirect the sweep could release after a lift)
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.asauth($$select claim_page_name('$$ || pg_temp.g('T') || $$', 'tkd-t-renamed')$$), 'P0001:claim_page_name: page_taken_down', 'rename: an Owner is refused while the page is taken down');
select is((select name from page_names where gym_id = pg_temp.g('T')::uuid and state = 'active'), 'tkd-t', 'and the name is unchanged');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
update page_names set taken_down_at = null where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t';
select private.page_names_sweep();
select is((select state from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), 'active', 'the sweep honours the page-row predicate even if the name row is not flagged');
update page_names set taken_down_at = now() where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t';
update page_names set reserved_until = null where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t';
select private.set_page_name_idle(pg_temp.g('T')::uuid, true);
select is((select reserved_until from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), null, 'set_page_name_idle does not start the clock on a taken-down name');
-- suspension and reactivation never lift anything
update gyms set status = 'suspended' where id = pg_temp.g('T')::uuid;
select is(pg_temp.visible('tkd-t'), 0, 'a suspended gym with a takedown is hidden');
update gyms set status = 'active' where id = pg_temp.g('T')::uuid;
select is(pg_temp.visible('tkd-t'), 0, 'reactivation does not lift the takedown (FR-207)');
select is(pg_temp.stat('T') ->> 'state', 'taken_down', 'and the status still says taken_down');
select is(pg_temp.page('T', 'taken_down_at is not null'), 'true', 'the page row is still taken down after the round trip');
-- the report on a taken-down page
select is(pg_temp.report('tkd-t', 'privacy', 'x', pg_temp.hash(20)), 'not_found', 'report: a taken-down page answers not_found');
select is(pg_temp.reports('T'), 0, 'and nothing is stored');
select is(pg_temp.report('tkd-t-old', 'privacy', 'x', pg_temp.hash(20)), 'not_found', 'report: an old name answers not_found');

-- ---- D. every consumer of the takedown predicate, and proof that each check can fail -----------------------------------------------
-- Gym K: only the PAGE row is taken down (the name rows are not flagged), so each consumer is tested on the page predicate alone.
update gym_pages set taken_down_at = now(), taken_down_reason = 'privacy' where gym_id = pg_temp.g('K')::uuid;
-- an unflagged old-name redirect of K: public_site.page_redirects must still hide it, on the page predicate alone
insert into page_names (gym_id, name, state, origin, reserved_until) values (pg_temp.g('K')::uuid, 'tkd-k-old', 'redirect', 'rename', now() + interval '6 months');
create or replace function pg_temp.consumer(c text) returns text language plpgsql as $f$
declare v text;
begin
  if c = 'visible' then
    return (select count(*)::text from private.gym_page_visible where name = 'tkd-k');
  elsif c = 'reader_pages' then
    set local role public_site_reader;
    select count(*)::text into v from public_site.pages where name = 'tkd-k';
    reset role;
    return v;
  elsif c = 'reader_media' then
    set local role public_site_reader;
    execute format('select count(*)::text from public_site.page_media m where m.page_name_id = %L', pg_temp.pn_id('tkd-k')) into v;
    reset role;
    return v;
  elsif c = 'reader_redirects' then
    set local role public_site_reader;
    select count(*)::text into v from public_site.page_redirects where old_name = 'tkd-k-old';
    reset role;
    return v;
  elsif c = 'publish' then
    set local role authenticated;
    begin
      perform public.publish_gym_page(pg_temp.g('K')::uuid, 'classic');
      v := 'published';
    exception when others then
      v := sqlerrm;
    end;
    reset role;
    return v;
  elsif c = 'refresh' then
    update gym_pages set unpublished_at = null, unpublished_reason = null where gym_id = pg_temp.g('K')::uuid;
    delete from staff_notices where gym_id = pg_temp.g('K')::uuid and notice_type = 'page_unpublished';
    perform pg_temp.plan_public('K', false);
    perform pg_temp.settle();
    v := coalesce(pg_temp.page('K', 'unpublished_reason'), 'null') || '|' || pg_temp.notices('K', 'page_unpublished');
    perform pg_temp.plan_public('K', true);
    perform pg_temp.settle();
    update gym_pages set unpublished_at = null, unpublished_reason = null where gym_id = pg_temp.g('K')::uuid;
    return v;
  elsif c = 'sweep' then
    update page_names set state = 'active', taken_down_at = null, reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k';
    perform private.page_names_sweep();
    v := (select state from page_names where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k');
    update page_names set state = 'active', reserved_until = null where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k';
    return v;
  elsif c = 'idle' then
    update page_names set reserved_until = null where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k';
    perform private.set_page_name_idle(pg_temp.g('K')::uuid, true);
    v := (select coalesce(reserved_until::text, 'null') from page_names where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k');
    update page_names set reserved_until = null where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k';
    return v;
  elsif c = 'status' then
    return pg_temp.stat('K') ->> 'state';
  elsif c = 'redirect_sweep' then
    -- an expired, flagged redirect of a gym whose page is still taken down (gym T, section C)
    update page_names set state = 'redirect', reserved_until = now() - interval '1 day', taken_down_at = now() where name = 'tkd-t-old';
    perform private.page_names_sweep();
    v := (select state from page_names where name = 'tkd-t-old');
    update page_names set state = 'redirect', reserved_until = now() - interval '1 day', taken_down_at = now() where name = 'tkd-t-old';
    return v;
  elsif c = 'claim_sa' then
    -- a Super Admin forces a new name onto a gym whose page row is taken down: refused (the flagged name is never released, AD-45, SA-17);
    -- rolled back whatever it does, and it reports what became of the old name
    begin
      perform pg_temp.claims(pg_temp.u('admin'), 'super_admin');
      perform public.claim_page_name(pg_temp.g('K')::uuid, 'tkd-k-sa');
      raise exception 'CLAIMED:%|%', (select taken_down_at is not null from public.gym_pages where gym_id = pg_temp.g('K')::uuid),
        (select state from public.page_names where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k');
    exception when others then
      v := sqlerrm;
    end;
    return v;
  elsif c = 'claim' then
    -- an Owner renames while the page row is taken down; the attempt is rolled back whatever it does
    begin
      perform pg_temp.claims(pg_temp.u('ownerK'), 'owner', pg_temp.g('K'));
      set local role authenticated;
      perform public.claim_page_name(pg_temp.g('K')::uuid, 'tkd-k-renamed');
      raise exception 'CLAIMED';
    exception when others then
      v := sqlerrm;
    end;
    reset role;
    return v;
  end if;
  return 'unknown consumer ' || c;
end $f$;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.consumer('visible'), '0', 'consumer private.gym_page_visible: a page row taken down is hidden');
select is(pg_temp.consumer('reader_pages'), '0', 'consumer public_site.pages: hidden');
select is(pg_temp.consumer('reader_media'), '0', 'consumer public_site.page_media: none of its images');
select is(pg_temp.consumer('reader_redirects'), '0', 'consumer public_site.page_redirects: an unflagged old name does not redirect to a hidden page');
select is(pg_temp.consumer('publish'), 'publish_gym_page: taken_down', 'consumer publish_gym_page: raises taken_down');
select is(pg_temp.consumer('refresh'), 'null|0', 'consumer refresh_gym_page: no gate-reason write and no Owner notice');
select is(pg_temp.consumer('sweep'), 'active', 'consumer page_names_sweep: the name is not released');
select is(pg_temp.consumer('idle'), 'null', 'consumer set_page_name_idle: the clock does not start');
select is(pg_temp.consumer('status'), 'taken_down', 'consumer get_gym_page_status: taken_down');
select is(pg_temp.consumer('claim'), 'claim_page_name: page_taken_down', 'consumer claim_page_name: an Owner cannot rename while the page is taken down');
select is(pg_temp.consumer('redirect_sweep'), 'redirect', 'consumer page_names_sweep loop 2: an expired flagged redirect of a taken-down gym is kept');
-- every one of them can fail: break the consumer, the same check turns
create or replace view private.gym_page_visible with (security_barrier = true) as
select gp.page_name_id, gp.template, gp.schema_version, gp.content, gp.published_at, gp.updated_at, pn.name
from public.gym_pages gp join public.page_names pn on pn.id = gp.page_name_id and pn.gym_id = gp.gym_id join public.gyms g on g.id = gp.gym_id
where gp.published_at is not null and gp.unpublished_at is null and pn.state = 'active' and pn.taken_down_at is null and g.status = 'active';
select is(pg_temp.consumer('visible'), '1', 'KNOWN-BAD: a visibility predicate without the page-row term shows the taken-down page');
select is(pg_temp.consumer('reader_pages'), '1', 'KNOWN-BAD: and public_site.pages, built on it, serves the taken-down page');
select is(pg_temp.consumer('reader_media'), '2', 'KNOWN-BAD: and public_site.page_media lists its images');
select is(pg_temp.consumer('reader_redirects'), '1', 'KNOWN-BAD: and public_site.page_redirects forwards the old name to the taken-down page');
create or replace view private.gym_page_visible with (security_barrier = true) as
select gp.page_name_id, gp.template, gp.schema_version, gp.content, gp.published_at, gp.updated_at, pn.name
from public.gym_pages gp join public.page_names pn on pn.id = gp.page_name_id and pn.gym_id = gp.gym_id join public.gyms g on g.id = gp.gym_id
where gp.published_at is not null and gp.unpublished_at is null and gp.taken_down_at is null and pn.state = 'active' and pn.taken_down_at is null and g.status = 'active';
select is(pg_temp.consumer('visible'), '0', 'control: the predicate is restored');
select pg_temp.mutate('public.publish_gym_page(uuid,text)'::regprocedure, 'v_has_page and v_page\.taken_down_at is not null', 'false');
select is(pg_temp.consumer('publish'), 'published', 'KNOWN-BAD: a publish without the taken_down refusal publishes a taken-down page');
select pg_temp.restore('public.publish_gym_page(uuid,text)'::regprocedure);
select is(pg_temp.consumer('publish'), 'publish_gym_page: taken_down', 'control: publish restored');
select pg_temp.mutate('private.refresh_gym_page(uuid)'::regprocedure, ' or v_page\.taken_down_at is not null', '');
select isnt(pg_temp.consumer('refresh'), 'null|0', 'KNOWN-BAD: a refresh without the takedown skip rewrites the takedown as a gate failure and tells the Owner');
select pg_temp.restore('private.refresh_gym_page(uuid)'::regprocedure);
select is(pg_temp.consumer('refresh'), 'null|0', 'control: refresh restored');
select pg_temp.mutate('private.page_names_sweep()'::regprocedure, 'and not private\.gym_page_taken_down\((pn|r)\.gym_id\)', '');
select is(pg_temp.consumer('sweep'), 'released', 'KNOWN-BAD: a sweep without the page-row predicate releases the name of a taken-down page');
select pg_temp.restore('private.page_names_sweep()'::regprocedure);
select is(pg_temp.consumer('sweep'), 'active', 'control: sweep restored');
select pg_temp.mutate('private.set_page_name_idle(uuid,boolean)'::regprocedure, 'if private\.gym_page_taken_down\(p_gym_id\) then\s+return;\s+end if;', '');
select isnt(pg_temp.consumer('idle'), 'null', 'KNOWN-BAD: an idle setter without the predicate starts the clock on a taken-down name');
select pg_temp.restore('private.set_page_name_idle(uuid,boolean)'::regprocedure);
select is(pg_temp.consumer('idle'), 'null', 'control: idle setter restored');
select pg_temp.mutate('public.get_gym_page_status(uuid)'::regprocedure, 'when v_taken then ''taken_down''', 'when false then ''taken_down''');
select isnt(pg_temp.consumer('status'), 'taken_down', 'KNOWN-BAD: a status function that ignores the takedown reports a different state');
select pg_temp.restore('public.get_gym_page_status(uuid)'::regprocedure);
select is(pg_temp.consumer('status'), 'taken_down', 'control: status restored');
select pg_temp.mutate('public.claim_page_name(uuid,text)'::regprocedure, 'if private\.gym_page_taken_down\(p_gym_id\) then\s+raise exception ''claim_page_name: page_taken_down'';\s+end if;', '');
select is(pg_temp.consumer('claim'), 'CLAIMED', 'KNOWN-BAD: a claim without the refusal lets an Owner rename a taken-down page');
select is(pg_temp.consumer('claim_sa'), 'CLAIMED:t|released', 'KNOWN-BAD: and a Super Admin forced claim releases the flagged old name');
select pg_temp.restore('public.claim_page_name(uuid,text)'::regprocedure);
select is(pg_temp.consumer('claim'), 'claim_page_name: page_taken_down', 'control: claim_page_name restored');
select is(pg_temp.consumer('claim_sa'), 'claim_page_name: page_taken_down', 'consumer claim_page_name: a Super Admin forced claim is refused too (the taken-down name is never released)');
select is((select state from page_names where gym_id = pg_temp.g('K')::uuid and name = 'tkd-k'), 'active', 'and the old name of the taken-down gym is still its active name');
select pg_temp.mutate('private.page_names_sweep()'::regprocedure, 'and \(pn\.taken_down_at is null or not private\.gym_page_taken_down\(pn\.gym_id\)\)', '');
select is(pg_temp.consumer('redirect_sweep'), 'released', 'KNOWN-BAD: a sweep loop 2 without its predicate releases the expired flagged redirect of a taken-down gym');
select pg_temp.restore('private.page_names_sweep()'::regprocedure);
select is(pg_temp.consumer('redirect_sweep'), 'redirect', 'control: sweep restored');
-- the shared predicate helper: break it and both of its callers turn
create or replace function private.gym_page_taken_down(p_gym_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select false $$;
select is(pg_temp.consumer('sweep'), 'released', 'KNOWN-BAD: with the shared helper broken the sweep releases the name');
select isnt(pg_temp.consumer('idle'), 'null', 'KNOWN-BAD: and the idle setter ages it');
create or replace function private.gym_page_taken_down(p_gym_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gym_pages gp where gp.gym_id = p_gym_id and gp.taken_down_at is not null);
$$;
select is(pg_temp.consumer('sweep'), 'active', 'control: the helper is restored');
update gym_pages set taken_down_at = null, taken_down_reason = null where gym_id = pg_temp.g('K')::uuid;

-- ---- E. report queue and closure ------------------------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is((select count(*)::int from list_page_reports()), (select count(*)::int from private.page_reports where status = 'open'), 'the queue lists every open report');
select is((select array_agg(id order by due_at, id) from list_page_reports()), (select array_agg(id order by due_at, id) from private.page_reports where status = 'open'), 'ordered by due date');
update private.page_reports set due_at = now() - interval '1 day' where id = (select id from private.page_reports where gym_id = pg_temp.g('U')::uuid order by created_at limit 1);
select is((select count(*)::int from list_page_reports() where overdue), 1, 'a report past its 5 business days carries the Overdue mark');
select is((select bool_and(not overdue) from list_page_reports() where due_at > now()), true, 'and the others do not');
create temp table rep_u as select id from private.page_reports where gym_id = pg_temp.g('U')::uuid order by created_at, id limit 3;
grant select on rep_u to authenticated;
select is(pg_temp.asauth($$select close_page_report((select id from rep_u limit 1), 'dismissed', null)$$), 'P0001:close_page_report: note_required', 'dismissing needs a note');
select is(pg_temp.asauth($$select close_page_report((select id from rep_u limit 1), 'maybe', 'a note')$$), 'P0001:close_page_report: invalid_outcome', 'an unknown outcome is refused');
select is(pg_temp.asauth($$select close_page_report((select id from rep_u limit 1), 'dismissed', '$$ || repeat('x', 501) || $$')$$), 'P0001:close_page_report: note_invalid', 'a note over 500 characters is note_invalid, not note_required');
select is(pg_temp.asauth($$select close_page_report((select id from rep_u limit 1), 'taken_down', '$$ || repeat('x', 501) || $$')$$), 'P0001:close_page_report: note_invalid', 'also for the taken_down outcome');
select is(pg_temp.asauth($$select close_page_report(gen_random_uuid(), 'dismissed', 'a note')$$), 'P0001:close_page_report: not_found', 'an unknown report is refused');
select is(pg_temp.asauth($$select close_page_report((select id from rep_u limit 1), 'taken_down', null)$$), 'P0001:close_page_report: not_taken_down', 'taken_down needs the page to be taken down');
select is((select status from private.page_reports where id = (select id from rep_u limit 1)), 'open', 'and the report stays open');
select lives_ok($$select close_page_report((select id from rep_u limit 1), 'dismissed', 'Checked: it is the gym''s own logo')$$, 'a dismissal with a note closes the report');
select is((select concat_ws('|', status, closed_note, (closed_by is not null)::text, (closed_at is not null)::text) from private.page_reports where id = (select id from rep_u limit 1)), 'dismissed|Checked: it is the gym''s own logo|true|true', 'status, note, actor and time are recorded');
select is(pg_temp.asauth($$select close_page_report((select id from rep_u limit 1), 'dismissed', 'again')$$), 'P0001:close_page_report: not_open', 'a closed report cannot be closed again');
select is((select count(*)::int from list_page_reports() where id = (select id from rep_u limit 1)), 0, 'and it left the queue');
-- taking a page down from a report records the link
select lives_ok($$select take_down_gym_page('$$ || pg_temp.g('U') || $$', 'trademark', null)$$, 'U is taken down (from its reports)');
select lives_ok($$select close_page_report((select id from rep_u offset 1 limit 1), 'taken_down', null)$$, 'a report closes as taken_down once the page is down');
select is((select (takedown_id = (select id from private.page_takedowns where gym_id = pg_temp.g('U')::uuid and lifted_at is null))::text from private.page_reports where id = (select id from rep_u offset 1 limit 1)), 'true', 'and records the link to that takedown');
select is((select count(*)::int from list_page_reports() where gym_id = pg_temp.g('U')::uuid and page_taken_down), (select count(*)::int from private.page_reports where gym_id = pg_temp.g('U')::uuid and status = 'open'), 'the queue shows the page as taken down');
select pg_temp.settle();

-- ---- F. appeals ------------------------------------------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('supT'), 'supervisor', pg_temp.g('T'));
select is(pg_temp.asauth($$select submit_page_appeal('Please restore it')$$), 'P0001:permission denied', 'a Supervisor cannot appeal');
select pg_temp.claims(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.asauth($$select submit_page_appeal('Please restore it')$$), 'P0001:submit_page_appeal: not_taken_down', 'an Owner whose page is not taken down cannot appeal');
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.asauth($$select submit_page_appeal('')$$), 'P0001:submit_page_appeal: reason_required', 'the appeal reason is required');
select is(pg_temp.asauth($$select submit_page_appeal('$$ || repeat('x', 501) || $$')$$), 'P0001:submit_page_appeal: reason_required', 'and at most 500 characters');
select is(pg_temp.asauth($$select submit_page_appeal('$$ || repeat('x', 500) || $$') ->> 'state'$$), 'open', 'an Owner appeals with 500 characters');
select is(pg_temp.asauth($$select submit_page_appeal('Again')$$), 'P0001:submit_page_appeal: appeal_open', 'a second appeal while one is open is refused');
select is(pg_temp.stat('T') -> 'appeal' ->> 'state', 'open', 'the status says the appeal is open');
select is((pg_temp.stat('T') -> 'appeal' ->> 'submitted_at') is not null, true, 'with its date');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.stat('T') -> 'appeal') k), array['decided_at','decision_reason','state','submitted_at'], 'the appeal object has exactly the four keys (open)');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is((select count(*)::int from list_page_appeals() where gym_id = pg_temp.g('T')::uuid and decision is null and takedown_reason = 'impersonation' and takedown_note like 'Pretends%'), 1, 'Super Admin sees the appeal with the takedown reason and note');
create temp table ap_t as select id from private.page_appeals where gym_id = pg_temp.g('T')::uuid;
grant select on ap_t to authenticated;
select is(pg_temp.asauth($$select decide_page_appeal((select id from ap_t), 'maybe', 'some reason')$$), 'P0001:decide_page_appeal: invalid_decision', 'an unknown decision is refused');
select is(pg_temp.asauth($$select decide_page_appeal((select id from ap_t), 'uphold', 'no')$$), 'P0001:decide_page_appeal: reason_required', 'a decision needs a reason of 3 to 500 characters');
select is(pg_temp.asauth($$select decide_page_appeal(gen_random_uuid(), 'uphold', 'a reason')$$), 'P0001:decide_page_appeal: not_found', 'an unknown appeal is refused');
select lives_ok($$select decide_page_appeal((select id from ap_t), 'uphold', 'The page copies a bank''s name and logo')$$, 'Super Admin upholds');
select is(pg_temp.page('T', 'taken_down_at is not null'), 'true', 'an upheld appeal keeps the takedown');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('T')::uuid and notice_type = 'page_appeal_decided'
            and body_en = 'GymOS reviewed your appeal and upheld the takedown of your page. Reason: The page copies a bank''s name and logo.'
            and body_fr like 'GymOS a examiné votre appel et maintient le retrait de votre page. Motif : The page copies%'), 1, 'the reason reaches the Owner, in English and French');
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.stat('T') -> 'appeal' ->> 'state', 'uphold', 'the status shows the upheld decision');
select is(pg_temp.stat('T') -> 'appeal' ->> 'decision_reason', 'The page copies a bank''s name and logo', 'with the decision reason');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.stat('T') -> 'appeal') k), array['decided_at','decision_reason','state','submitted_at'], 'the appeal object has exactly the four keys (decided)');
select is(pg_temp.asauth($$select submit_page_appeal('A second try')$$), 'P0001:submit_page_appeal: appeal_decided', 'no second appeal after an upheld decision');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.asauth($$select decide_page_appeal((select id from ap_t), 'lift', 'changed my mind')$$), 'P0001:decide_page_appeal: not_open', 'a decided appeal cannot be decided again');
-- a manual lift (reason 3 to 500), then the page comes back unpublished
select is(pg_temp.asauth($$select lift_gym_page_takedown('$$ || pg_temp.g('T') || $$', 'no')$$), 'P0001:lift_gym_page_takedown: reason_required', 'a lift reason under 3 characters is refused');
select is(pg_temp.asauth($$select lift_gym_page_takedown('$$ || pg_temp.g('P') || $$', 'a good reason')$$), 'P0001:lift_gym_page_takedown: not_taken_down', 'lifting a page that is not taken down is refused');
select lives_ok($$select lift_gym_page_takedown('$$ || pg_temp.g('T') || $$', 'The Owner removed the logo and the text')$$, 'Super Admin lifts the takedown of T');
select pg_temp.settle();
select is(pg_temp.page('T', 'taken_down_at is null and taken_down_reason is null and taken_down_note is null'), 'true', 'the page flag, reason and note are cleared');
select is(pg_temp.page('T', 'unpublished_at is not null'), 'true', 'the page comes back UNPUBLISHED (the Owner republishes through the gate)');
select is(pg_temp.visible('tkd-t'), 0, 'so it is still not public');
select is((select taken_down_at is null from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), true, 'the active name is unflagged');
select is((select taken_down_at is not null from page_names where name = 'tkd-t-old'), true, 'the old-name redirect stays dropped');
select is(pg_temp.asrole('public_site_reader', $$select count(*) from public_site.page_redirects where old_name = 'tkd-t-old'$$), '0', 'and does not redirect');
-- the flagged redirect is still there (the sweep has not run): it must not keep the status at taken_down
update page_names set state = 'redirect', reserved_until = now() - interval '1 day', taken_down_at = now() where name = 'tkd-t-old';
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.stat('T') ->> 'state', 'ready', 'the status after a lift is not taken_down although a flagged old-name redirect remains');
select pg_temp.mutate('public.get_gym_page_status(uuid)'::regprocedure, 'pn\.state in \(''active'', ''held'', ''reserved''\)', 'pn.state <> ''released''');
select is(pg_temp.stat('T') ->> 'state', 'taken_down', 'KNOWN-BAD: a status that counts a flagged redirect keeps the Owner on taken_down after the lift');
select pg_temp.restore('public.get_gym_page_status(uuid)'::regprocedure);
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select private.page_names_sweep();
select is((select state from page_names where name = 'tkd-t-old'), 'released', 'after the lift the sweep releases the expired flagged redirect (its 12 months are over)');
select is((select state from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), 'active', 'and not the active name');
select is((select reserved_until between now() + interval '11 months' and now() + interval '13 months' from page_names where gym_id = pg_temp.g('T')::uuid and name = 'tkd-t'), true, 'the 12-month clock starts again');
select is((select count(*)::int from private.page_takedowns where gym_id = pg_temp.g('T')::uuid and lifted_at is not null and lift_reason = 'The Owner removed the logo and the text' and lifted_by is not null), 1, 'the lift is recorded');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('T')::uuid and notice_type = 'page_takedown_lifted' and body_en like '%Reason: The Owner removed the logo and the text.%' and body_fr like '%Motif : The Owner removed%'), 1, 'the Owner is told, with the reason');
select is((select count(*)::int from audit_log where action_type = 'gym_page_takedown_lifted' and gym_id = pg_temp.g('T')::uuid), 1, 'the lift is audited');
select pg_temp.claims(pg_temp.u('ownerT'), 'owner', pg_temp.g('T'));
select is(pg_temp.stat('T') ->> 'state', 'ready', 'the status says ready (the gate decides when they republish)');
select is(pg_temp.asauth($$select publish_gym_page('$$ || pg_temp.g('T') || $$', 'classic')::text$$), '{"missing": [], "published": true}', 'the Owner republishes through the gate');
select pg_temp.settle();
select is(pg_temp.visible('tkd-t'), 1, 'and the page is public again');
select is(pg_temp.asauth($$select submit_page_appeal('Nothing to appeal')$$), 'P0001:submit_page_appeal: not_taken_down', 'a lifted takedown cannot be appealed');
-- a fresh takedown of T allows a fresh appeal; an appeal decided `lift` runs the lift
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select lives_ok($$select take_down_gym_page('$$ || pg_temp.g('T') || $$', 'other', 'Second incident')$$, 'T is taken down again');
select is((select count(*)::int from private.page_takedowns where gym_id = pg_temp.g('T')::uuid), 2, 'two takedown records for T');
select pg_temp.claims(pg_temp.u('ownerU'), 'owner', pg_temp.g('U'));
select is(pg_temp.asauth($$select submit_page_appeal('The trademark is ours')->>'state'$$), 'open', 'the Owner of U appeals');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select lives_ok($$select decide_page_appeal((select id from private.page_appeals where gym_id = pg_temp.g('U')::uuid), 'lift', 'The mark is registered to the gym')$$, 'Super Admin decides lift');
select pg_temp.settle();
select is((select concat_ws('|', decision, decision_reason) from private.page_appeals where gym_id = pg_temp.g('U')::uuid), 'lift|The mark is registered to the gym', 'the appeal is decided with the reason');
select is(pg_temp.page('U', 'taken_down_at is null and unpublished_at is not null'), 'true', 'the lift ran: U is unpublished and no longer taken down');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('U')::uuid and notice_type = 'page_takedown_lifted' and title_en = 'Your appeal was accepted' and body_en like '%The mark is registered to the gym%'), 1, 'the Owner is told the appeal was accepted, with the reason');
select is((select count(*)::int from private.page_takedowns where gym_id = pg_temp.g('U')::uuid and lifted_at is not null), 1, 'the takedown of U is closed');
-- an appeal raised while a Super Admin lifts by hand is closed with the lift
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select lives_ok($$select take_down_gym_page('$$ || pg_temp.g('U') || $$', 'illegal_content', null)$$, 'U is taken down again');
select pg_temp.claims(pg_temp.u('ownerU'), 'owner', pg_temp.g('U'));
select is(pg_temp.asauth($$select submit_page_appeal('A new appeal for a new takedown')->>'state'$$), 'open', 'a new takedown can be appealed once more');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select lives_ok($$select lift_gym_page_takedown('$$ || pg_temp.g('U') || $$', 'Lifted by hand after review')$$, 'a manual lift with an open appeal');
select is((select decision from private.page_appeals a join private.page_takedowns t on t.id = a.takedown_id where t.gym_id = pg_temp.g('U')::uuid and t.reason = 'illegal_content'), 'lift', 'closes the open appeal as lifted');
select pg_temp.settle();

-- ---- G. media purge ---------------------------------------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
-- gym D: a draft (no page row) with an uploaded logo; gym P's gallery; gym S suspended with a live page
select register_page_media(pg_temp.g('D')::uuid, 'logo', pg_temp.g('D') || '/' || pg_temp.ok_(60), pg_temp.dk(60), true, 'v1');
select register_page_media(pg_temp.g('P')::uuid, 'gallery', pg_temp.g('P') || '/' || pg_temp.ok_(61), pg_temp.dk(61), true, 'v1');
select register_page_media(pg_temp.g('P')::uuid, 'gallery', pg_temp.g('P') || '/' || pg_temp.ok_(62), pg_temp.dk(62), true, 'v1');
select pg_temp.settle();
update gyms set status = 'suspended' where id = pg_temp.g('S')::uuid;
create temp table cand as select * from page_media_purge_candidates(500);
select is((select count(*)::int from cand c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('P')::uuid), 0, 'candidates: a live published page keeps its images');
select is((select count(*)::int from cand c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('S')::uuid), 0, 'candidates: a suspended gym''s live page keeps its images (reactivation restores the page)');
select is((select count(*)::int from cand c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('D')::uuid), 0, 'candidates: a draft with no page row keeps its images');
select is((select count(*)::int from cand c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('K')::uuid), 0, 'candidates: nor does the other live page');
select is((select count(*)::int from cand c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('T')::uuid and c.purge_derivative and not c.purge_original), 2, 'candidates: the taken-down page T loses both derivatives and keeps the originals');
select is((select count(*)::int from cand c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('U')::uuid and c.purge_derivative and not c.purge_original), 2, 'candidates: so does U (unpublished after the lift)');
-- listing stamps NOTHING (a run killed after the list, or before the delete, leaves no trace)
select is((select count(*)::int from gym_page_media where purged_at is not null or original_purged_at is not null), 0, 'listing the candidates stamps nothing');
select is((select count(*)::int from page_media_purge_candidates(500) c join gym_page_media m on m.id = c.id where m.gym_id in (pg_temp.g('T')::uuid, pg_temp.g('U')::uuid)), 4, 'so the same rows are listed again on the next tick');
-- mark only after a confirmed delete
select is(page_media_purge_mark((select id from gym_page_media where gym_id = pg_temp.g('T')::uuid and kind = 'logo'), true, false), true, 'mark: a confirmed derivative delete is marked');
select is((select count(*)::int from gym_page_media where gym_id = pg_temp.g('T')::uuid and purged_at is not null and original_purged_at is null), 1, 'purged_at is set, original_purged_at is not');
select is((select count(*)::int from page_media_purge_candidates(500) c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('T')::uuid), 1, 'a marked row is no longer listed');
select is(page_media_purge_mark((select id from gym_page_media where gym_id = pg_temp.g('T')::uuid and kind = 'logo'), true, false), true, 'marking again is harmless');
select is(page_media_purge_mark((select id from gym_page_media where gym_id = pg_temp.g('T')::uuid and kind = 'banner'), false, true), false, 'mark: the original of a row that is not deleted is never marked');
select is((select count(*)::int from gym_page_media where gym_id = pg_temp.g('T')::uuid and original_purged_at is not null), 0, 'and nothing was stamped');
-- the mark re-checks the candidate rule: a page republished since the list keeps a live row
update gym_pages set unpublished_at = null where gym_id = pg_temp.g('U')::uuid;
select is(page_media_purge_mark((select id from gym_page_media where gym_id = pg_temp.g('U')::uuid and kind = 'logo'), true, false), false, 'mark: refused while the page is live again');
select is((select count(*)::int from gym_page_media where gym_id = pg_temp.g('U')::uuid and purged_at is not null), 0, 'and the row is not marked');
select is((select count(*)::int from page_media_purge_candidates(500) c join gym_page_media m on m.id = c.id where m.gym_id = pg_temp.g('U')::uuid), 0, 'a live page is not listed either');
update gym_pages set unpublished_at = now() where gym_id = pg_temp.g('U')::uuid;
select is(page_media_purge_mark((select id from gym_page_media where gym_id = pg_temp.g('U')::uuid and kind = 'logo'), true, false), true, 'mark: accepted once the page is offline again');
select is(page_media_purge_mark((select id from gym_page_media where gym_id = pg_temp.g('U')::uuid and kind = 'banner'), true, false), true, 'and for the other image');
-- a deleted image loses both objects, even on a live page
select set_config('request.jwt.claims', '', true);
select pg_temp.claims(pg_temp.u('ownerP'), 'owner', pg_temp.g('P'));
select is(pg_temp.asauth($$select delete_page_media(pg_temp.mid(61))$$), '', 'the Owner deletes a gallery image');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is((select concat_ws('|', c.purge_derivative::text, c.purge_original::text) from page_media_purge_candidates(500) c join gym_page_media m on m.id = c.id where m.derivative_key = pg_temp.dk(61)), 'true|true', 'a deleted image is listed for both its derivative and its original');
select is(page_media_purge_mark((select id from gym_page_media where derivative_key = pg_temp.dk(61)), true, false), true, 'its derivative is marked after the delete');
select is((select concat_ws('|', c.purge_derivative::text, c.purge_original::text) from page_media_purge_candidates(500) c join gym_page_media m on m.id = c.id where m.derivative_key = pg_temp.dk(61)), 'false|true', 'a failed original delete leaves only the original listed (retried on the next tick)');
select is(page_media_purge_mark((select id from gym_page_media where derivative_key = pg_temp.dk(61)), false, true), true, 'the original is marked once deleted');
select is((select count(*)::int from page_media_purge_candidates(500) c join gym_page_media m on m.id = c.id where m.derivative_key = pg_temp.dk(61)), 0, 'and the row is done');
select is((select count(*)::int from gym_page_media where derivative_key = pg_temp.dk(61) and purged_at is not null and original_purged_at is not null and deleted_at is not null), 1, 'the row stays as a tombstone');
-- the rows are never deleted by the purge, so the upload count of register_page_media is not lowered
select is((select count(*)::int from gym_page_media where gym_id = pg_temp.g('P')::uuid), 4, 'gym P still has all four rows (logo, banner and two gallery images), purged or not');
select is((select count(*)::int from gym_page_media where gym_id = pg_temp.g('P')::uuid and created_at > now() - interval '24 hours'), 4, 'so the 30-per-24-hours count still counts them');
select is((select count(*)::int from pg_proc where proname in ('page_media_purge_candidates', 'page_media_purge_mark') and pronamespace = 'public'::regnamespace and prosrc ~* 'delete\s+from'), 0, 'neither purge function has a delete');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('page_media_purge_claim', 'page_media_purge_release')), 0, 'there is no claim and no release function (owner decision 2026-11-09)');
select is((select count(*)::int from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f' and prosrc ~* 'delete\s+from\s+(storage\.|public\.)?(objects|gym_page_media)\M'), 0, 'no function deletes a Storage object or a media row');
-- republish path
select is((select count(*)::int from page_media_rederive_list(pg_temp.g('U')::uuid)), 2, 'rederive: the live rows of U whose derivative was purged are listed');
select is((select array_agg(kind order by kind) from page_media_rederive_list(pg_temp.g('U')::uuid)), array['banner', 'logo'], 'with their kind');
select is((select count(*)::int from page_media_rederive_list(pg_temp.g('P')::uuid) where derivative_key = pg_temp.dk(61)), 0, 'a deleted row is never re-derived');
select is(page_media_rederive_done(pg_temp.g('U')::uuid, (select array_agg(id) from page_media_rederive_list(pg_temp.g('U')::uuid))), 2, 'rederive_done clears both');
select is((select count(*)::int from page_media_rederive_list(pg_temp.g('U')::uuid)), 0, 'and the list is empty');
select is(page_media_rederive_done(pg_temp.g('U')::uuid, array(select id from gym_page_media where gym_id = pg_temp.g('T')::uuid)), 0, 'rederive_done touches only the named gym''s rows');
-- orphans: objects with no row, older than an hour
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('gym-page-media', 'cccccccc-cccc-cccc-cccc-000000000001.webp', null, now() - interval '3 hours'),
  ('gym-page-media', 'cccccccc-cccc-cccc-cccc-000000000002.webp', null, now() - interval '10 minutes'),
  ('gym-page-media', pg_temp.dk(10), null, now() - interval '3 hours'),
  ('gym-page-media', pg_temp.dk(61), null, now() - interval '3 hours'),
  ('gym-page-media-src', pg_temp.g('D') || '/dddddddd-dddd-dddd-dddd-000000000001', null, now() - interval '3 hours'),
  ('gym-page-media-src', pg_temp.g('T') || '/' || pg_temp.ok_(10), null, now() - interval '3 hours');
select is((select array_agg(bucket_id || ':' || name order by bucket_id, name) from page_media_purge_orphans(100)),
          array['gym-page-media:cccccccc-cccc-cccc-cccc-000000000001.webp', 'gym-page-media-src:' || pg_temp.g('D') || '/dddddddd-dddd-dddd-dddd-000000000001'],
          'orphans: an object with no row and older than an hour is listed; a fresh one, one with a row and a tombstoned one are not');
-- a deleted gym's rows cascade away and its objects become orphans
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('gym-page-media', pg_temp.dk(60), null, now() - interval '3 hours'),
  ('gym-page-media-src', pg_temp.g('D') || '/' || pg_temp.ok_(60), null, now() - interval '3 hours');
select is((select count(*)::int from page_media_purge_orphans(100) where name in (pg_temp.dk(60), pg_temp.g('D') || '/' || pg_temp.ok_(60))), 0, 'control: while the gym exists its objects are not orphans');
delete from gyms where id = pg_temp.g('D')::uuid;
select is((select count(*)::int from page_media_purge_orphans(100) where name in (pg_temp.dk(60), pg_temp.g('D') || '/' || pg_temp.ok_(60))), 2, 'gym deletion: both of its objects are orphans after the rows cascade away');
select is((select count(*)::int from page_media_purge_orphans(1)), 1, 'the orphan page is bounded by the limit');
select is((select count(*)::int from page_media_purge_orphans(100000)) <= 200, true, 'and capped at 200 per call');
-- the run record, the tick and the schedule
select record_page_media_purge_run(now() - interval '2 seconds', true, 'claimed 3, deleted 3');
select record_page_media_purge_run(now() - interval '2 seconds', false, '1 failed');
select is((select array_agg(status::text order by status::text) from job_runs where job_name = 'page_media_purge'), array['failure', 'success'], 'one job_runs row per recorded run');
select is((select schedule from cron.job where jobname = 'page_media_purge'), '*/5 * * * *', 'the purge job runs every five minutes');
select is((select command from cron.job where jobname = 'page_media_purge'), ' select private.page_media_purge_tick(); ', 'and calls the tick');
select lives_ok($$select private.page_media_purge_tick()$$, 'the tick does nothing (and fails nothing) without its Vault secrets');
create temp table before_q as select count(*) n from net.http_request_queue;
select vault.create_secret('https://example.invalid/functions/v1/page-media-purge', 'page_media_purge_url');
select vault.create_secret('test-secret-value', 'page_media_purge_secret');
select private.page_media_purge_tick();
select is((select count(*)::int from net.http_request_queue) - (select n::int from before_q), 1, 'with both secrets the tick queues one pg_net call');
select is((select count(*)::int from net.http_request_queue q where q.url = 'https://example.invalid/functions/v1/page-media-purge' and q.headers ->> 'Authorization' = 'Bearer test-secret-value'), 1, 'to the function URL with the bearer secret');
-- grants
select is((select bool_and(has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'))
             from unnest(array['public.page_media_purge_candidates(integer)', 'public.page_media_purge_mark(uuid,boolean,boolean)', 'public.page_media_purge_orphans(integer)',
                               'public.record_page_media_purge_run(timestamptz,boolean,text)', 'public.page_media_rederive_list(uuid)', 'public.page_media_rederive_done(uuid,uuid[])']) f),
          true, 'the purge and re-derive functions are executable by service_role only');
select is(pg_temp.asauth($$select page_media_purge_candidates(1)$$), '42501:permission denied for function page_media_purge_candidates', 'authenticated cannot list the candidates');
select is(pg_temp.asauth($$select page_media_purge_mark(gen_random_uuid(), true, true)$$), '42501:permission denied for function page_media_purge_mark', 'authenticated cannot mark');
select is((select bool_and(not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
             from unnest(array['private.page_media_purge_tick()', 'private.gym_page_taken_down(uuid)', 'private.notify_page_moderation(uuid,text,text,text,text,text)', 'private.page_text_trim(text)', 'private.page_takedown_label(text,text)']) f),
          true, 'the private helpers are executable by no client role');
select is((select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'))
             from unnest(array['public.take_down_gym_page(uuid,text,text)', 'public.lift_gym_page_takedown(uuid,text)', 'public.list_page_reports()', 'public.close_page_report(uuid,text,text)',
                               'public.submit_page_appeal(text)', 'public.list_page_appeals()', 'public.decide_page_appeal(uuid,text,text)']) f),
          true, 'the Super Admin and Owner functions are executable by authenticated only (the function bodies decide who)');
-- tables: no grant, no policy, RLS on
select is((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('private.page_takedowns'::regclass, 'private.page_reports'::regclass, 'private.page_appeals'::regclass)), true, 'the three tables have row level security');
select is((select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role', 'public_site_reader']) g, unnest(array['private.page_takedowns', 'private.page_reports', 'private.page_appeals']) t,
            unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege(g, t, p)), 0, 'and no client role holds a privilege on them');
select is((select count(*)::int from pg_policies where schemaname = 'private' and tablename in ('page_takedowns', 'page_reports', 'page_appeals')), 0, 'and they have no policy');
select is((select count(*)::int from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'public_site'::regnamespace) and prokind = 'f'
            and prosrc ~* '(insert\s+into|update|delete\s+from)\s+(private\.)?page_reports\M'), 2, 'exactly two functions write page_reports: the reader''s submit and the closer');
select is((select array_agg(proname::text order by proname) from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'public_site'::regnamespace) and prokind = 'f'
            and prosrc ~* '(insert\s+into|update|delete\s+from)\s+(private\.)?page_reports\M'), array['close_page_report', 'submit_page_report'], 'namely submit_page_report and close_page_report');
select is((select array_agg(proname::text order by proname) from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f'
            and prosrc ~* '(insert\s+into|update|delete\s+from)\s+(private\.)?page_takedowns\M'), array['lift_gym_page_takedown', 'take_down_gym_page'], 'only the takedown and lift functions write page_takedowns');
select is((select array_agg(proname::text order by proname) from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f'
            and prosrc ~* '(insert\s+into|update|delete\s+from)\s+(private\.)?page_appeals\M'), array['decide_page_appeal', 'lift_gym_page_takedown', 'submit_page_appeal'], 'only the appeal functions and the lift write page_appeals');
select is((select array_agg(proname::text order by proname) from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f'
            and prosrc ~* 'update\s+(public\.)?gym_page_media\M'), array['delete_page_media', 'page_media_purge_mark', 'page_media_rederive_done', 'register_page_media'],
          'the functions that update gym_page_media are exactly the known four (24.11 added the purge mark and the re-derive call)');
-- ---- H. Owner notices for names (EXPERIENCE.md AD-28) and the rename after a lift ---------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val_claim('N', 'tkd-n1'), 'active', 'N: a Super Admin gives the gym its first name');
select is(pg_temp.notices('N', 'page_name_replaced'), 0, 'a first name replaces nothing: no notice');
select is(pg_temp.val_claim('N', 'tkd-n2'), 'active', 'N: a Super Admin replaces the name');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('N')::uuid and notice_type = 'page_name_replaced' and user_id = pg_temp.u('ownerN')::uuid
            and body_en = 'GymOS changed your page name to tkd-n2. Your old address no longer works.'
            and body_fr = 'GymOS a changé le nom de votre page en tkd-n2. Votre ancienne adresse ne fonctionne plus.'
            and title_en = 'GymOS changed your page name'), 1, 'the Owner is told the new name, EN and FR');
select is((select count(*)::int from email_outbox o join staff_notices n on n.id = o.notice_id where n.gym_id = pg_temp.g('N')::uuid and n.notice_type = 'page_name_replaced' and o.recipient_email = 'ownerN-2411@x.example'), 1, 'and an e-mail is queued');
select pg_temp.claims(pg_temp.u('ownerN'), 'owner', pg_temp.g('N'));
select is(pg_temp.asauth($$select claim_page_name('$$ || pg_temp.g('N') || $$', 'tkd-n3')->>'state'$$), 'active', 'N: the Owner renames the name themselves');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.notices('N', 'page_name_replaced'), 1, 'an Owner''s own rename sends no replacement notice');
-- the sweep releases an idle active name after 12 months: the Owner is told once (the page was not live, so notify_page_unpublished said nothing)
update page_names set reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('N')::uuid and name = 'tkd-n3';
select private.page_names_sweep();
select is((select state from page_names where gym_id = pg_temp.g('N')::uuid and name = 'tkd-n3'), 'released', 'sweep: the idle name is released');
select is((select count(*)::int from staff_notices where gym_id = pg_temp.g('N')::uuid and notice_type = 'page_name_released' and user_id = pg_temp.u('ownerN')::uuid
            and body_en = 'Your page name tkd-n3 was released because your page has been offline for 12 months. Claim a name to publish again.'
            and body_fr = 'Le nom de votre page tkd-n3 a été libéré car votre page est hors ligne depuis 12 mois. Choisissez un nom pour publier à nouveau.'), 1, 'the Owner is told, EN and FR');
select private.page_names_sweep();
select is(pg_temp.notices('N', 'page_name_released'), 1, 'and only once');
-- a live page of an inactive gym: notify_page_unpublished tells the Owner; the name notice is NOT added on top
update page_names set reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('S')::uuid and name = 'tkd-s';
select private.page_names_sweep();
select is((select state from page_names where gym_id = pg_temp.g('S')::uuid and name = 'tkd-s'), 'released', 'sweep: the name of the suspended gym''s live page is released');
select is(pg_temp.notices('S', 'page_unpublished'), 1, 'its Owner got the existing offline notice');
select is(pg_temp.notices('S', 'page_name_released'), 0, 'and no second notice for the name');
-- an INACTIVE gym whose page is not live: the AD-28 sentence for an inactive gym, exact EN and FR (the attempt is rolled back whatever it does)
select is(pg_temp.val_claim('X', 'tkd-x'), 'active', 'X: a gym with an idle active name');
update gyms set status = 'suspended' where id = pg_temp.g('X')::uuid;
create or replace function pg_temp.release_notice() returns text language plpgsql as $f$
declare v text;
begin
  begin
    update page_names set reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('X')::uuid and name = 'tkd-x';
    perform private.page_names_sweep();
    v := (select body_en || '||' || body_fr from staff_notices where gym_id = pg_temp.g('X')::uuid and notice_type = 'page_name_released' order by created_at desc limit 1);
    raise exception 'NOTICE:%', coalesce(v, 'none');
  exception when others then
    v := sqlerrm;
  end;
  return v;
end $f$;
select is(pg_temp.release_notice(),
  'NOTICE:Your page name tkd-x was released because your gym has been inactive for 12 months. Claim a name to publish again.||Le nom de votre page tkd-x a été libéré car votre salle est inactive depuis 12 mois. Choisissez un nom pour publier à nouveau.',
  'sweep: an inactive gym''s Owner gets the AD-28 "inactive for 12 months" sentence, exact EN and FR');
select pg_temp.mutate('private.page_names_sweep()'::regprocedure, 'r\.gym_status <> ''active''', 'false');
select isnt(pg_temp.release_notice(),
  'NOTICE:Your page name tkd-x was released because your gym has been inactive for 12 months. Claim a name to publish again.||Le nom de votre page tkd-x a été libéré car votre salle est inactive depuis 12 mois. Choisissez un nom pour publier à nouveau.',
  'KNOWN-BAD: with both CASE branches collapsed to the same text the inactive-gym sentence is lost');
select pg_temp.restore('private.page_names_sweep()'::regprocedure);
select is(pg_temp.release_notice() like 'NOTICE:Your page name tkd-x was released because your gym has been inactive%', true, 'control: sweep restored');
-- a taken-down name is never released, so no notice
select is(pg_temp.notices('T', 'page_name_released'), 0, 'a taken-down name is not released and nobody is told it was');
-- after a lift the Owner can rename as usual
select pg_temp.claims(pg_temp.u('ownerU'), 'owner', pg_temp.g('U'));
select is(pg_temp.asauth($$select claim_page_name('$$ || pg_temp.g('U') || $$', 'tkd-u2')->>'state'$$), 'active', 'rename: after the lift the Owner renames as usual');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');

-- no new support admission
select is((select count(*)::int from private.support_capabilities where object_name ~ '(take_down|lift_gym|page_report|page_appeal|page_media_purge|rederive)'), 0, 'GymOS support is admitted to none of the takedown, report, appeal or purge functions');
select * from finish();
rollback;
