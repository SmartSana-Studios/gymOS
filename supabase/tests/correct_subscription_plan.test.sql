-- Story 27.4: public.correct_subscription_plan (migration 0176). The database half of UX AD-31, refusal states F1 to F12.
--
-- Proves: the signature and privileges; the role and gym matrix (Owner, Supervisor, Manager succeed; Receptionist, Coach, a member, another gym's
-- Owner and a missing member are refused with "permission denied"); the expiry arithmetic (start_date + the new plan's duration + the reward days
-- already granted on THAT row, Monthly <-> Annual both ways, a row that earned a reward, Pay-per-session in and out, a result already past, a
-- status that moves BACKWARDS); every refusal with its code, JSON detail and the refusal ORDER; that a refused call changes nothing; that a
-- correction touches nothing but the subscription row and one audit row (payments, refunds, notifications, loyalty, guest sessions, attendance,
-- session attempts, front-desk alerts, start_date, the registration fee); that the next lifecycle job run changes nothing; GymOS Support (step-up
-- single use and bound to the member, the proxy actor, "GymOS Support", every refusal of a not-live caller); the lock order in the body; and tenant
-- isolation of the corrected row (a member of another gym reads neither the old nor the new plan).
--
-- Fixture ids: 00000000-0000-0000-0000-00000027[6c-6f]nn. Gyms 276cnn (01 A, 02 B, 03 suspended), users 276dnn, members 276enn, plans 276fnm.

begin;
select plan(121);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000276c' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000276d' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000276e' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.s(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000276f' || lpad(to_hex(n), 2, '0'))::uuid $f$;
-- plans: 1 Monthly (30), 2 Annual (365), 3 Drop-in (PPS), 4 Drop-in 2 (PPS), 5 Quarterly (90) of A; 6 Monthly of B; 7 Monthly of S
create function pg_temp.p(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000276fa' || to_hex(n))::uuid $f$;

create function pg_temp.lapse(n int) returns text language sql security definer as $f$ select private.gym_local_date(pg_temp.g(1), min(usable_until))::text from guest_sessions where member_id = pg_temp.m(n) $f$;
create function pg_temp.gt(n int) returns date language sql security definer as $f$ select private.gym_today(pg_temp.g(n)) $f$;
create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;
create function pg_temp.sup_claims(p_gym uuid, p_aal text default 'aal2', p_session text default '00000000-0000-0000-0000-00000027feb1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-00000027fe08', 'role', 'authenticated', 'aal', p_aal, 'session_id', p_session,
                      'app_role', 'support', 'gym_id', p_gym)::text, true);
end $f$;
-- the correction as jsonb: {"ok": row} or {"error": "sqlstate:message", "detail": text}. Runs as the caller (SECURITY INVOKER); the
-- exception block is a subtransaction, so a refusal rolls back anything the call did (the consumed step-up included), as a failed RPC does.
create function pg_temp.ccp(p_member uuid, p_plan uuid, p_reason text default 'Wrong plan chosen at sign-up', p_sub uuid default null) returns jsonb language plpgsql as $f$
declare r record; d text;
begin
  select * into r from public.correct_subscription_plan(p_member, p_plan, p_reason, p_sub);
  return jsonb_build_object('ok', to_jsonb(r));
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm, 'detail', d);
end $f$;
create function pg_temp.code(j jsonb) returns text language sql immutable as $f$ select coalesce(j ->> 'error', 'ok') $f$;
create function pg_temp.det(j jsonb) returns jsonb language sql immutable as $f$ select (j ->> 'detail')::jsonb $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000276c01', 'CCP Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone, grace_period_days, registration_fee, charge_guests_per_session) values
  (pg_temp.g(1), 'CCP Gym A', '00000000-0000-0000-0000-000000276c01', 'active',    'Africa/Douala', 3, 0, true),
  (pg_temp.g(2), 'CCP Gym B', '00000000-0000-0000-0000-000000276c01', 'active',    'Africa/Douala', 3, 0, false),
  (pg_temp.g(3), 'CCP Gym S', '00000000-0000-0000-0000-000000276c01', 'suspended', 'Africa/Douala', 3, 0, false);
insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'ccp-' || n || '@x.example', now() from generate_series(1, 90) n;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-00000027fe08', 'ccp-support@gymosapps.com', now());

-- Staff: 1 Owner A, 2 Supervisor A, 3 Manager A, 4 Receptionist A, 5 Coach A, 6 Owner B, 7 Owner S, 8 Receptionist S
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, 'CCP Staff ' || s.n, '+2376002768' || lpad(s.n::text, 2, '0')
from (values (1, pg_temp.g(1), 'owner'), (2, pg_temp.g(1), 'supervisor'), (3, pg_temp.g(1), 'manager'), (4, pg_temp.g(1), 'receptionist'),
             (5, pg_temp.g(1), 'coach'), (6, pg_temp.g(2), 'owner'), (7, pg_temp.g(3), 'owner'), (8, pg_temp.g(3), 'receptionist')) as s(n, gym, role);

