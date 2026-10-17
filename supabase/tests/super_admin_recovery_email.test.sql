-- Story 22.8: Super Admin recovery email (migration 0128).
begin;
select plan(68);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000022801', 'sa228@login.example'),
  ('00000000-0000-0000-0000-000000022802', 'plain228@login.example');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000022801';
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000228a1', '00000000-0000-0000-0000-000000022801', now(), now());
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

-- ---- registration: refusals ------------------------------------------------------------------------
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022802', 'register', 'r@rec.example', '111111')),
          'not_eligible', 'a non-Super-Admin is not eligible');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'SA228@login.example ', '111111')),
          'same_as_login', 'the login email (case/space-insensitive) is refused');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'not-an-email', '111111')),
          'invalid_email', 'a malformed address is refused');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'r@rec.example', '12ab56')),
          'invalid', 'a non-numeric code is refused');
select is((select count(*)::int from private.super_admin_recovery_code), 0, 'refusals write no code');

-- ---- registration: issue, hash, wrong codes, success ----------------------------------------------
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', ' R@Rec.example ', '123456')),
          'ok', 'a different mailbox gets a code');
select is((select target_email from private.super_admin_recovery_code), 'r@rec.example', 'address is normalised');
select ok((select code_hash like '$2%' and code_hash <> '123456' from private.super_admin_recovery_code), 'the code is stored as a bcrypt hash');
select is((select reason from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '000000')),
          'invalid', 'a wrong code is refused');
select is((select attempts from private.super_admin_recovery_code), 1, 'attempt counted');
select is((select count(*)::int from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-000000022801'), 0,
          'a wrong recovery code does not count toward the account lockout');
select is((select count(*)::int from private.super_admin_recovery_email), 0, 'nothing saved yet');
select is((select ok from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '123456')),
          true, 'the right code saves the address');
select is((select masked from private.recovery_status('00000000-0000-0000-0000-000000022801')), 'r***@rec.example', 'status shows only the masked address');
select is((select reason from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '123456')),
          'invalid', 'a code is single use');

-- a new request kills the previous live code
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'r2@rec.example', '222222');
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'r3@rec.example', '333333');
select is((select reason from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '222222')),
          'invalid', 'a newer request invalidates the older code');
select is((select ok from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '333333')),
          true, 'the newest code works and replaces the address');
select is((select email from private.super_admin_recovery_email), 'r3@rec.example', 'address replaced');

-- ---- code dies after the attempt limit; expiry; rate limit ------------------------------------------
delete from private.super_admin_recovery_code;
update private.super_admin_lockout set failed_count = 0;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'r4@rec.example', '444444');
select private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '000001');
select private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '000002');
select private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '000003');
select is((select reason from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '444444')),
          'invalid', 'after 3 wrong codes even the right one is dead');
delete from private.super_admin_recovery_code;
delete from private.super_admin_lockout;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'r5@rec.example', '555555');
update private.super_admin_recovery_code set expires_at = now() - interval '1 second';
select is((select reason from private.recovery_register_verify('00000000-0000-0000-0000-000000022801', '555555')),
          'invalid', 'an expired code is refused');

delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'a@rec.example', '100001');
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'a@rec.example', '100002');
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'a@rec.example', '100003');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'register', 'a@rec.example', '100004')),
          'rate_limited', 'the 4th request in an hour is rate limited');
delete from private.super_admin_recovery_code;

-- ---- recovery: preconditions ------------------------------------------------------------------------
delete from private.super_admin_recovery_email;
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '666666')),
          'no_recovery_email', 'no recovery email: refused');
insert into private.super_admin_recovery_email (user_id, email) values ('00000000-0000-0000-0000-000000022801', 'r@rec.example');
-- recover-purpose limits: 5 a day (older than an hour), then 3 an hour
insert into private.super_admin_recovery_code (user_id, purpose, target_email, code_hash, requested_at, expires_at, consumed_at)
select '00000000-0000-0000-0000-000000022801', 'recover', 'r@rec.example', 'x', now() - interval '2 hours', now() - interval '1 hour', now()
  from generate_series(1, 5);
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '656565')),
          'rate_limited', 'the 6th recovery request in a day is rate limited');
