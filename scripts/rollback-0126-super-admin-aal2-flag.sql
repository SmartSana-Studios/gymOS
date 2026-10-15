-- Rollback for migration 0126 (Super Admin aal2 flag). Restores the 0124 is_super_admin, the 0063
-- is_super_admin_live and the 0065 hook, then drops the flag helper and table.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0126-super-admin-aal2-flag.sql
set local lock_timeout = '5s';

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() #>> '{app_role}') = 'super_admin', false)
     and coalesce((select u.is_super_admin from users u where u.id = auth.uid()), false);
$$;

create or replace function private.is_super_admin_live()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_super_admin from users where id = auth.uid()), false);
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  target_user_id uuid;
  is_super boolean;
  member_gym_id uuid;
  member_role_value member_role;
  preferred_gym_id uuid;
begin
  if event is null then
    -- Defensive only -- GoTrue always calls this hook with a populated event object.
    -- Never raise: an exception here would break login, not just deny gym access.
    return jsonb_build_object('claims', '{}'::jsonb);
  end if;

  claims := coalesce(event->'claims', '{}'::jsonb);
  -- Always clear any pre-existing gym_id/app_role before conditionally re-setting below,
  -- so a stale claim from a prior token (e.g. an echoed refresh-event payload) can never
  -- survive a login where the user no longer qualifies for it.
  claims := (claims - 'gym_id') - 'app_role';
  target_user_id := (event->>'user_id')::uuid;

  select u.is_super_admin, u.active_gym_id into is_super, preferred_gym_id
  from public.users u
  where u.id = target_user_id;

  is_super := coalesce(is_super, false);

  if is_super then
    claims := jsonb_set(claims, '{app_role}', to_jsonb('super_admin'::text));
    -- Super Admin is platform-level, not gym-scoped (FR-004) -- gym_id stays absent/null,
    -- which correctly denies the generic tenant-scoped canary policy below by construction.
    -- Super Admin's real access path is the explicit, audit-logged escalation in Story 1.7.
  else
    -- Story 9.6: prefer the caller's chosen active_gym_id when it still
    -- resolves to an active membership. Only ever narrows the lookup to a
    -- single gym_id -- the fallback query below is untouched.
    if preferred_gym_id is not null then
      select m.gym_id, m.role
        into member_gym_id, member_role_value
        from public.members m
        where m.user_id = target_user_id
          and m.gym_id = preferred_gym_id
          and m.deactivated_at is null
        limit 1;
    end if;

    if member_gym_id is null then
      select m.gym_id, m.role
        into member_gym_id, member_role_value
        from public.members m
        where m.user_id = target_user_id
          and m.deactivated_at is null
        order by m.created_at desc, m.id desc
        limit 1;
    end if;

    if member_gym_id is not null then
      claims := jsonb_set(claims, '{gym_id}', to_jsonb(member_gym_id));
      claims := jsonb_set(claims, '{app_role}', to_jsonb(member_role_value::text));
    end if;
    -- else: no active membership found -- gym_id/app_role stay absent, deny-all.
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
exception
  when others then
    -- RAISE WARNING surfaces this in Postgres/GoTrue logs even though the actual
    -- Sentry call is app-layer plumbing deferred per this story's AC #3 note --
    -- without it, a swallowed exception here is invisible. This exact gap bit us
    -- during manual verification: an earlier missing GRANT (see below) made every
    -- lookup silently fail closed with no trace until logs were inspected directly.
    raise warning 'custom_access_token_hook failed for user %: %', target_user_id, sqlerrm;
    return event;
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

drop function if exists public.super_admin_aal2_required();
drop function if exists private.super_admin_aal2_required();
drop table if exists private.platform_flags;
