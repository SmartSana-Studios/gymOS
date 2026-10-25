-- ============================================================================
-- 0156: Super Admin changes a gym owner's sign-in phone and/or email.
--
-- The owner's phone and email are the owner ACCOUNT's contact details, not gym fields: the phone is the sign-in identity
-- (auth.users.phone, public.users.phone without '+', members.phone with '+') and the email is auth.users.email and
-- members.email. All member rows of that account are updated (it is one person, possibly owning several gyms).
--
-- This function records the change on the public side and writes the audit entry in one transaction. The Super Admin
-- app then applies the same values to the sign-in account through the Admin API and, if that fails, calls this function
-- again with the previous values (the same record-first, revert-on-failure pattern as change_support_contact).
--
--   change_owner_contact(gym, email, phone, reason)
--     email / phone : NULL or blank = leave that field unchanged; at least one must change
--     phone         : E.164 with '+'
--     reason        : 3..500 characters (private.support_reason_ok)
--   returns (ok, code, owner_user_id, previous_email, previous_phone)
--   codes: changed | reason_invalid | not_found | nothing_to_change | email_invalid | phone_invalid | email_taken | phone_taken
--
-- Super Admin only. A phone or email that belongs to ANOTHER account is refused (auth.users and public.users).
-- Audit entry gym_owner_contact_changed carries the previous and new values and the reason.
-- ============================================================================
set local lock_timeout = '5s';

create or replace function public.change_owner_contact(
  p_gym_id uuid,
  p_email text,
  p_phone text,
  p_reason text
)
returns table (ok boolean, code text, owner_user_id uuid, previous_email text, previous_phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone_plus text := nullif(btrim(coalesce(p_phone, '')), '');
  v_phone text;
  v_owner uuid;
  v_prev_email text;
  v_prev_phone text;
  v_email_changes boolean;
  v_phone_changes boolean;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied: caller is not a super admin';
  end if;

  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select m.user_id into v_owner
    from members m
   where m.gym_id = p_gym_id and m.role = 'owner' and m.deactivated_at is null
   order by m.created_at
   limit 1;
  if v_owner is null then
    return query select false, 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- Serialise concurrent changes of the same account.
  perform 1 from public.users u where u.id = v_owner for update;

  select au.email::text, au.phone::text into v_prev_email, v_prev_phone from auth.users au where au.id = v_owner;

  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'email_invalid'::text, v_owner, v_prev_email, v_prev_phone;
    return;
  end if;
  if v_phone_plus is not null and v_phone_plus !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'phone_invalid'::text, v_owner, v_prev_email, v_prev_phone;
    return;
  end if;
  v_phone := case when v_phone_plus is null then null else substr(v_phone_plus, 2) end;

  v_email_changes := v_email is not null and v_email is distinct from lower(coalesce(v_prev_email, ''));
  v_phone_changes := v_phone is not null and v_phone is distinct from coalesce(v_prev_phone, '');
  if not v_email_changes and not v_phone_changes then
    return query select false, 'nothing_to_change'::text, v_owner, v_prev_email, v_prev_phone;
    return;
  end if;

  if v_email_changes and exists (select 1 from auth.users au where lower(au.email) = v_email and au.id <> v_owner) then
    return query select false, 'email_taken'::text, v_owner, v_prev_email, v_prev_phone;
    return;
  end if;
  if v_phone_changes and (
       exists (select 1 from auth.users au where au.phone = v_phone and au.id <> v_owner)
    or exists (select 1 from public.users u where u.phone = v_phone and u.id <> v_owner)
  ) then
    return query select false, 'phone_taken'::text, v_owner, v_prev_email, v_prev_phone;
    return;
  end if;

  if v_phone_changes then
    update public.users set phone = v_phone where id = v_owner;
    update members set phone = v_phone_plus where user_id = v_owner;
  end if;
  if v_email_changes then
    update members set email = v_email where user_id = v_owner;
  end if;

  perform public.log_audit_event(
    'gym_owner_contact_changed',
    p_gym_id,
    p_gym_id::text,
    'gym',
    jsonb_strip_nulls(jsonb_build_object(
      'reason', v_reason,
      'previous_email', case when v_email_changes then v_prev_email end,
      'new_email', case when v_email_changes then v_email end,
      'previous_phone', case when v_phone_changes then '+' || v_prev_phone end,
      'new_phone', case when v_phone_changes then v_phone_plus end
    ))
  );

  return query select true, 'changed'::text, v_owner, v_prev_email, v_prev_phone;
end;
$$;

revoke execute on function public.change_owner_contact(uuid, text, text, text) from public, anon;
grant execute on function public.change_owner_contact(uuid, text, text, text) to authenticated;
