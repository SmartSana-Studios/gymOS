-- Recovery email: a failed send does not use up the owner's attempts (migration 0131, retro action item 71).
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000023101', 'sa231@login.example');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000023101';
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000231a1', '00000000-0000-0000-0000-000000023101', now(), now());

-- ---- a failed send voids the code and is audited ------------------------------------------------------
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '100001');
select is(private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'register'), true,
          'reporting a failed send returns true when a live code exists');
select is((select count(*)::int from private.super_admin_recovery_code
            where user_id = '00000000-0000-0000-0000-000000023101' and mail_failed_at is not null and consumed_at is not null),
          1, 'the failed code is voided and marked');
select is((select count(*)::int from audit_log where action_type = 'super_admin_recovery_requested'
            and metadata->>'outcome' = 'mail_failed' and target_entity_id = '00000000-0000-0000-0000-000000023101'),
          1, 'the failed send is audited as mail_failed');
select is(private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'register'), false,
          'reporting again finds no live code and returns false');
select is(private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'bogus'), false,
          'an unknown purpose returns false');

-- ---- the voided code cannot be used ---------------------------------------------------------------------
select is((select reason from private.recovery_register_verify('00000000-0000-0000-0000-000000023101', '100001')),
          'invalid', 'a code whose mail failed is refused');

-- ---- failed sends do not count toward the hourly limit (3), up to the wider cap (9) ------------------------
delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '200001');
select private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'register');
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '200002');
select private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'register');
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '200003');
select private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'register');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '200004')),
          'ok', 'a 4th request is allowed when the first three failed to send');

-- ---- sent codes still count: the old limit holds ----------------------------------------------------------
delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '300001');
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '300002');
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '300003');
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '300004')),
          'rate_limited', 'three sent codes in an hour still rate-limit the 4th');

-- ---- a broken mail server cannot create unlimited codes: the wider cap ---------------------------------------
delete from private.super_admin_recovery_code;
do $$
declare i int;
begin
  for i in 1..9 loop
    perform private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', lpad((400000 + i)::text, 6, '0'));
    perform private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'register');
  end loop;
end $$;
select is((select reason from private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '400010')),
          'rate_limited', 'after 9 failed sends in an hour the wider cap refuses the 10th');

-- ---- failed sends are scoped to the purpose that failed ------------------------------------------------------
delete from private.super_admin_recovery_code;
select private.recovery_code_issue('00000000-0000-0000-0000-000000023101', 'register', 'r@rec.example', '500001');
select is(private.recovery_code_mail_failed('00000000-0000-0000-0000-000000023101', 'recover'), false,
          'a failed recover send does not void a register code');
select is((select count(*)::int from private.super_admin_recovery_code
            where user_id = '00000000-0000-0000-0000-000000023101' and consumed_at is null), 1,
          'the register code is still live');

-- ---- grants ---------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.recovery_code_mail_failed(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.recovery_code_mail_failed(uuid, text)', 'execute'),
          'public.recovery_code_mail_failed is not client-callable');
select ok(has_function_privilege('service_role', 'public.recovery_code_mail_failed(uuid, text)', 'execute'),
          'service_role can call it');

select * from finish();
rollback;