delete from private.super_admin_recovery_code;
insert into private.super_admin_recovery_code (user_id, purpose, target_email, code_hash, requested_at, expires_at, consumed_at)
select '00000000-0000-0000-0000-000000022801', 'recover', 'r@rec.example', 'x', now(), now() + interval '10 minutes', now()
  from generate_series(1, 3);
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '656565')),
          'rate_limited', 'the 4th recovery request in an hour is rate limited');
delete from private.super_admin_recovery_code;
select is((select send_to from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', 'attacker@evil.example', '666666')),
          'r@rec.example', 'the code goes to the stored address, never a caller-supplied one');
select throws_ok($$select * from private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '666666', 'short')$$,
                 '42501', 'permission_denied', 'a short cancel token is refused');

-- a wrong code never feeds the lockout, then success schedules (does not apply) the reset
select is((select reason from private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '000000', repeat('t', 40))),
          'invalid', 'a wrong recovery code is refused');
select is((select count(*)::int from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-000000022801'), 0, 'it does not count toward the lockout');
select is((select ok from private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '666666', repeat('t', 40))),
          true, 'the right code is accepted');
select ok((select apply_at between now() + interval '29 minutes' and now() + interval '31 minutes'
             from private.super_admin_recovery_pending), 'the reset is scheduled 30 minutes out');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '777777')),
          'already_pending', 'a second recovery while one is pending is refused');
select is((select pending_apply_at is not null from private.recovery_status('00000000-0000-0000-0000-000000022801')), true, 'status shows the pending reset');

-- ---- the reset does nothing before it is due; applies after; opens the enrolment window -----------------
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000228f1', '00000000-0000-0000-0000-000000022801', 'one', 'totp', 'verified', now(), now());
select is(private.recovery_apply_due(), 0, 'not due: nothing applied');
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000022801'), 1, 'factor still there');
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022801'), false, 'no enrolment window yet');
update private.super_admin_recovery_pending set apply_at = now() - interval '1 minute';
select is(private.recovery_apply_due(), 1, 'due: applied');
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000022801'), 0, 'factors removed');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000022801'), 0, 'sessions removed');
select is((select count(*)::int from private.super_admin_recovery_email), 1, 'the recovery email is kept');
select is((select enabled from private.platform_flags where flag = 'super_admin_aal2'), true, 'the platform flag stays on');
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022801'), true, 'the first-authenticator window is open');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000228f2', '00000000-0000-0000-0000-000000022801', 'new', 'totp', 'verified', now(), now());
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022801'), false, 'the window closes once a factor is verified');
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000022801';
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022801'), true, 'with no factor the window is open again');
update private.super_admin_recovery_pending set applied_at = now() - interval '61 minutes' where applied_at is not null;
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022801'), false, 'the window closes after 60 minutes');
update private.super_admin_recovery_pending set applied_at = now() where applied_at is not null;
insert into private.super_admin_lockout (user_id, failed_count, locked_at) values ('00000000-0000-0000-0000-000000022801', 5, now())
  on conflict (user_id) do update set failed_count = 5, locked_at = now();
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022801'), false, 'a locked account gets no enrolment window');
delete from private.super_admin_lockout;
select is(private.recovery_enrol_allowed('00000000-0000-0000-0000-000000022802'), false, 'a non-Super-Admin gets no enrolment window');

-- ---- cancel -----------------------------------------------------------------------------------------
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000022801';
delete from private.super_admin_recovery_pending;
delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '888888');
select private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '888888', repeat('c', 40));
select is((select ok from private.recovery_cancel(repeat('x', 40))), false, 'an unknown token cancels nothing');
select is((select ok from private.recovery_cancel(repeat('c', 40))), true, 'the cancel token cancels the pending reset');
select is((select ok from private.recovery_cancel(repeat('c', 40))), false, 'a token works once');
update private.super_admin_recovery_pending set apply_at = now() - interval '1 minute';
select is(private.recovery_apply_due(), 0, 'a cancelled reset is never applied');

-- ---- the owner signing in at aal2 cancels a pending reset; removing the email cancels it too -------------
delete from private.super_admin_recovery_pending;
delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '313131');
select private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '313131', repeat('o', 40));
select is((select (c.cancelled, c.login_email, c.recovery_email)::text from private.recovery_cancel_for_user('00000000-0000-0000-0000-000000022801') c),
          '(1,sa228@login.example,r@rec.example)', 'owner cancel returns the count and both addresses');
