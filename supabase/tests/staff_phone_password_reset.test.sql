-- Story: staff self-service password reset (0092).
--
-- Covers public.phone_has_staff_membership(text) -- the unauthenticated
-- existence check the dashboard's forgot-password screen calls BEFORE
-- signInWithOtp, so an unknown or ineligible number never reaches the
-- messaging provider.
--
-- WHY A SEPARATE FUNCTION FROM phone_has_membership() (0019:31), which is what
-- this file mostly exists to pin: that one is `exists (select 1 from members
-- where phone = p_phone)` -- ANY row. Widening it, or "simplifying" this one
-- back to it, would fire a real WhatsApp/SMS send for a plain member (who
-- cannot use the dashboard at all) and for a staff account Story 9.3 has
-- already deactivated (whose access is supposed to be revoked immediately).
-- Both are avoidable sends on a pre-auth surface. Assertions 3 and 4 are the
-- ones that fail if either narrowing clause is ever dropped.
--
-- Fixtures are inserted as the setup role (which bypasses RLS) and every
-- assertion runs as `anon`, because the real caller is by definition not
-- signed in yet -- that is also what makes SECURITY DEFINER load-bearing here:
-- `members` is RLS-gated, so an invoker-rights version would return false for
-- every case below.

begin;
select plan(9);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000020301', 'Staff Reset Test Tier', 6000, 60000, 30);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000020311', 'Staff Reset Test Gym', '00000000-0000-0000-0000-000000020301', 'active', 25);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000020321'), -- coach (active)
  ('00000000-0000-0000-0000-000000020322'), -- owner
  ('00000000-0000-0000-0000-000000020323'), -- plain member
  ('00000000-0000-0000-0000-000000020324'), -- receptionist, DEACTIVATED
  ('00000000-0000-0000-0000-000000020325'); -- manager (active)

insert into members (id, gym_id, user_id, role, name, phone, join_date, deactivated_at) values
  ('00000000-0000-0000-0000-000000020331', '00000000-0000-0000-0000-000000020311', '00000000-0000-0000-0000-000000020321', 'coach',        'Reset Coach',        '+237690000301', current_date, null),
  ('00000000-0000-0000-0000-000000020332', '00000000-0000-0000-0000-000000020311', '00000000-0000-0000-0000-000000020322', 'owner',        'Reset Owner',        '+237690000302', current_date, null),
  ('00000000-0000-0000-0000-000000020333', '00000000-0000-0000-0000-000000020311', '00000000-0000-0000-0000-000000020323', 'member',       'Reset Member',       '+237690000303', current_date, null),
  ('00000000-0000-0000-0000-000000020334', '00000000-0000-0000-0000-000000020311', '00000000-0000-0000-0000-000000020324', 'receptionist', 'Reset Receptionist', '+237690000304', current_date, now()),
  ('00000000-0000-0000-0000-000000020335', '00000000-0000-0000-0000-000000020311', '00000000-0000-0000-0000-000000020325', 'manager',      'Reset Manager',      '+237690000305', current_date, null);

-- The real caller has no session at all.
set local role anon;

select is(
  public.phone_has_staff_membership('+237690000301'), true,
  'an active coach can request a reset -- this is the account class that had no self-service recovery at all before 0092'
);
select is(
  public.phone_has_staff_membership('+237690000305'), true,
  'an active manager can request a reset'
);
select is(
  public.phone_has_staff_membership('+237690000302'), true,
  'an Owner can request one too -- they also hold a phone, and the email path stays available to them in parallel'
);

-- The two narrowing clauses. Each of these is the assertion that fails if
-- someone widens this back to phone_has_membership()'s shape.
select is(
  public.phone_has_staff_membership('+237690000303'), false,
  'a PLAIN MEMBER is refused -- they cannot sign into the dashboard at all, so an OTP send for one is pure cost on a pre-auth surface'
);
select is(
  public.phone_has_staff_membership('+237690000304'), false,
  'a DEACTIVATED staff account is refused -- Story 9.3 revokes their access immediately, and a reset would hand it back'
);

-- Positive control: the ONLY reason the two assertions above return false must
-- be the narrowing, not a dead session or a typo'd fixture phone. The wider
-- 0019 function sees both rows from this very same session.
select is(
  public.phone_has_membership('+237690000303'), true,
  'positive control: the plain member DOES exist -- phone_has_membership sees them, so the false above is the role narrowing, not a missing fixture'
);
select is(
  public.phone_has_membership('+237690000304'), true,
  'positive control: the deactivated receptionist DOES exist -- so the false above is the deactivated_at narrowing, not a missing fixture'
);

select is(
  public.phone_has_staff_membership('+237699999999'), false,
  'an unknown number is refused'
);

-- SECURITY DEFINER is load-bearing: `members` is RLS-gated and this ran as
-- anon throughout. If the function were ever changed to invoker rights, every
-- assertion above would return false and staff reset would silently break.
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'phone_has_staff_membership'),
  true,
  'phone_has_staff_membership is SECURITY DEFINER -- members is RLS-gated and the caller is unauthenticated, so invoker rights would return false for every case above'
);

reset role;
select * from finish();
rollback;
