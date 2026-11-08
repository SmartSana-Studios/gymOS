-- Story 24.7: page names (migration 0163), positive paths, lifecycle and structure. Denials: page_names.negative.test.sql.
-- Fixture ids: 00000000-0000-0000-0000-0000002407xx (gyms 11-21, users 31-41).
begin;
select plan(200);

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
-- the single text value of a select, or 'sqlstate:message'
create or replace function pg_temp.val(stmt text) returns text language plpgsql as $f$
declare v text; begin execute stmt into v; return coalesce(v, 'null'); exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.rows(stmt text) returns text language plpgsql as $f$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n::text; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
-- gym letter -> id; user label -> id
create or replace function pg_temp.g(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002407' || case c when 'A' then '11' when 'B' then '12' when 'E' then '13' when 'F' then '14' when 'G' then '15'
    when 'H' then '16' when 'I' then '17' when 'J' then '18' when 'K' then '19' when 'L' then '20' when 'M' then '21' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002407' || case c when 'ownerA' then '31' when 'supA' then '32' when 'mgrA' then '33' when 'coachA' then '34'
    when 'memberA' then '35' when 'ownerB' then '36' when 'ownerE' then '37' when 'ownerF' then '38' when 'admin' then '39' when 'admin2' then '40' when 'support' then '41' end $f$;
create or replace function pg_temp.as_user(uid text, role_ text, gym text) returns void language sql as $f$ select pg_temp.claims(uid, role_, gym) $f$;
-- claim statement: the resulting state, or the error
create or replace function pg_temp.cl(gym text, name text) returns text language sql as $f$
  select format($q$select claim_page_name(%L, %L)->>'state'$q$, pg_temp.g(gym), name) $f$;
-- id of the gym's row in a state (a definer helper: the caller may be an authenticated role with no table access)
create or replace function pg_temp.pid(gym text, st text) returns text language sql security definer as $f$
  select id::text from public.page_names where gym_id = pg_temp.g(gym)::uuid and state = st $f$;
create or replace function pg_temp.pidn(gym text, n text) returns text language sql security definer as $f$
  select id::text from public.page_names where gym_id = pg_temp.g(gym)::uuid and name = n $f$;
create or replace function pg_temp.dec(id text, approve text, reason text) returns text language sql as $f$
  select format($q$select decide_held_page_name(%L, %s, %L)->>'state'$q$, id, approve, reason) $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000240701', 'Names Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('A')::uuid, 'Names Gym A', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('B')::uuid, 'Names Gym B', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('E')::uuid, 'Names Gym E', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('G')::uuid, 'Names Gym G', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('H')::uuid, 'Names Gym H', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('I')::uuid, 'Names Gym I', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('J')::uuid, 'Names Gym J', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('K')::uuid, 'Names Gym K', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('L')::uuid, 'Names Gym L', '00000000-0000-0000-0000-000000240701'),
  (pg_temp.g('M')::uuid, 'Names Gym M', '00000000-0000-0000-0000-000000240701');
insert into gyms (id, name, tier_id, status) values
  (pg_temp.g('F')::uuid, 'Names Gym F Suspended', '00000000-0000-0000-0000-000000240701', 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerA')::uuid, 'ownerA-2407@x.example', now()),
  (pg_temp.u('supA')::uuid, 'supA-2407@x.example', now()),
  (pg_temp.u('mgrA')::uuid, 'mgrA-2407@x.example', now()),
  (pg_temp.u('coachA')::uuid, 'coachA-2407@x.example', now()),
  (pg_temp.u('memberA')::uuid, 'memberA-2407@x.example', now()),
  (pg_temp.u('ownerB')::uuid, 'ownerB-2407@x.example', now()),
  (pg_temp.u('ownerE')::uuid, 'ownerE-2407@x.example', now()),
  (pg_temp.u('ownerF')::uuid, 'ownerF-2407@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2407@x.example', now()),
  (pg_temp.u('admin2')::uuid, 'admin2-2407@x.example', now()),
  (pg_temp.u('support')::uuid, 'sup-2407@gymosapps.com', now());
update users set is_super_admin = true where id in (pg_temp.u('admin')::uuid, pg_temp.u('admin2')::uuid);
update users set display_name = 'Zelda Adminname' where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000240751', pg_temp.g('A')::uuid, pg_temp.u('ownerA')::uuid, 'owner',      'PN Owner A',      '+237600240701', current_date),
  ('00000000-0000-0000-0000-000000240752', pg_temp.g('A')::uuid, pg_temp.u('supA')::uuid,   'supervisor', 'PN Supervisor A', '+237600240702', current_date),
  ('00000000-0000-0000-0000-000000240753', pg_temp.g('A')::uuid, pg_temp.u('mgrA')::uuid,   'manager',    'PN Manager A',    '+237600240703', current_date),
  ('00000000-0000-0000-0000-000000240754', pg_temp.g('A')::uuid, pg_temp.u('coachA')::uuid, 'coach',      'PN Coach A',      '+237600240704', current_date),
  ('00000000-0000-0000-0000-000000240755', pg_temp.g('A')::uuid, pg_temp.u('memberA')::uuid,'member',     'PN Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000240756', pg_temp.g('B')::uuid, pg_temp.u('ownerB')::uuid, 'owner',      'PN Owner B',      '+237600240706', current_date),
  ('00000000-0000-0000-0000-000000240757', pg_temp.g('E')::uuid, pg_temp.u('ownerE')::uuid, 'owner',      'PN Owner E',      '+237600240707', current_date),
  ('00000000-0000-0000-0000-000000240758', pg_temp.g('F')::uuid, pg_temp.u('ownerF')::uuid, 'owner',      'PN Owner F',      '+237600240708', current_date);

-- support: live and assigned to gym A
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u('support')::uuid, now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240761', pg_temp.u('support')::uuid, pg_temp.g('A')::uuid, 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000247a1', pg_temp.u('support')::uuid, now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000247a1', pg_temp.u('support')::uuid, now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000240761', true);

