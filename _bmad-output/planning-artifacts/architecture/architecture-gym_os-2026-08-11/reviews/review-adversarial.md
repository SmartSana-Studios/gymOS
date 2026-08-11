# Adversarial Review — ARCHITECTURE-SPINE.md (gym_os, 2026-08-11)

**Method:** for each AD, construct two independent, spine-literate builders (engineers or AI coding agents) each implementing a different epic/story, each obeying every applicable AD to the letter, and ask whether their outputs can still collide — on shared data shape, entity ownership, mutation path, race condition, or RLS coverage. Findings below are gaps in the spine, not bugs in existing code; nothing here is a proposed fix, only where the spine should be tightened.

---

## Finding 1 — AD-6's mandated mirror-pattern inherits AD-3's exact defect (role-ceiling checks may read the stale JWT claim)

**Units:** Engineer A migrates existing RLS policies per AD-3. Engineer B (Epic 9) writes `create_staff_member()`/`update_staff_role()` per AD-6.

**Evidence:** AD-6's rule text says the new RPCs must "mirror `log_audit_event()`'s internal-authorization-check pattern." The live `log_audit_event()` implementation (`supabase/migrations/0007_audit_log.sql:191`) determines caller-is-super-admin via `coalesce((auth.jwt() ->> 'app_role') = 'super_admin', false)` — a JWT-claim read, precisely the pattern AD-3 exists to eliminate. AD-3's own `binds` clause, however, is scoped to "every RLS policy that gates on role" — a `SECURITY DEFINER` function's *internal* `if`-check is not an RLS policy, so it is textually outside AD-3's mandate.

**Why they conflict:** Engineer A, doing a faithful AD-3 migration, updates every RLS `POLICY` clause to call `private.current_member_role()` and reasonably believes the "stale JWT claim" problem is now closed system-wide. Engineer B, doing a faithful AD-6 implementation, copies the literal pattern AD-6 tells them to copy — and that pattern reads `auth.jwt() ->> 'app_role'`. Both are individually spine-compliant. The result: a Manager demoted mid-session (role changed in `members`, JWT not yet refreshed) can still pass `create_staff_member()`'s/`update_staff_role()`'s internal role-ceiling gate — the exact "next token refresh" window AD-3 was written to close — because the ceiling check never routes through `current_member_role()`.

**Tighten:** AD-6 (or AD-3) should name `private.current_member_role()` explicitly as the caller-role source inside the new RPCs' internal check, not "mirror the existing pattern" — and AD-3's `binds` clause should be widened from "every RLS policy" to "every role-gating check, including inside `SECURITY DEFINER` function bodies," since the existing `log_audit_event()` precedent this AD-6 leans on is itself pre-AD-3 and non-compliant.

---

## Finding 2 — Flow A/Flow B share one Edge Function with no defined dispatch or idempotency-log ownership

**Units:** Engineer A extends `payment-webhook` for Flow A (AD-13/AD-16/AD-17, pre-existing). Engineer B wires Flow B's webhook path (AD-14/AD-15) into the same, only-3-Edge-Functions-total `payment-webhook` (Structural Seed explicitly reuses it: "provider-generic signature verification... Tara Money is the current active provider... not a hardcoded name").

