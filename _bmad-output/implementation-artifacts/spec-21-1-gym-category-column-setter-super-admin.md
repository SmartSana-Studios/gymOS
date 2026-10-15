---
title: '21-1 Gym category column, setter and Super Admin'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'e99ec21'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
---

<!-- Written retroactively on 2026-10-15, after the story was built, reviewed and merged (PR #71, 41daf6a). The story was built straight from epics.md Story 21.1 and the epic context; this file records the intent, constraints and review outcome so the story matches the Epic 19/20 convention. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gyms are not classified, and V1.7's directory and landing pages need a category per gym (FR-171). The value must be descriptive only and change nothing about how a gym behaves (FR-172).

**Approach:** Migration 0123 adds `gyms.category` (stable code, default `gym`), its own pin trigger and one audited setter RPC. Super Admin picks the category at gym creation, changes it on the gym detail page, and sees it in the gyms list. Settings for Owner/Supervisor is Story 21.2.

## Boundaries & Constraints

**Always:**
- Number is **0123** (production and tree head was 0122). `gyms.category text NOT NULL DEFAULT 'gym'` with CHECK on `gym`, `pilates_studio`, `yoga_studio`, `fitness_center`, `other`; every existing gym reads `gym` from the ADD COLUMN itself.
- Pin: its own BEFORE UPDATE OF trigger `private.pin_gym_category()` (SECURITY INVOKER, GUC `app.gym_category_update_bypass`), no super-admin or service_role exemption, not a branch of `protect_super_admin_only_gym_columns()` and not the 0107/0117 pins. UPDATE only, so `createGym` can set the value on insert.
- `set_gym_category(p_gym_id uuid, p_category text)`: SECURITY DEFINER, `search_path` pinned. Authority is Super Admin via `private.is_super_admin_live()` (live `users.is_super_admin`, never the JWT claim) or Owner/Supervisor of that gym via `private.gym_id()` + `private.current_member_role()`. Invalid code raises `invalid_category`; unknown gym raises `gym not found`. One `gym_category_changed` audit row with `old_category`/`new_category`; an unchanged value writes and logs nothing.
- A gym's own Owner/Supervisor is refused while the gym is not active (0090 fail-closed form); Super Admin is not.
- Privileges: EXECUTE revoked from `public`/`anon`, granted to `authenticated`; the trigger function is executable by no client role.
- `packages/types`: `GYM_CATEGORIES`, `GymCategory`, `DEFAULT_GYM_CATEGORY`, `gymCategorySchema`, `setGymCategorySchema`, EN/FR labels (Gym / Salle de sport, Pilates Studio / Studio Pilates, Yoga Studio / Studio Yoga, Fitness Center / Centre de fitness, Other / Autre), `gymCategoryLabel`. Labels are never stored.
- Super Admin: required Category select in Create Gym (default Gym), validated by `createGymSchema` before the first write and recorded in the `gym_created` audit metadata; `Category: [label] [Change]` row under Owner on gym detail with inline select, Save/Cancel, no confirmation; plain-text Category column after Gym Name on the list (no chip, no filter). Gym detail never shows Charge guests or Loyalty.
- EN/FR parity; audit label `gym_category_changed` in the dashboard and Super Admin audit views.
- pgTAP positive + `.negative`, hand-spliced `database.ts`, `scripts/rollback-0123-gym-category.sql` with a verify block, `prod-apply.mjs` stage 7 with a verification query.

**Never:** No behavior keyed on category (FR-172), no free-text for Other, no Settings field (21.2), no list filter, no change to `gymSettingsSchema`, no `app_role` JWT read, no edit of `protect_super_admin_only_gym_columns()`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner sets own gym | owner, other code | stored, one audit row old/new, actor = owner | N/A |
| Supervisor sets own gym | supervisor | same | N/A |
| Super Admin, any gym incl. suspended | no gym claim | stored, audit scoped to target gym, actor = admin | N/A |
| Same value | any allowed caller | no write, no audit row | N/A |
| Manager, receptionist, coach, member | any | nothing changes | `permission denied` |
| Owner of another gym | names this gym | nothing changes | `permission denied` |
| `app_role` claim of super_admin without `users.is_super_admin` | forged claim | nothing changes | `permission denied` |
| Owner of suspended gym | active check | nothing changes | `is not active` |
| Unknown code, label, null | allowed caller | nothing changes | `invalid_category` |
| Unknown or null gym id | super admin | nothing changes | `gym not found` |
| Direct UPDATE by any role | bare UPDATE | value reverted (positive control: other column lands) | silent |
| anon | RPC | refused | `42501` |

## Code Map

- `supabase/migrations/0107_charge_guests_setting_session_record.sql`, `0098_registration_fee_foundation.sql`, `0117_loyalty_program_ledger_foundation.sql` -- models for the pin, setter and audit
- `supabase/migrations/0123_gym_category.sql` -- new
- `supabase/tests/gym_category.test.sql`, `gym_category.negative.test.sql` -- new
- `scripts/rollback-0123-gym-category.sql`, `scripts/prod-apply.mjs` -- rollback, stage 7
- `packages/types/src/schemas/gym.ts`, `database.ts` -- constants, schemas, labels, types
- `apps/super-admin/services/gyms.ts`, `app/(admin)/gyms/actions.ts` -- reads, `setGymCategory`, `changeGymCategory`, `createGym` category
- `apps/super-admin/app/(admin)/gyms/components/CreateGymModal.tsx`, `GymsPageClient.tsx`, `[id]/components/GymCategoryEditor.tsx`, `GymDetailPageClient.tsx`, `AuditTrailTab.tsx`; `locales/en.json`, `fr.json`
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, `auditLabels.epic19.test.ts`, `locales/en.json`, `fr.json`

## Tasks & Acceptance

**Execution:**
- [x] Migration 0123, pgTAP positive (30) and negative (18), rollback script exercised in a rolled-back transaction
- [x] `packages/types` constants, schemas, labels, `database.ts`
- [x] Super Admin create select, detail editor, list column, `changeGymCategory`, audit label
- [x] `prod-apply.mjs` stage 7 and its verify SQL run against the local DB
- [x] vitest: `GymCategoryEditor`, `gymCategory`, `createGym` category and `changeGymCategory`, list/detail/setter service test
- [x] `scripts/ci-local.sh` GREEN on 6bd9f72; sprint-status entries
- [ ] Production apply of 0123 (dry run, db-backup, stage 7) -- owner decision, not part of this story's merge

**Acceptance Criteria:**
- Given the matrix, when pgTAP and vitest run, then all pass and `scripts/ci-local.sh` is green on every stage.
- Given a rolled-back transaction on the local DB, when 0123's rollback runs, then the column, setter and pin are gone.
- Given Super Admin, when a gym is created or changed, then the code is stored and audited and no other column changes.

## Implementation Notes

Applied to the local DB by piping the migration through the DB container's psql, then recording version 0123 in `supabase_migrations.schema_migrations`. Not applied to production.

## Spec Change Log

- 2026-10-15: file created retroactively after merge.

## Review Triage Log

Four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor) ran against the branch diff.

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Editor: thrown action, error not announced, no-op save claims "updated" (EC, BH) | patch, applied | try/catch, `role="alert"`, equal value closes quietly |
| 2 | Stale label next to "Category updated." (BH) | patch, applied | saved category held locally |
| 3 | `gymCategoryLabel`: `fr-FR` shows English; prototype keys (EC) | patch, applied | `startsWith("fr")`, `Object.hasOwn` |
| 4 | `createGymSchema` comment says re-checked in createGym (BH) | patch, applied | wording fixed |
| 5 | prod-apply header order; `not_gym` expectation (BH, EC, AA) | patch, applied | header reordered, label says "immediately after apply"; verify SQL run locally |
| 6 | pgTAP: pin only tried as owner/super admin; super admin actor and CHECK text unproven (AA, BH) | patch, applied | 26 -> 30 assertions |
| 7 | List/detail select and mapping untested (VG) | patch, applied | `gymCategory.service.test.ts` |
| 8 | Pin opens on a plain GUC any SQL session could set (BH, EC) | deferred | Same pattern as 0098/0107/0117, prescribed by AD-32; cross-cutting. deferred-work.md |
| 9 | Typed errors; suspended-gym refusal not in ACs (AA) | deferred | deferred-work.md |
| 10 | Audit label render test in Super Admin tab (VG) | deferred | deferred-work.md |
| 11 | Inline status instead of toast (AA) | deferred | No toast host on the detail page. deferred-work.md |
| 12 | Category list in three places (BH) | deferred | CHECK text and TS list now pinned by tests |
| 13 | Release default on existing rows not proven (AA) | rejected | ADD COLUMN default is a catalog fact; stage 7 `not_gym` = 0 checks production |
| 14 | `setGymCategoryMock` dead in createGym tests (EC) | false | used by the `changeGymCategory` tests |
| 15 | Required asterisk with a preselected default (BH) | rejected | matches the Country field |
| 16 | No lock_timeout in the migration (EC) | rejected | prod-apply sets session `lock_timeout = 10s` |

## Design Notes

The setter takes the gym id as an argument (unlike `set_guest_charging` and `set_loyalty_program`, which read it from the JWT) because a Super Admin has no gym in their session. A forged `app_role` claim is not enough for Super Admin: the check is a live `users.is_super_admin` read, and a pgTAP case proves it.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh supabase/tests/gym_category.test.sql supabase/tests/gym_category.negative.test.sql` -- expected: 30 and 18 ok
- `scripts/ci-local.sh` (via `bash`) -- expected: static, pgtap, unit, e2e green