insert into plans (id, gym_id, name, plan_type, price, billing_interval, annual_discount_percent, duration_days) values
  (pg_temp.p(1), pg_temp.g(1), 'CCP Monthly',   'monthly',         25000,  'monthly', null, 30),
  (pg_temp.p(2), pg_temp.g(1), 'CCP Annual',    'monthly',         250000, 'annual',  15,   365),
  (pg_temp.p(3), pg_temp.g(1), 'CCP Drop-in',   'pay_per_session', 2000,   'monthly', null, null),
  (pg_temp.p(4), pg_temp.g(1), 'CCP Drop-in 2', 'pay_per_session', 3000,   'monthly', null, null),
  (pg_temp.p(5), pg_temp.g(1), 'CCP Quarterly', 'monthly',         60000,  'monthly', null, 90),
  (pg_temp.p(6), pg_temp.g(2), 'CCP Monthly B', 'monthly',         25000,  'monthly', null, 30),
  (pg_temp.p(7), pg_temp.g(3), 'CCP Monthly S', 'monthly',         25000,  'monthly', null, 30),
  (pg_temp.p(8), pg_temp.g(3), 'CCP Annual S',  'monthly',         250000, 'annual',  0,    365);

-- Members of A, n = 10..79, each on the Annual plan started 10 days ago (the default); the cases below change what they need.
insert into members (id, gym_id, user_id, role, name, phone, deactivated_at)
select pg_temp.m(n), pg_temp.g(1), pg_temp.u(n), 'member', 'CCP Member ' || n, '+2376012768' || lpad(n::text, 2, '0'), case when n = 19 then now() - interval '3 days' end
from generate_series(10, 79) n;
-- B: 80. S: 81.
insert into members (id, gym_id, user_id, role, name, phone) values
  (pg_temp.m(80), pg_temp.g(2), pg_temp.u(80), 'member', 'CCP Member 80', '+237601276880'),
  (pg_temp.m(81), pg_temp.g(3), pg_temp.u(81), 'member', 'CCP Member 81', '+237601276881');
-- subscription id of member n: s(n). Member 31 has none.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
select pg_temp.s(n), pg_temp.g(1), pg_temp.m(n), pg_temp.p(2), 'active', pg_temp.gt(1) - 10, pg_temp.gt(1) - 10 + 365, now()
from generate_series(10, 79) n where n <> 31;
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  (pg_temp.s(80), pg_temp.g(2), pg_temp.m(80), pg_temp.p(6), 'active', pg_temp.gt(2) - 10, pg_temp.gt(2) - 10 + 30, now()),
  (pg_temp.s(81), pg_temp.g(3), pg_temp.m(81), pg_temp.p(7), 'active', pg_temp.gt(3) - 10, pg_temp.gt(3) - 10 + 365, now());

-- change a member's row: plan, start offset (days from the gym's today), expiry offset (null for Pay-per-session), status
create function pg_temp.setsub(n int, plan_n int, start_off int, expiry_off int, st text) returns void language sql as $f$
  update subscriptions set plan_id = pg_temp.p(plan_n), start_date = pg_temp.gt(1) + start_off,
         expiry_date = case when expiry_off is null then null else pg_temp.gt(1) + expiry_off end, status = st::subscription_status
  where id = pg_temp.s(n) $f$;
select pg_temp.setsub(11, 1, -10, 20, 'active');            -- Monthly -> Annual
select pg_temp.setsub(12, 1, -10, 20 + 7, 'active');        -- Monthly with a 7-day reward already inside the expiry
select pg_temp.setsub(13, 3, -10, null, 'active');          -- Pay-per-session -> Monthly
select pg_temp.setsub(14, 1, -10, 20, 'active');            -- Monthly -> Pay-per-session
select pg_temp.setsub(15, 2, -100, 265, 'active');          -- Annual started 100 days ago -> Monthly: already expired
select pg_temp.setsub(16, 2, -31, 334, 'active');           -- Annual started 31 days ago -> Monthly: expiry yesterday, grace
select pg_temp.setsub(17, 2, -25, 340, 'active');           -- Annual started 25 days ago -> Monthly: expires in 5 days
select pg_temp.setsub(18, 1, -100, -70, 'expired');         -- an EXPIRED Monthly row -> Annual: active again
-- reward events: this row earned 7 days; another row earned 5; a guest-counter event; one with no subscription key
insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, details) values
  (pg_temp.g(1), pg_temp.m(12), 'reward_granted', 'subscriber', gen_random_uuid(), jsonb_build_object('subscription_id', pg_temp.s(12), 'reward_days', 7)),
  (pg_temp.g(1), pg_temp.m(12), 'reward_granted', 'subscriber', gen_random_uuid(), jsonb_build_object('subscription_id', gen_random_uuid(), 'reward_days', 5)),
  (pg_temp.g(1), pg_temp.m(12), 'reward_granted', 'guest',      gen_random_uuid(), jsonb_build_object('subscription_id', pg_temp.s(12), 'reward_days', 3)),
  (pg_temp.g(1), pg_temp.m(12), 'stamp_earned',   'subscriber', gen_random_uuid(), jsonb_build_object('subscription_id', pg_temp.s(12)));

-- member 51: a Monthly row with a 7-day reward, corrected to Pay-per-session and back (the audit row must not claim days that were not applied)
select pg_temp.setsub(51, 1, -10, 20 + 7, 'active');
insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, details) values
  (pg_temp.g(1), pg_temp.m(51), 'reward_granted', 'subscriber', gen_random_uuid(), jsonb_build_object('subscription_id', pg_temp.s(51), 'reward_days', 7));

-- Payments (by member number): 20 verified, 21 pending, 22 processing, 23 partly refunded, 24 flagged, 25 two (the pending one is more recent),
-- 26 voided, 27 fully refunded, 28 unlinked verified (owner decision 3), 29 registration fee, 30 session payment
create function pg_temp.pay(p_n int, p_status text, p_amount int, p_method text, p_linked boolean, p_purpose text default 'subscription', p_age interval default interval '0',
                            p_flag text default null, p_void boolean default false) returns uuid language sql as $f$
  insert into payments (gym_id, member_id, subscription_id, amount, method, status, purpose, created_at, flagged_reason, voided_at)
  values (pg_temp.g(1), pg_temp.m(p_n), case when p_linked then pg_temp.s(p_n) end, p_amount, p_method, p_status::payment_status, p_purpose, now() - p_age, p_flag,
          case when p_void then now() end)
  returning id $f$;
