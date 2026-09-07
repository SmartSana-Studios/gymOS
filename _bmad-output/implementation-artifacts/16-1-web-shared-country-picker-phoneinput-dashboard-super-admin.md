---
baseline_commit: c49a7763f8228c94a36589946967a6f2143e9186
---

# Story 16.1: Web — Shared Country-Picker PhoneInput (Dashboard + Super-Admin)

Status: review

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

- [x] Task 1 — Add shadcn primitives (AC: #3)
  - [x] Run `npx shadcn add popover command` in `apps/dashboard` and again in `apps/super-admin`
  - [x] Confirm both apps' `components/ui/popover.tsx` and `components/ui/command.tsx` land byte-similar to the existing byte-identical `input.tsx` pattern (cosmetic drift only is fine, per architecture.md:340)

- [x] Task 2 — Build `PhoneInput` (AC: #1, #2, #4)
  - [x] Create `apps/dashboard/components/ui/phone-input.tsx`: props `{ value: string | null; onChange: (value: string | null) => void; countries?: "global" | "tara-money"; disabled?: boolean; id?: string; placeholder?: string }` (adjust naming to match this app's other `components/ui/` prop conventions)
  - [x] Country list: `"global"` → `libphonenumber-js`'s `getCountries()` mapped through `new Intl.DisplayNames([locale], { type: "region" })` for names and `getCountryCallingCode(country)` for dial codes, sorted by display name; `"tara-money"` → `TARAMONEY_SUPPORTED_COUNTRIES` from `packages/types/src/constants/taraMoneySupportedCountries.ts` (already has `code`/`name`/`callingCode` — no `Intl.DisplayNames` needed for this branch)
  - [x] Flag rendering: Unicode regional-indicator emoji derived from the ISO alpha-2 code (no image assets, no new dependency)
  - [x] Picker UI: `Popover` trigger showing the selected flag + calling code, `Command` inside listing searchable countries; selecting one updates the calling-code prefix
  - [x] `onChange` contract: parse the current national-number input against the selected country via `libphonenumber-js`'s `parsePhoneNumberFromString`/`isValidPhoneNumber`, emit `.number` (E.164) when valid, otherwise emit `null` — never emit a partial/invalid string
  - [x] Locale for `Intl.DisplayNames`: read from this app's existing `react-i18next` `i18n.language` (matches whatever pattern `SettingsForm.tsx`/`ClassModal.tsx` already use to read the active locale)
  - [x] Copy `apps/dashboard/components/ui/phone-input.tsx` into `apps/super-admin/components/ui/phone-input.tsx`, adjusting only the `cn`/`@/lib/utils` import path if it differs (confirmed byte-identical for `input.tsx`, so this should be a straight copy)

- [x] Task 3 — Wire `MemberModal.tsx` (AC: #5)
  - [x] Replace the `<Input>` block at lines 561-571 (`id="memberPhone"`) with `<PhoneInput countries="global" value={form.phone} onChange={(v) => setForm({ ...form, phone: v ?? "" })} disabled={isEdit} />`
  - [x] Keep `DEFAULT_PHONE_PREFIX = "+237"` (line 96) driving `emptyForm.phone`'s initial value — `PhoneInput` should parse this into "Cameroon selected, empty national number" on initial render
  - [x] Keep the `fieldErrors.phone` paragraph exactly as-is, unchanged

- [x] Task 4 — Wire `AddStaffModal.tsx` (AC: #6)
  - [x] Replace the `<Input>` block at lines 178-187 (`id="staffPhone"`) the same way, using `form.phone`/`setForm({ ...form, phone: v ?? "" })`
  - [x] Keep `fieldErrors.phone` paragraph unchanged

- [x] Task 5 — Wire `CreateGymModal.tsx` (AC: #7)
  - [x] Replace the `<Input>` block at lines 168-179 (`id="ownerPhone"`) using `form.ownerPhone`/`setForm({ ...form, ownerPhone: v ?? "" })`
  - [x] Keep `fieldErrors.ownerPhone` block unchanged (note: this app's error text comes from `createGymSchema.safeParse` issue.message directly, not an i18n `FIELD_ERROR_KEY` map like the dashboard app — do not introduce one here, out of scope)

- [x] Task 6 — Wire `RenewalModal.tsx`'s Mobile-Money branch (AC: #8, #9)
  - [x] Replace the `<Input type="tel">` block at lines 539-551 (`id="renewalPayerPhone-${domIdSuffix}"`) with `<PhoneInput countries="tara-money" value={payerPhone} onChange={(v) => setPayerPhone(v ?? "")} disabled={mobileMoneyPhase === "sending" || !preview} />`
  - [x] Verify the pre-fill effect at line 184 (`setPayerPhone(data.memberPhone ?? DEFAULT_PHONE_PREFIX)`) still works — `PhoneInput` must gracefully render a non-E.164 legacy `memberPhone` value by falling back to the Cameroon-selected/empty-national-number state, not by crashing or rendering `NaN`/`undefined`
  - [x] Do NOT touch `handleMobileMoneySubmit` (lines 334-362) — its `initiatePaymentSchema.shape.phoneNumber.safeParse(payerPhone.trim())` call and `fieldErrors.payerPhone` handling are already correct and must keep receiving `PhoneInput`'s emitted E.164 string via `payerPhone` unchanged
  - [x] Leave the non-mobile-money `else` branch (lines 552-565, the `note` textarea) untouched

- [x] Task 7 — Verify SettingsForm/PayNowButton/Coach portal (AC: #12)
  - [x] Grep `apps/dashboard/components/shared/PayNowButton.tsx` for an editable phone `<Input>` — if found, wire it the same way as Tasks 3-6; if not (display-only), record that in Completion Notes
  - [x] Grep `CoachPortalPageClient.tsx`/`CoachMemberDetailPageClient.tsx` for the same — wire if found, record if not

- [x] Task 8 — i18n (AC: #14)
  - [x] Add any new `PhoneInput`-introduced strings to `apps/dashboard/locales/en.json`/`fr.json` and `apps/super-admin/locales/en.json`/`fr.json`
  - [x] Run `scripts/check-i18n-key-parity.mjs` and confirm clean

- [x] Task 9 — Tests (AC: #15)
  - [x] Add `apps/dashboard/components/ui/phone-input.test.tsx` and `apps/super-admin/components/ui/phone-input.test.tsx`
  - [x] Update `apps/dashboard/components/shared/RenewalModal.mobileMoney.test.tsx` for the new `PhoneInput` in the mobile-money branch
  - [x] Run `pnpm --filter dashboard test` and `pnpm --filter super-admin test` (or this repo's equivalent), confirm clean

- [x] Task 10 — Cleanup (AC: #9)
  - [x] Confirm `deferred-work.md`'s `getRenewalPreview` entry (already struck 2026-09-07 during this story's creation) needs no further action

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

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `pnpm --filter dashboard typecheck` / `pnpm --filter super-admin typecheck`: 0 errors, throughout.
- `pnpm --filter dashboard lint` / `pnpm --filter super-admin lint`: 0 errors (only pre-existing unrelated warnings: `staff.*.test.ts`/`EvolutionApiMessageProvider.test.ts` unused-var warnings, `PaymentProvidersPageClient.tsx`'s pre-existing exhaustive-deps warning).
- `pnpm --filter dashboard test`: 226/226 passed (33 files). `pnpm --filter super-admin test`: 7/7 passed (1 file — first test runner this app has ever had).
- `node scripts/check-i18n-key-parity.mjs`: clean, all four locale directories in parity (dashboard 735 keys, super-admin 297 keys).
- `pnpm --filter dashboard build` / `pnpm --filter super-admin build`: both clean production builds (Next 16.3.4, Cache Components), Partial Prerender boundaries held on every existing dynamic route.

### Completion Notes List

- **`npx shadcn add popover command` generated code using this codebase's non-established convention** (the current shadcn CLI defaults to the monolithic `radix-ui` meta-package and a separate `cn` npm package, not this repo's existing per-primitive `@radix-ui/react-*` packages + `@/lib/utils`' own `cn`). Normalized `popover.tsx`/`dialog.tsx`/`command.tsx` in both apps to import `@radix-ui/react-popover`/`@radix-ui/react-dialog` (added as explicit `package.json` deps, `^1.1.23`, matching the version `radix-ui@1.6.7` itself depends on) and `@/lib/utils`'s `cn`, removing the `radix-ui`/`cn` package deps entirely — keeps the codebase on one `cn` implementation and one radix-import style instead of two competing ones. `cmdk` (the real dependency Command is built on) is unrelated and was kept as-is.
- **`dialog.tsx`'s generated boilerplate had two hardcoded English "Close" JSX-text literals**, which `eslint-plugin-i18next`'s `no-literal-string` rule (enforced in both apps) rejects. Neither literal is on any code path this story actually renders (`PhoneInput` uses `Popover`, not `Dialog`; `CommandDialog` — the only `command.tsx` export that renders `Dialog` — is unused boilerplate here), but the file must still lint clean. Fixed by turning both into an optional `closeLabel?: string` prop the caller supplies, rather than hardcoding an English default — consistent with this codebase having zero hardcoded UI strings anywhere else.
- **Task 7 surfaced a real, previously-untracked scope gap the story's own research had missed**: `apps/dashboard/components/shared/PayNowButton.tsx` (SaaS-billing "Pay Now" dialog, Story 11.3/11.7) has its own hand-rolled country `<select>` (built from the same `TARAMONEY_SUPPORTED_COUNTRIES` list) + phone `<Input>` pair feeding a Tara Money `payNow()` call — a second, functionally-identical instance of exactly the pattern this story replaces in `RenewalModal.tsx`. **This means AC #8's framing of `RenewalModal`'s `payerPhone` as "the only phone field anywhere that triggers an automated Tara Money collection call" is not accurate — `PayNowButton.tsx`'s `payNowPhone` is a second one.** Wired it to `PhoneInput countries="tara-money"` per Task 7's own instruction ("if found, wire it the same way as Tasks 3-6"), which let the hand-rolled `countryCode` state/`handleCountryChange` function/country `<select>` be deleted entirely (`PhoneInput`'s own picker replaces it). Removed the now-orphaned `settings.billing.countryLabel` locale key (was used nowhere else) from both `en.json`/`fr.json`. This also surfaced an existing test file the story hadn't listed, `SettingsForm.billing.test.tsx` — updated its phone-field assertions the same way as `RenewalModal.mobileMoney.test.tsx` (see below).
- `CoachPortalPageClient.tsx`/`CoachMemberDetailPageClient.tsx` (Task 7, second half): confirmed neither has an editable phone field. `CoachPortalPageClient.tsx`'s only phone-adjacent code is a name/phone free-text *search* input (not a phone-entry field); `CoachMemberDetailPageClient.tsx` renders `member.phoneMasked` as plain read-only text. Left unchanged, per AC #12.
- **`RenewalModal.mobileMoney.test.tsx` and `SettingsForm.billing.test.tsx` both needed updating beyond what AC #15/Task 9 anticipated**, because `PhoneInput` splits what used to be one `<Input>` into two focusable elements (a country-picker button + a national-number-only text input): (a) every prior bare `screen.getByRole("combobox")` call in `RenewalModal.mobileMoney.test.tsx` became ambiguous once the mobile-money branch is showing (the picker button also has `role="combobox"`) — disambiguated with `{ name: "Payment method" }`; (b) assertions that previously expected the full E.164 string as the visible input's `value` (`"+237680811041"`, `"+237600000001"`) now expect just the national-number portion (`"680811041"`, `"600000001"`), with a separate assertion on the country-picker button's `+237` text; (c) both files' `react-i18next` mocks needed `phoneInput.*` keys added (they mock `t()` with a fixed table, and `PhoneInput` calls `t()` for its own strings). No behavioral regression — these are the same fields, same submitted values, just a different DOM shape.
- **`apps/super-admin` had no automated test runner at all before this story** (confirmed: no `vitest`, no `vitest.config.mts`, no `test` script in `package.json`) — AC #15 explicitly requires a co-located `phone-input.test.tsx` in *each* app, so `vitest.config.mts`/`vitest.setup.ts`/the `test` script/devDependencies were added, mirroring `apps/dashboard`'s existing setup (Story 2.10) exactly, including its native-`<dialog>`-`showModal()` polyfill (this app's own modals use the same pattern) and a `test` script (`vitest run`) added to `package.json`.
- **`ResizeObserver` and `Element.prototype.scrollIntoView` polyfills added to both apps' `vitest.setup.ts`** — `cmdk` (the Command primitive) calls both on mount/navigation and jsdom implements neither; this is the first component in either app to render `Popover`/`Command`, so the gap was previously invisible. Minimal no-op stubs, mirroring the existing `<dialog>` polyfill's own precedent and rationale.
- `PhoneInput`'s `onChange` contract (AC #1) is enforced by parsing the national-number input against the selected country via `libphonenumber-js`'s `parsePhoneNumberFromString(nationalNumber, country)`, emitting `.number` only when `.isValid()`, otherwise `null` — verified directly in `phone-input.test.tsx` (typing an incomplete number emits `null`; a complete valid one emits the full E.164 string; switching country re-emits E.164 for the already-typed national number using the new calling code).
- AC #8's fallback (a non-E.164 legacy value renders as "Cameroon selected, empty national number") is driven by the same code path as a `null`/empty `value` — `parsePhoneNumberFromString` returns `undefined` for both an unparseable string and a bare calling-code-only string like `"+237"` (`RenewalModal`'s `DEFAULT_PHONE_PREFIX`), so both fall into the identical default-country/empty-field branch; verified in `phone-input.test.tsx` with a bare national-number string (`"680811041"`, no `+`, no country context) as the legacy-shape case.
- Country list for `"global"` is built from `libphonenumber-js`'s `getCountries()`/`getCountryCallingCode()` plus `Intl.DisplayNames` for names (AC #2) — no new dependency, confirmed working under both real Node (dev/build) and Vitest's jsdom environment (it's a JS-engine API, not a DOM one). Flags are Unicode regional-indicator emoji derived from the ISO alpha-2 code (AC #2), no image assets.

### File List

**New:**
- `apps/dashboard/components/ui/phone-input.tsx`
- `apps/dashboard/components/ui/phone-input.test.tsx`
- `apps/dashboard/components/ui/popover.tsx`
- `apps/dashboard/components/ui/command.tsx`
- `apps/dashboard/components/ui/dialog.tsx`
- `apps/super-admin/components/ui/phone-input.tsx`
- `apps/super-admin/components/ui/phone-input.test.tsx`
- `apps/super-admin/components/ui/popover.tsx`
- `apps/super-admin/components/ui/command.tsx`
- `apps/super-admin/components/ui/dialog.tsx`
- `apps/super-admin/vitest.config.mts`
- `apps/super-admin/vitest.setup.ts`

**Modified:**
- `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx`
- `apps/dashboard/app/(dashboard)/settings/staff/components/AddStaffModal.tsx`
- `apps/dashboard/app/(dashboard)/settings/SettingsForm.billing.test.tsx`
- `apps/dashboard/components/shared/RenewalModal.tsx`
- `apps/dashboard/components/shared/RenewalModal.mobileMoney.test.tsx`
- `apps/dashboard/components/shared/PayNowButton.tsx` (beyond-story-research find, Task 7)
- `apps/dashboard/vitest.setup.ts`
- `apps/dashboard/locales/en.json`
- `apps/dashboard/locales/fr.json`
- `apps/dashboard/package.json`
- `apps/dashboard/app/globals.css` (post-review bug fix: native `<select>` white-on-white in dark mode)
- `apps/dashboard/components/ui/popover.tsx` (post-review bug fix: removed Portal wrapper, inert-inside-native-`<dialog>` bug)
- `apps/super-admin/app/(admin)/gyms/components/CreateGymModal.tsx`
- `apps/super-admin/locales/en.json`
- `apps/super-admin/locales/fr.json`
- `apps/super-admin/package.json`
- `apps/super-admin/app/globals.css` (post-review bug fix: native `<select>` white-on-white in dark mode)
- `apps/super-admin/components/ui/popover.tsx` (post-review bug fix: removed Portal wrapper, inert-inside-native-`<dialog>` bug)
- `pnpm-lock.yaml`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-09-07: Story implemented end-to-end (Tasks 1-10). New shared `PhoneInput` component (country-picker + national-number field, `libphonenumber-js` + `Intl.DisplayNames`, shadcn `Popover`/`Command`) duplicated per-app into `apps/dashboard` and `apps/super-admin`; wired into `MemberModal`, `AddStaffModal`, `CreateGymModal`'s `ownerPhone`, and `RenewalModal`'s Mobile-Money `payerPhone`. Task 7's verification pass found and wired a second, previously-untracked Tara-Money-reaching phone field in `PayNowButton.tsx` (not in the story's original research), removing its hand-rolled country `<select>`. Added `apps/super-admin`'s first-ever test runner (Vitest, mirroring `apps/dashboard`'s Story 2.10 setup) to satisfy AC #15 there. i18n key parity clean across all four locale directories; full regression clean (dashboard 226/226, super-admin 7/7, both typecheck/lint/production-build clean). Status: ready-for-dev → in-progress → review.
- 2026-09-07: Manual QA (smartsana, live in the browser against super-admin's Create Gym dialog) found two real bugs, both fixed and verified with Playwright against the running dev server before hand-back (status stays `review`, not reopened to `in-progress` — same-day continuation of the same review pass):
  1. **The country picker didn't respond to clicks at all.** Root cause: `popover.tsx`'s generated `PopoverContent` wrapped in `<PopoverPrimitive.Portal>`, which renders as a sibling of `<body>` — outside every one of this codebase's modals, all of which are native `<dialog>` elements shown via `.showModal()`. Per the HTML living standard, everything outside a modal `<dialog>`'s own DOM subtree is `inert` (non-interactive at the browser level, not just visually) while it's open, so the portaled popover was unreachable by clicks even though it rendered. Fixed by removing the `<PopoverPrimitive.Portal>` wrapper in both apps' `popover.tsx` (Radix's Popper positioning still uses `position: fixed` internally, so it continues to float correctly without the portal) — this is a codebase-wide constraint on using any Radix-portaled primitive going forward, not just this story's Popover. Verified with a real Playwright session: opened Create Gym, clicked the country picker, searched "France", clicked it, confirmed the button updated from `🇨🇲+237` to `🇫🇷+33`.
  2. **The Tier/Status `<select>` popup rendered invisible white-on-white options in dark mode** (pre-existing bug, surfaced by this story's manual QA, not caused by `PhoneInput`). First attempted fix (`color-scheme: light`/`dark` declared on `:root`/`.dark`) was insufficient — verified live that it correctly set `document.documentElement`'s computed `color-scheme` and the popup's own background did pick up the dark theme, but individual `<option>` rows still rendered white-on-white; Chromium does not reliably propagate an ancestor's `color-scheme` down to native popup `<option>` rows. Root-caused by screenshotting the actual opened popup (`Elite`/`Free/Test`/`Grind`/`Hustle` rows), not guessed. Real fix: explicit `select option { background-color: hsl(var(--popover)); color: hsl(var(--popover-foreground)); }` in both apps' `globals.css` — `<option>` elements DO respect direct `background-color`/`color`, unlike inherited `color-scheme`. Re-verified with the same Playwright session + screenshot: all four tier rows now render with dark background and light, readable text.
  3. Also fixed, raised by the user mid-investigation: `CreateGymModal`'s owner-phone placeholder (`gyms.create.ownerPhonePlaceholder`) still read `"+237600000000"`, baking the country code into the national-number-only field's placeholder — redundant and misleading now that the calling code is shown separately in the picker button. Changed to `"600000000"` in both `en.json`/`fr.json`.
  - Full regression re-run clean after all three fixes: dashboard 226/226, super-admin 7/7, typecheck/lint 0 errors both apps (only pre-existing unrelated warnings).
- 2026-09-07: Continued manual QA into the dashboard app (Members, Staff, Renewal, Pay Now), with test data seeded via the app's own real actions (a real gym created through `CreateGymModal`, a plan + subscription inserted directly for the renewal-alert states no single UI action produces quickly, `saas_billing_status` flipped to `past_due` for `Pay Now`). Found and fixed one more real bug, this time via careful tracing rather than a live report:
  - **Selecting a country before typing any digits snapped back to the default country** whenever the field's starting `value` was a non-empty placeholder (reproduced live in `MemberModal`, whose `DEFAULT_PHONE_PREFIX = "+237"` is exactly that case — `AddStaffModal`/`CreateGymModal` start from `""` and happened not to trigger it). Root cause: `PhoneInput` tracks `lastEmitted` (what it last called `onChange` with — `null` for an empty/invalid number) to tell an external `value` reset apart from its own round-trip. Every call site coerces that `null` to `""` before storing it in form state and passing it back down (`onChange={(v) => setForm({..., phone: v ?? ""})}`, this codebase's established convention) — so `lastEmitted.current` held `null` while the prop came back as `""`, `"" !== null` read as an external reset, and the just-picked country was immediately discarded before ever appearing. Fixed by normalizing `null`/`""` to the same value on both sides of the comparison. Added a regression test (`phone-input.test.tsx`, now 8 assertions) using a real controlled wrapper matching the exact `value ?? ""` pattern every call site uses, not just a bare `vi.fn()` onChange — the earlier 7 tests never exercised a controlled round-trip and so never caught this.
  - Re-verified live: `MemberModal`'s country picker now updates correctly on selection with an empty field. Also confirmed `PayNowButton`'s flow works end-to-end (past_due badge, dialog opens, phone pre-filled with the owner's on-file number correctly parsed to country + national number). `RenewalModal`'s Mobile-Money branch could not be exercised without a connected Tara Money sandbox account (`canOfferMobileMoneyPayment()` gates the option on `gym_payment_credentials`, Story 4.13's own scope, unrelated to this story) — not seeded, since faking payment-provider credentials is a different subsystem than this story touches; the same `PhoneInput` code path is already proven working in three other real dialogs.
  - Full regression re-run clean: dashboard 227/227 (one unrelated pre-existing flaky test file confirmed flaky under full-suite load, passes both in isolation and on a clean re-run), super-admin 8/8, typecheck/lint 0 errors both apps.

