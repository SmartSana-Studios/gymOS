-- Story 24.8: publish gate, snapshot and unpublish (migration 0164), denials and known-bad mutations. Every denial is paired with a
-- positive control so it cannot pass for the wrong reason. Positive paths: gym_page_publish.test.sql.
-- Fixture ids: 00000000-0000-0000-0000-0000002418xx. The refresh triggers are deferred; pg_temp.settle() stands for COMMIT.
begin;
select plan(86);

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
  select '00000000-0000-0000-0000-0000002418' || case c when 'A' then '11' when 'B' then '12' when 'M' then '13' when 'U' then '14' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002418' || case c when 'ownerA' then '31' when 'supA' then '32' when 'mgrA' then '33' when 'coachA' then '34'
    when 'memberA' then '35' when 'ownerB' then '36' when 'admin' then '39' when 'support' then '41' end $f$;
create or replace function pg_temp.dk(n int) returns text language sql immutable as $f$ select 'cccccccc-cccc-cccc-cccc-' || lpad(n::text, 12, '0') || '.webp' $f$;
create or replace function pg_temp.pub(gym text, tpl text default null) returns text language sql as $f$ select format($q$select publish_gym_page(%L, %L)::text$q$, pg_temp.g(gym), tpl) $f$;
create or replace function pg_temp.unpub(gym text) returns text language sql as $f$ select format($q$select unpublish_gym_page(%L)::text$q$, pg_temp.g(gym)) $f$;
create or replace function pg_temp.settle() returns void language plpgsql as $f$ begin set constraints all immediate; set constraints all deferred; end $f$;
create or replace function pg_temp.page(gym text, col text) returns text language plpgsql security definer as $f$
declare v text; begin execute format('select %s::text from public.gym_pages where gym_id = %L', col, pg_temp.g(gym)) into v; return coalesce(v, 'null'); end $f$;
create or replace function pg_temp.visible(gym text) returns int language sql security definer as $f$
  select count(*)::int from private.gym_page_visible v where v.page_name_id in (select id from public.page_names where gym_id = pg_temp.g(gym)::uuid) $f$;
create or replace function pg_temp.missing(gym text) returns text language sql security definer as $f$ select array_to_string(private.gym_page_gate_missing(pg_temp.g(gym)::uuid), ',') $f$;
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
-- the starter city of a slug in Cameroon (migration 0169 seeds them)
create or replace function pg_temp.city(slug text) returns uuid language sql stable as $f$
  select id from cities where country_code = 'CM' and cities.slug = city.slug $f$;
