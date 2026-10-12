-- Story 19.6a: front_desk_alerts `kind` refactor (0110) negative coverage:
-- the kind-aware CHECK both ways, the one-active guarantee for a status-less
-- kind (NULLS NOT DISTINCT), and the column-protect trigger pinning `kind`.
-- Nothing in the product writes session_required yet (19.6b); the direct
-- inserts here run as postgres to prove the constraint shape only.

begin;
select plan(8);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009701', 'Alert Kind Negative Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id)
values ('00000000-0000-0000-0000-000000009711', 'Alert Kind Negative Gym', '00000000-0000-0000-0000-000000009701');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009721'), -- member
  ('00000000-0000-0000-0000-000000009722'); -- owner

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009731', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009721', 'member', 'Kind Negative Member'),
  ('00000000-0000-0000-0000-000000009732', '00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009722', 'owner', 'Kind Negative Owner');

-- kind/status mismatch, both ways.
select throws_ok(
  $$insert into front_desk_alerts (gym_id, member_id, kind, status)
    values ('00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', 'session_required', 'expired')$$,
  '23514',
  'new row for relation "front_desk_alerts" violates check constraint "front_desk_alerts_kind_status_check"',
  'session_required with a status is rejected by the CHECK'
);

select throws_ok(
  $$insert into front_desk_alerts (gym_id, member_id, kind, status)
    values ('00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', 'subscription_status', null)$$,
  '23514',
  'new row for relation "front_desk_alerts" violates check constraint "front_desk_alerts_kind_status_check"',
  'subscription_status with a null status is rejected by the CHECK'
);

select throws_ok(
  $$insert into front_desk_alerts (gym_id, member_id, kind, status)
    values ('00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', 'bogus_kind', null)$$,
  '23514',
  'new row for relation "front_desk_alerts" violates check constraint "front_desk_alerts_kind_status_check"',
  'an unknown kind is rejected by the CHECK'
);

-- One active status-less alert per member (NULLS NOT DISTINCT).
insert into front_desk_alerts (gym_id, member_id, kind, status)
values ('00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', 'session_required', null);

select throws_ok(
  $$insert into front_desk_alerts (gym_id, member_id, kind, status)
    values ('00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', 'session_required', null)$$,
  '23505',
  'duplicate key value violates unique constraint "idx_front_desk_alerts_one_active_per_member_kind_status"',
  'a second active session_required alert for the same member is a unique violation'
);

select lives_ok(
  $$insert into front_desk_alerts (gym_id, member_id, kind, status)
    values ('00000000-0000-0000-0000-000000009711', '00000000-0000-0000-0000-000000009731', 'subscription_status', 'expired')$$,
  'a subscription_status alert is still allowed beside a session_required one'
);

-- Protect trigger pins kind for an authenticated staff caller.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009722","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009711","app_role":"owner"}',
  true
);

select throws_like(
  $$update front_desk_alerts set kind = 'session_required'
    where member_id = '00000000-0000-0000-0000-000000009731' and kind = 'subscription_status'$$,
  '%only dismissed_at/dismissed_by may be updated%',
  'an owner-claim session cannot rewrite an alert''s kind via UPDATE'
);

select lives_ok(
  $$update front_desk_alerts set dismissed_at = now()
    where member_id = '00000000-0000-0000-0000-000000009731' and kind = 'subscription_status'$$,
  'dismissal of an alert still works under the pinned trigger'
);

select isnt(
  (select dismissed_at from front_desk_alerts
    where member_id = '00000000-0000-0000-0000-000000009731' and kind = 'subscription_status'),
  null,
  'the dismissal was actually applied (not filtered out by RLS)'
);

select * from finish();
rollback;
