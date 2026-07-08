-- ============================================================================
-- Architecture deviation, recorded here and in docs/decisions.md:
-- architecture.md specifies this helper as `auth.gym_id()`. Verified hands-on against
-- the local Supabase Postgres instance that migrations run as the `postgres` role,
-- which does NOT have CREATE privilege on the `auth` schema (owned by `supabase_admin`,
-- confirmed via `permission denied for schema auth`). Supabase's own RLS documentation
-- likewise shows custom RLS helper functions living in a dedicated non-exposed schema
-- (their example uses `private`), not inside `auth`. This migration creates a `private`
-- schema for exactly that purpose and defines `private.gym_id()` there instead.
-- Every RLS policy in this project should call `private.gym_id()`.
-- ============================================================================

create schema if not exists private;
-- `anon` is deliberately not granted here -- no unauthenticated flow touches `private`,
-- and `private.gym_id()` is only ever called from RLS policies evaluated for `authenticated`.
grant usage on schema private to authenticated, service_role;

-- STABLE, never throws: returns NULL for an absent, malformed, or unparseable gym_id
-- claim, so a bad claim denies rows (AC #3) rather than erroring out the whole query.
create function private.gym_id()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  raw text;
begin
  raw := auth.jwt() ->> 'gym_id';
  if raw is null or raw = '' then
    return null;
  end if;
  return raw::uuid;
exception
  when others then
    -- Only reached for a genuinely malformed (non-empty, non-UUID) claim -- the
    -- absent/empty case returns above without an exception. RAISE WARNING keeps this
    -- failure visible in Postgres logs instead of silently vanishing, mirroring
    -- custom_access_token_hook's own warning-on-failure below.
    raise warning 'private.gym_id() failed to parse gym_id claim: %', sqlerrm;
    return null;
end;
$$;

-- Custom Access Token Hook: injects gym_id/app_role claims for the logging-in user.
--
-- Claim naming: the gym-scoped role is injected as `app_role`, NOT `role` -- Supabase's
-- own reserved-claims list for this hook includes `role`, which PostgREST/GoTrue use to
-- SET ROLE to anon/authenticated/service_role for the Postgres session. Overwriting it
-- would risk breaking that mechanism platform-wide. See docs/decisions.md.
--
-- Multi-gym resolution: FR-001 allows a user to have `members` rows at multiple gyms,
-- but a JWT can only carry one gym_id/role pair. V1 rule (documented limitation, no
-- session/gym switcher yet): the most recently created, non-deactivated membership wins.
--
-- Failure handling: this function must never raise. GoTrue calls it on every login;
-- an unhandled exception here would break login entirely, not just deny gym access.
-- Any lookup failure or missing data leaves gym_id/app_role absent from the claims,
-- which is the deny-all/fail-closed path (AC #3) -- not an error path.
-- `set search_path = public` is required, not cosmetic: supabase_auth_admin's role-level
-- default search_path is `auth` only (confirmed via pg_roles.rolconfig on the local
-- instance), so an unqualified type/table reference here would fail to resolve at call
-- time with "type/relation does not exist" -- this bit us during manual verification.
--
-- `security definer` is required, not a hardening afterthought: GoTrue invokes this
-- function as `supabase_auth_admin`, which does NOT have the BYPASSRLS attribute
-- (unlike postgres/service_role). Since `users`/`members` have RLS enabled with zero
-- policies (deny-all, by this story's own design), an invoker-rights lookup here would
-- be silently blocked by our own RLS -- a bootstrapping deadlock where the function
-- computing the claims that make RLS work can't itself read past RLS. This function
-- must read across all tenants regardless of RLS; that is its entire job. Reproduced
-- by connecting directly as supabase_auth_admin during manual verification: the lookup
-- returned zero rows with no error (RLS deny-all, not a permission error) for a user
-- who genuinely had a membership row.
create function public.custom_access_token_hook(event jsonb)
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

  select u.is_super_admin into is_super
  from public.users u
  where u.id = target_user_id;

  is_super := coalesce(is_super, false);

  if is_super then
    claims := jsonb_set(claims, '{app_role}', to_jsonb('super_admin'::text));
    -- Super Admin is platform-level, not gym-scoped (FR-004) -- gym_id stays absent/null,
    -- which correctly denies the generic tenant-scoped canary policy below by construction.
    -- Super Admin's real access path is the explicit, audit-logged escalation in Story 1.7.
  else
    select m.gym_id, m.role
      into member_gym_id, member_role_value
      from public.members m
      where m.user_id = target_user_id
        and m.deactivated_at is null
      order by m.created_at desc, m.id desc
      limit 1;

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

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
-- No table-level GRANTs on users/members needed for supabase_auth_admin: `security
-- definer` above means the function's internal SELECTs run as its owner (postgres),
-- not as the invoking role.

-- The one, deliberate, generic tenant-scoping policy this story adds (see story Dev
-- Notes -> Scope Boundary): proves the isolation mechanism end-to-end. All other tables
-- from 0002-0006/0008 stay pure deny-all (RLS enabled, zero policies) -- expected and
-- correct until their owning feature stories add real business policies.
create policy "read own gym" on gyms
  for select
  using (id = private.gym_id());