-- ---- catalog ----------------------------------------------------------------------------------------------------
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'page_names'),
          array['id', 'gym_id', 'name', 'state', 'origin', 'held_reason', 'held_at', 'decided_at', 'decided_by', 'decision_reason', 'reminded_at', 'reserved_until', 'taken_down_at', 'created_at'],
          'page_names has exactly the specified columns');
select is((select count(*)::int from pg_class where oid in ('public.page_names'::regclass, 'public.page_name_words'::regclass) and relrowsecurity), 2, 'RLS is on for both tables');
select is((select count(*)::int from pg_policies where tablename in ('page_names', 'page_name_words')), 0, 'neither table has a policy');
select is((select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role', 'public_site_reader']) g, unnest(array['public.page_names', 'public.page_name_words']) t,
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
            where has_table_privilege(g, t, p)), 0,
          'no client role (and not the public-site reader) holds any privilege on either table');
select is((select count(*)::int from page_name_words where kind = 'zone'), 41, 'zone seeds: 40 labels and the gymos prefix');
select is((select count(*)::int from page_name_words where kind = 'reserved' and not is_prefix), 25, 'reserved seeds (addendum J)');
select is((select count(*)::int from page_name_words where kind = 'brand'), 17, 'brand seeds (addendum J)');
select is((select count(*)::int from page_name_words where kind = 'generic'), 11, 'generic seeds (addendum J)');
select is((select count(*)::int from page_name_words where kind = 'place'), 4, 'place seeds (addendum J)');
select is((select count(*)::int from page_name_words where is_prefix), 2, 'one reserved and one zone prefix (gymos)');
select is((select count(*)::int from cron.job where jobname = 'page_names_sweep'), 1, 'the daily sweep is scheduled');
select is((select count(*)::int from pg_proc where proname in ('claim_page_name', 'list_held_page_names', 'decide_held_page_name', 'get_gym_page_name', 'add_page_name_word', 'remove_page_name_word', 'list_page_name_words')
            and prosecdef and proconfig = array['search_path=public']), 7, 'all seven public functions are security definer with a pinned search_path');
select is((select count(*)::int from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'get_gym_page_name'), 1, 'get_gym_page_name has its capability row');
select is((select count(*)::int from private.support_capabilities where object_name in ('claim_page_name', 'decide_held_page_name', 'list_held_page_names', 'add_page_name_word', 'remove_page_name_word', 'list_page_name_words')), 0,
          'claim, decide and the word functions have no capability row (support stays denied)');
select is(has_function_privilege('anon', 'public.claim_page_name(uuid,text)', 'execute'), false, 'anon cannot execute claim_page_name');
select is(has_function_privilege('authenticated', 'public.claim_page_name(uuid,text)', 'execute'), true, 'authenticated can execute claim_page_name');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace and (p.proname like 'page\_name%' or p.proname like 'notify\_page\_name%' or p.proname = 'set_page_name_idle')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'no private page-name function is executable by a client role');

-- grammar CHECK: nothing invalid can be stored by any path
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('G') || $$', 'ab', 'released', 'claim')$$), '23514:new row for relation "page_names" violates check constraint "page_names_name_grammar"', 'CHECK: 2 characters');
select is((select count(*)::int from unnest(array['-abc', 'abc-', 'a--b', 'xn--abc', '12345', 'ABC', 'ab_c', 'ab c', 'abcdefghijklmnopqrstuvwxyz01234']) n(v)
            where pg_temp.err(format($q$insert into page_names (gym_id, name, state, origin) values (%L, %L, 'released', 'claim')$q$, pg_temp.g('G'), v)) like '23514:%'), 9,
          'CHECK: leading and trailing hyphen, double hyphen, xn--, digits only, uppercase, underscore, space, 31 characters are all refused');
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('G') || $$', 'a1b', 'released', 'claim')$$), 'ok', 'CHECK: a valid 3-character name is stored');
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('G') || $$', 'abcdefghijklmnopqrstuvwxyz0123', 'released', 'claim')$$), 'ok', 'CHECK: a 30-character name is stored');
delete from page_names where gym_id = pg_temp.g('G')::uuid;

-- edit distance and folding
select is((select array_agg(private.page_name_within_one_edit(a, b) order by i) from (values
            (1, 'iron', 'iron'), (2, 'iron', 'iran'), (3, 'iron', 'ion'), (4, 'iron', 'irons'), (5, 'iron', 'ixon'), (6, 'iron', 'ioon1'), (7, 'iron', 'ironxx'), (8, 'iron', 'irno'), (9, '', 'a'), (10, 'ab', 'ba')) v(i, a, b)),
          array[true, true, true, true, true, false, false, false, true, false], 'edit distance 1: equal, substitute, delete, insert pass; two edits and a transposition do not');
select is(private.page_name_fold('Ir0n-Yard-1335 vv rn'), 'ironyardlees w m', 'folding: lowercase, strip hyphens, 0->o 1->l 3->e 5->s, vv->w, rn->m');

-- ---- first claim, case and spaces -----------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', '  Iron-Yard ')), 'active', 'owner claims a clean name: active at once, trimmed and lowercased');
reset role;
select is((select name || '|' || state || '|' || origin from page_names where gym_id = pg_temp.g('A')::uuid), 'iron-yard|active|claim', 'stored as iron-yard, active, origin claim');
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('A')::uuid),
          'an idle gym (no published page): reserved_until is about 12 months out');
select is((select count(*)::int from audit_log where action_type = 'page_name_claimed' and gym_id = pg_temp.g('A')::uuid and actor_id = pg_temp.u('ownerA')::uuid), 1, 'one audit row names the owner');

-- ---- refusals: nothing is stored ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is((select string_agg(left(pg_temp.val(pg_temp.cl('B', n)), 40), '|' order by n) from unnest(array['ab', '-x-', 'a--b', 'xn--a', '12345']) n),
          'P0001:claim_page_name: invalid_name|P0001:claim_page_name: invalid_name|P0001:claim_page_name: invalid_name|P0001:claim_page_name: invalid_name|P0001:claim_page_name: invalid_name',
          'bad grammar: ab, -x-, a--b, xn--a, 12345 are all invalid_name');
