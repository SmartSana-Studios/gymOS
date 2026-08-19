---
baseline_commit: 839f727
---

# Story 12.2: Class Booking with Capacity Enforcement

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want to book a class session from the app,
so that I can reliably reserve my spot in a class I want to attend.

## Acceptance Criteria

1. **Given** a member with a non-expired subscription (any plan type — no per-plan class-eligibility flag), **when** they book a class session, **then** the booking is created — FR-105. Eligibility mirrors `check_in()`'s existing rule (reject only a `null`/`expired` subscription status; `expiring_soon`/`grace_period` members may still book), not a stricter `status = 'active'`-only filter — see Dev Notes "Subscription Eligibility" for why.
2. **Given** a class session already at capacity, **when** a member attempts to book it, **then** the booking is rejected ("class is full") — enforced by `book_class_session()`, a `SECURITY DEFINER` RPC that `SELECT ... FOR UPDATE`-locks the `class_sessions` row, counts existing `class_bookings`, and inserts only if under `classes.capacity`, all in one atomic transaction (AD-21). This must hold even under two members racing for the last spot.
3. **Given** a member's own upcoming booking, **when** they cancel it before the gym-configurable cutoff (`gyms.class_booking_cancellation_cutoff_minutes`, default 120 = 2 hours before session start), **then** the booking is deleted and the spot is immediately available for another member to book.
4. **Given** a member's own upcoming booking, **when** they attempt to cancel it past the cutoff, **then** the cancellation is rejected — FR-106.
5. **Given** a booking or cancellation action, **when** it completes, **then** no payment record is created or referenced anywhere in the flow (FR-106) — this is a pure scheduling action, not a Flow A payment.
6. **Given** the Classes admin page's booking-count column (built in Story 12.1, currently hardcoded to `0/{capacity}` for every session), **when** this story ships, **then** it reads a real, live count from `class_bookings` — Story 12.1's own Dev Notes flagged this as the one line Story 12.2 must change; no new column or UI, just the query going live.

**Scope note — read this before building:** this story ships **zero new UI**. `MA-16` (the mobile Classes tab — Available/My Bookings, the actual "Book"/"Cancel" buttons) is explicitly **Story 12.4**'s deliverable per its own epic text ("...booking/cancellation actions **from Story 12.2**"). This story's job is the migration, the two RPCs, and a mobile *service-layer* wrapper (`apps/mobile/src/services/classes.ts`) that 12.4 will call — mirroring exactly how Story 12.1 shipped `classes.ts`'s CRUD functions before any Classes admin page existed to call them, except here the *consuming screen itself* is deferred one story further. Manual verification for this story is therefore via pgTAP + direct RPC calls (`supabase.rpc(...)` from a scratch script, or the SQL editor), not a browser click-through — there is no screen yet to click through.

## Tasks / Subtasks