select is((select c.cancelled from private.recovery_cancel_for_user('00000000-0000-0000-0000-000000022801') c), 0, 'nothing pending: nothing to cancel');
select is((select actor_id from audit_log where action_type = 'super_admin_recovery_cancelled' and metadata->>'by' = 'owner_signin'),
          '00000000-0000-0000-0000-000000022801'::uuid, 'the owner cancel audit row names the owner');

delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '323232');
select private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '323232', repeat('p', 40));
select private.recovery_email_remove('00000000-0000-0000-0000-000000022801');
select is((select cancelled_at is not null from private.super_admin_recovery_pending
            where cancel_token_hash = encode(extensions.digest(repeat('p', 40), 'sha256'), 'hex')), true,
          'removing the recovery email cancels the pending reset');
insert into private.super_admin_recovery_email (user_id, email) values ('00000000-0000-0000-0000-000000022801', 'r@rec.example');

delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '343434');
select private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '343434', repeat('q', 40));
delete from private.super_admin_recovery_email where user_id = '00000000-0000-0000-0000-000000022801';
update private.super_admin_recovery_pending set apply_at = now() - interval '1 minute'
 where cancel_token_hash = encode(extensions.digest(repeat('q', 40), 'sha256'), 'hex');
select is(private.recovery_apply_due(), 0, 'without a recovery email a due reset is not applied');
select is((select cancelled_at is not null from private.super_admin_recovery_pending
            where cancel_token_hash = encode(extensions.digest(repeat('q', 40), 'sha256'), 'hex')), true, 'it is cancelled instead');
insert into private.super_admin_recovery_email (user_id, email) values ('00000000-0000-0000-0000-000000022801', 'r@rec.example');

-- ---- a lock wins over a pending reset -------------------------------------------------------------------
delete from private.super_admin_recovery_pending;
delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '999999');
select private.recovery_request_verify('00000000-0000-0000-0000-000000022801', '999999', repeat('d', 40));
insert into private.super_admin_lockout (user_id, failed_count, locked_at) values ('00000000-0000-0000-0000-000000022801', 5, now())
  on conflict (user_id) do update set failed_count = 5, locked_at = now();
update private.super_admin_recovery_pending set apply_at = now() - interval '1 minute';
select is(private.recovery_apply_due(), 0, 'a locked account is not reset');
select is((select cancelled_at is not null from private.super_admin_recovery_pending), true, 'the pending reset was cancelled instead');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000022801', 'recover', null, '121212')),
          'locked', 'a locked account cannot request a code');
delete from private.super_admin_lockout;

-- ---- audit never holds a code or a full address ---------------------------------------------------------
select is((select count(*)::int from audit_log where action_type like 'super_admin_recovery%'
             and metadata::text ~ '[A-Za-z0-9]@'), 0,
          'audit holds only masked addresses');
select is((select count(*)::int from audit_log where action_type like 'super_admin_recovery%'
             and metadata::text ~ '(^|[^0-9.])[0-9]{6}([^0-9]|$)'), 0, 'audit holds no code');

-- ---- step-up covers the new actions; bogus still refused ------------------------------------------------
select ok(private.stepup_issue('00000000-0000-0000-0000-000000022801', 'change_recovery_email', 'x') is not null, 'step-up for change_recovery_email');
select ok(private.stepup_issue('00000000-0000-0000-0000-000000022801', 'remove_recovery_email', 'x') is not null, 'step-up for remove_recovery_email');
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000022801', 'bogus', 'x')$$, '42501', 'permission_denied', 'unknown step-up action refused');

-- ---- removal; privileges -----------------------------------------------------------------------------------
select is(private.recovery_email_remove('00000000-0000-0000-0000-000000022801'), true, 'the recovery email can be removed');
select is(private.recovery_email_remove('00000000-0000-0000-0000-000000022801'), false, 'removing twice is a no-op');
select is((select count(*)::int from audit_log where action_type in ('super_admin_recovery_email_set', 'super_admin_recovery_email_removed') and actor_id is null), 0,
          'set and remove audit rows name the signed-in Super Admin');
select is((select count(*)::int from information_schema.routine_privileges
             where routine_schema = 'public' and routine_name like 'recovery\_%' and grantee in ('anon', 'authenticated', 'PUBLIC')), 0,
          'no recovery function is client-callable');

select * from finish();
rollback;
