-- Story 27.4: public.correct_plan_eligibility (migration 0176) and the one standing-payment definition it shares with
-- correct_subscription_plan, private.subscription_standing_payments.
--
-- Proves: the signature and privileges; the role and gym matrix (Owner, Supervisor, Manager see the row; Receptionist, Coach, a member and another
-- gym's Owner get the same empty result as a missing member); the current-subscription columns; every state of the "stands" rule (verified,
-- pending, flagged, processing, partly refunded; voided and fully refunded do not stand), the most recent standing payment and the count of the
-- others, a payment that belongs to the subscription by the late link and one that does not (unlinked, owner decision 2026-11-18), registration
-- fee and session payments that never count, an earlier subscription's payment that does not block the renewed row; the read is a pure read;
-- GymOS Support through the registry; a suspended gym.
--
-- Fixture ids: 00000000-0000-0000-0000-00000027[67-69]nn. Gyms 2767nn (01 A, 02 B, 03 suspended), users 2768nn, members 2769nn, plans 276anm.

begin;
select plan(59);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002767' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002768' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002769' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;
create function pg_temp.sup_claims(p_gym uuid, p_aal text default 'aal2', p_session text default '00000000-0000-0000-0000-00000027eaa1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-00000027e008', 'role', 'authenticated', 'aal', p_aal, 'session_id', p_session,
                      'app_role', 'support', 'gym_id', p_gym)::text, true);
end $f$;
-- the eligibility row as jsonb (nulls kept), the empty result as 'none', or the error
create function pg_temp.elig(p_member uuid) returns jsonb language plpgsql as $f$
declare r record; n int := 0; j jsonb;
begin
  for r in select * from public.correct_plan_eligibility(p_member) loop n := n + 1; j := to_jsonb(r); end loop;
  if n = 0 then return '"none"'::jsonb; end if;
  return j;
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000276701', 'CPE Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone, grace_period_days, registration_fee) values
  (pg_temp.g(1), 'CPE Gym A', '00000000-0000-0000-0000-000000276701', 'active',    'Africa/Douala', 3, 0),
  (pg_temp.g(2), 'CPE Gym B', '00000000-0000-0000-0000-000000276701', 'active',    'Africa/Douala', 3, 0),
  (pg_temp.g(3), 'CPE Gym S', '00000000-0000-0000-0000-000000276701', 'suspended', 'Africa/Douala', 3, 0);
insert into auth.users (id, email, email_confirmed_at)
select pg_temp.u(n), 'cpe-' || n || '@x.example', now() from generate_series(1, 60) n;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-00000027e008', 'cpe-support@gymosapps.com', now());

-- Staff of A: 1 owner, 2 supervisor, 3 manager, 4 receptionist, 5 coach. Owner of B: 6. Owner of S: 7.
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, 'CPE Staff ' || s.n, '+2376002767' || lpad(s.n::text, 2, '0')
from (values (1, pg_temp.g(1), 'owner'), (2, pg_temp.g(1), 'supervisor'), (3, pg_temp.g(1), 'manager'), (4, pg_temp.g(1), 'receptionist'),
             (5, pg_temp.g(1), 'coach'), (6, pg_temp.g(2), 'owner'), (7, pg_temp.g(3), 'owner')) as s(n, gym, role);

-- Members of A (n = 10..): named by label below. Member of B: 40. Member of S: 41.
create function pg_temp.mem(label text) returns uuid language sql immutable as $f$
  select pg_temp.m(case label
    when 'unpaid' then 10 when 'verified' then 11 when 'pending' then 12 when 'processing' then 13 when 'partial' then 14 when 'flagged' then 15
    when 'multi' then 16 when 'voided' then 17 when 'refunded' then 18 when 'unlinked' then 19 when 'before' then 20 when 'fee' then 21
    when 'session' then 22 when 'nosub' then 23 when 'renewed' then 24 when 'deact' then 25 when 'pps' then 26 when 'othermember' then 27
    when 'selfmember' then 28 when 'support' then 29 when 'unlinked_pending' then 30 when 'unlinked_flagged' then 31 when 'unlinked_inflight' then 32
    when 'other_sub_payment' then 33 when 'b_member' then 40 when 's_member' then 41 end) $f$;
