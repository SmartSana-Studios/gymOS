---
date: 2026-09-07
trigger: "Phone-number inputs have no country picker; downstream WhatsApp/SMS/OTP delivery and phone-based lookups depend on correct E.164 formatting"
mode: incremental
status: approved
---

# Sprint Change Proposal — 2026-09-07 (Phone Country Picker)

## 1. Issue Summary

Every phone-number field in the product (member, staff, gym-owner, coach,
and Mobile-Money payer phone) is a plain text input with no country
picker. Discipline around the required E.164 format
(`/^\+[1-9]\d{7,14}$/`, enforced only in Zod schemas) is inconsistent at
entry time:

- `MemberModal` and `RenewalModal` hardcode a `+237` default; `AddStaffModal`
  has no default or prefix handling at all — a plain, unassisted text
  field.
- Mobile's `onboarding/phone.tsx` hardcodes `COUNTRY_PREFIX = '+237'` with
  no picker.
- No database `CHECK` constraint backs the format — enforcement is
  whatever each form remembers to do at input time.

This is not hypothetical risk — it has already caused real defects:

- `docs/decisions.md` (Story 9.4 entry, item h): a real phone-matching bug
  in `createStaffMember()` caused by a `+`-prefix mismatch between GoTrue's
  storage convention (no leading `+`) and this codebase's `+`-required
  E.164 schemas. Fixed in `staff.ts`, but the identical defect shape in
  `members.ts`'s `findOrCreateUserByPhone()` was logged to
  `deferred-work.md` as unverified, not fixed.
- A deferred code-review note on Story 4.12 flags that `getRenewalPreview`
  (`apps/dashboard/services/subscriptions.ts:168-202`) only checks phone
  *truthiness*, not E.164 *shape*, before pre-filling the Mobile-Money
  payer-phone field in `RenewalModal` — a malformed number can reach Tara
  Money's `initiatePayment` call silently.

Separately, `packages/types/src/constants/taraMoneySupportedCountries.ts`
already carries a 15-country African calling-code list whose own comment
states it exists to "drive phone-input formatting/validation UX" — it has
never actually been wired into any UI.

The user has decided to close this gap by adding a country picker with
automatic country-code prefixing to every phone input, and — after
discussion — to make it a **fully global** picker (not limited to the
15-country Tara Money list), since most phone fields are plain contact
information unrelated to Tara Money.

## 2. Impact Analysis

**Epic Impact:** No existing epic is reopened. Epics 1, 2, 4, and 9 (the
epics whose forms contain a phone field) are each functionally complete
(all stories `done` except unrelated Story 1.16, in review). Rather than
distributing small edits across four already-wrapped-up epics, this adds
one new, small, cross-cutting epic: **Epic 16 — Phone Number Country
Picker & Auto Country-Code Entry**, with two stories (web, mobile).

**Story Impact:** Two new stories only (16.1, 16.2 — see §4.3/4.4). No
existing story's acceptance criteria are edited. `RenewalModal`'s
Mobile-Money branch is touched, but only additively (better validation +
a restricted picker on one existing field), not reworked.

**Artifact Conflicts:**
- **PRD** — no MVP/scope conflict. The PRD's Cameroon-first V1 targeting
  describes which *gyms* are piloted, not which countries a phone number
  may belong to (diaspora members, traveling staff, etc. are already
  real). The phone-format data row is amended to describe picker-assisted
  entry. One new FR line documents the picker and the one functional
  restriction it must preserve (Mobile-Money payer phone stays limited to
  Tara Money's 15 supported countries — confirmed by tracing
  `RenewalModal.tsx` → `initiatePayment` → Tara Money; every other phone
  field, including `RecordPaymentModal` which has no phone field at all,
  is unaffected by that restriction).
- **`docs/decisions.md`** — new dated entry recording the
  global-vs-restricted split, so a future reader doesn't "fix" the
  Mobile-Money field into a global picker and silently break Tara Money
  collection for unsupported countries.
- **Architecture** — no structural change. No shared UI package exists
  across `apps/dashboard`/`apps/super-admin` today (only `packages/types`
  is shared); the new `PhoneInput` component is duplicated per-app,
  matching the existing convention for `components/ui/input.tsx`. Mobile
  (`apps/mobile`, Expo/React Native) needs its own implementation — it
  cannot share the web component. Country/calling-code data is sourced
  from `libphonenumber-js`, already a dependency (currently used
  server-side only, in `EvolutionApiMessageProvider.ts`), avoiding a new
  data dependency; flags can use Unicode regional-indicator emoji,
  avoiding a new image-asset pipeline.