create or replace function pg_temp.complete(gym text, nm text, plan_id text, n int) returns text language plpgsql as $f$
begin
  perform set_gym_page_content(pg_temp.g(gym)::uuid,
    jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'contact_phone', '+237600555000',
                       'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'is_public', true)));
  perform set_gym_location(pg_temp.g(gym)::uuid, 'CM', pg_temp.city('douala'));
  perform claim_page_name(pg_temp.g(gym)::uuid, nm);
  perform register_page_media(pg_temp.g(gym)::uuid, 'logo', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'), pg_temp.dk(n), true, 'v1');
  perform register_page_media(pg_temp.g(gym)::uuid, 'banner', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad((n + 1)::text, 12, '0'), pg_temp.dk(n + 1), true, 'v1');
  return publish_gym_page(pg_temp.g(gym)::uuid, 'classic')::text;
end $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000241801', 'Publish Denial Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('A')::uuid, 'Denial Gym A', '00000000-0000-0000-0000-000000241801'),
  (pg_temp.g('B')::uuid, 'Denial Gym B', '00000000-0000-0000-0000-000000241801'),
  (pg_temp.g('M')::uuid, 'Denial Gym M', '00000000-0000-0000-0000-000000241801'),
  (pg_temp.g('U')::uuid, 'Denial Gym U', '00000000-0000-0000-0000-000000241801');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerA')::uuid, 'ownerA-2418@x.example', now()),
  (pg_temp.u('supA')::uuid, 'supA-2418@x.example', now()),
  (pg_temp.u('mgrA')::uuid, 'mgrA-2418@x.example', now()),
  (pg_temp.u('coachA')::uuid, 'coachA-2418@x.example', now()),
  (pg_temp.u('memberA')::uuid, 'memberA-2418@x.example', now()),
  (pg_temp.u('ownerB')::uuid, 'ownerB-2418@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2418@x.example', now()),
  (pg_temp.u('support')::uuid, 'sup-2418@gymosapps.com', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000241851', pg_temp.g('A')::uuid, pg_temp.u('ownerA')::uuid, 'owner',      'PD Owner A',      '+237600241801', current_date),
  ('00000000-0000-0000-0000-000000241852', pg_temp.g('A')::uuid, pg_temp.u('supA')::uuid,   'supervisor', 'PD Supervisor A', '+237600241802', current_date),
  ('00000000-0000-0000-0000-000000241853', pg_temp.g('A')::uuid, pg_temp.u('mgrA')::uuid,   'manager',    'PD Manager A',    '+237600241803', current_date),
  ('00000000-0000-0000-0000-000000241854', pg_temp.g('A')::uuid, pg_temp.u('coachA')::uuid, 'coach',      'PD Coach A',      '+237600241804', current_date),
  ('00000000-0000-0000-0000-000000241855', pg_temp.g('A')::uuid, pg_temp.u('memberA')::uuid,'member',     'PD Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000241856', pg_temp.g('B')::uuid, pg_temp.u('ownerB')::uuid, 'owner',      'PD Owner B',      '+237600241806', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000241871', pg_temp.g('A')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000241872', pg_temp.g('B')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000241873', pg_temp.g('M')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30);
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u('support')::uuid, now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000241881', pg_temp.u('support')::uuid, pg_temp.g('A')::uuid, 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000249a1', pg_temp.u('support')::uuid, now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000249a1', pg_temp.u('support')::uuid, now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000241881', true);

-- gym A is ready to publish (a Super Admin completes it; nothing is published yet)
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select 1 where pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'contact_phone', '+237600555000',
  'hours', '{"mon":{"open":"06:00","close":"22:00"}}'::jsonb), '[{"plan_id":"00000000-0000-0000-0000-000000241871","is_public":true}]'::jsonb)$$) is null;
select 1 where pg_temp.err($$select set_gym_location('$$ || pg_temp.g('A') || $$', 'CM', '$$ || pg_temp.city('douala') || $$')$$) is null;
select 1 where pg_temp.err($$select claim_page_name('$$ || pg_temp.g('A') || $$', 'denial-a')$$) is null;
select 1 where pg_temp.err($$select register_page_media('$$ || pg_temp.g('A') || $$', 'logo', '$$ || pg_temp.g('A') || $$/aaaaaaaa-aaaa-aaaa-aaaa-000000000001', '$$ || pg_temp.dk(1) || $$', true, 'v1')$$) is null;
select 1 where pg_temp.err($$select register_page_media('$$ || pg_temp.g('A') || $$', 'banner', '$$ || pg_temp.g('A') || $$/aaaaaaaa-aaaa-aaaa-aaaa-000000000002', '$$ || pg_temp.dk(2) || $$', true, 'v1')$$) is null;
reset role;
select is(pg_temp.missing('A'), '', 'control: gym A meets the gate');

-- ---- publish: every role but Owner, Supervisor, live support and Super Admin is refused ------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('mgrA'), 'manager', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'a Manager cannot publish');
select pg_temp.as_user(pg_temp.u('coachA'), 'coach', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'a coach cannot publish');
select pg_temp.as_user(pg_temp.u('memberA'), 'member', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'a member cannot publish');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'another gym''s Owner cannot publish for gym A');
select pg_temp.claims(pg_temp.u('ownerB'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'nor with a forged gym claim for gym A in the token');
select pg_temp.claims(pg_temp.u('ownerA'), 'super_admin');
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'a token that only claims super_admin is not enough (the live check reads users.is_super_admin)');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('B'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.pub('B', 'classic')), 'P0001:permission denied', 'live support assigned to gym A cannot publish for gym B');
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'nor for gym A with the gym B claim');
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select publish_gym_page(null, 'classic')::text$$), 'P0001:permission denied', 'a null gym id is refused');
select is(pg_temp.val(pg_temp.pub('B', 'classic')), 'P0001:permission denied', 'an Owner naming another gym is refused');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'with no claims at all it is refused too');
reset role;
select is(pg_temp.page('A', 'template'), 'null', 'no denied call wrote a page row');
select is((select count(*)::int from audit_log where action_type like 'gym_page_%' and action_type <> 'gym_page_content_changed' and action_type <> 'gym_page_media_registered'), 0, 'and no audit row');
set local role anon;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(substr(pg_temp.val(pg_temp.pub('A', 'classic')), 1, 5), '42501', 'anon cannot execute publish_gym_page');
select is(substr(pg_temp.val(pg_temp.unpub('A')), 1, 5), '42501', 'anon cannot execute unpublish_gym_page');
reset role;
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": [], "published": true}', 'control: the gym''s own Owner publishes the same call');
reset role;

