-- Rollback for migration 0127 (session limits, step-up, lockout). Restores the 0126 helper bodies.
-- Roll back the Super Admin app code first (its gate/step-up RPC calls fail closed once these are gone).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0127-session-limits-step-up.sql
set local lock_timeout = '5s';
drop function if exists public.session_gate_touch(uuid, uuid);
drop function if exists public.stepup_issue(uuid, text, text);
drop function if exists public.stepup_consume(uuid, text, text);
drop function if exists public.stepup_record_failure(uuid);

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() #>> '{app_role}') = 'super_admin', false)
     and coalesce((select u.is_super_admin from users u where u.id = auth.uid()), false)
     and (not private.super_admin_aal2_required() or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2');
$$;
create or replace function private.is_super_admin_live()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from users where id = auth.uid()), false)
     and (not private.super_admin_aal2_required() or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2');
$$;

drop function if exists private.session_gate_touch(uuid, uuid);
drop function if exists private.stepup_issue(uuid, text, text);
drop function if exists private.stepup_consume(uuid, text, text);
drop function if exists private.stepup_record_failure(uuid);
drop function if exists private.end_user_sessions(uuid);
drop function if exists private.jwt_session_alive();
drop function if exists private.super_admin_locked(uuid);
drop function if exists private.session_limit(text);
drop table if exists private.support_stepup;
drop table if exists private.support_session_state;
drop table if exists private.super_admin_lockout;
drop table if exists private.session_limits_config;