insert into members (id, gym_id, user_id, role, name, phone, deactivated_at)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), 'member', 'CPE Member ' || s.n, '+2376012767' || lpad(s.n::text, 2, '0'),
       case when s.n = 25 then now() - interval '2 days' end
from (select n, pg_temp.g(1) as gym from generate_series(10, 33) n union all select 40, pg_temp.g(2) union all select 41, pg_temp.g(3)) s;

insert into plans (id, gym_id, name, plan_type, price, billing_interval, annual_discount_percent, duration_days) values
  ('00000000-0000-0000-0000-000000276a01', pg_temp.g(1), 'CPE Monthly',  'monthly',         25000,  'monthly', null, 30),
  ('00000000-0000-0000-0000-000000276a02', pg_temp.g(1), 'CPE Annual',   'monthly',         250000, 'annual',  15,   365),
  ('00000000-0000-0000-0000-000000276a03', pg_temp.g(1), 'CPE Drop-in',  'pay_per_session', 2000,   'monthly', null, null),
  ('00000000-0000-0000-0000-000000276a04', pg_temp.g(2), 'CPE Monthly B','monthly',         25000,  'monthly', null, 30),
  ('00000000-0000-0000-0000-000000276a05', pg_temp.g(3), 'CPE Monthly S','monthly',         25000,  'monthly', null, 30);

-- Everyone of A on the Annual plan, started 40 days ago (renewed: the Monthly plan, an old Annual row first); the PPS member on Drop-in.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
select ('00000000-0000-0000-0000-000000276b' || lpad(to_hex(n), 2, '0'))::uuid, pg_temp.g(1), pg_temp.m(n), '00000000-0000-0000-0000-000000276a02', 'active',
       current_date - 40, current_date - 40 + 365, now()