-- ---- unpublish: the same roles ---------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('mgrA'), 'manager', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'a Manager cannot unpublish');
select pg_temp.as_user(pg_temp.u('coachA'), 'coach', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'a coach cannot unpublish');
select pg_temp.as_user(pg_temp.u('memberA'), 'member', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'a member cannot unpublish');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'another gym''s Owner cannot unpublish gym A''s page');
select pg_temp.claims(pg_temp.u('ownerA'), 'super_admin');
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'a token that only claims super_admin cannot unpublish');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'no claims: refused');
select is(pg_temp.val($$select unpublish_gym_page(null)::text$$), 'P0001:permission denied', 'a null gym id is refused');
reset role;
select is(pg_temp.visible('A'), 1, 'no denied unpublish changed the page');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val($$select unpublish_gym_page('00000000-0000-0000-0000-000000999999')::text$$), 'P0001:unpublish_gym_page: gym not found', 'a Super Admin naming an unknown gym gets gym not found');
select is(pg_temp.val($$select publish_gym_page('00000000-0000-0000-0000-000000999999', 'classic')::text$$), 'P0001:publish_gym_page: gym not found', 'on publish too');
reset role;

-- ---- support: refused on the very next call once the gate no longer holds ----------------------------------------------------------------
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.unpub('A')), 'true', 'control: live-assigned support unpublishes');
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": [], "published": true}', 'and publishes');
reset role;
update private.support_session_state set last_seen_at = now() - interval '2 hours';
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'an idle support session is refused');
reset role;
update private.support_session_state set last_seen_at = now();
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000241881';
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'a suspended assignment is refused');
reset role;
update public.support_assignments set state = 'active' where id = '00000000-0000-0000-0000-000000241881';
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.unpub('A')), 'true', 'control: with the assignment active again the same call succeeds');
reset role;
select is(pg_temp.page('A', 'unpublished_reason'), 'owner', 'and unpublishes the page');
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.pub('A', 'classic')), '{"missing": [], "published": true}', 'control: support republishes (the page is live for the next step)');
reset role;
-- what deactivate_support_account() does to the live gate (that function needs the aal2 platform flag; support_assignments.test.sql covers it)
select private.support_set_membership('00000000-0000-0000-0000-000000241881', false);
update public.support_assignments set state = 'ended', ended_at = now() where id = '00000000-0000-0000-0000-000000241881';
update private.support_accounts set deactivated_at = now() where user_id = pg_temp.u('support')::uuid;
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000249a1');
select is(pg_temp.val(pg_temp.unpub('A')), 'P0001:permission denied', 'deactivated support is refused on the very next unpublish');
select is(pg_temp.val(pg_temp.pub('A', 'classic')), 'P0001:permission denied', 'and on the very next publish');
reset role;
select is(pg_temp.visible('A'), 1, 'the refused calls changed nothing: the page is still published');
select is(pg_temp.page('A', 'unpublished_at'), 'null', 'and not unpublished');

