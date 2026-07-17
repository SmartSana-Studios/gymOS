-- Story 2.6: Member App -- Phone/OTP Onboarding Through Profile Setup.
-- Covers the four new SECURITY DEFINER RPCs added by
-- 0019_member_onboarding_otp.sql: phone_has_membership,
-- check_otp_resend_allowed, record_otp_resend, caller_has_membership. The
-- first three are called pre-authentication (MA-02/MA-03/MA-04 have no
-- session yet), so their assertions run `set local role anon` -- not
-- `authenticated`, unlike every other RLS test file in this project -- to
-- prove the real caller identity these functions are actually invoked
-- under. caller_has_membership() is post-authentication only (it reads
-- auth.uid()), so its assertions run as `authenticated`.
--
-- users.display_name/photo_url self-write behavior is covered by
-- users_self_service_rls.test.sql (updated by this same story), not
-- repeated here.

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000006001', 'Onboarding Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000006011', 'Onboarding Test Gym', '00000000-0000-0000-0000-000000006001', 30);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000006021');
update users set phone = '+237611000021' where id = '00000000-0000-0000-0000-000000006021';

insert into members (id, gym_id, user_id, role, name, phone, join_date)
values (
  '00000000-0000-0000-0000-000000006031', '00000000-0000-0000-0000-000000006011',
  '00000000-0000-0000-0000-000000006021', 'member', 'Onboarding Test Member', '+237611000021', current_date
);

-- ============================================================================
-- phone_has_membership: existence check, called as `anon` (MA-02, no
-- session exists yet).
-- ============================================================================
set local role anon;

select is(
  phone_has_membership('+237611000021'), true,
  'phone_has_membership returns true for a phone with a real members row'
);

select is(
  phone_has_membership('+237699999999'), false,
  'phone_has_membership returns false for a phone with no members row'
);

-- ============================================================================
-- record_otp_resend: 3 resends succeed, the 4th is locked (epics.md#Story
-- 2.6 AC #3 -- "3 failed resend attempts ... the 4th ... 5-minute lockout").
-- ============================================================================
select is(
  (select attempts_remaining from record_otp_resend('+237611000099')), 2,
  '1st resend: allowed, 2 attempts remaining'
);

select is(
  (select attempts_remaining from record_otp_resend('+237611000099')), 1,
  '2nd resend: allowed, 1 attempt remaining'
);

select is(
  (select attempts_remaining from record_otp_resend('+237611000099')), 0,
  '3rd resend: allowed, 0 attempts remaining'
);

select is(
  (select allowed from record_otp_resend('+237611000099')), false,
  '4th resend: rejected -- lockout triggered'
);

select ok(
  (select locked_until from record_otp_resend('+237611000099')) > now(),
  '4th (and any further) resend reports a locked_until in the future'
);

-- ============================================================================
-- record_otp_resend: NULL/empty phone is rejected with a clean exception,
-- not a raw NOT NULL primary-key-violation surfaced to an anon caller
-- (Review finding, 2026-07-17).
-- ============================================================================
select throws_ok(
  $$ select record_otp_resend(null) $$,
  '22023',
  'p_phone must not be null or empty',
  'record_otp_resend(NULL) raises a clean, typed exception, not a raw insert failure'
);

select throws_ok(
  $$ select record_otp_resend('') $$,
  '22023',
  'p_phone must not be null or empty',
  'record_otp_resend('''') (empty string) is rejected the same way as NULL'
);

-- ============================================================================
-- check_otp_resend_allowed: read-only, reflects the same lock state without
-- incrementing further (MA-04's countdown-resync call on foreground return).
-- ============================================================================
select is(
  (select allowed from check_otp_resend_allowed('+237611000099')), false,
  'check_otp_resend_allowed reflects the existing lock'
);

select ok(
  (select locked_until from check_otp_resend_allowed('+237611000099')) > now(),
  'check_otp_resend_allowed reports the same future locked_until, not null'
);

-- ============================================================================
-- Independence: a different phone number's counter is untouched.
-- ============================================================================
select is(
  (select attempts_remaining from record_otp_resend('+237611000088')), 2,
  'a different phone number has its own independent, unlocked counter'
);

select is(
  (select allowed from check_otp_resend_allowed('+237611000021')), true,
  'a phone that has never called record_otp_resend is allowed by default'
);

-- ============================================================================
-- Grants: authenticated must also be able to call these (mobile keeps the
-- same client across the OTP boundary; a session may already exist by the
-- time a resend fires if verifyOtp raced a resend tap).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006021","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select phone_has_membership('+237611000021') $$,
  'an authenticated session can also call phone_has_membership (no permission error)'
);

select lives_ok(
  $$ select * from check_otp_resend_allowed('+237611000021') $$,
  'an authenticated session can also call check_otp_resend_allowed (no permission error)'
);

-- ============================================================================
-- caller_has_membership(): authenticated-caller existence check backing the
-- member-photos Storage policies (Review finding, 2026-07-17 -- replaces
-- the original `app_role = 'member'` check, which the JWT claims hook never
-- sets for a deactivated-only member, contradicting FR-083). Already
-- running as `authenticated` with claims for user 006021 from the block
-- above.
-- ============================================================================
select is(
  caller_has_membership(), true,
  'caller_has_membership() is true for an authenticated user with a real members row'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009999","role":"authenticated"}',
  true
);

select is(
  caller_has_membership(), false,
  'caller_has_membership() is false for an authenticated user with no members row'
);

select * from finish();
rollback;