select is((select string_agg(pg_temp.val(pg_temp.cl('B', n)), '|' order by n) from unnest(array['www', 'mail', 'gymos-x', 'my-login-page', 'webmail', 'cpanel', 'gymos', 'gym-os', 'mypayment']) n),
          'P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name|P0001:claim_page_name: reserved_name',
          'reserved, zone, gymos prefix and brand-word names are reserved_name');
select is(pg_temp.val(pg_temp.cl('B', 'IRON-YARD')), 'P0001:claim_page_name: name_taken', 'a name active at another gym is name_taken, whatever the case');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('B')::uuid), 0, 'no refusal stored a row');

-- ---- near match: held, under review -------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'ir0n-yard')), 'held', 'a folded equal of another gym''s name is held (not an error)');
reset role;
select is((select state || '|' || origin || '|' || held_reason from page_names where gym_id = pg_temp.g('B')::uuid and state = 'held'), 'held|claim|near_match_name:iron-yard', 'the hold names its reason for the Super Admin');
select ok((select held_at is not null and reserved_until is null and decided_at is null from page_names where gym_id = pg_temp.g('B')::uuid and state = 'held'), 'a held row has held_at, no reserved_until, no decision');
select is((select count(*)::int from audit_log where action_type = 'page_name_held' and gym_id = pg_temp.g('B')::uuid and metadata::text like '%near_match%'), 0, 'the audit row (readable by the Owner) does not carry the held reason');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('B') || $$')->>'state'$$), 'held', 'the owner sees "held" (under review)');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('B') || $$')->>'pending_name'$$), 'ir0n-yard', 'and the pending name');
select is(pg_temp.val($$select (get_gym_page_name('$$ || pg_temp.g('B') || $$') ? 'held_reason')::text$$), 'false', 'get_gym_page_name has no held_reason');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('B') || $$')::text like '%iron-yard%'$$), 'false', 'nor another gym''s name');
select is(pg_temp.val(pg_temp.cl('B', 'IRON-YAR')), 'held', 'one letter off is held too');
select is(pg_temp.val(pg_temp.cl('A', 'steel-yard')), 'P0001:permission denied', 'another gym''s owner cannot claim for gym A');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('B')::uuid and state = 'held'), 1, 'a new claim released the pending held row first: still one held row');
select is((select count(*)::int from page_names where gym_id = pg_temp.g('B')::uuid and state = 'released' and reserved_until is null), 1, 'the superseded held row is released, never active');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'iron-yar')), 'held', 'asking again for the pending name returns it unchanged');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('B')::uuid), 2, 'and adds no row');

-- a held name is taken for everyone else (case-insensitive)
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.val(pg_temp.cl('G', 'IRON-YAR')), 'P0001:claim_page_name: name_taken', 'a held name is name_taken for another gym');
select is(pg_temp.val(pg_temp.cl('G', 'www')), 'P0001:claim_page_name: reserved_name', 'a super admin is never exempt from the reserved list');
select is(pg_temp.val(pg_temp.cl('G', 'iron-yard')), 'P0001:claim_page_name: name_taken', 'nor from name_taken');
select is(pg_temp.val(pg_temp.cl('G', 'x')), 'P0001:claim_page_name: invalid_name', 'nor from the grammar');
reset role;

-- ---- hold rule: one generic or place word holds the name --------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerE'), 'owner', pg_temp.g('E'));
select is(pg_temp.val(pg_temp.cl('E', 'x-fitness')), 'held', 'x-fitness: a generic part holds the name');
reset role;
select is((select held_reason from page_names where gym_id = pg_temp.g('E')::uuid and state = 'held'), 'generic_word:fitness', 'with its reason');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerE'), 'owner', pg_temp.g('E'));
select is(pg_temp.val(pg_temp.cl('E', 'douala-box')), 'held', 'a place part holds the name');
select is(pg_temp.val(pg_temp.cl('E', 'gymnast')), 'active', 'gymnast: only a whole hyphen-separated part counts, so it goes active');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('E')::uuid and state = 'released'), 2, 'the earlier pending holds were released by the later claims');

-- ---- rename: allowed twice per rolling 12 months ------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'steel-yard')), 'active', 'first rename is active at once');
reset role;
select is((select string_agg(name || ':' || state || ':' || origin, ',' order by name) from page_names where gym_id = pg_temp.g('A')::uuid), 'iron-yard:redirect:claim,steel-yard:active:rename', 'the old name is a redirect, the new one active');
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('A')::uuid and state = 'redirect'),
          'the redirect lasts 12 months');
select is((select count(*)::int from audit_log where action_type = 'page_name_renamed' and gym_id = pg_temp.g('A')::uuid), 1, 'a rename writes one audit row');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'copper-yard')), 'active', 'second rename is active at once');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'completed_renames'$$), '2', 'two completed renames are counted');
select is(pg_temp.val($$select jsonb_array_length(get_gym_page_name('$$ || pg_temp.g('A') || $$')->'redirects')::text$$), '2', 'two redirects, each with an expiry');
select is(pg_temp.val($$select (get_gym_page_name('$$ || pg_temp.g('A') || $$')->'redirects'->0 ? 'expires_at')::text$$), 'true', 'a redirect carries its expiry');
select is(pg_temp.val(pg_temp.cl('A', 'zinc-yard')), 'P0001:claim_page_name: rename_limit', 'a third rename inside 12 months is rename_limit');
select is(pg_temp.val(pg_temp.cl('A', 'copper-yard')), 'active', 'asking for the current name is a no-op');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('A')::uuid and name = 'zinc-yard'), 0, 'rename_limit stored nothing');
select is((select count(*)::int from page_names where gym_id = pg_temp.g('A')::uuid and state = 'redirect'), 2, 'each redirect points one hop at the current active name (rows carry no target)');
select is((select string_agg(pn.name, ',' order by pn.name) from page_names r join page_names pn on pn.gym_id = r.gym_id and pn.state = 'active' where r.gym_id = pg_temp.g('A')::uuid and r.state = 'redirect'), 'copper-yard,copper-yard',
          'every redirect resolves through its gym to the current active name');