- **UX** — no existing UX spec documents a phone-input pattern
  (`DESIGN.md` has zero mentions of "phone"). This is a net-new pattern;
  acceptance criteria specify the interaction directly in the story
  (country picker + auto-prefixed calling code + live E.164 validation),
  mirroring how prior V1.5 stories without a Figma mockup have been
  resolved.
- **Other artifacts** — no DB `CHECK` constraint is added (would require
  a migration plus a backfill/audit of existing malformed rows; flagged
  as a follow-up, not actioned here, since the ask is about entry-time UX
  not data migration). New component-level tests are added per story
  (no existing E2E suite covers phone entry to extend).

**Technical Impact:** New shared component in each web app
(`apps/dashboard/components/ui/`, `apps/super-admin/components/ui/`) and
a new mobile component in `apps/mobile`. No new backend endpoints, no
schema/migration changes. `RenewalModal`'s Mobile-Money validation path
gains a stricter E.164-shape check before allowing submission.

## 3. Recommended Approach

**Direct Adjustment** — add Epic 16 (Stories 16.1, 16.2) to the backlog.
Purely additive; nothing shipped is reworked or removed.

- Effort: Medium — one new component per platform (web, mobile), rollout
  across ~11 existing forms, plus closing the `getRenewalPreview`
  validation gap.
- Risk: Low — no schema change, no new backend surface; the one
  functional constraint (Mobile-Money payer phone stays Tara-Money-scoped)
  is explicit in the story's acceptance criteria and in `decisions.md` so
  it can't be silently violated by a future edit.
- Timeline impact: none beyond the two stories' own implementation.

## 4. Detailed Change Proposals

### 4.1 PRD (`prd-gym_os-2026-06-20/prd.md`)

Amend the Epic List (~line where Epic 15 is listed) to add:

> **Epic 16: Phone Number Country Picker & Auto Country-Code Entry** —
> every phone-number input across the platform gains a country picker
> that auto-prefixes the correct calling code as the user types,
> producing valid E.164 by construction. Global country coverage for
> contact phones (member, staff, gym owner, coach); Tara Money's
> 15-country list for the one field that triggers automated Mobile-Money
> collection (`RenewalModal`'s payer phone).

Amend the phone data-format row (~line 248, `| phone | E.164 format (e.g.
+237XXXXXXXXX) | Yes |`) to:

> | phone | E.164 format, entered via a country-code picker (global for
> contact phones; Tara Money's 15 supported countries only for the
> Mobile-Money payer-phone field) | Yes |

Insert a new FR (checked against the PRD's current highest FR — `FR-141`
was already claimed the same day by the separate, already-applied
Super-Admin-UI proposal, so this uses **FR-142**):

> **FR-142** — Every phone-number input across the platform (member,
> staff, gym owner, coach, and the Mobile-Money payer-phone field) offers
> a country picker that auto-prefixes the correct calling code as the
> user types, always producing a valid E.164 value. Coverage is global
> for contact phones; the Mobile-Money payer-phone field in the renewal
> flow (FR-050/FR-140) is restricted to Tara Money's supported-country
> list (`taraMoneySupportedCountries.ts`) since only that field triggers
> an automated Tara Money collection call.

Status: **Approved.**

### 4.2 `docs/decisions.md`

Append (do not edit prior entries in place):

> ## 2026-09-07 — Phone-input country picker: global by default, Tara
> Money-restricted only on the Mobile-Money payer field
>
> **Decision — every phone input gets a country picker with
> auto-prefixed calling code, sourced from `libphonenumber-js`'s full
> country list (already a server-side dependency).** One field is the
> exception: `RenewalModal`'s Mobile-Money `payerPhone`, which is the
> only phone field that actually triggers an automated Tara Money
> collection call (`initiatePayment` → Tara Money provider — verified by
> tracing the call chain). That field uses
> `packages/types/src/constants/taraMoneySupportedCountries.ts`'s
> 15-country list instead of the global one, since Tara Money cannot
> collect from unsupported countries. `RecordPaymentModal` has no phone
> field and is unaffected either way.
>
> **Why recorded here:** `taraMoneySupportedCountries.ts`'s own comment
> already stated an intent to drive phone-input UX; without this entry, a
> future reader could reasonably "simplify" by making every phone field
> use that 15-country list (breaking non-Tara-Money contact phones for
> diaspora members/staff) or making all fields global (silently breaking
> Mobile-Money collection for unsupported countries). Both directions are
> plausible-looking mistakes this entry forecloses.

Status: **Approved.**

### 4.3 New Story 16.1 — Web: Shared Country-Picker PhoneInput (Dashboard + Super-Admin)

**Story:** As a gym staff member, owner, or Super Admin, I want every
phone field to offer a country picker that auto-fills the correct calling
code as I type, so that phone numbers are captured correctly regardless
of country and I never have to remember to type a `+` and calling code
myself.

**Draft Acceptance Criteria** (to be finalized by `bmad-create-story`):

1. A new `PhoneInput` component (built once, duplicated into
   `apps/dashboard/components/ui/` and `apps/super-admin/components/ui/`,
   matching this codebase's existing per-app duplication convention for
   `components/ui/input.tsx`) renders a country picker (flag + dial code
   + searchable country name) next to a phone-number field. Selecting a
   country auto-prefixes its calling code into the value; the field's
   `onChange` always emits a valid E.164 string or `null`.
2. Country data comes from `libphonenumber-js`'s metadata (already a
   dependency) — no new country-list dependency is introduced for this
   component.