-- ---- direct access: no client role reaches the table, the view or a private function -----------------------------------------------------
select pg_temp.settle();
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(substr(pg_temp.val($$select count(*) from gym_pages$$), 1, 5), '42501', 'an Owner cannot select gym_pages');
select is(substr(pg_temp.err($$update gym_pages set unpublished_at = null$$), 1, 5), '42501', 'nor republish by update');
select is(substr(pg_temp.err($$insert into gym_pages (gym_id, template, published_at) values ('$$ || pg_temp.g('B') || $$', 'x', now())$$), 1, 5), '42501', 'nor insert a page');
select is(substr(pg_temp.err($$delete from gym_pages$$), 1, 5), '42501', 'nor delete one');
select is(substr(pg_temp.val($$select count(*) from private.gym_page_visible$$), 1, 5), '42501', 'nor read the visibility view');
select is(substr(pg_temp.val($$select private.refresh_gym_page('$$ || pg_temp.g('A') || $$')$$), 1, 5), '42501', 'nor call refresh_gym_page');
select is(substr(pg_temp.val($$select private.gym_page_gate_missing('$$ || pg_temp.g('A') || $$')$$), 1, 5), '42501', 'nor the gate');
select is(substr(pg_temp.val($$select private.gym_page_snapshot('$$ || pg_temp.g('A') || $$')$$), 1, 5), '42501', 'nor the snapshot builder');
select is(substr(pg_temp.val($$select private.notify_page_unpublished('$$ || pg_temp.g('A') || $$', 'owner')$$), 1, 5), '42501', 'nor the notice sender');
reset role;
set local role service_role;
select is(substr(pg_temp.val($$select count(*) from gym_pages$$), 1, 5), '42501', 'service_role cannot select gym_pages');
select is(substr(pg_temp.err($$update gym_pages set unpublished_at = null$$), 1, 5), '42501', 'nor update it');
reset role;
set local role anon;
select is(substr(pg_temp.val($$select count(*) from private.gym_page_visible$$), 1, 5), '42501', 'anon cannot read the visibility view');
reset role;
select is(pg_temp.page('A', 'unpublished_reason'), 'null', 'no direct write landed (the page is as it was)');

-- ---- the table's own walls (the writers cannot produce these; a future writer must not be able to either) -------------------------------------
insert into page_names (id, gym_id, name, state, origin, reserved_until) values ('00000000-0000-0000-0000-0000002418c1', pg_temp.g('A')::uuid, 'denial-a-old', 'released', 'claim', now());
select is(substr(pg_temp.err($$insert into gym_pages (gym_id, template, page_name_id) values ('$$ || pg_temp.g('B') || $$', 'x', '00000000-0000-0000-0000-0000002418c1')$$), 1, 5), '23503',
          'a page cannot reference another gym''s page name (composite foreign key)');
select is(pg_temp.err($$insert into gym_pages (gym_id, template, page_name_id) values ('$$ || pg_temp.g('B') || $$', 'x', null)$$), 'ok', 'control: a page with no name yet is accepted');
select is(substr(pg_temp.err($$update gym_pages set content = '{"gym_id": "x"}' where gym_id = '$$ || pg_temp.g('B') || $$'$$), 1, 5), '23514', 'CHECK: a key outside the allowed list');
select is(substr(pg_temp.err($$update gym_pages set content = '{"plans": {}}' where gym_id = '$$ || pg_temp.g('B') || $$'$$), 1, 5), '23514', 'CHECK: plans must be an array');
select is(substr(pg_temp.err($$update gym_pages set content = '{"gallery": "x"}' where gym_id = '$$ || pg_temp.g('B') || $$'$$), 1, 5), '23514', 'CHECK: gallery must be an array');
select is(substr(pg_temp.err($$update gym_pages set content = '{"hours": []}' where gym_id = '$$ || pg_temp.g('B') || $$'$$), 1, 5), '23514', 'CHECK: hours must be an object');
select is(substr(pg_temp.err($$update gym_pages set content = jsonb_build_object('about_en', repeat('x', 70000)) where gym_id = '$$ || pg_temp.g('B') || $$'$$), 1, 5), '23514', 'CHECK: 64 KiB cap');
select is(pg_temp.err($$update gym_pages set content = jsonb_build_object('about_en', repeat('x', 60000)) where gym_id = '$$ || pg_temp.g('B') || $$'$$), 'ok', 'control: content just under the cap is accepted');
select is(substr(pg_temp.err($$update gym_pages set unpublished_reason = 'Owner<script>' where gym_id = '$$ || pg_temp.g('B') || $$'$$), 1, 5), '23514', 'CHECK: unpublished_reason is a list of lowercase codes');
select is(pg_temp.err($$update gym_pages set unpublished_reason = 'no_logo,about_short' where gym_id = '$$ || pg_temp.g('B') || $$'$$), 'ok', 'control: a comma-joined code list is accepted');

