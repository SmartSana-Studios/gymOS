-- Story 30.2: tenant isolation and API reach of the engagement facts (migration 0185).
--
-- Two gyms, an owner of each, a member of each, and one person who is a member of both. Proven:
--   * no function of this story can be called through the API by any role (member, owner of either gym, anon, service_role), and neither
--     table can be read or written through the API;
--   * a settle for a member of gym A never reads or writes a row of gym B (digest of every gym B row before and after), and the reverse;
--   * a member of gym B settled as gym A (or the other way) raises and writes nothing;
--   * visits at one gym never count for the same person's membership at another gym.
-- Fixed dates throughout (Mondays 2026-03-02, 03-09, 03-16), Africa/Douala, no clock.
--
-- Fixture ids: 00000000-0000-0000-0035-00000000nnnn. Gyms 1001 (A) and 1002 (B).

begin;
select plan(33);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0035-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'IS Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'IS Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'IS Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'is-' || n || '@x.example', now() from generate_series(1, 10) n;
-- 1 owner A, 2 owner B, 3 member A, 4 member B, 5 another member A, 6 the person who is a member of both (A row), 7 the same person at B.
insert into members (id, gym_id, user_id, role, name, join_date) values
  (pg_temp.m(1), pg_temp.id(1, 1), pg_temp.id(2, 1), 'owner', 'IS Owner A', date '2026-01-05'),
  (pg_temp.m(2), pg_temp.id(1, 2), pg_temp.id(2, 2), 'owner', 'IS Owner B', date '2026-01-05'),
  (pg_temp.m(3), pg_temp.id(1, 1), pg_temp.id(2, 3), 'member', 'IS Member A', date '2026-01-05'),
  (pg_temp.m(4), pg_temp.id(1, 2), pg_temp.id(2, 4), 'member', 'IS Member B', date '2026-01-05'),
  (pg_temp.m(5), pg_temp.id(1, 1), pg_temp.id(2, 5), 'member', 'IS Member A2', date '2026-01-05'),
  (pg_temp.m(6), pg_temp.id(1, 1), pg_temp.id(2, 6), 'member', 'IS Both (A)', date '2026-01-05'),
  (pg_temp.m(7), pg_temp.id(1, 2), pg_temp.id(2, 6), 'member', 'IS Both (B)', date '2026-01-05');

update platform_engagement_config set release_week_start = date '2026-03-02';

create function pg_temp.visit(p_n int, p_day date) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + time '10:00') at time zone 'Africa/Douala', (p_day + time '11:00') at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;

-- Runs one statement as a role with the given claims; "ok:<result>" or "sqlstate:message".
create function pg_temp.as_role(p_role text, p_sub uuid, p_gym uuid, p_app text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role, 'gym_id', p_gym, 'app_role', p_app)::text, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return 'ok:' || coalesce(v, 'null');
end $f$;

-- Everything the story stores for one gym, as one digest.
create function pg_temp.digest(p_gym int) returns text language sql stable as $f$
  select md5(
    coalesce((select string_agg(to_jsonb(f)::text, '|' order by f.member_id, f.kind, f.subject_key, f.revision) from engagement_facts f where f.gym_id = pg_temp.id(1, p_gym)), '') || '#' ||
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.member_id) from engagement_state s where s.gym_id = pg_temp.id(1, p_gym)), ''))
$f$;

-- Visits: member 3 (A) met, member 5 (A) missed, member 4 (B) met, the person of both only at B.
select pg_temp.visit(3, date '2026-03-02'); select pg_temp.visit(3, date '2026-03-03'); select pg_temp.visit(3, date '2026-03-04');
select pg_temp.visit(5, date '2026-03-02');
select pg_temp.visit(4, date '2026-03-02'); select pg_temp.visit(4, date '2026-03-03'); select pg_temp.visit(4, date '2026-03-04');
select pg_temp.visit(7, date '2026-03-02'); select pg_temp.visit(7, date '2026-03-03'); select pg_temp.visit(7, date '2026-03-04');