select pg_temp.pay(20, 'verified',   250000, 'cash', true);
select pg_temp.pay(21, 'pending',    250000, 'cash', true);
select pg_temp.pay(22, 'processing', 250000, 'mobile_money', true);
select pg_temp.pay(23, 'verified',   250000, 'cash', true);
select pg_temp.pay(24, 'flagged',    250000, 'mobile_money', true, 'subscription', interval '0', 'staff_flagged');
select pg_temp.pay(25, 'verified',   250000, 'cash', true, 'subscription', interval '2 days');
select pg_temp.pay(25, 'pending',    250000, 'mobile_money', true, 'subscription', interval '1 day');
select pg_temp.pay(26, 'verified',   250000, 'cash', true, 'subscription', interval '0', null, true);
select pg_temp.pay(27, 'verified',   250000, 'cash', true);
select pg_temp.pay(28, 'verified',   250000, 'cash', false);
select pg_temp.pay(29, 'verified',   10000,  'cash', true, 'registration_fee');
select pg_temp.pay(30, 'verified',   2000,   'cash', true, 'session');
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  (pg_temp.g(1), (select id from payments where member_id = pg_temp.m(23)), 100000, 'partial refund', pg_temp.u(1)),
  (pg_temp.g(1), (select id from payments where member_id = pg_temp.m(27)), 250000, 'full refund',    pg_temp.u(1));

-- Sessions (by member number): 32 held, going to Pay-per-session; 33 Pay-per-session holding one, going to Monthly; 34 Monthly holding one, going to
-- Annual (no crossing); 35 a FREE session only; 36 a consumed one; 37 a voided one; 38 one that already lapsed; 39 Pay-per-session holding one, going
-- to another Pay-per-session plan; 40 two held sessions (the soonest lapse is named)
select pg_temp.setsub(32, 1, -10, 20, 'active');
select pg_temp.setsub(33, 3, -10, null, 'active');
select pg_temp.setsub(34, 1, -10, 20, 'active');
select pg_temp.setsub(35, 1, -10, 20, 'active');
select pg_temp.setsub(36, 1, -10, 20, 'active');
select pg_temp.setsub(37, 1, -10, 20, 'active');
select pg_temp.setsub(38, 1, -10, 20, 'active');
select pg_temp.setsub(39, 3, -10, null, 'active');
select pg_temp.setsub(40, 1, -10, 20, 'active');
create function pg_temp.held(p_n int, p_until interval, p_consumed boolean default false, p_voided boolean default false) returns void language plpgsql as $f$
declare v_pay uuid;
begin
  insert into payments (gym_id, member_id, amount, method, status, purpose) values (pg_temp.g(1), pg_temp.m(p_n), 2000, 'cash', 'verified', 'session') returning id into v_pay;
  insert into guest_sessions (gym_id, member_id, payment_id, usable_until, consumed_at, covered_day, voided_at)
  values (pg_temp.g(1), pg_temp.m(p_n), v_pay, now() + p_until, case when p_consumed then now() end, case when p_consumed then pg_temp.gt(1) end, case when p_voided then now() end);
end $f$;
select pg_temp.held(32, interval '5 days');
select pg_temp.held(33, interval '5 days');
select pg_temp.held(34, interval '5 days');
select pg_temp.held(36, interval '5 days', true);
select pg_temp.held(37, interval '5 days', false, true);
select pg_temp.held(38, interval '-1 day');
select pg_temp.held(39, interval '5 days');
select pg_temp.held(40, interval '9 days');
select pg_temp.held(40, interval '3 days');
do $free$
declare v_ev uuid;
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, details)
  values (pg_temp.g(1), pg_temp.m(35), 'reward_granted', 'guest', gen_random_uuid(), '{}'::jsonb) returning id into v_ev;
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until) values (pg_temp.g(1), pg_temp.m(35), v_ev, now() + interval '5 days');
end
$free$;

-- Support: a live support person for gym A (assigned, switch on, aal2 session).
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-00000027fe08', now());
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-00000027fe61', '00000000-0000-0000-0000-00000027fe08', pg_temp.g(1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-00000027feb1', '00000000-0000-0000-0000-00000027fe08', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-00000027feb1', '00000000-0000-0000-0000-00000027fe08', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-00000027fe61', true);

-- A snapshot of everything a correction must not touch (whole tables: the fixture is small), and the member's own row.
create function pg_temp.snap() returns text language sql as $f$
  select md5(concat_ws('#',
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from payments x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from refunds x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from notifications x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from loyalty_events x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from loyalty_progress x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from guest_sessions x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from attendance_events x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from session_attempts x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from front_desk_alerts x),
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from members x))) $f$;
create temp table snaps (k text primary key, v text);
grant all on snaps to public;

-- ============================================================================
-- (1) Shape, privileges, registry, lock order in the body
-- ============================================================================
select is((select pg_get_function_arguments('public.correct_subscription_plan(uuid,uuid,text,uuid)'::regprocedure)),
          'p_member_id uuid, p_new_plan_id uuid, p_reason text, p_subscription_id uuid DEFAULT NULL::uuid',
          'the signature: member, new plan, reason, and the one optional p_subscription_id (the stale-modal check)');