-- ---- the pins still hold, and a reverted write refreshes nothing ---------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.pub('A')), '{"missing": [], "published": true}', 'control: the Owner publishes gym A again');
select is(pg_temp.err($$update gyms set page_city = 'Bare update', city_id = null, page_about_en = 'Short' where id = '$$ || pg_temp.g('A') || $$'$$), 'ok', 'an Owner''s bare update of page columns runs');
select is(pg_temp.err($$update plans set is_public = false where id = '00000000-0000-0000-0000-000000241871'$$), 'ok', 'and a bare update of is_public runs');
reset role;
select pg_temp.settle();
select is(pg_temp.visible('A'), 1, 'both were reverted by the 24.5 pins, so nothing changed and the page is still published');
select is((select content ->> 'city' from gym_pages where gym_id = pg_temp.g('A')::uuid), 'Douala', 'and the snapshot still says Douala (25.1: the bare city_id write was pinned too)');

-- ---- hostile text never reaches a snapshot -----------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select set_gym_page_content('$$ || pg_temp.g('A') || $$', '{"about_en": "<script>alert(1)</script>"}')$$), 'P0001:set_gym_page_content: invalid_about_en', 'angle brackets are refused by the setter');
reset role;
select is(pg_temp.visible('A'), 1, 'and the page is unaffected');

-- ---- the checks can fail: known-bad mutations, each undone by the rollback -----------------------------------------------------------------
-- 1. A gate rule removed: the failing case for it stops failing, so its assertion in gym_page_publish.test.sql would fail.
create temp table orig_defs as select pg_get_functiondef('private.gym_page_gate_missing(uuid)'::regprocedure) as gate, pg_get_functiondef('private.gym_page_snapshot(uuid)'::regprocedure) as snap;
delete from gym_page_media where gym_id = pg_temp.g('A')::uuid and kind = 'banner';
select ok('no_banner' = any(private.gym_page_gate_missing(pg_temp.g('A')::uuid)), 'control: with no banner the gate says no_banner');
do $m$
begin
  execute replace(pg_get_functiondef('private.gym_page_gate_missing(uuid)'::regprocedure), 'v_missing := array_append(v_missing, ''no_banner'');', 'null;');
end
$m$;
select ok(not ('no_banner' = any(private.gym_page_gate_missing(pg_temp.g('A')::uuid))), 'MUTATION gate rule removed: no_banner is no longer reported, so the failing-case assertion would fail');
do $m$ begin execute (select gate from pg_temp.orig_defs); end $m$;
select ok('no_banner' = any(private.gym_page_gate_missing(pg_temp.g('A')::uuid)), 'control: restoring the function restores the failing case');
-- 2. A gate code added with no failing case: the enumeration of codes no longer matches what the tests saw.
do $m$
begin
  execute replace(pg_get_functiondef('private.gym_page_gate_missing(uuid)'::regprocedure), 'return v_missing;', 'v_missing := array_append(v_missing, ''zz_new_code''); return v_missing;');
end
$m$;
select ok('zz_new_code' = any(array(select m[1] from pg_proc, regexp_matches(prosrc, 'array_append\(v_missing, ''([a-z_]+)''\)', 'g') m where proname = 'gym_page_gate_missing')),
          'MUTATION new gate code: the source scan sees zz_new_code, which no test witnessed, so the enumeration assertion would fail');
select is(private.gym_page_gate_phrase('zz_new_code', 'en'), null, 'and the notice-copy assertion would fail too (no phrase for the new code)');

