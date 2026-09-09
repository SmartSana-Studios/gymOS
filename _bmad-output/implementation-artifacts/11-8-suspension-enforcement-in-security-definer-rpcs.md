---
baseline_commit: c9249b73d065d351944b6eacac47ad012b61d34e
---

# Story 11.8: Suspension Enforcement Inside SECURITY DEFINER RPCs

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS,
I want a suspended gym's write-RPCs to refuse just as its direct table access already does,
so that NFR-018's "denied at the authorization layer, not only the UI" is actually true for every write path, not only the ones that happen to go through RLS.

### The gap, precisely

Story 11.4 shipped `tenant_active_gate` — an `AS RESTRICTIVE ... FOR ALL` policy carrying
`private.current_gym_status() = 'active' or private.is_super_admin()`, applied to every gym-scoped operational table. For direct table reads and writes it works, and 32 pgTAP assertions prove it.

**It does not apply inside `SECURITY DEFINER` functions.** Those execute as the function owner, and RLS does not apply to a table's owner unless the table sets `FORCE ROW LEVEL SECURITY` — **no table in this schema does** (verified: zero occurrences). So today, on a fully suspended gym, a member can still check in, book and cancel classes, and start a payment; staff can still renew subscriptions, create and edit classes, assign coaches, write session notes, and create, edit or deactivate staff. The dashboard and mobile app hide these actions behind the suspended screen, which is exactly the "hidden by the UI" state NFR-018 explicitly rejects — anything speaking to PostgREST directly gets straight through.

This was found in Story 11.4's own code review, judged too large to patch in-session, and deferred with an explicit recommendation to open this story before claiming NFR-018 compliance. `deferred-work.md` carries it as the only **HIGH SEVERITY** open item.

### This is unfinished AD-3, not new scope

AD-3 already binds "every RLS policy *and every `SECURITY DEFINER` function* that gates on role or gym status" and names `private.current_gym_status()` as the mechanism [Source: epics.md:271, ARCHITECTURE-SPINE.md:43-45]. Story 11.4 delivered the RLS half. This story delivers the function half. No new tables, no new billing logic, no new UI.

## Acceptance Criteria

