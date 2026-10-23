# Epic 26 Context: Member Roster Import & Profile Fields

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A gym taking over an existing roster (names, phones, ages, professions, neighborhoods, no plan data) can load it in one step, then decide person by person who owes the registration fee and which plan they get. This adds optional profile fields to members and a second, members-only CSV import that leaves everyone awaiting the fee with no plan, the opposite of today's plan import.

## Stories

- Story 26.1: Member Profile Fields: Birth Year, Profession, Neighborhood
- Story 26.2: Members-Only CSV Import: No Plan, Awaiting the Fee

## Requirements & Constraints

- A member optionally carries birth year, profession and neighborhood, entered by staff (Owner, Supervisor, Manager, Receptionist) and shown with the member. Nothing is required; blanks save as null; text is trimmed.
- Birth year is shown only as an approximate age (current year minus birth year, labelled approximate in EN and FR), never as a date of birth; no birth year shows nothing, not zero. The existing optional `dob` is unchanged.
- Member export includes the three fields; the formula-injection guard covers the two text fields.
- Privacy policy page and `docs/privacy-policy.md` list the new data categories and purpose in EN and FR. The member app neither shows nor collects them.
- Members-only import: header exactly `member_name,phone,birth_year,profession,neighborhood`. The existing six-column plan import is unchanged; any other header is refused with the invalid-template message naming both templates' columns.
- Rows create members with normalized/validated phone (E.164, gym country for local numbers), the profile fields, `join_date` = import date, no subscription, no plan. Names are one field, first then last, Title Case.
- Fee gym (fee > 0): members are left awaiting the fee (not settled, not import-exempt), same as a member added by hand. Fee 0: import allowed, but preview shows a clear warning (nobody awaits a fee) and proceeds only after the Owner confirms.
- Validation matches the plan import: duplicate phone in file, phone already in the gym, missing name/phone, birth year outside 1900 to the current year, over 1000 rows are reported per row and nothing imports if any row fails.
- Result states members created and members awaiting the fee. One audit row per batch with counts only (no names or phones). No rows under any other gym.
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
