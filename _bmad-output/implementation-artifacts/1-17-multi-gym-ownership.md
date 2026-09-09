---
baseline_commit: c99192eae0f7b8cb87a971b3272c2b7a1d907fae
---

# Story 1.17: Multi-Gym Ownership — Assign a Gym to an Existing Owner

Status: in-progress

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

- [x] **Task 1: Migration — one active membership per (gym, user)** (AC: #6)
  - [x] Confirm the next migration number is unclaimed (`ls supabase/migrations | tail`).
  - [x] Query for existing violations first: `select gym_id, user_id, count(*) from members where deactivated_at is null group by 1,2 having count(*) > 1;` — resolve any before adding the index.
  - [x] Add the partial unique index. Partial on `deactivated_at is null` so a deactivated-then-rehired staff member's historical row does not block re-adding them (`0063_staff_edit_deactivation.sql` establishes deactivation as a soft state).
  - [x] Add a pgTAP test in `supabase/tests/` asserting a second active row for the same `(gym_id, user_id)` is rejected and a deactivated one is not. Full suite was 1806/1806 at Story 1.16.

- [x] **Task 2: Owner-account resolution in `createGym`** (AC: #1, #2, #4, #5)
  - [x] In `apps/super-admin/app/(admin)/gyms/actions.ts`, before Step 3, look up the email with `findUserByEmail(admin, email)` from `apps/super-admin/lib/super-admin-provisioning.mjs` — **reuse it, do not write a second lookup**. Story 1.16 Task 2 extracted it into that shared `.mjs` module precisely so both the CLI and app code could call it; it handles `listUsers()` pagination correctly.
  - [x] **Not found** → existing behavior unchanged: `createUser` + temp password + WhatsApp. Return `ownerOutcome: "created"`.
  - [x] **Found and `is_super_admin`** → refuse (AC #5). Return an `AppError`; no gym row, no membership.
  - [x] **Found, ordinary account** → skip Step 3 and Step 5 entirely. Reuse the existing `user_id` for `insertOwnerMember`. Return `ownerOutcome: "linked"`, `tempPassword: null`, `smsSent: false`.
  - [x] **Preserve the compensating-cleanup discipline.** Steps 3/4's existing failure branches call `deleteGym(gymRow.id)` and `deleteAuthUserAndLog(...)`. On the linked path there is **no auth user to delete** — deleting it would destroy an account that existed before this request and owns other gyms. Cleanup on the linked path is `deleteGym` **only**. Getting this wrong is the single most destructive mistake available in this story.

- [x] **Task 3: Types and result shape** (AC: #2)
  - [x] Extend `CreateGymResult` (`gyms/actions.ts:56`) with `ownerOutcome`. Narrow `tempPassword` to `string | null`.
  - [x] Update every consumer — `CreateGymModal.tsx` and any success-toast/dialog reading `tempPassword`. `tsc --noEmit` across all four workspace packages is the gate.
  - [x] ~~No new Zod schema is needed~~ SUPERSEDED by code review: `createGymSchema` (`packages/types/src/schemas/gym.ts`) DID gain `confirmLinkExistingOwner` when the confirmation gate was added. The original reasoning below held only until that gate existed. is unchanged — this story changes what the server does with `ownerEmail`, not what the form accepts.

- [x] **Task 4: UI copy and i18n** (AC: #3, #5)
  - [x] Branch the Create Gym success state on `ownerOutcome`. `"created"` keeps today's temp-password display; `"linked"` shows the assigned-to-existing-account message.
  - [x] Add the linked-success and super-admin-refusal strings to `en.json` and `fr.json`. Run the repo's i18n parity check — en/fr must match exactly.

- [x] **Task 5: Audit trail** (AC: #1, #2)
  - [x] `logGymCreated` already receives a metadata object (`gyms/actions.ts:201-206`: `owner_name`, `owner_phone`, `tier_id`, `sms_sent`). Add `owner_outcome` to it. Do **not** invent a second `action_type` — the gym was created either way, and the audit row's metadata is the right place for the distinction.

- [x] **Task 6: Verification** (AC: #1, #7)
  - [x] Automated: `pnpm --filter super-admin typecheck`, `lint`, `test`; pgTAP suite; i18n parity; production build.
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

### The working precedent: staff already do this (read before designing anything)

**Do not design the reuse behaviour from scratch — an equivalent already ships for staff roles and should be mirrored.** Story 9.4 solved the identical "this person may already have an account" problem:

- `createStaffMember` (`apps/dashboard/services/staff.ts:194+`) looks up an existing account **before** creating one, then lets the RPC decide what the situation is. Its lookup normalises the phone by stripping the leading `+`, because GoTrue persists `auth.users.phone` as `237…` not `+237…` while every Zod `e164Phone` schema requires the `+` — a mismatch that previously fell through to `createUser()` and surfaced a confusing "already registered" error instead of reusing the account. **The email path has no equivalent normalisation problem, but the shape of the fix — look up first, branch server-side, never let a duplicate reach `createUser` — is the pattern to copy.**
- `create_staff_member()` (`0064_multi_gym_staff_binding.sql:61-70`) matches on `(gym_id, user_id) where deactivated_at is null`, **role-agnostically**, and either inserts a new binding (different gym) or replaces in place (same gym).

Two consequences for this story:

1. **A person can already be an Owner at gym A and a Manager at gym B today**, with no code change — gym B's Owner/Supervisor adds them through Add Staff. Ownership is the *only* role that cannot be granted to an existing account. This story closes that one remaining hole; it does not introduce multi-gym membership, which has shipped since Epic 9.
2. **AC #6's partial unique index formalises a rule `0064` already enforces in application logic** (one active binding per `(gym_id, user_id)`). It is a database-level backstop for an existing invariant, not a new constraint — which is also why pre-existing violations are unlikely, though Task 1 still checks.

### What happens today, exactly (the behaviour being replaced)

Given an `ownerEmail` that already exists: Step 2 inserts the gym, Step 3's `createUser` returns GoTrue's structured `email_exists` code, `mapAuthAdminError` (`packages/types/src/errors.ts:163`) maps it to `owner_email_taken`, and the failure branch runs `deleteGym(gymRow.id)`. **The cleanup is correct — no orphaned gym survives.** The Super Admin simply gets "owner email is taken" and no gym. Preserve `owner_email_taken` for the cases that still warrant it; it must no longer fire for the ordinary link case.

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
- `supabase/migrations/0064_multi_gym_staff_binding.sql:61-70` (role-agnostic `(gym_id, user_id)` match; new-binding vs replace-in-place)
- `apps/dashboard/services/staff.ts:194+` (`createStaffMember` -- the look-up-before-create precedent)
- `packages/types/src/errors.ts:155-170` (`email_exists` -> `owner_email_taken`)
- `_bmad-output/implementation-artifacts/9-4-multi-gym-staff-binding-rules.md`
- `_bmad-output/planning-artifacts/epics.md:26` (FR-001, multi-gym membership)

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`

### Debug Log References

- **`supabase test db` cannot run in this devcontainer.** It exits `error running container: exit 1` — the same container-network limitation recorded in `docs/deploy-runbook.md` for `supabase db dump`/`reset`/`push`. The suite was run instead by piping each file through `docker exec … psql` against the local `supabase_db_gym_os` container, with `set search_path = public, extensions;` prepended because pgTAP is not installed in the dev database by default (`supabase test db` installs it per run; `create extension pgtap with schema extensions` was used here).
- **Two pre-existing suite failures, not regressions.** `gym_payment_credentials_rls.test.sql` (1 assertion) and `gyms_super_admin_rls.test.sql` (2 assertions) fail with `have: 3, want: 2` row counts. Both assert *platform-wide* row counts and therefore assume a clean database; the local dev DB carries 1 real gym, 1 owner `members` row and 1 `gym_payment_credentials` row left over from Story 16.1's manual Tara Money sandbox QA. **Confirmed pre-existing by re-running both files at baseline** with this story's migration and test stashed and the index dropped — identical failure counts. They pass in CI, which starts from a fresh database.

### Completion Notes List

**AC #6 was based on a false premise, and the deviation is the most important thing in this record.**

The AC asked for a *new* partial unique index named `idx_members_one_active_membership_per_gym`. That index already exists, under a different name, and has since the beginning: `0003_members_and_users.sql:39` creates `idx_members_active_gym_user on members(gym_id, user_id) where deactivated_at is null` — byte-identical semantics. At least ten later migrations (0023, 0027, 0028, 0034, 0039, 0055, 0058, 0064) cite it by name as a load-bearing invariant, and `create_staff_member()` (0064:59) depends on it. Creating a second index with the same definition under a new name would have been pure duplication.

The story-creation research missed it because it queried `pg_constraint` (which lists *constraints*; a bare `create unique index` is not one) and then checked `pg_indexes` against the **deployed** database — which, as it turns out, is missing the index.

**Which surfaced a real production problem.** `vfxezibagiznrirdwkwh` has `0003` recorded as applied in `supabase_migrations.schema_migrations`, but does **not** have `idx_members_active_gym_user`. Verified via `pg_index`: `public.members` there carries only `members_pkey`, `idx_members_gym_id` and `idx_members_user_id`. So an invariant the codebase treats as guaranteed has not been enforced on production. Cause unknown — no migration in this repo drops it.

Implemented the AC's *intent* (a database-level guarantee) via the correct mechanism: `0089_repair_members_active_gym_user_index.sql` re-creates the **original** index name with `if not exists`, making it a no-op wherever the schema is already correct (local, CI) and a repair where it drifted. AC text left unedited, per this project's convention of not rewriting ACs post-hoc.

⚠️ **The repair is NOT yet applied to production.** Writing the migration does not deploy it — this repo has no automated migration deploy, and applying DDL to the live database is a deliberate act outside this story's scope. Checked and safe to apply whenever you choose: `select gym_id, user_id from members where deactivated_at is null group by 1,2 having count(*) > 1` returns **zero rows** on the deployed project, so the index builds without a data repair.

Other notes:

- **AC #1–#4** implemented as specified. `findUserByEmail` reused from `lib/super-admin-provisioning.mjs` rather than a second lookup being written, per Task 2.
- **The linked path's cleanup is `deleteGym` only.** `deleteAuthUserAndLog` is now gated on `ownerOutcome === "created"`. This was the story's flagged worst-case mistake: on the linked path the account pre-existed, and `public.users.id` cascades from `auth.users`, so deleting it would have destroyed an unrelated owner's login *and* their profile row.
- **AC #7 verified by reading, not assumed.** `switch_active_gym` (`0065:34-48`) checks only for an active membership at the target gym and never inspects `role`, so it already works for a multi-gym owner. No RPC change made.
- **AC #3's new copy avoids interpolation.** `gyms.toast.createdLinked` names no phone number: on the linked path the submitted phone belongs to the *new membership row*, not necessarily to the account being signed into, so echoing it back risked implying a message went there.
- **Manual verification is outstanding and is smartsana's**, per this project's established practice. Task 6's two manual subtasks are deliberately left unchecked rather than marked done — the automated gates all pass, but nobody has yet created two gyms for one owner in a browser.

**Verification results (updated after code-review rounds 1-3):** typecheck 0 errors across all 4 workspace packages · super-admin lint 0 errors / 1 pre-existing warning · super-admin tests 25/25 (8 before this story) · dashboard tests 227/227 (regression) · both production builds clean, verified by exit code · i18n parity `packages/types` 84/84 and `apps/super-admin` 300/300 en+fr · pgTAP 87/89 files passing, the 2 failures confirmed pre-existing at baseline (see Debug Log) · new pgTAP file 2/2.

### File List

- `supabase/migrations/0089_repair_members_active_gym_user_index.sql` (new)
- `supabase/tests/one_active_membership_per_gym.test.sql` (new)
- `apps/super-admin/app/(admin)/gyms/actions.ts` (modified)
- `apps/super-admin/app/(admin)/gyms/components/GymsPageClient.tsx` (modified)
- `apps/super-admin/app/(admin)/gyms/components/CreateGymModal.tsx` (modified)
- `apps/super-admin/locales/en.json` (modified)
- `apps/super-admin/locales/fr.json` (modified)
- `packages/types/src/locales/en.json` (modified)
- `packages/types/src/locales/fr.json` (modified)
- `packages/types/src/schemas/gym.ts` (modified — `confirmLinkExistingOwner`)
- `apps/super-admin/app/(admin)/gyms/createGym.test.ts` (new — code review)
- `apps/super-admin/components/update-password-form.tsx` (modified — code review, /protected 404)
- `apps/dashboard/components/update-password-form.tsx` (modified — NOT part of this story; separate password-bounce fix that shares the commit range)

## Change Log

- **2026-09-09** — Story 1.17 implemented. `createGym` now resolves an existing owner account instead of always minting one, returning a `ownerOutcome: "created" | "linked"` discriminator; the WhatsApp temp-password step and auth-user cleanup are gated to the created path. Refuses to link a Super Admin account. Added `0089_repair_members_active_gym_user_index.sql` — a repair of the index `0003` already defines, after finding it missing on the deployed database (see Completion Notes). Status ready-for-dev → review.

## Open Questions for smartsana

1. **Should the Create Gym form say anything before submit?** Today the Super Admin gets no signal that an email belongs to an existing account until the server responds. An inline "this email already has an account — the gym will be assigned to it" hint would remove the surprise, but needs a lookup-on-blur endpoint. Scoped **out** for now; the post-submit copy in AC #3 carries the message instead.
2. **Should `ownerName`/`ownerPhone` stay editable when linking?** They currently write to the new `members` row, so a branch's contact details can differ per gym — which seems right for real operators. Confirm that matches your intent rather than wanting the existing account's details reused.

### Review Findings

<!-- Code review 2026-09-09. Three parallel layers (Blind Hunter, Edge Case
Hunter, Acceptance Auditor), all claims re-verified against the repo before
severity was assigned. -->

- [ ] [Review][Decision] **Phone-only accounts cannot be linked as owners (high)** — `members.ts:386` and `staff.ts:234` provision auth users with **phone only, no email**, so `findUserByEmail` can never find a gym member or staff member. Making one the owner of a new gym still fails: `createUser({email, phone})` returns `phone_exists` → `owner_phone_taken` → gym rolled back. This is the exact failure mode the story set out to remove, reached through the phone key instead of the email key. Owner→owner (the primary case) works. Fixing needs a decision: dedup on phone as well, and if email and phone resolve to *different* accounts, which wins?
- [ ] [Review][Decision] **A mistyped owner email silently assigns the gym to the wrong person (high)** — `actions.ts` linked path + `GymsPageClient.tsx:114`. Previously a typo landing on another existing account was loud (`owner_email_taken`, gym rolled back). Now it succeeds silently, the toast names no account, and no message is sent. Recovery is blocked: `0010:65-70`'s `super_admin_delete_orphaned_gyms` only permits deleting gyms with **no members**, and the link just created one. Options: show the resolved account (email/name) in the toast, add a confirm step naming the target, or accept as-is.
- [ ] [Review][Decision] **A linked owner may have no password anyone knows (medium)** — `actions.ts` linked path. If the first gym's WhatsApp send failed and the admin dismissed the toast, the account holds an unknown temp password. This flow sends nothing and the copy asserts "the owner signs in with their current password". No resend/reset action exists anywhere in `apps/super-admin`. Options: add a resend action, detect never-activated accounts (`last_sign_in_at` null) and reissue, or document the forgot-password route as the answer.
- [ ] [Review][Decision] **`apps/super-admin`'s own update-password form 404s (high, pre-existing)** — `apps/super-admin/components/update-password-form.tsx:39` still pushes to `/protected`, which does not exist in that app (`apps/super-admin/next.config.ts:9` also sets `cacheComponents: true`). Every Super Admin completing a password reset lands on a 404 — the identical bug the dashboard twin's own comment says was fixed there in July. Out of this diff's scope but a two-line fix. Options: fix now, or file as its own story.
- [ ] [Review][Decision] **`0089` is not applied to production (high)** — the repair migration exists in the repo only. `create_staff_member()` (`0064:59`) is documented as depending on `idx_members_active_gym_user`, and on the deployed project that index is absent, so its insert-vs-replace backstop is currently unenforced. Story 1.17's own feature is safe (createGym always targets a brand-new `gym_id`). Options: apply now, or schedule with the next deploy.

- [x] [Review][Patch] Add Vitest coverage for created/linked/refusal and the `deleteAuthUserAndLog` gate — the branch the story itself calls its most destructive possible mistake has no test; precedent exists at `apps/dashboard/services/staff.createStaffMember.test.ts` [apps/super-admin/app/(admin)/gyms/actions.ts]
- [x] [Review][Patch] `window.location.assign("/")` leaves the reset form in history — Back returns to it with a live session and reproduces the double-password symptom the fix targets; use `replace()` [apps/dashboard/components/update-password-form.tsx:114]
- [x] [Review][Patch] Hoist the email lookup and Super Admin check above `insertGym` so AC #5's "nothing is written" is true by construction rather than by a cleanup that only `console.error`s on failure [apps/super-admin/app/(admin)/gyms/actions.ts]
- [x] [Review][Patch] Comment cites `PayNowButton.tsx` as a `router.refresh()` precedent; it never calls it — only a doc comment mentions it [apps/dashboard/components/update-password-form.tsx:107-110]
- [x] [Review][Patch] `owner_is_super_admin` renders as a form-level banner while its siblings (`owner_email_taken`, `owner_phone_taken`) attach to their field; bind it to `ownerEmail` [apps/super-admin/app/(admin)/gyms/components/CreateGymModal.tsx:101-103]
- [x] [Review][Patch] `sms_sent: false` is audit-logged on the linked path, indistinguishable from a real delivery failure in any aggregate over the trail; use null or omit the key [apps/super-admin/app/(admin)/gyms/actions.ts]
- [x] [Review][Patch] `generateTempPassword()` still runs unconditionally, violating AC #1's literal "no temp password generated" on the linked path; move it into the created branch [apps/super-admin/app/(admin)/gyms/actions.ts]
- [x] [Review][Patch] `else` treats any non-`"linked"` outcome as `"created"`, so deploy skew (undefined) shows "share it below" with no password rendered; invert to `!== "created"` [apps/super-admin/app/(admin)/gyms/components/GymsPageClient.tsx:114-121]
- [x] [Review][Patch] No self-heal on a concurrent `email_exists` race — the loser gets a rolled-back gym instead of a link; precedent at `members.ts:397-410` [apps/super-admin/app/(admin)/gyms/actions.ts]
- [x] [Review][Patch] Migration `if not exists` matches by index **name only**, so a same-named divergent index is a silent no-op; add a definition assertion, a pre-flight duplicate-pair guard, and document the non-concurrent SHARE lock [supabase/migrations/0089_repair_members_active_gym_user_index.sql]
- [x] [Review][Patch] pgTAP assertion #1 duplicates `multi_gym_staff_binding_rules.test.sql:332`, and the file passes identically with or without `0089` so it cannot detect the divergence the migration exists to repair [supabase/tests/one_active_membership_per_gym.test.sql:29-34]
- [x] [Review][Patch] Story record is inaccurate: File List omits `update-password-form.tsx`, and AC #6/#7 still assert premises the implementation disproved (index name; `custom_access_token_hook` claim resolution) [_bmad-output/implementation-artifacts/1-17-multi-gym-ownership.md]

- [x] [Review][Defer] `findUserByEmail` pages every auth user on the platform on every gym creation [apps/super-admin/lib/super-admin-provisioning.mjs:51-66] — deferred, pre-existing

### AC reconciliation (code review rounds 1-3)

AC text is left unedited per this project's convention of not rewriting ACs
post-hoc. Where the implementation diverged, the divergence is recorded here.

- **AC #1 — superseded in part.** It says that when `ownerEmail` matches an
  existing row "the gym is created and an `owner` membership row is inserted".
  Since the confirmation gate was added (smartsana's decision, review round 1),
  the FIRST submission always refuses with `owner_link_requires_confirmation`
  and writes nothing; creation needs a second submission carrying
  `confirmLinkExistingOwner`. The end state matches the AC; the number of steps
  does not. AC #1's "no temp password generated" half is now literally true --
  `generateTempPassword()` is reached only on the create path.
- **AC #5 — holds, by a different mechanism than round 1 claimed.** Refusals
  write nothing because owner screening is read-only and runs first. Round 2
  additionally hoisted account CREATION above the gym insert, which was wrong:
  it stranded an unrecoverable `auth.users` row on a failed gym insert. Round 3
  moved provisioning back after the gym insert, so the compensator is
  `deleteGym` and an orphan is removable via `super_admin_delete_orphaned_gyms`.
- **AC #6 — index name deviates.** `0003_members_and_users.sql:39` already owns
  an equivalent index under the name `idx_members_active_gym_user`, cited by ten
  later migrations, and `packages/types/src/errors.ts` string-matches that exact
  name. `0089` repairs THAT index rather than creating the differently-named one
  the AC specifies.
- **AC #7 — its stated mechanism is FALSE and the manual test script inherits
  the error.** The AC says the owner's next login lands in the new gym "because
  `custom_access_token_hook()` resolves claims to the most recently created
  membership". `0065_multi_gym_session_switching.sql:117-127` superseded that:
  the hook now PREFERS `public.users.active_gym_id` whenever it still resolves
  to an active membership, falling back to most-recent only when it is null. So
  an owner who has never used the gym switcher lands in the new gym (AC holds);
  one who has ever switched lands back in their previously-selected gym. Task 6's
  manual step "You'll land in the new gym" is correct only for the first case.
- **Behaviours shipped that no AC covers:** `owner_link_requires_confirmation`
  + `confirmLinkExistingOwner` + the confirmation panel and named submit button;
  `owner_phone_belongs_to_other_account`; `owner_profile_missing`;
  `gym_insert_failed`; `ownerNeverSignedIn` and its toast variant; `sms_sent`
  becoming nullable in audit metadata; and the `apps/super-admin`
  update-password redirect fix. All are recorded in the Change Log below.

### Decisions taken (review round 1)

The five `[Review][Decision]` items above are resolved; they remain unchecked
only because item 5 is a deploy action still outstanding.

1. **Phone-only accounts** — NOT linked by phone. Matching on phone would let a
   mistyped digit hand a gym to an arbitrary gym member. The collision is
   detected and reported instead. Promoting an existing member/coach to owner
   needs its own story: it means giving a phone-only account an email, changing
   their login identity.
2. **Mistyped owner email** — confirmation gate added, naming the account.
3. **Linked owner with no known password** — detected via `last_sign_in_at` and
   surfaced in distinct copy. No resend action built (out of scope). Note the
   project rejected email-link delivery for owner credentials in
   `sprint-change-proposal-2026-07-14` §4.2, so there is currently NO
   in-product recovery path; that gap is real and unresolved.
4. **`apps/super-admin` `/protected` 404** — fixed, redirects to `/gyms`.
5. **Apply `0089` to production** — approved, NOT YET DONE.

## Change Log

- **2026-09-09** — Story 1.17 implemented (see Completion Notes).
- **2026-09-09** — Code review round 1: 19 findings, 12 patches. Added the
  confirmation gate (`confirmLinkExistingOwner`), the phone-collision guard,
  `ownerNeverSignedIn`, `createGym.test.ts`, and the `apps/super-admin`
  `/protected` → `/gyms` fix. Hoisted owner resolution above the gym insert.
- **2026-09-09** — Code review round 2: repaired a regression round 1 caused
  (account minted before the gym insert, with no cleanup on gym-insert failure),
  fixed broken typecheck and partly-vacuous test assertions, extracted
  `screenExistingOwner` so the race path could not skip the Super Admin screen.
- **2026-09-09** — Code review round 3: split screening (read-only) from
  provisioning so refusals write nothing AND cleanup stays recoverable; fixed a
  fail-OPEN Super Admin guard (`profile?.is_super_admin` passes when the profile
  row is missing); made the confirmation label deterministic and assertable;
  hardened `0089` (key-column-only comparison so `INCLUDE` cannot block a
  healthy deploy, expression-column detection, schema-qualified CREATE,
  apply-time duplicate pre-flight, lock documentation). Status: review →
  in-progress.
