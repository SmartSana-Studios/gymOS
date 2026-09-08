# Story 1.17: Multi-Gym Ownership — Assign a Gym to an Existing Owner

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Super Admin,
I want to create a gym whose owner is a person who already has a GymOS account,
so that one operator can run several branches from a single login instead of juggling one account per gym.

**Context — not derived from `epics.md`.** Raised by smartsana on 2026-09-08 while preparing for real-gym testing ("can a gym owner own many gyms?"). Investigation established that this is a **provisioning gap, not a data-model gap** — the multi-gym machinery is already built and shipped:

- `public.members` has **no unique constraint on `user_id`** (verified against the deployed database: only `members_pkey` on `id`, plus FKs to `gyms`/`users`). One person can already hold many membership rows, each with its own `role`.
- Epic 9 built the session half: `switch_active_gym()` (`0065_multi_gym_session_switching.sql`, Story 9.6) and `list_own_active_gym_memberships()` (`0074`), surfaced by `GymSwitcher.tsx` whenever `availableGyms.length > 1`.
- FR-001 already states "a user may be a member at multiple gyms via separate `members` rows."

The only thing missing is a way to *create* that second owner membership. Two independent paths block it today, and the story must address the first without weakening the second:

1. **`createGym` always mints a new account.** `apps/super-admin/app/(admin)/gyms/actions.ts` Step 3 calls `admin.auth.admin.createUser({ email, ... })` unconditionally. Given an email that already exists, GoTrue rejects it, and the error branch runs compensating cleanup (`deleteGym(gymRow.id)`) — so the attempt leaves nothing behind, but also achieves nothing.
2. **No in-gym path exists, deliberately.** `create_staff_member`'s role ceiling (`0061_staff_creation_role_ceiling_enforcement.sql:97-107`) lets an Owner create `supervisor`/`manager`/`receptionist`/`coach` and a Supervisor create `manager`/`receptionist`/`coach`. **`owner` is absent from both allowlists.** This story must not change that — ownership is a Super Admin lifecycle action, not something a tenant grants itself.

## Acceptance Criteria

1. **Given** the Super Admin's Create Gym form, **when** the submitted `ownerEmail` matches an existing `auth.users` row, **then** the gym is created and an `owner` membership row is inserted for that existing account — no new `auth.users` row, no temp password generated, no WhatsApp message sent — and the gym appears in that owner's gym switcher on their next session.

2. **Given** the same flow, **then** `createGym`'s result distinguishes the two outcomes so the UI cannot make a false claim. Extend `CreateGymResult` with `ownerOutcome: "created" | "linked"`; `tempPassword` and `smsSent` are `null`/`false` for `"linked"`. This mirrors Story 1.16's `outcome: "created" | "promoted" | "already_super_admin"` discriminator, added for exactly this reason (`admins/actions.ts`).

3. **Given** an owner account was linked rather than created, **then** the success UI must not display a temporary password or claim credentials were sent. It tells the Super Admin the gym was assigned to the existing account and that the owner signs in with their existing password. New i18n keys in **both** `en.json` and `fr.json` (parity is enforced — 297 keys in `apps/super-admin/locales` at story-creation time).

4. **Given** a linked owner, **then** their `public.users` row is **not** modified — in particular `must_change_password` is **not** reset to `true`. That column defaults `true` at the DB level (`0016_owner_must_change_password.sql`) and is only meaningful for a freshly minted temp-password account; forcing an established owner back through `/auth/update-password` because they were given a second gym is a regression. `submittedName`/`submittedPhone` populate the **new `members` row only** (`members.name`, `members.phone`), which is per-membership by design.

5. **Given** the submitted email belongs to an account with `public.users.is_super_admin = true`, **then** the action is refused with a distinct, translated error and nothing is written. A Super Admin holding a tenant membership collapses the platform/tenant boundary that Epic 1's isolation model rests on — it is the precise situation Story 1.7's time-boxed escalation grants (`0085`/`0086`) exist to avoid making permanent.