from generate_series(10, 33) n where n not in (23, 24, 26);
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000276b1a', pg_temp.g(1), pg_temp.m(26), '00000000-0000-0000-0000-000000276a03', 'active', current_date - 40, null, now()),
  -- renewed: an old row (created 40 days ago) and the current one (created now); the old row carries the standing payment
  ('00000000-0000-0000-0000-000000276bc1', pg_temp.g(1), pg_temp.m(24), '00000000-0000-0000-0000-000000276a02', 'expired', current_date - 400, current_date - 35, now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000276bc2', pg_temp.g(1), pg_temp.m(24), '00000000-0000-0000-0000-000000276a01', 'active', current_date - 5, current_date + 25, now()),
  ('00000000-0000-0000-0000-000000276b28', pg_temp.g(2), pg_temp.m(40), '00000000-0000-0000-0000-000000276a04', 'active', current_date - 5, current_date + 25, now()),
  ('00000000-0000-0000-0000-000000276b29', pg_temp.g(3), pg_temp.m(41), '00000000-0000-0000-0000-000000276a05', 'active', current_date - 5, current_date + 25, now());
create function pg_temp.mem_n(label text) returns int language sql immutable as $f$
  select case label when 'unpaid' then 10 when 'verified' then 11 when 'pending' then 12 when 'processing' then 13 when 'partial' then 14 when 'flagged' then 15
    when 'multi' then 16 when 'voided' then 17 when 'refunded' then 18 when 'unlinked' then 19 when 'before' then 20 when 'fee' then 21 when 'session' then 22
    when 'deact' then 25 when 'pps' then 26 when 'othermember' then 27 when 'selfmember' then 28 when 'support' then 29 when 'unlinked_pending' then 30
    when 'unlinked_flagged' then 31 when 'unlinked_inflight' then 32 when 'other_sub_payment' then 33 end $f$;

create function pg_temp.sub(label text) returns uuid language sql immutable as $f$
  select case label
    when 'unpaid' then '00000000-0000-0000-0000-000000276b0a'
    else ('00000000-0000-0000-0000-000000276b' || lpad(to_hex(pg_temp.mem_n(label)), 2, '0')) end::uuid $f$;
-- Payments. All carry the subscription id unless the case is the late link (unlinked): then subscription_id stays NULL.
-- (id suffix = member number; a second payment of a member gets the 'f0' + member number block.)
create function pg_temp.pay(p_n int, p_status text, p_amount int, p_method text, p_sub uuid, p_purpose text default 'subscription',
                            p_created interval default interval '0', p_flag text default null, p_void boolean default false, p_idx int default 0) returns void language sql as $f$
  insert into payments (id, gym_id, member_id, subscription_id, amount, method, status, purpose, created_at, flagged_reason, voided_at)
  values (('00000000-0000-0000-0000-00000027c' || lpad(to_hex(p_idx), 1, '0') || lpad(to_hex(p_n), 2, '0'))::uuid, pg_temp.g(1), pg_temp.m(p_n), p_sub, p_amount, p_method,
          p_status::payment_status, p_purpose, now() - p_created, p_flag, case when p_void then now() end) $f$;

select pg_temp.pay(11, 'verified',   250000, 'cash',       pg_temp.sub('verified'));
select pg_temp.pay(12, 'pending',    250000, 'cash',       pg_temp.sub('pending'));
select pg_temp.pay(13, 'processing', 250000, 'mobile_money', pg_temp.sub('processing'));
select pg_temp.pay(14, 'verified',   250000, 'cash',       pg_temp.sub('partial'));
select pg_temp.pay(15, 'flagged',    250000, 'mobile_money', pg_temp.sub('flagged'), 'subscription', interval '0', 'staff_flagged');
-- multi: the verified one is OLDER, the pending one is the most recent
select pg_temp.pay(16, 'verified',   250000, 'cash',       pg_temp.sub('multi'), 'subscription', interval '2 days');
select pg_temp.pay(16, 'pending',    250000, 'mobile_money', pg_temp.sub('multi'), 'subscription', interval '1 day', null, false, 1);
select pg_temp.pay(17, 'verified',   250000, 'cash',       pg_temp.sub('voided'), 'subscription', interval '0', null, true);
select pg_temp.pay(18, 'verified',   250000, 'cash',       pg_temp.sub('refunded'));
select pg_temp.pay(19, 'verified',   250000, 'cash',       null);                                                       -- unlinked, created now (>= the row)
select pg_temp.pay(20, 'verified',   250000, 'cash',       null, 'subscription', interval '3 days');                    -- unlinked, BEFORE the subscription row
select pg_temp.pay(21, 'verified',   10000,  'cash',       pg_temp.sub('fee'), 'registration_fee');
select pg_temp.pay(22, 'verified',   2000,   'cash',       pg_temp.sub('session'), 'session');
select pg_temp.pay(24, 'verified',   250000, 'cash',       '00000000-0000-0000-0000-000000276bc1');                     -- the OLD row's payment
select pg_temp.pay(30, 'pending',    250000, 'cash',       null);
select pg_temp.pay(31, 'flagged',    250000, 'mobile_money', null, 'subscription', interval '0', 'staff_flagged');
select pg_temp.pay(32, 'processing', 250000, 'mobile_money', null);
-- a payment of member 33 recorded against ANOTHER member's subscription is not member 33's problem; member 27 owns a verified payment of its own
select pg_temp.pay(27, 'verified',   250000, 'cash',       pg_temp.sub('othermember'));
select pg_temp.pay(28, 'verified',   250000, 'cash',       pg_temp.sub('selfmember'));
-- a partial and a full refund (refunds.actor_id is a staff user)
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  (pg_temp.g(1), (select id from payments where member_id = pg_temp.mem('partial')),  100000, 'partial refund', pg_temp.u(1)),
  (pg_temp.g(1), (select id from payments where member_id = pg_temp.mem('refunded')), 250000, 'full refund',    pg_temp.u(1));

-- Support: a live support person for gym A (assigned, switch on, aal2 session).
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-00000027e008', now());
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-00000027e061', '00000000-0000-0000-0000-00000027e008', pg_temp.g(1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-00000027eaa1', '00000000-0000-0000-0000-00000027e008', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-00000027eaa1', '00000000-0000-0000-0000-00000027e008', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-00000027e061', true);

