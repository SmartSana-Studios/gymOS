-- Story 24.7: page names (migration 0163), denials. Every denial is paired with a positive control so it cannot pass for the wrong reason.
-- Positive paths: page_names.test.sql. Fixture ids: 00000000-0000-0000-0000-0000002417xx.
begin;
select plan(50);

create or replace function pg_temp.claims(uid text, app_role text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.val(stmt text) returns text language plpgsql as $f$
declare v text; begin execute stmt into v; return coalesce(v, 'null'); exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.g(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002417' || case c when 'A' then '11' when 'B' then '12' when 'F' then '14' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002417' || case c when 'ownerA' then '31' when 'supA' then '32' when 'mgrA' then '33' when 'coachA' then '34'
    when 'memberA' then '35' when 'ownerB' then '36' when 'ownerF' then '38' when 'admin' then '39' when 'support' then '41' end $f$;
create or replace function pg_temp.cl(gym text, name text) returns text language sql as $f$
  select format($q$select claim_page_name(%L, %L)->>'state'$q$, pg_temp.g(gym), name) $f$;
create or replace function pg_temp.as_user(uid text, role_ text, gym text) returns void language sql as $f$ select pg_temp.claims(uid, role_, gym) $f$;
create or replace function pg_temp.pid(gym text, st text) returns text language sql security definer as $f$
  select id::text from public.page_names where gym_id = pg_temp.g(gym)::uuid and state = st $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000241701', 'Names Denial Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('A')::uuid, 'Names Denial Gym A', '00000000-0000-0000-0000-000000241701'),
  (pg_temp.g('B')::uuid, 'Names Denial Gym B', '00000000-0000-0000-0000-000000241701');
insert into gyms (id, name, tier_id, status) values
  (pg_temp.g('F')::uuid, 'Names Denial Gym F Suspended', '00000000-0000-0000-0000-000000241701', 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerA')::uuid, 'ownerA-2417@x.example', now()),
  (pg_temp.u('supA')::uuid, 'supA-2417@x.example', now()),
  (pg_temp.u('mgrA')::uuid, 'mgrA-2417@x.example', now()),
  (pg_temp.u('coachA')::uuid, 'coachA-2417@x.example', now()),
  (pg_temp.u('memberA')::uuid, 'memberA-2417@x.example', now()),
  (pg_temp.u('ownerB')::uuid, 'ownerB-2417@x.example', now()),
  (pg_temp.u('ownerF')::uuid, 'ownerF-2417@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2417@x.example', now()),
  (pg_temp.u('support')::uuid, 'sup-2417@gymosapps.com', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000241751', pg_temp.g('A')::uuid, pg_temp.u('ownerA')::uuid, 'owner',      'PD Owner A',      '+237600241701', current_date),
  ('00000000-0000-0000-0000-000000241752', pg_temp.g('A')::uuid, pg_temp.u('supA')::uuid,   'supervisor', 'PD Supervisor A', '+237600241702', current_date),
  ('00000000-0000-0000-0000-000000241753', pg_temp.g('A')::uuid, pg_temp.u('mgrA')::uuid,   'manager',    'PD Manager A',    '+237600241703', current_date),
  ('00000000-0000-0000-0000-000000241754', pg_temp.g('A')::uuid, pg_temp.u('coachA')::uuid, 'coach',      'PD Coach A',      '+237600241704', current_date),
  ('00000000-0000-0000-0000-000000241755', pg_temp.g('A')::uuid, pg_temp.u('memberA')::uuid,'member',     'PD Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000241756', pg_temp.g('B')::uuid, pg_temp.u('ownerB')::uuid, 'owner',      'PD Owner B',      '+237600241706', current_date),
  ('00000000-0000-0000-0000-000000241758', pg_temp.g('F')::uuid, pg_temp.u('ownerF')::uuid, 'owner',      'PD Owner F',      '+237600241708', current_date);
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u('support')::uuid, now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000241761', pg_temp.u('support')::uuid, pg_temp.g('A')::uuid, 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000248a1', pg_temp.u('support')::uuid, now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000248a1', pg_temp.u('support')::uuid, now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000241761', true);
-- one held row to decide, set up directly
insert into page_names (gym_id, name, state, origin, held_reason, held_at) values
  (pg_temp.g('B')::uuid, 'gym-held', 'held', 'claim', 'generic_word:gym', now());

-- ---- claim: every role but the gym's Owner and a live Super Admin is refused ---------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'a Supervisor cannot claim');
select pg_temp.as_user(pg_temp.u('mgrA'), 'manager', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'a Manager cannot claim');
select pg_temp.as_user(pg_temp.u('coachA'), 'coach', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'a coach cannot claim');
select pg_temp.as_user(pg_temp.u('memberA'), 'member', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'a member cannot claim');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'another gym''s Owner cannot claim for gym A');
select pg_temp.claims(pg_temp.u('ownerB'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'nor with a forged gym claim for gym A in the token');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000248a1');
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'P0001:permission denied', 'a live-assigned support caller cannot claim');
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'denied-box')), 'active', 'control: the gym''s own Owner can claim the same name');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('A')::uuid), 1, 'only the control stored a row for gym A');
delete from page_names where gym_id = pg_temp.g('A')::uuid;