-- rolling-window boundary: the oldest rename completed 12 months ago (minus a minute) no longer counts; plus a minute still does
update page_names set created_at = now() - interval '12 months' + interval '1 minute' where gym_id = pg_temp.g('A')::uuid and name = 'steel-yard';
select is(private.page_name_completed_renames(pg_temp.g('A')::uuid), 2, 'window: a rename 1 minute inside 12 months still counts');
update page_names set created_at = now() - interval '12 months' - interval '1 minute' where gym_id = pg_temp.g('A')::uuid and name = 'steel-yard';
select is(private.page_name_completed_renames(pg_temp.g('A')::uuid), 1, 'window: a rename 1 minute past 12 months no longer counts');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val(pg_temp.cl('A', 'zinc-yard')), 'active', 'so a third rename is allowed once one drops out of the window');
reset role;

-- ---- held rename: old name keeps serving; approve / reject ------------------------------------------------------------------
select is((select name from page_names where gym_id = pg_temp.g('E')::uuid and state = 'active'), 'gymnast', 'gym E serves gymnast');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerE'), 'owner', pg_temp.g('E'));
select is(pg_temp.val(pg_temp.cl('E', 'sport-box')), 'held', 'a held rename');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('E') || $$')->>'name'$$), 'gymnast', 'the old name keeps serving while it is held');
reset role;
select is((select origin from page_names where gym_id = pg_temp.g('E')::uuid and state = 'held'), 'rename', 'the held row has origin rename');
select is(private.page_name_completed_renames(pg_temp.g('E')::uuid), 0, 'a pending rename is not counted');

select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is((select count(*)::int from list_held_page_names() where gym_id = pg_temp.g('E')::uuid and name = 'sport-box' and current_name = 'gymnast' and due_at > held_at and not overdue), 1, 'the queue shows the held rename with its due date and current name');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'true', '')), 'P0001:decide_held_page_name: reason_required', 'approve without a reason is refused');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'true', 'ok')), 'P0001:decide_held_page_name: reason_required', 'a 2-character reason is refused');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'true', repeat(' ', 5))), 'P0001:decide_held_page_name: reason_required', 'a reason of ASCII spaces only is refused');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'true', chr(160) || chr(12288) || chr(65279) || chr(160) || chr(12288))), 'P0001:decide_held_page_name: reason_required', 'a reason of Unicode whitespace only (NBSP, ideographic space, BOM) is refused');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'true', repeat('x', 501))), 'P0001:decide_held_page_name: reason_required', 'a 501-character reason is refused');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'true', chr(160) || 'Verified as the gym''s own trading name' || chr(12288))), 'active', 'approve with a reason activates (a Unicode-padded reason is stored trimmed, checked below)');
reset role;
select is((select string_agg(name || ':' || state, ',' order by name) from page_names where gym_id = pg_temp.g('E')::uuid and state <> 'released'), 'gymnast:redirect,sport-box:active', 'approved: new active, old a redirect');
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('E')::uuid and state = 'redirect'), 'the redirect lasts 12 months from approval');
select ok((select decided_at is not null and decided_by = pg_temp.u('admin')::uuid and decision_reason like 'Verified%' and decision_reason like '%name' from page_names where gym_id = pg_temp.g('E')::uuid and state = 'active'), 'the decision is recorded on the row');
select is(private.page_name_completed_renames(pg_temp.g('E')::uuid), 1, 'an approved rename counts');
select is((select count(*)::int from audit_log where action_type = 'page_name_approved' and gym_id = pg_temp.g('E')::uuid and metadata ->> 'reason' like 'Verified%'), 1, 'approval writes an audit row with the reason');
select is((select count(*)::int from staff_notices where user_id = pg_temp.u('ownerE')::uuid and notice_type = 'page_name_decision' and body_en like '%sport-box%was approved%Verified%' and body_fr like '%sport-box%approuvé%Verified%'), 1,
          'the Owner gets one bilingual notice naming the outcome and the reason');
select is((select count(*)::int from staff_notices where notice_type = 'page_name_decision' and gym_id = pg_temp.g('E')::uuid
            and (title_en || body_en || title_fr || body_fr) ~* '(Zelda|Adminname|admin-2407)'), 0,
          'no individual is named in the notice: neither the deciding Super Admin''s display name nor e-mail appears');
select is((select count(*)::int from email_outbox o join staff_notices n on n.id = o.notice_id where n.gym_id = pg_temp.g('E')::uuid and n.notice_type = 'page_name_decision'
            and (o.subject || o.body) ~* '(Zelda|Adminname|admin-2407)'), 0, 'nor in the queued e-mail');
select is((select count(*)::int from email_outbox o join staff_notices n on n.id = o.notice_id where n.user_id = pg_temp.u('ownerE')::uuid and o.recipient_email = 'ownerE-2407@x.example'), 1, 'and one e-mail is queued to the Owner');

set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerE'), 'owner', pg_temp.g('E'));
select is(pg_temp.val(pg_temp.cl('E', 'best-box')), 'held', 'another held rename');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('E', 'held'), 'false', 'Too generic for this city')), 'released', 'reject releases the row');
reset role;
select is((select string_agg(name || ':' || state, ',' order by name) from page_names where gym_id = pg_temp.g('E')::uuid and name = 'best-box'), 'best-box:released', 'the rejected name is free');
select ok((select reserved_until is null and decision_reason = 'Too generic for this city' from page_names where gym_id = pg_temp.g('E')::uuid and name = 'best-box'), 'rejected: reason recorded, never active');
select is(private.page_name_completed_renames(pg_temp.g('E')::uuid), 1, 'a rejected rename does not count');
select is((select name from page_names where gym_id = pg_temp.g('E')::uuid and state = 'active'), 'sport-box', 'and the serving name is unchanged');
select is((select count(*)::int from staff_notices where user_id = pg_temp.u('ownerE')::uuid and notice_type = 'page_name_decision' and body_en like '%best-box%was not approved%Too generic%' and body_fr like '%best-box%pas été approuvé%Too generic%'), 1, 'the reject notice carries the reason, EN and FR');
select is(pg_temp.val(pg_temp.dec(pg_temp.pidn('E', 'best-box'), 'true', 'second try')), 'P0001:decide_held_page_name: not_held', 'a decided row cannot be decided again');