6. **Given** the deployed schema permits it today, **then** a new migration adds a partial unique index preventing the same user holding two *active* memberships at the same gym:
   `create unique index idx_members_one_active_membership_per_gym on members (gym_id, user_id) where deactivated_at is null;`
   Re-verify the next free migration number at implementation time (`ls supabase/migrations | tail`); highest at story creation is `0088_promote_to_super_admin_self_enforcing.sql`, so expect `0089`. **Check for pre-existing violations before adding the index** — it will fail to build if any duplicate pair exists.

7. **Given** a second owner membership is created, **then** the owner's *next* login lands them in the **new** gym, because `custom_access_token_hook()` (`0009_auth_hook_gym_claims.sql:54`) resolves claims to "the most recently created, non-deactivated membership". This is pre-existing documented behavior, not a defect introduced here, and `switch_active_gym()` is the remedy. The story must **verify** the switcher works for an owner — `switch_active_gym` (`0065:34-48`) checks only that the caller has an active membership at the target gym and is **role-agnostic**, so no RPC change is expected. If verification shows otherwise, that is a finding to report, not to silently patch.

8. **Given** this story ships, **then** the following are explicitly **out of scope**, not deferred-and-forgotten: transferring a gym to a different owner; removing/replacing an owner; more than one owner per gym; any change to `create_staff_member`'s role ceiling; any self-service path for an Owner to acquire another gym.

## Tasks / Subtasks

