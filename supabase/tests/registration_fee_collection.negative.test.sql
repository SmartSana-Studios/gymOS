-- Story 18.2: registration fee collection and waiver (migration 0099), denial
-- paths. Positive paths: registration_fee_collection.test.sql.
--
-- Every denial is paired with a positive control (a call in the same session
-- or on the same member that DOES land), because the column pins revert
-- silently: an unchanged value is otherwise indistinguishable from a
-- statement that never ran.
--
-- Fee gyms and the suspended gym are seeded in their INSERT: gyms.status and
-- gyms.registration_fee are silently pinned against a bare UPDATE.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000313xx.

begin;
select plan(79);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031301', 'RegFee Collect Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031311', 'RCN Gym A',         '00000000-0000-0000-0000-000000031301', 'active',    5000),
  ('00000000-0000-0000-0000-000000031312', 'RCN Gym B',         '00000000-0000-0000-0000-000000031301', 'active',    7000),
  ('00000000-0000-0000-0000-000000031313', 'RCN Gym Suspended', '00000000-0000-0000-0000-000000031301', 'suspended', 3000),
  ('00000000-0000-0000-0000-000000031314', 'RCN Gym Zero',      '00000000-0000-0000-0000-000000031301', 'active',    5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000031321'), -- owner A
  ('00000000-0000-0000-0000-000000031322'), -- supervisor A
  ('00000000-0000-0000-0000-000000031323'), -- manager A
  ('00000000-0000-0000-0000-000000031324'), -- receptionist A
  ('00000000-0000-0000-0000-000000031325'), -- coach A
  ('00000000-0000-0000-0000-000000031327'), -- owner B
  ('00000000-0000-0000-0000-000000031328'), -- owner suspended
  ('00000000-0000-0000-0000-000000031329'), -- owner zero
  ('00000000-0000-0000-0000-000000031341'), -- A member 1: role matrix target (record)
  ('00000000-0000-0000-0000-000000031342'), -- A member 2: role matrix target (waive)
  ('00000000-0000-0000-0000-000000031343'), -- A member 3: settled by waiver
  ('00000000-0000-0000-0000-000000031344'), -- A member 4: paid
  ('00000000-0000-0000-0000-000000031345'), -- A member 5: deactivated
  ('00000000-0000-0000-0000-000000031346'), -- A member 6: bad-input target
  ('00000000-0000-0000-0000-000000031347'), -- A member 7: bad waive-input target
  ('00000000-0000-0000-0000-000000031348'), -- A member 8: unsettled with a pending fee row
  ('00000000-0000-0000-0000-00000003134a'), -- B member
  ('00000000-0000-0000-0000-00000003134b'), -- suspended gym member
  ('00000000-0000-0000-0000-00000003134c'); -- zero gym member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031331', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031321', 'owner',        'RCN Owner A',        current_date),
  ('00000000-0000-0000-0000-000000031332', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031322', 'supervisor',   'RCN Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000031333', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031323', 'manager',      'RCN Manager A',      current_date),
  ('00000000-0000-0000-0000-000000031334', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031324', 'receptionist', 'RCN Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000031335', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031325', 'coach',        'RCN Coach A',        current_date),
  ('00000000-0000-0000-0000-000000031337', '00000000-0000-0000-0000-000000031312', '00000000-0000-0000-0000-000000031327', 'owner',        'RCN Owner B',        current_date),
  ('00000000-0000-0000-0000-000000031338', '00000000-0000-0000-0000-000000031313', '00000000-0000-0000-0000-000000031328', 'owner',        'RCN Owner Suspended', current_date),
  ('00000000-0000-0000-0000-000000031339', '00000000-0000-0000-0000-000000031314', '00000000-0000-0000-0000-000000031329', 'owner',        'RCN Owner Zero',     current_date),
  ('00000000-0000-0000-0000-000000031351', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031341', 'member', 'RCN A Member 1', current_date),
  ('00000000-0000-0000-0000-000000031352', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031342', 'member', 'RCN A Member 2', current_date),
  ('00000000-0000-0000-0000-000000031353', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031343', 'member', 'RCN A Member 3', current_date),
  ('00000000-0000-0000-0000-000000031354', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031344', 'member', 'RCN A Member 4', current_date),
  ('00000000-0000-0000-0000-000000031355', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031345', 'member', 'RCN A Member 5', current_date),
  ('00000000-0000-0000-0000-000000031356', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031346', 'member', 'RCN A Member 6', current_date),
  ('00000000-0000-0000-0000-000000031357', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031347', 'member', 'RCN A Member 7', current_date),
  ('00000000-0000-0000-0000-000000031358', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031348', 'member', 'RCN A Member 8', current_date),
  ('00000000-0000-0000-0000-000000031361', '00000000-0000-0000-0000-000000031312', '00000000-0000-0000-0000-00000003134a', 'member', 'RCN B Member',   current_date),
  ('00000000-0000-0000-0000-000000031362', '00000000-0000-0000-0000-000000031313', '00000000-0000-0000-0000-00000003134b', 'member', 'RCN S Member',   current_date),
  ('00000000-0000-0000-0000-000000031363', '00000000-0000-0000-0000-000000031314', '00000000-0000-0000-0000-00000003134c', 'member', 'RCN Z Member',   current_date);

update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000031355';

select is(
  (select count(*)::int from members where role = 'member' and registration_fee_settled_at is null
     and id in ('00000000-0000-0000-0000-000000031351', '00000000-0000-0000-0000-000000031352', '00000000-0000-0000-0000-000000031353',
                '00000000-0000-0000-0000-000000031354', '00000000-0000-0000-0000-000000031355', '00000000-0000-0000-0000-000000031356',
                '00000000-0000-0000-0000-000000031357', '00000000-0000-0000-0000-000000031358', '00000000-0000-0000-0000-000000031361',
                '00000000-0000-0000-0000-000000031362', '00000000-0000-0000-0000-000000031363')),
  11,
  'fixture sanity: all eleven members start awaiting'
);

-- ============================================================================
-- record_registration_fee: role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031325","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"coach"}', true);
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031351', 'cash', 'A coach tries to collect') $$, '%permission denied%', 'a coach cannot record the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031341","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"member"}', true);
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031351', 'cash', 'A member tries to pay self') $$, '%permission denied%', 'a member cannot record the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","app_role":"receptionist"}', true);
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031351', 'cash', 'No gym claim on this session') $$, '%permission denied%', 'a receptionist claim with no gym_id cannot record the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311"}', true);
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031351', 'cash', 'No app_role claim on this session') $$, '%permission denied%', 'a claim with a gym_id but no app_role cannot record the fee (fails closed)');

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000031351'),
  0,
  'the denied role-matrix calls wrote no payment'
);

-- ============================================================================
-- waive_registration_fee: role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031352', 'A receptionist tries to waive') $$, '%permission denied%', 'a receptionist cannot waive the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031325","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"coach"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031352', 'A coach tries to waive') $$, '%permission denied%', 'a coach cannot waive the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031342","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"member"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031352', 'A member tries to waive self') $$, '%permission denied%', 'a member cannot waive the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031321","role":"authenticated","app_role":"owner"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031352', 'Owner claim with no gym') $$, '%permission denied%', 'an owner claim with no gym_id cannot waive the fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031352', 'No app_role on this session') $$, '%permission denied%', 'a claim with a gym_id but no app_role cannot waive the fee (fails closed)');

reset role;

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031352'),
  null,
  'the denied waive calls settled nothing'
);

-- Positive controls: the same targets, permitted roles.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031351', 'cash', 'Receptionist control call') $$, 'positive control: a receptionist can record the fee for the same member');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"manager"}', true);
select lives_ok($$ select waive_registration_fee('00000000-0000-0000-0000-000000031352', 'Manager control call') $$, 'positive control: a manager can waive for the same member');
reset role;

-- ============================================================================
-- Not due.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"owner"}', true);

-- A member settled by waiver.
select lives_ok($$ select waive_registration_fee('00000000-0000-0000-0000-000000031353', 'Settled for the not-due checks') $$, 'setup: owner waives member 3');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031353', 'cash', 'Record after a waiver') $$, '%registration_fee_not_due%', 'record on a waived (settled) member is not due');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031353', 'Waive twice') $$, '%registration_fee_not_due%', 'waive on an already settled member is not due');

