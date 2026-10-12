---
title: '19-9c Payments Purpose ledger, filter, CSV; Subscriptions guard'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '6775965e8df29d19ff9b92b79c89369722253a4c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-09 shows only the Verification Queue and Discrepancies, so session payments (desk payments are recorded `verified` and never queue) are invisible, the member modal Sessions link (`/payments?memberId=&purpose=session`) lands on an unfiltered page, and a late-confirmed session payment cannot show "Confirmed late".

**Approach:** Half C of Story 19.9 (split decided 2026-10-11). Build a minimal "All Payments" ledger below the queue with a Purpose column and filter, a reason tag beside Flagged, an Actor column and an Export CSV carrying purpose. Subscriptions needs no code (decision below).

## Boundaries & Constraints

**Always:**
- Ledger lists every gym payment (all statuses, voided rows included with a muted "Voided" tag), newest first, server-paged at 50 via `?page=`; filters live in the URL: `purpose` (All / Renewal=`subscription` / Registration fee / Session, EN/FR) and `memberId`; the page reads both, so the 19-9b Sessions link lands filtered. An unknown `purpose` value falls back to All.
- Columns: Member (name opens nothing new), Amount, Method, Purpose, Status badge plus reason tag via `PAYMENT_FLAGGED_REASON_LABEL_KEY` (late-confirmed session shows Verified + "Confirmed late"; wrong-account/mismatch stays Flagged with its tag), Date, Actor (staff name; Tara payments with no actor show "Tara Money (in app)"), Note.
- Export CSV mirrors `exportSubscriptionsCsv` (count pre-check, `export_too_large` over 1,000, `csvEscape`) honouring the current purpose/member filter and including a `purpose` column; owner/manager/supervisor/receptionist (same roles as the payments read policy).
- Empty states: "No payments recorded yet." and, with a filter, "No payments match these filters." [Clear filters].
- All strings EN+FR; `check:i18n` passes; "session" is qualified in EN.

**Never:** No migration, no new RPC. No date-range, Method or Status filters, no sorting (deferred). Do not change the Verification Queue, Discrepancies, refund or record flows. No Subscriptions code (below).

- Decision (2026-10-11): ledger scope is the minimal table + CSV above, not the full UX-spec ledger.
- Decision (2026-10-11): the AD-08 "Last Payment ignores `session`" AC is vacuous — Subscriptions has no Last Payment column (cut, docs/decisions.md). Add no column; record this in the sprint-status entry.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desk session | verified `session`, actor staff | row: Session, Verified badge, Actor name | N/A |
| Late Tara | verified + `late_confirmation` | Verified + "Confirmed late" | N/A |
| Wrong account | flagged + `wrong_account` | Flagged + wrong-account tag | N/A |
| Sessions link | `?memberId=m&purpose=session` | only that member's session rows | N/A |
| Bad param | `?purpose=junk` | All purposes | N/A |
| Filter empty | no match | filtered empty state + Clear | N/A |
| CSV too big | >1,000 rows | `export_too_large` message, no file | mapped toast |
| Read failure | ledger query errors | queue still renders; ledger shows load error | log, degrade |

</frozen-after-approval>

## Code Map

