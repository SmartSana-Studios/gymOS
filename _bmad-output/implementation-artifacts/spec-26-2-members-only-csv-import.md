---
title: '26-2 Members-only CSV import: no plan, awaiting the fee'
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

**Problem:** A gym that takes over a roster (names, phones, ages, professions, neighborhoods, no plan data) cannot load it: the only import needs a plan, a status and dates for every row, and it settles each member's registration fee instead of leaving the Owner to decide each case.

**Approach:** Add a second import template beside the plan import. A file whose header is exactly `member_name,phone,birth_year,profession,neighborhood` creates each person as a member with no subscription, awaiting the registration fee, so the Owner collects or waives the fee and assigns the first plan person by person.

## Boundaries & Constraints

**Always:** The template is recognised by its header (trimmed, case-insensitive, any order): it contains all five members-only columns and none of `plan_type`, `join_date`, `subscription_status`, `expiry_date`. Every other file takes the existing plan import, unchanged. Rows are created through `provisionMemberRow` with no `planId` and no `importExempt`, so the database trigger (0098) decides the state: awaiting when the gym's fee is above 0, settled when it is 0; no importer code settles or reads the fee state. `join_date` is the UTC import date. Phone: same normalization against the gym's country, E.164 validity, in-file duplicate check and existing-member check as the plan import. `member_name` required, `birth_year` blank or a four-digit year from 1900 to the current UTC year, `profession` and `neighborhood` blank or at most 120 characters (the same rules as Story 26.1; reuse its schemas, exported from `member.ts`). 1000 rows maximum, blank rows skipped and reported, any failing row refuses the whole file with per-row errors, and nothing is written. The member cap is checked for the whole batch before any write (the existing fast-fail). A failing row mid-import rolls back the rows already created (the existing compensation). When the gym's fee is 0 the validate result says so, the modal shows a clear warning, and the **server** refuses to import unless the confirm call carries an explicit acknowledgement. One `member_created` audit row per member, target = the member id, metadata `{ join_date, via: "csv_import_members_only", awaiting_registration_fee }` with **no name and no phone**. The result reports members created and members awaiting the fee. EN and FR strings with key parity. A second synthetic sample file and a `docs/decisions.md` entry. Tests use synthetic rows only; the owner's real roster (`Fiche_de_membre*` at the repo root) is never read, printed, logged or committed.

**Never:** No change to `CSV_TEMPLATE_COLUMNS`, `csvMemberRowSchema`, the plan import's validation, `confirmCsvImport`'s behaviour or audit shape, `importExempt` or `settleRegistrationFeeForImport`, the 0098 triggers, `createAwaitingMember`, or `sendMemberInvite`'s awaiting guard. No new migration, RPC or database function. No invite, WhatsApp or SMS at import. No direct `.from("members")` write (the writers scan from 26.1 must keep its counts). No name or phone in the new audit metadata.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fee gym, valid file | fee 2000, 3 valid rows | 3 members, no subscription, awaiting; result "3 created, 3 awaiting"; 3 audit rows with `awaiting_registration_fee: true` | N/A |
| Fee-0 gym, validate | fee 0, valid file | `valid` plus a fee-0 flag; modal shows the warning and gates Confirm | N/A |
| Fee-0 gym, confirm without acknowledgement | fee 0, no acknowledgement | refused, nothing written | typed error, modal shows the warning again |
| Fee-0 gym, confirm acknowledged | fee 0, acknowledged | 3 members, no plan, not awaiting; result "3 created, 0 awaiting"; audit `awaiting_registration_fee: false` | N/A |
| Plan file | the existing 6-column header | the plan import, exactly as before | N/A |
| Mixed header | the five columns plus `plan_type` | the plan path (its existing missing-column error) | existing message |
| Unknown header | any other columns | refused as an invalid template | message plus both downloads offered |
| Bad row | blank name, bad phone, year `1850`, 121-character text | per-row error naming the column | nothing imported |
| Duplicate phone | same phone twice in the file, or already a member | per-row error | nothing imported |
| Blank birth year, profession, neighborhood | empty cells | saved as null | N/A |
| Over the limit | 1001 rows | refused | `csv_too_many_rows` |
| Cap | rows would exceed the tier cap | refused before any write | `member_cap_reached` |
| Mid-import failure | row 3 of 3 fails (for example a staff phone) | rows 1 and 2 rolled back, nothing audited | `csv_import_failed` |