-- ============================================================================
-- (1) Shape, privileges, registry
-- ============================================================================
select is((select pg_get_function_arguments('public.correct_plan_eligibility(uuid)'::regprocedure)), 'p_member_id uuid', 'correct_plan_eligibility takes only the member id');
select is((select prosecdef from pg_proc where oid = 'public.correct_plan_eligibility(uuid)'::regprocedure), true, 'it is SECURITY DEFINER');
select is((select provolatile::text from pg_proc where oid = 'public.correct_plan_eligibility(uuid)'::regprocedure), 's', 'it is STABLE (a read)');
select is(has_function_privilege('anon', 'public.correct_plan_eligibility(uuid)', 'EXECUTE'), false, 'anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.correct_plan_eligibility(uuid)', 'EXECUTE'), true, 'authenticated can execute it');
select is(has_function_privilege('authenticated', 'private.subscription_standing_payments(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'private.subscription_standing_payments(uuid)', 'EXECUTE'), false, 'the standing-payment helper is not callable by clients');
select is((select count(*)::int from private.support_capabilities where kind = 'rpc' and object_name = 'correct_plan_eligibility'), 1, 'it is in the support registry');
select ok((select prosrc ~ 'private\.subscription_standing_payments' from pg_proc where oid = 'public.correct_plan_eligibility(uuid)'::regprocedure)
          and (select prosrc ~ 'private\.subscription_standing_payments' from pg_proc where proname = 'correct_subscription_plan'),
          'eligibility and the correction both call the one helper (the rule cannot split)');

-- ============================================================================
-- (2) Roles and gyms
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is(pg_temp.elig(pg_temp.mem('unpaid')) ->> 'subscription_id', pg_temp.sub('unpaid')::text, 'an Owner gets the current subscription');
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'supervisor');
select is(pg_temp.elig(pg_temp.mem('unpaid')) ->> 'subscription_id', pg_temp.sub('unpaid')::text, 'a Supervisor gets it');
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'manager');
select is(pg_temp.elig(pg_temp.mem('unpaid')) ->> 'subscription_id', pg_temp.sub('unpaid')::text, 'a Manager gets it');
select pg_temp.claims(pg_temp.u(4), pg_temp.g(1), 'receptionist');
select is(pg_temp.elig(pg_temp.mem('unpaid')), '"none"'::jsonb, 'a Receptionist gets the uniform empty result');
select pg_temp.claims(pg_temp.u(5), pg_temp.g(1), 'coach');
select is(pg_temp.elig(pg_temp.mem('unpaid')), '"none"'::jsonb, 'a Coach gets the uniform empty result');
select pg_temp.claims(pg_temp.u(10), pg_temp.g(1), 'member');
select is(pg_temp.elig(pg_temp.mem('unpaid')), '"none"'::jsonb, 'a member gets the uniform empty result (even their own)');
select pg_temp.claims(pg_temp.u(6), pg_temp.g(2), 'owner');
select is(pg_temp.elig(pg_temp.mem('unpaid')), '"none"'::jsonb, 'another gym''s Owner gets the same empty result as for a missing member');
select is(pg_temp.elig('00000000-0000-0000-0000-000000000000'), '"none"'::jsonb, 'a missing member id gives the same empty result');
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is(pg_temp.elig(pg_temp.mem('b_member')), '"none"'::jsonb, 'an Owner asking about another gym''s member gets the empty result');
select is(pg_temp.elig(pg_temp.mem('nosub')), '"none"'::jsonb, 'a member with no subscription gives the empty result');
select is(pg_temp.elig(pg_temp.mem('deact')) ->> 'subscription_id', pg_temp.sub('deact')::text, 'a deactivated member is correctable (the row is returned)');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
reset role;
set local role anon;
select throws_ok($$select * from public.correct_plan_eligibility('00000000-0000-0000-0000-000000000000')$$, '42501', null, 'the anon role is refused outright');
reset role;