- `apps/dashboard/app/(dashboard)/payments/page.tsx` -- add `searchParams` (audit/page.tsx is the model), parse `page`/`purpose`/`memberId`, fetch ledger beside queue; ledger failure degrades like `discrepanciesError`
- `apps/dashboard/services/payments.ts` -- add `listAllPayments`, `exportPaymentsCsv` (mirror `listAuditLog` paging at services/auditLog.ts:167 and `exportSubscriptionsCsv`; batched actor-name read as in `listPendingPayments` ~L532); select incl. `flagged_reason, voided_at, status, purpose`; update the stale "Verification Queue only" comments
- `apps/dashboard/app/(dashboard)/payments/actions.ts` -- `exportPaymentsCsvAction` passthrough (audit/actions.ts model)
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` -- ledger section, filter, pagination via URL (AuditLogPageClient.tsx:82-131 for router.push/export); keep `useClientPagination` for queue/discrepancies
- `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts` -- reuse `PAYMENT_PURPOSE_LABEL_KEY`, `PAYMENT_FLAGGED_REASON_LABEL_KEY`, `PAYMENT_STATUS_BADGE_CONFIG` (add `processing` mapping)
- `apps/dashboard/services/subscriptions.ts:419,482` -- NO change (Last Payment cut)
- `apps/dashboard/locales/en.json`, `fr.json` -- `payments.ledger.*`, `payments.purposeFilter.*`, `payments.export.*`; existing `payments.purposes`/`flaggedReasons` (en.json ~L1097) reused
- Tests to mirror: `PaymentsPageClient.purpose.test.tsx`, `page.wiring.test.tsx`, `services/auditLog` export tests, `payments.listRefundEligiblePayments.test.ts`

## Tasks & Acceptance

**Execution:**
- [x] `services/payments.ts` -- `listAllPayments`, `exportPaymentsCsv` -- ledger backend
- [x] `payments/actions.ts` -- export action -- gated passthrough
- [x] `payments/page.tsx` -- searchParams wiring -- URL-driven filter and page
- [x] `PaymentsPageClient.tsx`, `paymentLabels.ts` -- ledger table, Purpose filter, reason tag, export button, empty states
- [x] `locales/en.json`, `fr.json` -- bilingual strings
- [x] tests beside each -- one case per matrix row, page wiring asserts params reach the service

**Acceptance Criteria:**
- Given the matrix cases, when dashboard tests run, then all pass and the queue/discrepancy/purpose-label tests still pass.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given a charging gym in manual QA, when a desk session payment is recorded, then it appears in All Payments as Session, Verified, with the staff Actor, and the member modal Sessions link opens the filtered ledger.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap | No test renders PaymentsPageClient with ledger props; dropping `purpose`/`memberId` forwarding passes every test | medium | patch | page.wiring stops at client props, ledger tests feed props directly; added PaymentsPageClient.ledger.test.tsx. |
| 2 | gap, blind | CSV success download branch untested | low | patch | Added a success-path case (Blob URL, click, revoke) to PaymentsLedger.test.tsx. |
| 3 | edge, blind | Out-of-range `?page=` shows "No payments recorded yet." | low | reject | Only a stale or hand-edited URL reaches it (filter change resets page to 1); fix adds a redirect/clamp branch. |
| 4 | edge, blind | Staff mobile_money row with unresolved actor labelled Tara | low | reject | Needs a deleted/unreadable actor member row; fix adds actorId plumbing. |
| 5 | edge, blind | Unknown status rendered as Pending | false | reject | `payment_status` enum is exactly pending/processing/verified/flagged (database.ts:2558) and all four are mapped. |
| 6 | edge, blind | Negative amounts corrupted by csvEscape | false | reject | Refunds live in `refunds`; payments.amount is positive. |
| 7 | edge | Repeated query params arrive as string[] | false | reject | `parsePage` -> NaN -> 1 and `normalizeLedgerFilters` rejects arrays; both fall back to no filter. |
| 8 | edge | `?size=` accepted although paging is 50 | false | reject | `parsePageSize` only allows PAGE_SIZE_OPTIONS and defaults to 50; same as the audit page and TablePagination selector. |
| 9 | edge | Actor `.in()` unbounded for 1,000-row export | false | reject | Distinct actors are gym staff, a handful. |
| 10 | blind | Member filter has no visible indicator | low | reject | Clear filters is shown and the spec defines no chip; fix adds UI and strings. |
| 11 | blind | Voided row still shows Verified badge | low | reject | Spec mandates a muted "Voided" tag beside the status. |
| 12 | blind | Export error role=status, 4s, static filename, no BOM, raw codes in CSV, ISO dates | low | reject | Cosmetic; mirrors the audit and subscriptions exports. |
| 13 | blind | Hydration/locale date, no currency column, count cost | low | reject | Same toLocaleString pattern as the queue; XAF-only gyms; no named harm. |
| 14 | blind | Duplicated role list, `as unknown` casts | low | reject | Defensive guard over RLS; cast pattern predates this story. |
| 15 | blind, edge | Spec tasks unchecked, stale queue-only comments, sprint bookkeeping | false | reject | Tasks are ticked; the comments were updated in page.tsx/PaymentsPageClient.tsx; sprint-status entries are appended. |
| 16 | gap | LEDGER_EXPORT_ROLES manager/supervisor untested | low | reject | List is the policy's four roles; test adds nothing the receptionist case does not. |

## Verification

**Commands:**
- `pnpm --filter dashboard test` -- expected: pass
- `pnpm --filter dashboard check:i18n` -- expected: parity
- `bash scripts/ci-local.sh` -- expected: all stages PASS

### Review Findings

Code review 2026-10-12 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor).

- [x] [Review][Decision] RESOLVED 2026-10-12 (kept as is, matches audit page; default stays 50) -- Page size is user-selectable although the spec says "server-paged at 50" — page.tsx reads `?size=` via `parsePageSize` (same as the audit page; default 50, TablePagination exposes a selector). Options: keep (matches audit page, spec literal deviation) or pin to 50 and hide the selector. [apps/dashboard/app/(dashboard)/payments/page.tsx:47]
- [x] [Review][Patch] Export path under-tested: add (a) csvEscape case (`=`-prefixed name, comma/quote note), (b) `it.each(owner, manager, supervisor, receptionist)` allowed + coach refused, (c) component test with non-empty `memberId` asserting the action arg plus a `member_id` eq assertion in the export suite, (d) CSV row for mobile_money/actor null/voided asserting Tara label and `voided=true` [apps/dashboard/services/payments.listAllPayments.test.ts, PaymentsLedger.test.tsx]
- [x] [Review][Patch] page.wiring.test mocks `normalizeLedgerFilters` with logic that differs from the real one (no UUID check), so "junk param" cases test the mock; use `importActual` or a valid UUID [apps/dashboard/app/(dashboard)/payments/page.wiring.test.tsx]
- [x] [Review][Patch] Ledger ordering has no tie-breaker: add `.order("id", { ascending: false })` after `created_at` in `listAllPayments` and the export query so same-instant rows cannot repeat or skip across pages [apps/dashboard/services/payments.ts:1405]
- [x] [Review][Patch] Filtered empty state renders two "Clear filters" buttons (filter bar + empty block); spec shows one — hide the bar button when the empty block shows it [apps/dashboard/app/(dashboard)/payments/components/PaymentsLedger.tsx:165]
- [x] [Review][Defer] CSV has no UTF-8 BOM, so Excel garbles accented French names — deferred: same behaviour in every dashboard CSV export; fix once across exports
- [x] [Review][Defer] `csvEscape` guard misses a leading tab/CR (OWASP list) — deferred: guard is a per-file copy in members/subscriptions/payments; fix all copies together

#### Rejected
- Out-of-range `?page=` shows load error / "No payments recorded yet" (edge, blind) — low; only a hand-edited URL reaches it, fix adds a clamp/redirect branch (same as triage #3).
- Staff mobile_money row with unresolved actor shown as Tara (edge, blind, acceptance) — low; owners and staff all have `members` rows, needs a deleted/unreadable row (triage #4).
- Unknown status rendered as Pending — false; `payment_status` enum is the four mapped values.
- Negative amounts corrupted by csvEscape — false; refunds live in `refunds`, payments.amount is positive.
- `common.somethingWentWrong` missing — false; defined in packages/types/src/locales/{en,fr}.json.
- Stale "queue only" comments in services/payments.ts — false; none remain (grep).
- Task checkbox stale — fixed in this write (ticked).
- Sprint-status AD-08 vacuous note — present in earlier sprint-status entries (verified in diff stat: sprint-status.yaml changed).
- No currency per row, member filter has no chip, export error role/timing, CSV count/data race, unbounded service pageSize, purpose outside the three values, `processing` status consumers, table a11y (caption/scope), wiring of ledger props — low, no named harm or fix adds UI/guards.