-- re-asking for the current name while a rename is pending withdraws the pending row (gym E)
select count(*)::int as withdrawn_before from audit_log where action_type = 'page_name_withdrawn' and gym_id = pg_temp.g('E')::uuid \gset
select private.page_name_completed_renames(pg_temp.g('E')::uuid) as renames_before \gset
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerE'), 'owner', pg_temp.g('E'));
select is(pg_temp.val(pg_temp.cl('E', 'club-box')), 'held', 'a second held rename is pending');
select is(pg_temp.val(pg_temp.cl('E', 'sport-box')), 'active', 're-asking for the current name returns it as active');
reset role;
select is((select count(*)::int from page_names where gym_id = pg_temp.g('E')::uuid and state = 'held'), 0, 'and the pending held row is gone');
select ok((select state = 'released' and reserved_until is null from page_names where gym_id = pg_temp.g('E')::uuid and name = 'club-box'), 'it is released and never active (reserved_until stays null)');
select is((select count(*)::int from audit_log where action_type = 'page_name_withdrawn' and gym_id = pg_temp.g('E')::uuid) - :withdrawn_before, 1, 'one page_name_withdrawn audit row');
select is(private.page_name_completed_renames(pg_temp.g('E')::uuid), :renames_before, 'completed renames are unchanged');

-- going back to a name the gym itself redirected (gym E: gymnast is its redirect)
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerE'), 'owner', pg_temp.g('E'));
select is(pg_temp.val(pg_temp.cl('E', 'gymnast')), 'active', 'going back to a name the gym itself redirected succeeds');
reset role;
select is((select string_agg(name || ':' || state || ':' || origin, ',' order by name) from page_names where gym_id = pg_temp.g('E')::uuid and state <> 'released'), 'gymnast:active:rename,sport-box:redirect:rename',
          'the name is active again as a rename and the current name is now the redirect');
select is((select count(*)::int from page_names where gym_id = pg_temp.g('E')::uuid and name = 'gymnast' and state = 'released' and origin = 'claim' and reserved_until is not null), 1,
          'the old redirect row was released, with reserved_until stamped');
select is(private.page_name_completed_renames(pg_temp.g('E')::uuid), :renames_before + 1, 'and the change counts as a rename');

-- approve re-runs the reserved check: a word added after the hold refuses the approval
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
set local role authenticated;
select is(pg_temp.err($$select add_page_name_word('reserved', 'iron-yar')$$), 'ok', 'a super admin adds a reserved word');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('B', 'held'), 'true', 'approve anyway')), 'P0001:decide_held_page_name: reserved_name', 'approve re-runs the reserved check');
select is(pg_temp.val(pg_temp.dec(pg_temp.pid('B', 'held'), 'false', 'now a reserved word')), 'released', 'but reject still works');
select is(pg_temp.err($$select remove_page_name_word('reserved', 'iron-yar')$$), 'ok', 'and the word can be removed again');
reset role;

-- ---- forced rename ------------------------------------------------------------------------------------------------------
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(private.page_name_completed_renames(pg_temp.g('A')::uuid), 2, 'gym A has two completed renames before the forced one');
set local role authenticated;
select is(pg_temp.val(pg_temp.cl('A', 'fitness-forge')), 'active', 'super admin on behalf: skips the hold (a generic word) and is active at once');
reset role;
select is((select string_agg(name || ':' || state || ':' || origin, ',' order by name) from page_names where gym_id = pg_temp.g('A')::uuid and state <> 'released'), 'fitness-forge:active:forced_rename', 'forced rename: only the new name is live');
select is((select count(*)::int from page_names where gym_id = pg_temp.g('A')::uuid and state = 'redirect'), 0, 'the gym''s redirect rows are released at once');
select is(private.page_name_completed_renames(pg_temp.g('A')::uuid), 2, 'a forced rename does not count and does not undo the count');

