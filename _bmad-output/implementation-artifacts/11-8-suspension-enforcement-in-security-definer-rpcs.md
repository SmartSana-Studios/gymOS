# Story 11.8: Suspension Enforcement Inside SECURITY DEFINER RPCs

Status: ready-for-dev

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

- [ ] **Task 1 — Migration `0090`: add the status check to the 18 in-scope RPCs (AC #1, #2, #5)**
  - [ ] Create `supabase/migrations/0090_suspension_enforcement_in_rpcs.sql`
  - [ ] For each function in §B, `create or replace` it from its **current** definition (§B names the file holding it — many were redefined by later migrations; copying an older body silently reverts fixes)
  - [ ] Insert the §D guard immediately after the existing role/`private.gym_id()` checks and **before any write**
  - [ ] Use `is distinct from 'active'` — never `<> 'active'` (§D explains why `<>` fails open)
  - [ ] Do NOT touch any function on the §C exclusion list
  - [ ] Add a header comment naming this story and why `FORCE ROW LEVEL SECURITY` was rejected (§E)
- [ ] **Task 2 — Neutral member-facing error (AC #4)**
  - [ ] Add a `gym_suspended` branch to `mapSupabaseError()` in `packages/types/src/errors.ts`, matching on `message.includes(": gym ")` + `message.includes("is not active")`
  - [ ] Add the `errors.gymSuspended` key to `packages/types/src/locales/en.json` and `fr.json`, reusing EXPERIENCE.md:255's exact member-facing sentence
  - [ ] Verify no billing/payment wording reaches a member surface
- [ ] **Task 3 — pgTAP: prove the denial (AC #1, #2, #3, #5)**
  - [ ] Extend `supabase/tests/tenant_suspension_enforcement.test.sql` with a new section: one `throws_like(..., '%is not active%', ...)` per in-scope RPC, under a suspended gym
  - [ ] Assert the same calls still succeed once the gym is `active` (AC #3, no reconnect — mirror the existing Section F reversal assertion)
  - [ ] Assert every §C exclusion still succeeds while suspended (AC #2) — this is the half that prevents a permanent lockout
  - [ ] Assert a claim-less session is denied (AC #5)
  - [ ] Bump `plan(N)` to the new count
- [ ] **Task 4 — Automated guardrail so this audit cannot rot (AC #6)**
  - [ ] Add a pgTAP meta-test (new file `supabase/tests/suspension_rpc_coverage.test.sql`) that introspects `pg_proc` for every `security definer` function whose body writes any of the 18 gated tables, and asserts each either calls `private.current_gym_status()` or appears in an explicit, commented exclusion array inside the test
  - [ ] Seed the exclusion array from §C, with the reason inline per entry
  - [ ] Confirm it FAILS if the check is removed from one function (prove the guardrail, don't assume it)
- [ ] **Task 5 — Regression and evidence (AC #7)**
  - [ ] Full pgTAP suite on a fresh `db reset`; `pnpm run typecheck`; dashboard lint + tests; `pnpm run check:i18n`
  - [ ] `packages/types/src/database.ts`: regenerate only if RPC signatures changed — they should not (bodies only). Verify with the table/function-name set comparison this project always uses; state the result either way
  - [ ] Live check: with a locally suspended gym, confirm a member check-in RPC is refused and the member sees the neutral message
  - [ ] Add a `docs/decisions.md` entry recording that RPC-level gating (not `FORCE ROW LEVEL SECURITY`) is the chosen mechanism
  - [ ] Strike the HIGH-severity entry in `deferred-work.md` as resolved

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

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-09-09: create-story — story created, status backlog → ready-for-dev.
