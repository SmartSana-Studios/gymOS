-- Story 23-6c: the sign-in code step now counts wrong codes in private.super_admin_lockout (stepup_record_failure). The counter only
-- reset when a step-up grant was issued, so wrong sign-in codes would pile up across weeks and lock a person who signed in fine in
-- between. support_begin_session() runs right after an accepted code, so it also clears the counter for an unlocked support account.
-- Everything else in the function is unchanged from 0146.
create or replace function public.support_begin_session()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'support_begin_session: a verified second factor is required' using errcode = 'P0001';
  end if;
  -- Only a person with a support assignment is touched; nobody else holds a factor on the dashboard.
  if exists (select 1 from public.support_assignments a where a.support_user_id = auth.uid() and a.state <> 'ended') then
    update public.users set active_gym_id = null where id = auth.uid() and active_gym_id is not null;
  end if;
  -- An accepted code ends the run of wrong ones. A locked account keeps its count (only Super Admin unlocks it).
  if exists (select 1 from private.support_accounts sa where sa.user_id = auth.uid() and sa.locked_at is null) then
    update private.super_admin_lockout set failed_count = 0 where user_id = auth.uid() and locked_at is null;
  end if;
end;
$$;
revoke all on function public.support_begin_session() from public, anon;
grant execute on function public.support_begin_session() to authenticated;