**Why they conflict:** AD-13 gives Flow A a DB-driven active-provider RPC (`activate_payment_provider()`/`active_payment_provider()`) scoped implicitly to "every gym-scoped session." AD-14 gives `PaymentProvider` "a discriminated routing context — `{type:'gym', gym_id}` / `{type:'platform'}`" but never states *where* that discriminator is decided for an inbound, unauthenticated webhook call (there is no "session" on a webhook — routing context must be derived from the payload itself, e.g. a merchant/account ID). Nor does the spine say whether AD-17's idempotency log (`payment_webhook_events`) is one shared table needing a Flow discriminator/nullable `gym_id` — which AD-14 explicitly designed *against* for the payments table itself ("Prevents: every existing Flow-A-only RLS policy... from needing a `flow`/nullable-`gym_id` branch") — or a second, `saas_billing_webhook_events` table mirroring AD-14's split. Engineer A, extending the existing function, may reuse `payment_webhook_events` with a new nullable `gym_id`/`flow` column (violating AD-14's stated rationale but not any explicit rule about *this* table). Engineer B, following AD-14's letter, may instead create a parallel table. Neither engineer is wrong per the current text, but the two builds diverge on where Flow B's webhook idempotency lives, and `payment-webhook`'s single shared code path now has two authors independently deciding how a webhook payload is routed to gym vs. platform credentials.

**Tighten:** AD-14 or AD-17 should state explicitly (a) how `payment-webhook` determines routing context from an unauthenticated inbound payload, and (b) whether `payment_webhook_events` is split like `payments`/`saas_billing_payments` or shared with a discriminator — currently silent on both.

---

## Finding 3 — Epic 4 vs. Epic 11 reconciliation jobs are free to define "discrepancy" differently, and AD-19 actively encourages that independence

**Units:** Epic 4's existing payment-reconciliation `pg_cron` job (`payments`, `payment_webhook_events`) vs. Epic 11's new SaaS-billing reconciliation job (`saas_billing_payments`).

**Why they conflict:** AD-14 gives Flow B its own table specifically so Flow-A logic never needs a branch for it. AD-19 independently mandates "each cron trigger is its own function/transaction" with no shared-trigger requirement. Taken together, both ADs actively discourage a shared reconciliation code path — which means nothing in the spine requires the two jobs to agree on what a "discrepancy" even is (e.g., payment-logged-but-unwebhooked window, webhook-confirmed-but-subscription-not-updated, provider-side amount mismatch). Two engineers each write a fully AD-19-compliant, fully AD-14-compliant reconciliation job, and a support engineer later debugging "why did Flow A flag this in 2 hours but Flow B's equivalent case took 24 hours to surface" finds two independently-invented discrepancy semantics with no shared contract, test, or `packages/types` schema tying them together.

**Tighten:** Add a rule (new AD or AD-14 extension) that discrepancy-detection *semantics* (not the cron trigger, not the table) are defined once — e.g., a shared SQL function or `packages/types` predicate — reused by both jobs' bodies, so AD-19's per-job independence stays scoped to scheduling/observability, not business-logic duplication.

---

## Finding 4 — No defined home for "did the member show up" between AD-21 (booking) and AD-22 (check-in)

**Units:** Epic 12 booking engineer (AD-21: `book_class_session()`) vs. a front-desk/attendance engineer wiring up class-session arrival.

**Why they conflict:** AD-21 is explicit that it governs *capacity* only, and cross-references AD-22 to disclaim overlap — but neither AD, nor the ERD, states whether a member arriving for their booked class produces an `attendance_events` row (subject to AD-22's one-open-check-in partial unique index) or a status column on `class_bookings` (e.g., `attended_at`). This is genuinely undecided, not just under-specified: Engineer A could wire class arrival through the existing `check_in()` RPC (reusing AD-22's proven one-open-session enforcement, and "one physical visit = one check-in" is a defensible reading), while Engineer B could add attendance tracking directly to `class_bookings` (defensible because AD-21 never mentions `attendance_events` at all). Both are spine-compliant. The failure mode: if wired through `check_in()`, a member already checked in generally who then "checks into" their class hits AD-22's uniqueness constraint and is blocked — or, if the two are wired independently, a gym gets two disconnected attendance records for the same visit, breaking any dashboard that assumes one canonical `attendance_events` row per visit.

**Tighten:** AD-21 (or a new AD-21a) should state explicitly whether class-session attendance marking is a `class_bookings` status field, a new `attendance_events` row, or reuses `check_in()` — currently the cross-reference between AD-21/AD-22 covers capacity-vs-uniqueness but not attendance-recording ownership.

---

## Finding 5 — AD-23's per-domain queue pattern doesn't foreclose being applied to a bounded-capacity action

**Units:** Mobile engineer building offline-first class booking (natural UX expectation, Epic 12) vs. backend engineer building `book_class_session()` (AD-21).

**Why they conflict:** AD-23's `Prevents` clause names only "payment or other stateful actions" as off-limits for offline queueing; its `Rule` says any new offline-capable action just needs "its own explicit, `client_id`-keyed queue-item type with its own conflict-resolution rule." A mobile engineer can read this as license — AD-23 doesn't say "and never a capacity-bounded action" the way it explicitly excludes payment. But AD-21's whole reason for existing is that capacity correctness requires a synchronous `SELECT ... FOR UPDATE` at write time; there is no safe backfill/conflict-resolution rule for "the class filled up between your offline tap and your reconnect" the way there is for check-in's timeout-backfill or workout-completion's idempotent-upsert — AD-23 requires exactly that kind of rule to exist per queue-item type, and for a contested/bounded resource it structurally can't. Two spine-compliant builders end up with a mobile UI that promises an offline "booked!" state AD-21's own server-side RPC cannot honor once synced, with no AD closing the gap (it's not a DB race — AD-21's lock still protects capacity correctly — it's a silently-undefined client promise).

**Tighten:** AD-23 should exclude bounded-capacity/AD-21-governed actions by name, the same way it excludes payment, rather than leaving "other stateful actions" to a future builder's judgment call.

---

## Finding 6 (secondary) — AD-14's "Super-Admin-scoped RLS" may read as license to skip AD-5's audit-logged escalation for gym-attributable billing rows

**Units:** Engineer who built AD-5 escalation flow (Epic 5/6-era) vs. Epic 11 engineer building `saas_billing_payments` RLS.

**Why they conflict:** AD-5 requires that "row-level access to a specific gym's data requires the audit-logged escalation action" — a blanket rule with no carve-out. `saas_billing_payments` rows are gym-attributable (the ERD: `GYMS ||--o{ SAAS_BILLING_PAYMENTS`). AD-14 nonetheless describes its RLS as simply "Super-Admin-scoped," parallel to `job_runs`/`audit_log` (platform-level, no per-row gym data) — but unlike those two precedents, `saas_billing_payments` *does* carry gym-specific financial data. An engineer implementing AD-14 literally ("Super-Admin-scoped RLS" = a broad `is_super_admin()` SELECT policy, no escalation call, no audit-log entry) satisfies AD-14's text while violating AD-5's "never a blanket bypass" rule for what is, in substance, a specific gym's data. This wasn't in the four requested focus areas but surfaced directly from the AD-5/AD-14 cross-reference and is worth flagging alongside them.

**Tighten:** AD-14 should state explicitly whether Super Admin's SELECT access to `saas_billing_payments` goes through AD-5's escalation+audit-log path or is treated as inherently platform-level (and why, given the table carries `gym_id`).
