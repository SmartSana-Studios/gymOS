-- Epic 23 retro G4: the per-gym support proxy rows made GoTrue's admin user listing fail.
-- private.ensure_support_proxy (0141) inserted auth.users rows with the four GoTrue token columns left NULL. GoTrue reads them into
-- non-nullable strings, so while ANY such row exists `GET /auth/v1/admin/users` (supabase.auth.admin.listUsers, used by the Super Admin
-- gym and admin provisioning) answers 500 "Database error finding users". Reproduced on the local stack on 2026-10-22 with six proxy
-- rows; fixed by writing '' (what GoTrue itself writes) into confirmation_token, recovery_token, email_change_token_new and email_change.
-- 0141 had not been applied to production when this was found.
--   1. ensure_support_proxy writes '' for the four columns.
--   2. every existing proxy row is repaired.
-- Rollback: scripts/rollback-0149-support-proxy-gotrue-tokens.sql.
set local lock_timeout = '5s';

create or replace function private.ensure_support_proxy(p_gym_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from public.users u where u.support_proxy_gym_id = p_gym_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := gen_random_uuid();
  -- banned until 2999-12-31, no password, no email, no phone: it can never sign in or receive a message. handle_new_user adds the public.users row.
  -- The four token columns are '' (never NULL): GoTrue cannot read a NULL there and fails every admin user listing.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, banned_until, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', null, null, '2999-12-31 00:00:00+00'::timestamptz,
          '{"provider":"support_proxy"}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', '');

  update public.users
     set is_support_proxy = true,
         support_proxy_gym_id = p_gym_id,
         display_name = 'GymOS Support',
         phone = null,
         must_change_password = false
   where id = v_id;
  if not found then
    raise exception 'ensure_support_proxy: the proxy users row was not created';
  end if;
  return v_id;
end;
$$;
revoke all on function private.ensure_support_proxy(uuid) from public, anon, authenticated;
grant execute on function private.ensure_support_proxy(uuid) to service_role;

-- repair the rows that already exist
update auth.users
   set confirmation_token     = coalesce(confirmation_token, ''),
       recovery_token         = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change           = coalesce(email_change, '')
 where raw_app_meta_data ->> 'provider' = 'support_proxy'
   and (confirmation_token is null or recovery_token is null or email_change_token_new is null or email_change is null);