-- ============================================================================
-- (3) The returned subscription and the block, state by state
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'owner');
select is((pg_temp.elig(pg_temp.mem('unpaid')) - 'subscription_id'),
          jsonb_build_object('plan_id', '00000000-0000-0000-0000-000000276a02', 'plan_name', 'CPE ANNUAL', 'plan_type', 'monthly', 'billing_interval', 'annual',
                             'price', 250000, 'duration_days', 365, 'start_date', (current_date - 40)::text, 'expiry_date', (current_date - 40 + 365)::text, 'status', 'active',
                             'block_state', null, 'block_payment_id', null, 'block_amount', null, 'block_method', null, 'block_at', null,
                             'block_refunded_amount', null, 'block_more', null),
          'the current subscription: plan, price, duration, interval, start, expiry, status; no block when nothing stands');
select is(pg_temp.elig(pg_temp.mem('pps')) ->> 'expiry_date', null, 'a Pay-per-session row has a null expiry');
select is(pg_temp.elig(pg_temp.mem('pps')) ->> 'duration_days', null, 'and a null duration');
select is(pg_temp.elig(pg_temp.mem('verified')) ->> 'block_state', 'verified', 'F1: a verified payment stands');
select is((pg_temp.elig(pg_temp.mem('verified')) ->> 'block_amount') || ':' || (pg_temp.elig(pg_temp.mem('verified')) ->> 'block_method') || ':' ||
          (pg_temp.elig(pg_temp.mem('verified')) ->> 'block_refunded_amount') || ':' || (pg_temp.elig(pg_temp.mem('verified')) ->> 'block_more'), '250000:cash:0:0',
          'F1: amount, method, no refund, no others');
select is(pg_temp.elig(pg_temp.mem('pending')) ->> 'block_state', 'pending', 'F2: a payment awaiting verification stands');
select is(pg_temp.elig(pg_temp.mem('processing')) ->> 'block_state', 'in_flight', 'F3: a Tara Money payment in flight stands');
select is(pg_temp.elig(pg_temp.mem('partial')) ->> 'block_state', 'partly_refunded', 'F4: a partly refunded payment stands');
select is(pg_temp.elig(pg_temp.mem('partial')) ->> 'block_refunded_amount', '100000', 'F4: the refunded amount is reported');
select is(pg_temp.elig(pg_temp.mem('flagged')) ->> 'block_state', 'pending', 'a flagged payment stands and is reported as pending (it awaits a decision, F2 text)');
select is((pg_temp.elig(pg_temp.mem('multi')) ->> 'block_state') || ':' || (pg_temp.elig(pg_temp.mem('multi')) ->> 'block_more'), 'pending:1',
          'F5: the MOST RECENT standing payment is named and the other one is counted');
select is(pg_temp.elig(pg_temp.mem('voided')) ->> 'block_state', null, 'a voided payment does not stand');
select is(pg_temp.elig(pg_temp.mem('refunded')) ->> 'block_state', null, 'a fully refunded payment does not stand');
select is(pg_temp.elig(pg_temp.mem('fee')) ->> 'block_state', null, 'a registration-fee payment never stands on the subscription');
select is(pg_temp.elig(pg_temp.mem('session')) ->> 'block_state', null, 'a session payment never stands on the subscription');
select is(pg_temp.elig(pg_temp.mem('othermember')) ->> 'block_state', 'verified', 'control: another member''s verified payment stands for that member');
select is(pg_temp.elig(pg_temp.mem('unpaid')) ->> 'block_state', null, 'control: a member with no payment record is correctable');
select is(pg_temp.elig(pg_temp.mem('selfmember')) ->> 'block_state', 'verified', 'control: the same rule for a member whose own app asked');

