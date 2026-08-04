---
baseline_commit: f71ef31cde96731f72f5c7676299e2f61e216589
---

# Story 6.1: Expo Push Token Registration & Cleanup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want my device registered to receive push notifications,
so that I get timely alerts about my membership.

## Scope Notes — Read Before the Acceptance Criteria

**This is the first story in Epic 6 (Push Notifications) — zero push infrastructure exists anywhere in this codebase before this story.** No migration, no `device_push_tokens`-shaped table, no `apps/mobile` notification code, no `expo-notifications` dependency. Everything here is new ground; there is no prior-story pattern to extend, only cross-epic precedents to borrow from (cited below).

**"Cleanup" in this story's title is a reusable primitive, not a wired-up automatic pipeline — read this before treating AC #2 as unimplementable.** architecture.md's Gap 1 resolution places FR-077's actual "invalid token cleaned up on the next delivery attempt" behavior *inside* `send_push_notification()` — the Postgres function Story 6.2 (subscription-lifecycle cron) and Story 6.3 (payments trigger) build to actually call the Expo Push API. That function does not exist yet; there is no "delivery attempt" for a token to fail during in this story. This story instead builds `private.cleanup_invalid_device_push_token(p_expo_push_token text)`, a standalone `SECURITY DEFINER` SQL function that deletes the row for a given token — the exact operation `send_push_notification()` will call once it exists. This story pgTAP-tests the function directly (call it, assert the row is gone). **Do not attempt to build `send_push_notification()`, `pg_net`, or any cron/trigger wiring in this story** — that is Story 6.2/6.3's explicit scope, not this one's.

**`device_push_tokens` is a child of `users`, not `gyms`/`members` — deliberately has no `gym_id`.** A push token belongs to one physical app installation tied to one login (`users.id` / `auth.uid()`). FR-001 lets that one login hold separate `members` rows at multiple gyms — the token itself doesn't belong to any single gym. This mirrors `users` itself, the only other table in this schema with no `gym_id`. architecture.md's "every child table below `gyms` carries `gym_id`" rule (line 540) does not apply here, because this table isn't a child of `gyms` at all. Do not add a `gym_id` column "for consistency" — it would be meaningless (which gym would it name for a multi-gym member?) and unenforceable.

**Unique constraint is `(user_id, expo_push_token)`, not `expo_push_token` alone — an accepted V1 gap, not an oversight.** A global-unique token could theoretically be reassigned across accounts (e.g. a shared/reset device where a different member later logs in and re-registers the same physical device). A global unique key would require an `ON CONFLICT DO UPDATE` that changes `user_id` on a row RLS says the *new* caller doesn't own yet (its `USING` clause checks the pre-update row, which would still belong to the *previous* account) — the same "RLS blocks its own write" trap prior epics' `docs/decisions.md` entries have hit repeatedly. Composite-unique sidesteps this cleanly: each user gets their own row per token, full stop. The accepted gap: if a device changes hands between two GymOS accounts, the previous account's stale row is never proactively deleted by this story (only cleaned up later if Expo/FCM/APNs ever reports that specific token invalid, or manually). No AC or FR in this epic asks for device-handoff detection, and this isn't a realistic V1 scenario at pilot scale (personal phones, not shared kiosks) — do not build cross-account reassignment logic.

**Environment prerequisite — resolved during live verification.** The app is linked to the EAS project `@josephfeussi/gymos`; `apps/mobile/eas.json` and `extra.eas.projectId` now exist. Android push also requires the user-provided `google-services.json` referenced by `apps/mobile/app.json`. That file remains gitignored, so a reproducible provisioning strategy is still a review decision; see Review Findings. `registerPushToken()` continues to fail closed if token acquisition is unavailable (logs and returns, never crashes the app).

**Expo Go cannot exercise this feature on Android — a known Expo platform limitation, not a bug to chase.** Since Expo SDK 53, remote/push notifications are unavailable in Expo Go on Android; the installed `expo-dev-client` or a full EAS build is required. Real devices are required regardless of build type — `Device.isDevice` (Task 5) intentionally no-ops on simulators/emulators. A physical Android development build was used successfully during this story's live verification.

