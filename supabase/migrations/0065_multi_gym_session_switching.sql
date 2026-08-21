-- Story 9.6: Multi-Gym Session Switching.
--
-- Closes out docs/decisions.md:999's Decision 3 V1 limitation: a multi-gym
-- staff member (Story 9.4) previously had no way to choose which of their
-- active bindings the platform scoped their session to -- the claims hook
-- always picked the most-recently-created binding, with no override and no
-- way to switch without logging out. This migration adds a durable per-user
-- preference column, a validated switch RPC, a hook-level override that
-- falls back gracefully to the pre-existing behavior, and the one new `gyms`
-- read policy the switcher UI needs to resolve other-gym names.

-- ----------------------------------------------------------------------------
-- 1. users.active_gym_id: the gym a multi-gym staff member most recently
--    chose to act on behalf of. NULL means no preference ever set -- the
--    claims hook falls back to its pre-existing most-recent-wins behavior,
--    so every existing single-gym or never-switched user is unaffected.
-- ----------------------------------------------------------------------------

alter table users add column active_gym_id uuid references gyms(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 2. switch_active_gym(): validated, self-scoped RPC. Modeled on
--    create_staff_member()/update_staff_role() (0064) -- SECURITY DEFINER,
--    caller-scoped, rejects server-side (AC #4), not just UI-hidden.
--
--    No log_audit_event() call -- judgment call, flagged for review: a gym
--    switch is a low-stakes session/UI preference, not a staff-mutation
--    action, mirroring updateLanguagePreference's (services/session.ts)
--    un-audited self-service-preference precedent, not create_staff_member's/
--    update_staff_role's audited-mutation precedent. No AC requires audit
--    logging here.
-- ----------------------------------------------------------------------------

create function switch_active_gym(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from members
    where user_id = auth.uid()
      and gym_id = p_gym_id
      and deactivated_at is null
  ) then
    raise exception 'switch_active_gym: caller has no active membership at target gym';
  end if;

  update users set active_gym_id = p_gym_id where id = auth.uid();
end;
$$;

revoke execute on function switch_active_gym from public;
grant execute on function switch_active_gym to authenticated;

-- ----------------------------------------------------------------------------
-- 3. custom_access_token_hook() override: before falling through to the
--    existing most-recent-created lookup, prefer active_gym_id when it's set
--    and still resolves to an active, non-deactivated membership. Otherwise
--    (NULL, or the chosen gym's binding has since been deactivated) fall
--    through unchanged -- this fallback must be graceful, not deny-all: a
--    stale preference pointing at a now-inactive binding must not lock the
--    user out, it must just silently behave as if they'd never switched.
--
--    No gyms.status/suspension check here -- Epic 11's territory (AD-3),
--    not this story's scope; wiring a story-scoped version of a
--    platform-wide rule here would create an inconsistency Epic 11 owns
--    properly.
--
--    Preserves the function's absolute "never raise" invariant: this is
--    pure additional select/if logic against an already-typed uuid column,
--    wrapped by the pre-existing exception handler below, not a new one.
-- ----------------------------------------------------------------------------

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

-- Grant shape unchanged from 0009 -- create or replace preserves existing grants,
-- but re-stated here for clarity/idempotency of this migration's intent.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 4. New gyms RLS policy: lets the switcher UI read gym *names* for every
--    gym the caller holds an active membership at, not just the one
--    currently claimed. Additive to "read own gym" (0009) -- Postgres RLS
--    permissive policies OR together, and this policy is a strict superset
--    of the old one (the currently-claimed gym always satisfies "an active
--    membership exists"), so both coexisting is harmless.
-- ----------------------------------------------------------------------------

create policy "read gyms of own active memberships" on gyms
  for select
  using (
    exists (
      select 1
      from members
      where members.gym_id = gyms.id
        and members.user_id = auth.uid()
        and members.deactivated_at is null
    )
  );
