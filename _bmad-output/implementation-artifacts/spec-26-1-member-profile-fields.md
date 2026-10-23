---
title: '26-1 Member profile fields: birth year, profession, neighborhood'
type: 'feature'
created: '2026-10-23'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member record has no place for the facts a gym already knows about its people (age, profession, neighborhood), so a roster taken over from another gym loses them, and the Owner cannot see who their members are.

**Approach:** Add three optional member fields (birth year, profession, neighborhood), carried end to end through the existing create, edit, detail and export paths, with the age shown as an approximation and the privacy copy updated.

## Boundaries & Constraints

**Always:** `birth_year smallint` (database check 1900 to 2100; the app also refuses a year after the current year, computed at call time), `profession text` and `neighborhood text` (each at most 120 characters after trimming), all nullable, existing rows null, nothing required, blank saved as null. Same access as `phone` and `dob`: the existing member policies apply unchanged, and a member editing their own row through the API must not be able to change the three fields (extend `private.protect_self_managed_member_columns`, copying its current body from migration 0072). Age is shown only as an approximation (current year minus birth year, labelled approximate in EN and FR), never as a date, and nothing is shown when there is no birth year. EN and FR strings with key parity. The export gets the three columns at the END of its existing columns, named `birth_year`, `profession`, `neighborhood`, with the two text fields through `csvEscape`. `packages/types/src/database.ts` is hand-spliced (Row, Insert, Update, alphabetical), not regenerated. Privacy copy: the Identity row of the member data table in `apps/dashboard/lib/legal/privacy-policy.ts` (EN and FR), `POLICY_LAST_UPDATED` bumped, and `docs/play-store-data-safety.md`. A scan test enumerates every code path that inserts or updates `members` rows in the apps, and each is either listed as carrying the fields or listed as exempt with a reason. Tests use synthetic rows only; no real member data anywhere.