1. **Given** a gym whose `status` is `suspended` or `deactivated`, **when** a member or staff session calls any of the 18 in-scope RPCs listed in Dev Notes §B, **then** the call raises and writes nothing — regardless of the caller's role or of what the client UI allows.
2. **Given** the same gym, **when** any RPC on the §C exclusion list is called, **then** it still succeeds — the Owner's payment escape valve, the Super Admin's recovery and escalation paths, the auth hook, the gym switcher, the webhook completion paths and the cron jobs must all keep working, or a suspended gym becomes permanently unrecoverable.
3. **Given** a gym returned to `active`, **when** the same previously-denied session retries, **then** the call succeeds on the very next statement, with no re-login and no token refresh (symmetry with 11.4's reversal behaviour).
4. **Given** a **member** who triggers one of these denials, **when** the app surfaces the error, **then** the message is the neutral "GymOS is temporarily unavailable for this gym. Please check back later." — it must never mention billing, payment, subscription, or an amount owed [Source: EXPERIENCE.md:255, FR-132].
5. **Given** a session whose JWT carries no `gym_id` claim, **when** it calls an in-scope RPC, **then** it is denied — the check must fail closed (see the NULL trap in Dev Notes §D; this is the single most likely way to ship this story broken).
6. **Given** a future RPC added to this codebase that writes a gated table without a status check, **when** the pgTAP suite runs, **then** it fails — the audit in this story is a snapshot and rots without an automated guardrail.
7. Full regression stays green: the entire pgTAP suite, `pnpm run typecheck`, dashboard lint and tests, `pnpm run check:i18n` parity.

## Tasks / Subtasks

- [x] **Task 1 — Migration `0090`: add the status check to the 18 in-scope RPCs (AC #1, #2, #5)**
  - [x] Create `supabase/migrations/0090_suspension_enforcement_in_rpcs.sql`
  - [x] For each function in §B, `create or replace` it from its **current** definition (§B names the file holding it — many were redefined by later migrations; copying an older body silently reverts fixes)
  - [x] Insert the §D guard immediately after the existing role/`private.gym_id()` checks and **before any write**
  - [x] Use `is distinct from 'active'` — never `<> 'active'` (§D explains why `<>` fails open)
  - [x] Do NOT touch any function on the §C exclusion list
  - [x] Add a header comment naming this story and why `FORCE ROW LEVEL SECURITY` was rejected (§E)
- [x] **Task 2 — Neutral member-facing error (AC #4)**
  - [x] Add a `gym_suspended` branch to `mapSupabaseError()` in `packages/types/src/errors.ts`, matching on `message.includes(": gym ")` + `message.includes("is not active")`
  - [x] Add the `errors.gymSuspended` key to `packages/types/src/locales/en.json` and `fr.json`, reusing EXPERIENCE.md:255's exact member-facing sentence
  - [x] Verify no billing/payment wording reaches a member surface
- [x] **Task 3 — pgTAP: prove the denial (AC #1, #2, #3, #5)**
  - [x] Extend `supabase/tests/tenant_suspension_enforcement.test.sql` with a new section: one `throws_like(..., '%is not active%', ...)` per in-scope RPC, under a suspended gym
  - [x] Assert the same calls still succeed once the gym is `active` (AC #3, no reconnect — mirror the existing Section F reversal assertion)
  - [x] Assert every §C exclusion still succeeds while suspended (AC #2) — this is the half that prevents a permanent lockout
  - [x] Assert a claim-less session is denied (AC #5)
  - [x] Bump `plan(N)` to the new count
- [x] **Task 4 — Automated guardrail so this audit cannot rot (AC #6)**
  - [x] Add a pgTAP meta-test (new file `supabase/tests/suspension_rpc_coverage.test.sql`) that introspects `pg_proc` for every `security definer` function whose body writes any of the 18 gated tables, and asserts each either calls `private.current_gym_status()` or appears in an explicit, commented exclusion array inside the test
  - [x] Seed the exclusion array from §C, with the reason inline per entry
  - [x] Confirm it FAILS if the check is removed from one function (prove the guardrail, don't assume it)
- [x] **Task 5 — Regression and evidence (AC #7)**
  - [x] Full pgTAP suite on a fresh `db reset`; `pnpm run typecheck`; dashboard lint + tests; `pnpm run check:i18n`
  - [x] `packages/types/src/database.ts`: regenerate only if RPC signatures changed — they should not (bodies only). Verify with the table/function-name set comparison this project always uses; state the result either way
  - [x] Live check: with a locally suspended gym, confirm a member check-in RPC is refused and the member sees the neutral message
  - [x] Add a `docs/decisions.md` entry recording that RPC-level gating (not `FORCE ROW LEVEL SECURITY`) is the chosen mechanism
  - [x] Strike the HIGH-severity entry in `deferred-work.md` as resolved

### Review Findings

Adversarial code review, 2026-09-09. Three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor), 35 raw findings → 22 after dedup and triage. Each location below was re-read in source before rating; severities are this review's, not the layers'.

**Verified clean and not re-litigated:** all 18 bodies are byte-identical to their prior definitions plus exactly the 5-line guard (`del=0, add=5` for every one — no stale body reintroduced, no signature change); the 18 gated functions equal §B exactly; every §C exclusion is genuinely ungated on the live schema, `log_audit_event` included; `is distinct from` is used in all 18 and precedes the first write in all 18; `plan(64)` and `plan(4)` match their real assertion counts; the "Must NOT be modified" list was respected; the dashboard test-location deviation is justified.

All four `decision-needed` findings were resolved during the review (2026-09-09); the rationale for each is recorded inline below, and the resulting work is folded into the patch list.

- [x] [Review][Patch] **`check_in`'s idempotent-replay short-circuit now sits behind the suspension guard** [supabase/migrations/0090_suspension_enforcement_in_rpcs.sql:424-427 vs :444-463] — **Decided: move the guard below the short-circuit.** 0090 places the guard above member resolution, and therefore above a short-circuit whose own comment states it "must run immediately after `v_member_id` is resolved and before every guard/lock below". That ordering re-opens the trap the comment exists to prevent: a sync retry reaching the open-session lock first sees its own prior successful insert as the blocker and rejects the replay permanently. The short-circuit returns an already-committed row — a read — so AC #1's "raises and writes nothing" is not weakened by moving the guard after it.
- [x] [Review][Defer] **Epic 13's workout-plan tables never received `tenant_active_gate`, so NFR-018 is still not whole** [supabase/migrations/0080_coach_authored_workout_plans.sql:21,42; 0081_member_plan_view_completion_tracking.sql:20] — **Decided: follow-up story, and soften this story's NFR-018 claim.** `workout_plans`, `workout_plan_exercises` and `workout_plan_completions` all carry `gym_id` and have RLS enabled, but no `tenant_active_gate` policy; 0080 and 0082 hold `SECURITY DEFINER` functions writing them, so a coach at a suspended gym can still author and hand off plans — through RLS *and* through the RPCs. The new meta-test cannot see this: `gated_tables` is derived from `pg_policies where policyname = 'tenant_active_gate'` (`suspension_rpc_coverage.test.sql:41-47`), so a table that never received the policy is invisible by construction. Completion Note correction #3 describes this as a future-tense risk; it is present tense in three shipped tables. Gating them means re-running the §B/§C audit for Epic 13 — which coach and handoff paths must survive suspension is a real question — and absorbing that into 11.8 would repeat 11.4's own overreach. Recorded as a new HIGH item in `deferred-work.md`; this story's NFR-018 claim is corrected rather than left to be inherited.
- [x] [Review][Patch] **AC #5's NULL-status coverage reaches 1 of 18 functions** [supabase/tests/tenant_suspension_enforcement.test.sql:365,372] — **Decided: extend G2b across all 18 rather than reword the AC.** The claim-less-session assertion is satisfied by each function's *pre-existing* `gym_id is null` check raising `permission denied` — it passes identically against 0089, so it is not evidence for this story. G2b (an unresolvable `gym_id` claim, which does reach the new guard) is the only assertion in the suite that would catch a regression from `is distinct from` back to `<>`, and it drives `check_in` alone. Extending it to all 18 is cheap and closes the failure mode §D spends thirteen lines warning about.
- [x] [Review][Dismiss] **A `deactivated` gym's members are told to "check back later"** — **Decided: keep one neutral message for both states; no code change.** Distinguishing "permanently closed" from "temporarily unavailable" tells a member something about the gym's commercial standing, which is the spirit of what FR-132 forbids, and invites exactly the "why?" the neutral copy exists to avoid. EXPERIENCE.md:255 specifies one sentence for this state and the implementation matches it verbatim in both locales.
- [x] [Review][Patch] **Suspension error permanently deletes queued offline check-ins captured while the gym was active** [apps/mobile/src/services/checkin.ts:129-137]
- [x] [Review][Patch] **AC #4 is undelivered on the only member-facing surface — mobile never calls `mapSupabaseError`** [apps/mobile/src/services/{checkin,classes,payments}.ts, apps/mobile/src/locales/{en,fr}.json]
- [x] [Review][Patch] **Migration's `v_must_not_gate` asserts 13 of 19 exclusions, omitting every `private`-schema one** [supabase/migrations/0090_suspension_enforcement_in_rpcs.sql:1656-1670]
- [x] [Review][Patch] **Both guardrails substring-match `current_gym_status`, so a fail-open `<>` regression passes; exclusion join is schema- and overload-blind** [supabase/tests/suspension_rpc_coverage.test.sql:63,138,152-153; 0090:1679]
- [x] [Review][Patch] **No RPC assertion is ever run against a `deactivated` gym, though the migration header claims both statuses are blocked** [supabase/tests/tenant_suspension_enforcement.test.sql:295-341; 0090:49]
- [x] [Review][Patch] **Section G's stated placement rationale is false for 16 of 18 calls — guard placement is untested** [supabase/tests/tenant_suspension_enforcement.test.sql:288-293]
- [x] [Review][Patch] **Task 3's "assert every §C exclusion still succeeds" covers 8-10 of 19; no cron path is exercised, and `complete_flagged_payment` — premise correction #1's own subject — has no test** [supabase/tests/tenant_suspension_enforcement.test.sql:374-461]
- [x] [Review][Patch] **Section I (the AC #3 reversal assertions) runs as the unrestricted setup role, not `authenticated`** [supabase/tests/tenant_suspension_enforcement.test.sql:489-524]
- [x] [Review][Patch] **Guard precedes the role check in the three staff RPCs, contradicting §D and three artifacts that claim otherwise** [supabase/migrations/0090_suspension_enforcement_in_rpcs.sql:885-888,1020-1023,1561-1564]
- [x] [Review][Patch] **Section H's "every one of them writes a gated table" is false for 9 of 19 exclusions, making those entries inert in both assertions** [supabase/tests/tenant_suspension_enforcement.test.sql:379-381]
- [x] [Review][Patch] **The dynamic-SQL pin fires on the word "execute" appearing in any comment, with a message that misdirects the reader** [supabase/tests/suspension_rpc_coverage.test.sql:167-178]
- [x] [Review][Patch] **Nothing pins the SQL raise text to the TS matcher, and no negative case exercises a string containing both substrings** [packages/types/src/errors.ts:198; apps/dashboard/lib/errors.gymSuspended.test.ts:91-99]
- [x] [Review][Patch] **Completion Notes' lint claim is dashboard-scoped but reads repo-wide — mobile adds 31 warnings** [11-8-suspension-enforcement-in-security-definer-rpcs.md, Verification paragraph]
- [x] [Review][Defer] **`log_audit_event` is granted to `authenticated` and writes the gated `audit_log` at a suspended gym** [supabase/migrations/0007_audit_log.sql:226-227] — deferred, pre-existing
- [x] [Review][Defer] **The meta-test cannot see a secdef RPC that delegates its write to a non-secdef helper** [supabase/tests/suspension_rpc_coverage.test.sql:66] — deferred, pre-existing
- [x] [Review][Defer] **TOCTOU: a gym suspended between the guard's read and the RPC's commit still lets one in-flight write land** [supabase/migrations/0090_suspension_enforcement_in_rpcs.sql:425-427 and the other 17] — deferred, pre-existing
- [x] [Review][Defer] **Gating `check_out` strands open attendance sessions until the auto-timeout cron closes them** [supabase/migrations/0090_suspension_enforcement_in_rpcs.sql, `check_out`] — deferred, pre-existing

## Dev Notes

### §A — The gate as actually shipped (verify, don't assume)

- **18 tables, not 17.** 0073 gates 17 (`members`, `payments`, `subscriptions`, `refunds`, `attendance_events`, `plans`, `classes`, `class_sessions`, `class_bookings`, `progress_entries`, `progress_photos`, `coach_assignments`, `member_preferences`, `session_notes`, `front_desk_alerts`, `audit_log`, `payment_discrepancies`) and **`0084_notification_history.sql:54` later added the same policy to `public.notifications`**. The deferred-work note and 11.4's own record both say 17. Any grep of 0073 alone misses the 18th.
- Policy is byte-identical everywhere: `as restrictive for all using (private.current_gym_status() = 'active' or private.is_super_admin()) with check (same)`.
- `private.current_gym_status()` [`0063_staff_edit_deactivation.sql:19-35`] is `stable security definer`, returns the `gym_status` enum, and reads **the caller's own claimed gym** via `private.gym_id()` — never the target row's `gym_id`. Every in-scope RPC already scopes itself to `private.gym_id()`, so the semantics line up; this is why the §C functions that resolve a gym from a *parameter* or a *row* are excluded rather than gated.
- Allowed: `'active'` only. Both `suspended` and `deactivated` are blocked — deliberate and user-confirmed in 11.4 [0073:49-60].
- **Zero `SECURITY DEFINER` functions currently call `current_gym_status()`.** There is no in-function precedent to copy; §D is the pattern to establish.

### §B — In scope: add the guard to exactly these 18

Each row gives the file holding the **current** definition. Where "redefined" is noted, earlier migrations contain stale bodies — do not copy those.

| # | Function | Current definition | Redefined? | Gated writes |
|---|---|---|---|---|
| 1 | `check_in(timestamptz, uuid)` | `0034_real_time_front_desk_alert.sql:119` | yes (0023→0027→0028→0034) | `attendance_events`, `front_desk_alerts` |
| 2 | `check_out()` | `0024_check_out_manual_auto_timeout.sql:88` | no | `attendance_events` |
| 3 | `check_out_member(uuid)` | `0024_check_out_manual_auto_timeout.sql:152` | no | `attendance_events` |
| 4 | `confirm_renewal(uuid, text, text, boolean)` | `0037_subscriptions_page_manual_renewal.sql:62` | yes (0035, 0036 dropped) | `subscriptions`, `payments` |
| 5 | `renew_subscription(uuid, text)` | `0022_manual_renewal_reset.sql:72` | no | `subscriptions` |
| 6 | `initiate_member_payment()` | `0055_member_self_service_renewal.sql:30` | no | `payments` |
| 7 | `create_staff_member(uuid, text, text, member_role)` | `0064_multi_gym_staff_binding_rules.sql:21` | yes (0061→0064) | `members` |
| 8 | `update_staff_role(uuid, text, member_role)` | `0064_multi_gym_staff_binding_rules.sql:176` | yes (0063→0064) | `members` |
| 9 | `deactivate_staff_member(uuid, text)` | `0063_staff_edit_deactivation.sql:181` | no | `members` |
| 10 | `create_class(9 params)` | `0057_class_creation_scheduling.sql:324` | no | `classes`, `class_sessions` |
| 11 | `update_class(10 params)` | `0058_class_booking_with_capacity_enforcement.sql:352` | yes (0057→0058) | `classes`, `class_sessions` |
| 12 | `materialize_class_sessions(uuid, boolean)` | `0058_class_booking_with_capacity_enforcement.sql:305` | yes (0057→0058) | `class_sessions` |
| 13 | `book_class_session(uuid)` | `0058_class_booking_with_capacity_enforcement.sql:102` | no | `class_bookings` |
| 14 | `cancel_class_booking(uuid)` | `0058_class_booking_with_capacity_enforcement.sql:216` | no | `class_bookings` |
| 15 | `mark_class_attendance(uuid)` | `0068_class_attendance_marking.sql:52` | no | `class_bookings`, `front_desk_alerts` |
| 16 | `assign_coach(uuid, uuid)` | `0039_coach_member_assignment.sql:67` | no | `coach_assignments` |
| 17 | `add_session_note(uuid, text)` | `0041_coach_portal_member_detail_session_notes.sql:93` | no | `session_notes` |
| 18 | `edit_session_note(uuid, text)` | `0041_coach_portal_member_detail_session_notes.sql:154` | no | `session_notes` |

### §C — Exclusion list: gating any of these causes a worse bug than the one being fixed

**Gating a recovery path locks a paying customer out permanently.** Each entry states why.

**Owner / Super Admin recovery — the escape valves**
- `update_own_owner_notification_email(text)` [`0072:296`] — writes the **gated** `members` table, so it looks like it belongs in §B. It does not: 11.4's Dev Notes and `0073:73-77` both name it a deliberate escape valve. The Owner must be able to fix the billing-notice address while suspended.
- `initiate_saas_billing_payment(uuid, billing_interval)` [`0077:96`] — the "Pay Now" path. Already rejects `deactivated` and deliberately permits `suspended`.
- `complete_verified_saas_billing_payment(...)` [`0077:195`], `record_out_of_band_saas_billing_payment(uuid)` [`0075:52`], `apply_saas_billing_credit(uuid, integer)` [`0075:113`] — these are what *un*-suspend a gym.
- `escalate_gym_data_access(...)` / `revoke_gym_data_access(...)` [`0086:175`, `:212`] — Super Admin support access must work *because* the gym is suspended.
- `list_own_active_gym_memberships()` [`0074:18`] and `switch_active_gym(uuid)` [`0065:34`] — 0074 exists precisely because the gate blocked the multi-gym switcher; gating them re-breaks Story 11.4's own fix.
- `custom_access_token_hook(jsonb)` [`0065:77`] — must keep minting claims for a suspended gym, or the Owner cannot authenticate to pay [0073:71-73].

**`log_audit_event(...)` [`0063:365`] — the single highest-risk item on this checklist. Do not gate it.**
It inserts into the gated `audit_log` and is called by many other RPCs, including the Super Admin escalation path. Gating it would make every one of those callers fail on a suspended gym, including the recovery paths above. It already validates gym *identity* (`p_gym_id` vs `private.gym_id()`); status is deliberately not its concern.

**Webhook / service_role paths — payment completion must survive suspension**
- `complete_verified_payment(uuid, integer)` [`0030:76`], `complete_flagged_payment(uuid)` [`0048:11`] — `service_role`-granted, resolve their gym from the payment row, never from a caller claim. A member's payment landing after suspension must still reconcile.

**Cron-owned notification helpers** — `private.send_push_notification`, `send_payment_push_notification`, `send_quiet_gym_alert`, `send_class_reminder` [all current in `0084`] write the now-gated `notifications` but run under `service_role` from `run_*_job()`. The two quiet-gym/class-reminder jobs already filter `where gyms.status = 'active'` at source [`0056:498`, `0059:441`].

**Triggers and internal helpers**
- `private.create_default_member_preferences()` [`0047:125`] — an `after insert on members` trigger, reachable only behind `create_staff_member()` (#7). Gating #7 covers it; gating the trigger would also fire on Super-Admin-driven inserts.
- `private.materialize_sessions_for_class(uuid)` [`0057:189`] — `service_role`-granted internal helper reachable by `authenticated` only via #10/#11/#12, all of which this story gates. It is also called directly by `run_class_session_materializer_job()`; gating it would break that cron.
- `private.is_super_admin()`, `private.is_super_admin_live()`, `private.gym_id()`, `private.current_member_role()` — read-only helpers; gating recurses.

**Cron `run_*_job()` functions are not `SECURITY DEFINER` at all** (verified header-by-header) — and they are the machinery that *creates* the suspension. Leave them alone.

### §D — The guard, and the NULL trap that will fail open if missed

Place immediately after the function's existing role / `private.gym_id()` checks, before any write:

```sql
  if private.current_gym_status() is distinct from 'active' then
    raise exception '<fn_name>: gym % is not active', v_gym_id;
  end if;
```

**`is distinct from`, never `<>`.** `current_gym_status()` returns NULL when the session has no `gym_id` claim. In an RLS `USING` clause a NULL result is falsy and therefore fails *closed* — which is what 0073 relies on [0073:62-67]. Inside plpgsql the polarity inverts: `NULL <> 'active'` evaluates to NULL, the `if` does not fire, and the function **proceeds to write**. `is distinct from` returns true for NULL and fails closed. AC #5 exists to catch exactly this, and the idiom is already established here (`0077:116`: `if private.current_member_role() is distinct from 'owner' then`).

Verified empirically against this project's own Postgres during story creation, not reasoned from the docs:

```
declare v gym_status := null;
  v <> 'active'              -> guard DID NOT FIRE -> function proceeds to WRITE (fails OPEN)
  v is distinct from 'active' -> guard FIRED (fails closed)
```

**Error message shape.** This codebase uses no SQLSTATE for authorization or business-rule raises (only two `using errcode` sites exist, both for constraint parity). The dominant convention is `raise exception '<function_name>: <detail>', <arg>;` and the app layer keys on the message text. Keep the `is not active` phrase stable — Task 2's `mapSupabaseError` branch and Task 3's `throws_like` patterns both match on it.

### §E — Why not `FORCE ROW LEVEL SECURITY`

It would fix all 24 bypasses in one line per table and is the tempting shortcut. Reject it: it applies to **every** `SECURITY DEFINER` function touching those tables, including all of §C, so the recovery paths, the webhook completions and `log_audit_event()` would all start failing on a suspended gym — the permanent-lockout outcome AC #2 forbids. It also changes behaviour for the table owner globally, a schema-wide blast radius needing its own audit. 11.4's review reached the same conclusion. Per-function gating is what AD-3 mandates and is surgical and reviewable.

### §F — Testing standards

- pgTAP, `supabase/tests/<snake_case_feature>.test.sql`, `begin; select plan(N); ... select * from finish(); rollback;`. Optional paired `.negative.test.sql` for deny paths.
- Insert fixtures as the unrestricted setup role **before** any `set local role`; then `set local role authenticated;` plus `select set_config('request.jwt.claims', '{"sub":...,"role":"authenticated","gym_id":...,"app_role":"member"}', true);`. `reset role;` between sections. `set local role service_role;` for webhook-only RPCs. Worked example: `tenant_suspension_enforcement.test.sql:22-58,131-137`.
- Assert raises with **`throws_like(sql, '%is not active%', description)`** — `throws_ok` is not used anywhere in this suite.
- **Trap:** an UPDATE/DELETE blocked only by a missing `USING` policy affects 0 rows *silently* rather than raising [`class_booking_with_capacity_enforcement.negative.test.sql:63-66`]. This story's RPC denials DO raise, so `throws_like` is correct here — but do not copy the 0-row idiom by reflex from neighbouring tests.
- Per-RPC suites worth extending with a suspended case: `check_in_one_open_session_enforcement`, `check_out_manual_auto_timeout`, `subscriptions_page_manual_renewal`, `manual_renewal_reset`, `member_self_service_renewal`, `class_booking_with_capacity_enforcement[.negative]`, `class_creation_scheduling[.negative]`, `class_attendance_marking[.negative]`, `coach_member_assignment`, `coach_portal_member_detail_session_notes`, `staff_creation_role_ceiling_enforcement[.negative]`.
- Suite baseline at Story 11.4 was 1543/1543 across 89 files; re-run on a fresh `db reset`, not incrementally.

### §G — Previous story intelligence (Story 11.4)

- **The part most likely to look done when it isn't**: typecheck, lint and the RLS suite all passed in 11.4 while the Owner's real recovery path was broken. Green checks are not evidence here — exercise a real suspended gym.
- 11.4's live testing lost an hour to a **stale `next dev` process** that had been running since before the code changes; restart dev servers before concluding a fix did not work.
- The `= 'active'` (not `<> 'suspended'`) semantics and the `or private.is_super_admin()` clause were both deliberate, user-confirmed decisions. Preserve them.
- 11.4 re-derived the gated table list against the live schema rather than trusting its own story text, and found two corrections. Do the same here: re-verify §B and §C against the schema before editing.

### §H — Git intelligence

Recent work (`1162c05`, `b04f11f`, `1f93fca`, `0acecb2`) is dashboard/dev-environment only and touches nothing here. The last migration is `0089_repair_members_active_gym_user_index.sql`, so this story takes **`0090`**. Note 0089's own lesson: a migration that assumes an object's shape should assert it rather than trust the name — worth echoing if any `create or replace` here needs a guard.

### Project Structure Notes

- **New:** `supabase/migrations/0090_suspension_enforcement_in_rpcs.sql`; `supabase/tests/suspension_rpc_coverage.test.sql`.
- **Modified:** `supabase/tests/tenant_suspension_enforcement.test.sql` (new section, bumped plan); `packages/types/src/errors.ts`; `packages/types/src/locales/en.json` + `fr.json`; `docs/decisions.md`; `_bmad-output/implementation-artifacts/deferred-work.md` (strike the resolved item).
- **Must NOT be modified:** `0073_tenant_suspension_enforcement.sql` and `0084_notification_history.sql` (the RLS half is correct and shipped); `custom_access_token_hook()`; `private.gym_id()`; any §C function; any `run_*_job()`.
- **Expected unchanged:** `packages/types/src/database.ts` — bodies change, signatures do not.

### References

- [Source: epics.md:241 — NFR-018] · [Source: epics.md:179 — FR-132] · [Source: epics.md:2161-2179 — Story 11.4 ACs]
- [Source: epics.md:271, ARCHITECTURE-SPINE.md:43-45 — AD-3, binds SECURITY DEFINER functions, not just RLS policies]
- [Source: EXPERIENCE.md:255 — member-facing suspension copy and the explicit "never mention billing" rule]
- [Source: 11-4-tenant-suspension-enforcement.md — the deferred HIGH-severity finding and the escape-valve guardrails]
- [Source: docs/decisions.md:252-256 — `AS RESTRICTIVE` introduction; note its admission that `gym_payment_credentials` is ungated *because* access goes through SECURITY DEFINER RPCs — the same structural hole this story closes]
- [Source: deferred-work.md — HIGH SEVERITY entry to strike on completion]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context)

### Debug Log References

- **RED, captured before applying `0090`** (the local DB was still at `0089`, a now-or-never window): the new Section G assertions were run against the unguarded schema. 18 of 18 failed, and the failure *modes* are the vulnerability itself — `check_out()`, `cancel_class_booking()`, `confirm_renewal()`, `renew_subscription()`, `assign_coach()`, `create_class()`, `update_class()`, `materialize_class_sessions()`, `update_staff_role()` and `deactivate_staff_member()` all reported **"no exception thrown"**, i.e. they *succeeded* and wrote to a fully suspended gym. The cascade was visible in the run: `update_staff_role()` and `deactivate_staff_member()` mutated the coach fixture, so the later coach RPCs then failed with "caller is not a coach in this gym" rather than the expected message. Section G2b also failed as designed.
- **GREEN**: after applying `0090`, the same file returned 64/64.
- **Signature-drift check**: `pg_get_functiondef` for all 18 dumped before and after the migration. The diff is purely additive — 18 × 5 added lines, **zero deletions** — so no stale migration body was reintroduced and no signature or `RETURNS` line changed.
- **Guardrail proven, not assumed** (Task 4's explicit requirement), three ways, each in a rolled-back transaction: (a) restoring `check_in`'s pre-guard body → fails naming `public.check_in`; (b) adding a new ungated `SECURITY DEFINER` function that writes `session_notes` → fails naming `public.record_member_note_v2`; (c) adding a guard to the excluded `apply_saas_billing_credit` → fails naming it. Assertions 1 and 4 stayed green throughout, so the failures were specific rather than the file collapsing.
- **`supabase db reset` worked here**, contrary to the general note that CLI container commands fail silently in this devcontainer — all 90 migrations reapplied and `0090`'s own verification block passed on the way through. One consequence worth knowing: the reset **drops the `pgtap` extension**, so the whole suite errored with `function plan(integer) does not exist` and reported 0 passes until `create extension pgtap` was re-run. That is an environment artifact, not a test failure.
- **Live PostgREST evidence** (not a browser check — manual browser QA stays with the user): a hand-minted member JWT against `POST /rest/v1/rpc/check_in`. Active → `HTTP 200`, row written. Gym suspended, **same unrefreshed JWT** → `HTTP 400`, `{"code":"P0001","message":"check_in: gym … is not active"}`, row count unchanged. Reinstated → the same JWT succeeds on the very next call. Feeding the captured live message through `mapSupabaseError()` returned the neutral copy in both locales. Fixtures were deleted afterwards (verified: 0 gyms, 0 members remain).
- Suspending a gym directly via `update gyms set status='suspended'` **silently no-ops** — `protect_super_admin_only_gym_columns` (a `BEFORE UPDATE` trigger) reverts the column for a non-Super-Admin caller while still reporting `UPDATE 1`. The first live-check attempt was invalid because of this and was redone under Super Admin claims. The pgTAP file sidesteps it by inserting its gyms already suspended.

### Completion Notes List

> **NFR-018 status after code review.** This story closes the `SECURITY DEFINER` half of AD-3 **for the 18 tables carrying `tenant_active_gate`**, and that part is verified. It does **not** make NFR-018 whole: the code review found that Epic 13's `workout_plans`, `workout_plan_exercises` and `workout_plan_completions` never received the gate policy at all, so a coach at a suspended gym can still author and hand off plans — through RLS *and* through Epic 13's own RPCs. That is a HIGH-severity item in `deferred-work.md` awaiting a follow-up story, and `suspension_rpc_coverage.test.sql` now pins the ungated-table set so it cannot grow silently. Do not inherit a blanket "NFR-018 is satisfied" claim from this story.

**What shipped.** `0090_suspension_enforcement_in_rpcs.sql` adds `if private.current_gym_status() is distinct from 'active' then raise exception '<fn>: gym % is not active'` to 18 `SECURITY DEFINER` write-RPCs, placed after each function's existing role/`private.gym_id()` checks and before any lookup, validation or write. This closes the `deferred-work.md` HIGH-severity finding from Story 11.4 and completes AD-3's function half; `0073`'s RLS half is untouched.

**§B and §C were re-verified against the live schema before editing, per §G — and they held exactly.** 28 `SECURITY DEFINER` functions write a gated table: the 18 in §B and precisely the 10 exclusions §C names among them. Zero already carried a status check, and zero tables set `FORCE ROW LEVEL SECURITY`. The 18-table gate list (17 + `public.notifications`) was confirmed from `pg_policies` rather than from `0073`.

**The bodies were generated from `pg_get_functiondef`, not transcribed from migration files.** §B warns that many of these were redefined by later migrations and that copying an older body silently reverts fixes. Reading the current definition out of a database at `0089` and inserting the guard programmatically makes that class of error structurally impossible, and the before/after diff (zero deletions) is the proof.

**Migration is self-asserting.** Echoing `0089`'s lesson, `0090` ends with a `DO` block that fails at apply time if any of the 18 lacks the guard or if any of 13 named recovery paths has acquired one. It passed on the fresh `db reset`.

**Three premise corrections found during implementation**, all recorded in `deferred-work.md` and `docs/decisions.md`:
1. The deferred item lists `complete_flagged_payment()` among the functions needing a gate. It must **not** be gated — it is a `service_role` webhook resolving its gym from the payment row, not a caller claim. §C had this right; the older deferred note did not.
2. The item calls this "the only HIGH SEVERITY open item". It is not: two unrelated HIGH items remain open in `deferred-work.md` (the `findOrCreateUserByPhone()` phone-format bug, and no gym-staff role other than Owner being able to log in). Neither is in scope here; flagging so the claim isn't inherited.
3. The sibling deferred item asking for a table-level anti-rot guardrail is only **partially** addressed. The new meta-test derives the gated-table list from `pg_policies` and pins the count at 18, but a *new* `gym_id`-bearing table created without the policy still passes. Annotated as partially-addressed rather than struck.

**Deviation from Project Structure Notes:** the story listed no app-side test file, but `packages/types` has no test runner at all (no `test` script, no test files), and `mapSupabaseError` is already exercised from the dashboard. The Task 2 coverage therefore lives at `apps/dashboard/lib/errors.gymSuspended.test.ts`, matching where `staff.createStaffMember.test.ts` and `session.switchActiveGym.test.ts` already test this function. It was confirmed genuinely red before the branch existed (19 of 26 failing).

**AC #5 note (revised after code review).** A claim-less session is denied by each function's *pre-existing* `gym_id` null check, which sits in front of the new guard — so it raises `permission denied`, not `is not active`. The case that actually reaches the new guard with a NULL status is a `gym_id` claim pointing at a `gyms` row that does not exist. That was originally asserted for `check_in` alone, leaving 17 of 18 with no NULL-path coverage — and since that assertion is the only thing that catches a regression from `is distinct from` back to `<>`, the story's single most-warned-about failure mode was effectively untested. Section G2 now covers all 18: the 14 whose guard precedes any DB-dependent lookup assert the `is not active` message directly, and the 4 that resolve a member row or role first (`check_in` and the three staff RPCs, by the deliberate placement decisions above) assert that they still fail closed via that earlier step. The mechanical anti-regression check no longer depends on this at all — `suspension_rpc_coverage.test.sql` matches the fail-closed predicate itself, and was proven to fail on a `<>` regression.

**Verification (post-code-review, 2026-09-09).** Full pgTAP: **90 files, 1880/1880, zero failures** — up from 1853, the +27 being 24 new assertions in `tenant_suspension_enforcement` (64 → 88) and 3 in the guardrail meta-test (4 → 7). `pnpm run typecheck` clean across 4 packages. `pnpm run lint` **0 errors, 47 warnings, all pre-existing** — dashboard 15, mobile 31, super-admin 1; the original note below said "15" while describing it as repo-wide, which understated it by 32. Dashboard vitest **36 files / 265 tests**. `check:i18n` in parity across all four bundles (packages/types 85, dashboard 737, super-admin 300, mobile 323 — mobile gained the `common.gymSuspended` key in both locales). `database.ts` still unmodified.

**Superseded original verification note.** Full pgTAP on a fresh `db reset`: **90 files, 1853/1853, zero failures** (§F's 1543 baseline predates several shipped epics; net contribution here is +36 — `tenant_suspension_enforcement` 32 → 64, plus the new 4-assertion guardrail). `pnpm run typecheck` clean across 4 packages. `pnpm run lint` 0 errors (15 pre-existing warnings, none in files touched here). Dashboard vitest 36 files / 263 tests passed, up from 237. `pnpm run check:i18n` in parity (packages/types 85 keys). `database.ts` **not regenerated and not needed**: the signature/`RETURNS` diff for all 18 is identical before and after, and `git status` confirms the file is unmodified.

### File List

**New**
- `supabase/migrations/0090_suspension_enforcement_in_rpcs.sql`
- `supabase/tests/suspension_rpc_coverage.test.sql`
- `apps/dashboard/lib/errors.gymSuspended.test.ts`

**Modified (code review 2026-09-09 added: `apps/mobile/src/services/{checkin,classes,payments}.ts`, `apps/mobile/src/app/(tabs)/checkin.tsx`, `apps/mobile/src/app/(tabs)/classes/index.tsx`, `apps/mobile/src/app/renew.tsx`, `apps/mobile/src/locales/{en,fr}.json`)**
- `supabase/tests/tenant_suspension_enforcement.test.sql` (Sections G, G2, G3, H, I; `plan(32)` → `plan(64)` → `plan(88)`; one `processing` payment fixture; assertion 51 reads back as the unrestricted role, since an Owner session cannot SELECT `audit_log` at a suspended gym)
- `packages/types/src/errors.ts` (`gym_suspended` branch)
- `packages/types/src/locales/en.json` (`errors.gymSuspended`)
- `packages/types/src/locales/fr.json` (`errors.gymSuspended`)
- `docs/decisions.md` (2026-09-09 entry)
- `_bmad-output/implementation-artifacts/deferred-work.md` (HIGH item struck; sibling item annotated partially-addressed)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/11-8-suspension-enforcement-in-security-definer-rpcs.md`

**Verified unchanged** — `packages/types/src/database.ts` (no signature change), `0073_tenant_suspension_enforcement.sql`, `0084_notification_history.sql`, and every §C exclusion function.

## Change Log

- 2026-09-09: create-story — story created, status backlog → ready-for-dev.
- 2026-09-09: code-review — adversarial review, 3 parallel layers, 35 raw findings -> 22 after dedup. 4 decision-needed resolved (guard moved below check_in's replay short-circuit and below the role check in the 3 staff RPCs; Epic 13 workout-plan gate gap deferred as a new HIGH item; NULL-status coverage extended to all 18; one-copy-for-both-statuses upheld). 15 patches applied: mobile offline queue no longer discards queued scans on a suspension raise, AC #4 neutral copy now actually reaches the member on mobile (isGymSuspendedError extracted so one matcher serves both apps), migration self-assertion widened 13 -> 19 exclusions plus a typo guard, guardrail predicate tightened so a fail-open `<>` regression is caught (proven), meta-test gained ungated-table, raise-text and guard-placement assertions, deactivated-gym RPC coverage added, Section I now runs as `authenticated`, and four false comments corrected. pgTAP 90 files 1880/1880, typecheck clean, lint 0 errors, dashboard 265 tests, i18n parity across 4 bundles. Status review -> done.
- 2026-09-09: dev-story — implemented Tasks 1-5. `0090` gates 18 `SECURITY DEFINER` write-RPCs with a `private.current_gym_status() is distinct from 'active'` guard, closing Story 11.4's deferred HIGH-severity NFR-018 gap; 19 recovery/webhook/cron/auth paths deliberately excluded with per-entry reasons. Neutral member-facing copy added (FR-132). pgTAP raised 32 → 64 in `tenant_suspension_enforcement.test.sql` plus a new 4-assertion anti-rot meta-test, with the vulnerability captured red first and the guardrail proven to fail three ways. Full regression green (pgTAP 1853/1853 on a fresh reset, typecheck, lint, 263 dashboard tests, i18n parity). Status in-progress → review.