-- A member who already paid.
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031354', 'bank_transfer', 'Setup: member 4 pays') $$, 'setup: owner records member 4');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031354', 'Waive after paying') $$, '%registration_fee_not_due%', 'waive on a member who already paid is not due');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031354', 'cash', 'Pay twice') $$, '%registration_fee_already_recorded%', 'record on a member who already paid is already_recorded');

-- Deactivated.
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031355', 'cash', 'Record on deactivated') $$, '%member_deactivated%', 'record on a deactivated member is rejected');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031355', 'Waive on deactivated') $$, '%member_deactivated%', 'waive on a deactivated member is rejected');

-- Not a member row: a coach.
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031335', 'cash', 'Record on a coach row') $$, '%not_found%', 'record on a non-member role row is not found');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031335', 'Waive on a coach row') $$, '%not_found%', 'waive on a non-member role row is not found');

-- Other gym.
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031361', 'cash', 'Cross-gym record attempt') $$, '%not_found%', 'record on another gym''s member is not found');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031361', 'Cross-gym waive attempt') $$, '%not_found%', 'waive on another gym''s member is not found');

-- Unknown id.
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-0000000313ff', 'cash', 'Unknown member id') $$, '%not_found%', 'record on an unknown member id is not found');
reset role;

select is(
  (select count(*)::int from members where id in ('00000000-0000-0000-0000-000000031355', '00000000-0000-0000-0000-000000031361')
     and registration_fee_settled_at is not null),
  0,
  'the deactivated member and the other gym''s member are still awaiting'
);