select is((select prosecdef from pg_proc where proname = 'correct_subscription_plan'), true, 'correct_subscription_plan is SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.correct_subscription_plan(uuid,uuid,text,uuid)', 'EXECUTE'), false, 'anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.correct_subscription_plan(uuid,uuid,text,uuid)', 'EXECUTE'), true, 'authenticated can execute it');
select is((select count(*)::int from private.support_capabilities where kind = 'rpc' and object_name = 'correct_subscription_plan'), 1, 'it is in the support registry');
select is((select count(*)::int from private.support_audit_actions where action_type = 'subscription_plan_corrected'), 1, 'its audit action is allowed for a support caller');
select ok((select position('for no key update' in prosrc) > 0
              and position('for no key update' in prosrc) < position('for update' in prosrc)
              and position('for update' in prosrc) < position('subscription_standing_payments' in prosrc)
              and position('private.support_stepup_require' in prosrc) < position('for no key update' in prosrc)
           from pg_proc where proname = 'correct_subscription_plan'),
          'the body locks the member first (FOR NO KEY UPDATE), then the subscription (FOR UPDATE), and only then reads the standing payments (AD-29)');
select ok((select prosrc !~* 'insert into|delete from|update (payments|refunds|notifications|loyalty|guest_sessions|attendance_events|session_attempts|front_desk_alerts)'
              and (select count(*) from regexp_matches(prosrc, 'update subscriptions', 'gi')) = 1
           from pg_proc where proname = 'correct_subscription_plan'),
          'the body writes one table (one UPDATE of subscriptions) and the audit row through log_audit_event, nothing else');
select ok((select prosrc !~ 'start_date\s*=' from pg_proc where proname = 'correct_subscription_plan'), 'the UPDATE never assigns start_date');

-- ============================================================================
-- (2) Roles and gyms
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(5), pg_temp.g(1), 'coach');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(10), pg_temp.p(1))), 'P0001:permission denied', 'a Coach is refused');
select pg_temp.claims(pg_temp.u(4), pg_temp.g(1), 'receptionist');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(10), pg_temp.p(1))), 'P0001:permission denied', 'a Receptionist is refused');
select pg_temp.claims(pg_temp.u(10), pg_temp.g(1), 'member');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(10), pg_temp.p(1))), 'P0001:permission denied', 'a member is refused (even for their own subscription)');
select pg_temp.claims(pg_temp.u(6), pg_temp.g(2), 'owner');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(10), pg_temp.p(1))), 'P0001:permission denied', 'another gym''s Owner is refused');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(10), pg_temp.p(6))), 'P0001:permission denied', 'another gym''s Owner is refused even with their own gym''s plan');
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(80), pg_temp.p(1))), 'P0001:permission denied', 'an Owner naming another gym''s member is refused (no existence oracle)');
select is(pg_temp.code(pg_temp.ccp('00000000-0000-0000-0000-000000000000', pg_temp.p(1))), 'P0001:permission denied', 'a missing member id gets the same answer');
reset role;
select is((select count(*)::int from audit_log where action_type = 'subscription_plan_corrected' and gym_id = pg_temp.g(1)), 0, 'none of the refusals wrote an audit row');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select * from public.correct_subscription_plan('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'x', null)$$, '42501', null, 'the anon role is refused outright');
reset role;

-- ============================================================================
-- (3) Success by role: Owner (member 10), Supervisor (41), Manager (42, 19)
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is(pg_temp.ccp(pg_temp.m(10), pg_temp.p(1)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'an Owner corrects Annual to Monthly');
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'supervisor');
select is(pg_temp.ccp(pg_temp.m(41), pg_temp.p(1)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'a Supervisor corrects a plan');
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.ccp(pg_temp.m(42), pg_temp.p(1)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'a Manager corrects a plan');
select is(pg_temp.ccp(pg_temp.m(19), pg_temp.p(1)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'a deactivated member is correctable (as the UX states)');
reset role;

-- ============================================================================
-- (4) The expiry arithmetic
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
-- Annual -> Monthly, no reward: start + 30. Member 10 was corrected above.
reset role;
select is((select start_date::text || '|' || expiry_date::text || '|' || status::text from subscriptions where id = pg_temp.s(10)),
          (pg_temp.gt(1) - 10)::text || '|' || (pg_temp.gt(1) - 10 + 30)::text || '|active', 'Annual to Monthly lands exactly on start_date + 30; start_date unchanged; status by the function');
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is(pg_temp.ccp(pg_temp.m(11), pg_temp.p(2)) -> 'ok' ->> 'expiry_date', (pg_temp.gt(1) - 10 + 365)::text, 'Monthly to Annual lands exactly on start_date + 365');
select is(pg_temp.ccp(pg_temp.m(12), pg_temp.p(2)) -> 'ok' ->> 'expiry_date', (pg_temp.gt(1) - 10 + 365 + 7)::text,
          'a row that earned a 7-day reward lands on start_date + 365 + 7 (only the reward on THIS row, only the subscriber counter, only reward_granted)');
select is(pg_temp.ccp(pg_temp.m(13), pg_temp.p(1)) -> 'ok' ->> 'expiry_date', (pg_temp.gt(1) - 10 + 30)::text, 'from Pay-per-session: uses the row''s recorded start_date');
select is(pg_temp.ccp(pg_temp.m(14), pg_temp.p(3)) -> 'ok', jsonb_build_object('subscription_id', pg_temp.s(14), 'plan_id', pg_temp.p(3), 'plan_name', 'CCP DROP-IN',
          'plan_type', 'pay_per_session', 'expiry_date', null, 'status', 'active'), 'to Pay-per-session: a NULL expiry and status active, and the call says so');
select is(pg_temp.ccp(pg_temp.m(15), pg_temp.p(1)) -> 'ok' ->> 'status', 'expired', 'a new expiry long past is saved as expired (the response says so)');
select is(pg_temp.ccp(pg_temp.m(16), pg_temp.p(1)) -> 'ok' ->> 'status', 'grace_period', 'a new expiry yesterday is saved as grace_period');
select is(pg_temp.ccp(pg_temp.m(17), pg_temp.p(1)) -> 'ok' ->> 'status', 'expiring_soon', 'a new expiry in 5 days is saved as expiring_soon');
select is(pg_temp.ccp(pg_temp.m(18), pg_temp.p(2)) -> 'ok' ->> 'status', 'active', 'an EXPIRED row corrected to a longer plan goes back to active (the one writer that moves a status backwards)');
reset role;
select is((select expiry_date::text from subscriptions where id = pg_temp.s(18)), (pg_temp.gt(1) - 100 + 365)::text, '... and its expiry is start_date + 365');
select is((select count(*)::int from subscriptions s join gyms g on g.id = s.gym_id
            where s.id in (pg_temp.s(10), pg_temp.s(11), pg_temp.s(12), pg_temp.s(13), pg_temp.s(14), pg_temp.s(15), pg_temp.s(16), pg_temp.s(17), pg_temp.s(18))
              and s.status is distinct from private.subscription_status_for(s.expiry_date, g.grace_period_days, pg_temp.gt(1))), 0,
          'every corrected row''s status equals private.subscription_status_for at the gym''s today');
select is((select count(*)::int from subscriptions where id = pg_temp.s(14) and plan_id = pg_temp.p(3) and expiry_date is null and status = 'active'), 1, 'the Pay-per-session row passes the 0018 plan/expiry trigger');

-- ============================================================================
-- (5) Refusals: code, detail, and that a refused call changes nothing
-- ============================================================================
insert into snaps values ('before_refusals', pg_temp.snap());
insert into snaps select 'sub_' || n, (select md5(s::text) from subscriptions s where s.id = pg_temp.s(n)) from generate_series(20, 40) n where n <> 31;
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');

-- F8: no current subscription
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(31), pg_temp.p(1))), 'P0001:no_current_subscription', 'F8: a member with no subscription');
-- F10: the modal showed another subscription
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), 'Wrong plan chosen', pg_temp.s(44))), 'P0001:subscription_changed', 'F10: p_subscription_id differs from the current subscription');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), 'Wrong plan chosen', gen_random_uuid())), 'P0001:subscription_changed', 'F10: an unknown subscription id');
-- F9: plan not in this gym, gone, or null
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(6))), 'P0001:plan_not_found', 'F9: another gym''s plan');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), gen_random_uuid())), 'P0001:plan_not_found', 'F9: a plan that does not exist (deleted meanwhile)');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), null)), 'P0001:plan_not_found', 'F9: a null plan');
-- F7: same plan
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(2))), 'P0001:same_plan', 'F7: the plan the member already has');
-- invalid reason
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), 'abcd')), 'P0001:invalid_reason', 'a 4-character reason');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), '   abcd   ')), 'P0001:invalid_reason', 'the reason is trimmed first (4 characters)');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), repeat('x', 301))), 'P0001:invalid_reason', 'a 301-character reason');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), '          ')), 'P0001:invalid_reason', 'a blank reason');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(1), null)), 'P0001:invalid_reason', 'a null reason');
-- F1-F5: a payment stands (the detail carries what the modal prints)
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), pg_temp.p(1))), 'P0001:payment_stands', 'F1: a verified payment stands');
select is((pg_temp.det(pg_temp.ccp(pg_temp.m(20), pg_temp.p(1))) - 'payment_id' - 'created_at' - 'on'), '{"state": "verified", "amount": 250000, "method": "cash", "refunded_amount": 0, "more": 0}'::jsonb,
          'F1: the detail has state, amount, method, refunded amount and no others');
