-- Story 22.5: Super Admin second factor (AAL2), flag off.
--
-- Adds the platform flag private.platform_flags('super_admin_aal2'), seeded FALSE, and makes
-- private.is_super_admin(), private.is_super_admin_live() and custom_access_token_hook() require
-- aal2 while the flag is on. While the flag is off (or the row is missing/NULL) every function
-- behaves exactly as before. Nothing here flips the flag: that is Story 22.6's one-time script.
--
-- aal is read fail closed: a token with no aal claim counts as aal1.

create table if not exists private.platform_flags (
  flag    text primary key,
  enabled boolean not null default false
);
alter table private.platform_flags enable row level security;
revoke all on private.platform_flags from public, anon, authenticated;

insert into private.platform_flags (flag, enabled)
values ('super_admin_aal2', false)
on conflict (flag) do nothing;

-- The single reader of the flag. NULL / missing row = off.
create or replace function private.super_admin_aal2_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select f.enabled from private.platform_flags f where f.flag = 'super_admin_aal2'),
    false
  );
$$;
revoke all on function private.super_admin_aal2_required() from public, anon;
grant execute on function private.super_admin_aal2_required() to authenticated, service_role, supabase_auth_admin;

-- Claim check (0124) plus the aal2 requirement while the flag is on.
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() #>> '{app_role}') = 'super_admin', false)
     and coalesce((select u.is_super_admin from users u where u.id = auth.uid()), false)
     and (
       not private.super_admin_aal2_required()
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$$;

-- Live users.is_super_admin read (0063), same aal2 requirement while the flag is on.
create or replace function private.is_super_admin_live()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_super_admin from users where id = auth.uid()), false)
     and (
       not private.super_admin_aal2_required()
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$$;

-- Hook: identical to 0065 except the super_admin claim is emitted only when the flag is off or
-- the minting session is aal2. A Super Admin below aal2 with the flag on gets no claims at all
-- (never falls through to a membership claim).
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

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- Service-path reader for the Super Admin app (the private schema is not exposed). Returns only
-- the boolean; granted to service_role alone.
create or replace function public.super_admin_aal2_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.super_admin_aal2_required();
$$;
revoke all on function public.super_admin_aal2_required() from public, anon, authenticated;
grant execute on function public.super_admin_aal2_required() to service_role;

-- Grants unchanged from 0124 / 0063 (authenticated + service_role); restated for the guardrail.
revoke all on function private.is_super_admin() from public, anon;
grant execute on function private.is_super_admin() to authenticated, service_role;
revoke all on function private.is_super_admin_live() from public, anon;
grant execute on function private.is_super_admin_live() to authenticated, service_role;
