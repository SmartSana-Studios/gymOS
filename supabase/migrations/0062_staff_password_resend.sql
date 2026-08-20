-- Story 9.2 (AC #4): Staff password resend/reset. Scope added mid-story per
-- explicit user instruction -- see the story file's Dev Notes "Scope
-- Addition" section for full reasoning.
--
-- A SQL RPC cannot call the GoTrue Admin API (auth.admin.updateUserById),
-- so the actual password + must_change_password write happens in the Node
-- service layer (apps/dashboard/services/staff.ts) via the existing
-- service-role admin client. This RPC's only job is the authorization +
-- lookup step -- the ceiling check runs under the caller's own real
-- session, not an unchecked service-role bypass, matching
-- create_staff_member()'s own AD-6 reasoning (0061).

-- ============================================================================
-- staff_account_for_reset(): resolves + authorizes the target of a password
-- reset. Ceiling mirrors StaffPageClient.tsx's existing CAN_CREATE =
-- ["owner", "supervisor"] gate (Story 9.1, AD-16) -- the same two roles
-- that can create a staff account can reset one's credential, with the same
-- role-vs-target-role ceiling create_staff_member() (0061) enforces on
-- creation: Owner may reset any non-member role; Supervisor may reset
-- Manager/Receptionist/Coach only, never Owner or another Supervisor
-- (code-review finding, 2026-08-19 -- an unceilinged Supervisor could
-- otherwise force-reset an Owner's password and read the new plaintext
-- password directly off their own screen via StaffPageClient.tsx's
-- unconditional temp-password toast).
--
-- The caller-role check below uses `is distinct from` rather than `not in`
-- specifically because `not in` is NULL-unsafe: `null not in (...)`
-- evaluates to `null`, which `if` treats as false, silently skipping the
-- rejection for a caller with no resolvable membership role instead of
-- raising (the exact bug class docs/decisions.md/deferred-work.md already
-- documents for create_staff_member()'s own p_role param, 0061). The
-- caller-role check runs before the target lookup so an unauthorized
-- caller always gets the same generic "not authorized" error regardless of
-- whether the target exists (no existence oracle); the target-role ceiling
-- can only be evaluated after the lookup, once the target's actual role is
-- known.
-- ============================================================================
create function staff_account_for_reset(p_member_id uuid)
returns table(user_id uuid, phone text, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'staff_account_for_reset: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();
  if v_caller_role is distinct from 'owner' and v_caller_role is distinct from 'supervisor' then
    raise exception 'staff_account_for_reset: caller is not authorized to reset staff passwords';
  end if;

  select *
  into v_row
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'staff_account_for_reset: target not found or not eligible';
  end if;

  if v_caller_role = 'supervisor' and v_row.role in ('owner', 'supervisor') then
    raise exception 'staff_account_for_reset: caller is not authorized to reset a password for role %', v_row.role;
  end if;

  perform log_audit_event(
    p_action_type => 'staff_password_reset',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('target_name', v_row.name)
  );

  return query select v_row.user_id, v_row.phone, v_row.name;
end;
$$;

-- Never service_role -- the ceiling check above must run inside the
-- caller's real session, not be bypassable, same reasoning
-- create_staff_member()'s own grant comment gives (0061).
revoke execute on function staff_account_for_reset from public;
grant execute on function staff_account_for_reset to authenticated;