select is(pg_temp.det(pg_temp.ccp(pg_temp.m(20), pg_temp.p(1))) ->> 'on', pg_temp.gt(1)::text, 'F1: the detail names the payment''s gym-local date');
select is(pg_temp.det(pg_temp.ccp(pg_temp.m(21), pg_temp.p(1))) ->> 'state', 'pending', 'F2: a pending payment');
select is(pg_temp.det(pg_temp.ccp(pg_temp.m(22), pg_temp.p(1))) ->> 'state', 'in_flight', 'F3: a processing (Tara Money) payment');
select is((pg_temp.det(pg_temp.ccp(pg_temp.m(23), pg_temp.p(1))) ->> 'state') || ':' || (pg_temp.det(pg_temp.ccp(pg_temp.m(23), pg_temp.p(1))) ->> 'refunded_amount'), 'partly_refunded:100000',
          'F4: a partly refunded payment, with the refunded amount');
select is(pg_temp.det(pg_temp.ccp(pg_temp.m(24), pg_temp.p(1))) ->> 'state', 'pending', 'a flagged payment stands and uses the pending text (F2)');
select is((pg_temp.det(pg_temp.ccp(pg_temp.m(25), pg_temp.p(1))) ->> 'state') || ':' || (pg_temp.det(pg_temp.ccp(pg_temp.m(25), pg_temp.p(1))) ->> 'more'), 'pending:1',
          'F5: the most recent standing payment is named and one more is counted');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(28), pg_temp.p(1))), 'P0001:payment_stands', 'owner decision 3: an unlinked verified payment created after the row stands');