3. Given every existing dashboard phone field — `MemberModal`,
   `AddStaffModal`, `EditStaffModal`, `CsvImportModal`,
   `InviteMemberModal`, `SettingsForm`, `CoachPortalPageClient` /
   `CoachMemberDetailPageClient` — when the story ships, each is wired to
   `PhoneInput` with the global country list, defaulting to Cameroon
   (`+237`) as the pre-selected country.
4. Given every existing super-admin phone field — `CreateGymModal`,
   `GymMembersTable`, `GymDetailPageClient` — when the story ships, each
   is wired to `PhoneInput` with the global country list, same default.
5. Given `RenewalModal`'s Mobile-Money branch specifically, when the
   payer-phone field renders, then it uses `PhoneInput` restricted to
   `TARAMONEY_SUPPORTED_COUNTRIES` (not the global list) — the picker
   only offers those 15 countries.
6. Given a Mobile-Money renewal submission, when `payerPhone` is not a
   fully valid E.164 value for the selected country, then submission is
   blocked with an inline error — closing the `getRenewalPreview` gap
   where only phone truthiness (not shape) was previously checked.
7. `RecordPaymentModal` is unchanged (it has no phone field).
8. Existing Zod `e164Phone` schemas are unchanged — `PhoneInput` is a UI
   layer that produces values those schemas already accept; no schema
   relaxation or duplication of validation logic.

Status: **Approved** (scope confirmed by user; full task breakdown, dev
notes, and technical references to be produced by `bmad-create-story`
before implementation).

### 4.4 New Story 16.2 — Mobile: Country-Picker Phone Input (Expo)

**Story:** As a gym member or staff user of the mobile app, I want the
phone-entry screen to offer a country picker instead of a fixed `+237`
prefix, so that I can enter my real phone number correctly regardless of
country.

**Draft Acceptance Criteria** (to be finalized by `bmad-create-story`):

1. `apps/mobile/src/app/onboarding/phone.tsx`'s hardcoded
   `COUNTRY_PREFIX = '+237'` and single fixed-prefix `TextInput` are
   replaced with a country-picker-enabled input, defaulting to Cameroon,
   backed by the same calling-code data source used in Story 16.1
   (`libphonenumber-js` metadata) via an Expo/React-Native-compatible
   picker.
2. The equivalent phone field in `(tabs)/profile.tsx` is updated the same
   way.
3. `onboarding-context.tsx` and `otp.tsx` continue to receive a fully
   E.164-formatted phone value unchanged in shape — no downstream OTP or
   Supabase `signInWithOtp` contract changes.
4. Global country coverage (not restricted to the 15-country Tara Money
   list) — mobile onboarding/profile phone is a contact field, not a
   Mobile-Money trigger.

Status: **Approved** (scope confirmed by user; full task breakdown, dev
notes, and technical references to be produced by `bmad-create-story`
before implementation).

## 5. Implementation Handoff

**Scope classification: Minor/Moderate** — two new backlog stories under
one new epic, plus PRD and `docs/decisions.md` edits; no rework of shipped
stories, no schema changes, no epic restructuring beyond adding Epic 16.

- **Planning artifacts (PRD, decisions.md, sprint-status.yaml):** applied
  directly as part of this correct-course session (see below).
- **Story creation:** run `bmad-create-story` for Story 16.1, then 16.2,
  to produce full implementation-artifact files from the draft ACs above.
- **Implementation:** run `bmad-dev-story` against each created story
  file.
- **Success criteria:** every phone field in the product offers a country
  picker and always produces valid E.164; the Mobile-Money payer-phone
  field is restricted to Tara Money's supported countries and validated
  by shape (not just truthiness) before submission; no existing schema,
  RLS policy, or downstream OTP/WhatsApp/SMS contract changes.
