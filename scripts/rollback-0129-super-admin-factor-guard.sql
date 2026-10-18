-- Rollback for migration 0129 (last verified factor guard, hook fail-closed). Restores the 0126 hook body
-- (returns the event unchanged on error) and drops the trigger and its function.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0129-super-admin-factor-guard.sql
set local lock_timeout = '5s';

drop trigger if exists guard_last_verified_factor on auth.mfa_factors;
drop function if exists private.guard_last_verified_factor();

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
  session_aal text;
begin
  if event is null then
    return jsonb_build_object('claims', '{}'::jsonb);
  end if;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := (claims - 'gym_id') - 'app_role';
  target_user_id := (event->>'user_id')::uuid;
  session_aal := coalesce(event->'claims'->>'aal', 'aal1');

  select u.is_super_admin, u.active_gym_id into is_super, preferred_gym_id
  from public.users u
  where u.id = target_user_id;

  is_super := coalesce(is_super, false);

  if is_super then
    if (not private.super_admin_aal2_required()) or session_aal = 'aal2' then
      claims := jsonb_set(claims, '{app_role}', to_jsonb('super_admin'::text));
    end if;
    -- else: flag on and below aal2: no super_admin claim, no gym claims (fail closed).
  else
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
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
exception
  when others then
    raise warning 'custom_access_token_hook failed for user %: %', target_user_id, sqlerrm;
    return event;
end;
$$;