-- they do NOT stand
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(26), pg_temp.p(1))), 'ok', 'a voided payment does not block');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(27), pg_temp.p(1))), 'ok', 'a fully refunded payment does not block');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(29), pg_temp.p(1))), 'ok', 'a registration-fee payment is not a standing payment of the subscription');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(30), pg_temp.p(1))), 'ok', 'a session payment is not a standing payment of the subscription');
-- F6: unused paid session across the Pay-per-session boundary
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(32), pg_temp.p(3))), 'P0001:session_held', 'F6: a Monthly member holding an unused paid session cannot go to Pay-per-session');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(33), pg_temp.p(1))), 'P0001:session_held', 'F6: a Pay-per-session member holding one cannot go to Monthly');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(34), pg_temp.p(2))), 'ok', 'a session held does not block a move that does not cross the boundary (Monthly to Annual)');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(35), pg_temp.p(3))), 'ok', 'a free (loyalty) session does not block');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(36), pg_temp.p(3))), 'ok', 'a consumed session does not block');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(37), pg_temp.p(3))), 'ok', 'a voided (refunded) session does not block');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(38), pg_temp.p(3))), 'ok', 'a lapsed session does not block');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(39), pg_temp.p(4))), 'ok', 'Pay-per-session to another Pay-per-session plan does not cross the boundary');
select is(pg_temp.det(pg_temp.ccp(pg_temp.m(40), pg_temp.p(3))) ->> 'lapses_on', pg_temp.lapse(40),
          'F6: the detail names the SOONEST lapse date');
-- the refusal order (epic 27.4): no subscription, stale id, plan gone, same plan, payment stands, session held, reason
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(31), pg_temp.p(6), 'x', pg_temp.s(44))), 'P0001:no_current_subscription', 'order: no subscription before a stale id and a foreign plan');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(43), pg_temp.p(6), 'x', pg_temp.s(44))), 'P0001:subscription_changed', 'order: a stale id before plan_not_found');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), gen_random_uuid(), 'x')), 'P0001:plan_not_found', 'order: plan_not_found before a standing payment');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), pg_temp.p(2), 'x')), 'P0001:same_plan', 'order: same_plan before a standing payment');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), pg_temp.p(1), 'x')), 'P0001:payment_stands', 'order: a standing payment before the reason');
select pg_temp.setsub(40, 1, -10, 20, 'active');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(40), pg_temp.p(3), 'x')), 'P0001:session_held', 'order: a held session before the reason');
reset role;
-- payment_stands before session_held: give member 20 a held session too (member 20 is Annual -> PPS crosses the boundary)
select pg_temp.held(20, interval '5 days');
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), pg_temp.p(3))), 'P0001:payment_stands', 'order: a standing payment before a held session');
reset role;

-- nothing changed for the refused members (the row as it was before any refusal)
create function pg_temp.sk(n int) returns text language sql as $f$ select md5(s::text) from subscriptions s where s.id = pg_temp.s(n) $f$;
select is((select count(*)::int from unnest(array[20, 21, 22, 23, 24, 25, 28, 32, 33]) n where pg_temp.sk(n) is distinct from (select v from snaps where k = 'sub_' || n)), 0,
          'a refused call leaves the subscription row exactly as it was (nine refused members)');
select is((select count(*)::int from audit_log where action_type = 'subscription_plan_corrected' and target_entity_id in
            (select pg_temp.m(n)::text from unnest(array[20, 21, 22, 23, 24, 25, 28, 31, 32, 33, 43]) n)), 0,
          'a refused call writes no audit row');

-- ============================================================================
-- (6) What a correction must not touch, and the one audit row
-- ============================================================================
-- member 50 has a row in every neighbouring table; the whole-table snapshots must be identical after the correction
insert into notifications (member_id, gym_id, type, title, body) values (pg_temp.m(50), pg_temp.g(1), 'N-03', 'Expired', 'Your membership expired');
insert into loyalty_progress (gym_id, member_id, guest_stamps, subscriber_stamps) values (pg_temp.g(1), pg_temp.m(50), 2, 3);
insert into attendance_events (gym_id, member_id, visit_day) values (pg_temp.g(1), pg_temp.m(50), pg_temp.gt(1));
insert into session_attempts (gym_id, member_id) values (pg_temp.g(1), pg_temp.m(50));
insert into front_desk_alerts (gym_id, member_id, kind) values (pg_temp.g(1), pg_temp.m(50), 'session_required');
select pg_temp.pay(50, 'verified', 10000, 'cash', true, 'registration_fee');
select pg_temp.held(50, interval '5 days');          -- an unused paid session (Annual to Monthly does not cross the boundary)
update members set registration_fee_settled_at = now() - interval '9 days' where id = pg_temp.m(50);
select pg_temp.setsub(50, 2, -10, 355, 'active');
insert into snaps values ('side_before', pg_temp.snap());
insert into snaps values ('member50_before', (select md5(m::text) from members m where id = pg_temp.m(50)));

set local role authenticated;
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.ccp(pg_temp.m(50), pg_temp.p(1), '  Wrong plan chosen at sign-up  ', pg_temp.s(50)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'the correction succeeds (with the right p_subscription_id)');
select pg_temp.claims(pg_temp.u(6), pg_temp.g(2), 'owner');
select is((select count(*)::int from subscriptions where id = pg_temp.s(50)), 0, 'RLS: another gym''s staff cannot read the corrected row');
select pg_temp.claims(pg_temp.u(80), pg_temp.g(2), 'member');
select is((select count(*)::int from subscriptions where id = pg_temp.s(50)) + (select count(*)::int from plans where id in (pg_temp.p(1), pg_temp.p(2))), 0,
          'RLS: a member of another gym reads neither the old nor the new plan, nor the row');
