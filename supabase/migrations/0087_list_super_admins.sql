-- Super Admin In-App Admin Management UI (Story 1.16, AC #1).
--
-- The Admins page needs to list every current Super Admin. `public.users`
-- has no `email` column (0003_members_and_users.sql) -- email lives only in
-- `auth.users`, reachable exclusively via the Admin API -- so this RPC
-- covers only the part of AC #1 that a plain read can answer: id,
-- display_name and "since". The Server Action resolves each row's email via
-- `auth.admin.getUserById` (see `admins/actions.ts`).
--
-- SECURITY DEFINER, not a new RLS policy or a raw service-role read:
-- `public.users` has no Super Admin SELECT policy today (only 0015's
-- self_read_own_user), and Story 1.15's own review already rejected a
-- service-role bypass for this identical "resolve info about other Super
-- Admins" problem as "a strictly wider bypass than needed" -- the narrow,
-- self-enforcing RPC shape 0085/0086's escalate_gym_data_access() and
-- revoke_gym_data_access() already use is the same right-sized answer here.
create function list_super_admins()
returns table (
  id uuid,
  display_name text,
  since timestamptz
)
language plpgsql
security definer
-- pg_temp named LAST, not omitted: 0086's own hardening fixed a demonstrated
-- pg_temp.<table> forgery on three functions that used a bare `public`
-- search_path. Do not repeat that mistake in a brand-new function.
set search_path = public, pg_temp
as $$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  return query
    select
      u.id,
      u.display_name,
      -- `since` is when this account was provisioned or promoted TO Super
      -- Admin, not `users.created_at` (account-creation time, set once by
      -- handle_new_user()) -- that would be simply wrong for a user
      -- promoted to Super Admin long after their account already existed.
      -- null when no such audit row exists (e.g. a Super Admin created by
      -- hand-written SQL before Story 1.12).
      (
        select a.created_at
        from audit_log a
        where a.target_entity_id = u.id::text
          and a.action_type in ('super_admin_provisioned', 'super_admin_promoted')
        order by a.created_at desc
        limit 1
      ) as since
    from users u
    where u.is_super_admin = true
    order by u.created_at;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default -- 0007's
-- own header (0007_audit_log.sql:222-227) documents why that default must
-- be explicitly revoked rather than assumed away.
revoke execute on function list_super_admins from public;
grant execute on function list_super_admins to authenticated;
