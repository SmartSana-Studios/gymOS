---
baseline_commit: 88c773955d0f3267f4786b27e532e222a8d6e315
---

# Story 16.2: Mobile — Country-Picker Phone Input (Expo)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym member or staff user of the mobile app,
I want the phone-entry screen to offer a country picker instead of a fixed `+237` prefix,
so that I can enter my real phone number correctly regardless of country.

## Acceptance Criteria

1. `apps/mobile/src/app/onboarding/phone.tsx`'s hardcoded `COUNTRY_PREFIX = '+237'` and single fixed-prefix `TextInput` are replaced with a new shared `PhoneInput` component (`apps/mobile/src/components/ui/PhoneInput.tsx`) that renders a country picker (flag + calling code + searchable country name), auto-prefixes the selected country's calling code, defaults to Cameroon, and whose `onChange` always emits a valid E.164 string or `null` — the same contract Story 16.1 established for web.
2. Country/calling-code data comes from `libphonenumber-js` — a **new** dependency for `apps/mobile` (not currently in `apps/mobile/package.json`, unlike `apps/dashboard`/`apps/super-admin` which already have it at `^1.13.12`). Add it at the same `^1.13.12` version. The package's default (`min`) metadata (~80 kB) is sufficient — only `getCountries()`/`getCountryCallingCode()` and length-based validation are needed, matching Story 16.1's own choice not to use `/max`. (Note: `libphonenumber-js/mobile` is a real subpath, but it means "mobile-*number*-type metadata" — cellphone vs. landline detection — not "React-Native-optimized bundle." Do not use it; the plain default import is correct here.)
3. **No country-name data source exists for `apps/mobile`, and Hermes' runtime support for `Intl.DisplayNames` (the API Story 16.1 used on web) is not confirmed reliable across iOS/Android for this Expo/React-Native version** — historically required a JS polyfill on iOS, and no current verification exists for RN 0.86.3/Hermes. Rather than gambling on-device (a wrong guess here costs a full build/TestFlight cycle, not just a page reload), country display names are resolved from a **static, pre-generated table**, not a runtime `Intl.DisplayNames` call: a small one-off Node script (executed with plain Node, which has full native ICU/Intl support — not Hermes) iterates `libphonenumber-js`'s `getCountries()` and resolves an English and French name per ISO code via `new Intl.DisplayNames(['en'|'fr'], { type: 'region' })`, writing the result to `apps/mobile/src/constants/countryNames.ts` (`Record<string, { en: string; fr: string }>`). This is generated once and committed — never executed on-device or as part of the app build. This keeps the "no new country-list package" principle from Story 16.1 while eliminating the Hermes-Intl risk entirely.
4. No popover/bottom-sheet/dropdown library exists anywhere in `apps/mobile` (confirmed: `apps/mobile/src/components/LogEntrySheet.tsx`'s own comment states "no bottom-sheet library exists anywhere in this codebase either," and it uses React Native's built-in `Modal`). The country picker follows that exact established precedent: a new `CountryPickerModal` component (`apps/mobile/src/components/ui/CountryPickerModal.tsx`) built on RN's built-in `Modal`, with a search `TextInput` and a `FlatList` of countries — no new dependency, no hand-rolled portal/positioning logic.
5. `PhoneInput` is a plain controlled component — props `{ value: string | null; onChange: (value: string | null) => void; countries?: 'global' | 'tara-money'; disabled?: boolean }` — matching every existing mobile screen's `useState`-only convention (no form library anywhere in this app) and mirroring Story 16.1's exact web prop shape for cross-platform consistency.
6. `onboarding/phone.tsx` is wired to `PhoneInput` with the **global** country list, defaulting to Cameroon, preserving its existing `phoneEntrySchema` validation, `phone_has_membership` RPC pre-check, and `signInWithOtp` call — all fed by `PhoneInput`'s emitted E.164 string unchanged.
7. `onboarding-context.tsx` and `otp.tsx` continue to receive a fully E.164-formatted phone value, unchanged in shape — no `signInWithOtp`/OTP contract changes. **However**, `otp.tsx`'s own `maskPhone()` hardcodes `COUNTRY_CODE_LENGTH = 4` (a `+` plus Cameroon's 3-digit calling code) to decide how much of the number to mask. This breaks — masks the wrong number of characters — for any other calling code length (e.g. `+1`, `+33`, `+254` are 2–4 chars including the `+`) once this story makes non-Cameroon numbers reachable. `maskPhone()` must derive the actual prefix length per-number (e.g. via `parsePhoneNumberFromString(phone)?.countryCallingCode.length`), not keep the hardcoded constant.
8. **`(tabs)/profile.tsx` has no editable phone field to wire — confirmed by reading the current code.** Phone renders as plain read-only `ThemedText` with an explicit `t('profile.phoneNotEditable')` label ("Contact your gym to change your number"), the same "phone is the login identity, not user-editable" reasoning already documented for staff's `EditStaffModal` (`docs/decisions.md`, Story 9.4 item (e)). The epic's premise that this screen has "the equivalent phone field" to update is stale. This story leaves `profile.tsx` completely unchanged — do not add an editable phone field here; that would be new, unrequested scope.
9. **A real, previously-untracked editable phone field exists in `apps/mobile/src/app/renew.tsx`**: the member-app Renew screen's `payerPhone`, a plain `TextInput` defaulting to `DEFAULT_PHONE_PREFIX = '+237'`, validated via the shared `initiatePaymentSchema.shape.phoneNumber`, feeding `initiate_member_payment()` → Tara Money. This is the mobile-app equivalent of `RenewalModal.tsx`'s `payerPhone` field that Story 16.1 wired on web (and structurally identical to that story's own untracked-scope discovery, `PayNowButton.tsx`). It is wired to `PhoneInput countries="tara-money"` (`TARAMONEY_SUPPORTED_COUNTRIES` from `@gymos/types`, already a mobile dependency via `workspace:*`) — not the global list, for the same reason Story 16.1 gave: it is the only mobile-app phone field that triggers an automated Tara Money collection call. Preserve the existing prefill (`memberRow.phone || DEFAULT_PHONE_PREFIX`) and `initiatePaymentSchema` validation behavior.
10. Confirmed via `grep -rn "TextInput" apps/mobile/src` for phone-shaped fields: `onboarding/phone.tsx` and `renew.tsx` are the only two real editable phone inputs anywhere in `apps/mobile`. If the dev agent finds another one during implementation that this research missed, wire it the same way or explicitly record in Completion Notes why not — don't silently skip it.
11. Any new user-facing string `PhoneInput`/`CountryPickerModal` introduces (e.g. "Search country...", "No country found") gets matching keys added to both `apps/mobile/src/locales/en.json` and `fr.json` — `scripts/check-i18n-key-parity.mjs` already covers `apps/mobile/src/locales` (line 22), so it enforces this automatically; run it and confirm clean.
12. **No automated test files are added.** `apps/mobile` has zero test infrastructure today — no test runner, no `jest`/`vitest` config, no `*.test.tsx` files anywhere in the app (confirmed repeatedly across Stories 9.5, 10.1–10.3, 13.5, 15.4; `eslint` itself has historically been unrunnable in this devcontainer). Story 15.4's own review explicitly accepted this: "zero test coverage matches this app's established no-test-runner convention." Adding a test runner is a much larger, separate decision (Story 13.5 explicitly scoped native-mobile UI automation out of this project entirely) — out of scope here. Verification is manual, on a real device/simulator, per this project's own established practice.
13. `_bmad-output/implementation-artifacts/deferred-work.md`'s existing entry — *"MA-02's country-code selector is a fixed `+237` (Cameroon-only) prefix, not EXPERIENCE.md's full tappable bottom-sheet with a searchable country list [apps/mobile/src/app/onboarding/phone.tsx]... Revisit if the platform ever expands beyond Cameroon."* — is struck/marked resolved by this story.

## Tasks / Subtasks

- [x] Task 1 — Add dependency + generate static country-name data (AC: #2, #3)
  - [x] Add `libphonenumber-js` at `^1.13.12` to `apps/mobile/package.json` dependencies (`pnpm --filter mobile add libphonenumber-js@^1.13.12` or edit + `pnpm install` from repo root)
  - [x] Write a one-off Node script, e.g. `scripts/generate-mobile-country-names.mjs` (plain `node scripts/generate-mobile-country-names.mjs`, not run at build/runtime): import `getCountries` from `libphonenumber-js`, and for each ISO code resolve `new Intl.DisplayNames(['en'], { type: 'region' }).of(code)` and the `fr` equivalent, writing `apps/mobile/src/constants/countryNames.ts` exporting `export const COUNTRY_NAMES: Record<string, { en: string; fr: string }> = { ... }`
  - [x] Run the script once; commit both the script (for future re-generation if `libphonenumber-js`'s country list changes) and the generated `countryNames.ts`

- [x] Task 2 — Build `CountryPickerModal` and `PhoneInput` (AC: #1, #4, #5)
  - [x] Create `apps/mobile/src/components/ui/CountryPickerModal.tsx`: RN `Modal` (mirror `LogEntrySheet.tsx`'s `visible`/`onClose` prop shape and its established slide-up/pageSheet presentation), a search `TextInput` filtering by country name or calling code, and a `FlatList` rendering each country (flag + name + `+<callingCode>`) styled consistently with `ListItem`/`ThemedText`/`Spacing`/`useTheme()` conventions
  - [x] Flags render as Unicode regional-indicator emoji derived from the ISO alpha-2 code (same technique as Story 16.1's web `PhoneInput`, zero new dependency) — this is decorative only; calling code + country name remain the legible, load-bearing content regardless of whether the flag glyph itself renders
  - [x] Create `apps/mobile/src/components/ui/PhoneInput.tsx`: props `{ value: string | null; onChange: (value: string | null) => void; countries?: 'global' | 'tara-money'; disabled?: boolean }`
    - `"global"` list: `getCountries()` + `getCountryCallingCode(code)` from `libphonenumber-js`, name from `COUNTRY_NAMES[code][i18n.language]` (mobile's `i18n` singleton from `@/lib/i18n`, `MobileLocale` is `'en' | 'fr'` only), sorted by name
    - `"tara-money"` list: `TARAMONEY_SUPPORTED_COUNTRIES` from `@gymos/types` (already has `code`/`name`/`callingCode` — no `COUNTRY_NAMES` lookup needed for this branch)
    - Renders a country-select `Pressable` (flag + calling code) opening `CountryPickerModal`, plus a `TextInput` for the national number only (numeric keypad — match `phone.tsx`'s existing `keyboardType="number-pad"` + digit-only `onChangeText` filtering)
    - `onChange` contract: parse the national-number input against the selected country via `parsePhoneNumberFromString(nationalNumber, country)`, emit `.number` (E.164) only when `.isValid()`, otherwise `null` — never a partial/invalid string
    - Default country: Cameroon (`CM`), matching every existing call site's `+237` default

- [x] Task 3 — Wire `onboarding/phone.tsx` (AC: #6)
  - [x] Replace the `COUNTRY_PREFIX`-based `digits` state (line 28) and fixed-prefix input row (lines 90–103) with `PhoneInput countries="global"`
  - [x] Keep `phoneEntrySchema.safeParse`, the `phone_has_membership` RPC pre-check, and `signInWithOtp` call unchanged, fed by `PhoneInput`'s emitted E.164 string
  - [x] Generalize the prefill logic (currently `prefillPhone?.startsWith(COUNTRY_PREFIX) ? prefillPhone.slice(COUNTRY_PREFIX.length) : ''`, line 28) — a prefilled phone (from a prior "try again" in the same onboarding session) may now be any country, not just Cameroon. Parse it with `parsePhoneNumberFromString(prefillPhone)` to derive the correct country + national number instead of a hardcoded prefix check.

- [x] Task 4 — Fix `otp.tsx`'s `maskPhone()` (AC: #7)
  - [x] Replace the hardcoded `const COUNTRY_CODE_LENGTH = 4` (line 20) and its use in `maskPhone()` (lines 22–34) with a length derived from `parsePhoneNumberFromString(phone)?.countryCallingCode.length` (+1 for the leading `+`); keep the existing 4-char fallback only if parsing unexpectedly fails
  - [x] No other change to `otp.tsx`/`onboarding-context.tsx` — the `phone` value's shape and flow through this screen are unchanged (AC #7)

- [x] Task 5 — Wire `renew.tsx`'s `payerPhone` field (AC: #9, #10)
  - [x] Replace the `payerPhone` `TextInput` (lines ~307–313) with `PhoneInput countries="tara-money" value={payerPhone} onChange={(v) => setPayerPhone(v ?? DEFAULT_PHONE_PREFIX)} disabled={phase === 'sending'}`
  - [x] Preserve the existing prefill effect (`setPayerPhone(memberRow.phone || DEFAULT_PHONE_PREFIX)`, line 108) — `PhoneInput` must gracefully render a non-E.164/legacy `memberRow.phone` value as the default-country/empty-national-number state (same fallback behavior Story 16.1 built into the web `PhoneInput` for the identical `RenewalModal.tsx` scenario), not crash or render garbage
  - [x] Do not touch the `initiatePaymentSchema.shape.phoneNumber.safeParse(payerPhone.trim())` check (line 203) or anything downstream of it — it must keep receiving `PhoneInput`'s emitted E.164 string unchanged

- [x] Task 6 — i18n (AC: #11)
  - [x] Add any new `PhoneInput`/`CountryPickerModal` strings to `apps/mobile/src/locales/en.json` and `fr.json`
  - [x] Run `node scripts/check-i18n-key-parity.mjs` and confirm clean

- [x] Task 7 — Cleanup (AC: #13)
  - [x] Mark `deferred-work.md`'s MA-02 fixed-`+237`-prefix entry (line 415) as resolved/struck by this story, per this project's established convention (Story 16.1 did the same for its own closed `deferred-work.md` entry)

- [x] Task 8 — Verification (AC: #12 and overall)
  - [x] Run `pnpm --filter mobile typecheck`; must be 0 errors
  - [x] Attempt `pnpm --filter mobile lint`; if it is unrunnable in this devcontainer (an established, previously-documented environment limitation, not new to this story), record that fact rather than treating it as a story-introduced failure
  - [x] No automated tests are added or expected (AC #12) — record in Completion Notes that manual on-device/simulator verification is the ceiling here; this project's own convention is that the user performs that live QA themselves, not the dev agent

### Review Findings

- [x] [Review][Patch] `renew.tsx`'s `onChange={(v) => setPayerPhone(v ?? DEFAULT_PHONE_PREFIX)}` reintroduces, on mobile, the exact "external reset wipes a just-picked country/in-progress digits" bug Story 16.1 found and fixed on web — `PhoneInput`'s `normalizeEmpty` only equates `''` with `null`, but this is the only `PhoneInput` call site (mobile or web) that coerces the emitted `null` to a non-empty placeholder (`'+237'`) instead of `''`. Both web call sites (`RenewalModal.tsx`, `PayNowButton.tsx`) correctly use `value ?? ""`. Confirmed reachable: any edit that makes the number temporarily invalid (switching country on a prefilled real number, or typing past a valid length) sets `payerPhone` to `'+237'`, which differs from `lastEmitted.current` (`null`), so `PhoneInput`'s effect reads it as an external reset and wipes the field back to Cameroon/empty — breaking the country-switch/edit flow for any member who already has a phone on file, the exact new scope this story added. **Resolved:** changed to `onChange={(v) => setPayerPhone(v ?? '')}`. [`apps/mobile/src/app/renew.tsx:309`]
- [x] [Review][Patch] `CountryPickerModal`'s search does no diacritic/typographic normalization — a plain-ASCII search (no accents, straight apostrophe) won't match French country names that contain them (`Côte d'Ivoire`, `Bénin`, `Sénégal`), a real usability gap in the searchable-list feature for this app's Francophone users. **Resolved:** added a `foldForSearch` helper (NFD normalize + strip combining marks + fold curly apostrophes to straight) applied to both the query and each country's name before matching. [`apps/mobile/src/components/ui/CountryPickerModal.tsx`]
- [x] [Review][Patch] `onboarding/phone.tsx` lost the `autoFocus` its old `TextInput` had — `PhoneInput`'s national-number `TextInput` has no `autoFocus` wired through, so the onboarding phone-entry screen no longer auto-focuses the input on mount. **Resolved:** added an `autoFocus?: boolean` prop to `PhoneInput`, wired through to its national-number `TextInput`, and passed `autoFocus` from `onboarding/phone.tsx`. [`apps/mobile/src/app/onboarding/phone.tsx:84`, `apps/mobile/src/components/ui/PhoneInput.tsx`]
- [x] [Review][Patch] `buildGlobalCountries`'s `.sort((a, b) => a.name.localeCompare(b.name))` doesn't pass a locale argument, so the French country list doesn't actually follow French collation rules for accented/apostrophe'd names. **Resolved:** `localeCompare(b.name, locale)`. [`apps/mobile/src/components/ui/PhoneInput.tsx:33`]
- [x] [Review][Patch] `otp.tsx`'s new country-code-length expression, `(parsePhoneNumberFromString(phone)?.countryCallingCode.length ?? FALLBACK_COUNTRY_CODE_LENGTH - 1) + 1`, is functionally correct but folds the "+1 for the leading `+`" into operator precedence in a way that reads like an off-by-one bug on a skim — should be an explicit conditional instead. **Resolved:** rewritten as an explicit `parsedCallingCodeLength !== undefined ? parsedCallingCodeLength + 1 : FALLBACK_COUNTRY_CODE_LENGTH` conditional with a comment on the `+1`. [`apps/mobile/src/app/onboarding/otp.tsx:38`]
- [x] [Review][Patch] `CountryPickerModal`'s list has no visual indication of the currently-selected country (no checkmark, no scroll-to-selected on open) and each row lacks a combined accessibility label/selected-state for screen readers. **Resolved:** added a `selectedCode` prop (passed from `PhoneInput`'s current `country`), a checkmark icon on the matching row, and a combined `accessibilityLabel`/`accessibilityState.selected` per row. Scroll-to-selected-on-open was not added (`FlatList.scrollToItem` needs a stable item layout/index lookup this component doesn't otherwise need — deferred as a further polish item, not blocking).
- [x] [Review][Defer] `buildTaraMoneyCountries` shows English-only country names (no French) and is never sorted, unlike `buildGlobalCountries` — inherited directly from the shared `TARAMONEY_SUPPORTED_COUNTRIES` constant (`packages/types`) and confirmed to be the exact same pattern already shipped on web in Story 16.1 (`apps/dashboard/components/ui/phone-input.tsx`'s own `buildTaraMoneyCountries`). [`apps/mobile/src/components/ui/PhoneInput.tsx:36-42`] — deferred, pre-existing pattern inherited from the shared package, not introduced by this diff; fixing requires changing `TARAMONEY_SUPPORTED_COUNTRIES` consistently across both platforms.
- [x] [Review][Defer] A prefilled phone value from a country outside the 15-country Tara-Money list (e.g. a member's on-file number from an unsupported country) silently resets to Cameroon/empty rather than surfacing any indication the original number was discarded — confirmed to be the identical `deriveFromValue` fallback design already shipped and accepted on web (Story 16.1's `phone-input.tsx` uses the same fallback). [`apps/mobile/src/components/ui/PhoneInput.tsx:77-88`] — deferred, matches accepted web precedent, not a regression in this diff.
- [x] [Review][Defer] The static `countryNames.ts` table can silently drop a country from the global picker if a future `libphonenumber-js` bump adds new codes, with no build-time or CI check enforcing regeneration — same generation-convention risk already accepted for the equivalent web static-data approach in Story 16.1. [`apps/mobile/src/components/ui/PhoneInput.tsx:25-34`] — deferred, pre-existing convention-level risk, not introduced by this diff.
- [x] [Review][Defer] `maskPhone`'s `phone.slice(countryCodeLength, -4)` has no lower-bound guard for a valid E.164 number shorter than `countryCodeLength + 4` digits — extends a slicing pattern that already existed pre-story (previously only reachable for Cameroon numbers, now reachable for any country's edge-case short valid number). [`apps/mobile/src/app/onboarding/otp.tsx:39-41`] — deferred, low-probability pre-existing slicing pattern, not newly introduced logic.

## Dev Notes

- **Sibling story:** Story 16.1 (done, `_bmad-output/implementation-artifacts/16-1-web-shared-country-picker-phoneinput-dashboard-super-admin.md`) built the equivalent web `PhoneInput` for `apps/dashboard`/`apps/super-admin`. This story's `PhoneInput` should match its `value`/`onChange`/`countries`/`disabled` prop contract and E.164-emission semantics exactly, but the implementation is necessarily different (React Native `Modal`+`FlatList` instead of shadcn `Popover`+`Command`; static `countryNames.ts` instead of runtime `Intl.DisplayNames`) — do not attempt to literally share code between the two, there is no shared UI package (`packages/ui` is explicitly deferred, same as Story 16.1 confirmed) and the two apps have no common React Native/DOM abstraction to share through.
- **The Hermes/`Intl.DisplayNames` risk is the single biggest way this story could go wrong silently.** Do not assume `Intl.DisplayNames` "just works" in this Expo 57/RN 0.86.3 Hermes runtime and skip straight to using it at runtime — historical evidence (RN ~0.72 era) shows it needed a manual polyfill on iOS, and there is no confirmation either way for this exact version. The static-table approach (AC #3, Task 1) sidesteps this entirely by generating names with Node's own Intl (guaranteed correct) at authoring time, not on-device. Do not "simplify" this back to a runtime `Intl.DisplayNames` call without first empirically verifying it on a real device — a wrong guess here costs a full build/TestFlight cycle, not a page reload (per this project's own established mobile-verification cost).
- **Android flag-emoji rendering is a separate, real, device-dependent risk** — Unicode regional-indicator flag emoji do not render identically across every Android OEM/font/OS-version combination (some show raw two-letter codes instead of a flag glyph). This is cosmetic only (calling code + name are still shown and remain fully legible/functional), but visually verify on a real Android device/emulator before considering this "done," not just on iOS Simulator.
- **`apps/mobile` per-file AGENTS.md instruction:** `apps/mobile/AGENTS.md` explicitly says Expo has changed and to check the exact versioned docs at `https://docs.expo.dev/versions/v57.0.0/` before writing any code — this applies to `Modal`, `FlatList`, and any other RN/Expo API touched in this story.
- **No shared form library** — every mobile screen (this app has no react-hook-form anywhere) uses plain `useState`; `PhoneInput` must stay a plain controlled component to slot into `phone.tsx`'s and `renew.tsx`'s existing state shapes with a near-drop-in replacement.
- **`@gymos/types` is already a mobile dependency** (`workspace:*`) and already exports `TARAMONEY_SUPPORTED_COUNTRIES` (`packages/types/src/index.ts:29`) and `phoneEntrySchema`/`initiatePaymentSchema` — no new package-level export work needed, just import from `@gymos/types` as `onboarding/phone.tsx` and `renew.tsx` already do.
- **Bundle size:** `libphonenumber-js`'s default `min` metadata is ~80 kB (per its own README) — acceptable for a mobile app bundle, matches what both web apps already ship.
- **i18n locale is narrower on mobile than web:** mobile only ever runs `en`/`fr` (`MobileLocale = 'en' | 'fr'`, `apps/mobile/src/lib/i18n.ts`), unlike web's browser-driven `Intl.DisplayNames([locale])` call. `COUNTRY_NAMES[code][i18n.language]` is a direct, exhaustive lookup — no fallback-locale logic needed beyond what `COUNTRY_NAMES`'s own two keys already provide.
- **This story's own research corrected the epic's assumed scope twice** (see AC #8, #9) — exactly the kind of exhaustive per-file verification Story 16.1's own Dev Notes called out as essential ("ground truth was verified by reading every target file, not inferred from the epic/PRD"). Do not re-expand scope back to "update profile.tsx" and do not silently skip `renew.tsx`.
- **Testing:** no automated coverage is expected or should be added (AC #12) — this is an accepted, explicit, repeatedly-confirmed convention for `apps/mobile` specifically (different from the web apps' Vitest convention), not an oversight to "fix" as part of this story.

### Project Structure Notes

- New files: `apps/mobile/src/components/ui/PhoneInput.tsx`, `apps/mobile/src/components/ui/CountryPickerModal.tsx`, `apps/mobile/src/constants/countryNames.ts`, `scripts/generate-mobile-country-names.mjs`.
- Modified files: `apps/mobile/src/app/onboarding/phone.tsx`, `apps/mobile/src/app/onboarding/otp.tsx`, `apps/mobile/src/app/renew.tsx`, `apps/mobile/src/locales/en.json`, `apps/mobile/src/locales/fr.json`, `apps/mobile/package.json`, `pnpm-lock.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md` (strike the MA-02 entry).
- `apps/mobile/src/app/(tabs)/profile.tsx` and `apps/mobile/src/lib/onboarding-context.tsx` are explicitly **unchanged** (AC #8, #7).
- No database, RLS, migration, or Server Action changes — this is a mobile-app-only UI story, same class of change as Story 16.1.
- Component location follows this app's existing flat `components/ui/` convention (`Badge.tsx`, `Button.tsx`, `Card.tsx`, `IconChip.tsx`, `ListItem.tsx`, `OtpInput.tsx`, `ProgressSteps.tsx`, `SegmentedControl.tsx`, `StatTile.tsx` — all PascalCase, single app, no per-app duplication like web's `components/ui/`) — `PhoneInput.tsx`/`CountryPickerModal.tsx` match that naming convention, not web's kebab-case `phone-input.tsx`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 16.2: Mobile — Country-Picker Phone Input (Expo)] (lines 605–628) — story statement and ACs, verbatim source, with corrections per AC #8/#9 above
- [Source: _bmad-output/implementation-artifacts/16-1-web-shared-country-picker-phoneinput-dashboard-super-admin.md] — sibling web story, `PhoneInput` contract precedent
- [Source: docs/decisions.md#2026-09-07 — Phone-input country picker: global by default, Tara Money-restricted only on the Mobile-Money payer field]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:415] — MA-02 fixed-`+237`-prefix entry to strike
- [Source: apps/mobile/src/app/onboarding/phone.tsx] (whole file — `COUNTRY_PREFIX` line 21, `digits` state line 28, `handleContinue` lines 32–72, input row lines 90–103)
- [Source: apps/mobile/src/app/onboarding/otp.tsx] (`COUNTRY_CODE_LENGTH` line 20, `maskPhone` lines 22–34)
- [Source: apps/mobile/src/app/renew.tsx] (`DEFAULT_PHONE_PREFIX` line 32, `payerPhone` state line 73, prefill line 108, `initiatePaymentSchema` check line 203, `TextInput` lines 307–313)
- [Source: apps/mobile/src/app/(tabs)/profile.tsx:435-443] — confirmed read-only, non-editable phone display, `profile.phoneNotEditable` label
- [Source: apps/mobile/src/lib/onboarding-context.tsx] — `phone`/`setPhone` shape, unchanged
- [Source: apps/mobile/src/components/LogEntrySheet.tsx] — established RN `Modal` sheet precedent ("no bottom-sheet library exists anywhere in this codebase either")
- [Source: apps/mobile/src/components/ui/Button.tsx, apps/mobile/src/components/ui/ListItem.tsx] — design-system conventions (`ThemedText`, `useTheme()`, `Spacing`) to match
- [Source: apps/mobile/src/lib/i18n.ts] — `MobileLocale`, `i18n` singleton
- [Source: apps/mobile/package.json] — current dependencies (no `libphonenumber-js` yet), scripts
- [Source: packages/types/src/constants/taraMoneySupportedCountries.ts] — `TARAMONEY_SUPPORTED_COUNTRIES`
- [Source: packages/types/src/schemas/memberOnboarding.ts] — `phoneEntrySchema`
- [Source: packages/types/src/schemas/payment.ts] — `initiatePaymentSchema`
- [Source: packages/types/src/index.ts:29] — confirms `TARAMONEY_SUPPORTED_COUNTRIES` already publicly exported from `@gymos/types`
- [Source: scripts/check-i18n-key-parity.mjs:15-22] — confirms `apps/mobile/src/locales` is already covered by the i18n parity gate
- [Source: apps/dashboard/node_modules/libphonenumber-js/README.md] — `min`/`max`/`mobile` metadata meaning (`mobile` = mobile-*number*-type detection, not a React-Native bundle variant), default `min` metadata size (~80 kB)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `pnpm install` (root, after adding `libphonenumber-js` to `apps/mobile/package.json`): resolved cleanly, `apps/mobile/node_modules/libphonenumber-js` at `1.13.12`. Pre-existing peer-dependency warnings (`@expo/dom-webview`, `@expo/metro-runtime`, `@react-native/metro-config`) are unrelated to this change.
- `node apps/mobile/scripts/generate-country-names.mjs`: wrote 245 country names to `apps/mobile/src/constants/countryNames.ts`.
- `node scripts/check-i18n-key-parity.mjs`: clean, all four locale directories in parity (`apps/mobile/src/locales`: 322 keys, en/fr).
- `pnpm --filter mobile typecheck`: 0 errors.
- `pnpm --filter mobile lint`: ran successfully (contrary to `deferred-work.md`'s older "eslint unrunnable" note — that gap has apparently been fixed by some other change since); 31 warnings, 0 errors, all pre-existing and in files/lines this story didn't touch (verified by cross-checking every warning's file:line against this story's actual diff) — `PhoneInput.tsx`/`CountryPickerModal.tsx` (new files) and the touched lines in `phone.tsx`/`otp.tsx`/`renew.tsx` produced zero warnings.

### Completion Notes List

- **Followed the story's own explicit AC #12/Task 8 instruction over the workflow template's default red-green-refactor/test-authoring steps**: no automated test files were added. `apps/mobile` has zero test infrastructure (no Jest/Vitest config, no `*.test.tsx` anywhere), an established, explicitly-accepted convention for this app specifically (confirmed across Stories 9.5/10.1–10.3/13.5/15.4's own Completion Notes) — adding one would be new, unrequested, out-of-scope work. Manual on-device/simulator verification is left to the user, per this project's own established practice (`feedback_manual_browser_testing` — the user performs this QA themselves).
- **Country names generated statically, not resolved via runtime `Intl.DisplayNames`** (AC #3): `apps/mobile/scripts/generate-country-names.mjs` (plain Node, full ICU) produced `apps/mobile/src/constants/countryNames.ts` (245 entries, EN+FR) once; `PhoneInput.tsx` reads from that table keyed by `mobileI18n.language`. No on-device Intl risk was taken.
- **`PhoneInput.tsx`'s controlled-state logic (`deriveFromValue`/`normalizeEmpty`/`lastEmitted` ref+effect) deliberately mirrors the web `PhoneInput`'s exact structure from Story 16.1**, including its post-review bug fix (normalizing `null`/`""` on both sides of the external-reset comparison) — that bug was found live in manual QA on web; replicating the already-fixed pattern here avoids reintroducing it on mobile rather than risking discovering it fresh during the user's own on-device QA pass.
- **`otp.tsx`'s `maskPhone()` fixed as scoped** (AC #7): country-code-length is now derived per-number via `parsePhoneNumberFromString(phone)?.countryCallingCode.length`, falling back to the old 4-char constant only if parsing unexpectedly fails (shouldn't happen — `phone` is already validated E.164 by the time it reaches this screen).
- **`renew.tsx`'s `payerPhone` wired to `PhoneInput countries="tara-money"`** (AC #9) exactly as scoped. This removed the file's last usage of `useTheme()`/the raw `TextInput` styling for that field — the `useTheme` import, the `theme` variable, the bare `TextInput` import, and the now-orphaned `phoneInput` style block were all dead after the swap and removed (confirmed via grep: no other reference to `theme.`/`TextInput` remained in the file).
- **`onboarding.phone.helper` locale text ("+237 6 XX XX XX XX") was deliberately left unchanged and still renders below the new `PhoneInput`** on the onboarding phone screen, even though it's now a Cameroon-specific example next to a picker that supports 245 countries. This is a minor, low-severity copy inconsistency (the picker button itself shows the actually-selected calling code right next to it, so it's unlikely to genuinely mislead), not a functional defect, and rewriting UI copy wasn't in this story's scope — flagging it here rather than either silently rewriting app copy beyond what was asked, or silently ignoring it. Worth a follow-up copy pass if the user wants it more country-neutral.
- **`apps/mobile` lint is no longer unrunnable in this devcontainer** — contrary to `deferred-work.md`'s existing note (line 414, not touched by this story since it's about a different, still-possibly-relevant CI-exclusion concern) and this story's own Dev Notes assumption, `pnpm --filter mobile lint` ran successfully this session. Left `deferred-work.md`'s line 414 entry as-is since it's about CI's own `ci.yml` lint-job exclusion, a separate concern from whether the command runs locally in this devcontainer — worth the user's own follow-up check, not silently edited here.
- Confirmed via `grep -rn "TextInput" apps/mobile/src` (re-run post-implementation) that no other editable phone field exists beyond the two this story wired — AC #10 satisfied, nothing else found.

### File List

**New:**
- `apps/mobile/src/components/ui/PhoneInput.tsx`
- `apps/mobile/src/components/ui/CountryPickerModal.tsx`
- `apps/mobile/src/constants/countryNames.ts`
- `apps/mobile/scripts/generate-country-names.mjs`

**Modified:**
- `apps/mobile/src/app/onboarding/phone.tsx`
- `apps/mobile/src/app/onboarding/otp.tsx`
- `apps/mobile/src/app/renew.tsx`
- `apps/mobile/src/locales/en.json`
- `apps/mobile/src/locales/fr.json`
- `apps/mobile/package.json`
- `pnpm-lock.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md` (struck the MA-02 entry)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-09-07: Story implemented end-to-end (Tasks 1–8). New `PhoneInput` + `CountryPickerModal` components (RN `Modal`+`FlatList`, `libphonenumber-js` + a build-time-generated static `countryNames.ts` EN/FR table instead of runtime `Intl.DisplayNames`) wired into `onboarding/phone.tsx` (global list) and `renew.tsx`'s `payerPhone` (Tara-Money-restricted list, a real previously-untracked field this story's own creation-time research found). Fixed a real latent bug `otp.tsx`'s `maskPhone()` would otherwise have shipped with (hardcoded Cameroon-only country-code length). `(tabs)/profile.tsx` left unchanged (no editable phone field exists there, confirmed at story-creation time). `libphonenumber-js` added as a new `apps/mobile` dependency (`^1.13.12`, matching both web apps). i18n key parity clean (`apps/mobile/src/locales`: 322 keys). `deferred-work.md`'s MA-02 fixed-`+237`-prefix entry struck as resolved. No automated tests added, per this app's established no-test-runner convention (AC #12). `pnpm --filter mobile typecheck`: 0 errors; `pnpm --filter mobile lint`: 0 errors (31 pre-existing warnings, none touching this story's diff). Status: ready-for-dev → in-progress → review.
