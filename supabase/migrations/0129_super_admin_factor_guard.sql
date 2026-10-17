-- Story 22 retro item 55: two carried-over blockers for enabling super_admin_aal2.
--
-- 1. custom_access_token_hook: when the hook itself errors it used to return the incoming event unchanged,
--    which could echo a role or gym claim already present. It now strips app_role and gym_id on the error
--    path (fail closed: the token is minted with no role). Otherwise identical to the 0126 body.
-- 2. Last verified factor guard: with the flag on, deleting a Super Admin's last verified authenticator is
--    refused by the database (BEFORE DELETE trigger on auth.mfa_factors), serialised per user by an advisory
--    lock, so two concurrent removals cannot both pass an app-side count and leave zero factors. It also
--    closes the direct GoTrue API route, not only the app's removeFactor.
--    Exempt: the account itself being deleted (cascade), unverified factors, and the system paths that
--    reset factors on purpose (recovery apply and scripts/reset-super-admin-factors.mjs), which set
--    gymos.factor_reset = 'on' for their own transaction.
-- Rollback: scripts/rollback-0129-super-admin-factor-guard.sql.

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
    -- Fail closed: never hand back an event that still carries a role or gym claim (Story 22 retro item 55).
    return jsonb_set(event, '{claims}', (coalesce(event->'claims', '{}'::jsonb) - 'gym_id') - 'app_role');
end;
$$;

create or replace function private.guard_last_verified_factor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status::text <> 'verified' then
    return old;
  end if;
  if coalesce(current_setting('gymos.factor_reset', true), '') = 'on' then
    return old;
  end if;
  if not coalesce((select u.is_super_admin from users u where u.id = old.user_id), false) then
    return old;
  end if;
  if not private.super_admin_aal2_required() then
    return old;
  end if;
  -- the account is being deleted (cascade from auth.users): its parent row is already gone
  if not exists (select 1 from auth.users au where au.id = old.user_id) then
    return old;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('super_admin_factor:' || old.user_id::text, 0));
  -- re-read after the lock: a concurrent removal that committed first is visible here
  if not exists (
    select 1 from auth.mfa_factors f
     where f.user_id = old.user_id and f.status::text = 'verified' and f.id <> old.id
  ) then
    raise exception 'last_verified_factor: a Super Admin must keep one verified authenticator while the second factor is required'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_last_verified_factor() from public, anon, authenticated;

drop trigger if exists guard_last_verified_factor on auth.mfa_factors;
create trigger guard_last_verified_factor
  before delete on auth.mfa_factors
  for each row execute function private.guard_last_verified_factor();

do $verify$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.mfa_factors'::regclass and tgname = 'guard_last_verified_factor') then
    raise exception '0129: guard trigger missing';
  end if;
  if has_function_privilege('authenticated', 'private.guard_last_verified_factor()', 'execute')
     or has_function_privilege('anon', 'private.guard_last_verified_factor()', 'execute') then
    raise exception '0129: guard function must not be client-callable';
  end if;
end
$verify$;
