-- Rollback for migration 0118 (loyalty guest rule): restores the no-op
-- private.on_session_consumed() hook from 0111. Non-destructive: events,
-- progress and free sessions already written stay (they are valid ledger data
-- and 0117's tables are untouched). Audit rows of type loyalty_stamp_earned,
-- loyalty_reward_granted and loyalty_progress_reset stay.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0118-loyalty-guest-rule.sql

create or replace function private.on_session_consumed(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  null;
end;
$$;

revoke execute on function private.on_session_consumed(uuid, uuid, uuid) from public, anon, authenticated;

do $verify$
begin
  if position('loyalty_events' in pg_get_functiondef('private.on_session_consumed(uuid, uuid, uuid)'::regprocedure)) > 0 then
    raise exception 'rollback-0118: hook body still references the ledger';
  end if;
  if has_function_privilege('anon', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute') then
    raise exception 'rollback-0118: hook must not be client-callable';
  end if;
end;
$verify$;