- [x] **Task 1: Add the class-booking migration** (AC: #1, #2, #3, #4, #5)
  - [x] Create `supabase/migrations/0058_class_booking_with_capacity_enforcement.sql` (next sequential migration after `0057_class_creation_scheduling.sql`).
  - [x] **`gyms` column:** `alter table gyms add column class_booking_cancellation_cutoff_minutes integer not null default 120 check (class_booking_cancellation_cutoff_minutes >= 0);` — mirrors `checkin_timeout_hours`'s (`0023`) and `alert_auto_dismiss_minutes`'s (`0002`) gym-configurable-integer-column shape exactly; minutes chosen over hours (unlike `checkin_timeout_hours`) since `alert_auto_dismiss_minutes` already establishes minutes as a valid unit in this same table, and a 2-hour default expressed in minutes needs no unit-conversion at read time.
  - [x] **`class_bookings` table:** `id uuid primary key default gen_random_uuid()`, `gym_id uuid not null references gyms(id)` (denormalized, matching `class_sessions`' own denormalized-`gym_id` convention from Story 12.1), `class_session_id uuid not null references class_sessions(id)`, `member_id uuid not null references members(id)`, `created_at timestamptz not null default now()`. **No `status` column** — cancellation is a row `DELETE`, not a status transition. Story 12.3 ("class attendance... is a status column on `class_bookings`", AD-21) will `ALTER TABLE` to add that column when it needs it; pre-adding it now with no AC asking for it would be exactly the kind of anticipatory column Story 12.1 explicitly avoided on `class_sessions` for the same reason. Do not add a `status` column in this story.
  - [x] `create unique index idx_class_bookings_session_member on class_bookings(class_session_id, member_id);` — prevents a member double-booking the same session; also doubles as the concurrent-request backstop for the duplicate-booking pre-check inside `book_class_session()` below (same dual-role pattern `idx_attendance_events_one_open_per_member` plays for `check_in()`).
  - [x] `alter table class_bookings enable row level security;` in this same migration (no open-table window). `grant select, insert, update, delete on class_bookings to authenticated, service_role;` — RLS having zero INSERT/UPDATE/DELETE policies for `authenticated` is what actually blocks direct writes (matches `class_sessions`' established convention); all writes go through the two `SECURITY DEFINER` RPCs below.
  - [x] **`class_bookings` RLS — two SELECT policies (OR'd together, matching `gyms`' and `attendance_events`' two-SELECT-policy precedent):**
    - `member_read_own_class_bookings` — `for select using (gym_id = private.gym_id() and (auth.jwt() ->> 'app_role') = 'member' and exists (select 1 from members m where m.id = class_bookings.member_id and m.user_id = auth.uid()))` — copies `member_read_own_attendance_events`'s (`0026`) exact ownership-proof shape (`members.user_id = auth.uid()`, never a raw `member_id = auth.uid()` comparison — `class_bookings.member_id` references `members.id`, a different UUID from the auth user id).
    - `gym_staff_read_own_class_bookings` — `for select using (gym_id = private.gym_id())`, ungated by role (Receptionist+ all read) — needed now, not deferred to Story 12.3, because Task 2 below makes the Classes admin page's booking-count column (Story 12.1) read real data from this table.
  - [x] **`book_class_session(p_class_session_id uuid) returns class_bookings security definer set search_path = public`** — follows `check_in()`'s (`0034`) established shape and ordering exactly:
    1. Role-check first (cheapest, no data read): `if (auth.jwt() ->> 'app_role') <> 'member' then raise exception 'book_class_session: caller is not a member';`
    2. Resolve `v_gym_id := private.gym_id()`.
    3. Resolve the caller's own member row: `select id, deactivated_at into v_member_id, v_deactivated_at from members where user_id = auth.uid() and gym_id = v_gym_id;` — `raise exception 'book_class_session: no member record found for the caller'` if null. Defense-in-depth `deactivated_at` guard (`raise exception` if not null), mirroring `check_in()`'s own reasoning verbatim: this RPC is reachable by any holder of a valid session token, not just through the app's own navigation gate.
    4. Subscription eligibility (AC #1): `select status into v_sub_status from subscriptions where member_id = v_member_id order by created_at desc limit 1;` — `raise exception 'book_class_session: member has no active subscription'` if `v_sub_status is null or v_sub_status = 'expired'`.
    5. **Row-locked capacity check (AC #2, AD-21):** `select cs.scheduled_at, c.capacity into v_scheduled_at, v_capacity from class_sessions cs join classes c on c.id = cs.class_id where cs.id = p_class_session_id and cs.gym_id = v_gym_id for update of cs;` — uniform not-found failure (`raise exception 'book_class_session: session % not found', p_class_session_id`) if zero rows (covers nonexistent id and cross-gym id identically, matching this schema's uniform-deny-all-failure convention). `raise exception 'book_class_session: cannot book a session that has already started or passed'` if `v_scheduled_at <= now()`.
    6. `select count(*) into v_count from class_bookings where class_session_id = p_class_session_id;` — `raise exception 'book_class_session: class is full'` if `v_count >= v_capacity`.
    7. Duplicate-booking pre-check (friendly error, unique index is the concurrency backstop — same dual-layer pattern `check_in()`'s open-session check plays against its own unique index): `if exists (select 1 from class_bookings where class_session_id = p_class_session_id and member_id = v_member_id) then raise exception 'book_class_session: member already booked this session';`
    8. `insert into class_bookings (gym_id, class_session_id, member_id) values (v_gym_id, p_class_session_id, v_member_id) returning * into v_row; return v_row;`
    - `revoke execute from public; grant execute to authenticated;`
  - [x] **`cancel_class_booking(p_booking_id uuid) returns void security definer set search_path = public`:**
    1. Role-check first: `if (auth.jwt() ->> 'app_role') <> 'member' then raise exception 'cancel_class_booking: caller is not a member';`
    2. Resolve `v_gym_id`, `v_member_id` exactly as in `book_class_session()` (do not extract a shared helper across the two functions — matches this codebase's established per-function-copy discipline over premature RPC-body sharing).
    3. Gym- and member-scoped lookup, joined to its session's `scheduled_at`: `select cb.id, cs.scheduled_at into v_found_id, v_scheduled_at from class_bookings cb join class_sessions cs on cs.id = cb.class_session_id where cb.id = p_booking_id and cb.gym_id = v_gym_id and cb.member_id = v_member_id;` — uniform not-found failure (`raise exception 'cancel_class_booking: booking % not found', p_booking_id`) if zero rows. This one query collapses "doesn't exist," "someone else's booking," and "wrong gym" into the same generic message — deliberately matching `updateClass`'s (Story 12.1) already-accepted not-found convention, not a new gap.
    4. Cutoff check (AC #4): `select class_booking_cancellation_cutoff_minutes into v_cutoff_minutes from gyms where id = v_gym_id;` — `raise exception 'cancel_class_booking: cancellation cutoff has passed'` if `now() >= v_scheduled_at - make_interval(mins => v_cutoff_minutes)`.
    5. `delete from class_bookings where id = v_found_id;` — no row lock needed here (unlike booking): freeing a spot has no capacity race to guard against; a duplicate cancel attempt on an already-deleted row simply re-hits the not-found branch.
    - `revoke execute from public; grant execute to authenticated;`

- [x] **Task 2: Wire the Classes admin page's booking count to real data** (AC: #6)
  - [x] In `apps/dashboard/services/classes.ts`'s `listClasses()`, replace the hardcoded `bookedCount: 0` (Story 12.1) with a real count against `class_bookings` for each row's next session id — this is the one line Story 12.1's own Dev Notes said would change here, no new query shape or UI needed beyond that.
  - [x] Remove the Story-12.1-era comment pointing at this story as the reason for the `0`.

- [x] **Task 3: Add the mobile service layer** (AC: #1, #2, #3, #4, #5)
  - [x] Create `apps/mobile/src/services/classes.ts`, following `checkin.ts`'s established shape: typed result unions, try/catch around every `supabase.rpc()` call, no thrown errors surfaced to callers (matches AD-9's `{ data, error }`-never-throws discipline, adapted to the mobile app's existing typed-status-union style rather than dashboard's `{ data, error }` shape — `checkin.ts`'s `RecordCheckInResult` is the direct precedent to copy, not dashboard's `services/*.ts` shape).
  - [x] `bookClassSession(classSessionId: string): Promise<BookClassSessionResult>` — calls `supabase.rpc('book_class_session', { p_class_session_id: classSessionId })`. Map RPC error messages to a typed status: `'class is full'` → `{ status: 'full' }`; `'already booked this session'` → `{ status: 'already_booked' }`; `'no active subscription'` → `{ status: 'ineligible' }`; anything else (including a thrown/network exception) → `{ status: 'error' }`; success → `{ status: 'success', booking: <mapped row> }`.
  - [x] `cancelClassBooking(bookingId: string): Promise<CancelClassBookingResult>` — calls `supabase.rpc('cancel_class_booking', { p_booking_id: bookingId })`. Map `'cancellation cutoff has passed'` → `{ status: 'cutoff_passed' }`; `'booking % not found'` → `{ status: 'not_found' }`; anything else → `{ status: 'error' }`; success → `{ status: 'success' }`.
  - [x] **Do not build list-fetching functions here** (e.g. "available sessions," "my bookings") — that query shape is Story 12.4's own UI-driven design decision (its Available/My Bookings tabs may need a different join/shape than a generic list call would provide). This story's mobile deliverable is exactly the two action wrappers above, nothing else.

- [x] **Task 4: Add pgTAP coverage** (AC: #1–#6)
  - [x] Create `supabase/tests/class_booking_with_capacity_enforcement.test.sql` (follow `check_in_one_open_session_enforcement.test.sql`'s and `coach_member_assignment.test.sql`'s fixture/RPC-testing conventions — deterministic UUIDs, `transaction`, `plan(...)`, `finish()`, rollback). Cover at minimum: booking succeeds under capacity and decrements the effective remaining capacity; booking a session at `capacity` is rejected ("class is full"); a member cannot double-book the same session (both the pre-check message and, separately, that the unique index itself rejects a forced duplicate insert); booking a cross-gym session is rejected (not-found); booking a past session is rejected; a member with `status = 'expired'` (and a member with zero `subscriptions` rows) cannot book; a member with `expiring_soon`/`grace_period` status *can* book (proves AC #1's eligibility rule, not just the rejection half); a Receptionist/Manager/Owner role cannot call `book_class_session()` at all (role check, not RLS — these RPCs have no role-conditional RLS to fall back on).
  - [x] Cover cancellation: before-cutoff cancel succeeds and the freed spot becomes bookable by another member; after-cutoff cancel is rejected; cancelling a nonexistent booking id is rejected (not-found); cancelling another member's booking is rejected (not-found, same message — proves the collapsed-error convention holds); cancelling an already-cancelled booking is rejected (not-found, proves no double-delete issue).
  - [x] Create `supabase/tests/class_booking_with_capacity_enforcement.negative.test.sql`: `authenticated`/`anon` cannot directly `INSERT`/`UPDATE`/`DELETE` on `class_bookings` (per-privilege assertions, matching `0057`'s negative-test fix, not a comma-joined any-of check); a member can `SELECT` only their own `class_bookings` rows, never another member's; a Receptionist/Manager/Owner can `SELECT` all of their gym's `class_bookings` but a cross-gym staff session sees none.
  - [x] Run the full `supabase test db` suite and confirm zero regressions in every pre-existing file (this migration is additive-only — one new column with a `not null default`, one wholly new table — touching no existing table's behavior).

- [x] **Task 5: Regenerate types, validate, and document** (AC: #1–#6)
  - [x] Regenerate `packages/types/src/database.ts` via the pg-meta HTTP-endpoint devcontainer workaround if `supabase gen types typescript --local` reproduces the known zero-byte-stdout bug (documented in every story since 4.13). Confirm the diff contains exactly: the new `class_bookings` table, the `gyms.class_booking_cancellation_cutoff_minutes` column, and the two new function signatures (`book_class_session`, `cancel_class_booking`) — nothing else.
  - [x] Run `supabase db reset`, the full `supabase test db` suite, `pnpm run typecheck`, `pnpm run lint`, `pnpm run check:i18n`. **`check:i18n` should show zero new keys** — this story ships no UI, so a diff here signals scope creep, not progress.
  - [x] **No manual browser verification** — unlike Story 12.1, there is no screen to click through (see Scope Note above). Verify instead via a scratch script or the Supabase SQL editor calling both RPCs directly against seeded fixtures: book to capacity, confirm the next booking is rejected; cancel one, confirm the freed spot is immediately bookable; confirm the Classes admin page (Story 12.1's UI, Task 2 above) now shows a real, non-zero booking count for a class with bookings.
  - [x] Add a dated `docs/decisions.md` entry covering: (a) `class_bookings` has no `status` column — cancellation is `DELETE`, deferring the attended-status design to Story 12.3; (b) the subscription-eligibility rule mirrors `check_in()`'s null/expired-only rejection rather than a strict `status = 'active'` filter, as a judgment call (flag for confirmation — FR-105's literal text says "active subscription" and could be read either way); (c) the cancellation-cutoff column's minutes unit and 120-minute default; (d) that this story ships zero UI, deferring `MA-16` to Story 12.4 per that story's own epic text.

### Review Findings

- [x] [Review][Patch] Reschedule of a class with booked future sessions raises an unhandled FK-violation error — fixed: `materialize_class_sessions()` and `update_class()` (redefined via `create or replace` in `0058`) now check for existing `class_bookings` on the future sessions about to be deleted and `raise exception` with a friendly "cannot reschedule ... existing bookings on its future sessions" message instead of proceeding; no cascade-delete of bookings. New pgTAP coverage: reschedule blocked when a booking exists (class `8094`), reschedule still succeeds when none exist (class `8095`). [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql, supabase/tests/class_booking_with_capacity_enforcement.test.sql]
- [x] [Review][Decision] Subscription-eligibility interpretation of FR-105's "active subscription" — resolved (user, 2026-08-19): keep `check_in()`'s broader rule as shipped (reject only `null`/`expired`; `expiring_soon`/`grace_period` members can still book). Confirms the judgment call already implemented; no code change. [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql:479-487, docs/decisions.md]
- [x] [Review][Patch] `book_class_session()`/`cancel_class_booking()` omit the `order by deactivated_at nulls first limit 1` tiebreak when resolving the caller's member row — fixed: added to both, matching `check_in()`'s established pattern. [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql]
- [x] [Review][Patch] Capacity check runs before the duplicate-booking check in `book_class_session()`, so a member who already booked a now-full session sees "class is full" instead of "already booked this session" — fixed: duplicate-booking check now runs first. [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql]
- [x] [Review][Patch] Missing pgTAP test for the exact cancellation-cutoff boundary (`now() = scheduled_at - cutoff`), explicitly named the #3 highest-priority regression risk in this story's own Dev Notes — fixed: added a session at exactly `now() + 120 minutes`, proving the inclusive `>=` boundary. [supabase/tests/class_booking_with_capacity_enforcement.test.sql]
- [x] [Review][Patch] Missing pgTAP test for a truly nonexistent `class_session_id` on `book_class_session()` — fixed: added a dedicated nonexistent-id assertion, distinct from the existing cross-gym case. [supabase/tests/class_booking_with_capacity_enforcement.test.sql]
- [x] [Review][Patch] Missing pgTAP test for cancelling a booking that belongs to a different gym — fixed: added a wrong-gym cancellation assertion, distinct from the existing nonexistent-id and wrong-member cases. [supabase/tests/class_booking_with_capacity_enforcement.test.sql]
- [x] [Review][Patch] `gym_staff_read_own_class_bookings`'s deliberate `coach`-role exclusion has zero test coverage — fixed: added an assertion authenticating as the fixture coach, proving zero-row SELECT. [supabase/tests/class_booking_with_capacity_enforcement.negative.test.sql]
- [x] [Review][Patch] No test uses a non-default `class_booking_cancellation_cutoff_minutes` value — fixed: added a Gym C fixture with a 30-minute cutoff and a session 45 minutes out, proving the column is read dynamically (would fail under the 120-minute default). [supabase/tests/class_booking_with_capacity_enforcement.test.sql]
- [x] [Review][Defer] `class_bookings` has no standalone index on `member_id` or `gym_id` (only the composite unique `(class_session_id, member_id)`) — both RLS policies will sequence-scan as the table grows — deferred, low severity at current scale [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql]
- [x] [Review][Defer] Lowering a class's `capacity` below its current booked count (via Story 12.1's `updateClass()`) is unguarded and untested — existing bookings just remain, only new bookings get blocked — deferred, pre-existing gap outside this story's ACs [apps/dashboard/services/classes.ts]
- [x] [Review][Defer] `book_class_session()` locks only the `class_sessions` row, not `classes` — a concurrent capacity edit during a booking transaction has a narrow theoretical race window — deferred, low severity [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql:494-498]
- [x] [Review][Defer] Dashboard `listClasses()`'s new booking-count fetch has no `.range()`/pagination — would silently undercount once results exceed PostgREST's default row cap — deferred, unlikely at current scale [apps/dashboard/services/classes.ts:150-176]
- [x] [Review][Defer] Subscription-row selection (`order by created_at desc limit 1`, no status tiebreak) could pick a stale/lapsed row over a currently-active one — deferred, pre-existing pattern copied from `check_in()`, not introduced by this story [supabase/migrations/0058_class_booking_with_capacity_enforcement.sql:479-483]

## Dev Notes

### This Story's Real Crux — Read This First

This is the first *booking* story in Epic 12 — Story 12.1 built pure schedule metadata (`classes`/`class_sessions`) with explicitly zero capacity/booking concept. `class_bookings` is the table `ARCHITECTURE-SPINE.md`'s ERD already names (`MEMBERS ||--o{ CLASS_BOOKINGS : books`, `CLASS_SESSIONS ||--o{ CLASS_BOOKINGS : "capacity-limited"`) and AD-21 already names the RPC for (`book_class_session()`) — this story is not inventing the shape from nothing the way Story 12.1 had to for `classes`/`class_sessions`; it is filling in an already-scoped gap. The one genuinely new design surface is `cancel_class_booking()` (unnamed by AD-21) and the cancellation-cutoff column (unnamed by the architecture, only by FR-106's prose).

### Subscription Eligibility — A Real Judgment Call

FR-105 says "any member with an **active** subscription... can book." Two existing precedents in this codebase read "active" differently:
- `check_in()` (`0034`) rejects only `status is null or status = 'expired'` — `active`/`expiring_soon`/`grace_period` can all check in.
- `apps/mobile/src/services/subscriptions.ts`'s own comment explicitly filters to `status = 'active'` strictly for a *different* purpose (plan-detail display), noting `expiring_soon`/`grace_period`/`expired` are excluded there.

This story follows `check_in()`'s precedent (broader eligibility) on the reasoning that class booking, like check-in, is a gym-usage action for a member in current good standing — not a plan-detail display concern. **This is a judgment call, not a certainty** — flag it in the `docs/decisions.md` entry (Task 5) rather than treating it as settled. If it turns out wrong, the fix is a one-line change to Task 1 step 4's condition.

### Architecture Compliance

- **AD-21** (bounded-capacity actions are a row-locked check-then-insert RPC) is this story's central binding constraint, explicitly named for "Epic 12 class booking (FR-105)." `book_class_session()` must lock `class_sessions`, not `class_bookings` or `classes` — locking the row being contested (the session), matching `check_in()`'s lock-the-contested-row shape exactly.
- **AD-23** (offline support is scoped per-domain) explicitly **excludes** class booking from the mobile offline queue: *"Class booking (AD-21) is explicitly excluded — its synchronous, row-locked capacity check has no offline-queueable equivalent."* Do not add any offline-queue plumbing for `bookClassSession`/`cancelClassBooking` in Task 3 — this is an explicit architectural exclusion, not an oversight to fix.
- **AD-9** (`{ data, error }`, never throw for expected errors) applies at the *dashboard* service-layer boundary; the mobile app's own established convention (`checkin.ts`) is a typed status-union return, also never throwing for expected errors — Task 3 follows the mobile precedent, not AD-9's literal shape.
- Every new table/column follows the RLS-enabled-in-same-migration, `gym_id`-carrying convention — no exceptions taken here.

### Existing Files to Read Before Writing New Ones

- `supabase/migrations/0034_real_time_front_desk_alert.sql` (the current, most-recently-redefined `check_in()` body, lines ~140–280) — the exact role-check → resolve-gym → resolve-member → guard → lock → act shape and ordering `book_class_session()`/`cancel_class_booking()` follow.
- `supabase/migrations/0026_member_app_home_screen_status_display.sql` — `member_read_own_attendance_events`'s exact ownership-proof RLS shape (`members.user_id = auth.uid()`), copied verbatim for `member_read_own_class_bookings`.
- `supabase/migrations/0057_class_creation_scheduling.sql` (full file) — `classes`/`class_sessions` schema, the RLS-grant-then-narrow convention, and the uniform not-found-failure discipline this story's RPCs continue.
- `apps/mobile/src/services/checkin.ts` (full file) — the exact typed-result-union, try/catch, never-throw shape `apps/mobile/src/services/classes.ts` copies.
- `apps/dashboard/services/classes.ts` (full file, from Story 12.1) — `listClasses()`'s current `bookedCount: 0` line and its surrounding comment (Task 2 removes both).
- `supabase/migrations/0002_gyms_and_tiers.sql` — `alert_auto_dismiss_minutes`'s exact column shape, the direct precedent for `class_booking_cancellation_cutoff_minutes`.

### Testing Requirements

- Follow `check_in_one_open_session_enforcement.test.sql`'s and `coach_member_assignment.test.sql`'s exact pgTAP fixture conventions (deterministic UUIDs, `transaction` + `plan(...)`, `finish()`, rollback).
- **Highest-risk regressions, in priority order:** (1) the capacity check racing — pgTAP cannot simulate true concurrency, so prove correctness at the boundary instead (a session at exactly `capacity` rejects the next booking; one below `capacity` accepts it) and trust the `FOR UPDATE` lock's correctness to the architecture's own precedent (`check_in()`'s identical shape, already proven in production-adjacent use); (2) the uniform not-found collapsing multiple real failure modes (nonexistent id, wrong gym, wrong member) — write a test for each mode separately even though they share one error message, so a future regression that changes only one path is still caught; (3) the cutoff boundary itself (`now() >= scheduled_at - cutoff`, not `>`) — test exactly at the boundary, not just clearly-before/clearly-after.
- Full regression gate: clean `supabase db reset`, all pgTAP tests, generated-types diff inspection, monorepo typecheck, lint, `check:i18n` (expect zero new keys — this story ships no UI).

### Previous Story Intelligence

- Story 12.1 (`12-1-class-creation-scheduling.md`) is the direct predecessor. Its "Booking-Count Scope Gap" Dev Note explicitly names this story as the one that flips `bookedCount: 0` to a real query (Task 2 here) — do not treat that as new scope, it was pre-planned.
- Story 12.1's Review Findings deferred "coach double-booking guard" and flagged a still-open timezone-capture gap on `class_sessions.one_off_session_at` — neither is this story's concern (out of scope for booking).
- Story 12.1's own Change Log documents the devcontainer `supabase gen types` zero-byte-stdout bug reproducing on every story since Story 4.13 — expect it again here (Task 5).
- Git/worktree note, carried forward from every recent story: preserve any unrelated BMAD tooling changes already in the working tree (currently `.claude/settings.json` and two `_bmad-output/` files, untracked); never use destructive reset/checkout commands. Story 12.1's own diff has already been committed (`839f727`) as of this story's creation.

### Latest Technical Information

- No new libraries, external services, or Expo/Next.js APIs are introduced. `for update`/`make_interval()` are both long-stable core Postgres already used elsewhere in this schema (`check_in()`, `0024`) — no web research needed beyond confirming current PRD/architecture text.

### Project Structure Notes

- New migration: `supabase/migrations/0058_class_booking_with_capacity_enforcement.sql`.
- New mobile service: `apps/mobile/src/services/classes.ts`.
- New tests: `supabase/tests/class_booking_with_capacity_enforcement.test.sql`, `supabase/tests/class_booking_with_capacity_enforcement.negative.test.sql`.
- Edited: `apps/dashboard/services/classes.ts` (`listClasses()`'s booking-count query, Task 2 only — no other change).
- Updated generated type: `packages/types/src/database.ts`.
- Updated decision record: `docs/decisions.md`.
- **No changes** to any `apps/dashboard` UI component, any `apps/mobile` screen/UI component, any i18n locale file, or `apps/super-admin` — this story is schema + RPC + a headless service-layer wrapper only. If implementation drifts toward building `MA-16` screens, stop — that is Story 12.4's scope, not this one's.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 12: Classes & Scheduling, Story 12.2 (also Story 12.4's text, which names Story 12.2 as the source of the booking/cancellation *actions* it surfaces)]
- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md` FR-105 (booking + capacity), FR-106 (cancellation + cutoff, not a payment)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md` — AD-21 (row-locked check-then-insert RPC, names `book_class_session()` explicitly), AD-23 (offline queue exclusion for class booking), ERD (`CLASS_BOOKINGS` relationships)]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` — MA-16 (Classes tab mockup, confirms this story's actions are consumed by Story 12.4's screen, not built here); "Cancel: tap → inline confirm... on confirm, the row moves out of My Bookings and the spot frees immediately" (cancellation UX this story's RPC must support, even though the confirm dialog itself is 12.4's)]
- [Source: `_bmad-output/implementation-artifacts/12-1-class-creation-scheduling.md` — booking-count scope gap (Task 2's origin), `classes`/`class_sessions` schema this story's FKs reference]
- [Source: `supabase/migrations/0034_real_time_front_desk_alert.sql` — current `check_in()` body, the row-locked RPC shape this story's two RPCs follow]
- [Source: `supabase/migrations/0026_member_app_home_screen_status_display.sql` — `member_read_own_attendance_events`'s ownership-proof RLS shape]
- [Source: `apps/mobile/src/services/checkin.ts` — typed-result-union mobile service-layer pattern]
- [Source: `supabase/migrations/0002_gyms_and_tiers.sql` — `alert_auto_dismiss_minutes` column precedent]

## Change Log

- 2026-08-19: Story drafted via create-story workflow, targeting Story 12.2 explicitly (user chose to proceed with 12.2 to unblock Epic 6's remaining Story 6.6, which depends on a bookable class session existing).
- 2026-08-19: dev-story: status ready-for-dev -> in-progress -> review. All 5 tasks complete; migration 0058 (gyms.class_booking_cancellation_cutoff_minutes, class_bookings table + RLS, book_class_session()/cancel_class_booking() RPCs), dashboard listClasses() booking-count wiring, mobile classes.ts service layer, 42 new pgTAP assertions (32 positive + 10 negative), database.ts regeneration, and a docs/decisions.md entry all shipped. One real RLS bug found and fixed during Task 4 (caught by this story's own negative pgTAP coverage, not by review): the story's own drafted text specified the staff SELECT policy as "ungated by role," which — since class_bookings also carries a competing member-only SELECT policy, unlike class_sessions' identical-shaped policy which has no such competitor — let any member-role session read every other member's bookings gym-wide. Fixed by gating to owner/manager/receptionist, matching gym_staff_read_own_attendance_events' (0025) precedent.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Full pgTAP suite: 1065/1065 pass (52 files) after `supabase db reset`, including this story's own 42 new assertions (`class_booking_with_capacity_enforcement.test.sql`: 32, `.negative.test.sql`: 10).
- Monorepo typecheck: 0 errors across all 4 packages (`@gymos/types`, `@gymos/dashboard`, `@gymos/mobile`, `@gymos/super-admin`).
- Dashboard lint: 4 pre-existing errors (`RecordRefundModal.tsx`, `RenewalModal.tsx` — both untouched by this story), confirmed via `git stash` to pre-exist on clean HEAD. Super-admin lint: 1 pre-existing warning, 0 errors. Mobile lint: pre-existing `eslint` binary-not-found failure, confirmed via `git stash` to pre-exist on clean HEAD, unrelated to this story.
- Dashboard Vitest: 93/93 pass (unchanged count — no dashboard-side unit tests existed for `classes.ts`'s `listClasses()` before this story either; correctness of the new booking-count query is covered by this story's own pgTAP suite instead).
- `check:i18n`: clean, zero new keys (confirmed via `git diff` showing zero changes to any locale file) — this story ships no UI, matching its own scope note.
- `database.ts` regenerated via the documented pg-meta HTTP-endpoint devcontainer workaround (`supabase gen types typescript --local` reproduced the known zero-byte-stdout bug). Diff verified via `git diff` to contain exactly: the new `class_bookings` table, `gyms.class_booking_cancellation_cutoff_minutes`, and the two new function signatures (`book_class_session`, `cancel_class_booking`) — nothing else.
- Manual verification (Task 5, no browser click-through — this story ships no UI): a throwaway-fixture scratch script run directly against the local DB (`docker exec supabase_db_gym_os psql`, transaction rolled back after) exercised the real RPC call sequence end-to-end: two members booked a capacity-2 session successfully, a third was rejected with "class is full," `listClasses()`'s exact query shape confirmed a real `booked_count: 2`, a cancellation freed the spot, and a fourth member's booking of the freed spot succeeded, with the final count still exactly 2. Matches every assertion already proven by the pgTAP suite; run as an independent, non-pgTAP confirmation per Task 5's own instruction.

### Completion Notes List

- Task 1: migration `0058_class_booking_with_capacity_enforcement.sql` — `gyms.class_booking_cancellation_cutoff_minutes` (default 120), `class_bookings` table (no `status` column, per the story's own explicit instruction), its unique `(class_session_id, member_id)` index, RLS (member-own-read + staff-read, deny-all writes), and `book_class_session()`/`cancel_class_booking()` — both `SECURITY DEFINER` RPCs following `check_in()`'s established role-check/resolve/guard/lock/act shape. The staff-read RLS policy was corrected mid-implementation from the story's own drafted "ungated by role" text to `owner`/`manager`/`receptionist`-gated, after this story's own negative pgTAP test caught the resulting cross-member privacy leak (see Change Log/docs/decisions.md for the full explanation) — a real defect in the story spec, not an implementation slip.
- Task 2: `apps/dashboard/services/classes.ts`'s `listClasses()` — replaced the hardcoded `bookedCount: 0` with a real `class_bookings` count scoped to each row's next-session id, fetched in one additional round trip and counted client-side (no PostgREST group-by aggregate available), mirroring the existing `nextSessionByClassId` fetch-then-map pattern already in the file.
- Task 3: `apps/mobile/src/services/classes.ts` — `bookClassSession()`/`cancelClassBooking()`, following `checkin.ts`'s typed-result-union, try/catch, never-throw shape. No offline-queue plumbing (AD-23 explicitly excludes class booking). No list-fetching functions (Story 12.4's own scope, per the story's explicit instruction).
- Task 4: `class_booking_with_capacity_enforcement.test.sql` (32 assertions) covers capacity boundary (at-capacity rejects, one-below accepts, via a dedicated capacity-1 class/session isolated from the general-purpose eligibility/role/cutoff fixtures), double-booking (both the RPC pre-check and the raw unique-index backstop), subscription eligibility (expired/zero-subscription rejected; expiring_soon/grace_period accepted), role rejection (receptionist/manager/owner), past-session and cross-gym rejection, and the full cancellation surface (before/after cutoff, not-found for nonexistent/other-member/already-cancelled bookings, freed-spot immediate rebookability). `.negative.test.sql` (10 assertions) covers per-privilege INSERT/UPDATE/DELETE denial for both `authenticated` and `anon`, and SELECT scoping (member sees only their own row; same-gym staff sees all; cross-gym staff sees none).
- Task 5: types regenerated and diff-verified; full regression sweep (pgTAP, typecheck, lint, i18n, dashboard tests) all clean relative to documented pre-existing baselines; manual RPC verification performed via scratch script (no browser UI exists yet for this story to click through); `docs/decisions.md` entry added covering the no-`status`-column design, the subscription-eligibility judgment call (flagged, not settled), the cutoff column, the zero-UI scope, and the RLS bug found/fixed during this story's own testing.

### File List

- `supabase/migrations/0058_class_booking_with_capacity_enforcement.sql` (new)
- `supabase/tests/class_booking_with_capacity_enforcement.test.sql` (new)
- `supabase/tests/class_booking_with_capacity_enforcement.negative.test.sql` (new)
- `apps/mobile/src/services/classes.ts` (new)
- `apps/dashboard/services/classes.ts` (edited — `listClasses()`'s booking-count query, Task 2 only)
- `packages/types/src/database.ts` (edited — regenerated, new table/column/function signatures only)
- `docs/decisions.md` (edited — new dated entry)