**No custom permission-request screen — none is specified anywhere in the UX spec.** EXPERIENCE.md's onboarding flow (MA-01–MA-09) has no notification-permission step, and no mockup or flow narrative mentions one. Registration is wired to fire after onboarding completes (root layout, once `isFullyOnboarded` is true — see Task 6), using only the OS's own native permission dialog (`Notifications.requestPermissionsAsync()`), not a bespoke pre-permission screen. Do not add one, and do not insert this into the MA-01–08 sequencing guard (UX-DR6) — this fires after that sequence ends, not inside it.

**Do not build:** `send_push_notification()`, the `pg_net` extension, any pg_cron job or `payments` trigger wiring (Story 6.2/6.3), `member_preferences`/notification opt-out (Story 6.4), any in-app notification-received UI (banner, badge count, tap-to-navigate) — none of that is specified by this story's ACs, all of it belongs to a later Epic 6 story.

**`apps/dashboard` and `apps/super-admin` are untouched by this story.** Everything lives in `supabase/`, `packages/types/`, and `apps/mobile/`.

## Acceptance Criteria

1. **Given** the app has notification permission, **when** it launches, **then** an Expo push token is registered and stored per device. [Source: epics.md#Story 6.1 AC#1; FR-074, FR-077] (Note: "has notification permission" covers both an already-granted prior permission and a fresh grant via the OS's own permission prompt fired at launch — see Scope Notes on why there is no custom pre-permission screen. If permission is denied, no token is requested or stored; this story does not add a re-prompt or nag flow.)
2. **Given** FCM or APNs returns a token as invalid, **when** the next delivery attempt occurs, **then** the stale token is cleaned up automatically. [Source: epics.md#Story 6.1 AC#2; FR-077] (Note: this story builds `private.cleanup_invalid_device_push_token()`, the reusable deletion primitive, and pgTAP-tests it directly by calling it. There is no "delivery attempt" yet to wire it to — Story 6.2/6.3's `send_push_notification()` is what will actually call this function on an Expo `DeviceNotRegistered`/invalid-token response. See Scope Notes.)

## Tasks / Subtasks

- [x] **Task 1: Migration `supabase/migrations/0042_expo_push_token_registration_cleanup.sql`** (AC: #1, #2)
  - [x] New enum, defined in this migration file (not retrofitted into `0001_extensions_and_enums.sql`) — matches `0032_payment_reconciliation_job.sql`'s own precedent of a later migration introducing its own new enum type:
    ```sql
    create type device_platform as enum ('ios', 'android');
    ```
  - [x] `device_push_tokens` table (child of `users`, no `gym_id` — Scope Notes):
    ```sql
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

    grant select, insert, update, delete on device_push_tokens to authenticated, service_role;
    ```
    No `on delete cascade`/`on delete` clause on the `user_id` FK — matches this codebase's existing accepted gap on every other bare FK (e.g. `coach_assignments`, `session_notes`).
  - [x] Self-scoped RLS — explicit per-action policies, no `for all` (architecture.md's RLS policy strategy rule), mirrors `0015_users_self_service_language_preference.sql`'s `self_read_own_user`/`self_update_own_language` shape:
    ```sql
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
    ```
    Deliberately no DELETE policy for `authenticated` — a session never deletes its own token row directly in this story; the only delete path is the function below. Deny-all default blocks it, which is intended, not a gap.
  - [x] Cleanup primitive (AC #2 — Scope Notes on why this has no caller yet):
    ```sql
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
    ```
    `security definer` is required, not optional: it must be able to delete *any* user's stale row, not just the caller's own, which no policy above allows. Granted to `service_role` only — no ordinary `authenticated` session has a legitimate reason to delete a token row by string value.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (WSL shell — see Dev Notes). Expect a new `device_push_tokens` table type (alphabetically between `coach_assignments` and `front_desk_alerts`) and a new `device_platform` enum entry; `private.cleanup_invalid_device_push_token` is in the `private` schema so it will not appear in the generated `public` types, same as `private.is_assigned_coach`/`private.is_own_coach_id`.

- [x] **Task 2: `packages/types/src/schemas/devicePushToken.ts`** (new) (AC: #1)
  - [x] Single schema, validated at the mobile write boundary (Task 5) even though the values originate from Expo's own API, not raw user input — matches this codebase's "Zod schemas at every write boundary" rule:
    ```ts
    import { z } from "zod";

    export const devicePushTokenSchema = z.object({
      expoPushToken: z.string().min(1),
      platform: z.enum(["ios", "android"]),
    });

    export type DevicePushTokenInput = z.infer<typeof devicePushTokenSchema>;
    ```
  - [x] Export from `packages/types/src/index.ts` (`export * from "./schemas/devicePushToken";`), same list every other schema file is already in.

- [x] **Task 3: `apps/mobile` — install `expo-notifications`** (AC: #1)
  - [x] From `apps/mobile`: `npx expo install expo-notifications` (not plain `npm install`/`pnpm add` — this resolves the exact SDK-57-compatible version, matching how every other `expo-*` dependency in this app's `package.json` was added).
  - [x] Add the bare plugin entry to `apps/mobile/app.json`'s `plugins` array (no icon/sound customization needed for this story — no in-app notification display exists yet, matching the bare-string style already used for `"expo-localization"`/`"expo-sqlite"`):
    ```json
    "expo-notifications"
    ```

- [x] **Task 4: `apps/mobile/src/services/pushTokens.ts`** (new) (AC: #1, #2)
  - [x] `registerPushToken(userId: string): Promise<void>` — physical-device guard, Android notification channel (required before requesting permission on Android 13+, per Expo's own SDK 57 docs), permission check/request, token fetch, upsert:
    ```ts
    import Constants from 'expo-constants';
    import * as Device from 'expo-device';
    import * as Notifications from 'expo-notifications';
    import { Platform } from 'react-native';

    import { devicePushTokenSchema } from '@gymos/types';

    import { supabase } from '@/lib/supabase';

    export async function registerPushToken(userId: string): Promise<void> {
      try {
        if (!Device.isDevice) return;

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
        const { data: token } = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );

        await upsertPushToken(userId, token, Platform.OS as 'ios' | 'android');
      } catch (err) {
        console.error('[push] registerPushToken failed', err);
      }
    }

    async function upsertPushToken(userId: string, expoPushToken: string, platform: 'ios' | 'android'): Promise<void> {
      const parsed = devicePushTokenSchema.safeParse({ expoPushToken, platform });
      if (!parsed.success) return;

      await supabase.from('device_push_tokens').upsert(
        { user_id: userId, expo_push_token: parsed.data.expoPushToken, platform: parsed.data.platform },
        { onConflict: 'user_id,expo_push_token' },
      );
    }

    export function subscribeToPushTokenChanges(userId: string): () => void {
      const subscription = Notifications.addPushTokenListener((token) => {
        void upsertPushToken(userId, token.data, Platform.OS as 'ios' | 'android');
      });
      return () => subscription.remove();
    }
    ```
    `try/catch` around the whole registration path is deliberate: a missing EAS `projectId`, a denied permission, or a network failure must never crash the app or block navigation — this is a best-effort background action, same resilience posture as `checkin.ts`'s `syncPendingCheckIns()`. `subscribeToPushTokenChanges` covers Expo's own documented token-rotation case (SDK 57 docs: "a push token may be changed by the push notification service while the app is running").

- [x] **Task 5: Wire into `apps/mobile/src/app/_layout.tsx`** (AC: #1)
  - [x] In `RootNavigator`, once `isFullyOnboarded` is true (same gate the auth `Stack.Protected` guard already uses), call `registerPushToken(session.user.id)` once and subscribe to token changes, unsubscribing on unmount/session change:
    ```tsx
    useEffect(() => {
      if (!isFullyOnboarded || !session) return;
      void registerPushToken(session.user.id);
      return subscribeToPushTokenChanges(session.user.id);
    }, [isFullyOnboarded, session]);
    ```
  - [x] Fire-and-forget: this must not delay hiding the splash screen or block the `(tabs)`/`onboarding` navigation switch already driven by `isLoading`/`isFullyOnboarded`.

- [x] **Task 6: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) `device_push_tokens` is a child of `users`, not `gyms`/`members` (no `gym_id`) — rationale; (2) composite `unique(user_id, expo_push_token)` chosen over a global-unique token to avoid an RLS-blocks-its-own-update trap on device handoff between accounts, and the accepted V1 gap that implies (Scope Notes); (3) `private.cleanup_invalid_device_push_token()` is built ahead of any caller — a reusable primitive Story 6.2/6.3's `send_push_notification()` will invoke, not a fully wired pipeline yet; (4) the EAS-project-not-linked and Expo-Go-can't-test-Android environment prerequisites, and their status as of this story's completion (linked or still blocking).

- [x] **Task 7: pgTAP coverage — `supabase/tests/expo_push_token_registration_cleanup.test.sql`** (new file) (AC: #1, #2)
  - [x] This is the first RLS test file in this codebase with no gym-scoping dimension at all — seed only `auth.users`/`users` rows for two independent accounts (no `gyms`/`members`/`tiers` fixtures needed), and simulate sessions the same way `coach_portal_member_detail_session_notes.test.sql` does, but with only `sub`/`role` claims (no `gym_id`/`app_role` needed, since RLS here never reads either):
    ```sql
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
    ```
  - [x] As User A: insert own row succeeds; `select` returns only A's own rows, never User B's; `update` own row (e.g. bump `platform`) succeeds.
  - [x] As User A: attempting to `insert` a row with `user_id` = User B's id is denied (`WITH CHECK` failure). Attempting to `update`/`select` User B's row by its `id` returns zero rows / fails.
  - [x] As User A: attempting a direct `delete` on their own row is denied (no DELETE policy exists for `authenticated` — deny-all default applies).
  - [x] `(user_id, expo_push_token)` upsert behavior: two `insert ... on conflict (user_id, expo_push_token) do update set updated_at = now()` calls with the same pair leave exactly one row, with `updated_at` advancing.
  - [x] `device_platform` enum: inserting a value outside `('ios', 'android')` fails.
  - [x] `private.cleanup_invalid_device_push_token()`: called directly (as `service_role`, matching how other `private`-schema `SECURITY DEFINER` functions are exercised in this codebase's test files where a non-owning caller must succeed), deletes the matching row **regardless of which user owns it** — this is the actual point of the function, test it against a token owned by a different user than whatever role the test happens to be running as. A call with a non-matching token is a no-op (no error, zero rows affected).
  - [x] Cross-user privacy regression (this story's own most-important test, same weight prior epics' central RLS test carries): seed User A's and User B's tokens, confirm `select * from device_push_tokens` as A never returns B's row and vice versa.

- [x] **Task 8: Validation and manual verification** (AC: all)
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors (no new locale keys are added by this story — no custom UI text; confirm the script still passes clean as a regression check).
  - [x] `supabase test db` (WSL shell) — zero regressions against the pre-story baseline plus this story's new test file.
  - [x] Manual verification is environment-gated (Scope Notes) — attempt in this order, and record in Completion Notes exactly how far this got:
    1. If no EAS project is linked and no EAS credentials are available: confirm the app still launches and functions normally end-to-end (onboarding, check-in, etc.) with `registerPushToken` failing closed (caught, logged, no crash) — this is the maximum verifiable state without account access. State this plainly; do not claim a real token was obtained.
    2. If an EAS project can be linked (`eas init`) and a development build produced: install on a physical Android and/or iOS device, grant notification permission at first launch, and confirm a `device_push_tokens` row appears for that user via the Supabase Studio table view (WSL-local or the linked project, per Dev Notes) with a plausible `ExponentPushToken[...]`-shaped value.
    3. Do not attempt to verify this via Expo Go on Android — confirmed unsupported since SDK 53 (Scope Notes).

### Review Findings

- [x] [Review][Decision] Define a reproducible Firebase configuration strategy — resolved: keep the local file gitignored and provision it as the secret EAS file variable `GOOGLE_SERVICES_JSON` in the `development`, `preview`, and `production` environments. Dynamic app config uses the EAS-provided path remotely and `./google-services.json` locally. [apps/mobile/app.config.js:1]
- [x] [Review][Patch] Surface Supabase upsert failures instead of silently treating `{ error }` results as successful token registration. [apps/mobile/src/services/pushTokens.ts:70]
- [x] [Review][Patch] Depend on the stable session user ID so auth-session object refreshes do not unnecessarily re-register tokens and recreate the listener. [apps/mobile/src/app/_layout.tsx:35]
- [x] [Review][Patch] Make the `updated_at` trigger migration table-specific and collision-safe; the current generic public function and trigger-name-only guard can replace or skip unrelated schema objects. [supabase/migrations/0044_set_updated_at_trigger_for_device_push_tokens.sql:4]
- [x] [Review][Patch] Make the pgTAP assertion prove `updated_at` actually advances; `updated_at >= created_at` passes when the trigger is absent. [supabase/tests/expo_push_token_registration_cleanup.test.sql:149]
- [x] [Review][Patch] Update the decisions log and story prerequisite notes that still claim EAS, project ID, dev client, and live-device verification are outstanding. [docs/decisions.md:7]
- [x] [Review][Patch] Add migrations 0043/0044 and the negative permission test to the story File List. [_bmad-output/implementation-artifacts/6-1-expo-push-token-registration-cleanup.md:284]
- [x] [Review][Patch] Remove the committed `pushTokens.test.ts` artifact, which imported Jest without any configured or locked Jest runner and broke the required workspace typecheck; retain pgTAP and live-device coverage until a mobile test harness is deliberately introduced. [apps/mobile/src/services/pushTokens.test.ts:1]

**Review round 2 (branch `bmad/6.1-expo-push-fixes` @ `207c9fa`, diff vs `master`) — 2026-08-04:**

- [x] [Review][Patch] Commit the already-fixed working-tree changes to migration 0044 and the negative test — as committed at `207c9fa`, 0044 still uses a generic `public.set_updated_at_timestamptz()` function name and a `pg_trigger` guard scoped only by `tgname` (no `tgrelid` check), and the negative test has no `begin`/`select plan(1)`/`select * from finish()`/`rollback` wrapper (likely breaks `supabase test db`/CI, and `SET LOCAL ROLE` outside a transaction has no lasting effect). Both are already corrected in the uncommitted working tree — stage and commit them. [supabase/migrations/0044_set_updated_at_trigger_for_device_push_tokens.sql:4, supabase/tests/expo_push_token_registration_cleanup.negative.test.sql:1]
- [x] [Review][Patch] Strengthen the negative test to match the sibling pattern: it only exercises `authenticated` and has no static privilege assertion, while `subscription_lifecycle_notifications.negative.test.sql` checks both `anon` and `authenticated` via `has_function_privilege` plus `throws_like`. [supabase/tests/expo_push_token_registration_cleanup.negative.test.sql:1]
- [x] [Review][Patch] Fix style inconsistency: 0043/0044 use uppercase SQL keywords and schema-qualify `public.device_push_tokens`, unlike 0042 and the rest of the migration history (lowercase, unqualified, relying on `search_path`). [supabase/migrations/0043_add_idx_device_push_tokens_expo_push_token.sql:4]
- [x] [Review][Patch] Add a one-line comment explaining why 0044's trigger creation uses a rerun-safety guard (`DO $$ ... IF NOT EXISTS ... EXECUTE 'CREATE TRIGGER ...'`) when every other `CREATE TRIGGER` in this codebase (0003, 0014, 0015, 0018, 0020, 0031, 0034) is a plain unguarded statement, or drop the guard to match convention. [supabase/migrations/0044_set_updated_at_trigger_for_device_push_tokens.sql:15]
- [x] [Review][Defer] No `CONCURRENTLY` on the new `idx_device_push_tokens_expo_push_token` index — takes an ACCESS EXCLUSIVE lock during build. Not a regression (only one other migration in this codebase's history ever uses `CONCURRENTLY`) and harmless today on a brand-new, empty table — deferred, pre-existing pattern. [supabase/migrations/0043_add_idx_device_push_tokens_expo_push_token.sql:4]

## Dev Notes

- **Read before starting:** `supabase/migrations/0015_users_self_service_language_preference.sql` (the exact self-scoped-by-`auth.uid()`, explicit-per-action-policy RLS shape this story's own policies mirror), `supabase/migrations/0032_payment_reconciliation_job.sql` (precedent for a later migration introducing its own new enum type, rather than retrofitting `0001_extensions_and_enums.sql`), `supabase/migrations/0040_coach_portal_member_list_rls.sql` and `0041_coach_portal_member_detail_session_notes.sql` (the `private`-schema `SECURITY DEFINER` helper-function pattern this story's `cleanup_invalid_device_push_token()` follows), `supabase/tests/coach_portal_member_detail_session_notes.test.sql` (the `set local role authenticated` + `set_config('request.jwt.claims', ...)` session-simulation convention, Task 7), `apps/mobile/src/services/checkin.ts` (the `try/catch`-wrapped, never-throws service-function resilience pattern this story's `registerPushToken` follows), `apps/mobile/src/hooks/use-session.ts` (`session.user.id` is the value this story passes as `userId`), `apps/mobile/src/app/_layout.tsx` (the exact `RootNavigator`/`isFullyOnboarded` gate this story's registration effect hooks into), `apps/mobile/AGENTS.md` ("Expo HAS CHANGED" — read the versioned SDK 57 docs before writing any `expo-notifications` code; this story's API calls were already verified against `https://docs.expo.dev/versions/v57.0.0/sdk/notifications/` during story creation — see References).
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must run from a WSL shell. [Memory: Supabase runs in WSL.]
- **`expo-device` and `expo-constants` are already installed** (`apps/mobile/package.json`) — do not add them again; only `expo-notifications` is genuinely new to this story.
- **Testing standard:** pgTAP is the primary automated coverage (Task 7); the cross-user privacy regression is this story's single most important test, same weight every prior epic's central RLS test has carried — a wrong policy here leaks one member's push token association to another account's queries. Manual device verification is explicitly environment-gated (Task 8) — do not claim it succeeded if the EAS-project or Expo-Go limitations described in Scope Notes blocked it.
- **Do not build:** `send_push_notification()`, `pg_net`, any cron/trigger wiring, `member_preferences`/opt-out UI, or any in-app notification-received handling — see Scope Notes for exactly which future story owns each.
- **`apps/dashboard` and `apps/super-admin` are untouched by this story.**

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0042_expo_push_token_registration_cleanup.sql   (new)
  supabase/tests/expo_push_token_registration_cleanup.test.sql        (new)
  packages/types/src/database.ts                                     (regenerated)
  packages/types/src/schemas/devicePushToken.ts                      (new)
  packages/types/src/index.ts                                        (modified — new export line)
  apps/mobile/package.json                                           (modified — expo-notifications added)
  apps/mobile/app.json                                                (modified — expo-notifications plugin entry)
  apps/mobile/src/services/pushTokens.ts                              (new)
  apps/mobile/src/app/_layout.tsx                                     (modified — registration wiring)
  docs/decisions.md                                                   (modified)
  ```
  - Matches architecture.md's Requirements-to-Structure mapping ("Expo push token management in `apps/mobile/services/`") with the one already-established path adjustment every prior mobile story makes: the real directory is `apps/mobile/src/services/`, not `apps/mobile/services/` — same drift `apps/mobile/services/checkin.ts` et al. already live under.
  - No `apps/dashboard`/`apps/super-admin` changes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-074, FR-075, FR-077] — Expo→FCM/APNs routing only, V1 notification schedule, per-device token storage + automatic invalid-token cleanup
- [Source: _bmad-output/planning-artifacts/architecture.md "Gap 1" resolution] — `send_push_notification()`/`pg_net` own the actual dispatch+cleanup mechanism, built in Story 6.2/6.3, not this story
- [Source: _bmad-output/planning-artifacts/architecture.md Requirements-to-Structure Mapping row, "Push Notifications (FR-074–078)"] — "Expo push token management in `apps/mobile/services/`"
- [Source: _bmad-output/planning-artifacts/architecture.md line 540] — "every child table below `gyms` carries `gym_id`" rule, and why `device_push_tokens` is correctly exempt (it isn't a child of `gyms`)
- [Source: _bmad-output/planning-artifacts/architecture.md RLS policy strategy] — explicit per-action policies, never `for all`
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md MA-01–MA-09 table] — confirms no notification-permission screen exists in the onboarding flow
- [Source: supabase/migrations/0015_users_self_service_language_preference.sql] — the self-scoped `auth.uid()` RLS template this story's policies mirror
- [Source: supabase/migrations/0032_payment_reconciliation_job.sql] — precedent for a later migration defining its own new enum type
- [Source: supabase/migrations/0040_coach_portal_member_list_rls.sql, 0041_coach_portal_member_detail_session_notes.sql] — `private`-schema `SECURITY DEFINER` helper-function pattern
- [Source: apps/mobile/src/services/checkin.ts] — service-function resilience pattern (never throws, best-effort)
- [Source: apps/mobile/src/hooks/use-session.ts] — `session.user.id`, `isOnboarded`/`isLoading` semantics
- [Source: apps/mobile/src/app/_layout.tsx] — `RootNavigator`/`isFullyOnboarded` gate this story hooks into
- [Source: apps/mobile/package.json] — confirms `expo-device`/`expo-constants` already installed, `expo-notifications` genuinely new; Expo SDK `~57.0.7` pin
- [Source: apps/mobile/app.json] — no `extra.eas.projectId`, no `eas.json` in this repo — the EAS-project prerequisite (Scope Notes)
- [Source: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/, fetched during story creation] — `getPermissionsAsync`/`requestPermissionsAsync`, `getExpoPushTokenAsync({ projectId })`, Android `setNotificationChannelAsync` must precede token requests on Android 13+, `addPushTokenListener` for token rotation, remote push unavailable in Expo Go on Android since SDK 53, `expo-notifications` config plugin

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None.

### Completion Notes List

- Migration `0042_expo_push_token_registration_cleanup.sql` applied cleanly against a fresh `supabase db reset` (WSL); `packages/types/src/database.ts` regenerated and diffed as expected — new `device_push_tokens` table type (alphabetically between `coach_assignments` and `front_desk_alerts`) and `device_platform` enum entry; `private.cleanup_invalid_device_push_token` correctly absent from the generated `public` types (lives in `private` schema).
- pgTAP: `supabase/tests/expo_push_token_registration_cleanup.test.sql` (22 assertions) covers self-scoped RLS (own insert/select/update succeed; cross-user insert/select/update denied; direct delete denied for both users, confirming the no-DELETE-policy deny-all default), the `(user_id, expo_push_token)` upsert/idempotency behavior, the `device_platform` enum constraint, `private.cleanup_invalid_device_push_token()` deleting a different user's row when called as `service_role` plus its no-op behavior on a non-matching token, and the cross-user privacy regression (this file's most important assertion, per Dev Notes).
- Full suite: `supabase test db` (WSL) — 638/638 passing across 35 files, zero regressions. One transient failure was observed on an interim run (`check_out_manual_auto_timeout.test.sql`, "have: 2 want: 1" on a `job_runs` success-row count) — root-caused to the long-lived local Supabase stack's real `pg_cron` schedule (`check_in_auto_timeout` fires every 15 minutes) ticking for real during this session's extended wall-clock time, not anything this story's migration/tests touch. Confirmed by re-running `supabase db reset` immediately followed by `supabase test db`: all 638 tests passed clean, including that file.
- `pnpm run typecheck` (all 4 packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors, all 4 locale directories in parity (no new locale keys added by this story, matching the no-custom-UI-text scope). `pnpm run lint` — `@gymos/dashboard` and `@gymos/super-admin` clean; `@gymos/mobile`'s `expo lint` fails with `'eslint' is not recognized as an internal or external command` — confirmed via `git stash` that this identical failure pre-exists on the baseline commit (before any file this story touches existed), i.e. an environment tooling gap (eslint not resolvable via PATH for this Windows/pnpm setup), not a regression introduced by this story.
- **Manual verification — completed live, end-to-end, on a physical Android device (post-review update, same day).** Initial completion (above) was environment-blocked; the user then provided a physical Android device and an Expo account, superseding that state. Ran `eas init` (linked `@josephfeussi/gymos`, `extra.eas.projectId` written to `app.json`), added `expo-dev-client`, hand-authored `eas.json` (`build:configure` requires an interactive TTY this session didn't have), and produced an EAS cloud development build. First build attempt hit `Error: unable to get Firebase Messaging instance` — Android push requires a Firebase project + `google-services.json`, which this repo never had; the user created one, and a second build with it wired into `app.json`'s `android.googleServicesFile` succeeded (the file itself stays gitignored — not committed — and was only temporarily un-ignored for the EAS upload step, since EAS Build's archiver skips gitignored files by default). Seeded a throwaway local test gym/tier/plan/member/subscription (fake `+237` number, not the user's real number) plus a Supabase `auth.sms.test_otp` fixed-code mapping so the phone-OTP onboarding flow could be completed on-device without a real SMS provider. **Confirmed end-to-end**: installed the dev build, completed onboarding, granted the OS notification permission prompt, and a real `ExponentPushToken[...]` row appeared in `device_push_tokens` for the test member — AC #1 genuinely verified working, not just code-reviewed.
- **Bug found via this live test, fixed same session: `subscribeToPushTokenChanges` was storing the wrong token type.** `Notifications.addPushTokenListener()`'s callback receives the raw native `DevicePushToken` (an FCM registration token on Android), never an `ExpoPushToken` — confirmed against Expo's SDK 57 docs after the device test produced direct evidence: two rows landed in `device_push_tokens` for the same user, one correctly `ExponentPushToken[...]`-shaped (from `registerPushToken`'s `getExpoPushTokenAsync()` call) and one a raw FCM token string (`fMNgDb3...`, from the listener storing `token.data` directly, exactly as Task 4's own original spec code did). Expo's push service cannot deliver to a raw FCM token under this app's schema — it would have silently produced an undeliverable `device_push_tokens` row on every token-rotation event in production, never caught by pgTAP (which only exercises the DB/RLS layer, not what Expo's client APIs actually return). Fixed by extracting a shared `fetchAndStorePushToken()` that always calls `getExpoPushTokenAsync()` fresh; `subscribeToPushTokenChanges`'s listener now ignores the native token payload entirely and just triggers that re-fetch, matching Expo's documented token-rotation guidance exactly. Re-ran `pnpm run typecheck` (0 errors) after the fix; the erroneous raw-FCM-token row was deleted from local test data. No pgTAP changes needed (RLS/schema untouched by this fix, purely a client-side call-shape correction).

### File List

- `supabase/migrations/0042_expo_push_token_registration_cleanup.sql` (new)
- `supabase/migrations/0043_add_idx_device_push_tokens_expo_push_token.sql` (new — cleanup lookup index)
- `supabase/migrations/0044_set_updated_at_trigger_for_device_push_tokens.sql` (new — automatic `updated_at` maintenance)
- `supabase/tests/expo_push_token_registration_cleanup.test.sql` (new)
- `supabase/tests/expo_push_token_registration_cleanup.negative.test.sql` (new — authenticated-role execution denial)
- `packages/types/src/database.ts` (regenerated)
- `packages/types/src/schemas/devicePushToken.ts` (new)
- `packages/types/src/index.ts` (modified — new export line)
- `apps/mobile/package.json` (modified — `expo-notifications` added)
- `apps/mobile/app.json` (modified — `expo-notifications` plugin entry and `extra.eas.projectId`)
- `apps/mobile/app.config.js` (new — EAS `GOOGLE_SERVICES_JSON` file-variable wiring with local fallback)
- `apps/mobile/eas.json` (new — development/preview/production build profiles)
- `apps/mobile/.gitignore` (modified — `google-services.json` excluded)
- `apps/mobile/src/services/pushTokens.ts` (new; post-review fix — token-rotation listener no longer stores the raw native token)
- `apps/mobile/src/app/_layout.tsx` (modified — registration wiring)
- `docs/decisions.md` (modified)
- `pnpm-lock.yaml` (modified — `expo-notifications` dependency resolution)

### Change Log

- 2026-08-03: Story 6.1 implementation complete — Expo push token registration & cleanup, migration 0042 (`device_push_tokens`, `device_platform` enum, self-scoped RLS, `private.cleanup_invalid_device_push_token()`), 22 new pgTAP assertions, `devicePushTokenSchema`, `pushTokens.ts` service (`registerPushToken`/`subscribeToPushTokenChanges`), `_layout.tsx` wiring gated on `isFullyOnboarded`, decisions log entry. Manual device verification environment-blocked (no EAS project/credentials, no physical device) — stated plainly, no live token claimed. Status → review.
- 2026-08-03: Post-review live device verification. User provided a physical Android device + Expo account. Linked EAS project, added Firebase (`google-services.json`, user-provided), produced two EAS development builds (first failed on missing Firebase config, second succeeded). Seeded throwaway local test fixtures (fake-phone member/gym/plan/subscription + `auth.sms.test_otp`) to complete onboarding without real SMS. Confirmed AC #1 end-to-end: real `ExponentPushToken[...]` row written to `device_push_tokens` after granting notification permission on-device. **Found and fixed a real bug during this test**: `subscribeToPushTokenChanges` was storing the raw native FCM `DevicePushToken` from `addPushTokenListener` instead of re-fetching a proper `ExponentPushToken` via `getExpoPushTokenAsync()` — confirmed against Expo's SDK 57 docs, would have produced undeliverable token rows on every rotation in production. Typecheck re-verified clean (0 errors) after the fix.
- 2026-08-03: Code-review fixes applied. Token upsert errors are surfaced, the root effect keys off stable `sessionUserId`, migration 0044 is table-specific/collision-safe, pgTAP now proves the `updated_at` trigger fires, stale EAS documentation and the File List are corrected, and the unconfigured Jest artifact that broke workspace typecheck was removed. Firebase build provisioning decision resolved with a project-scoped secret EAS file variable (`GOOGLE_SERVICES_JSON`) assigned to all three standard environments and consumed through `app.config.js`; the local file remains gitignored. Validation: workspace typecheck passed, clean database reset passed, and all 639 pgTAP assertions across 36 files passed.
