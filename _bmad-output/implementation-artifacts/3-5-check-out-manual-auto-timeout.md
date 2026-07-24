---
baseline_commit: 62d9ee9
---

# Story 3.5: Check-Out — Manual & Auto-Timeout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member or receptionist,
I want check-ins to close automatically or on demand,
so that attendance duration and current occupancy stay accurate.

## Acceptance Criteria

1. **Given** an open check-in, **when** the member or a receptionist triggers check-out, **then** `checked_out_at` is set to the current time. [Source: epics.md#Story 3.5]
2. **Given** an open check-in exceeds the gym's configured auto-timeout (default 8 hours), **when** the same pg_cron job runs, **then** the session is auto-closed. [Source: epics.md#Story 3.5]
3. **Given** the cron job runs late, **when** it next runs successfully, **then** overdue open sessions are closed at that time. [Source: epics.md#Story 3.5]

## Scope Notes — Read Before the Tasks

This story is **backend-only, like Stories 3.1/3.2** — no dashboard or mobile UI ships in this story. The dashboard's "Check Out" button (AD-11's Currently Checked-In table) is Story 3.6's job — it builds the entire Attendance page and will call the service function this story adds. There is no member-facing "check out" affordance anywhere in the UX design (`EXPERIENCE.md`'s MA screens have no such button — checked exhaustively) — the member-triggered path this story's AC #1 requires exists only as a callable backend capability (`check_out()`), shipped with zero UI, following 3.1/3.2's own "RPC + service function now, UI later" precedent (not 3.4's precedent, which built mobile UI in the same story — that was driven by 3.4's own AC wording about showing a confirmation overlay, which this story's ACs don't have). Read all five notes below before writing any code.

### Scope Note #1 — AC #2/#3's "same pg_cron job" contradicts architecture.md; follow architecture.md

FR-045 (PRD) and this story's AC #2 both say the auto-timeout runs on "the same pg_cron job" as subscription lifecycle transitions. **This is stale/imprecise wording — do not implement it literally.** `architecture.md`'s Background Jobs row is explicit and reasoned: *"Three independent `pg_cron` triggers (subscription lifecycle, payment reconciliation, check-in auto-timeout), each in its own function/transaction, each logging to a `job_runs` table... A single shared trigger means one job's failure can silently block or corrupt the others."* This is a deliberate, justified architectural decision, not an oversight — a bug in the check-in timeout logic must never be able to block or corrupt subscription-status transitions (or vice versa) by sharing a transaction/function. Build **check-in auto-timeout as its own new, independent pg_cron job**, following `run_subscription_lifecycle_job()`'s exact shape (`supabase/migrations/0021_subscription_lifecycle_cron.sql`) — its own function, its own `cron.schedule()` call, its own `job_runs` rows under a distinct `job_name`.

**Schedule:** subscription lifecycle runs once nightly because it's a date-only transition (nothing changes faster than once a day). Check-in auto-timeout is different — occupancy (Story 3.6) needs a session to close reasonably promptly after the timeout elapses, not stay "open" for up to 24 hours until a nightly job catches it. Run it every 15 minutes: `select cron.schedule('check_in_auto_timeout', '*/15 * * * *', $$ select run_check_in_auto_timeout_job(); $$);`. `cron.schedule()` upserts by job name, so this is safe to re-run across `supabase db reset`s, matching 0021's own comment.

### Scope Note #2 — New migration `0024`: the auto-timeout cron job function

Next migration number is **`0024`** (`0023` was Story 3.4's). New function, modeled directly on `run_subscription_lifecycle_job()` (0021) — same `BEGIN...EXCEPTION` savepoint pattern (so a failure still leaves a `job_runs` row + `log_audit_event` call, per that function's own rationale comment), same "no SECURITY DEFINER needed, pg_cron invokes as `postgres`" reasoning, same `revoke execute ... from public` with no grant to any client role (this function is never called from application code):

