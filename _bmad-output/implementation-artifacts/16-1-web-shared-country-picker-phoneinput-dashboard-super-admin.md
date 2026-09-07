# Story 16.1: Web — Shared Country-Picker PhoneInput (Dashboard + Super-Admin)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym staff member, owner, or Super Admin,
I want every phone field to offer a country picker that auto-fills the correct calling code as I type,
so that phone numbers are captured correctly regardless of country, without having to remember to type a `+` and calling code myself.

## Acceptance Criteria

1. A new `PhoneInput` component is built once and duplicated into `apps/dashboard/components/ui/phone-input.tsx` and `apps/super-admin/components/ui/phone-input.tsx` (matching this codebase's existing per-app duplication of `components/ui/input.tsx` — this follows the architecture's own documented convention; it is not a new exception and does NOT warrant creating a shared `packages/ui` package, which the architecture explicitly defers "until duplication actually hurts"). It renders a country picker (flag + dial code + searchable country name) next to the phone field, auto-prefixes the selected country's calling code into the value on country selection, and its `onChange` always emits a valid E.164 string or `null`.
2. Country/calling-code data comes from `libphonenumber-js`'s metadata (`getCountries()`, `getCountryCallingCode()` — already a dependency in both `apps/dashboard/package.json` and `apps/super-admin/package.json` at `^1.13.12`, usable client-side despite its one existing use being server-side in `EvolutionApiMessageProvider.ts`). Country display names come from the built-in `Intl.DisplayNames` API (zero new dependency — `libphonenumber-js` exposes ISO codes and calling codes only, never names). No new country-list package is introduced.
3. Neither app has a `popover` or `command` (cmdk) shadcn primitive yet. Add shadcn's standard `Popover` + `Command` combo to both apps (`npx shadcn add popover command`, run in each app directory) and use it for the searchable country dropdown — do not hand-roll a custom dropdown/portal/keyboard-navigation implementation.
4. `PhoneInput` is a plain controlled component (`value`/`onChange` props, no internal form-library binding), matching this codebase's established `useState` + Zod convention — explicitly NOT react-hook-form (see `MemberModal.tsx`'s own comment stating this).
5. `MemberModal.tsx` (create mode only — phone is `disabled` in edit mode and shown as plain text in view mode via `DetailField`; both stay unchanged) is wired to `PhoneInput` with the **global** country list, defaulting to Cameroon (`+237`) as the pre-selected country. The existing `fieldErrors.phone` inline error display (`<p className="text-sm text-red-600">`) is preserved.
6. `AddStaffModal.tsx` is wired to `PhoneInput` with the **global** country list, same default, preserving its existing `fieldErrors.phone` inline error display.
7. `CreateGymModal.tsx`'s `ownerPhone` field (super-admin) is wired to `PhoneInput` with the **global** country list, same default, preserving its existing `fieldErrors.ownerPhone` inline error display.
8. `RenewalModal.tsx`'s Mobile-Money `payerPhone` field — the only phone field anywhere that triggers an automated Tara Money collection call (`handleMobileMoneySubmit` → `initiatePaymentAction` → Tara Money) — is wired to `PhoneInput` restricted to `TARAMONEY_SUPPORTED_COUNTRIES` (`packages/types/src/constants/taraMoneySupportedCountries.ts`, not the global list — the picker only offers those 15 countries). When the pre-filled value from `getRenewalPreview`'s `memberPhone` doesn't parse as valid E.164 (a legacy pre-convention record), `PhoneInput` falls back to the default Cameroon selection with an empty/raw national-number field, matching today's `DEFAULT_PHONE_PREFIX` fallback behavior, rather than rendering in a broken or unparseable state.
9. `handleMobileMoneySubmit`'s existing `initiatePaymentSchema.shape.phoneNumber.safeParse(...)` client-side check already blocks a malformed `payerPhone` with an inline `fieldErrors.payerPhone` before ever calling `initiatePaymentAction` — this is **already correct and already shipped** (confirmed by re-reading the current code; the deferred-work.md entry claiming otherwise has been struck as resolved during this story's creation). This story does NOT add new submission-blocking validation — it only swaps the plain `<Input type="tel">` for `PhoneInput`, which must keep feeding that same `safeParse` call its emitted E.164 string unchanged.
10. `EditStaffModal.tsx`'s phone field is `readOnly`/`disabled` and never submitted (staff phone cannot be edited after creation) — it is explicitly left unchanged. No functional or visual benefit to wiring a non-interactive field into a picker component.
11. `CsvImportModal.tsx` (phone is read-only preview-table text sourced from parsed CSV rows — no `<Input>` exists at all), `InviteMemberModal.tsx` (no phone field — only reads an existing E.164 value to build a `wa.me` link), `RecordPaymentModal.tsx` (no phone field at all), and super-admin's `GymMembersTable.tsx`/`GymDetailPageClient.tsx` (phone shown as read-only display text, no `<Input>`) are all left unchanged — none has an editable phone input to wire.
12. `SettingsForm.tsx` has no owner/staff phone `<Input>` of its own (billing's `ownerPhone` is only passed as a display prop into a separate `PayNowButton.tsx` component, not covered by this story's research), and the Coach portal files (`CoachPortalPageClient.tsx`/`CoachMemberDetailPageClient.tsx`) were not confirmed to contain an editable phone field either. The dev agent verifies both during implementation (grep for a phone `<Input>` in `PayNowButton.tsx` and the Coach portal files) and either wires them in following this story's same pattern if a real editable field is found, or explicitly records in Completion Notes that none exists.
13. The existing per-file `e164Phone` Zod regex (`/^\+[1-9]\d{7,14}$/`, independently redeclared in `payment.ts`, `staff.ts`, `gym.ts`, `csvImport.ts`, `memberOnboarding.ts`, `member.ts` — a deliberate "no shared cross-file consts" project convention, not an oversight) is unchanged and NOT consolidated into a shared validator. `PhoneInput` is a UI layer producing values those schemas already accept.
14. Any new user-facing string `PhoneInput` introduces (e.g. "Search country...", "No country found") gets matching keys added to both `apps/dashboard/locales/{en,fr}.json` and `apps/super-admin/locales/{en,fr}.json` — one key set per app, duplicated like the component itself, NOT promoted to `packages/types/src/locales` (reserved for security-sensitive shared logic, not cosmetic UI strings) — via `react-i18next`'s `useTranslation()`/`t()`, verified by `scripts/check-i18n-key-parity.mjs`.
15. A co-located `PhoneInput.test.tsx` is added in each app (Vitest + `@testing-library/react` + `@testing-library/user-event`, this codebase's only test convention — no E2E baseline exists yet) covering: country selection, calling-code auto-prefix on selection, and correct E.164 emission via `onChange`. The existing `RenewalModal.mobileMoney.test.tsx` is updated to account for `PhoneInput` replacing the plain `<Input>` in the mobile-money branch.

## Tasks / Subtasks

- [ ] Task 1 — Add shadcn primitives (AC: #3)
  - [ ] Run `npx shadcn add popover command` in `apps/dashboard` and again in `apps/super-admin`
  - [ ] Confirm both apps' `components/ui/popover.tsx` and `components/ui/command.tsx` land byte-similar to the existing byte-identical `input.tsx` pattern (cosmetic drift only is fine, per architecture.md:340)

- [ ] Task 2 — Build `PhoneInput` (AC: #1, #2, #4)
  - [ ] Create `apps/dashboard/components/ui/phone-input.tsx`: props `{ value: string | null; onChange: (value: string | null) => void; countries?: "global" | "tara-money"; disabled?: boolean; id?: string; placeholder?: string }` (adjust naming to match this app's other `components/ui/` prop conventions)
  - [ ] Country list: `"global"` → `libphonenumber-js`'s `getCountries()` mapped through `new Intl.DisplayNames([locale], { type: "region" })` for names and `getCountryCallingCode(country)` for dial codes, sorted by display name; `"tara-money"` → `TARAMONEY_SUPPORTED_COUNTRIES` from `packages/types/src/constants/taraMoneySupportedCountries.ts` (already has `code`/`name`/`callingCode` — no `Intl.DisplayNames` needed for this branch)
  - [ ] Flag rendering: Unicode regional-indicator emoji derived from the ISO alpha-2 code (no image assets, no new dependency)
  - [ ] Picker UI: `Popover` trigger showing the selected flag + calling code, `Command` inside listing searchable countries; selecting one updates the calling-code prefix
  - [ ] `onChange` contract: parse the current national-number input against the selected country via `libphonenumber-js`'s `parsePhoneNumberFromString`/`isValidPhoneNumber`, emit `.number` (E.164) when valid, otherwise emit `null` — never emit a partial/invalid string
  - [ ] Locale for `Intl.DisplayNames`: read from this app's existing `react-i18next` `i18n.language` (matches whatever pattern `SettingsForm.tsx`/`ClassModal.tsx` already use to read the active locale)
  - [ ] Copy `apps/dashboard/components/ui/phone-input.tsx` into `apps/super-admin/components/ui/phone-input.tsx`, adjusting only the `cn`/`@/lib/utils` import path if it differs (confirmed byte-identical for `input.tsx`, so this should be a straight copy)

- [ ] Task 3 — Wire `MemberModal.tsx` (AC: #5)
  - [ ] Replace the `<Input>` block at lines 561-571 (`id="memberPhone"`) with `<PhoneInput countries="global" value={form.phone} onChange={(v) => setForm({ ...form, phone: v ?? "" })} disabled={isEdit} />`
  - [ ] Keep `DEFAULT_PHONE_PREFIX = "+237"` (line 96) driving `emptyForm.phone`'s initial value — `PhoneInput` should parse this into "Cameroon selected, empty national number" on initial render
  - [ ] Keep the `fieldErrors.phone` paragraph exactly as-is, unchanged

- [ ] Task 4 — Wire `AddStaffModal.tsx` (AC: #6)
  - [ ] Replace the `<Input>` block at lines 178-187 (`id="staffPhone"`) the same way, using `form.phone`/`setForm({ ...form, phone: v ?? "" })`
  - [ ] Keep `fieldErrors.phone` paragraph unchanged

- [ ] Task 5 — Wire `CreateGymModal.tsx` (AC: #7)
  - [ ] Replace the `<Input>` block at lines 168-179 (`id="ownerPhone"`) using `form.ownerPhone`/`setForm({ ...form, ownerPhone: v ?? "" })`
  - [ ] Keep `fieldErrors.ownerPhone` block unchanged (note: this app's error text comes from `createGymSchema.safeParse` issue.message directly, not an i18n `FIELD_ERROR_KEY` map like the dashboard app — do not introduce one here, out of scope)

- [ ] Task 6 — Wire `RenewalModal.tsx`'s Mobile-Money branch (AC: #8, #9)
  - [ ] Replace the `<Input type="tel">` block at lines 539-551 (`id="renewalPayerPhone-${domIdSuffix}"`) with `<PhoneInput countries="tara-money" value={payerPhone} onChange={(v) => setPayerPhone(v ?? "")} disabled={mobileMoneyPhase === "sending" || !preview} />`
  - [ ] Verify the pre-fill effect at line 184 (`setPayerPhone(data.memberPhone ?? DEFAULT_PHONE_PREFIX)`) still works — `PhoneInput` must gracefully render a non-E.164 legacy `memberPhone` value by falling back to the Cameroon-selected/empty-national-number state, not by crashing or rendering `NaN`/`undefined`
  - [ ] Do NOT touch `handleMobileMoneySubmit` (lines 334-362) — its `initiatePaymentSchema.shape.phoneNumber.safeParse(payerPhone.trim())` call and `fieldErrors.payerPhone` handling are already correct and must keep receiving `PhoneInput`'s emitted E.164 string via `payerPhone` unchanged
  - [ ] Leave the non-mobile-money `else` branch (lines 552-565, the `note` textarea) untouched

- [ ] Task 7 — Verify SettingsForm/PayNowButton/Coach portal (AC: #12)
  - [ ] Grep `apps/dashboard/components/shared/PayNowButton.tsx` for an editable phone `<Input>` — if found, wire it the same way as Tasks 3-6; if not (display-only), record that in Completion Notes
  - [ ] Grep `CoachPortalPageClient.tsx`/`CoachMemberDetailPageClient.tsx` for the same — wire if found, record if not

- [ ] Task 8 — i18n (AC: #14)
  - [ ] Add any new `PhoneInput`-introduced strings to `apps/dashboard/locales/en.json`/`fr.json` and `apps/super-admin/locales/en.json`/`fr.json`
  - [ ] Run `scripts/check-i18n-key-parity.mjs` and confirm clean

- [ ] Task 9 — Tests (AC: #15)
  - [ ] Add `apps/dashboard/components/ui/phone-input.test.tsx` and `apps/super-admin/components/ui/phone-input.test.tsx`
  - [ ] Update `apps/dashboard/components/shared/RenewalModal.mobileMoney.test.tsx` for the new `PhoneInput` in the mobile-money branch
  - [ ] Run `pnpm --filter dashboard test` and `pnpm --filter super-admin test` (or this repo's equivalent), confirm clean

- [ ] Task 10 — Cleanup (AC: #9)
  - [ ] Confirm `deferred-work.md`'s `getRenewalPreview` entry (already struck 2026-09-07 during this story's creation) needs no further action

## Dev Notes

- **Ground truth was verified by reading every target file, not inferred from the epic/PRD.** The original sprint-change-proposal assumed ~9 web fields needed wiring; only 4 real editable phone `<Input>` fields actually exist across both apps (`MemberModal` create-mode, `AddStaffModal`, `CreateGymModal`'s `ownerPhone`, `RenewalModal`'s `payerPhone`). Everything else surveyed is either read-only display text, has no phone field at all, or is a non-submitted disabled field (`EditStaffModal`) — see AC #10, #11 for the full accounting. Do not re-expand scope back to the original 9-field assumption.
- **The `getRenewalPreview` "validation gap" this epic was partly triggered by is already fixed** (shipped as an undocumented side effect of a later "Made outside story scope" change on 2026-08-18 per `deferred-work.md`). `handleMobileMoneySubmit` already runs `initiatePaymentSchema.shape.phoneNumber.safeParse(...)` and shows an inline error before ever calling the server. Do not re-implement this — see AC #9.
- **No shared UI package exists** (`packages/types` is the only shared package; `packages/ui` is explicitly deferred in the architecture "until duplication actually hurts"). `PhoneInput` is duplicated per-app in `components/ui/`, exactly like `input.tsx` already is (confirmed byte-identical between the two apps). This is not a deviation needing a `docs/decisions.md` entry — it's the documented default.
- **Controlled-field convention:** this codebase deliberately does not use react-hook-form. `MemberModal.tsx:156-158` states this explicitly ("controlled string-based form state ... not react-hook-form"). Every phone field's parent uses plain `useState` on a form object; `PhoneInput` must be a plain controlled `value`/`onChange` component to slot into that pattern with a one-line replacement at each call site.
- **No country-name data source exists yet.** `libphonenumber-js` (already a dependency, `^1.13.12` in both apps) gives ISO codes and calling codes via `getCountries()`/`getCountryCallingCode()`, but no display names. Use the built-in `Intl.DisplayNames` API (no new dependency) rather than adding a name-list package or hand-writing one.
- **No combobox/popover primitive exists yet.** Only `button`, `input`, `label`, `checkbox`, `card`, `badge`, `tabs`, `dropdown-menu` are installed in either app's `components/ui/`. Add shadcn's `popover` + `command` (the canonical shadcn combobox recipe) rather than hand-rolling dropdown positioning/keyboard nav.
- **i18n:** `react-i18next` + `t()` is the established hook; locale files are per-app (`apps/dashboard/locales/`, `apps/super-admin/locales/`), checked for en/fr key parity by `scripts/check-i18n-key-parity.mjs` in CI. `packages/types/src/locales/` exists but is reserved for cross-app *security-sensitive* shared strings (per architecture.md's stated rationale for that one promotion) — do not put cosmetic `PhoneInput` strings there.
- **Testing:** Vitest + `@testing-library/react` + `@testing-library/user-event`, co-located `*.test.tsx`. No E2E/Playwright baseline exists for the dashboard/super-admin apps yet — component-level tests are the ceiling of automated coverage available here, matching every prior story's precedent.
- **`RenewalModal.tsx`'s payer-phone field is intentionally always offered, even with no phone on file** — a 2026-08-18 change (`deferred-work.md`, "Made outside story scope") deliberately removed a hard block on `memberPhone` being null, specifically so a member without a phone on file isn't dead-ended from paying by Mobile Money. Do not reintroduce a truthiness/validity gate on whether the Mobile-Money option is *offered* — the fix belongs entirely inside `PhoneInput`'s own graceful-fallback rendering (AC #8), not in `RenewalModal`'s method-selection logic.
- **Tara Money restriction is functional, not cosmetic.** Verified by tracing `RenewalModal.tsx` → `handleMobileMoneySubmit` → `initiatePaymentAction` → `initiatePayment` (services/payments.ts) → Tara Money provider. This is the only phone field anywhere in the codebase that reaches Tara Money. Every other field must use the global list; this one must not.

### Project Structure Notes

- New files: `apps/dashboard/components/ui/phone-input.tsx`, `apps/super-admin/components/ui/phone-input.tsx`, plus each app's `popover.tsx`/`command.tsx` (from `npx shadcn add`), plus co-located `phone-input.test.tsx` in each app.
- Modified files: `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx`, `apps/dashboard/app/(dashboard)/settings/staff/components/AddStaffModal.tsx`, `apps/super-admin/app/(admin)/gyms/components/CreateGymModal.tsx`, `apps/dashboard/components/shared/RenewalModal.tsx`, `apps/dashboard/components/shared/RenewalModal.mobileMoney.test.tsx`, `apps/dashboard/locales/{en,fr}.json`, `apps/super-admin/locales/{en,fr}.json`, `_bmad-output/implementation-artifacts/deferred-work.md` (already struck during story creation, see below).
- No database, RLS, migration, or Server Action changes — this is a UI-only story.
- No conflicts detected with the unified project structure; `components/ui/` is exactly where a new shadcn-style primitive belongs in both apps.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 16.1: Web — Shared Country-Picker PhoneInput (Dashboard + Super-Admin)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-07-phone-country-picker.md]
- [Source: docs/decisions.md#2026-09-07 — Phone-input country picker: global by default, Tara Money-restricted only on the Mobile-Money payer field]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — struck entry under "Deferred from: code review of story-4-12-notch-pay-tara-money-cutover (2026-08-17)"]
- [Source: packages/types/src/constants/taraMoneySupportedCountries.ts]
- [Source: apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx:96,100,156-158,561-571]
- [Source: apps/dashboard/app/(dashboard)/settings/staff/components/AddStaffModal.tsx:178-187]
- [Source: apps/dashboard/app/(dashboard)/settings/staff/components/EditStaffModal.tsx:188-191]
- [Source: apps/dashboard/components/shared/RenewalModal.tsx:28-36,130,184,334-362,539-565]
- [Source: apps/super-admin/app/(admin)/gyms/components/CreateGymModal.tsx:26,74-81,93-94,168-179]
- [Source: apps/dashboard/components/ui/input.tsx and apps/super-admin/components/ui/input.tsx (byte-identical)]
- [Source: apps/dashboard/services/subscriptions.ts:143-153,168-202 getRenewalPreview]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