set local role anon;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(substr(pg_temp.val(pg_temp.cl('A', 'denied-box')), 1, 5), '42501', 'anon cannot execute claim_page_name');
select is(substr(pg_temp.val($$select count(*) from list_held_page_names()$$), 1, 5), '42501', 'anon cannot execute list_held_page_names');
reset role;

set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerF'), 'owner', pg_temp.g('F'));
select alike(pg_temp.val(pg_temp.cl('F', 'sleep-box')), '%is not active', 'an Owner of a suspended gym cannot claim');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.cl('F', 'sleep-box')), 'active', 'control: a Super Admin can claim for the same suspended gym');
reset role;

-- ---- decision, queue, words: live Super Admin only -------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select count(*) from list_held_page_names()$$), 'P0001:permission denied', 'an Owner cannot read the review queue');
select is(pg_temp.val(format($q$select decide_held_page_name(%L, true, 'owner approving')->>'state'$q$, pg_temp.pid('B', 'held'))), 'P0001:permission denied', 'an Owner cannot decide');
select is(pg_temp.val($$select add_page_name_word('generic', 'owner-adds')$$), 'P0001:permission denied', 'an Owner cannot add a word');
select is(pg_temp.val($$select remove_page_name_word('generic', 'gym')$$), 'P0001:permission denied', 'an Owner cannot remove a word');
select is(pg_temp.val($$select count(*) from list_page_name_words()$$), 'P0001:permission denied', 'an Owner cannot list the words');
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val(format($q$select decide_held_page_name(%L, true, 'supervisor approving')->>'state'$q$, pg_temp.pid('B', 'held'))), 'P0001:permission denied', 'a Supervisor cannot decide');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000248a1');
select is(pg_temp.val(format($q$select decide_held_page_name(%L, true, 'support approving')->>'state'$q$, pg_temp.pid('B', 'held'))), 'P0001:permission denied', 'a live-assigned support caller cannot decide');
select is(pg_temp.val($$select count(*) from list_held_page_names()$$), 'P0001:permission denied', 'nor read the review queue');
select is(pg_temp.val($$select add_page_name_word('generic', 'support-adds')$$), 'P0001:permission denied', 'nor change a word');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val($$select count(*) from list_held_page_names()$$), '1', 'control: a Super Admin reads the queue (one held row)');
select is(pg_temp.val($$select count(*) from list_page_name_words()$$) ~ '^[0-9]+$', true, 'control: a Super Admin lists the words');
select pg_temp.claims(pg_temp.u('ownerA'), 'super_admin');
select is(pg_temp.val($$select count(*) from list_held_page_names()$$), 'P0001:permission denied', 'a token that only claims super_admin is not enough (the live check reads users.is_super_admin)');
reset role;
select is((select state from page_names where gym_id = pg_temp.g('B')::uuid and name = 'gym-held'), 'held', 'no denied decision changed the held row');
select is((select count(*)::int from page_name_words where word in ('owner-adds', 'support-adds')), 0, 'no denied word change was stored');
select is((select count(*)::int from page_name_words where kind = 'generic' and word = 'gym'), 1, 'and the removed word is still there');

