-- Epic 23 decision follow-up (item 3): a refund recorded by GymOS Support left no audit row. Its real person was captured
-- (support_action_identity, subject 'refunds') but nothing could show it: the gym audit trail, and so the Owner's disclosure request and
-- the Super Admin's identity reader, work from audit rows. The waiver and the staff creation already write one; the refund now does too.
-- Only a live support caller is affected (private.support_gym_id() is null for everyone else), so no other gym's audit log changes.
-- Rollback: scripts/rollback-0151-support-refund-audit.sql.
set local lock_timeout = '5s';

insert into private.support_audit_actions (action_type) values ('refund_recorded') on conflict do nothing;

create or replace function private.support_refund_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.support_gym_id() is not null then
    perform public.log_audit_event(
      p_action_type => 'refund_recorded',
      p_gym_id => new.gym_id,
      p_target_entity_id => new.id::text,
      p_target_entity_type => 'refund',
      p_metadata => jsonb_build_object('payment_id', new.payment_id, 'amount', new.amount)
    );
  end if;
  return new;
end;
$$;
revoke all on function private.support_refund_audit_trigger() from public, anon, authenticated;

-- 'yy_' sorts before 'zz_record_support_identity', so the audit row exists before the identity trigger of the audit_log insert fires
create trigger yy_support_refund_audit after insert on public.refunds
  for each row execute function private.support_refund_audit_trigger();
