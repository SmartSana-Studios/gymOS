-- Rollback for migration 0149 (support proxy rows: GoTrue token columns). Restores private.ensure_support_proxy exactly as 0141 defined it.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0149-support-proxy-gotrue-tokens.sql
-- Data effects: none. The repaired proxy rows keep their '' tokens (restoring NULL would break GoTrue's user listing again).
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
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, banned_until, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', null, null, '2999-12-31 00:00:00+00'::timestamptz,
          '{"provider":"support_proxy"}'::jsonb, '{}'::jsonb, now(), now());

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