-- ---- get_gym_page_name: Owner, Supervisor, live support, Super Admin ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('mgrA'), 'manager', pg_temp.g('A'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'state'$$), 'P0001:permission denied', 'a Manager cannot read the name state');
select pg_temp.as_user(pg_temp.u('coachA'), 'coach', pg_temp.g('A'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'state'$$), 'P0001:permission denied', 'a coach cannot');
select pg_temp.as_user(pg_temp.u('memberA'), 'member', pg_temp.g('A'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'state'$$), 'P0001:permission denied', 'a member cannot');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'state'$$), 'P0001:permission denied', 'another gym''s Owner cannot');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('B') || $$')->>'state'$$), 'held', 'control: that Owner reads their own gym (a held first claim)');
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'state'$$), 'none', 'control: a Supervisor reads their gym (no name yet)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(substr(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')$$), 1, 5), 'P0001', 'with no claims at all (no session) it is refused too');

-- ---- direct access: no client role reaches either table or a private function ----------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(substr(pg_temp.val($$select count(*) from page_names$$), 1, 5), '42501', 'an Owner cannot select page_names');
select is(substr(pg_temp.val($$select count(*) from page_name_words$$), 1, 5), '42501', 'nor page_name_words');
select is(substr(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('A') || $$', 'direct-box', 'active', 'claim')$$), 1, 5), '42501', 'an Owner cannot insert a page name directly');
select is(substr(pg_temp.err($$update page_names set state = 'active'$$), 1, 5), '42501', 'nor update');
select is(substr(pg_temp.err($$delete from page_names$$), 1, 5), '42501', 'nor delete');
select is(substr(pg_temp.err($$insert into page_name_words (kind, word) values ('generic', 'direct-word')$$), 1, 5), '42501', 'nor write a word');
select is(substr(pg_temp.val($$select private.set_page_name_idle('$$ || pg_temp.g('A') || $$', true)$$), 1, 5), '42501', 'nor call the idle setter');
select is(substr(pg_temp.val($$select private.page_name_promote('$$ || pg_temp.g('A') || $$', 'direct-box', 'claim', null, false)$$), 1, 5), '42501', 'nor the promote helper');
select is(substr(pg_temp.val($$select private.page_names_sweep()$$), 1, 5), '42501', 'nor the sweep');
reset role;
set local role anon;
select is(substr(pg_temp.val($$select count(*) from page_names$$), 1, 5), '42501', 'anon cannot select page_names');
reset role;
set local role service_role;
select is(substr(pg_temp.val($$select count(*) from page_names$$), 1, 5), '42501', 'service_role cannot select page_names');
select is(substr(pg_temp.val($$select count(*) from page_name_words$$), 1, 5), '42501', 'nor page_name_words');
reset role;
select is((select count(*)::int from page_names where name = 'direct-box'), 0, 'no direct write was stored');

-- ---- an unpublished-then-suspended name is not freed by a client ---------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$update gyms set status = 'suspended' where id = '$$ || pg_temp.g('A') || $$'$$), 'ok', 'an Owner''s bare status update runs (and is reverted by the existing pin)');
reset role;
select is((select status::text from gyms where id = pg_temp.g('A')::uuid), 'active', 'the pin reverted it: no status change, so the idle trigger did not fire');

select * from finish();
rollback;