```sql
create function run_check_in_auto_timeout_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    update attendance_events a
    set checked_out_at = a.checked_in_at + make_interval(hours => g.checkin_timeout_hours),
        checkout_type = 'auto'
    from gyms g
    where a.gym_id = g.id
      and a.checked_out_at is null
      and a.checked_in_at + make_interval(hours => g.checkin_timeout_hours) <= now();

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('check_in_auto_timeout', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('check_in_auto_timeout', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'check_in_auto_timeout_job_failure',
      p_system_actor_label => 'system:check_in_auto_timeout_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

revoke execute on function run_check_in_auto_timeout_job() from public;

select cron.schedule(
  'check_in_auto_timeout',
  '*/15 * * * *',
  $$ select run_check_in_auto_timeout_job(); $$
);
```

**Do not write a per-session `audit_log` row for each session this job auto-closes.** This is the single most important disaster-prevention note in this story: 3.4's `check_in()` logs an audit entry for its own stale-auto-close (`attendance_stale_check_in_auto_closed`), but that was driven by 3.4's own AC #3 literal wording ("...and logs the auto-close to the audit log"). **This story's AC #2/#3 say nothing about audit logging**, and FR-080 (the platform's canonical list of audit-triggering actions: manual payment entries, payment verifications, refunds, member deactivations, coach assignment changes, Super Admin gym-data escalations, and pg_cron job failures) does **not** include attendance auto-close among them. `run_subscription_lifecycle_job()` itself sets the precedent: it does not audit-log every individual subscription transition, only job failures. Match that — only `job_runs`/failure-path `log_audit_event` here, never one row per auto-closed session (a busy gym auto-closing dozens of stale sessions every 15 minutes must not flood `audit_log`).

Also add the two new RPCs this story's manual check-out path needs (same migration file, `0024`):

**(a) `check_out()`** — member self-service, mirrors `check_in()`'s exact shape (0023): no parameter, derives member/gym from the caller's own session, closes the caller's own open session (`checkout_type = 'manual'`). No UI calls this in this story (see the header note above) — it exists so AC #1's "member... triggers check-out" is a real, testable backend capability, matching this codebase's established precedent of shipping backend capability ahead of its consuming UI (3.1, 3.2).

```sql
create function check_out()
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select id into v_member_id
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_out: no member record found for the caller';
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = v_member_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out: member % has no open check-in', v_member_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function check_out from public;
grant execute on function check_out to authenticated;
```