select pg_temp.claims(pg_temp.u(50), pg_temp.g(1), 'member');
select is((select plan_id from subscriptions where member_id = pg_temp.m(50)), pg_temp.p(1), 'the member''s own existing read returns the new plan (no mobile change)');
reset role;

select is(pg_temp.snap(), (select v from snaps where k = 'side_before'),
          'payments, refunds, notifications, loyalty_events, loyalty_progress, guest_sessions, attendance_events, session_attempts, front_desk_alerts and members are byte-identical after a correction');
select is((select md5(m::text) from members m where id = pg_temp.m(50)), (select v from snaps where k = 'member50_before'), 'the member row (registration fee settlement included) is untouched');
select is((select start_date from subscriptions where id = pg_temp.s(50)), pg_temp.gt(1) - 10, 'start_date is unchanged');
select is((select count(*)::int from subscriptions where member_id = pg_temp.m(50)), 1, 'no new subscription row was inserted');
select is((select count(*)::int from audit_log where target_entity_id = pg_temp.m(50)::text and action_type = 'subscription_plan_corrected'), 1, 'exactly one audit row');
select is((select count(*)::int from audit_log where target_entity_id = pg_temp.m(50)::text and action_type not in ('subscription_plan_corrected', 'session_attempt_blocked')), 0,
          'and no other audit row (no stamp, no reward, no notification event; the one session_attempt_blocked row is the fixture''s own attempt row)');
select is((select metadata from audit_log where target_entity_id = pg_temp.m(50)::text and action_type = 'subscription_plan_corrected'),
          jsonb_build_object('member_id', pg_temp.m(50), 'subscription_id', pg_temp.s(50),
                             'old_plan_id', pg_temp.p(2), 'new_plan_id', pg_temp.p(1), 'old_plan_name', 'CCP ANNUAL', 'new_plan_name', 'CCP MONTHLY',
                             'old_price', 250000, 'new_price', 25000,
                             'old_expiry_date', (pg_temp.gt(1) + 355)::text, 'new_expiry_date', (pg_temp.gt(1) - 10 + 30)::text,
                             'old_status', 'active', 'new_status', 'active',
                             'basis_start_date', (pg_temp.gt(1) - 10)::text, 'loyalty_days_added', 0, 'reason', 'Wrong plan chosen at sign-up'),
          'the audit row carries both plans (id and name), both prices, both expiries, both statuses, the basis start date, the loyalty days and the trimmed reason');
select is((select actor_id::text || ':' || gym_id::text || ':' || target_entity_type from audit_log where target_entity_id = pg_temp.m(50)::text and action_type = 'subscription_plan_corrected'),
          pg_temp.u(3)::text || ':' || pg_temp.g(1)::text || ':member', 'the audit row names the Manager, the gym and the member');
-- a refused call also leaves everything alone
insert into snaps values ('refused_before', pg_temp.snap());
set local role authenticated;
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), pg_temp.p(1))), 'P0001:payment_stands', 'control: a refusal');
reset role;
select is(pg_temp.snap(), (select v from snaps where k = 'refused_before'), 'a refusal leaves every neighbouring table identical');
-- the reward: a granted reward is kept, and the audit row says how many days
set local role authenticated;
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(12), pg_temp.p(5), 'Quarterly was the right plan')), 'ok', 'control: member 12 is corrected again, from Annual to Quarterly');
reset role;
select is((select (metadata ->> 'loyalty_days_added')::int from audit_log where target_entity_id = pg_temp.m(12)::text and action_type = 'subscription_plan_corrected' order by created_at desc limit 1), 7,
          'the audit row records the 7 reward days that were kept');
select is((select expiry_date from subscriptions where id = pg_temp.s(12)), pg_temp.gt(1) - 10 + 90 + 7, 'and the row''s expiry still includes them');

-- a Pay-per-session target applies no reward days, so the audit row says 0; the reward rows stay, so moving back re-adds them
set local role authenticated;
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.ccp(pg_temp.m(51), pg_temp.p(3), 'Pay per visit is the right plan') -> 'ok' ->> 'expiry_date', null, 'a reward row and a Pay-per-session target: the expiry is NULL');
reset role;
select is((select (metadata ->> 'loyalty_days_added')::int from audit_log where target_entity_id = pg_temp.m(51)::text and action_type = 'subscription_plan_corrected' and metadata ->> 'new_plan_id' = pg_temp.p(3)::text), 0,
          'the audit row of a Pay-per-session correction records 0 loyalty days (none were applied)');
select is((select count(*)::int from loyalty_events where member_id = pg_temp.m(51) and event_type = 'reward_granted'), 1, 'the reward row is still there');
set local role authenticated;
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.ccp(pg_temp.m(51), pg_temp.p(1), 'Back to the monthly plan') -> 'ok' ->> 'expiry_date', (pg_temp.gt(1) - 10 + 30 + 7)::text, 'moving back to a dated plan re-adds the 7 reward days');
reset role;
select is((select (metadata ->> 'loyalty_days_added')::int from audit_log where target_entity_id = pg_temp.m(51)::text and action_type = 'subscription_plan_corrected' and metadata ->> 'new_plan_id' = pg_temp.p(1)::text), 7,
          'and the audit row of the move back records 7');

