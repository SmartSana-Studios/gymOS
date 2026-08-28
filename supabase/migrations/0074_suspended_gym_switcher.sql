-- Story 11.4 code review follow-up: multi-gym switcher data for the
-- suspended screens. `getDashboardShellContext()`'s suspended short-circuit
-- (0073) cannot read `members`/`gyms` the ordinary RLS-scoped way to build
-- the switcher list -- `private.current_gym_status()` evaluates the
-- session's *currently claimed* gym (from the JWT), not each row's own
-- `gym_id`, so `tenant_active_gate` blocks every row of a `members` query
-- once the current gym is suspended, including the caller's own membership
-- row at an otherwise-healthy second gym. Without this, a multi-gym
-- staff/Owner was locked out of every gym they belong to, not just the
-- suspended one.
--
-- Fix: a small, self-scoped SECURITY DEFINER read, mirroring
-- `switch_active_gym()`'s (0065) own RLS bypass and
-- `get_gym_payment_connection_status()`'s (0052) `returns table`/`language
-- sql` shape. Returns exactly what `self_read_own_membership` (0013) would
-- already return for an active gym -- no new data exposure, just available
-- regardless of the current gym's status.
create function list_own_active_gym_memberships()
returns table(gym_id uuid, gym_name text, role member_role)
language sql
stable
security definer
set search_path = public
as $$
  select m.gym_id, g.name, m.role
  from members m
  join gyms g on g.id = m.gym_id
  where m.user_id = auth.uid()
    and m.deactivated_at is null;
$$;

revoke execute on function list_own_active_gym_memberships from public;
grant execute on function list_own_active_gym_memberships to authenticated;
