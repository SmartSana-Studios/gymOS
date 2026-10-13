-- Rollback for migration 0120 (loyalty refund reversal, lapses & sweep):
-- unschedules and drops the sweep, drops the wrappers and failure helper, and
-- puts every hook body back under its original name (0118 earn, 0119 renewal,
-- 0113 refund hook as the no-op). Non-destructive: stamp_reversed, lapse and
-- sweep reset events, progress changes and audit rows already written stay (valid
-- ledger data; 0117's tables are untouched). A reversed stamp is not re-added.
-- Also remove the loyalty_sweep line from scripts/job-runs-alert.sql, or the
-- hourly alert reports it as not running.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0120-loyalty-refund-reversal-lapse-sweep.sql

select cron.unschedule('loyalty_sweep') where exists (select 1 from cron.job where jobname = 'loyalty_sweep');

drop function if exists run_loyalty_sweep_job();

drop function private.on_session_consumed(uuid, uuid, uuid);
drop function private.award_renewal_stamp(uuid);
drop function private.on_session_refunded_after_consumption(uuid, uuid, uuid);
drop function private.record_loyalty_hook_failure(text, uuid, uuid, text, uuid, text, text);

alter function private.on_session_consumed_impl(uuid, uuid, uuid) rename to on_session_consumed;
alter function private.award_renewal_stamp_impl(uuid) rename to award_renewal_stamp;
alter function private.on_session_refunded_after_consumption_impl(uuid, uuid, uuid)
  rename to on_session_refunded_after_consumption;

-- 0113's no-op hook body.
create or replace function private.on_session_refunded_after_consumption(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  null;
end;
$$;

revoke execute on function private.on_session_refunded_after_consumption(uuid, uuid, uuid) from public, anon, authenticated;

do $verify$
begin
  if to_regprocedure('private.on_session_consumed_impl(uuid, uuid, uuid)') is not null
     or to_regprocedure('private.award_renewal_stamp_impl(uuid)') is not null
     or to_regprocedure('private.on_session_refunded_after_consumption_impl(uuid, uuid, uuid)') is not null
     or to_regprocedure('public.run_loyalty_sweep_job()') is not null then
    raise exception 'rollback-0120: 0120 objects remain';
  end if;
  if position('loyalty_events' in pg_get_functiondef('private.on_session_consumed(uuid, uuid, uuid)'::regprocedure)) = 0
     or position('loyalty_events' in pg_get_functiondef('private.award_renewal_stamp(uuid)'::regprocedure)) = 0 then
    raise exception 'rollback-0120: earn hook bodies not restored';
  end if;
  if has_function_privilege('anon', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.award_renewal_stamp(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.on_session_refunded_after_consumption(uuid, uuid, uuid)', 'execute') then
    raise exception 'rollback-0120: hooks must not be client-callable';
  end if;
end;
$verify$;
