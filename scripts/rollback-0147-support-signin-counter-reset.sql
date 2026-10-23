-- Rollback for migration 0147 (sign-in counter reset). Restores support_begin_session() exactly as 0146 defined it.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0147-support-signin-counter-reset.sql
-- Data effects: none.
set local lock_timeout = '5s';

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
end;
$$;
revoke all on function public.support_begin_session() from public, anon;
grant execute on function public.support_begin_session() to authenticated;
