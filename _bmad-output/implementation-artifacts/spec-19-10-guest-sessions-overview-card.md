---
title: '19-10 Guest sessions Overview card and AD-22 drill-down'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '1f7ee1b3e96401a4331b093490af92c85b946967'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owners cannot see whether the desk is collecting: paid sessions, blocked attempts and free sessions given are not summarised anywhere, and no surface lists blocked attempts or who recorded each session payment (FR-163).

**Approach:** Migration 0114 adds read-only RPCs (summary plus three paged lists). The staff Overview gains a full-width "Guest sessions" card (own Suspense boundary, Today / This month radiogroup) linking to a new `/guest-sessions` page (AD-22) with Paid, Blocked attempts and Free given tabs.

## Boundaries & Constraints

**Always:**
- Counts are aggregate SQL, never a sum of fetched rows. Period = gym-local day or month via `private.gym_local_day_bounds` / `private.gym_local_month_bounds` (`p_period` `today`|`month`; anything else raises). Window column: `payments.created_at` (paid), `session_attempts.created_at` (blocked, server receipt), `guest_sessions.created_at` (free).
- Paid = verified `purpose='session'` payments with `voided_at is null`, refunded ones included (a refund shows in the Refund column, not in the count). Blocked = `session_attempts` rows (already one per scan id) plus distinct members. Free = `guest_sessions` with `loyalty_grant_id` set (0 until Epic 20).
- Refund column: unconsumed session with `voided_at` = "Refunded"; consumed session whose payment has a refund = "Refunded after use"; else "—". Recorder: `payments.actor_id` resolved to a staff name; null actor on a Tara payment groups as "Tara Money (in app)".
- RPCs are SECURITY INVOKER, callable only by owner/supervisor/manager (check `private.current_member_role()`; refuse others with 42501), `revoke … from public, anon`, grant authenticated; no `auth.jwt()` role read. A suspended gym reads zeros through the tenant gate.
- Card: owner/supervisor/manager only and only when `chargeGuestsPerSession` is on, otherwise absent from the DOM; own `<Suspense>` below the gym-health row; skeleton is one full-width block; failure shows "Couldn't load guest sessions." with [Retry] inside the card only; period remembered in `localStorage` (try/catch, default Today); three figures with `statNumeral` weight, side by side at ≥768px, each a link to `/guest-sessions?tab=…&period=…` with a full-meaning aria-label.
- AD-22: Receptionist/Coach see the global "You don't have permission to do that." state; period and tab in the URL; 50 rows per page; 6 skeleton rows; page error with [Refresh]; per-tab empty-state copy; Paid has group-by (Recorded by default | None) with headers "[name] — N sessions · SUM XAF" from full-period window totals, plus a "Refunded after use only" chip; Blocked shows "[N] attempts · [M] members" and "(synced [time])" for rows with `scanned_at`; Free shows Member, Earned, Use by, Status.
- A member name links to `/members?memberId=<id>`, which opens the AD-04 modal on load.
- EN/FR strings, `check:i18n` parity, "session" qualified in EN.