**Never:** No change to any RLS policy, to `registrationFee` branching in `createMember`, to phone immutability, to the plan CSV import's columns or behaviour (it keeps writing null for the new fields), to `dob`, to the Super Admin member column allow-list, or to the mobile app. No new RPC or function other than the replaced self-edit trigger function (with its revoke in the same file). No regenerated `database.ts`. The members list table gets no new column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create, all three | birth year `1984`, profession ` Soudeur `, neighborhood `Ngui` | saved as 1984, `Soudeur`, `Ngui` | N/A |
| Create, none | all three blank | all three null, member created as before | N/A |
| Birth year out of range | `1850`, next year, `84`, `abc` | refused inline on the field, nothing written | `members.modal.errors.birthYearInvalid` |
| Text too long | 121 characters | refused inline | field error, nothing written |
| Edit clears a value | profession set to blank | saved as null | N/A |
| Member edits own row via API | member sets own birth year | value unchanged (pinned) | silent, as for `phone` |
| Detail view | birth year 1984 in 2026 | approximate age 42, labelled approximate | none: no birth year shows nothing |
| Export | member with all three | three extra columns at the end, text fields formula-guarded | N/A |
| Another gym's member | read the three fields | not visible (existing gym-scoped policies) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0154_member_profile_fields.sql` (new) + `scripts/rollback-0154-member-profile-fields.sql` (new) -- three columns with checks; replaces `private.protect_self_managed_member_columns` (last defined in 0072) with the three added pins. Template: `0123_gym_category.sql`; rollback shape: `scripts/rollback-0123-gym-category.sql` (lock_timeout, drop, `do $verify$`).
- `packages/types/src/schemas/member.ts` -- `createMemberSchema` (L86), `createFeeGymMemberSchema` (L151, its own copy of the fields), `editMemberSchema` (L185); mirror `emergencyContactSchema` for the text fields.
- `packages/types/src/database.ts` -- `members` Row/Insert/Update (~L927), hand-splice.
- `apps/dashboard/services/members.provisioning.ts` -- `InsertMemberInput` (~L170), `insertMember` (~L200), `ProvisionMemberRowInput` (~L314), `provisionMemberRow` (~L397).
- `apps/dashboard/services/members.changes.ts` -- `UpdateMemberInput` (L10) and the `.update` (~L35).
- `apps/dashboard/services/members.shared.ts` -- `MemberListRow` (~L55), `MemberRowFromDb` (~L83), `toMemberListRow` (~L105); `members.ts` L41 and `members.detail.ts` L182 select lists (the edit form fills from these).
- `apps/dashboard/app/(dashboard)/members/actions.ts` -- `createMember` (L78), `createAwaitingMember` (~L213), `editMember` (L336), and the two `provisionMemberRow` call sites (~L153, ~L233).
- `apps/dashboard/services/csvImport.ts` -- the call at ~L400 that passes nulls for the identity fields: add the three nulls, nothing else.
- `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx` -- the single create/edit/view modal: `FieldErrors` (L27), error-key map (~L60), defaults (~L111), form-from-member (~L127), edit payload (~L603), create payload (~L678), `DetailField` (~L824), inputs (~L926). `MembersPageClient.tsx` needs no change.
- `apps/dashboard/services/members.export.ts` -- `csvEscape` (L19), select (~L63), header and rows (~L88-110).
- `apps/dashboard/locales/en.json` and `fr.json` -- `members.modal.*` (~L605-640), `members.modal.view.*`, `members.modal.errors.*`; the parity script is `scripts/check-i18n-key-parity.mjs`; the lint rule `i18next/no-literal-string` applies to test JSX too.
- `apps/dashboard/lib/legal/privacy-policy.ts` -- Identity row of `collect.table.rows` (EN ~L94, FR mirror ~L240s); `apps/dashboard/lib/legal/details.ts` L68 `POLICY_LAST_UPDATED`; `docs/play-store-data-safety.md` L26-29 and its changelog. `docs/privacy-policy.md` is only a pointer; `app/privacy/page.tsx` renders the TS object: no change to either.
- Tests beside: `MemberModal.test.tsx`, `actions.createMember.test.ts`, `services/members.provisionMemberRow.test.ts`, `members.listMembers.test.ts`, `members.getMemberListRow.test.ts`, `lib/memberSchemas.registrationFee.test.ts`; new `services/members.export.test.ts`, new `supabase/tests/member_profile_fields.test.sql` (style of `gym_country.test.sql`: SQLSTATE 23514), new writers scan test.
- Do NOT touch: `coach_portal_my_classes.test.sql`'s `policies_are` list (breaks only if a policy changes), `suspension_rpc_coverage.test.sql` (scans functions that `update members`: the replaced trigger function must not match), the staff and support member writers (`create_staff_member`, `support_set_membership`).
- `scripts/rollback-rehearsal-epic23.sh` pins the ledger head at 0153; it aborts once 0154 is applied locally. Run it before applying 0154, or leave it (0154 is outside its range).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0154_member_profile_fields.sql`, `scripts/rollback-0154-member-profile-fields.sql` -- columns, checks, extended self-edit pin (+ revoke), rollback with verify block -- the data model and the member cannot self-edit
- [ ] `supabase/tests/member_profile_fields.test.sql` -- columns exist and are nullable, each check fires (23514), a member's own update leaves the three unchanged while staff can set them, another gym cannot read them
- [ ] `packages/types/src/schemas/member.ts` (+ test) -- the three field schemas in all three member schemas; birth year bound to the current year at call time
- [ ] `packages/types/src/database.ts` -- hand-splice the three fields
- [ ] services (`members.provisioning.ts`, `members.changes.ts`, `members.shared.ts`, `members.ts`, `members.detail.ts`, `csvImport.ts`) and `members/actions.ts` -- carry the fields on create, edit and read; CSV import passes null
- [ ] `MemberModal.tsx`, `locales/en.json`, `locales/fr.json` -- inputs, inline errors, detail with approximate age; update `MemberModal.test.tsx`
- [ ] `services/members.export.ts` + new `members.export.test.ts` -- columns at the end, guard on text, a leading `=` is neutralised
- [ ] writers scan test -- enumerates `members` inserts/updates across `apps/*`, each listed as carrying the fields or exempt with a reason; fails on an unlisted writer
- [ ] `lib/legal/privacy-policy.ts`, `lib/legal/details.ts`, `docs/play-store-data-safety.md` -- new data categories (EN, FR), policy date bumped
- [ ] I/O matrix cases covered by the tests above; `scripts/epic23-qa/README.md` untouched

**Acceptance Criteria:**
- Given the three fields, when a member is created or edited with valid values, then they are saved trimmed and shown on the detail view, with the age shown only as an approximate number
- Given a birth year before 1900, after the current year, or not a four-digit number, or text over 120 characters, when saved, then the form refuses it inline and nothing is written
- Given a member's own session, when they update their own row directly, then the three fields are unchanged
- Given another gym's staff, when they read these fields, then they see nothing
- Given the export, when generated, then the three columns come last and a value starting with `=`, `+`, `-` or `@` is neutralised
- Given the plan CSV import, when run, then it works exactly as before and leaves the three fields null
- Given a new code path that inserts or updates `members`, when it is added without being listed, then the scan test fails
- Given the privacy page, when opened in EN or FR, then the new categories are listed and the date is current

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

Age is derived, never stored: `currentYear - birth_year`, labelled approximate because only the year is known. The database check allows up to 2100 because a check constraint cannot use the current date; the app enforces "not after this year". The pin trigger copies the body in 0072 verbatim and adds three lines (`new.birth_year := old.birth_year;` and the same for the two text fields), so every other self-edit rule is unchanged.

## Verification

**Commands:**
- `bash scripts/ci-local.sh --only static` -- expected: PASS (typecheck, lint with no literal strings, i18n parity, migration guardrails)
- `bash scripts/ci-local.sh --only unit` -- expected: PASS
- `bash scripts/pgtap-run.sh supabase/tests/member_profile_fields.test.sql` -- expected: ok on a database with 0154 applied
- Full `bash scripts/ci-local.sh` on a pristine database, outside 23:00-24:00 UTC -- expected: GREEN with a stamp (the owner runs `supabase db reset`)

**Manual checks (if no CLI):**
- Owner dashboard: add a member with and without the three fields, edit them, open the detail (approximate age), export, and read the privacy page in EN and FR.
