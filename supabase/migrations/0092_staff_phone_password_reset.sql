-- Staff self-service password reset: the unauthenticated existence check.
--
-- THE GAP THIS CLOSES. `createStaffMember()` provisions Supervisor / Manager /
-- Receptionist / Coach accounts from a phone number with NO email
-- (`createUser({ phone, password, phone_confirm: true })`), while the
-- dashboard's "Forgot password?" flow is `resetPasswordForEmail()`. A staff
-- member who forgets their password therefore has no self-service route at all
-- -- their only recovery is an Owner triggering `resendStaffTempPassword()`
-- over WhatsApp. Owners are unaffected: `createGym()` sets an email as well.
--
-- The fix reuses the phone-OTP rails Story 2.6 already built for member
-- onboarding (`signInWithOtp` -> `verifyOtp` -> the `send-sms-hook` edge
-- function over the Evolution API / Twilio provider chain), then lands the
-- caller on the existing `/auth/update-password` screen, which calls
-- `updateUser({ password })` and needs no email of any kind.
--
-- WHY NOT REUSE phone_has_membership() (0019:31). That one is
-- `exists (select 1 from members where phone = p_phone)` -- ANY row, including
-- plain members and deactivated staff. Calling it from the dashboard's
-- forgot-password screen would fire a WhatsApp/SMS send for:
--   * a plain member, who cannot sign into the dashboard at all, so the code
--     buys them nothing and costs a real message; and
--   * a staff account that Story 9.3 has already deactivated, which is exactly
--     the "immediate access revocation" that story exists to guarantee.
-- Both are avoidable sends on a pre-auth, unauthenticated surface, so this
-- narrower check is its own function rather than a widening of that one --
-- 0019's own comment calls the send an explicit cost-abuse concern.
--
-- `security definer` + `stable` + the anon grant mirror phone_has_membership()
-- exactly: the caller is by definition not signed in yet, and `members` is
-- RLS-gated, so an invoker-rights function would always return false here.
-- It leaks only a single boolean about a phone number the caller already typed
-- -- the same disclosure 0019 accepted deliberately for MA-02, and the same one
-- the mobile "not registered" copy already surfaces.

create function public.phone_has_staff_membership(p_phone text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from members
    where phone = p_phone
      and role <> 'member'
      and deactivated_at is null
  );
$$;

revoke execute on function public.phone_has_staff_membership(text) from public;
grant execute on function public.phone_has_staff_membership(text) to anon, authenticated, service_role;

-- Post-condition assertions -- 0090/0091's discipline: assert the shape rather
-- than trust the name, so a later edit that breaks one of the three load-bearing
-- properties fails at apply time instead of quietly widening a pre-auth surface.
do $verify$
declare
  v_prosrc text;
  v_secdef boolean;
begin
  select p.prosrc, p.prosecdef into v_prosrc, v_secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'phone_has_staff_membership';

  if v_prosrc is null then
    raise exception '0092: phone_has_staff_membership was not created';
  end if;

  -- SECURITY DEFINER is load-bearing: members is RLS-gated and the caller is
  -- unauthenticated, so an invoker-rights version would always return false
  -- and silently break every staff reset.
  if not v_secdef then
    raise exception '0092: phone_has_staff_membership must be SECURITY DEFINER';
  end if;

  -- The two narrowing clauses are the whole point of not reusing
  -- phone_has_membership(); losing either turns this back into an
  -- any-member-any-state check on a pre-auth surface.
  if v_prosrc not like '%role <> ''member''%' then
    raise exception '0092: phone_has_staff_membership must exclude role = member -- a plain member cannot use the dashboard, so an OTP send for one is pure cost';
  end if;
  if v_prosrc not like '%deactivated_at is null%' then
    raise exception '0092: phone_has_staff_membership must exclude deactivated staff -- Story 9.3 revokes their access immediately';
  end if;

  -- anon must be able to call it: the caller has no session yet by definition.
  if not has_function_privilege('anon', 'public.phone_has_staff_membership(text)', 'execute') then
    raise exception '0092: anon must be able to execute phone_has_staff_membership -- the caller is not signed in yet';
  end if;
end;
$verify$;