-- ---- idle clock, publish state, suspension ---------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.cl('G', 'idle-box')), 'active', 'claim for gym G');
select is(pg_temp.val(pg_temp.cl('H', 'live-box')), 'active', 'claim for gym H');
select is(pg_temp.val(pg_temp.cl('F', 'sleep-box')), 'active', 'a super admin may claim for a suspended gym');
reset role;
insert into gym_pages (gym_id, template, published_at) values (pg_temp.g('H')::uuid, 'x', now());
select private.set_page_name_idle(pg_temp.g('H')::uuid, false);
select is((select reserved_until from page_names where gym_id = pg_temp.g('H')::uuid and state = 'active'), null, 'idle ends (published): reserved_until is cleared');
select private.set_page_name_idle(pg_temp.g('H')::uuid, true);
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('H')::uuid and state = 'active'), 'idle starts: reserved_until is 12 months out');
update page_names set reserved_until = now() + interval '3 months' where gym_id = pg_temp.g('H')::uuid and state = 'active';
select private.set_page_name_idle(pg_temp.g('H')::uuid, true);
select ok((select reserved_until between now() + interval '3 months' - interval '1 minute' and now() + interval '3 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('H')::uuid and state = 'active'), 'a repeat idle call does not extend the clock');
select private.set_page_name_idle(pg_temp.g('H')::uuid, false);

-- suspension: the trigger starts the clock; reactivation of a published gym clears it, of an unpublished gym keeps it
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
update gyms set status = 'suspended' where id = pg_temp.g('H')::uuid;
select ok((select reserved_until between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from page_names where gym_id = pg_temp.g('H')::uuid and state = 'active'), 'suspending a gym starts the idle clock');
update gyms set status = 'active' where id = pg_temp.g('H')::uuid;
select is((select reserved_until from page_names where gym_id = pg_temp.g('H')::uuid and state = 'active'), null, 'reactivating a gym whose page is published clears it');
update gyms set status = 'suspended' where id = pg_temp.g('G')::uuid;
update gyms set status = 'active' where id = pg_temp.g('G')::uuid;
select ok((select reserved_until is not null from page_names where gym_id = pg_temp.g('G')::uuid and state = 'active'), 'reactivating a gym with no published page keeps the clock running');
select ok((select reserved_until is not null from page_names where gym_id = pg_temp.g('F')::uuid and state = 'active'), 'a gym claimed while suspended is idle from the start');

-- ---- sweep -----------------------------------------------------------------------------------------------------------------
-- I: active, idle, taken_down_at set, past its clock.  J: state reserved, past its clock.  K: redirects (one past, one future).
insert into page_names (gym_id, name, state, origin, reserved_until, taken_down_at) values
  (pg_temp.g('I')::uuid, 'down-box', 'active', 'claim', now() - interval '1 day', now() - interval '2 days'),
  (pg_temp.g('J')::uuid, 'held-forever', 'reserved', 'claim', now() - interval '1 day', now() - interval '2 days');
insert into page_names (gym_id, name, state, origin, reserved_until) values
  (pg_temp.g('K')::uuid, 'old-redirect', 'redirect', 'claim', now() - interval '1 day'),
  (pg_temp.g('K')::uuid, 'new-redirect', 'redirect', 'claim', now() + interval '1 day');
-- redirects of G (its name is about to be released) and of H (its name is kept)
insert into page_names (gym_id, name, state, origin, reserved_until) values
  (pg_temp.g('G')::uuid, 'old-g-box', 'redirect', 'claim', now() + interval '3 months'),
  (pg_temp.g('H')::uuid, 'old-h-box', 'redirect', 'claim', now() + interval '3 months');
-- G idle and past: released.  H published and past: kept.  F suspended 6 months in: kept.
update page_names set reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('G')::uuid and state = 'active';
update page_names set reserved_until = now() - interval '1 day' where gym_id = pg_temp.g('H')::uuid and state = 'active';
update page_names set reserved_until = now() + interval '6 months' where gym_id = pg_temp.g('F')::uuid and state = 'active';
-- overdue holds: L is 5 calendar days old (at least 3 business days), M is new
insert into page_names (gym_id, name, state, origin, held_reason, held_at) values
  (pg_temp.g('L')::uuid, 'gym-late', 'held', 'claim', 'generic_word:gym', now() - interval '5 days'),
  (pg_temp.g('M')::uuid, 'gym-fresh', 'held', 'claim', 'generic_word:gym', now());
select count(*)::int as admins from users where is_super_admin and not is_support_proxy \gset
select count(*)::int as notices_before from staff_notices where notice_type = 'page_name_overdue' \gset
select count(*)::int as runs_before from job_runs where job_name = 'page_names_sweep' \gset
-- cron has no session: the sweep is a system actor
select set_config('request.jwt.claims', '', true);
select private.page_names_sweep();
select is((select state from page_names where gym_id = pg_temp.g('G')::uuid and name = 'idle-box'), 'released', 'sweep: an idle name past its 12 months is released');
select is((select state from page_names where gym_id = pg_temp.g('H')::uuid and name = 'live-box'), 'active', 'sweep: kept while a published page exists');
select is((select state || '|' || (reserved_until is not null)::text from page_names where gym_id = pg_temp.g('G')::uuid and name = 'old-g-box'), 'released|true', 'sweep: the redirects of a released name go with it (nothing is left pointing at nothing)');
select is((select state from page_names where gym_id = pg_temp.g('H')::uuid and name = 'old-h-box'), 'redirect', 'sweep: the redirects of a kept name stay');
select is((select state from page_names where gym_id = pg_temp.g('F')::uuid and name = 'sleep-box'), 'active', 'sweep: a gym suspended 6 months keeps its name');
select is((select state from page_names where gym_id = pg_temp.g('I')::uuid and name = 'down-box'), 'active', 'sweep: a row with taken_down_at is never released');
select is((select state from page_names where gym_id = pg_temp.g('J')::uuid and name = 'held-forever'), 'reserved', 'sweep: a reserved (taken-down) row is never released');
select is((select state from page_names where gym_id = pg_temp.g('K')::uuid and name = 'old-redirect'), 'released', 'sweep: a redirect past its 12 months is released');
select is((select state from page_names where gym_id = pg_temp.g('K')::uuid and name = 'new-redirect'), 'redirect', 'sweep: a live redirect stays');
select is((select count(*)::int from audit_log where action_type = 'page_name_released' and actor_display_name = 'system:page_names_sweep'), 2, 'sweep: each release is audited as the system');
select is((select count(*)::int from staff_notices where notice_type = 'page_name_overdue') - :notices_before, :admins, 'sweep: one reminder per Super Admin for the overdue hold');
select ok((select reminded_at is not null from page_names where gym_id = pg_temp.g('L')::uuid and state = 'held') and (select reminded_at is null from page_names where gym_id = pg_temp.g('M')::uuid and state = 'held'), 'sweep: reminded_at set on the overdue hold only');
select is((select count(*)::int from job_runs where job_name = 'page_names_sweep' and status = 'success') - :runs_before, 1, 'sweep: the run is recorded in job_runs');
select private.page_names_sweep();
select is((select count(*)::int from staff_notices where notice_type = 'page_name_overdue') - :notices_before, :admins, 'sweep: a second run sends no second reminder');
select is((select count(*)::int from staff_notices where notice_type = 'page_name_overdue' and gym_id = pg_temp.g('L')::uuid and user_id = pg_temp.u('admin')::uuid and body_en like '%gym-late%' and body_fr like '%gym-late%'), 1, 'the reminder names the held name, EN and FR');

-- the queue flags the overdue hold and lists the oldest first (gym-late is 5 days old, gym-fresh is new)
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is((select overdue from list_held_page_names() where name = 'gym-late'), true, 'queue: a hold past its 2 business days is overdue');
select is((select overdue from list_held_page_names() where name = 'gym-fresh'), false, 'queue: a new hold is not overdue');
select is((select array_agg(name) from list_held_page_names() where name in ('gym-late', 'gym-fresh')), array['gym-late', 'gym-fresh']::text[], 'queue: oldest first');
reset role;

-- a gym claiming its own taken-down (reserved) name is refused; a Super Admin on behalf skips the hold even for the name already pending
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.cl('J', 'held-forever')), 'P0001:claim_page_name: name_taken', 'a gym cannot claim its own taken-down (reserved) name');
select is(pg_temp.val(pg_temp.cl('M', 'gym-fresh')), 'active', 'a Super Admin on behalf skips the hold even when that name is already pending');
reset role;
select is((select state from page_names where gym_id = pg_temp.g('J')::uuid and name = 'held-forever'), 'reserved', 'the reserved row is untouched');
select is((select string_agg(state || ':' || origin, ',' order by state) from page_names where gym_id = pg_temp.g('M')::uuid and name = 'gym-fresh'), 'active:claim,released:claim', 'the pending row was withdrawn and the name promoted');
select is((select count(*)::int from audit_log where action_type = 'page_name_withdrawn' and gym_id = pg_temp.g('M')::uuid), 1, 'with a withdrawn audit row');

