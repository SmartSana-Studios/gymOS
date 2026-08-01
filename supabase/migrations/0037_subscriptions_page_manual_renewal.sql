-- Story 4.8: Subscriptions Page & Manual Renewal.
--
-- (1) `subscriptions_current`: this codebase's first `create view`. Every
-- prior story used raw tables + RLS + SECURITY DEFINER RPCs. PostgREST
-- cannot sort top-level rows by an embedded child resource's column, which
-- is how `listMembers()` reads subscription data today (a `subscriptions`
-- embed under `members`) -- that shape structurally cannot satisfy AC #1's
-- "sortable by member name, status, and expiry date" requirement, since
-- status/expiry live on the embedded child, not the top-level row. A flat
-- view sidesteps this entirely: `subscriptions`/`members`/`plans` joined
-- into one row of plain top-level columns, ordinary PostgREST query params
-- handle the rest.
--
-- `with (security_invoker = true)` is not optional -- it is the entire
-- tenant-isolation guarantee for this view. Without it, the view runs with
-- its owner's (migration role's) privileges and bypasses every RLS policy on
-- subscriptions/members/plans, leaking cross-gym data to any authenticated
-- caller. Postgres 17 (this project's major_version) fully supports
-- security_invoker on views (available since PG15). With it set, querying
-- the view enforces gym_staff_read_own_subscriptions (subscriptions), the
-- members read policy, and the plans read policy exactly as if the caller
-- queried each table directly.
--
-- (2) `confirm_renewal()` gains `p_backdate boolean default false`. Postgres
-- requires drop+recreate for an out-parameter signature change (same reason
-- 0036 had to drop+recreate 0035's version). When true, it looks up the
-- *existing* subscription's own expiry_date server-side and uses that as the
-- new row's start_date -- the client never sends a date, mirroring 0022/0035's
-- own precedent of never trusting a client-supplied date. Only valid when the
-- member's current status is grace_period or expired and their existing
-- subscription has a non-null expiry_date (a pay_per_session plan's
-- subscription has expiry_date = null per 0018's trigger -- back-dating it is
-- meaningless and must be rejected, not silently ignored).

create view subscriptions_current
with (security_invoker = true)
as
select distinct on (s.member_id)
  s.id as subscription_id,
  s.gym_id,
  s.member_id,
  m.name as member_name,
  m.phone as member_phone,
  m.join_date,
  m.deactivated_at,
  s.plan_id,
  p.name as plan_name,
  p.plan_type,
  s.status,
  s.start_date,
  s.expiry_date,
  s.created_at as subscription_created_at
from subscriptions s
join members m on m.id = s.member_id
join plans p on p.id = s.plan_id
order by s.member_id, s.created_at desc, s.id desc;

grant select on subscriptions_current to authenticated, service_role;

drop function confirm_renewal(uuid, text, text);

create function confirm_renewal(
  p_member_id uuid,
  p_method text,
  p_reason text,
  p_backdate boolean default false,
  out payment_id uuid,
  out subscription_id uuid,
  out amount integer,
  out currency text,
  out new_expiry_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_actor_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_current_status subscription_status;
  v_current_expiry_date date;
  v_start_date date;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;
  v_actor_id := auth.uid();

  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'confirm_renewal: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'confirm_renewal: reason is required';
  end if;

  select s.plan_id, s.status, s.expiry_date
    into v_plan_id, v_current_status, v_current_expiry_date
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_id is null then
    raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
  end if;

  if p_backdate then
    if v_current_status not in ('grace_period', 'expired') then
      raise exception 'confirm_renewal: back-dating is only available for grace_period or expired subscriptions';
    end if;
    if v_current_expiry_date is null then
      raise exception 'confirm_renewal: cannot back-date a subscription with no expiry date';
    end if;
    v_start_date := v_current_expiry_date;
  else
    v_start_date := current_date;
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  -- Review finding: back-dating a member expired longer than one plan cycle
  -- (e.g. expired 100 days ago on a 30-day plan) would otherwise insert a
  -- new subscription already marked 'active' with an expiry_date already in
  -- the past. Reject rather than silently produce an already-expired
  -- "active" row -- consistent with this block's other eligibility guards.
  if p_backdate and v_duration_days is not null and (v_start_date + v_duration_days) < current_date then
    raise exception 'confirm_renewal: back-dated renewal would still be expired';
  end if;

  new_expiry_date := case when v_duration_days is null then null else v_start_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', v_start_date, new_expiry_date)
  returning id into subscription_id;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason)
  values (v_member_gym_id, p_member_id, subscription_id, amount, currency, p_method, 'verified', v_actor_id, p_reason)
  returning id into payment_id;

  perform log_audit_event(
    p_action_type => 'renewal_confirmed',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason, 'method', p_method, 'amount', amount, 'currency', currency,
      'payment_id', payment_id, 'subscription_id', subscription_id, 'plan_id', v_plan_id,
      'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate
    )
  );
end;
$$;

revoke execute on function confirm_renewal from public;
grant execute on function confirm_renewal to authenticated;
