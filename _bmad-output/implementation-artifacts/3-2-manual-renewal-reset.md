---
baseline_commit: fd074bee858a525a77d7ff03501d2a20fee6423a
---

# Story 3.2: Manual Renewal Reset

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, Owner, or Receptionist,
I want a manual renewal to reset a member's subscription,
so that a payment or admin override immediately restores their access.

## Acceptance Criteria

1. **Given** a member in any non-active state, **when** a renewal is recorded (payment or manual override), **then** their subscription resets to `active` with a new expiry date based on plan duration. [Source: epics.md#Story 3.2]
2. **Given** a renewal completes, **when** it is processed, **then** any open front-desk alert for that member dismisses immediately and the renewal appears in their payment history immediately. [Source: epics.md#Story 3.2]

## Scope Notes — Read Before the Tasks

**This story is backend-only, exactly like Story 3.1. No dashboard Subscriptions page, no Inline Renewal Panel, no `actions.ts`. Read all five notes below before writing any code.**

### Scope Note #1 — Epic boundary: this story builds the reset primitive, not the UI that calls it

`epics.md`'s FR Coverage Map assigns FR-085 ("Subscriptions page provides... inline manual renewal panel") to **Epic 4, Story 4.8**, and the front-desk "Renew" button/panel to **Epic 4, Story 4.7 (Inline Renewal Panel)**. `architecture.md`'s own project-structure tree places `renewSubscription` inside `apps/dashboard/app/(dashboard)/subscriptions/actions.ts` — i.e. co-located with the Subscriptions *route*, which doesn't exist until Story 4.8. There is no `apps/dashboard/app/(dashboard)/subscriptions/` directory today and this story does not create one.

Do build:
- A new Postgres function `renew_subscription(p_member_id uuid, p_reason text)` (Task 1).
- A new service-layer wrapper `apps/dashboard/services/subscriptions.ts` exporting `renewSubscription()` (Task 2) — this is a **service**, not a Server Action or route; it lives at the domain layer precisely so Stories 4.7/4.8 can import and call it directly from their own `actions.ts` without re-deriving this story's logic.
- A new shared Zod schema `packages/types/src/schemas/subscription.ts` (Task 2) — `member.ts`'s own `editMemberSchema` comment already anticipates this: *"no plan/joinDate/subscriptionStatus/expiryDate (renewal/lifecycle territory, Story 3.2's job)"*.

Do **not** build: any `page.tsx`, `actions.ts`, or UI component under `subscriptions/`; any front-desk alert dismissal logic (the alert table/mechanism doesn't exist until Epic 4 Story 4.6 — nothing to dismiss yet); any `payments` row (see Scope Note #2).

### Scope Note #2 — AC #2's "appears in payment history immediately" is not this story's job to implement

`payment_method` (`0001_extensions_and_enums.sql`) has exactly five values — `mtn_momo`, `orange_money`, `cash`, `bank_transfer`, `manual_momo` — all real payment methods; there is no "no-payment manual override" value, and there won't be one, because payment recording (FR-033–041) is entirely Epic 4's scope, not built yet. This story's "manual override" renewal path does **not** insert a `payments` row. AC #2's payment-history clause describes the *eventual* combined experience once Epic 4 exists: Story 4.2/4.3 (payment recording) will itself call `renew_subscription()` as part of processing a real payment, and whatever `payments` row Epic 4 creates will naturally show up in history at that point — nothing this story does blocks that integration. Similarly, "any open front-desk alert... dismisses immediately" is vacuously true today (no alert mechanism exists yet, Epic 4 Story 4.6) and needs no code here.

### Scope Note #3 — The data model is renewal-as-history, not renewal-as-mutation. This is the load-bearing design decision.

`architecture.md`'s Entity Relationships section is explicit: `members (1) ──< subscriptions # a member's plan history over time` and `payments (0..1) ──> subscriptions # a renewal payment links to the subscription it renewed`. This is not incidental phrasing — `apps/dashboard/services/members.ts` already queries subscriptions defensively for multiplicity (`.order("created_at", { referencedTable: "subscriptions", ascending: false }).limit(1, ...)`, lines ~219-220 and ~756-757, with an explicit comment: *"Joins members to its most recent subscriptions row"*), even though today exactly one row is ever created per member. `deferred-work.md`'s own entry for `deactivateMember` explicitly says *"revisit when Story 3.2's renewal work introduces subscription history/multiple rows per member."*

**Resolved design: a renewal INSERTs a new `subscriptions` row. It never UPDATEs the member's existing row.** The prior row is left untouched (whatever terminal status it had — `expired`, `grace_period`, etc. — stays as an accurate historical record); the new row (`status = 'active'`, `start_date = current_date`, `expiry_date` computed from the plan's `duration_days`) becomes the member's current subscription purely by virtue of having the newest `created_at`, which is exactly what the existing "most recent" read pattern already expects.

The renewal reuses the **same `plan_id`** as the member's most recent prior subscription row — this story does not add plan-switching-at-renewal (no AC asks for it, and Epic 4's Inline Renewal Panel is the natural home for that if it's ever needed; YAGNI here).

### Scope Note #4 — Consequence of Scope Note #3: `deactivateMember`'s subscription UPDATE is now a real bug and must be fixed in this story

`apps/dashboard/services/members.ts`'s `deactivateMember` (~line 667) currently does:

```ts
const { error: subscriptionError } = await supabase
  .from("subscriptions")
  .update({ status: "expired" })
  .eq("gym_id", gymId)
  .eq("member_id", memberId);
```

This UPDATEs **every** subscription row for the member, filtered only by `member_id`. Under the single-row-per-member model that held before this story, that was harmless. Once a member can have multiple rows (post-renewal), this silently rewrites history: a member renewed while in `grace_period` (old row correctly stays `grace_period`, new row `active`) who is later deactivated would have the *old* row retroactively flipped to `expired` too — corrupting what that row actually was at the time. Fix it in this story (Task 4) to scope the UPDATE to only the member's current (most-recently-created) subscription row, using the same "most recent" pattern already established in this file's own SELECT queries.

### Scope Note #5 — Resolved design for `renew_subscription()`: `SECURITY DEFINER` with a self-enforced role check, not a widened RLS policy

The existing `manager_or_owner_insert_own_subscriptions` policy (`0018_member_management.sql`) only allows `manager`/`owner` to INSERT into `subscriptions` — but this story's actor list explicitly includes Receptionist. Two ways to close that gap: (a) widen the RLS INSERT policy to include `receptionist`, or (b) leave the RLS policy untouched and use a `SECURITY DEFINER` function that self-checks the caller's role, mirroring the exact pattern `enforce_member_cap()` (0018) and `platform_metrics()`/`super_admin_job_failures()` (0011/0021) already establish in this codebase.

**Resolved: (b).** This keeps Receptionist's blast radius narrow — they gain the ability to call this one controlled, audited function, not generic raw INSERT rights on `subscriptions`. Do not modify `manager_or_owner_insert_own_subscriptions`.

```sql
create function renew_subscription(p_member_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id;

  if v_member_gym_id is null then
    raise exception 'renew_subscription: member % not found', p_member_id;
  end if;

  if v_member_gym_id is distinct from v_caller_gym_id then
    raise exception 'permission denied';
  end if;

  if v_deactivated_at is not null then
    raise exception 'renew_subscription: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'renew_subscription: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'renew_subscription: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', current_date, v_new_expiry)
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => 'subscription_manual_renewal',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason,
      'subscription_id', v_new_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry
    )
  );

  return v_new_id;
end;
$$;
```

The role check comes first (cheapest, no data read), then tenant/gym match (mirrors `log_audit_event()`'s own tenant-isolation check), then the deactivated-member guard, then the reason guard, then the actual work. `log_audit_event()` is itself `SECURITY DEFINER` and derives the actor from `auth.uid()` internally (proven to work correctly when called from inside another `SECURITY DEFINER` function — this is exactly how `run_subscription_lifecycle_job()`'s failure path already calls it, Story 3.1). No new RLS policy on `subscriptions` or `members` is needed — this function bypasses RLS by design, exactly like `enforce_member_cap()`.

**Compatibility with existing constraints:** `start_date = current_date` and `expiry_date = current_date + v_duration_days` (with `v_duration_days > 0`, enforced by `plans_duration_days_matches_plan_type`, 0017) always satisfies 0021's `subscriptions_expiry_after_start` CHECK (`expiry_date is null or expiry_date > start_date`) and 0018's `enforce_subscription_expiry_matches_plan_type` trigger (null iff pay-per-session) without any extra handling — confirm this holds in Task 5's hands-on verification, don't just assume it.

**Timezone note (accepted simplification, matching Story 3.1's own precedent):** `current_date` here is evaluated in the DB session's default timezone (UTC), not the gym's `timezone` column (Africa/Douala, UTC+1, no DST). This mirrors Story 3.1's own deliberate, documented simplification (`deferred-work.md`: *"gyms.timezone is joined but unused in the date math"*) — do not attempt to fix this here; it's a pre-existing, accepted gap, not something this story introduces.

## Tasks / Subtasks

- [x] **Task 1: `renew_subscription()` Postgres function** (AC #1, #2; Scope Notes #3, #5)
  - [x] New migration `supabase/migrations/0022_manual_renewal_reset.sql` (next sequential number after `0021_subscription_lifecycle_cron.sql`). Implement `renew_subscription(p_member_id uuid, p_reason text) returns uuid` exactly per Scope Note #5's resolved design and guard ordering.
  - [x] `revoke execute on function renew_subscription from public; grant execute on function renew_subscription to authenticated;` — matches `super_admin_job_failures()`'s exact grant shape (0021). No grant to `anon` or `service_role`.
  - [x] Do not modify `manager_or_owner_insert_own_subscriptions` or any other existing RLS policy (Scope Note #5).

- [x] **Task 2: TypeScript service layer + shared schema** (Scope Note #1)
  - [x] New `packages/types/src/schemas/subscription.ts`: `renewSubscriptionSchema = z.object({ memberId: z.uuid(), reason: z.string().trim().min(REASON_MIN_LENGTH, "Add a reason describing this renewal") })` with a local `const REASON_MIN_LENGTH = 5;` (matches `member.ts`/`gym.ts`'s exact per-file-const convention — no shared constant import). Export `RenewSubscriptionInput = z.infer<typeof renewSubscriptionSchema>`. (Used `z.uuid()`, this codebase's actual Zod v4 top-level syntax — confirmed via `gym.ts`/`member.ts` precedent — not the `.string().uuid()` form the story draft sketched.)
  - [x] Added `export * from "./schemas/subscription";` to `packages/types/src/index.ts`.
  - [x] New `apps/dashboard/services/subscriptions.ts`: `renewSubscription(input: RenewSubscriptionInput)` — validates via `renewSubscriptionSchema.safeParse`, then `supabase.rpc('renew_subscription', { p_member_id: parsed.data.memberId, p_reason: parsed.data.reason })`, returning `{ data: { id: string } | null, error: AppError | null }` (matches `insertSubscription`'s exact return shape in `members.ts`). Uses `mapAndLog` for the error path, matching every other service function in this app.
  - [x] Added two new mappings in `packages/types/src/errors.ts`'s `mapSupabaseError`, matching on exact raise-text substrings: `message.includes("renew_subscription:") && message.includes("not found")` → `member_not_found`; `message.includes("is deactivated and cannot be renewed")` → `member_deactivated`. `permission denied`, the reason-required raise, and the no-existing-subscription raise are left unmapped (generic `unknown` fallback) as specified.
  - [x] Added `errors.memberNotFound` and `errors.memberDeactivated` keys (EN + FR) to `packages/types/src/locales/en.json`/`fr.json`'s existing `errors` block.

- [x] **Task 3: pgTAP tests** (AC #1, #2)
  - [x] New `supabase/tests/manual_renewal_reset.test.sql`, following `member_management_rls.test.sql`'s exact session-simulation convention. Seeded Gym A (monthly + pay-per-session plans), owner/manager/receptionist/coach/member-role sessions, Gym B (cross-tenant), a grace_period member, an expired pay-per-session member, a deactivated member, and a zero-subscription member.
  - [x] Owner/manager/receptionist `lives_ok` renewal assertions (receptionist is the new capability).
  - [x] Coach/member-role/cross-tenant `throws_like '%permission denied%'` assertions.
  - [x] Field-level assertions on the new row (`status`, `start_date`, `expiry_date`) and the untouched prior row.
  - [x] Same-`plan_id`-reused assertion.
  - [x] Pay-per-session `expiry_date is null` assertion.
  - [x] "Most recent subscription" ordering assertion.
  - [x] `audit_log` row assertion (`action_type`, `target_entity_id`, `metadata->>'reason'`).
  - [x] Empty-reason and whitespace-only-reason `throws_like` assertions (direct SQL call, bypassing the TS Zod layer).
  - [x] Deactivated-member, zero-subscription-member, and nonexistent-member `throws_like` assertions.
  - [x] Discovered and fixed a test-only issue: `now()` is frozen for the whole pgTAP transaction, so a same-transaction fixture row and a newly-inserted renewal row tied on `created_at`, making "most recent" ordering ambiguous. Fixed by explicitly backdating the three pre-existing fixture subscription rows' `created_at` by 1 day (documented inline in the test file) — a test-harness-only concern, not a production one, since real renewals each occur in their own transaction.

- [x] **Task 4: Fix `deactivateMember`'s subscription UPDATE to scope to the current row only** (Scope Note #4)
  - [x] Replaced the blanket UPDATE with a `SELECT id ... ORDER BY created_at DESC LIMIT 1` lookup followed by an `UPDATE ... WHERE id = <that id>`, mirroring the existing "most recent" read pattern. Factored the existing compensating-rollback logic into a small local `rollbackDeactivation()` closure (was duplicated once before, now covers both the new SELECT-failure path and the existing UPDATE-failure path without repeating the 6-line rollback block twice). A member with zero subscription rows is tolerated as a no-op, preserving the original code's own implicit "0 rows matched" tolerance.
  - [x] No automated test exists for this (application-layer only, no RLS change) — verified hands-on in Task 5.

- [x] **Task 5: Validation and manual verification**
  - [x] `pnpm run typecheck` (4/4 packages) — 0 errors.
  - [x] `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] Hands-on (independent of pgTAP, via `docker exec ... psql`): seeded a receptionist session and an expired member, called `renew_subscription()` directly, confirmed the new `active` row (`start_date`/`expiry_date` correct), the untouched prior `expired` row, and the exact `audit_log` metadata (`reason`, `plan_id`, `new_expiry_date`, `subscription_id`) — see Debug Log.
  - [x] Hands-on: exercised Task 4's fixed SELECT-then-UPDATE-by-id sequence directly against a two-row fixture (older `grace_period` row, newer `active` row) — confirmed only the newer row flipped to `expired`, the older row stayed `grace_period` — see Debug Log.
  - [x] `supabase test db` — 264/264 passing (243 baseline from Story 3.1 + 21 new in `manual_renewal_reset.test.sql`), zero regressions.
  - [x] Role enumeration confirmed via pgTAP: only `owner`/`manager`/`receptionist` can reach `renew_subscription()` — `coach`, `member`, and cross-gym `owner` are all denied.

### Review Findings

- [x] [Review][Defer] Race condition between `deactivateMember`'s SELECT-then-UPDATE and a concurrent `renew_subscription()` call [apps/dashboard/services/members.ts:698-720] — deferred: low-probability, no AC requires it; requires two staff acting on the same member within a sub-second window, and matches this story's own accepted no-concurrency-guard precedent. `deactivateMember` reads the member's most-recent subscription id, then updates that specific row to `expired` in a separate statement; if `renew_subscription()` inserts a newer `active` row for the same member in between, the UPDATE still succeeds against the now-stale id, leaving the member `deactivated_at` set while their actual most-recent subscription row remains `active`.
- [x] [Review][Defer] Two different "member not found" error codes/copy now exist [apps/dashboard/services/members.ts, packages/types/src/errors.ts] — deferred: different layers, not one inconsistent call site; local service-guard helper vs. shared RPC-exception mapper are legitimately separate, no single call site produces conflicting output today. The pre-existing `memberNotFoundError()` helper returns `code: "not_found"` with `members.errors.memberNotFound`, while this story's new `mapSupabaseError` mapping for `renew_subscription()`'s raise returns `code: "member_not_found"` with the new shared `errors.memberNotFound` key.
- [x] [Review][Patch] Cross-tenant member-existence enumeration in `renew_subscription()` [supabase/migrations/0022_manual_renewal_reset.sql:93-101] — the member lookup isn't gym-scoped, and the function raises a distinct `member % not found` for a truly-missing id vs. a generic `permission denied` for a valid id belonging to another gym, letting a caller distinguish "exists in some other gym" from "doesn't exist at all." Inconsistent with this codebase's own established philosophy elsewhere (0002/0007/0008 migrations) of keeping denied-vs-missing failure modes uniform to avoid exactly this kind of enumeration. Fixed: folded the gym match into the lookup's own `WHERE` clause so a cross-gym member id now produces the same "not found" exception as a nonexistent one; updated the corresponding pgTAP assertion (cross-tenant case) to expect `%not found%` instead of `%permission denied%`.
- [x] [Review][Patch] Unbounded `reason` length [packages/types/src/schemas/subscription.ts:16] — `renewSubscriptionSchema`'s `reason` field has `.min(REASON_MIN_LENGTH)` but no `.max()`, so an arbitrarily large string is persisted verbatim into `audit_log.metadata` jsonb via `renew_subscription()`'s `log_audit_event` call. Fixed: added `.max(REASON_MAX_LENGTH, ...)` with `REASON_MAX_LENGTH = 200`, matching `member.ts`'s `emergencyContactSchema`'s 200-char cap for a similar free-text field.
- [x] [Review][Defer] Nondeterministic "most recent subscription" tie-break on identical `created_at` [supabase/migrations/0022_manual_renewal_reset.sql, apps/dashboard/services/members.ts] — deferred, pre-existing. Both the new `renew_subscription()` plan_id lookup and `deactivateMember`'s new lookup order solely by `created_at` with no secondary tie-breaker; this mirrors an already-established "most recent" read pattern elsewhere in `members.ts`. Real but extremely low-probability in production (each renewal is its own transaction with microsecond-resolution timestamps) — the story's own pgTAP suite had to deliberately backdate fixture rows to avoid tying within a single frozen-`now()` test transaction, which is a test-harness-only concern per the story's own Debug Log.
- [x] [Review][Defer] `deactivateMember`'s subscription UPDATE assumes the looked-up row still exists [apps/dashboard/services/members.ts:686-720] — deferred, pre-existing. No current code path deletes `subscriptions` rows, so the SELECT-then-UPDATE-by-id sequence's implicit assumption that the row found by the SELECT still exists at UPDATE time isn't reachable today; worth revisiting if a future story ever adds subscription deletion.

## Dev Notes

- **Renewal is insert-only, never update-in-place** — this is the single most important design decision in this story (Scope Note #3). Every other task follows from it, including the `deactivateMember` fix (Task 4), which is a real, newly-introduced-by-this-story bug if skipped.
- **No dashboard UI in this story** (Scope Note #1) — mirrors Story 3.1's precedent exactly. `apps/dashboard/services/subscriptions.ts` and `packages/types/src/schemas/subscription.ts` are built now so Epic 4 Stories 4.7/4.8 can consume them directly without re-deriving this story's logic; no `actions.ts`, no route, no component.
- **No `payments` row, no front-desk alert dismissal** (Scope Note #2) — both are genuinely out of scope until Epic 4 exists; don't build placeholders or stubs for either.
- **`renew_subscription()` is `SECURITY DEFINER` with a self-enforced role+tenant check**, not a widened RLS policy (Scope Note #5) — keeps Receptionist's write capability narrowly scoped to this one controlled function, consistent with `enforce_member_cap()`/`platform_metrics()`/`super_admin_job_failures()`'s established pattern in this codebase.
- **Deactivated members cannot be renewed** — a deliberate guard (Scope Note #5's function body) preventing an inconsistent state where `members.deactivated_at` is set but `subscriptions.status = 'active'`. There is no "reactivate member" feature anywhere in this codebase (confirmed: no `reactivateMember` function exists) — deactivation is one-way in V1, and this story does not change that.
- **Timezone arithmetic uses the DB session default (UTC), not per-gym `timezone`** — an accepted simplification, consistent with Story 3.1's own identical, already-documented decision. Do not "fix" this as part of this story.
- **`renew_subscription()` does not reject a caller renewing an already-`active` member** — no AC restricts it to non-active members only, and a gym may legitimately want to let someone renew early. Don't add a status guard that isn't asked for.
- **No double-submit/concurrency guard** — matches `architecture.md`'s own "Retries" convention (no automatic retry on mutations; user-initiated only, mitigated at the UI submit-button layer) and Story 3.1's identical precedent (no advisory lock). Not reachable in this story anyway since no UI exists yet to double-click; Epic 4's future panel owns that mitigation, not this function.
- Epic 2 retrospective (`epic-2-retro-2026-07-18.md`) Decision 4 and Story 3.1's own precedent both confirm `plans.duration_days` is populated and reliable for every non-pay-per-session plan — this story can rely on it without re-verifying.

### Project Structure Notes

New files:
```
supabase/migrations/0022_manual_renewal_reset.sql   # renew_subscription()
supabase/tests/manual_renewal_reset.test.sql        # pgTAP
packages/types/src/schemas/subscription.ts          # renewSubscriptionSchema
apps/dashboard/services/subscriptions.ts            # renewSubscription()
```

Modified files:
```
packages/types/src/index.ts                # + export * from "./schemas/subscription"
packages/types/src/errors.ts                # + memberNotFound/memberDeactivated mappings
packages/types/src/locales/en.json          # + errors.memberNotFound, errors.memberDeactivated
packages/types/src/locales/fr.json          # + errors.memberNotFound, errors.memberDeactivated
apps/dashboard/services/members.ts          # deactivateMember: scope subscription UPDATE to current row only
```

No changes to `apps/super-admin`, `apps/mobile`, or any `apps/dashboard/app/` route — this story is entirely a new migration, a new service/schema pair, error-mapping additions, and one targeted bugfix in an existing service file.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — literal AC wording
- [Source: _bmad-output/implementation-artifacts/3-1-subscription-lifecycle-cron-job.md] — `SECURITY DEFINER` self-check pattern precedent, backend-only-story precedent (Scope Note #1), audit-log-on-failure pattern, accepted-timezone-simplification precedent
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — the exact entry tying `deactivateMember`'s subscription UPDATE gap to this story ("revisit when Story 3.2's renewal work introduces subscription history/multiple rows per member")
- [Source: _bmad-output/planning-artifacts/architecture.md#Entity Relationships] — `members (1) ──< subscriptions # a member's plan history over time`, `payments (0..1) ──> subscriptions` — the data-model basis for Scope Note #3
- [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples] — the `renewSubscription`/`renew_subscription()` naming and `{ data, error }` shape this story's TS wrapper follows
- [Source: supabase/migrations/0004_subscriptions_and_plans.sql] — `subscriptions`/`plans` base schema
- [Source: supabase/migrations/0018_member_management.sql] — `manager_or_owner_insert_own_subscriptions` (left unmodified, Scope Note #5), `enforce_subscription_expiry_matches_plan_type` trigger this story's INSERT must satisfy, `enforce_member_cap()`'s `SECURITY DEFINER` self-check precedent
- [Source: supabase/migrations/0007_audit_log.sql] — `log_audit_event()`, called from inside `renew_subscription()`
- [Source: supabase/migrations/0011_super_admin_tier_gym_lifecycle.sql, 0021_subscription_lifecycle_cron.sql] — `platform_metrics()`/`super_admin_job_failures()`'s exact `SECURITY DEFINER` guard-then-grant shape this story's function copies
- [Source: apps/dashboard/services/members.ts] — `insertSubscription`'s return-shape precedent; the "most recent subscription" `.order(...).limit(1, ...)` read pattern (~lines 219-220, 756-757) this story's design relies on and Task 4 mirrors; `deactivateMember`'s bug this story fixes (~line 667)
- [Source: packages/types/src/schemas/member.ts#editMemberSchema] — the comment explicitly deferring renewal/lifecycle fields to "Story 3.2's job"
- [Source: packages/types/src/schemas/gym.ts, member.ts] — `REASON_MIN_LENGTH = 5` per-file-const convention this story's new schema follows
- [Source: packages/types/src/errors.ts] — `mapSupabaseError`'s message-matching convention this story's two new mappings follow
- [Source: supabase/tests/member_management_rls.test.sql] — session-simulation (`set_config('request.jwt.claims', ...)`) convention this story's pgTAP file follows

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` (local Docker via WSL, container `supabase_db_gym_os`) — migrations 0001–0022 apply cleanly.
- `supabase test db` — 264/264 passing (243 baseline + 21 new in `manual_renewal_reset.test.sql`), zero regressions.
- First test run of the new file failed 3/21 assertions (the field-level checks on the new row's `status`/`start_date`/`expiry_date`) because `now()` is frozen for the entire pgTAP transaction — a same-transaction fixture row and the newly-inserted renewal row tied on `created_at`, so `order by created_at desc limit 1` resolved ambiguously and returned the older row. Fixed by explicitly backdating the three pre-existing fixture subscription rows' `created_at` by `interval '1 day'` (documented inline in the test file). Re-ran: 264/264 passing.
- Hands-on (`docker exec -i supabase_db_gym_os psql -U postgres -d postgres`, rolled-back transaction, independent of pgTAP): seeded a Gym/plan/receptionist/expired-member fixture, simulated a receptionist session via `set_config('request.jwt.claims', ...)`, called `select renew_subscription(...)`. Confirmed: new row `status = active`, `start_date = 2026-07-18` (today), `expiry_date = 2026-08-17` (today + 30); prior row untouched (`status = expired`, unchanged dates); `audit_log` row with `action_type = 'subscription_manual_renewal'` and `metadata` containing the exact `reason`, `plan_id`, `new_expiry_date`, and `subscription_id`.
- Hands-on (same session technique, separate rolled-back transaction): seeded a two-row subscription fixture (older `grace_period` row backdated 1 day, newer `active` row at "now") and ran the exact SELECT-then-UPDATE-by-id sequence `deactivateMember`'s fix now issues. Confirmed only the newer row flipped to `expired`; the older row remained `grace_period`, untouched — proves Task 4's fix behaves correctly (this path has no automated pgTAP coverage of its own, since it's a plain application-layer query-scoping fix with no RLS/trigger involvement).
- `pnpm run typecheck`: 4/4 packages pass, 0 errors. `node scripts/check-i18n-key-parity.mjs`: 4/4 locale dirs in parity (`packages/types/src/locales` now 58 keys, up from 56).

### Completion Notes List

- Both ACs implemented: AC #1 (non-active member → `active` with a new expiry based on plan duration) via `renew_subscription()`'s core INSERT logic; AC #2's "front-desk alert dismisses"/"appears in payment history" clauses are satisfied vacuously by design (Scope Note #2) — neither mechanism exists yet (both are Epic 4's job), and nothing here blocks that future integration.
- Followed Scope Note #3 exactly: renewal is insert-only (a new `subscriptions` row per renewal), never an UPDATE of the member's existing row — verified hands-on that historical rows survive renewal untouched.
- Followed Scope Note #5 exactly: `renew_subscription()` is `SECURITY DEFINER` with a self-enforced role (`owner`/`manager`/`receptionist`) + tenant check, not a widened RLS policy — `manager_or_owner_insert_own_subscriptions` was left unmodified, confirmed via `supabase test db`'s zero regressions on `member_management_rls.test.sql`.
- Task 4's `deactivateMember` fix closes the real bug Scope Note #4 predicted this story's own change would introduce (a member renewed while in `grace_period`, then later deactivated, would previously have had that already-accurate historical row silently rewritten to `expired`) — confirmed fixed via the hands-on SQL sequence check (Debug Log).
- No dashboard UI was built (Scope Note #1) — this story's only surfaces are a new migration, a new service/schema pair, error-mapping additions, and the `deactivateMember` bugfix, exactly as scoped. `apps/dashboard/services/subscriptions.ts` and `packages/types/src/schemas/subscription.ts` are ready for Epic 4 Stories 4.7/4.8 to import directly.
- One implementation deviation from the story draft, both self-corrected during implementation: `renewSubscriptionSchema`'s `memberId` field uses `z.uuid()` (this codebase's actual Zod v4 top-level syntax, confirmed via `gym.ts`/`member.ts`) rather than the `.string().uuid()` form sketched in the story text.

### File List

**New:**
- `supabase/migrations/0022_manual_renewal_reset.sql`
- `supabase/tests/manual_renewal_reset.test.sql`
- `packages/types/src/schemas/subscription.ts`
- `apps/dashboard/services/subscriptions.ts`

**Modified:**
- `packages/types/src/index.ts` (+ `export * from "./schemas/subscription"`)
- `packages/types/src/errors.ts` (+ `member_not_found`/`member_deactivated` mappings in `mapSupabaseError`)
- `packages/types/src/locales/en.json` (+ `errors.memberNotFound`, `errors.memberDeactivated`)
- `packages/types/src/locales/fr.json` (+ `errors.memberNotFound`, `errors.memberDeactivated`)
- `apps/dashboard/services/members.ts` (`deactivateMember`: scope the subscription UPDATE to the current/most-recent row only, via a new `SELECT ... ORDER BY created_at DESC LIMIT 1` lookup + a shared `rollbackDeactivation()` closure)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)

## Change Log

- 2026-07-18: Story implemented. New migration `0022_manual_renewal_reset.sql` adds `renew_subscription(p_member_id, p_reason)` — a `SECURITY DEFINER` RPC that self-checks the caller's role (`owner`/`manager`/`receptionist`) and gym match, then INSERTs a new `active` `subscriptions` row (renewal-as-history, never mutating the member's existing row) with `expiry_date` computed from the plan's `duration_days`, and writes an `audit_log` entry via `log_audit_event()`. Guards against renewing a deactivated member or a member with no existing subscription, and against an empty/whitespace reason. New service layer `apps/dashboard/services/subscriptions.ts` + shared Zod schema `packages/types/src/schemas/subscription.ts` (no Server Action/UI in this story — backend-only, mirroring Story 3.1's precedent; Epic 4 Stories 4.7/4.8 will consume these directly). Two new `mapSupabaseError` mappings + EN/FR locale keys for the member-not-found/member-deactivated cases. Fixed a real bug in `deactivateMember` (`apps/dashboard/services/members.ts`) that this story's insert-only data model exposed: its subscription UPDATE previously matched every historical row for a member instead of just the current one, which would have silently rewritten prior renewal history on a later deactivation — now scoped via a `SELECT ... ORDER BY created_at DESC LIMIT 1` lookup. New pgTAP suite `manual_renewal_reset.test.sql` (21 assertions) covers role gating (including the new receptionist capability), cross-tenant denial, field-level renewal correctness, history preservation, pay-per-session compatibility, and all four guard-raise paths. `supabase test db`: 264/264 passing (243 baseline + 21 new), zero regressions. `pnpm run typecheck` (4/4 packages) and i18n-parity clean. Both hands-on verifications (direct RPC call via `docker exec psql`, and the `deactivateMember` fix's SELECT-then-UPDATE sequence) confirmed correct behavior independent of pgTAP. Status set to `review`.