select is(
  (select count(*)::int from payments where purpose = 'registration_fee'
     and member_id in ('00000000-0000-0000-0000-000000031353', '00000000-0000-0000-0000-000000031355', '00000000-0000-0000-0000-000000031361', '00000000-0000-0000-0000-000000031335')),
  0,
  'no fee payment was written for any rejected target'
);

select is(
  (select count(*)::int from payments where purpose = 'registration_fee' and member_id = '00000000-0000-0000-0000-000000031354'),
  1,
  'positive control: the paid member has exactly one fee row'
);

-- Cross-gym positive control: owner B can act on gym B's own member.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031327","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031312","app_role":"owner"}', true);
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031361', 'cash', 'Owner B records own member') $$, 'positive control: owner B records gym B''s own member');
reset role;

select is(
  (select amount from payments where member_id = '00000000-0000-0000-0000-000000031361' and purpose = 'registration_fee'),
  7000,
  'gym B''s fee row carries gym B''s fee, not gym A''s'
);

-- ============================================================================
-- Bad input (record).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);

select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'mobile_money', 'Not a manual method') $$, '%invalid_method%', 'method mobile_money is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'orange_money', 'Provider methods are not manual') $$, '%invalid_method%', 'a provider method is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', null, 'Null method') $$, '%invalid_method%', 'a NULL method is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'Cash', 'Wrong case method') $$, '%invalid_method%', 'a differently-cased method is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', '') $$, '%reason is required%', 'an empty reason is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', '    ') $$, '%reason is required%', 'a blank reason is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', E' \t\r\n ') $$, '%reason is required%', 'a tab/newline-only reason is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', null) $$, '%reason is required%', 'a NULL reason is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', repeat('x', 201)) $$, '%reason is too long%', 'a 201-character reason is rejected');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', repeat(' ', 5) || repeat('x', 201) || repeat(' ', 5)) $$, '%reason is too long%', 'a reason that is still 201 characters after trimming is rejected');
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000031356')
  + (select count(*)::int from members where id = '00000000-0000-0000-0000-000000031356' and registration_fee_settled_at is not null),
  0,
  'none of the rejected inputs wrote a payment or settled the member'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031356', 'cash', repeat(' ', 5) || repeat('x', 200) || repeat(' ', 5)) $$, 'positive control: a reason padded with whitespace that is exactly 200 characters after trimming is accepted');
reset role;

-- Bad input (waive).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"manager"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', '') $$, '%reason is required%', 'waive with an empty reason is rejected');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', '   ') $$, '%reason is required%', 'waive with a blank reason is rejected');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', E' \t\r\n ') $$, '%reason is required%', 'waive with a tab/newline-only reason is rejected');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', null) $$, '%reason is required%', 'waive with a NULL reason is rejected');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', repeat('x', 201)) $$, '%reason is too long%', 'waive with a 201-character reason is rejected');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', repeat(' ', 5) || repeat('x', 201) || repeat(' ', 5)) $$, '%reason is too long%', 'waive with a reason that is still 201 characters after trimming is rejected');
select lives_ok($$ select waive_registration_fee('00000000-0000-0000-0000-000000031357', repeat(' ', 5) || repeat('x', 200) || repeat(' ', 5)) $$, 'positive control: waive with a whitespace-padded reason that is exactly 200 characters after trimming is accepted');
reset role;

-- ============================================================================
-- Existing non-voided fee row, member still unsettled (the race shape).
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose)
values ('00000000-0000-0000-0000-000000031371', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031358', 5000, 'XAF', 'cash', 'pending', 'registration_fee');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);
select throws_like(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031358', 'cash', 'A fee row already exists for this member') $$,
  '%registration_fee_already_recorded%',
  'record is blocked while a non-voided, non-flagged fee row exists for an unsettled member'
);
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000031358' and purpose = 'registration_fee'),
  1,
  'the blocked record added no second fee row'
);

-- ============================================================================
-- Suspended gym.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031328","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031313","app_role":"owner"}', true);
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031362', 'cash', 'Suspended gym record attempt') $$, '%is not active%', 'a suspended gym cannot record the fee');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-000000031362', 'Suspended gym waive attempt') $$, '%is not active%', 'a suspended gym cannot waive the fee');
reset role;

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031362'),
  null,
  'the suspended gym''s member is still awaiting'
);

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000031362'),
  0,
  'the suspended gym''s member has no payment'
);