**Never:** No write path, no new Edge Function, no dismissal-based counts, no walk-away/"paid later" column, no sidebar item, no change to the revenue sub-line or alert panel.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card, charging on | manager, 3 paid, 2 blocked scans by 1 member | 3 / 2 "1 members" / 0 | N/A |
| Zero | no rows | "0" figures, not empty state | N/A |
| Charging off / receptionist | either | card absent | N/A |
| Summary fails | RPC error | in-card error + [Retry] | log, others unaffected |
| Receptionist URL | `/guest-sessions` | permission state, RPC refuses | 42501 mapped |
| Refund unconsumed | full refund | Refund "Refunded" | N/A |
| Refund after use | consumed + refund | "Refunded after use"; chip includes it | N/A |
| Offline attempt | `scanned_at` set | Time = scan time + "(synced …)" | N/A |
| Unknown period/tab | `?period=x` | falls back to today / paid | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0114_guest_sessions_overview_rpcs.sql` -- new: `guest_sessions_summary`, `list_guest_sessions_paid` (window group totals), `list_session_attempts` (class name via `class_sessions`→`classes`), `list_free_guest_sessions`; model 0097/0113 (invoker, period helpers)
- `supabase/tests/guest_sessions_overview.test.sql`, `.negative.test.sql` -- pgTAP positive/refusal/suspension; `packages/types/src/database.ts` splice
- `apps/dashboard/services/guestSessions.ts` -- add summary and list readers (existing member-modal reader stays)
- `apps/dashboard/app/(dashboard)/page.tsx` + new `components/GuestSessionsCard.tsx` -- mount after `GymHealthRow` when role in `GYM_HEALTH_ROLES` and charging on; client period control + Retry
- `apps/dashboard/app/(dashboard)/guest-sessions/` -- new `page.tsx`, `actions.ts`, `loading.tsx`, client component; model `audit/page.tsx` and `AuditLogPageClient.tsx`
- `apps/dashboard/services/members.ts`, `members/page.tsx`, `MembersPageClient.tsx` -- `?memberId=` opens the modal (single-member `MemberListRow` read, modal state seed)
- `apps/dashboard/locales/en.json`, `fr.json` -- `overview.cards.guestSessionsCard.*`, `guestSessions.*`
- Do not touch: `StatCard`, `FrontDeskAlertPanel`, revenue sub-line, migrations 0107–0113

## Tasks & Acceptance

**Execution:**
- [ ] `0114` migration + pgTAP + `database.ts` -- read RPCs; apply locally, `scripts/ci-local.sh` guardrails
- [ ] `services/guestSessions.ts` -- readers with tests
- [ ] Overview `GuestSessionsCard` + page wiring + tests (absence cases, retry, period storage)
- [ ] `/guest-sessions` page, tabs, grouping, chip, pagination + tests
- [ ] Members `?memberId=` deep link + tests
- [ ] EN/FR strings

**Acceptance Criteria:**
- Given the matrix cases, when dashboard vitest and pgTAP run, then all pass; `bash scripts/ci-local.sh` passes every stage.
- Given card figures for a period, when AD-22 opens on each tab, then its totals equal the card's.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind | Overview auto-refresh does not update the card (state seeded once from props) | medium | patch | GuestSessionsCard useState(initialSummary) never re-syncs; OverviewAutoRefresh router.refresh re-streams the section only. |
| 2 | blind, edge | Deep-linked modal reopens after onSaved / not re-seeded on client navigation | low | reject | Modal opens readOnly so onSaved is unreachable; AD-22 is another route, so a visit remounts MembersPageClient. |
| 3 | blind, edge | Out-of-range `?page=` shows false empty state; huge page overflows int offset | low | reject | Only a stale or hand-edited URL reaches it; same call as 19-9c triage #3; fix adds clamp/redirect branches. |
| 4 | blind | Paid list duplicates rows if a payment has several guest sessions | false | reject | `guest_sessions_payment_id_unique` (0107) makes the join 1:1. |
| 5 | blind, edge | Times formatted in viewer timezone, not gym timezone; hydration | low | reject | Same toLocaleString pattern as every other dashboard list; no named harm. |
| 6 | blind | Period/tab/group controls misuse ARIA roles; card radiogroup lacks arrow keys | medium | patch | UX spec requires arrow-key radiogroup; link role=tab/radio misannounce navigation. |
| 7 | blind | "1 members" / "1 attempts" not pluralised | low | reject | Frozen matrix and epic AC literally write "[N] members" / "1 members"; changing it edits the spec's expectation. Raised to the user. |
| 8 | blind | XAF hard-coded | false | reject | Platform is XAF-only; revenue lines do the same. |
| 9 | blind | callRpc untyped | low | reject | Pattern already used in services; no named harm. |
| 10 | blind, gap | Free list/status, today-vs-month, voided payment untested in SQL | medium | patch | Mutating the `loyalty_grant_id`, window branch or `voided_at` predicate leaves all 24 assertions green. |
| 11 | blind | No supporting indexes | low | reject | Per-gym row counts are small; existing gym_id indexes; no named harm. |
| 12 | blind | Null timezone returns zeros | false | reject | `gyms.timezone` is NOT NULL; zeros is the documented suspended-gym behaviour. |
| 13 | gap | Server action, card section initial fetch and latest-request-wins guard unpinned | medium | patch | Mocks replace all three; changing "today" to "month" or deleting requestId checks passes. |
| 14 | gap | refund label `refunded`/`none`, shell-read failure branch untested | low | reject | Straight mapping; no named harm. |
| 15 | gap | `/guest-sessions` not gated on charging flag | false | reject | UX spec: past data stays reachable after charging is turned off. |
| 16 | edge | Chip on + zero rows shows "No paid sessions" empty copy | low | patch | Contradicts the card; direct fix is one string. |
| 17 | edge | Tara label for any non-staff actor with provider; group headers computed over chip-filtered set; inner join members drift | false | reject | Tara in-app payments store the member's user id as actor by design; filtered headers are consistent with the filtered list; `members` FK + staff read policy make the inner join total. |

## Design Notes

Decisions made at planning (user-invisible or defaulted): window totals give group headers over the full period while rows page; member link is a deep link rather than an in-page modal (the modal needs plans/coaches/fee context the Members page already loads); blocked "Time" is `coalesce(scanned_at, created_at)`.

## Verification

**Commands:**
- `pnpm --filter dashboard test` -- expected: pass
- `pnpm --filter dashboard check:i18n` -- expected: parity
- `bash scripts/ci-local.sh` -- expected: all stages PASS
