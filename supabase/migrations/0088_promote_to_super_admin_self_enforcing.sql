-- Story 1.16 code review follow-up: the in-app Admins page's privilege-write
-- path (creating/promoting a Super Admin) previously went through the raw
-- service-role admin client with only an application-level guard
-- (admins/actions.ts's claims re-check + password step-up) -- no DB-level
-- self-enforcement, unlike list_super_admins() (0087), which self-checks
-- `private.is_super_admin()` inside the function itself. This gave the
-- action that mints the platform's highest privilege WEAKER structural
-- protection than the read-only list of who already holds it. User decision
-- (2026-09-07): close that gap with a self-enforcing RPC pair, mirroring
-- 0085's escalate/revoke shape, for the part of the write that CAN run
-- through SQL (the `public.users.is_super_admin`/`display_name` mutation).
--
-- What this does NOT cover: creating the `auth.users` row itself
-- (`auth.admin.createUser`) has no SQL equivalent -- it is only reachable via
-- the Admin API, which requires the service-role key regardless. That part
-- of the create path is unavoidably still service-role-only, same as
-- `createGym`'s own auth-user creation. Once the auth user exists, flipping
-- `is_super_admin` on its `public.users` row now goes through this
-- self-enforcing RPC from the Server Action (`admins/actions.ts`), which has
-- a real caller session to check. The CLI (`provision-super-admin.mjs`,
-- Story 1.12) has no session at all (service-role key only, already the top
-- of the trust chain) and keeps using the raw admin-client
-- `setSuperAdmin`/`promoteToSuperAdmin` functions in
-- `lib/super-admin-provisioning.mjs` unchanged -- a self-enforcing RPC is not
-- reachable for it and would not add any real protection there.

-- ============================================================================
-- promote_to_super_admin: idempotent. Sets is_super_admin = true on an
-- existing public.users row and, ONLY if display_name is currently unset,
-- fills it from the caller-supplied fallback (the CLI's own
-- displayNameFromEmail() output -- this function has no access to the
-- auth.users email column to derive it itself, same reason list_super_admins
-- resolves email in application code, not SQL).
--
-- Returns which parts it actually changed (already_super_admin,
-- display_name_set) so the caller can drive an exact, symmetric revert if a
-- subsequent step (the audit-log write) fails -- the review found the
-- previous inline revert always reset is_super_admin but never the
-- display_name it may have just set.
-- ============================================================================
create function promote_to_super_admin(p_user_id uuid, p_fallback_display_name text)
returns table (already_super_admin boolean, display_name_set boolean)
language plpgsql
security definer
-- pg_temp named LAST, not omitted -- same 0086 hardening discipline
-- 0087_list_super_admins.sql's header already documents.
set search_path = public, pg_temp
as $$
declare
  v_is_super_admin boolean;
  v_display_name text;
  v_display_name_set boolean := false;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  select is_super_admin, display_name into v_is_super_admin, v_display_name
  from users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'no public.users row found for auth user %', p_user_id;
  end if;

  if v_is_super_admin then
    return query select true, false;
    return;
  end if;

  if v_display_name is null or btrim(v_display_name) = '' then
    update users
    set is_super_admin = true, display_name = p_fallback_display_name
    where id = p_user_id;
    v_display_name_set := true;
  else
    update users
    set is_super_admin = true
    where id = p_user_id;
  end if;

  return query select false, v_display_name_set;
end;
$$;

revoke execute on function promote_to_super_admin(uuid, text) from public;
grant execute on function promote_to_super_admin(uuid, text) to authenticated;

-- ============================================================================
-- revert_super_admin_promotion: the exact inverse of a promote_to_super_admin
-- call whose subsequent audit-log write failed. p_revert_display_name should
-- be the `display_name_set` value that same promote_to_super_admin call
-- returned -- reverting it unconditionally would clobber a display_name the
-- user already had before this promotion attempt.
-- ============================================================================
create function revert_super_admin_promotion(p_user_id uuid, p_revert_display_name boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if p_revert_display_name then
    update users set is_super_admin = false, display_name = null where id = p_user_id;
  else
    update users set is_super_admin = false where id = p_user_id;
  end if;
end;
$$;

revoke execute on function revert_super_admin_promotion(uuid, boolean) from public;
grant execute on function revert_super_admin_promotion(uuid, boolean) to authenticated;
