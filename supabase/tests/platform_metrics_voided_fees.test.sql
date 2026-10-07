-- 0103: platform_metrics().total_payments_processed excludes voided payments.
-- Delta against a baseline (the function is database-wide).
begin;
select plan(3);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000010301","role":"authenticated","app_role":"super_admin"}', true);
select set_config('gymos_test.pm0', (select total_payments_processed::text from platform_metrics()), true);
reset role;

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000010302', 'PM Void Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id) values ('00000000-0000-0000-0000-000000010303', 'PM Void Gym', '00000000-0000-0000-0000-000000010302');
insert into auth.users (id) values ('00000000-0000-0000-0000-000000010304');
insert into members (id, gym_id, user_id, role, name)
values ('00000000-0000-0000-0000-000000010305', '00000000-0000-0000-0000-000000010303', '00000000-0000-0000-0000-000000010304', 'member', 'PM Void Member');

insert into payments (gym_id, member_id, amount, method, status, purpose) values
  ('00000000-0000-0000-0000-000000010303', '00000000-0000-0000-0000-000000010305', 7000, 'cash', 'verified', 'subscription');
insert into payments (gym_id, member_id, amount, method, status, purpose, voided_at) values
  ('00000000-0000-0000-0000-000000010303', '00000000-0000-0000-0000-000000010305', 5000, 'cash', 'verified', 'registration_fee', now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000010301","role":"authenticated","app_role":"super_admin"}', true);

select is((select total_payments_processed from platform_metrics()) - current_setting('gymos_test.pm0')::bigint,
  7000::bigint, 'a voided verified fee is not counted; the live verified payment is');

reset role;
update payments set voided_at = null where purpose = 'registration_fee' and member_id = '00000000-0000-0000-0000-000000010305';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000010301","role":"authenticated","app_role":"super_admin"}', true);
select is((select total_payments_processed from platform_metrics()) - current_setting('gymos_test.pm0')::bigint,
  12000::bigint, 'the same fee counts again once it is not voided');

select is((select prosecdef from pg_proc where oid = 'public.platform_metrics()'::regprocedure), true,
  'platform_metrics stays SECURITY DEFINER');

select * from finish();
rollback;