-- Unicode whitespace around a name is trimmed (NBSP, ideographic space), as the page content setter does; gym G has no active name here
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.val(pg_temp.cl('G', chr(160) || 'uni-code' || chr(12288))), 'active', 'a name padded with NBSP and an ideographic space is claimed');
reset role;
select is((select name from page_names where gym_id = pg_temp.g('G')::uuid and state = 'active'), 'uni-code', 'and stored trimmed');

-- ---- reserved trigger: whichever path writes an active row -------------------------------------------------------------------
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('M') || $$', 'api', 'active', 'claim')$$), '23514:page_names: reserved_name', 'trigger: a direct insert of an active reserved name is refused');
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('M') || $$', 'gymos-new', 'active', 'claim')$$), '23514:page_names: reserved_name', 'trigger: the gymos prefix is refused');
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('M') || $$', 'webmail', 'active', 'claim')$$), '23514:page_names: reserved_name', 'trigger: a zone label is refused');
insert into page_names (gym_id, name, state, origin) values (pg_temp.g('J')::uuid, 'mail', 'released', 'claim');
select is(pg_temp.err($$update page_names set state = 'active' where gym_id = '$$ || pg_temp.g('J') || $$' and name = 'mail'$$), '23514:page_names: reserved_name', 'trigger: activating a row with a reserved name is refused');
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('M') || $$', 'mail', 'redirect', 'claim')$$), 'ok', 'control: the same name in a non-active state is stored (the trigger guards active rows)');
select is(pg_temp.err($$insert into page_names (gym_id, name, state, origin) values ('$$ || pg_temp.g('B') || $$', 'fresh-box', 'active', 'claim')$$), 'ok', 'control: a clean active name is stored');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select pg_temp.err($$select add_page_name_word('reserved', 'fresh-box')$$);
select is(pg_temp.err($$update page_names set reserved_until = now() where name = 'fresh-box'$$), 'ok', 'control: a word reserved later does not block an unrelated update of an existing active name');

-- ---- words ---------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$select add_page_name_word('generic', ' Sauna ')$$), 'ok', 'add a generic word (trimmed, lowercased)');
select is(pg_temp.err($$select add_page_name_word('generic', 'sauna')$$), 'ok', 'adding it again is a no-op');
select is(pg_temp.err($$select add_page_name_word('brand', 'zzbrand')$$), 'ok', 'add a brand word');
select is(pg_temp.val($$select add_page_name_word('place', 'Bad Word')$$), 'P0001:add_page_name_word: invalid_word', 'an invalid word is refused');
select is(pg_temp.val($$select add_page_name_word('nope', 'abc')$$), 'P0001:add_page_name_word: invalid_word', 'an unknown kind is refused');
select is(pg_temp.val($$select add_page_name_word('generic', 'abc', true)$$), 'P0001:add_page_name_word: invalid_word', 'only reserved and zone words can be prefixes');
select is(pg_temp.val($$select remove_page_name_word('zone', 'www')$$), 'P0001:remove_page_name_word: zone_word_protected', 'a zone word cannot be removed');
select is(pg_temp.val($$select remove_page_name_word('zone', 'gymos', true)$$), 'P0001:remove_page_name_word: zone_word_protected', 'nor the zone prefix');
select is(pg_temp.val($$select remove_page_name_word('brand', 'nothing-here')$$), 'P0001:remove_page_name_word: not_found', 'removing a missing word says so');
select is((select count(*)::int from list_page_name_words() where kind = 'generic' and word = 'sauna'), 1, 'list_page_name_words shows it');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'sauna-spa')), 'held', 'the new generic word holds a name at once');
select is(pg_temp.val(pg_temp.cl('B', 'my-zzbrand')), 'P0001:claim_page_name: reserved_name', 'the new brand word refuses a containing name');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$select remove_page_name_word('generic', 'sauna')$$), 'ok', 'a generic word can be removed');
select is(pg_temp.err($$select remove_page_name_word('brand', 'zzbrand')$$), 'ok', 'so can a brand word');
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'my-zzbrand')), 'active', 'and the name is allowed again');
-- a hyphenated generic word matches as whole hyphen-separated parts; a zone word cannot be added here (it could never be removed)
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$select add_page_name_word('generic', 'personal-training')$$), 'ok', 'add a hyphenated generic word');
select is(pg_temp.val($$select add_page_name_word('zone', 'zzzone')$$), 'P0001:add_page_name_word: invalid_word', 'a zone word cannot be added by the function');
reset role;
select is(private.page_name_hold_reason('personal-training-box', pg_temp.g('A')::uuid), 'generic_word:personal-training', 'a name containing the hyphenated word as whole parts is held');
select is(private.page_name_hold_reason('personal-trainer-box', pg_temp.g('A')::uuid), null::text, 'a name that only shares a prefix with it is not');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$select remove_page_name_word('generic', 'personal-training')$$), 'ok', 'and the hyphenated word can be removed');
reset role;
select is((select count(*)::int from audit_log where action_type in ('page_name_word_added', 'page_name_word_removed') and actor_id = pg_temp.u('admin')::uuid), 9, 'word changes are audited (5 adds, 4 removes; the repeated add is not)');

