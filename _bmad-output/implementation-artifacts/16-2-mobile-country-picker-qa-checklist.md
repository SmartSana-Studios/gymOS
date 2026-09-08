# Story 16.2 — Manual On-Device QA Checklist

**Story:** `16-2-mobile-country-picker-phone-input-expo.md`
**Created:** 2026-09-07 (post-code-review)
**Owner:** smartsana (per this project's established practice — manual device/simulator verification is performed by the user, not the dev agent)

## Why this exists

`apps/mobile` has no test runner (AC #12), so manual on-device verification is the *only* verification this story gets. Story 16.1 — the same feature on web — had manual QA find two real bugs that every automated review layer missed (Popover inert inside a native `<dialog>`; native `<select>` white-on-white in dark mode), plus a third found by code tracing. Treat this pass as load-bearing, not a formality.

Note the sequencing gap: the code-review workflow set this story to `done` once its patches were applied, but that happened *before* this device pass. Status is ahead of reality until this checklist is worked through.

## Runtime risk context

Expo defaults to **Hermes**, and this app declares no Intl or `String.prototype.normalize` polyfill. The code-review patches introduced two calls whose Hermes support is unverified on this runtime (Expo 57 / RN 0.86.3):

| Call | Where | Failure mode if unsupported |
| --- | --- | --- |
| `String.prototype.normalize('NFD')` | `CountryPickerModal.tsx` `foldForSearch()` | **Throws** — hard crash on first keystroke in the search box |
| `localeCompare(name, locale)` | `PhoneInput.tsx` `buildGlobalCountries()` | Degrades silently — locale arg ignored, default collation used |

This is the exact class of risk the story itself flagged (AC #3) and deliberately avoided for country *names* by pre-generating a static table. The two calls above were added later, during code review, and did not get the same risk treatment.

## Preconditions

- A member account with a phone number already on file (needed for P1).
- Tara Money sandbox credentials connected for the gym — gates `canOfferMobileMoneyPayment()` and therefore the Renew screen's Mobile Money branch. A sandbox account was connected during Story 16.1's QA via Settings → Payment Account → Connect; it may still be live.
- Ability to switch app language to French (P3).

---

## P0 — Crash risks (do first, ~2 min)

- [ ] **Type a single letter into the country search box.** Exercises `normalize('NFD')`. A crash/`TypeError` here means Hermes lacks `String.prototype.normalize` — the fix is a one-line guard around the fold, not a redesign.
- [ ] **Open the country picker from Onboarding → Phone.** Confirms the RN `Modal` renders on device at all.
- [ ] **Open the country picker from Renew → Mobile Money.** Same, second call site.

## P1 — The high-severity bug fixed in code review (`renew.tsx`)

The `onChange` handler coerced an emitted `null` to `'+237'` instead of `''`, which the component read as an external reset and used to wipe the field. This is the same bug class Story 16.1 hit on web. Both triggers below were broken before the fix.

- [ ] **Open Renew with a pre-filled phone → switch to a different country.** Expected: your digits are preserved, only the calling code changes. Previously: snapped back to Cameroon with an empty number.
- [ ] **Backspace the number until it's invalid, then retype.** Expected: the field never resets itself mid-edit.
- [ ] **Complete a sandbox payment initiation** to confirm the emitted E.164 value still reaches `initiate_member_payment()` unchanged.

## P2 — Core feature

- [ ] **Onboarding → Phone: keyboard auto-opens on arrival.** A lost `autoFocus` was restored during code review.
- [ ] **Pick a country, enter a number, tap Continue.** The existing membership pre-check and OTP send should behave exactly as before this story.
- [ ] **Run a non-Cameroon number through to the OTP screen.** Verifies the rewritten `maskPhone()` — the masked display should show the full calling code (`+33`, `+1`, `+254`), then asterisks, then the last 4 digits. Too many or too few visible leading digits means the country-code length derivation is wrong.
- [ ] **Renew's picker lists only the 15 Tara Money countries** — Ghana present, France absent.
- [ ] **Search by calling code** (e.g. `237`) as well as by name.
- [ ] **Scroll the full global list** (~245 entries) — check `FlatList` performance and that the selected-country checkmark renders on the right row.
- [ ] **"No country found" empty state** appears for a nonsense query.

## P3 — Polish and localization

- [ ] **Search without accents matches accented names** — type `cote` → `Côte d'Ivoire`; `benin` → `Bénin`. This is the diacritic folding added in code review. If P0 passed but this doesn't match, `normalize` is present but a no-op.
- [ ] **Switch the app to French.** The onboarding (global) list should show French country names.
- [ ] **Android flag glyphs** render device-dependently — some devices show the raw two-letter code. Cosmetic.

---

## Known and deferred — do NOT file these as bugs

All four were triaged during code review and confirmed to match patterns already shipped and accepted on web in Story 16.1. They are recorded in `deferred-work.md`.

- The **Renew (Tara Money) country list shows English names even in French**, and is unsorted. Inherited from `TARAMONEY_SUPPORTED_COUNTRIES` in `packages/types`, which carries no per-locale names.
- A **pre-filled number from a country outside the Tara Money 15 silently resets** to Cameroon/empty.
- The static `countryNames.ts` table can drop countries on a future `libphonenumber-js` bump with no CI guard.
- `maskPhone()` has no lower-bound guard for an unusually short valid E.164 number.

## Results

Record outcomes here, then update `sprint-status.yaml` with a `last_updated` entry for this pass.

| Section | Result | Notes |
| --- | --- | --- |
| P0 | | |
| P1 | | |
| P2 | | |
| P3 | | |

**If something fails:** capture the exact symptom — which screen, what you tapped, what you saw. Device-only symptoms are expensive to guess at (each wrong theory costs a full build/TestFlight cycle), so the symptom detail is worth more than a diagnosis.