-- unlinked payments (subscription_id NULL): counted when created at or after the current subscription row, whatever the status
select is(pg_temp.elig(pg_temp.mem('unlinked')) ->> 'block_state', 'verified', 'owner decision 3: an unlinked VERIFIED payment created after the row stands (manual cash entries never link)');
select is(pg_temp.elig(pg_temp.mem('unlinked_pending')) ->> 'block_state', 'pending', 'an unlinked pending payment stands');
select is(pg_temp.elig(pg_temp.mem('unlinked_flagged')) ->> 'block_state', 'pending', 'an unlinked flagged payment stands');
select is(pg_temp.elig(pg_temp.mem('unlinked_inflight')) ->> 'block_state', 'in_flight', 'an unlinked processing payment stands');
select is(pg_temp.elig(pg_temp.mem('before')) ->> 'block_state', null, 'an unlinked payment created BEFORE the subscription row does not stand');
-- a renewal inserts a new row; the old row's linked payment is not the new row's
select is((pg_temp.elig(pg_temp.mem('renewed')) ->> 'subscription_id') || ':' || coalesce(pg_temp.elig(pg_temp.mem('renewed')) ->> 'block_state', 'none'),
          '00000000-0000-0000-0000-000000276bc2:none', 'a renewed member: the current row is the new one and the old row''s payment does not block it');

-- the read is a read
reset role;
select is((select count(*)::int from private.subscription_standing_payments('00000000-0000-0000-0000-000000276bc1')), 1, 'control: the helper still counts the old row''s payment against the old row');
select is((select count(*)::int from audit_log where action_type = 'subscription_plan_corrected' and gym_id = pg_temp.g(1)), 0, 'asking never writes an audit row');
select is((select count(*)::int from subscriptions where status = 'active' and expiry_date = current_date - 40 + 365 and plan_id = '00000000-0000-0000-0000-000000276a02'), 21,
          'asking never changes a subscription (the 21 Annual fixture rows are untouched)');

-- ============================================================================
-- (4) GymOS Support, and a suspended gym
-- ============================================================================
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.elig(pg_temp.mem('support')) ->> 'subscription_id', pg_temp.sub('support')::text, 'a live support caller reads it as a Supervisor, with no step-up (a read)');
select pg_temp.sup_claims(pg_temp.g(1), 'aal1');
select is(pg_temp.elig(pg_temp.mem('support')), '"none"'::jsonb, 'an AAL1 support session gets the empty result');
select pg_temp.sup_claims(pg_temp.g(2));
select is(pg_temp.elig(pg_temp.mem('b_member')), '"none"'::jsonb, 'a support person not assigned to the gym gets the empty result');
select pg_temp.sup_claims(pg_temp.g(1), 'aal2', '00000000-0000-0000-0000-00000027eaa9');
select is(pg_temp.elig(pg_temp.mem('support')), '"none"'::jsonb, 'a session the gate has never seen gets the empty result');
select pg_temp.claims(pg_temp.u(7), pg_temp.g(3), 'owner');
select is(pg_temp.elig(pg_temp.mem('s_member')) ->> 'error', 'P0001:correct_plan_eligibility: gym ' || pg_temp.g(3) || ' is not active', 'a suspended gym raises, as the other reads do');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.elig(pg_temp.mem('support')), '"none"'::jsonb, 'the Owner''s switch off ends support access on the next request');
reset role;

-- ============================================================================
-- (5) The helper, directly: ordering and counts
-- ============================================================================
select is((select array_agg(state order by created_at desc, payment_id desc) from private.subscription_standing_payments(pg_temp.sub('multi'))), array['pending', 'verified']::text[],
          'the helper lists the standing payments most recent first');
select is((select count(*)::int from private.subscription_standing_payments(pg_temp.sub('voided'))), 0, 'the helper: voided does not stand');
select is((select count(*)::int from private.subscription_standing_payments(pg_temp.sub('refunded'))), 0, 'the helper: fully refunded does not stand');
select is((select refunded_amount from private.subscription_standing_payments(pg_temp.sub('partial'))), 100000, 'the helper: refunded_amount of a partly refunded payment');
select is((select count(*)::int from private.subscription_standing_payments(null)), 0, 'the helper: a null subscription id lists nothing');
select is((select count(*)::int from private.subscription_standing_payments('00000000-0000-0000-0000-00000000dead')), 0, 'the helper: an unknown subscription lists nothing');

select * from finish();
rollback;