-- ============================================================================
-- (7) The next lifecycle job run changes nothing for a corrected row and sends nothing
-- ============================================================================
insert into snaps select 'job_' || n, pg_temp.sk(n) from unnest(array[10, 11, 14, 15, 16, 17, 18, 50]) n;
select is((select count(*)::int from notifications where member_id in (select pg_temp.m(n) from unnest(array[10, 11, 14, 15, 16, 17, 18]) n)), 0, 'fixture: no notification exists for the corrected members');
select lives_ok($$ select run_subscription_lifecycle_job() $$, 'the real lifecycle job runs after the corrections');
select is((select count(*)::int from unnest(array[10, 11, 14, 15, 16, 17, 18, 50]) n where pg_temp.sk(n) is distinct from (select v from snaps where k = 'job_' || n)), 0,
          'the job changed none of the eight corrected rows (expired, grace_period, expiring_soon, active, Pay-per-session)');
select is((select count(*)::int from notifications where member_id in (select pg_temp.m(n) from unnest(array[10, 11, 14, 15, 16, 17, 18, 50]) n) and created_at > now() - interval '1 minute'
            and not (member_id = pg_temp.m(50))), 0, 'and it sent nothing to them');

-- ============================================================================
-- (8) GymOS Support
-- ============================================================================
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.ccp(pg_temp.m(60), pg_temp.p(1)) ->> 'error', 'P0001:step_up_required: support_correct_plan needs a valid single-use step-up for this subject', 'support without a step-up: step_up_required');
reset role;
select private.stepup_issue('00000000-0000-0000-0000-00000027fe08', 'support_correct_plan', pg_temp.m(61)::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.ccp(pg_temp.m(60), pg_temp.p(1)) ->> 'error', 'P0001:step_up_required: support_correct_plan needs a valid single-use step-up for this subject', 'a grant bound to another member does not cover this one');
reset role;
select private.stepup_issue('00000000-0000-0000-0000-00000027fe08', 'support_correct_plan', pg_temp.m(62)::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.ccp(pg_temp.m(62), pg_temp.p(1)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'support with its step-up corrects the plan as a Supervisor');
select is(pg_temp.ccp(pg_temp.m(62), pg_temp.p(5)) ->> 'error', 'P0001:step_up_required: support_correct_plan needs a valid single-use step-up for this subject', 'the grant is single use');
reset role;
select is((select count(*)::int from audit_log where action_type = 'subscription_plan_corrected' and target_entity_id = pg_temp.m(62)::text
            and actor_display_name = 'GymOS Support' and actor_id = (select id from users where support_proxy_gym_id = pg_temp.g(1))), 1,
          'the audit row names "GymOS Support" and the per-gym proxy');
select is((select count(*)::int from support_action_identity i join audit_log a on a.id = i.subject_id and i.subject_table = 'audit_log'
            where a.action_type = 'subscription_plan_corrected' and a.target_entity_id = pg_temp.m(62)::text and i.real_user_id = '00000000-0000-0000-0000-00000027fe08'), 1,
          'the real person is recorded privately through the audit row (the gym never sees it)');
select is((select count(*)::int from audit_log where action_type = 'subscription_plan_corrected' and (actor_id = '00000000-0000-0000-0000-00000027fe08' or metadata::text like '%27fe08%')), 0,
          'no audit row carries the real support identity');
-- a refusal does not spend the grant (the whole call rolls back)
select private.stepup_issue('00000000-0000-0000-0000-00000027fe08', 'support_correct_plan', pg_temp.m(20)::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(20), pg_temp.p(1))), 'P0001:payment_stands', 'support is refused like any caller when a payment stands');
reset role;
select is((select count(*)::int from private.support_stepup where subject_id = pg_temp.m(20)::text and action = 'support_correct_plan' and consumed_at is null), 1,
          'the refused call did not consume the grant');
-- every refusal of a support caller that is not live (a valid grant for member 63 is held throughout)
select private.stepup_issue('00000000-0000-0000-0000-00000027fe08', 'support_correct_plan', pg_temp.m(63)::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1), 'aal1');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(63), pg_temp.p(1))), 'P0001:permission denied', 'an AAL1 support session is refused');
select pg_temp.sup_claims(pg_temp.g(2));
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(63), pg_temp.p(1))), 'P0001:permission denied', 'a support person not assigned to the gym is refused');
select pg_temp.sup_claims(pg_temp.g(1), 'aal2', '00000000-0000-0000-0000-00000027feb9');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(63), pg_temp.p(1))), 'P0001:permission denied', 'a session the gate has never seen is refused');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(63), pg_temp.p(1))), 'P0001:permission denied', 'the Owner''s switch off refuses support on the next request');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-00000027fe61';
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(63), pg_temp.p(1))), 'P0001:permission denied', 'a revoked (no longer active) assignment is refused');
reset role;
update public.support_assignments set state = 'active' where id = '00000000-0000-0000-0000-00000027fe61';
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.ccp(pg_temp.m(63), pg_temp.p(1)) -> 'ok' ->> 'plan_name', 'CCP MONTHLY', 'restored: the same grant still works (the refusals did not spend it)');
reset role;

-- ============================================================================
-- (9) A suspended gym, and the role check coming first
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(7), pg_temp.g(3), 'owner');
select is(pg_temp.ccp(pg_temp.m(81), pg_temp.p(8)) ->> 'error', 'P0001:correct_subscription_plan: gym ' || pg_temp.g(3) || ' is not active', 'a suspended gym''s Owner is refused with the shipped exception');
select pg_temp.claims(pg_temp.u(8), pg_temp.g(3), 'receptionist');
select is(pg_temp.code(pg_temp.ccp(pg_temp.m(81), pg_temp.p(8))), 'P0001:permission denied', 'a wrong role at a suspended gym learns nothing about the gym state (role check first)');
reset role;
select is((select plan_id from subscriptions where id = pg_temp.s(81)), pg_temp.p(7), 'the suspended gym''s subscription is unchanged');

select * from finish();
rollback;
