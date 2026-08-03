-- Story 6.1: Expo Push Token Registration & Cleanup. First story in Epic 6
-- (Push Notifications) -- no push infrastructure exists before this
-- migration. `device_push_tokens` is a child of `users`, not `gyms`/
-- `members` -- deliberately has no `gym_id`: a push token belongs to one
-- physical app installation tied to one login (`users.id`/`auth.uid()`),
-- and FR-001 lets that one login hold separate `members` rows at multiple
-- gyms, so the token itself doesn't belong to any single gym. This mirrors
-- `users` itself, the only other table in this schema with no `gym_id`. See
-- docs/decisions.md.
create type device_platform as enum ('ios', 'android');

-- Composite unique (user_id, expo_push_token), not expo_push_token alone --
-- an accepted V1 gap, not an oversight. A global-unique token would need an
-- `on conflict do update` that changes `user_id` on a row RLS's `using`
-- clause still evaluates against the pre-update owner -- the same
-- RLS-blocks-its-own-write trap prior epics' docs/decisions.md entries have
-- hit repeatedly. Composite-unique sidesteps this: each user gets their own
-- row per token. Accepted gap: a device changing hands between two GymOS
-- accounts leaves the previous account's stale row until Expo/FCM/APNs ever
-- reports that token invalid. See docs/decisions.md.
create table device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  expo_push_token text not null,
  platform device_platform not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index idx_device_push_tokens_user_id on device_push_tokens(user_id);

alter table device_push_tokens enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
-- Note: DELETE is intentionally *not* granted to `authenticated` sessions via RLS policy shape (no DELETE policy exists); only `service_role` should be able to delete via private helper functions. Granting DELETE to `authenticated` would be confusing and potentially misleading.
grant select, insert, update on device_push_tokens to authenticated;
grant select, insert, update, delete on device_push_tokens to service_role;

-- Self-scoped RLS -- explicit per-action policies, no `for all`
-- (architecture.md's RLS policy strategy rule), mirrors
-- 0015_users_self_service_language_preference.sql's
-- self_read_own_user/self_update_own_language shape.
create policy "self_read_own_device_push_tokens" on device_push_tokens
  for select
  using (user_id = auth.uid());

create policy "self_insert_own_device_push_tokens" on device_push_tokens
  for insert
  with check (user_id = auth.uid());

create policy "self_update_own_device_push_tokens" on device_push_tokens
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Deliberately no DELETE policy for `authenticated` -- a session never
-- deletes its own token row directly in this story; the only delete path is
-- private.cleanup_invalid_device_push_token() below. Deny-all default
-- blocks it, which is intended, not a gap.

-- Cleanup primitive (AC #2). "Cleanup" here is a reusable primitive, not a
-- wired-up automatic pipeline -- architecture.md's Gap 1 resolution places
-- FR-077's actual "invalid token cleaned up on the next delivery attempt"
-- behavior inside send_push_notification(), the Postgres function Story
-- 6.2/6.3 build to actually call the Expo Push API. That function does not
-- exist yet; this migration only builds the deletion primitive it will
-- call. `security definer` is required, not optional: it must delete *any*
-- user's stale row, not just the caller's own, which no policy above
-- allows. Granted to service_role only -- no ordinary authenticated session
-- has a legitimate reason to delete a token row by string value.
create function private.cleanup_invalid_device_push_token(p_expo_push_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from device_push_tokens where expo_push_token = p_expo_push_token;
$$;

revoke execute on function private.cleanup_invalid_device_push_token from public;
grant execute on function private.cleanup_invalid_device_push_token to service_role;