</frozen-after-approval>

## Code Map

- `packages/types/src/schemas/csvImport.ts` -- add `CSV_MEMBERS_ONLY_TEMPLATE_COLUMNS`, `csvMembersOnlyRowSchema`, `CsvMembersOnlyRowInput`; reuse the module-private `e164Phone` and `blankToUndefined`. `packages/types/src/schemas/member.ts` -- export the Story 26.1 `birthYearSchema` and `profileTextSchema` (currently module-private); `packages/types/src/index.ts` re-exports.
- `apps/dashboard/services/csvImport.ts` (482 lines) -- `mapCsvRows` (L89-165, hard-wired to `CSV_TEMPLATE_COLUMNS` at L109, L113, L154: parameterise the column list); `SCHEMA_FIELD_TO_COLUMN` (L170) and `toCsvMemberRowCandidate` (L181) are plan-specific; `validateCsvImport` (L199-353: reuse the gym-country phone normalization, the in-file duplicate check and the batched existing-member query; skip `listPlans`/plan resolution/expiry rules); `confirmCsvImport` (L365-482: cap L370-382, fee read L390-394, sequential loop L398-436, rollback L416-427, audit L446-462) -- read it for the pattern, do not change its behaviour. `ValidatedCsvRow` is plan-shaped: the members-only path needs its own row type.
- `apps/dashboard/services/members.provisioning.ts` -- `provisionMemberRow` (L391): no `planId` and no `importExempt` leaves the member awaiting by the trigger; it already takes `birthYear`, `profession`, `neighborhood`. `members.changes.ts` -- `logMemberChange` (L151), typed union includes `member_created`.
- `apps/dashboard/app/(dashboard)/members/actions.ts` (L514-567) -- `validateCsvImport(rawText)` and `confirmCsvImport(rawText)` wrappers; confirm re-parses and re-validates server-side from the raw text. Add the mode, the fee-0 flag on validate, and the acknowledgement argument on confirm.
- `apps/dashboard/app/(dashboard)/members/components/CsvImportModal.tsx` (400 lines) -- `downloadTemplate()` (L48, uses `CSV_TEMPLATE_COLUMNS`), steps `upload | result | confirming`, preview of 5 rows (L277-335, plan columns), template-error banner (~L171, ~L337), `onImported(count, warning?)`. It has no `registrationFee` prop; `MembersPageClient.tsx` has one (L93) and mounts the modal (L676, imports L38). No test file exists for the modal.
- `apps/dashboard/locales/en.json`, `fr.json` -- `members.csvImport.*` (L718): add a second download label, members-only preview columns, the fee-0 warning and acknowledgement, the result copy with the awaiting count; the plan-specific keys stay.
- Tests to copy: `services/csvImport.confirmCsvImport.test.ts` (mock pattern: `vi.mock("@/services/members")`, `makeRows(n)`, `setFee()`), `csvImport.validateCsvImport.phone.test.ts` (chainable supabase stub, gym country), `members.writers.scan.test.ts` (counts unchanged; update the `why` text of the `members.provisioning.ts` insert). No existing tests for `lib/csv.ts`, `mapCsvRows`, the schemas, the modal or the csv actions: add the ones this story needs.
- Docs: `docs/decisions.md` (a dated entry near the CSV entries), `scripts/epic18-qa/import-sample.csv` and `README.md:50` (add a second synthetic sample `import-members-sample.csv`), `_bmad-output/planning-artifacts/epics.md` Story 26.2 and `epic-26-context.md` (reconcile the audit and invalid-header wording to this spec).
- Do NOT touch: `CSV_TEMPLATE_COLUMNS`, the 0098 migration triggers, `settleRegistrationFeeForImport`, `sendMemberInvite`, `createAwaitingMember`, the `members.writers.scan` counts.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/types/src/schemas/member.ts`, `csvImport.ts` -- export the 26.1 field schemas; add the members-only columns constant and row schema -- one definition of the rules
- [ ] `apps/dashboard/services/csvImport.ts` -- detect the template, parameterise `mapCsvRows`, add the members-only validate and confirm (own row type; reuses cap, rollback, phone and duplicate logic; per-member audit without name or phone) -- the importer
- [ ] `apps/dashboard/app/(dashboard)/members/actions.ts` -- mode on validate, fee-0 flag, acknowledgement on confirm, server-side refusal without it
- [ ] `CsvImportModal.tsx`, `MembersPageClient.tsx` -- second template download, members-only preview, fee-0 warning gating Confirm, result copy with the awaiting count
- [ ] `locales/en.json`, `locales/fr.json` -- new strings, parity
- [ ] tests -- `csvMembersOnlyRowSchema` (valid, each bad field, blanks); `mapCsvRows` detection (members-only, plan, mixed, unknown, duplicate column); validate (duplicate phone, existing member, row errors, 1001 rows); confirm (fee gym awaiting and no `importExempt`, fee-0 refused without acknowledgement and imported with it, cap fast-fail before writes, mid-import rollback with nothing audited, audit metadata has no name or phone); a modal test (mock `t` as identity; no literal strings in JSX); a scan that lists every non-test `provisionMemberRow(` call site and fails on an unlisted one
- [ ] `docs/decisions.md`, sample CSV and `README.md:50`, `epics.md` and `epic-26-context.md` reconcile -- the documentation
- [ ] the I/O matrix: every row covered by a test that runs

**Acceptance Criteria:**
- Given a file with the exact members-only header and valid rows in a fee gym, when imported, then each person exists with no subscription and is awaiting the registration fee, and the result says how many were created and how many are awaiting
- Given the same file in a fee-0 gym, when validated, then the Owner sees a clear warning, and the server imports only when the confirm call carries the acknowledgement
- Given the existing six-column file, when imported, then it behaves exactly as before, including settling fee-gym members
- Given any bad row, a repeated phone, an existing member's phone, more than 1000 rows or a batch over the cap, when validated or confirmed, then nothing is imported and the errors say why
- Given a row that fails mid-import, when it happens, then the earlier rows are rolled back and nothing is audited
- Given the import's audit rows, when read, then each is a `member_created` for one member and contains no name and no phone
- Given a new code path that calls `provisionMemberRow`, when it is added without being listed, then the scan test fails
- Given the owner's real roster file, when this story is built and tested, then it is never read, printed, logged or committed

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The importer reuses `provisionMemberRow` as the 18.5 two-step create already does, so the awaiting state is the database trigger's decision, not importer logic; that is why a fee-0 gym needs no special branch beyond the warning. The members-only confirm shares the cap check, the rollback and the phone and duplicate rules with the plan import by reading its pattern; `confirmCsvImport` itself is not refactored, so the plan import's tests stay the proof that it is unchanged. The audit keeps the same action type as a hand-created member (`member_created`) with a distinct `via`, so the Owner's audit page shows an imported person like any other, with the member id as the target and no personal data in the metadata. `join_date` uses the UTC date to agree with `current_date` in the database and the "not in the future" rules elsewhere.

## Verification

**Commands:**
- `bash scripts/ci-local.sh --only static` -- expected: PASS (types, lint with no literal strings, i18n parity)
- `bash scripts/ci-local.sh --only unit` -- expected: PASS
- Full `bash scripts/ci-local.sh` on a pristine database, outside 23:00-24:00 UTC -- expected: GREEN with a stamp

**Manual checks (if no CLI):**
- Owner dashboard, Members > Import: download both templates; upload a synthetic members-only file in a fee gym and in a fee-0 gym (warning, acknowledgement); upload a plan file; check an imported person shows "Awaiting registration fee" with Collect and Waive.
