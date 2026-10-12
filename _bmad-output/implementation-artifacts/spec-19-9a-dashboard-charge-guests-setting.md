---
title: '19-9a Dashboard charge-guests setting'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: 'ea7581bc539157ef78f1d40ea0f05e76923639ae'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `set_guest_charging` and `guest_charging_impact` (0107) have no dashboard UI, so no Owner or Supervisor can turn per-session charging on or off, and nothing warns them who is affected or that old app builds show guests an "expired" screen.

**Approach:** Add a "Charge guests per session" section to Settings, visible to Owner/Supervisor only, with an on/off confirmation dialog that saves through its own setter and stays out of [Save Settings]. This is half A of Story 19.9 (split decided 2026-10-11): 19-9b (alert, panel, member modal) and 19-9c (Payments Purpose ledger, Subscriptions guard) follow separately.

## Boundaries & Constraints

**Always:**
- The toggle shows the stored value and does not flip until the dialog is confirmed. Rendered only when role is `owner` or `supervisor`; absent from the DOM otherwise (new `role` prop from `getDashboardShellContext()`).
- Turn-on dialog: impact count from `guest_charging_impact()` in the fixed plural-aware template ("[N] Pay-per-session members will need a paid session at their next visit"; N=1 "1 Pay-per-session member will need…"; 0 "No members are on a Pay-per-session plan yet."), scope line "This applies from now on. Past visits and anyone already checked in are not affected.", and an old-app-version warning in a `warning` box (EN/FR copy authored here: guests on old app versions see an "expired" message). Buttons [Cancel] / [Start charging] / FR [Activer la facturation], never "Confirm". Escape disabled unconditionally; focus on [Cancel]; [Start charging] disabled until the count loads; count failure shows "Couldn't count affected members." with [Retry]. Success toast "Guests now pay per session."; server refusal "Couldn't change this setting. Try again." and the toggle keeps its stored value.
- Turn-off dialog: title "Stop charging guests per session?"; says Pay-per-session members check in without a paid session; paid sessions already bought are kept but unused while off and still lapse N days after payment, N read from `platform_session_config.paid_session_validity_days` server-side via the admin client after the action confirms owner/supervisor (fall back to 7 if the read fails); adds "Guests stop earning loyalty stamps." only when a `loyaltyEnabled` prop (default false, Epic 20 hook) is true. Buttons [Cancel] / [Stop charging] / FR [Arrêter la facturation]; toast "Guests no longer pay per session."
- The setting writes only through its own setter and is excluded from `saveGymSettings`. The page hint becomes "…except Registration fee, Charge guests per session, Loyalty program and Category, which save on their own." (EN and FR).
- Every new string has keys in `en.json` and `fr.json`; `check:i18n` passes.

**Never:** No migration, no new RPC. No loyalty copy beyond the gated clause. No session alert, record panel, member modal, Payments or Subscriptions change (19-9b/19-9c). No Plans UI change (plan lock already ships in `PlanModal`). No minimum-app-version gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Turn on | Owner, count loaded | RPC `set_guest_charging(true)`, toast, toggle on | refusal → inline "Couldn't change this setting. Try again.", stays off |
| Count fails | impact RPC errors | message + [Retry]; [Start charging] disabled | Retry re-calls |
| Zero count | 0 members | "No members are on a Pay-per-session plan yet." | N/A |
| Turn off, loyalty off | charging on | dialog without stamps clause | as turn-on |
| Manager viewing | role manager/receptionist | control absent from DOM | N/A |
| General save | other fields changed | payload carries no charging field | N/A |

</frozen-after-approval>

## Code Map

