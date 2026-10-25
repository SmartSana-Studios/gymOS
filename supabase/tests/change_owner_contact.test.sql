-- Migration 0156: change_owner_contact(). Super Admin only; records the owner's new phone/email on public.users and
-- every members row of that account, refuses a phone/email that belongs to another account, and audits the change.
-- (The sign-in account itself is updated by the Super Admin app through the Admin API, not here.)

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-0000000b6001', 'Owner Contact Test Tier', 8000, 80000, 40);

insert into gyms (id, name, tier_id, status, saas_billing_status, saas_billing_interval, saas_billing_anchor_date, capacity) values
  ('00000000-0000-0000-0000-0000000b6011', 'Owner Contact Gym A', '00000000-0000-0000-0000-0000000b6001', 'active', 'active', 'monthly', current_date + 20, 30),
  ('00000000-0000-0000-0000-0000000b6012', 'Owner Contact Gym B', '00000000-0000-0000-0000-0000000b6001', 'active', 'active', 'monthly', current_date + 20, 30),
  ('00000000-0000-0000-0000-0000000b6013', 'Owner Contact Gym No Owner', '00000000-0000-0000-0000-0000000b6001', 'active', 'active', 'monthly', current_date + 20, 30);

insert into auth.users (id, email, phone) values
  ('00000000-0000-0000-0000-0000000b6601', 'sa@owner-contact.test', null),                       -- super admin caller
  ('00000000-0000-0000-0000-0000000b6602', 'owner-a@owner-contact.test', '237670006602'),        -- owns Gym A and Gym B
  ('00000000-0000-0000-0000-0000000b6603', 'someone-else@owner-contact.test', '237670006603');   -- another account

update users set phone = '237670006602' where id = '00000000-0000-0000-0000-0000000b6602';
update users set phone = '237670006603' where id = '00000000-0000-0000-0000-0000000b6603';
update users set is_super_admin = true where id = '00000000-0000-0000-0000-0000000b6601';

insert into members (id, gym_id, user_id, role, name, phone, email) values
  ('00000000-0000-0000-0000-0000000b6701', '00000000-0000-0000-0000-0000000b6011', '00000000-0000-0000-0000-0000000b6602', 'owner', 'Owner A', '+237670006602', 'owner-a@owner-contact.test'),
  ('00000000-0000-0000-0000-0000000b6702', '00000000-0000-0000-0000-0000000b6012', '00000000-0000-0000-0000-0000000b6602', 'owner', 'Owner A', '+237670006602', 'owner-a@owner-contact.test');

-- (a) A non-super-admin (the owner himself) is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b6602","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000b6011","app_role":"owner"}', true);
select throws_ok(
  $$select * from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, 'x@owner-contact.test', null, 'owner asked')$$,
  'permission denied: caller is not a super admin',
  'a non-super-admin cannot change an owner contact'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b6601","role":"authenticated","app_role":"super_admin"}', true);

select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, 'x@owner-contact.test', null, 'x')), 'reason_invalid', 'a too-short reason is refused');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6013'::uuid, 'x@owner-contact.test', null, 'owner asked')), 'not_found', 'a gym with no active owner is refused');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, 'not-an-email', null, 'owner asked')), 'email_invalid', 'a malformed email is refused');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, null, '0670000000', 'owner asked')), 'phone_invalid', 'a phone that is not E.164 is refused');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, null, null, 'owner asked')), 'nothing_to_change', 'no field given: nothing to change');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, 'OWNER-A@owner-contact.test', '+237670006602', 'owner asked')), 'nothing_to_change', 'the same values (case-insensitive email) are not a change');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, 'someone-else@owner-contact.test', null, 'owner asked')), 'email_taken', 'an email of another account is refused');
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, null, '+237670006603', 'owner asked')), 'phone_taken', 'a phone of another account is refused');

-- (b) A real change of both fields.
create temp table change_1 as
  select * from change_owner_contact('00000000-0000-0000-0000-0000000b6011'::uuid, ' New-Owner@Owner-Contact.test ', '+237670009999', 'Owner changed number and address');
reset role;

select is((select ok from change_1), true, 'a valid change succeeds');
select is((select previous_phone from change_1), '237670006602', 'the previous phone is returned for the revert path');
select is((select phone from users where id = '00000000-0000-0000-0000-0000000b6602'), '237670009999', 'public.users.phone is updated (digits only)');
select is(
  (select count(*)::int from members where user_id = '00000000-0000-0000-0000-0000000b6602' and phone = '+237670009999' and email = 'new-owner@owner-contact.test'),
  2,
  'every members row of the account (both gyms) gets the new phone and the lower-cased email'
);
select is(
  (select metadata ->> 'new_phone' || ' ' || (metadata ->> 'previous_email') from audit_log where action_type = 'gym_owner_contact_changed' and gym_id = '00000000-0000-0000-0000-0000000b6011'),
  '+237670009999 owner-a@owner-contact.test',
  'the audit entry holds the new phone and the previous email'
);
select is((select metadata ->> 'reason' from audit_log where action_type = 'gym_owner_contact_changed' and gym_id = '00000000-0000-0000-0000-0000000b6011'), 'Owner changed number and address', 'the audit entry holds the reason');

-- (c) Changing only the email leaves the phone alone and writes no phone fields.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b6601","role":"authenticated","app_role":"super_admin"}', true);
select is((select code from change_owner_contact('00000000-0000-0000-0000-0000000b6012'::uuid, 'second@owner-contact.test', null, 'Owner changed address')), 'changed', 'an email-only change succeeds');
reset role;
select is(
  (select (metadata ? 'new_phone')::text from audit_log where action_type = 'gym_owner_contact_changed' and gym_id = '00000000-0000-0000-0000-0000000b6012' order by created_at desc limit 1),
  'false',
  'an email-only change records no phone fields'
);

select * from finish();
rollback;