**(b) `check_out_member(p_member_id uuid)`** — staff-driven, for the dashboard's future "Check Out" button (AD-11, Story 3.6). Mirrors `renew_subscription()`'s exact shape (0022): `SECURITY DEFINER`, self-checked role array, gym-scoped lookup folded into the query (uniform not-found for cross-tenant/nonexistent, same tenant-isolation rationale as 0022's own comment). **Role array is `['owner', 'manager', 'receptionist']`** — the same three roles `renew_subscription()` grants, matching the Attendance page's own role-visibility matrix (`EXPERIENCE.md`'s Role visibility matrix: Attendance is visible to Receptionist, Manager, and Owner, not Coach). The story's own "As a member or receptionist" framing is persona shorthand, not a literal role restriction — Owner/Manager must have at least the same front-desk capability Receptionist has here, exactly as 3.2 established for renewals.

```sql
create function check_out_member(p_member_id uuid)
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  select gym_id into v_member_gym_id
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'check_out_member: member % not found', p_member_id;
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = p_member_id and gym_id = v_member_gym_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out_member: member % has no open check-in', p_member_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function check_out_member from public;
grant execute on function check_out_member to authenticated;
```

No new RLS policy on `attendance_events` needed — both functions are `SECURITY DEFINER`, same reasoning as `check_in()`/`renew_subscription()`. Do not widen `attendance_events`'s deny-all RLS.

### Scope Note #3 — `gyms.checkin_timeout_hours` becomes Settings-editable (FR-045, deferred by Story 3.4)

3.4's Scope Note #2 added the column with `default 8` and a `check (checkin_timeout_hours > 0)` constraint but explicitly deferred the Settings UI to this story: *"FR-045 ('configurable per gym in Settings') is Story 3.5's FR, not this story's."* No new migration needed for the column itself — it already exists. This story only adds the app-layer plumbing:

- **`packages/types/src/schemas/gym.ts`** — add `checkinTimeoutHours` to `gymSettingsSchema`, following `alertAutoDismissMinutes`'s exact shape (an app-layer range bound; the DB only enforces `> 0`): `checkinTimeoutHours: z.number().int().min(1, "Check-in timeout must be between 1 and 24 hours").max(24, "Check-in timeout must be between 1 and 24 hours")`. Add it to `GymSettingsInput`'s inferred type automatically via the schema.
- **`apps/dashboard/services/gym-settings.ts`** — add `checkinTimeoutHours: number` to `GymSettingsRow`; `getGymSettings()`'s `.select(...)` gains `checkin_timeout_hours`, mapped to `checkinTimeoutHours`; `updateGymSettings()`'s `.update({...})` gains `checkin_timeout_hours: input.checkinTimeoutHours`.
- **`apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx`** — add a `checkinTimeoutHours` field to `FieldErrors`, `NAN_FIELD_MESSAGE_KEYS` (→ `settings.errors.checkinTimeoutRange`), and `form` state (`String(initial.checkinTimeoutHours)`); in the submit handler's `candidate` object add `checkinTimeoutHours: Number(form.checkinTimeoutHours)`, and add `"checkinTimeoutHours"` to the NaN-substitution loop's tuple. Render a new field — a `<Label htmlFor="checkinTimeoutHours">`/`<Input type="number">`/unit-span block, identical structure to the existing `alertAutoDismissMinutes` field (lines ~402–419) — inside a **new** `<section>` titled `t("settings.sections.attendance")`, placed after the `capacity` field's closing `</section>` (line ~397) and before the existing Front-Desk Alerts section. Do not put it inside the Front-Desk Alerts section — timeout config is attendance-domain, not alerts-domain.
- **`apps/dashboard/app/(dashboard)/settings/actions.ts`** — `saveGymSettings()`'s `logGymSettingsChange(...)` metadata object gains `checkin_timeout_hours: parsed.data.checkinTimeoutHours`.
- **New i18n keys**, `apps/dashboard/locales/en.json`/`fr.json`, under the existing `settings.*` namespace: `sections.attendance` ("Attendance" / "Présence"), `fields.checkinTimeout` ("Check-In Timeout *" / "Délai de pointage *"), `fields.checkinTimeoutUnit` ("hours" / "heures"), `errors.checkinTimeoutRange` ("Check-in timeout must be between 1 and 24 hours" / "Le délai de pointage doit être compris entre 1 et 24 heures").

Do not touch `checkin_timeout_hours`'s existing DB default/constraint (0023) — this story is additive UI/validation on top of an already-working column.

### Scope Note #4 — Dashboard service layer: `apps/dashboard/services/attendance.ts` (new file)

Following `subscriptions.ts`'s exact precedent (a backend-only story still adds the service-layer function that calls its new RPC, even with no `actions.ts`/UI yet — Story 3.6 adds those): new file, one exported function:

```ts
import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";

export async function checkOutMember(memberId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_out_member", { p_member_id: memberId });
  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
```

No Zod schema needed for a bare UUID parameter (`subscriptions.ts`'s own `renewSubscription` validates because it also carries a free-text `reason`; this call has nothing else to validate — `memberId` is a plain string passed straight to the RPC, which itself does the gym-scoped lookup). `mapSupabaseError` (`packages/types/src/errors.ts`) needs no new mapping in this story. Note `renew_subscription`'s existing `member_not_found` mapping is **not** reusable here as-is — it matches on the message containing `renew_subscription:`, which `check_out_member`'s own `%not found%` raise won't contain. Leave `check_out_member`'s raises unmapped (falls through to the generic `unknown` copy) for now, matching this file's own established precedent of leaving errors unmapped until a real UI caller needs the specific copy — Story 3.6 adds the mapping once the dashboard's Check Out button needs a friendly message.

### Scope Note #5 — Explicitly out of scope (other stories' jobs)

- **Any dashboard UI** (Currently Checked-In table, "Check Out" button/confirmation dialog, occupancy bands): Story 3.6. `apps/dashboard/app/(dashboard)/attendance/` does not exist yet and this story does not create it.
- **Any mobile UI**: no member-facing check-out button exists anywhere in the UX design; this story does not add one. `apps/mobile/src/services/checkin.ts`/`checkin.tsx` are not touched — `check_out()` is reachable via RPC only, unused by any app code, in this story.
- **Occupancy calculation/display**: Story 3.6 (FR-046/047).
- **Per-session audit logging of auto-closes**: not this story's AC, not in FR-080's list (Scope Note #2).

## Tasks / Subtasks

- [x] **Task 1: Migration `0024` — independent auto-timeout cron job + two check-out RPCs** (AC #1, #2, #3; Scope Notes #1, #2)
  - [x] `supabase/migrations/0024_check_out_manual_auto_timeout.sql`: `run_check_in_auto_timeout_job()` (own function, own `job_runs` entries under `job_name = 'check_in_auto_timeout'`, own `cron.schedule('check_in_auto_timeout', '*/15 * * * *', ...)`) exactly as specified in Scope Note #2 — independent of `run_subscription_lifecycle_job()`, not sharing its function or transaction.
  - [x] Same migration: `check_out()` (member self-service RPC) and `check_out_member(p_member_id uuid)` (staff RPC, role array `['owner','manager','receptionist']`) exactly as specified in Scope Note #2.
  - [x] Appropriate `revoke`/`grant` per function: `run_check_in_auto_timeout_job` gets no grant to any client role (cron/direct-postgres only); `check_out`/`check_out_member` grant `execute` to `authenticated` only.

- [x] **Task 2: `packages/types` — `checkinTimeoutHours` on `gymSettingsSchema`** (Scope Note #3)
  - [x] `packages/types/src/schemas/gym.ts`: add the field exactly as specified in Scope Note #3.

- [x] **Task 3: Dashboard Settings — `checkinTimeoutHours` field** (FR-045; Scope Note #3)
  - [x] `apps/dashboard/services/gym-settings.ts`: `GymSettingsRow` + `getGymSettings()`/`updateGymSettings()` read/write the new column.
  - [x] `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx`: new field + new `attendance` section, per Scope Note #3.
  - [x] `apps/dashboard/app/(dashboard)/settings/actions.ts`: `saveGymSettings()`'s audit metadata gains `checkin_timeout_hours`.
  - [x] New i18n keys in `apps/dashboard/locales/en.json`/`fr.json` per Scope Note #3. Run `node scripts/check-i18n-key-parity.mjs` after.

- [x] **Task 4: Dashboard service layer — `attendance.ts`** (AC #1; Scope Note #4)
  - [x] New `apps/dashboard/services/attendance.ts`: `checkOutMember()` exactly as specified in Scope Note #4.

- [x] **Task 5: pgTAP coverage** (AC #1, #2, #3; Scope Notes #1, #2)
  - [x] New `supabase/tests/check_out_manual_auto_timeout.test.sql`, following `subscription_lifecycle_cron.test.sql`'s "call the job function directly, no real cron timing" convention for the auto-timeout job, and `manual_renewal_reset.test.sql`'s session-simulation convention (`set local role authenticated` + `set_config('request.jwt.claims', ...)`, fixtures seeded as the connecting role, `reset role` before asserting on committed table state) for `check_out()`/`check_out_member()`.
  - [x] Assert (AC #1, member path): a member-claim session with an open check-in calling `check_out()` succeeds (`lives_ok`), and the row's `checked_out_at` is set (not null) with `checkout_type = 'manual'`.
  - [x] Assert: a member-claim session with no open check-in calling `check_out()` is rejected via `throws_like('%has no open check-in%')`.
  - [x] Assert (AC #1, staff path): owner-, manager-, and receptionist-claim sessions can each call `check_out_member()` on an open session and succeed, with `checkout_type = 'manual'`.
  - [x] Assert: a coach-claim session calling `check_out_member()` is rejected via `throws_like('%permission denied%')`.
  - [x] Assert cross-tenant: a Gym B staff-claim session's `check_out_member()` call against a Gym A member's id is rejected via `throws_like('%not found%')`, and the Gym A member's session remains open.
  - [x] Assert (AC #2/#3, cron job): seed an open session whose `checked_in_at` is older than its gym's `checkin_timeout_hours`, plus a control session still within the window (using a distinct gym, so the two don't share a `checkin_timeout_hours`) — call `run_check_in_auto_timeout_job()` directly (`lives_ok`), confirm the stale session is now `checked_out_at = checked_in_at + timeout interval` with `checkout_type = 'auto'`, and the control session is still open.
  - [x] Assert: exactly one `job_runs` row with `job_name = 'check_in_auto_timeout' and status = 'success'` is written by the call above.
  - [x] Assert: **no** `audit_log` row is written for the auto-closed session (proves Scope Note #2's "no per-session audit entry" decision — `select count(*) from audit_log where target_entity_id = <the closed session id>` is `0`).
  - [x] Assert idempotency: calling `run_check_in_auto_timeout_job()` a second time immediately is `lives_ok` and leaves the already-closed session's `checked_out_at` unchanged (no double-processing error, matching 0021's own idempotency assertion).

- [x] **Task 6: Validation**
  - [x] `pnpm run typecheck` (all packages, 0 errors) and `node scripts/check-i18n-key-parity.mjs` (0 errors).
  - [x] `supabase test db` — confirm the new file passes and zero regressions in the existing suite (baseline: 282 passing as of Story 3.4).

### Review Findings

- [x] [Review][Patch] `check_out_member()` writes no audit_log entry for a successful staff-driven checkout — `supabase/migrations/0024_check_out_manual_auto_timeout.sql:144-182`. **Fixed:** added a `log_audit_event()` call mirroring `renew_subscription()`'s pattern (action type `attendance_manual_checkout`, target `member`, metadata `attendance_event_id`/`checked_out_at`). Covered by a new pgTAP assertion in `check_out_manual_auto_timeout.test.sql`.
- [x] [Review][Patch] `check_out()` is missing the deactivated-member guard that its own cited precedent `check_in()` has — `supabase/migrations/0024_check_out_manual_auto_timeout.sql:108-116`. `check_in()` (0023, lines ~106-116) explicitly selects `deactivated_at` alongside the member id and raises `'check_in: member is deactivated'` if set, with a comment noting this is "defense in depth... reachable by any holder of a valid session token, not just through the app's own navigation gate." `check_out()` selects only `id` (not `deactivated_at`) and has no equivalent check, so a deactivated member with a still-valid session token can call `check_out()` successfully. **Fixed:** `check_out()` now selects `deactivated_at` and raises `'check_out: member is deactivated'`, mirroring `check_in()` exactly. Covered by two new pgTAP assertions.
- [x] [Review][Defer] Race between manual check-out and the 15-minute auto-timeout cron job [`supabase/migrations/0024_check_out_manual_auto_timeout.sql:44-50,118-125,171-178`] — deferred, pre-existing convention. If the cron job closes a session in the same window a manual check-out targets it, the manual call raises the generic "has no open check-in" error instead of a distinguishable "already closed" outcome. Low-probability window; matches architecture.md's documented "no advisory lock, no automatic retry" convention already established by `renew_subscription()` (0022) and `check_in()` (0023).
- [x] [Review][Defer] No client-side min/max/step bounds on the new `checkinTimeoutHours` number input [`apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:387-394`] — deferred, pre-existing. The existing `gracePeriodDays` and `capacity` fields (and `alertAutoDismissMinutes`) follow the identical pattern of relying solely on Zod validation after submit, with no `min`/`max`/`step` attributes on the `<Input>` itself.
- [x] [Review][Defer] No DB-level upper-bound constraint on `checkin_timeout_hours` [`supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql:28-29`] — deferred, pre-existing. The column's DB constraint is `check (checkin_timeout_hours > 0)` only; the `1-24` upper bound is Zod-only, matching `gracePeriodDays`/`alertAutoDismissMinutes`'s identical app-layer-only upper-bound convention.
- [x] [Review][Defer] `checkOutMember()` discards the RPC's returned `attendance_events` row, returning only `{ error }` [`apps/dashboard/services/attendance.ts:14-20`] — deferred, pre-existing/spec-literal. This matches Scope Note #4's code block exactly as specified; worth reconsidering once Story 3.6 builds the consuming "Check Out" button UI and needs the checkout timestamp to display.
- [x] [Review][Defer] No test coverage for `apps/dashboard/services/attendance.ts`'s `checkOutMember()` — deferred, pre-existing. No `.test.ts` files exist anywhere under `apps/dashboard/services/` today; this is a codebase-wide gap, not specific to this story.
- [x] [Review][Defer] Non-integer input (e.g. `"1.5"`) into `checkinTimeoutHours` surfaces Zod's raw "expected int, received float" message instead of the tailored range copy [`apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:190-198`] — deferred, pre-existing. The NaN-substitution loop only catches `Number.isNaN`, not int-vs-float mismatches; `gracePeriodDays`, `capacity`, and `alertAutoDismissMinutes` share the identical gap.

## Dev Notes

- **This story is backend-only.** No dashboard route, no mobile screen change. Do not create `apps/dashboard/app/(dashboard)/attendance/` or touch `apps/mobile/src/app/(tabs)/checkin.tsx` — both are Story 3.6's job (and 3.6 for the dashboard side specifically; no mobile check-out UI is designed anywhere in V1).
- **Three independent `pg_cron` jobs is the architecture, full stop** — the PRD/epics "same job as subscription lifecycle" phrasing predates or simply doesn't reflect this and must not be followed literally (Scope Note #1). If `dev-story` or `code-review` finds itself merging this logic into `run_subscription_lifecycle_job()`, stop and re-read Scope Note #1.
- **Do not audit-log individual auto-closed sessions.** This is the most likely mistake a dev agent pattern-matching off Story 3.4 would make — 3.4's per-request stale-close audit entry was driven by that story's own explicit AC wording, which this story's ACs do not repeat, and FR-080's canonical audit-trigger list excludes attendance auto-close entirely.
- Reuse `log_audit_event()` (0007) only for the cron job's own **failure** path (mirrors `run_subscription_lifecycle_job()`'s `subscription_lifecycle_job_failure` pattern) — action type `check_in_auto_timeout_job_failure`.
- `checkin_timeout_hours`'s existing `check (> 0)` constraint (0023) is the DB floor; the new Zod `min(1).max(24)` in `gymSettingsSchema` is the app-layer UX bound — don't touch the DB constraint.
- `check_out()`/`check_out_member()` are unused by any client code in this story (no UI calls them yet) — this matches 3.1/3.2's own "ship the RPC + service function, defer the UI" precedent exactly, it is not a gap to fill in this story.

### Project Structure Notes

New files:
```
supabase/migrations/0024_check_out_manual_auto_timeout.sql
supabase/tests/check_out_manual_auto_timeout.test.sql
apps/dashboard/services/attendance.ts
```

Modified files:
```
packages/types/src/schemas/gym.ts                              # + checkinTimeoutHours field
apps/dashboard/services/gym-settings.ts                        # + checkinTimeoutHours read/write
apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx        # + checkinTimeoutHours field/section
apps/dashboard/app/(dashboard)/settings/actions.ts              # + checkin_timeout_hours audit metadata
apps/dashboard/locales/en.json                                 # + settings.sections.attendance, fields.checkinTimeout*, errors.checkinTimeoutRange
apps/dashboard/locales/fr.json                                 # same keys, FR copy
```

No changes to `apps/mobile`, `apps/super-admin`, or any existing migration file.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5] — literal AC wording
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-044 through FR-048] — full FR text; FR-045's "same pg_cron job" wording (superseded by architecture.md, Scope Note #1), FR-069's Settings field list (predates FR-045's per-gym timeout config — not authoritative for this story; 3.4's own Scope Note #2 already established this story owns the Settings field)
- [Source: _bmad-output/planning-artifacts/architecture.md#Background jobs row, "three independent pg_cron triggers... check-in auto-timeout"] — the controlling decision over FR-045's imprecise wording
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Role visibility matrix, line 187-193] — Attendance page visible to Receptionist/Manager/Owner, not Coach — the role array `check_out_member()` follows
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-11 Attendance, line 1239] — "Check Out" per-row action confirms the dashboard UI itself is AD-11/Story 3.6's scope, not this story's
- [Source: supabase/migrations/0021_subscription_lifecycle_cron.sql] — `run_subscription_lifecycle_job()`, the exact pg_cron job / job_runs / failure-audit pattern this story's new independent job follows
- [Source: supabase/migrations/0022_manual_renewal_reset.sql] — `renew_subscription()`, the staff-self-role-check + gym-scoped-lookup pattern `check_out_member()` follows
- [Source: supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql] — `check_in()` (member self-service pattern `check_out()` follows) and the existing `gyms.checkin_timeout_hours` column/constraint this story exposes in Settings
- [Source: supabase/migrations/0006_attendance.sql, 0008_job_runs.sql] — `attendance_events`/`job_runs` table shapes (`checkout_type` check constraint already accepts `'manual'`/`'auto'`)
- [Source: _bmad-output/implementation-artifacts/3-4-member-check-in-one-open-session-enforcement.md#Scope Note #2] — explicit deferral of the Settings UI field to this story
- [Source: apps/dashboard/services/subscriptions.ts, packages/types/src/schemas/subscription.ts] — the "backend-only story still ships a service-layer function + schema, no actions.ts/UI" precedent `attendance.ts`/`check_out_member` follows
- [Source: apps/dashboard/services/gym-settings.ts, apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx, actions.ts] — the Settings read/write/form pattern the new field follows exactly (modeled on `alertAutoDismissMinutes`)
- [Source: apps/dashboard/locales/en.json/fr.json#settings.*] — existing key structure/naming convention for the new keys
- [Source: supabase/tests/subscription_lifecycle_cron.test.sql] — direct-call (no real cron timing) + job_runs + idempotency test convention for the new cron job
- [Source: supabase/tests/manual_renewal_reset.test.sql] — session-simulation + role-array + cross-tenant test convention for `check_out()`/`check_out_member()`
- [Source: packages/types/src/errors.ts] — `mapSupabaseError`'s existing mapping precedent (and why `check_out_member`'s raises stay deliberately unmapped in this story)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` (via WSL) applied migration `0024` cleanly against the full existing migration history (0001–0023), no errors.
- `pnpm run typecheck` (all 4 packages) — 0 errors.
- `node scripts/check-i18n-key-parity.mjs` — 0 errors (dashboard locale count: 220 → 226 keys, EN/FR in parity).
- `supabase test db` (full suite, local via WSL Docker): 303/303 passing (282 baseline from Story 3.4 + 21 new in `check_out_manual_auto_timeout.test.sql`), zero regressions.

### Completion Notes List

- AC #1 implemented via two new SECURITY DEFINER RPCs (migration `0024`): `check_out()` (member self-service, mirrors `check_in()`'s exact shape — no parameter, derives member/gym from the caller's session) and `check_out_member(p_member_id uuid)` (staff-driven, mirrors `renew_subscription()`'s shape — role array `['owner','manager','receptionist']`, gym-scoped lookup folds cross-tenant/nonexistent into one uniform "not found"). Neither is called by any client code in this story (no UI exists yet), matching 3.1/3.2's "ship the RPC + service function, defer the UI" precedent per Scope Note #4/#5.
- AC #2/#3 implemented via `run_check_in_auto_timeout_job()`, a new, fully independent pg_cron job (own function, own `job_runs` rows under `job_name = 'check_in_auto_timeout'`, own `cron.schedule(..., '*/15 * * * *', ...)`) — deliberately *not* folded into `run_subscription_lifecycle_job()`, per Scope Note #1's architecture.md-controlled decision overriding the story's own imprecise AC wording. No per-session `audit_log` row is written for auto-closed sessions (only the job's own failure path calls `log_audit_event`), per Scope Note #2's explicit "do not audit-log individual auto-closes" instruction, verified by a dedicated test assertion (0 audit_log rows for the closed session's id).
- `gyms.checkin_timeout_hours` (added by Story 3.4, deferred to this story) is now Settings-editable: `packages/types`' `gymSettingsSchema` gains a `checkinTimeoutHours` field (`min(1).max(24)`, app-layer bound on top of the DB's existing `check (> 0)` constraint), `gym-settings.ts` reads/writes the column, and a new "Attendance" section/field was added to `SettingsForm.tsx` between the Membership and Front-Desk Alerts sections, following the `alertAutoDismissMinutes` field's exact structure. `actions.ts`'s audit metadata gains `checkin_timeout_hours`. New EN/FR i18n keys added, parity-checked.
- New `apps/dashboard/services/attendance.ts` (`checkOutMember()`), following `subscriptions.ts`'s "backend-only story still ships the service-layer function, no `actions.ts`/UI yet" precedent — Story 3.6 is the first consumer.
- pgTAP: `check_out_manual_auto_timeout.test.sql`, 21 assertions covering the member self-service path (success + no-open-session rejection), the staff path across all three permitted roles, coach-role denial, cross-tenant denial (with the target session proven to remain open), the cron job's stale-vs-control closing behavior (using two gyms with different `checkin_timeout_hours` so the same elapsed time is stale for one and not the other), the `job_runs` success row, the "no audit_log row" assertion, and idempotency of a second consecutive job run.
- No dashboard route, mobile screen, or existing migration file touched, per Scope Note #5 — this story is backend-only, exactly like 3.1/3.2.

### File List

**New:**
- `supabase/migrations/0024_check_out_manual_auto_timeout.sql`
- `supabase/tests/check_out_manual_auto_timeout.test.sql`
- `apps/dashboard/services/attendance.ts`

**Modified:**
- `packages/types/src/schemas/gym.ts` (+ `checkinTimeoutHours` on `gymSettingsSchema`)
- `apps/dashboard/services/gym-settings.ts` (+ `checkinTimeoutHours` read/write)
- `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx` (+ `checkinTimeoutHours` field + new `attendance` section)
- `apps/dashboard/app/(dashboard)/settings/actions.ts` (+ `checkin_timeout_hours` audit metadata)
- `apps/dashboard/locales/en.json` (+ `settings.sections.attendance`, `settings.fields.checkinTimeout*`, `settings.errors.checkinTimeoutRange`)
- `apps/dashboard/locales/fr.json` (same keys, FR copy)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)

No changes to `apps/mobile`, `apps/super-admin`, or any existing migration file (Scope Note #5).

## Change Log

- 2026-07-24: Story implemented. Added migration `0024`: `run_check_in_auto_timeout_job()` (own independent pg_cron job, every 15 minutes, per architecture.md's three-independent-jobs decision — AC #2/#3), `check_out()` (member self-service RPC, AC #1), and `check_out_member(p_member_id uuid)` (staff RPC for owner/manager/receptionist, AC #1). `gyms.checkin_timeout_hours` (added by Story 3.4) is now Settings-editable end-to-end (`gymSettingsSchema`, `gym-settings.ts`, `SettingsForm.tsx`'s new Attendance section, `actions.ts` audit metadata, EN/FR i18n keys). New `apps/dashboard/services/attendance.ts` (`checkOutMember()`), unused by any UI in this story (Story 3.6's job), matching 3.1/3.2's backend-first precedent. No per-session audit logging of auto-closes, per Scope Note #2. New pgTAP suite (`check_out_manual_auto_timeout.test.sql`, 21 assertions). `pnpm run typecheck` (4/4 packages) and i18n-parity clean. `supabase test db`: 303/303 passing (282 baseline + 21 new), zero regressions. Backend-only story — no dashboard route or mobile screen touched. Status set to `review`.