-- ============================================================================
-- Nothing is callable through the API, by any role
-- ============================================================================
create temp table calls (label text, sql text);
insert into calls values
  ('settle',        format($$select private.settle_engagement(%L, %L, date '2026-03-16')::text$$, pg_temp.m(3), pg_temp.id(1, 1))),
  ('fold',          format($$select count(*)::text from private.engagement_fold(%L)$$, pg_temp.m(3))),
  ('fold_weeks',    $$select count(*)::text from private.engagement_fold_weeks('[]'::jsonb)$$),
  ('effective',     format($$select count(*)::text from private.effective_engagement_facts(%L)$$, pg_temp.m(3))),
  ('evaluate',      format($$select count(*)::text from private.engagement_evaluate_weeks(%L, %L, date '2026-03-02', date '2026-03-09')$$, pg_temp.m(3), pg_temp.id(1, 1))),
  ('derived',       format($$select count(*)::text from private.engagement_derived_state(%L)$$, pg_temp.m(3))),
  ('rebuild',       format($$select count(*)::text from private.rebuild_engagement(%L, date '2026-03-16')$$, pg_temp.m(3))),
  ('append_guard',  $$select private.engagement_facts_append_only_guard()::text$$),
  ('epoch_guard',   $$select private.engagement_epoch_guard()::text$$);

select is(
  (select count(*)::int from calls c
   where left(pg_temp.as_role('authenticated', pg_temp.id(2, 3), pg_temp.id(1, 1), 'member', c.sql), 6) = '42501:'),
  9, 'a member of gym A is refused (42501) on all nine functions');
select is(
  (select count(*)::int from calls c
   where left(pg_temp.as_role('authenticated', pg_temp.id(2, 1), pg_temp.id(1, 1), 'owner', c.sql), 6) = '42501:'),
  9, 'the owner of gym A is refused on all nine');
select is(
  (select count(*)::int from calls c
   where left(pg_temp.as_role('authenticated', pg_temp.id(2, 2), pg_temp.id(1, 2), 'owner', c.sql), 6) = '42501:'),
  9, 'the owner of gym B is refused on all nine');
select is(
  (select count(*)::int from calls c where left(pg_temp.as_role('anon', null, null, 'anon', c.sql), 6) = '42501:'),
  9, 'anon is refused on all nine');
select is(
  (select count(*)::int from calls c where left(pg_temp.as_role('service_role', null, null, 'service_role', c.sql), 6) = '42501:'),
  9, 'service_role is refused on all nine');
select is((select count(*)::int from engagement_facts) + (select count(*)::int from engagement_state), 0, 'none of those calls wrote a fact or a state row');

-- ============================================================================
-- Nothing is readable or writable through the tables
-- ============================================================================
select is(pg_temp.as_role('authenticated', pg_temp.id(2, 3), pg_temp.id(1, 1), 'member', 'select count(*)::text from public.engagement_facts'), '42501:permission denied for table engagement_facts', 'a member cannot read the ledger');
select is(pg_temp.as_role('authenticated', pg_temp.id(2, 1), pg_temp.id(1, 1), 'owner', 'select count(*)::text from public.engagement_facts'), '42501:permission denied for table engagement_facts', 'an owner cannot read the ledger');
select is(pg_temp.as_role('authenticated', pg_temp.id(2, 3), pg_temp.id(1, 1), 'member', 'select count(*)::text from public.engagement_state'), '42501:permission denied for table engagement_state', 'a member cannot read the watermark');
select is(pg_temp.as_role('anon', null, null, 'anon', 'select count(*)::text from public.engagement_state'), '42501:permission denied for table engagement_state', 'anon cannot read the watermark');
select is(pg_temp.as_role('authenticated', pg_temp.id(2, 3), pg_temp.id(1, 1), 'member',
            format($$insert into public.engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits) values (%L, %L, 'week', '2026-03-02', 1, 'met', 3, 3)$$, pg_temp.m(3), pg_temp.id(1, 1))),
          '42501:permission denied for table engagement_facts', 'a member cannot write a fact for themselves');
select is(pg_temp.as_role('authenticated', pg_temp.id(2, 3), pg_temp.id(1, 1), 'member', format($$insert into public.engagement_state (member_id, gym_id, dirty_from) values (%L, %L, date '2026-03-02')$$, pg_temp.m(3), pg_temp.id(1, 1))),
          '42501:permission denied for table engagement_state', 'nor a watermark row');
select is(pg_temp.as_role('authenticated', pg_temp.id(2, 1), pg_temp.id(1, 1), 'owner', 'select count(*)::text from public.member_visit_days where false'), 'ok:0', 'control: the same session can still read the counting view it is allowed to read');