-- ============================================================================
-- Fee 0: record is not configured; waive is the way out.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031329","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031314","app_role":"owner"}', true);
select lives_ok($$ select set_registration_fee(0) $$, 'setup: owner of the zero gym lowers the fee to 0');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-000000031363', 'cash', 'Record at fee zero') $$, '%registration_fee_not_configured%', 'record at fee 0 raises registration_fee_not_configured');
reset role;

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031363'),
  null,
  'positive control: the member is still awaiting after the fee went to 0 and the record was refused'
);

-- ============================================================================
-- Direct insert of a fee row through RLS is denied, per staff role, each
-- paired with a same-session insert of a subscription payment that lands.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 5000, 'XAF', 'cash', 'pending', 'registration_fee') $$,
  '42501', null, 'a receptionist cannot insert a fee payment through RLS');
select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'pending', 'subscription') $$,
  'positive control: the same receptionist can insert a pending subscription payment');
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose, voided_at)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'pending', 'subscription', now()) $$,
  '42501', null, 'a receptionist cannot insert an already-voided payment through RLS');
select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose, voided_at)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'pending', 'subscription', null) $$,
  'positive control: the same receptionist can insert a pending subscription payment with voided_at null');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"manager"}', true);
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 5000, 'XAF', 'cash', 'pending', 'registration_fee') $$,
  '42501', null, 'a manager cannot insert a fee payment through RLS');
select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'processing') $$,
  'positive control: the same manager can insert a processing payment (default purpose)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"supervisor"}', true);
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 5000, 'XAF', 'cash', 'pending', 'registration_fee') $$,
  '42501', null, 'a supervisor cannot insert a fee payment through RLS');
select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'pending', 'subscription') $$,
  'positive control: the same supervisor can insert a pending subscription payment');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"owner"}', true);
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 5000, 'XAF', 'cash', 'pending', 'registration_fee') $$,
  '42501', null, 'an owner cannot insert a fee payment through RLS');
select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'pending', 'subscription') $$,
  'positive control: the same owner can insert a pending subscription payment');
reset role;

-- ============================================================================
-- Direct writes of voided_at / purpose are pinned (silent revert), each paired
-- with a status change in the same UPDATE that lands.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000031372', '00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 15000, 'XAF', 'cash', 'pending');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"receptionist"}', true);
-- Pending fee row 31371 (member 8) is visible to staff; turn it into a
-- subscription payment and void it in the same statement.
update payments set status = 'flagged', voided_at = now(), purpose = 'subscription'
where id = '00000000-0000-0000-0000-000000031371';
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000031371'),
  'flagged',
  'positive control: the receptionist''s UPDATE landed (status is flagged)'
);
select is(
  (select voided_at from payments where id = '00000000-0000-0000-0000-000000031371'),
  null,
  'a receptionist UPDATE of payments.voided_at is pinned'
);
select is(
  (select purpose from payments where id = '00000000-0000-0000-0000-000000031371'),
  'registration_fee',
  'a receptionist UPDATE of payments.purpose is pinned'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031311","app_role":"supervisor"}', true);
update payments set status = 'verified', voided_at = now(), purpose = 'registration_fee'
where id = '00000000-0000-0000-0000-000000031372';
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000031372'),
  'verified',
  'positive control: the supervisor''s UPDATE landed (status is verified)'
);
select is(
  (select voided_at from payments where id = '00000000-0000-0000-0000-000000031372'),
  null,
  'a supervisor UPDATE of payments.voided_at is pinned (the 0031 trigger does not cover supervisor)'
);
select is(
  (select purpose from payments where id = '00000000-0000-0000-0000-000000031372'),
  'subscription',
  'a supervisor UPDATE of payments.purpose is pinned'
);

-- ============================================================================
-- Schema constraint and EXECUTE grants.
-- ============================================================================
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031311', '00000000-0000-0000-0000-000000031351', 5000, 'XAF', 'cash', 'verified', 'tip') $$,
  '23514', null, 'payments.purpose rejects an unknown value');

select ok(
  not has_function_privilege('anon', 'public.record_registration_fee(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.waive_registration_fee(uuid, text)', 'EXECUTE'),
  'anon cannot execute either RPC'
);

select ok(
  has_function_privilege('authenticated', 'public.record_registration_fee(uuid, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.waive_registration_fee(uuid, text)', 'EXECUTE'),
  'positive control: authenticated can execute both RPCs'
);

select * from finish();
rollback;
