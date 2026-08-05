-- Story 7.1 (AC #3): complete_flagged_payment() writes zero audit records
-- today, unlike its sibling complete_verified_payment() (0030), which calls
-- log_audit_event() on its success path. This migration closes that gap by
-- mirroring complete_verified_payment()'s exact call shape: p_target_entity_type
-- => 'member' (not 'payment' -- deliberate consistency with the sibling
-- function, both being the automated/webhook-driven side of the payment
-- lifecycle; the manual queue's payment_verified/payment_flagged events
-- target 'payment' instead, a separate, already-correct convention left
-- unchanged), and p_system_actor_label => 'payment-webhook', identical to
-- complete_verified_payment()'s own literal string.
create or replace function complete_flagged_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_gym_id uuid;
  v_member_id uuid;
  v_amount integer;
  v_method text;
begin
  update payments
  set status = 'flagged'
  where id = p_payment_id and status = 'processing'
  returning id, gym_id, member_id, amount, method
    into v_id, v_gym_id, v_member_id, v_amount, v_method;

  if v_id is null then
    raise notice 'complete_flagged_payment: payment % already left processing or not found -- no-op', p_payment_id;
    return;
  end if;

  perform log_audit_event(
    p_action_type => 'payment_verification_failed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', v_amount,
      'method', v_method
    ),
    p_system_actor_label => 'payment-webhook'
  );
end;
$$;

-- CREATE OR REPLACE FUNCTION preserves the existing ACL, so the
-- revoke/grant pair 0046 already set for this function still applies;
-- no re-grant needed here.
