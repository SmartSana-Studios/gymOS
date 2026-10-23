# Epic 26 Context: Member Roster Import & Profile Fields

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A gym taking over an existing roster (names, phones, ages, professions, neighborhoods, no plan data) can load it in one step, then decide person by person who owes the registration fee and which plan they get. This adds optional profile fields to members and plan-optional rows in the one CSV import: a row without a plan leaves the person awaiting the fee.

## Stories

- Story 26.1: Member Profile Fields: Birth Year, Profession, Neighborhood
- Story 26.2: Members-Only CSV Import: No Plan, Awaiting the Fee

## Requirements & Constraints

- A member optionally carries birth year, profession and neighborhood, entered by staff (Owner, Supervisor, Manager, Receptionist) and shown with the member. Nothing is required; blanks save as null; text is trimmed.
- Birth year is shown only as an approximate age (current year minus birth year, labelled approximate in EN and FR), never as a date of birth; no birth year shows nothing, not zero. The existing optional `dob` is unchanged.
- Member export includes the three fields; the formula-injection guard covers the two text fields.
- Privacy policy page and `docs/privacy-policy.md` list the new data categories and purpose in EN and FR. The member app neither shows nor collects them.
- One import template (renegotiated 2026-10-23): header `member_name,phone,plan_type,join_date,subscription_status,expiry_date,birth_year,profession,neighborhood`; only `member_name` and `phone` are required. A row with a plan behaves as today (settled in a fee gym); a row without one creates no subscription and awaits the fee. Status or expiry without a plan is a row error.
- Rows create members with normalized/validated phone (E.164, gym country for local numbers), the profile fields, and either a plan (as today) or none. A row without a plan has no subscription and its `join_date` is optional (blank means the import date). Names are one field, first then last, Title Case.
- Fee gym (fee > 0): members are left awaiting the fee (not settled, not import-exempt), same as a member added by hand. Fee 0: import allowed, but a clear warning is shown and the server refuses to confirm without an explicit acknowledgement.
- Validation matches the plan import: duplicate phone in file, phone already in the gym, missing name/phone, birth year outside 1900 to the current year, over 1000 rows are reported per row and nothing imports if any row fails.
- Result states members created and members awaiting the fee. One audit row per member; rows without a plan carry no name and no phone. No rows under any other gym.
- The real roster file is personal data: never committed, logged or printed; tests use synthetic rows only.

## Technical Decisions

- Migration adds nullable `birth_year smallint` (1900 to 2100), `profession text`, `neighborhood text` (each at most 120 chars trimmed) to `public.members`. Existing rows stay null. Migration number is the next free at merge time (0154 on epic/23); epic is built on `epic/23`.
- No policy, trigger, audit action or RPC permission changes; existing gym-scoped member policies cover the new columns like `phone`. A pgTAP test proves another gym's member cannot read them.
- 26.2 expects no migration: the importer reuses the member-creation path (and so the registration-fee state: `registration_fee_settled_at` NULL means awaiting the fee).
- Scan-style guard tests: one enumerates all `members` writers (create/edit, plan CSV import, support staff-creation, members-only import), each must validate the three fields or leave them null; another enumerates consumers of the member-creation path, fee state and audit write, which the members-only import must pass through. Unlisted new writers/importers fail the scan.
- Existing import code lives in `apps/dashboard/services/csvImport.ts` and `packages/types/src/schemas/csvImport.ts` (Story 2.4); Story 18.5 makes the plan import settle each row, which must stay untouched.

## UX & Interaction Patterns

- Profile fields appear in member create/edit, member detail, members list and export; birth year errors show inline.
- Import flow: upload, template recognition, per-row error report, preview (with fee-0 warning and confirm), then result summary.

## Cross-Story Dependencies

- 26.1 depends on Story 2.3 (members) and 18.1 (fee state); 26.2 depends on 26.1, 18.5 and 2.4, and its importer is listed in 26.1's writer scan.
- Migration numbering depends on Epic 23's last migration being merged first.