-- ============================================================================
-- A gym A settle never touches gym B, and the reverse
-- ============================================================================
select is(private.settle_engagement(pg_temp.m(4), pg_temp.id(1, 2), date '2026-03-16'), 2, 'gym B member settles: two weeks');
create temp table digests as select pg_temp.digest(2) as b_after_b, pg_temp.digest(1) as a_after_b;
select is((select a_after_b from digests), pg_temp.digest(1), 'control: the digest of gym A is stable while nothing runs there');
select is((select count(*)::int from engagement_facts where gym_id = pg_temp.id(1, 1)) + (select count(*)::int from engagement_state where gym_id = pg_temp.id(1, 1)), 0, 'gym B''s settle wrote nothing for gym A');

select is(private.settle_engagement(pg_temp.m(3), pg_temp.id(1, 1), date '2026-03-16'), 2, 'gym A member settles: two weeks');
select is(private.settle_engagement(pg_temp.m(5), pg_temp.id(1, 1), date '2026-03-16'), 2, 'and a second gym A member');
select is(pg_temp.digest(2), (select b_after_b from digests), 'gym A''s settles left every gym B row exactly as it was (digest of facts and state)');
select is((select count(*)::int from engagement_facts where member_id in (pg_temp.m(3), pg_temp.m(5)) and gym_id <> pg_temp.id(1, 1)), 0, 'every fact of a gym A member carries gym A');
select is((select count(*)::int from engagement_state where member_id in (pg_temp.m(3), pg_temp.m(5)) and gym_id <> pg_temp.id(1, 1)), 0, 'and so does every state row');
select is((select count(*)::int from engagement_facts where gym_id = pg_temp.id(1, 2)), 2, 'gym B holds exactly its own member''s two facts');

create temp table digests2 as select pg_temp.digest(1) as a, pg_temp.digest(2) as b;
select throws_ok(format($$select private.settle_engagement(%L, %L, date '2026-03-23')$$, pg_temp.m(4), pg_temp.id(1, 1)), 'P0001', null, 'a gym B member settled as gym A raises');
select throws_ok(format($$select private.settle_engagement(%L, %L, date '2026-03-23')$$, pg_temp.m(3), pg_temp.id(1, 2)), 'P0001', null, 'a gym A member settled as gym B raises');
select throws_ok(format($$select private.settle_engagement(%L, %L, date '2026-03-23')$$, pg_temp.m(1), pg_temp.id(1, 2)), 'P0001', null, 'the owner of gym A settled as gym B raises');
select is(pg_temp.digest(1) || pg_temp.digest(2), (select a || b from digests2), 'and neither gym changed');

-- ============================================================================
-- One person, two gyms: the visits of one membership never count for the other
-- ============================================================================
select is(private.settle_engagement(pg_temp.m(6), pg_temp.id(1, 1), date '2026-03-16'), 0, 'the person''s gym A membership has no visit day (all their visits were at gym B): nothing is written');
select is((select count(*)::int from engagement_state where member_id = pg_temp.m(6)), 0, 'and no state row');
select is(private.settle_engagement(pg_temp.m(7), pg_temp.id(1, 2), date '2026-03-16'), 2, 'the gym B membership settles its own visits');
select is((select string_agg(e.subject_key || ':' || e.outcome || ':' || e.visits, ' ' order by e.subject_key) from private.effective_engagement_facts(pg_temp.m(7)) e), '2026-03-02:met:3 2026-03-09:missed:0', 'met in the first week, nothing in the second');
select is((select count(*)::int from private.effective_engagement_facts(pg_temp.m(6))), 0, 'the other membership of the same person has no fact');
select is(
  (select count(*)::int from private.engagement_evaluate_weeks(pg_temp.m(6), pg_temp.id(1, 1), date '2026-03-02', date '2026-03-09') e where e.visits <> 0),
  0, 'evaluating the gym A membership reads no gym B visit');
select is(
  (select count(*)::int from private.engagement_evaluate_weeks(pg_temp.m(7), pg_temp.id(1, 1), date '2026-03-02', date '2026-03-09') e where e.visits <> 0),
  0, 'and evaluating a member with the wrong gym id reads nothing');

select * from finish();
rollback;