-- ---- hold reasons: prefix hardening, reserved near match, brand near match (gym B) --------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'gym0s-box')), 'held', 'gym0s-box: a homoglyph of the gymos prefix is held (prefix hardening)');
reset role;
select is((select held_reason from page_names where gym_id = pg_temp.g('B')::uuid and state = 'held'), 'near_match_reserved:gymos', 'with the reserved reason');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'supp0rt')), 'held', 'supp0rt: folds to the reserved name support');
reset role;
select is((select held_reason from page_names where gym_id = pg_temp.g('B')::uuid and state = 'held'), 'near_match_reserved:support', 'with the reserved reason naming it');
set local role authenticated;
select pg_temp.as_user(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.val(pg_temp.cl('B', 'wal1et')), 'held', 'wal1et: folds to the brand word wallet');
reset role;
select is((select held_reason from page_names where gym_id = pg_temp.g('B')::uuid and state = 'held'), 'near_match_brand:wallet', 'with the brand reason naming it');

-- ---- support reads, not writes -------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000247a1');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'name'$$), 'fitness-forge', 'a live-assigned support caller reads the name state');
select pg_temp.as_user(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'name'$$), 'fitness-forge', 'a supervisor reads it');
select pg_temp.as_user(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('A') || $$')->>'state'$$), 'active', 'the owner reads it');
select is(pg_temp.val($$select get_gym_page_name('$$ || pg_temp.g('B') || $$')->>'state'$$), 'P0001:permission denied', 'and not another gym''s');
reset role;

-- ---- consumers enumerated: a new writer or admitted role without the checks fails here --------------------------------------------------------
select is((select array_agg(proname::text order by proname) from pg_proc
            where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and prokind = 'f'
              and prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?page_names\M'),
          array['claim_page_name', 'decide_held_page_name', 'page_name_promote', 'page_names_sweep', 'set_page_name_idle']::text[],
          'the functions that write page_names are exactly the five allowlisted (24.8 and 24.11 add theirs here deliberately)');
select is((select array_agg(proname::text order by proname) from pg_proc
            where pronamespace = 'public'::regnamespace and prokind = 'f' and (prosrc ~* '\mpage_names\M' or prosrc ~* '\mpage_name_words\M')),
          array['add_page_name_word', 'claim_page_name', 'decide_held_page_name', 'get_gym_page_name', 'list_held_page_names', 'list_page_name_words', 'publish_gym_page', 'remove_page_name_word']::text[],
          'the client-callable functions that touch the page name tables are exactly the seven plus publish_gym_page (24.8 reads the active name; it writes none)');
select is((select count(*)::int from pg_proc where proname = 'claim_page_name' and prosrc ~* 'is_super_admin_live' and prosrc ~* 'p_gym_id\s+is\s+distinct\s+from\s+private\.gym_id\(\)'
            and prosrc ~* 'current_member_role\(\)\s+is\s+distinct\s+from\s+''owner''' and prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' and prosrc !~* 'support_rpc|supervisor'), 1,
          'claim_page_name admits exactly the gym''s Owner (current gym) and a live Super Admin, requires an active gym, and names no other role');
select is((select count(*)::int from pg_proc where proname in ('decide_held_page_name', 'list_held_page_names', 'add_page_name_word', 'remove_page_name_word', 'list_page_name_words')
            and prosrc ~* 'if not coalesce\(private\.is_super_admin_live\(\), false\) then\s+raise exception ''permission denied''' and prosrc !~* 'support_rpc|current_member_role|private\.gym_id'), 5,
          'the decision, queue and word functions admit only a live Super Admin');
select is((select (regexp_match(prosrc, 'support_rpc_role\(''get_gym_page_name''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'get_gym_page_name'), '''owner'', ''supervisor''',
          'get_gym_page_name admits exactly owner and supervisor (plus super admin and live support at the supervisor ceiling)');
select is((select count(*)::int from pg_proc where pronamespace = 'private'::regnamespace and proname in ('page_name_promote', 'set_page_name_idle', 'page_names_sweep', 'page_names_gym_status_changed', 'page_names_refuse_reserved')
            and prosecdef), 5, 'the private writers and triggers are security definer');

-- ---- gym_pages.page_name_id: foreign key and uniqueness ----------------------------------------------------------------------------------------
select is(pg_temp.err($$insert into gym_pages (gym_id, template, page_name_id) values ('$$ || pg_temp.g('I') || $$', 'x', gen_random_uuid())$$), '23503:insert or update on table "gym_pages" violates foreign key constraint "gym_pages_gym_page_name_fkey"', 'gym_pages refuses a page_name_id that is not a page name (24.8: the composite (gym_id, page_name_id) key)');
select is(pg_temp.err($$insert into gym_pages (gym_id, template, page_name_id) values ('$$ || pg_temp.g('I') || $$', 'x', (select id from page_names where name = 'down-box'))$$), 'ok', 'control: a real page name is accepted');
select is(substr(pg_temp.err($$insert into gym_pages (gym_id, template, page_name_id) values ('$$ || pg_temp.g('J') || $$', 'x', (select id from page_names where name = 'down-box'))$$), 1, 5), '23505', 'the same page name cannot back two pages');

select * from finish();
rollback;