- [ ] **Task 1: Migration — one active membership per (gym, user)** (AC: #6)
  - [ ] Confirm the next migration number is unclaimed (`ls supabase/migrations | tail`).
  - [ ] Query for existing violations first: `select gym_id, user_id, count(*) from members where deactivated_at is null group by 1,2 having count(*) > 1;` — resolve any before adding the index.
  - [ ] Add the partial unique index. Partial on `deactivated_at is null` so a deactivated-then-rehired staff member's historical row does not block re-adding them (`0063_staff_edit_deactivation.sql` establishes deactivation as a soft state).
  - [ ] Add a pgTAP test in `supabase/tests/` asserting a second active row for the same `(gym_id, user_id)` is rejected and a deactivated one is not. Full suite was 1806/1806 at Story 1.16.

- [ ] **Task 2: Owner-account resolution in `createGym`** (AC: #1, #2, #4, #5)
  - [ ] In `apps/super-admin/app/(admin)/gyms/actions.ts`, before Step 3, look up the email with `findUserByEmail(admin, email)` from `apps/super-admin/lib/super-admin-provisioning.mjs` — **reuse it, do not write a second lookup**. Story 1.16 Task 2 extracted it into that shared `.mjs` module precisely so both the CLI and app code could call it; it handles `listUsers()` pagination correctly.
  - [ ] **Not found** → existing behavior unchanged: `createUser` + temp password + WhatsApp. Return `ownerOutcome: "created"`.
  - [ ] **Found and `is_super_admin`** → refuse (AC #5). Return an `AppError`; no gym row, no membership.
  - [ ] **Found, ordinary account** → skip Step 3 and Step 5 entirely. Reuse the existing `user_id` for `insertOwnerMember`. Return `ownerOutcome: "linked"`, `tempPassword: null`, `smsSent: false`.
  - [ ] **Preserve the compensating-cleanup discipline.** Steps 3/4's existing failure branches call `deleteGym(gymRow.id)` and `deleteAuthUserAndLog(...)`. On the linked path there is **no auth user to delete** — deleting it would destroy an account that existed before this request and owns other gyms. Cleanup on the linked path is `deleteGym` **only**. Getting this wrong is the single most destructive mistake available in this story.

- [ ] **Task 3: Types and result shape** (AC: #2)
  - [ ] Extend `CreateGymResult` (`gyms/actions.ts:56`) with `ownerOutcome`. Narrow `tempPassword` to `string | null`.
  - [ ] Update every consumer — `CreateGymModal.tsx` and any success-toast/dialog reading `tempPassword`. `tsc --noEmit` across all four workspace packages is the gate.
  - [ ] No new Zod schema is needed: `createGymSchema` (`packages/types/src/schemas/gym.ts:21-26`) is unchanged — this story changes what the server does with `ownerEmail`, not what the form accepts.

- [ ] **Task 4: UI copy and i18n** (AC: #3, #5)
  - [ ] Branch the Create Gym success state on `ownerOutcome`. `"created"` keeps today's temp-password display; `"linked"` shows the assigned-to-existing-account message.
  - [ ] Add the linked-success and super-admin-refusal strings to `en.json` and `fr.json`. Run the repo's i18n parity check — en/fr must match exactly.

- [ ] **Task 5: Audit trail** (AC: #1, #2)
  - [ ] `logGymCreated` already receives a metadata object (`gyms/actions.ts:201-206`: `owner_name`, `owner_phone`, `tier_id`, `sms_sent`). Add `owner_outcome` to it. Do **not** invent a second `action_type` — the gym was created either way, and the audit row's metadata is the right place for the distinction.

- [ ] **Task 6: Verification** (AC: #1, #7)
  - [ ] Automated: `pnpm --filter super-admin typecheck`, `lint`, `test`; pgTAP suite; i18n parity; production build.
  - [ ] Manual (smartsana, per this project's established practice): create gym A with a new owner; create gym B with **the same email**; sign in as that owner; confirm the `GymSwitcher` appears in the sidebar header and switches between A and B; confirm no forced password change; confirm the gym-B success screen showed no temp password.
  - [ ] **Check the switcher in dark mode.** It was repaired on 2026-09-08 (commit `f7f87dc`) after the sidebar moved onto dedicated `--sidebar` tokens left its trigger near-black on a dark surface. This story is the first to exercise it with a real two-gym account.

## Dev Notes

### Current state of the files being modified

**`apps/super-admin/app/(admin)/gyms/actions.ts` — `createGym`** runs six steps, each with compensating cleanup for everything already written:

| Step | Action | Cleanup on failure |
| --- | --- | --- |
| 1 | Fast-fail gym-name pre-check (real guarantee is `idx_gyms_name_unique`) | — |
| 2 | Insert `gyms` row | — |
| 3 | `admin.auth.admin.createUser` (+ generated temp password) | `deleteGym` |
| 4 | `insertOwnerMember` | `deleteGym` + `deleteAuthUserAndLog` |
| 5 | Send temp password over WhatsApp | non-fatal; sets `smsSent: false` |
| 6 | `logGymCreated` | — |

This story inserts a branch before Step 3 and makes Steps 3 and 5 conditional. **Steps 2, 4 and 6 run identically on both paths.**

**`insertOwnerMember`** (`apps/super-admin/services/gyms.ts:969-983`) inserts `role: "owner"` through the **session-scoped** client, not the admin client, and deliberately omits `.select()` (its own comment explains: Super Admin's members-SELECT policy only covers `role='owner'` rows they can already re-derive). Unchanged by this story — it already takes a `userId` and does not care where it came from.

### Why this is a provisioning change and not a schema change

Everything below already exists and must be **reused, not rebuilt**:

- `switch_active_gym(p_gym_id)` — `0065:34-48`. Verifies an active membership at the target and updates the session's active gym. **Role-agnostic.**
- `list_own_active_gym_memberships()` — `0074`. `SECURITY DEFINER` read that works even when the current gym is suspended.
- `getDashboardShellContext()` — `apps/dashboard/services/session.ts`. Populates `availableGyms` only when the caller holds 2+ distinct active memberships.
- `GymSwitcher.tsx` — rendered from the dashboard sidebar header on `availableGyms.length > 1`.

A dev agent that adds a new "owner gyms" table, a new switcher, or an `owner_id` column on `gyms` has misread this story.

### The `must_change_password` trap (AC #4)

`public.users.must_change_password` defaults `true` (`0016`). It is a **user-level** column, not per-membership. A linked owner has already completed that flow for their first gym. Any write that resets it — including a well-intentioned "treat every new owner the same" refactor — bounces an established owner to `/auth/update-password` with a password they already set. The linked path must not touch `public.users` at all.

### Why refuse Super Admin accounts (AC #5)

`getDashboardShellContext()` already rejects a `super_admin`-only session reaching the gym dashboard, and its counterpart in `apps/super-admin/app/(admin)/layout.tsx` rejects gym staff reaching `/gyms` — a deliberate symmetric boundary. Giving a Super Admin a real tenant membership would put one identity on both sides of it, and Story 1.7/1.15's escalation grants exist specifically so platform staff reach gym data through an **expiring, audited** grant instead. Refuse at the action, with a translated message.

### Testing standards

`apps/super-admin` uses Vitest (added in Story 16.1 — it had no test runner before). Database behavior is covered by pgTAP under `supabase/tests/`, run against a local `supabase start`. There is no E2E runner; the manual pass in Task 6 is the real verification, consistent with every prior story in this epic.

### Previous story intelligence (Story 1.16)

Story 1.16 solved a structurally identical problem — "an email might already have an account" — and its conclusions apply directly:

- **Discriminated outcomes beat booleans.** 1.16's AC #4 exists because an `already_super_admin` no-op was otherwise indistinguishable from a real promotion, letting the UI claim something that never happened. AC #2 here is the same guard.
- **`findUserByEmail` already exists** in `lib/super-admin-provisioning.mjs`. 1.16 extracted it there for cross-caller reuse. Writing a second lookup is the "reinventing wheels" failure this story is written to prevent.
- **Audit attribution matters.** 1.16 logs via the *session* client so the row carries the real Super Admin's identity rather than a `system:*` label. `logGymCreated` already does the right thing; don't change it.
- **Roll back only what you created.** 1.16's create path deletes the auth user it just made; its promote path reverts `is_super_admin` instead. The equivalent discipline here is Task 2's final bullet — and the stakes are higher, because the account on the linked path is real and owns other gyms.

### Git intelligence (recent work, 2026-09-08)

- `f7f87dc` — `GymSwitcher` trigger and error text repointed onto `--sidebar` tokens after the sidebar's dark-mode fix. This story's manual pass is the first real two-gym exercise of that component; check both themes.
- `1e9de3a` — dashboard gained a persistent `TopBar` (profile/language/theme) and the sidebar gained `--sidebar` tokens. Identity moved out of the sidebar footer; log out stayed. Relevant because the gym switcher still lives in the **sidebar header**, not the top bar.
- `4ece14c` — `getMessagingInstance()` used `.single()` where its own contract promised null-if-absent, which threw a page-level error when the row was missing. Same class of bug to avoid here: **an owner lookup that finds nothing is an expected state, not an error.**

### References

- Story 1.16 — `_bmad-output/implementation-artifacts/1-16-super-admin-in-app-admin-management-ui.md`
- Story 9.6 — `_bmad-output/implementation-artifacts/9-6-multi-gym-session-switching.md`
- `supabase/migrations/0061_staff_creation_role_ceiling_enforcement.sql:97-107` (role ceiling; `owner` excluded)
- `supabase/migrations/0065_multi_gym_session_switching.sql:34-48` (`switch_active_gym`)
- `supabase/migrations/0009_auth_hook_gym_claims.sql:54` (most-recent-membership claim resolution)
- `supabase/migrations/0016_owner_must_change_password.sql`
- `apps/super-admin/app/(admin)/gyms/actions.ts:66-210` (`createGym`)
- `apps/super-admin/services/gyms.ts:969-983` (`insertOwnerMember`)
- `apps/super-admin/lib/super-admin-provisioning.mjs` (`findUserByEmail`)
- `_bmad-output/planning-artifacts/epics.md:26` (FR-001, multi-gym membership)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Open Questions for smartsana

1. **Should the Create Gym form say anything before submit?** Today the Super Admin gets no signal that an email belongs to an existing account until the server responds. An inline "this email already has an account — the gym will be assigned to it" hint would remove the surprise, but needs a lookup-on-blur endpoint. Scoped **out** for now; the post-submit copy in AC #3 carries the message instead.
2. **Should `ownerName`/`ownerPhone` stay editable when linking?** They currently write to the new `members` row, so a branch's contact details can differ per gym — which seems right for real operators. Confirm that matches your intent rather than wanting the existing account's details reused.