do $m$ begin execute (select gate from pg_temp.orig_defs); end $m$;
-- 3. A predicate term removed: a gym whose name is no longer active becomes visible.
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val($$select pg_temp.complete('M', 'mutant-box', '00000000-0000-0000-0000-000000241873', 60)$$), '{"missing": [], "published": true}', 'gym M is published');
reset role;
select is(pg_temp.visible('M'), 1, 'control: M is visible');
update page_names set state = 'released' where gym_id = pg_temp.g('M')::uuid and state = 'active';
select is(pg_temp.visible('M'), 0, 'control: once its name is not active the predicate hides M');
do $m$
begin
  execute 'create or replace view private.gym_page_visible with (security_barrier = true) as '
    || replace(pg_get_viewdef('private.gym_page_visible'::regclass), 'pn.state = ''active''::text', 'true');
end
$m$;
select is(pg_temp.visible('M'), 1, 'MUTATION name-active term removed: the page becomes visible, so the visibility assertion would fail');
select is((select count(*)::int from public_site.pages where name = 'mutant-box'), 1, 'and the public view follows the predicate (it reads nothing else)');
update page_names set state = 'active' where gym_id = pg_temp.g('M')::uuid and state = 'released';
update gyms set status = 'suspended' where id = pg_temp.g('M')::uuid;
select is(pg_temp.visible('M'), 0, 'control: a suspended gym is hidden by the status term');
do $m$
begin
  execute 'create or replace view private.gym_page_visible with (security_barrier = true) as '
    || replace(pg_get_viewdef('private.gym_page_visible'::regclass), 'g.status = ''active''::gym_status', 'true');
end
$m$;
select is(pg_temp.visible('M'), 1, 'MUTATION gym-active term removed: a suspended gym''s page becomes visible, so the suspension assertion would fail');

-- 4. An extra key in the snapshot: the key-path pin no longer matches, and the content CHECK is a second wall.
update gyms set status = 'active' where id = pg_temp.g('M')::uuid;
select pg_temp.settle();
select is(pg_temp.key_paths(private.gym_page_snapshot(pg_temp.g('M')::uuid)),
          (select array_agg(x order by x) from unnest(array['about_en', 'category', 'city', 'contact', 'contact.phone', 'country', 'default_language', 'hours', 'hours.mon', 'hours.mon.close', 'hours.mon.open', 'hours.sun',
                                                              'banner', 'logo', 'name', 'plans', 'plans[]', 'plans[].currency', 'plans[].duration_days', 'plans[].interval', 'plans[].label_en',
                                                              'plans[].label_fr', 'plans[].name', 'plans[].price', 'plans[].type']) x),
          'control: gym M''s snapshot has exactly the expected key paths');
do $m$
begin
  execute replace(pg_get_functiondef('private.gym_page_snapshot(uuid)'::regprocedure), '''name'', g.name,', '''name'', g.name, ''gym_id'', g.id,');
end
$m$;
select ok('gym_id' = any(pg_temp.key_paths(private.gym_page_snapshot(pg_temp.g('M')::uuid))), 'MUTATION extra key: the snapshot now carries gym_id, so the key-path pin would fail');
select ok(private.gym_page_snapshot(pg_temp.g('M')::uuid)::text like '%' || pg_temp.g('M') || '%', 'and the leak scan (gym id in the content) would fail');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(substr(pg_temp.val(pg_temp.pub('M', 'classic')), 1, 5), '23514', 'the content CHECK refuses the leaking snapshot at publish: a second wall');
reset role;

-- 5. A new writer of gym_pages is found by the enumeration.
create function private.zz_rogue_writer() returns void language sql as $f$ update public.gym_pages set template = 'x' $f$;
select isnt((select array_agg(proname::text order by proname) from pg_proc
              where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f'
                and prosrc ~* '(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(public\.)?gym_pages\M'),
            array['page_names_sweep', 'publish_gym_page', 'refresh_gym_page', 'unpublish_gym_page']::text[],
            'MUTATION new writer: a function updating gym_pages is outside the allowlist, so the writer enumeration would fail');
-- 6. A widened admission is found by the pinned role list.
select isnt((select (regexp_match(replace(prosrc, '''owner'', ''supervisor''', '''owner'', ''supervisor'', ''coach'''), 'support_rpc_role\(''publish_gym_page''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'publish_gym_page'),
            '''owner'', ''supervisor''', 'MUTATION widened roles: adding coach changes the pinned list, so the admission assertion would fail');

select * from finish();
rollback;
