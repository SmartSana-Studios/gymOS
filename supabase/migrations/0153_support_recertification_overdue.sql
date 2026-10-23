-- Epic 23 decision follow-up (item 4): a support person whose recertification is overdue is refused by the live gate (every gym row reads
-- as empty), which the dashboard showed as a generic "Something went wrong" error. The proxy needs one fact to say why instead: is the
-- caller's own recertification overdue? It reads only the caller's own account and returns only a boolean.
-- Rollback: scripts/rollback-0153-support-recertification-overdue.sql.
set local lock_timeout = '5s';

create or replace function public.support_recertification_overdue()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sa.recertify_due_at is null or sa.recertify_due_at <= now()
                     from private.support_accounts sa
                    where sa.user_id = auth.uid()
                      and sa.activated_at is not null
                      and sa.deactivated_at is null), false)
$$;
revoke all on function public.support_recertification_overdue() from public, anon;
grant execute on function public.support_recertification_overdue() to authenticated;
