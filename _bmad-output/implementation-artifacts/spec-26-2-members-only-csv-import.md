---
title: '26-2 One CSV template: only name and phone required, plan optional'
type: 'feature'
created: '2026-10-23'
status: 'in-progress'
baseline_commit: '451a75330145da6729cb6764c6c99e33a79a9a22'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym that takes over a roster (names, phones, ages, professions, neighborhoods, no plan data) cannot load it: the import requires a plan, a status and dates on every row, and it settles every member's registration fee, so the Owner cannot decide each person individually.

**Approach:** Keep ONE import template whose only required columns are `member_name` and `phone`; everything else is optional. A row with no plan creates a member with no subscription, awaiting the registration fee; a row with a plan behaves exactly as today.

## Boundaries & Constraints

**Always:** One template. Its downloadable header is `member_name,phone,plan_type,join_date,subscription_status,expiry_date,birth_year,profession,neighborhood`. Only `member_name` and `phone` must be in the header; the others may be absent or blank. Header cells are trimmed, case-insensitive, any order; unknown extra columns are ignored and a duplicated known column is refused (as today). A file missing `member_name` or `phone` is refused as an invalid template naming what is missing. Existing six-column files keep working.

Row rules. `member_name` and `phone` are required (same phone normalization against the gym's country, E.164 validity, in-file duplicate check and existing-member check as today). A row WITH `plan_type` follows exactly today's rules (the plan must exist, `join_date` required and not in the future, `subscription_status` required, expiry rules per plan type, status consistent with expiry). A row WITHOUT `plan_type` creates no subscription: `subscription_status` and `expiry_date` must be blank (otherwise a row error says a plan is required), and `join_date` is optional (blank means the UTC import date; if given it must be valid and not in the future). `birth_year` (blank or four digits, 1900 to the current UTC year), `profession` and `neighborhood` (blank or at most 120 characters) are optional on every row, using Story 26.1's schemas.

Fee state. The owner's decision: a row with a plan in a fee gym is settled at import, as today (`importExempt`); a row without a plan is NOT exempt, so the database trigger (0098) leaves the member awaiting the fee in a fee gym and settles it in a fee-0 gym. The importer never writes the fee state itself beyond passing the existing exempt flag for plan rows. In a fee-0 gym with at least one row without a plan, the validate result flags it, the modal shows a clear warning and gates Confirm, and the SERVER refuses to confirm unless the call carries an explicit acknowledgement. No warning when the gym has a fee or every row has a plan.

Unchanged limits and safety: 1000 rows, blank rows skipped and reported, any failing row refuses the whole file with per-row errors and writes nothing, the whole-batch member cap check before any write, reverse-order rollback if a row fails mid-import.

Audit: one `member_created` row per member. A plan row keeps exactly today's metadata. A row without a plan writes `{ join_date, via: "csv_import", awaiting_registration_fee }` with NO name and NO phone. The result reports members created and members awaiting the fee. EN and FR strings with parity. One synthetic sample file and a `docs/decisions.md` entry. Tests use synthetic rows only; the owner's real roster (`Fiche_de_membre*` at the repo root) is never read, printed, logged or committed.

**Never:** No second template, no header-based mode switch. No change to `settleRegistrationFeeForImport`, the 0098 triggers, `createAwaitingMember` or `sendMemberInvite`'s awaiting guard. No migration or database function. No invite, WhatsApp or SMS at import. No direct `.from("members")` write (the writers scan from 26.1 keeps its counts). No name or phone in the new audit metadata. No change to a plan row's validation, `importExempt` use, or audit shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Only name and phone, fee gym | fee 2000, 3 rows, no other columns | 3 members, no subscription, awaiting; result "3 created, 3 awaiting"; 3 audit rows with `awaiting_registration_fee: true` and no name or phone | N/A |
| Only name and phone, fee-0 gym, validate | fee 0 | `valid` plus a flag that rows have no plan; modal warns and gates Confirm | N/A |
| Fee-0 gym, confirm without acknowledgement | fee 0, rows without plan | refused, nothing written | typed error; modal shows the warning again |
| Fee-0 gym, acknowledged | fee 0, acknowledged | members created, none awaiting; result "N created, 0 awaiting" | N/A |
| Full plan row, fee gym | plan, join date, status, expiry present | subscription created, fee settled, audit exactly as today | N/A |
| Mixed file, fee gym | row 1 with a plan, row 2 without | row 1 settled with a subscription; row 2 awaiting | N/A |
| Existing six-column file | the old header | behaves as before for rows with a plan | N/A |
| Status or expiry without a plan | `plan_type` blank, `subscription_status` filled | row error: a plan is required | nothing imported |
| Join date on a no-plan row | blank / valid past / future | import date / that date / row error | row error for the future |
| Header missing a required column | no `phone` | refused as an invalid template naming `phone` | existing code `csv_invalid_template` |
| Bad optional values | birth year `1850`, 121-character profession | per-row error naming the column | nothing imported |
| Duplicate phone, existing member | repeated phone, phone already a member | per-row error | nothing imported |
| Over the limit, over the cap | 1001 rows; batch exceeds the tier cap | refused (before any write for the cap) | `csv_too_many_rows`, `member_cap_reached` |
| Mid-import failure | row 3 of 3 fails | rows 1 and 2 rolled back, nothing audited | `csv_import_failed` |

</frozen-after-approval>

## Code Map

- `packages/types/src/schemas/csvImport.ts` -- `CSV_TEMPLATE_COLUMNS` (6 columns, used for header checks and the download header): the download header becomes the nine columns; add `CSV_REQUIRED_COLUMNS = ["member_name", "phone"]`; `csvMemberRowSchema` (plan fields required, two refines) becomes plan-optional with the no-plan rules above; it keeps the module-private `e164Phone` and `blankToUndefined`. Add the three optional profile fields using `birthYearSchema` and `profileTextSchema`, which Story 26.1 left module-private in `packages/types/src/schemas/member.ts`: export them. `CsvMemberRowInput` is exported.
- `apps/dashboard/services/csvImport.ts` (482 lines) -- `mapCsvRows` (L89-165): the missing-column check at L109/L113/L154 becomes "required columns only"; keep the duplicate check, blank-row, 1000-row and malformed-row logic. `SCHEMA_FIELD_TO_COLUMN` (L170) and `toCsvMemberRowCandidate` (L181): add the new columns. `validateCsvImport` (L199-353): plan resolution (`listPlans`, `plansByName`, `planNotConfigured`, the expiry rules) runs only for rows with a plan; the phone, duplicate and existing-member logic is shared and unchanged; `ValidatedCsvRow` (plan-shaped) gets optional plan fields and the profile fields; the result carries a flag when the gym's fee is 0 and some row has no plan. `confirmCsvImport` (L365-482): cap L370-382, fee read L390-394 (`importExempt = registrationFee > 0`) becomes per row: exempt only when the gym has a fee AND the row has a plan; the loop L398-436 passes the profile fields (today it hard-codes null) and omits the plan fields for a no-plan row; the audit loop L446-462 keeps today's shape for plan rows and writes the no-name, no-phone shape for the others; the fee-0 acknowledgement is checked here.
- `apps/dashboard/services/members.provisioning.ts` -- `provisionMemberRow` (L391): no `planId` and no `importExempt` leaves a member awaiting by the trigger; it already takes `birthYear`, `profession`, `neighborhood`. `members.changes.ts` -- `logMemberChange` (L151).
- `apps/dashboard/app/(dashboard)/members/actions.ts` (L514-567) -- `validateCsvImport(rawText)` and `confirmCsvImport(rawText)` wrappers; confirm re-parses and re-validates server-side from the raw text. Add the acknowledgement argument and return `{ count, awaiting }`.
- `apps/dashboard/app/(dashboard)/members/components/CsvImportModal.tsx` (400 lines) -- `downloadTemplate()` (L48) uses `CSV_TEMPLATE_COLUMNS`; steps `upload | result | confirming`; preview of 5 rows (L277-335); the fee-0 warning slot is between the preview and Confirm; it has no `registrationFee` prop (the validate result carries the flag instead); `MembersPageClient.tsx` mounts it (L38, L676) and shows the import toast. No test file exists for the modal.
- `apps/dashboard/locales/en.json`, `fr.json` -- `members.csvImport.*` (L718): new keys for the fee-0 warning and acknowledgement, the no-plan row error, the awaiting count in the result; update the template help text; plan-specific keys stay.
- Existing tests that will need deliberate updates because a blank plan is no longer an error: `services/csvImport.confirmCsvImport.test.ts` (fee exemption and audit shape for plan rows must still pass unchanged), `services/csvImport.validateCsvImport.phone.test.ts`. Pattern to copy for new ones: `vi.mock("@/services/members")`, `makeRows(n)`, `setFee()`, the chainable supabase stub. No existing tests for `lib/csv.ts`, `mapCsvRows`, the schemas, the modal or the csv actions.
- `apps/dashboard/services/members.writers.scan.test.ts` -- counts unchanged (no new direct writer); update the `why` text. Docs: `docs/decisions.md` entry near the CSV entries (~L784, ~L834); `scripts/epic18-qa/import-sample.csv` and `README.md:50` (add a synthetic name-and-phone-only sample); `epics.md` Story 26.2 and `epic-26-context.md` reconcile to this spec.
- Do NOT touch: the 0098 triggers, `settleRegistrationFeeForImport`, `sendMemberInvite`, `createAwaitingMember`, a plan row's validation and audit shape.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/types/src/schemas/member.ts`, `csvImport.ts` -- export the 26.1 field schemas; required-columns constant and the nine-column download header; plan-optional row schema with the no-plan rules
- [ ] `apps/dashboard/services/csvImport.ts` -- required-columns header check; per-row plan handling in validate; per-row `importExempt`, profile fields, audit shape and the fee-0 acknowledgement in confirm; the result `{ count, awaiting }`
- [ ] `apps/dashboard/app/(dashboard)/members/actions.ts` -- acknowledgement argument, fee-0 flag on validate, server refusal without it
- [ ] `CsvImportModal.tsx`, `MembersPageClient.tsx` -- one template download (nine columns), preview that tolerates blank plan cells, fee-0 warning gating Confirm, result copy with the awaiting count
- [ ] `locales/en.json`, `locales/fr.json` -- strings, parity
- [ ] tests -- row schema (name and phone only, with a plan, each no-plan rule, bounds); header check (required only, missing phone, duplicate column, six-column file); validate (mixed file, duplicate phone, existing member, row errors, 1001 rows, fee-0 flag); confirm (fee gym: plan row exempt and no-plan row not, no-plan audit has no name or phone, plan audit unchanged; fee-0: refused without acknowledgement, imported with it; cap before writes; mid-import rollback with nothing audited); actions (acknowledgement passed through, only literal `true` counts, re-validation, plan-only file unchanged); modal (mocked `t`, no literal strings in JSX); a scan listing every non-test `provisionMemberRow(` call site
- [ ] `docs/decisions.md`, sample file, `README.md:50`, `epics.md` and `epic-26-context.md` -- documentation
- [ ] the I/O matrix: every row covered by a test that runs

**Acceptance Criteria:**
- Given a file with only `member_name` and `phone`, when imported into a fee gym, then every person exists with no subscription and is awaiting the registration fee, and the result says how many were created and how many are awaiting
- Given the same file in a fee-0 gym, when validated, then the Owner sees a clear warning, and the server imports only when the confirm call carries the acknowledgement
- Given a row with a plan in a fee gym, when imported, then its subscription is created and its fee is settled, with the audit exactly as today
- Given a file mixing rows with and without a plan, when imported, then each row follows its own rules
- Given an existing six-column file, when imported, then it behaves as before
- Given a bad row, a repeated or already-used phone, more than 1000 rows or a batch over the cap, when validated or confirmed, then nothing is imported and the errors say why
- Given a row that fails mid-import, when it happens, then the earlier rows are rolled back and nothing is audited
- Given the audit rows of rows without a plan, when read, then they contain no name and no phone
- Given a new code path that calls `provisionMemberRow`, when it is added without being listed, then the scan test fails
- Given the owner's real roster file, when this story is built and tested, then it is never read, printed, logged or committed

## Implementation Notes

## Spec Change Log

- 2026-10-23, human renegotiation (not a review loopback): the approved spec described TWO templates detected by header (a members-only template beside the plan template). The owner asked for ONE template where only `member_name` and `phone` are required. The intent block was rewritten accordingly; the first implementation (two-template detection, separate members-only validate and confirm) was set aside (git stash `26-2 two-template attempt` and `scratchpad/26-2-two-template-attempt.diff`) and is not to be reapplied as is. KEEP from that attempt: the fee-0 acknowledgement enforced by the server and passed through the action as a literal `true`; the per-member audit without name or phone; the view that `provisionMemberRow` with no plan and no `importExempt` is what leaves a member awaiting; the mutation-tested confirm, cap and rollback tests; the `provisionMemberRow` call-sites scan. Decision recorded: a row with a plan in a fee gym stays settled (owner, 2026-10-23).

## Review Triage Log

## Design Notes

There is no mode: every file goes through the same path, and each row decides for itself whether it has a plan. The fee state is the database trigger's decision, so the importer only passes the existing exempt flag for rows with a plan. A row with a status or expiry but no plan is an error (they mean nothing without a plan) so a half-filled plan row cannot silently become an awaiting member. `join_date` uses the UTC date to agree with `current_date` in the database and the "not in the future" rules elsewhere.

## Verification

**Commands:**
- `bash scripts/ci-local.sh --only static` -- expected: PASS (types, lint with no literal strings, i18n parity)
- `bash scripts/ci-local.sh --only unit` -- expected: PASS
- Full `bash scripts/ci-local.sh` on a pristine database, outside 23:00-24:00 UTC -- expected: GREEN with a stamp

**Manual checks (if no CLI):**
- Owner dashboard, Members > Import: download the template; upload a name-and-phone-only synthetic file in a fee gym and in a fee-0 gym (warning, acknowledgement); upload a file mixing plan and no-plan rows; check an imported person with no plan shows "Awaiting registration fee" with Collect and Waive.
