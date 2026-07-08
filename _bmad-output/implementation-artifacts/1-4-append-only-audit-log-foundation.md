---
baseline_commit: 87a71b0eef36ae47cf398615558beae5e0638aa5
---

# Story 1.4: Append-Only Audit Log Foundation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform operator,
I want the audit log to exist and be structurally impossible to alter from the very first sensitive action onward,
so that every subsequent epic can log to it, and the audit trail is trustworthy from day one.

## Acceptance Criteria

1. **Given** the `audit_log` table, **When** it is created (alongside the other core tables, before any feature epic ships), **Then** no role — including Super Admin and `service_role` — has UPDATE or DELETE grants on it, enforced at the grant level beneath RLS. [Source: epics.md#Story 1.4]
2. **Given** any migration, script, or application code, **When** it attempts an UPDATE or DELETE against `audit_log`, **Then** the operation fails. [Source: epics.md#Story 1.4]
3. **Given** the table's columns, **When** a record is written, **Then** it captures actor (user ID + display name), action type, target entity ID, relevant fields (amount/method/reason as applicable), and a UTC timestamp — the shape every later story's "audit-logged" acceptance criteria writes against. [Source: epics.md#Story 1.4]

## Tasks / Subtasks

- [ ] **Task 1: Create the `audit_log` table** (AC: #1, #3)
  - [ ] `supabase/migrations/0007_audit_log.sql` — this file number is reserved for this story; Story 1.3 explicitly skipped it (see Previous Story Intelligence)
  - [ ] Columns: `id uuid primary key default gen_random_uuid()` (see Dev Notes → Open Question 1 on why this deviates from architecture.md's literal text), `gym_id uuid references gyms(id)` **nullable** (see Dev Notes → Open Question 2), `actor_id uuid references users(id)` **nullable** (see Dev Notes → Open Question 2), `actor_display_name text not null` (denormalized at write time — must survive even if the `users` row's name later changes), `action_type text not null` (free text, not an enum — see Dev Notes → Why not an enum), `target_entity_id text` nullable, `target_entity_type text` nullable, `metadata jsonb not null default '{}'::jsonb` (holds amount/method/reason/etc. — the varying "relevant fields" AC #3 requires), `created_at timestamptz not null default now()`
  - [ ] `target_entity_id`/`target_entity_type` are deliberately **not** foreign keys — architecture.md's Entity Relationships section notes `audit_log (N) ──> users (actor)` as the only relationship, explicitly "no reverse FK constraints needed" for targets, since a target can be any entity type (member, payment, job_runs row, etc.) and the log must survive even if the target row is later deleted
  - [ ] Indexes: `idx_audit_log_gym_id`, `idx_audit_log_actor_id`, `idx_audit_log_created_at` — FR-081 requires filtering by date range and actor, FR-068 requires pagination; add these now since the table is being created now, per the same "index every filterable column at creation time" discipline Story 1.3 applied to `gym_id`
  - [ ] `alter table audit_log enable row level security;` in the same migration — no "open table" window (NFR-001 pattern, applied to every table so far)
  - [ ] **Add zero RLS policies in this migration** — matches Story 1.3's Scope Boundary precedent: `audit_log` stays pure deny-all until its owning feature story adds real policies. The Audit Log page's read policy (Manager/Owner-only, per FR-068/081) belongs to Epic 7 Story 7.2, not this story. Do not add a read policy here even though it might seem convenient.

- [ ] **Task 2: Enforce append-only at the grant level** (AC: #1, #2)
  - [ ] In the same migration: `grant select, insert on audit_log to authenticated, service_role;` — deliberately omit `anon` (no unauthenticated flow touches audit data) and deliberately omit `update`, `delete` entirely
  - [ ] Also add an explicit `revoke update, delete on audit_log from authenticated, service_role, anon, public;` immediately after the grant, even though those privileges were never granted — this is defense-in-depth against a future migration accidentally adding a broader `grant ... on all tables in schema public` statement that would silently re-open UPDATE/DELETE on this one table; an explicit REVOKE in this table's own migration is the permanent record of intent that survives such a mistake
  - [ ] **Do not attempt to block the Postgres superuser (`postgres`) role itself** — migrations run as `postgres`, which is a superuser and inherently bypasses all GRANT/REVOKE privilege checks (a Postgres platform invariant, not a gap this story can close). AC #1's "no role — including Super Admin — has UPDATE or DELETE grants" refers to the **application-level** `super_admin` app_role (the JWT claim from Story 1.3's hook), which only ever reaches Postgres as `authenticated` or `service_role` — both of which this task correctly blocks. Document this distinction in Completion Notes so it isn't mistaken for an unresolved gap.

- [ ] **Task 3: `log_audit_event()` canonical write function** (supports AC #3 — recommended, see Dev Notes → Open Question 3 before starting)
  - [ ] Add to `0007_audit_log.sql` (or a same-story follow-up migration if easier to review separately): `log_audit_event(p_gym_id uuid, p_action_type text, p_target_entity_id text, p_target_entity_type text, p_metadata jsonb default '{}'::jsonb) returns uuid`, `security definer`, `set search_path = public` — same pattern as `custom_access_token_hook`/`private.gym_id()` from Story 1.3 (0009), since callers running as `authenticated` cannot INSERT directly (deny-all RLS, no INSERT policy — see Task 1)
  - [ ] Inside the function: resolve `actor_id` from `auth.uid()` and look up `actor_display_name` from `public.users.display_name` — do **not** accept actor as a caller-supplied parameter (would let any caller spoof the actor field, defeating the audit trail's own trustworthiness)
  - [ ] Handle the no-session case (`auth.uid()` is null) for system/cron callers: allow `actor_id` to stay `NULL` with `actor_display_name` set to a caller-supplied system label (e.g. `'system:subscription_lifecycle_cron'`) — this is why `actor_id` is nullable (Open Question 2). A `pg_cron` job runs with no `auth.uid()` session at all.
  - [ ] `grant execute on function log_audit_event to authenticated, service_role;` (not `anon`)
  - [ ] This function is the **only** intended write path into `audit_log` for application code — record this as a convention in Dev Notes/decisions.md so Epic 2/4/5/7 stories that need to write audit records call this function rather than inserting directly (which would fail anyway under deny-all RLS from anything but `service_role`)

- [ ] **Task 4: pgTAP tests** (AC: #1, #2, #3)
  - [ ] `supabase/tests/audit_log_immutable.test.sql`:
    - Assert `UPDATE audit_log SET ... ` fails for a role set to `authenticated` (via `set local role authenticated` or `set_config('request.jwt.claims', ...)` matching Story 1.3's pattern)
    - Assert the same UPDATE fails for `service_role` too — this is the test that actually proves AC #1's "beneath RLS" claim: `service_role` bypasses RLS in Supabase (has `BYPASSRLS`), so if this test only checked RLS it would pass for the wrong reason; it must assert the grant-level REVOKE blocks `service_role` specifically, since RLS bypass alone would otherwise let `service_role` update freely
    - Assert `DELETE` fails identically for both roles
    - Assert `service_role` **can** INSERT (has table grant + bypasses RLS) — a baseline positive test so the deny-all tests above aren't vacuously trivial
    - Assert a direct `authenticated`-role INSERT (bypassing `log_audit_event()`) is rejected by RLS (`new row violates row-level security policy` — note this is a hard error, not "0 rows," since INSERT deny-all behaves differently from SELECT deny-all; document this distinction inline in the test file so it doesn't read as a bug)
  - [ ] If Task 3's function is built, add assertions to the same file (or `log_audit_event.test.sql`): calling it as `authenticated` with a seeded session inserts exactly one row with the session's own user id as `actor_id` and the correct `display_name` looked up from `users` (not caller-supplied); calling it with no session (`auth.uid()` null) and an explicit system label succeeds with `actor_id` null and `actor_display_name` set to that label
  - [ ] Confirm `supabase test db` picks up the new file automatically (no registration step beyond the file existing in `supabase/tests/`, per Story 1.3's CI wiring)

- [ ] **Task 5: Record deviations in `docs/decisions.md`** (housekeeping — matches Stories 1.2/1.3's established pattern)
  - [ ] Add a dated entry covering: (a) the PK-type deviation from architecture.md's "bigint identity + UUID" text (Open Question 1), noting `attendance_events` already set the actual in-repo precedent this story follows; (b) the nullable `gym_id`/`actor_id` design and why (Open Question 2); (c) `log_audit_event()` as the canonical write path, if built (Open Question 3)
  - [ ] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` once the migration lands, matching Story 1.3's closing step — do not wire it into any app's `index.ts` exports (still deferred, per Story 1.1's review)

## Dev Notes

### Scope Boundary (read first)

This story creates the `audit_log` table, its grant-level append-only enforcement, and (recommended) the single canonical insert function. It does **not**:
- Add any read/business RLS policy to `audit_log` — that's Epic 7 Story 7.2 (Audit Log Dashboard Page), which needs Manager/Owner-only, gym-scoped read access with date-range/actor filtering
- Wire any actual call site that writes a real audit record — every "logged to the audit log" acceptance criterion in Epic 2 (member deactivation), Epic 4 (payments/refunds), Epic 5 (coach assignment), and Epic 1 Stories 1.5–1.7 (Super Admin actions) is that story's own job to call `log_audit_event()` (or insert directly if Task 3 is skipped) — this story only makes that possible
- Story 7.1 (Audit Record Coverage Verification) is the explicit later checkpoint that confirms every action type in FR-080 actually got wired up — this story is not that verification
[Source: epics.md#Story 7.1, #Story 7.2]

### Why not an enum for `action_type`

Every other closed-set column in this schema uses a Postgres `enum` (`gym_status`, `member_role`, etc., all in `0001_extensions_and_enums.sql`). `action_type` deliberately breaks that pattern: the full list of action types spans five future epics (Epic 1 Super Admin actions, Epic 2 member management, Epic 4 payments/refunds, Epic 5 coach assignments, plus `pg_cron` job failures) that don't all exist yet, and Postgres enum values, once added, cannot be removed or reordered without recreating the type. Free text avoids forcing every future epic's story to modify this migration's enum. Document this reasoning in `docs/decisions.md` since "why doesn't this table follow the enum convention" is exactly the kind of question a future contributor will ask.

### Open Questions for User/Architect Sign-Off

These weren't resolved by the PRD/epics/architecture and materially affect this story's schema. Recommended defaults are already written into the Tasks above; flagging here in case you want to override before dev starts (same pattern as Stories 1.2/1.3):

1. **Primary key type: plain UUID, not architecture.md's literal "bigint identity + separate UUID."** architecture.md's Data Architecture section states high-write append-only tables (it names `attendance`, `audit_log` specifically) should use `bigint identity` plus a separate UUID for external reference. **In practice, `attendance_events` (built in Story 1.3, `0006_attendance.sql`) used a plain `uuid primary key default gen_random_uuid()` instead** — the same pattern as every other table in the schema — with no recorded deviation note. Recommended: follow the actual in-repo precedent (`attendance_events`) rather than architecture.md's unimplemented text, so `audit_log` doesn't become the only bigint-PK table in the entire schema, which would be a bigger inconsistency than the one it's avoiding. Confirm, or direct the dev to switch both `audit_log` and (in a separate follow-up) `attendance_events` to `bigint identity` to match architecture.md literally.
2. **`gym_id` and `actor_id` are both nullable**, unlike every other gym-scoped table's `gym_id not null`. Reason: `pg_cron` job failures (FR-027, FR-080) generate audit records that aren't scoped to any one gym (`job_runs` itself has no `gym_id` either, per architecture.md's Entity Relationships — "global, not gym-scoped"), and have no authenticated user session to derive an actor from. Confirm this is acceptable, or specify a different rule (e.g. a sentinel "platform" gym row) if `NULL` gym-scoping is undesirable for the eventual Audit Log page's filtering UX.
3. **`log_audit_event()` SECURITY DEFINER function (Task 3) is recommended but not explicitly required by the ACs.** It exists so every future epic has one canonical, actor-spoofing-resistant write path instead of each story inventing its own insert pattern — directly analogous to `private.gym_id()`/`custom_access_token_hook()` being built in Story 1.3 as reusable infrastructure ahead of the features that need them. Confirm this is in scope for this story, or defer it to whichever Epic 2/4 story writes the first real audit record.

### Previous Story Intelligence

- **Table-level GRANTs are checked before RLS** — Story 1.3 discovered this the hard way (manual end-to-end testing, not pgTAP): without an explicit `GRANT`, a query against a deny-all RLS table returns a hard "permission denied for table" error instead of the intended "0 rows, no error." This story's Task 2 grants are load-bearing for the same reason, and Task 4's tests must distinguish "blocked by missing grant" from "blocked by RLS/REVOKE" when asserting failures. [Source: 1-3-tenant-isolation-foundation-jwt-claims-hook-rls-deny-all.md#Debug Log References]
- **`service_role` bypasses RLS but not table grants.** This is the crux of AC #1 ("beneath RLS") — Story 1.3 didn't need this distinction (its tables all grant full CRUD to `service_role`), but this story's whole point depends on it: REVOKE at the grant level is what stops `service_role`, since RLS alone cannot.
- **`SECURITY DEFINER` + `set search_path = public` is the established pattern** for any function that must run with elevated privileges (bypass RLS or reach schemas the caller's role can't) — copy `private.gym_id()`/`custom_access_token_hook()`'s shape exactly for `log_audit_event()` if built, including never letting it raise for expected conditions.
- **`docs/decisions.md` dated-entry format** is established (see file) — one entry per decision, newest first, with a `**Decision N —**` heading per distinct point. Follow it exactly for Task 5.
- Story 1.3's own review found and fixed real bugs only via manual end-to-end testing that pgTAP alone wouldn't have caught (RLS blocking the hook's own internal lookups). No equivalent "real login flow" exists for `audit_log` to exercise the same way, but if `log_audit_event()` is built, exercising it via `psql` as an `authenticated`-role session (not just pgTAP calling it as `postgres`) is worth doing before marking this story done, since pgTAP tests calling a `SECURITY DEFINER` function don't exercise the caller-role boundary the function exists to enforce.

### Git Intelligence Summary

- No new commits since Story 1.3 (`87a71b0` is still HEAD). Stories 1.2 and 1.3's actual work (migrations 0001–0006, 0008–0009, pgTAP tests, `docs/`) is present on disk but **still uncommitted** (`git status` shows them untracked) — not this story's concern to fix, but be aware the working tree already contains all prior migrations this story builds on.
- `0007_audit_log.sql` is the one gap in the migration sequence (0001–0006, 0008, 0009 exist; 0007 does not) — confirms this story's file name/number without ambiguity.

### Testing Standards

- pgTAP, `supabase/tests/*.test.sql`, run via `supabase test db` — same as Story 1.3, no new CI job needed (the `rls-tests` job from Story 1.3 already runs every file in `supabase/tests/`).
- No app-level (Next.js/Expo) code changes expected — 100% `supabase/` (one migration, one or two test files) plus a `docs/decisions.md` entry.

### Project Structure Notes

- Matches `architecture.md`'s Complete Project Directory Structure for `supabase/migrations/0007_audit_log.sql` and `supabase/tests/`, with the PK-type deviation noted in Open Question 1.
- `0012_rls_policies_audit_log.sql` (the audit log's read policies) is explicitly out of scope — future story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: Append-Only Audit Log Foundation] — story statement and ACs
- [Source: _bmad-output/planning-artifacts/epics.md#6.16 Audit Log, FR-079–081] — read-only page, filtering/export, action-type coverage list
- [Source: _bmad-output/planning-artifacts/epics.md#NonFunctional Requirements, NFR-004] — append-only enforcement wording ("no migration, script, or application code")
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] — RLS policy strategy, sensitive-table-gets-own-migration rule
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1, #Story 7.2] — downstream consumers of this story's table (coverage verification, dashboard page)
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — bigint-identity+UUID convention for high-write append-only tables (see Open Question 1 for the in-repo deviation)
- [Source: _bmad-output/planning-artifacts/architecture.md#Entity Relationships] — `audit_log (N) ──> users (actor)`, no reverse FK needed for targets; `job_runs` is global/not gym-scoped (informs Open Question 2)
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure] — `0007_audit_log.sql` file name and position in the migration sequence
- [Source: _bmad-output/implementation-artifacts/1-3-tenant-isolation-foundation-jwt-claims-hook-rls-deny-all.md#Debug Log References, #Completion Notes List] — table-grants-before-RLS discovery, SECURITY DEFINER pattern, baseline GRANT precedent
- [Source: supabase/migrations/0002_gyms_and_tiers.sql, 0006_attendance.sql, 0009_auth_hook_gym_claims.sql] — read directly for exact in-repo conventions (grant comments, RLS-enable placement, SECURITY DEFINER function shape) this story must match
- [Source: docs/decisions.md] — established dated-entry format for recording schema/naming deviations

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