- `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx` -- add section near registration fee (:786-823); native `<dialog>` pattern :211-252, :1037-1062 (call `ref.current?.close()` too); hint `settings.saveHint` :564
- `apps/dashboard/app/(dashboard)/settings/page.tsx` -- pass `role` from `getDashboardShellContext()` (`services/session.ts`) and `chargeGuestsPerSession` (already in `getGymSettings`)
- `apps/dashboard/app/(dashboard)/settings/actions.ts` -- add `getGuestChargingImpact`, `setGuestCharging` actions (mirror `saveRegistrationFee` :286); admin read of config via `lib/supabase/admin.ts`
- `apps/dashboard/services/gym-settings.ts` -- add `getGuestChargingImpact()`, `setGuestCharging(enabled)` mirroring `setRegistrationFee` :364; `updateGymSettings` must stay free of the field
- `apps/dashboard/locales/en.json:80`, `fr.json:80` -- hint and new `settings.guestCharging.*` keys
- `supabase/migrations/0107_charge_guests_setting_session_record.sql:95-195` -- RPC contracts (bare `raise exception` text: 'permission denied', 'invalid_value', 'not active'); do not edit
- Tests to mirror: `settings/SettingsForm.registrationFee.test.tsx`, `settings/actions.registrationFee.test.ts`, `services/gym-settings.setRegistrationFee.test.ts`
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` -- already maps V1.6 events; only verify FR parity and "old → new" Details for `guest_charging_changed`

## Tasks & Acceptance

**Execution:**
- [x] `services/gym-settings.ts` -- wrappers for impact and setter, error mapping -- no UI without them
- [x] `settings/actions.ts` -- two actions with role check and validity-days read -- keeps admin client server-side
- [x] `settings/SettingsForm.tsx`, `settings/page.tsx` -- role-gated section, two dialogs, hint -- the user-facing goal
- [x] `locales/en.json`, `locales/fr.json` -- all strings -- bilingual parity
- [x] tests beside each above -- one case per matrix row, absent-from-DOM for non-owner/supervisor, Escape ignored, Cancel focused, payload exclusion

**Acceptance Criteria:**
- Given the matrix cases, when the settings form and action tests run, then all pass.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given a charging gym in manual QA, when an Owner toggles on then off, then the dialogs, toasts and stored value match the matrix.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge | Turn-off dialog shows fallback 7 days while impact loading/errored; Stop enabled | medium | patch | Off dialog had no loading/error state and no ready gate; literal 7 in form. |
| 2 | edge | Second Escape (close watcher) closes dialog; switch re-enabled mid-save | medium | patch | Only cancel is prevented; switch disabled only by dialog state. |
| 3 | gap | Page role wiring has no test | medium | patch | No settings page test; form tests inject role themselves. |
| 4 | blind | "1 days" plural for validity of 1 (EN/FR) | low | patch | offKept interpolates {{count}} with no plural keys. |
| 5 | blind | configError swallowed without log | low | patch | Only thrown exceptions reach console.error. |
| 6 | blind | Impact loading/error not announced | low | patch | One-attribute fixes. |
| 7 | blind | Admin-client read vs definer RPC | low | reject | Spec Never excludes a migration; read is server-side after RPC role check. |
| 8 | blind | null count becomes 0 | false | reject | guest_charging_impact returns integer; null unreachable. |
| 9 | blind, edge | Toggle not re-synced from props / stale !chargeGuests | low | reject | Dialog target equals state shown; setter idempotent so result converges to user intent. |
| 10 | blind, edge | Shell failure hides control silently | low | reject | RPC is the boundary; hiding is the safe failure. |
| 11 | edge | setGuestCharging has no own role check | false | reject | RPC is the authorization boundary by design. |
| 12 | gap | Validity guard null/0 cases untested | low | reject | Display-only; error paths covered. |
| 13 | gap | loyaltyEnabled never wired | false | reject | Specified Epic 20 hook. |
| 14 | blind | saveHint names Loyalty/Category sections not yet present | false | reject | Verbatim from epic AC. |
| 15 | blind | Cancel disabled while saving, hung request | low | reject | Same pattern as existing dialogs. |
| 16 | blind | Test weaknesses (order-dependent query, i18n mock, race refs) | low | reject | Cosmetic; check:i18n covers key parity. |

### Review Findings

Second review pass (2026-10-11, /bmad-code-review on merged diff `ea7581b..44057d8`).

- [x] [Review][Patch] Turn-off dialog cannot confirm while the impact/count read fails — Stop is `disabled` unless `chargeImpact.status === "ready"`, and the off dialog only needs `validityDays` (falls back to 7), not the count. During a transient `guest_charging_impact()` failure an Owner cannot switch charging off (only Retry/Cancel). Resolved decision (delegated to reviewer, 2026-10-11): Stop stays enabled on error (disabled only while loading); the off dialog drops its count-error/Retry block and omits the validity line; the turn-on dialog keeps its ready gate. [SettingsForm.tsx:1401, actions.ts:getGuestChargingImpact] (blind-hunter+edge-case-hunter+acceptance-auditor)
- [x] [Review][Patch] Plural keys `offKept_one`/`offKept_other` never exercised against real locale/i18next (test mock maps both to one string; `validityDays: 1` untested) [SettingsForm.guestCharging.test.tsx:188-218] (verification-gap+blind-hunter)
- [x] [Review][Patch] Interaction guards untested: Escape `keyDown` handler, switch disabled while `chargeSaving`, stale-request guard `chargeImpactRequestRef` [SettingsForm.guestCharging.test.tsx:310-320] (verification-gap+acceptance-auditor+blind-hunter)
- [x] [Review][Patch] FR `saveHint` names the section "Facturation des invités par séance" but the label/title say "Facturer les invités par séance" [fr.json:80] (acceptance-auditor+blind-hunter)

#### Rejected

- `limit(1)` unordered on `platform_session_config` (edge) — false: `platform_session_config_singleton` unique index (0107:273) guarantees one row.
- `next = !chargeGuests` stale-tab direction (edge) — false: `chargeGuests` only changes in this handler, the dialog direction is derived from it, and the RPC write is idempotent.
- No `revalidatePath`/`router.refresh` after toggle (blind) — low: same pattern as the sibling `saveRegistrationFee`; state is updated locally.
- Suspended-gym owner sees generic message (edge) — low: spec mandates one fixed translated refusal message.
- `getDashboardShellContext` throwing hides Settings (edge) — false: it returns `{data, error, suspended}`; page already treats failure as null role.
- `?? 0` masks null count (blind) — false: RPC returns integer; same as triage #8.
- `setGuestCharging` action has no own role check (acceptance-auditor) — false: RPC is the authorization boundary (triage #11).
- Audit-label verification not evidenced (acceptance-auditor, blind) — false: `auditLabels.ts:62` maps `guest_charging_changed`; `auditLabels.epic19.test.ts:12` covers it.
- Hint advertises Loyalty/Category sections (blind) — low: verbatim epic AC (triage #14).
- Implementation Notes empty / spec `status: done` vs sprint `review` (blind, acceptance-auditor) — rejected: fix edits the spec under review.
- Duplicated dialog markup, raw `amber-*` warning box (blind) — low: amber classes match existing warning boxes (SettingsForm.tsx:1011); duplication is cosmetic.
- Live-region/`aria-describedby` gaps (blind) — low: addressed in triage #6; remainder cosmetic.
- `onClose` mid-save / `showModal()` InvalidStateError (blind) — low: effect re-runs only when `chargeDialog` changes; not reachable in normal use.
- Weak payload-exclusion substring test, validity-days guard tests (blind) — low: cosmetic (triage #12, #16).

## Verification

**Commands:**
- `pnpm --filter dashboard test -- settings` -- expected: pass
- `pnpm --filter dashboard check:i18n` -- expected: parity
- `bash scripts/ci-local.sh` -- expected: all stages PASS
