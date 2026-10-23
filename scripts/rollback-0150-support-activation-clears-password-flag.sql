-- Rollback for migration 0150. Restores public.activate_support_account exactly as 0145 defined it.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0150-support-activation-clears-password-flag.sql
-- Data effects: none. Accounts whose flag 0150 cleared stay cleared (re-setting it would force a pointless password change).
set local lock_timeout = '5s';

create or replace function public.activate_support_account(p_token text)
returns table (ok boolean, reason text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
  v_email text;
  v_reason text;
  v_acct record;
  v_reset boolean;
  v_gym record;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return query select false, 'invalid'::text;
    return;
  end if;

  select lower(au.email) into v_email from auth.users au where au.id = v.user_id;
  v_reset := private.support_reset_executed(v.user_id);

  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null) and not v_reset then
    v_reason := 'already_active';
  elsif not v.password_set then
    v_reason := 'password_not_set';
  elsif private.support_email_collision(v_email, v.user_id) then
    v_reason := 'collision';
  elsif not exists (select 1 from auth.mfa_factors f
                     where f.user_id = v.user_id and f.factor_type = 'totp' and f.status = 'verified') then
    v_reason := 'no_verified_factor';
  end if;

  if v_reason is not null then
    perform private.support_audit(v.user_id, 'support:invite', 'support_activation_refused', v.user_id,
      jsonb_build_object('reason', v_reason));
    return query select false, v_reason;
    return;
  end if;

  if v_reset then
    -- gym locks first (in gym order), then the account row, as every other writer
    for v_gym in
      select distinct a.gym_id from public.support_assignments a where a.support_user_id = v.user_id and a.state <> 'ended' order by a.gym_id
    loop
      perform private.support_gym_lock(v_gym.gym_id);
    end loop;
    update private.support_accounts set reset_pending_at = null where user_id = v.user_id;
    update private.support_factor_resets set completed_at = now()
     where user_id = v.user_id and state = 'executed' and completed_at is null;
    perform private.support_touch_activity(v.user_id);
    perform private.support_restore_assignments(v.user_id);
  else
    update private.support_accounts set activated_at = now() where user_id = v.user_id and activated_at is null;
    perform private.support_touch_activity(v.user_id);
  end if;
  update private.support_invites set consumed_at = now() where id = v.invite_id;
  -- the aal1 session used to enrol the factor must not survive: later sign-ins are email + password, then TOTP
  perform private.end_user_sessions(v.user_id);
  if v_reset then
    perform private.support_audit(v.user_id, 'support:invite', 'support_factor_reset_completed', v.user_id, '{}'::jsonb);
  else
    select sa.recertify_due_at into v_acct from private.support_accounts sa where sa.user_id = v.user_id;
    perform private.support_audit(v.user_id, 'support:invite', 'support_account_activated', v.user_id, '{}'::jsonb);
    perform private.support_audit(v.user_id, 'support:invite', 'support_recertification_due_set', v.user_id,
      jsonb_build_object('recertify_due_at', v_acct.recertify_due_at));
  end if;
  return query select true, 'ok'::text;
end;
$$;
revoke all on function public.activate_support_account(text) from public, anon, authenticated;
grant execute on function public.activate_support_account(text) to service_role;
