# Decisions Log

Dated entries recording spike/decision outcomes that can't be changed later without cost (region, provider selections, etc.). One entry per decision — newest first.

---

## 2026-07-08 — Append-only audit log foundation: schema deviations, recorded during Story 1.4

**Decision 1 — `audit_log.id` is a plain UUID primary key, not architecture.md's literal "bigint identity + separate UUID" text.** architecture.md's Data Architecture section names `attendance`/`audit_log` specifically as tables that should use `bigint identity` plus a separate UUID for external reference. In practice, `attendance_events` (Story 1.3, `0006_attendance.sql`) already used a plain `uuid primary key default gen_random_uuid()` instead, with no deviation recorded at the time. `audit_log` follows that actual in-repo precedent rather than architecture.md's unimplemented text, so it isn't the one bigint-PK table in an otherwise all-UUID schema. If this is later reconsidered, `attendance_events` should be revisited in the same pass for consistency.

**Decision 2 — `audit_log.gym_id` and `audit_log.actor_id` are both nullable**, unlike every other gym-scoped table's `gym_id not null`. `pg_cron` job-failure audit records (FR-027/FR-080) aren't scoped to any one gym — `job_runs` itself has no `gym_id` either (architecture.md Entity Relationships: "global, not gym-scoped") — and have no authenticated session to derive an actor from. No gym-switcher/sentinel-gym-row scheme was introduced; `NULL` is the direct representation of "platform-level, not gym-scoped."

**Decision 3 — `log_audit_event()` is the single canonical write path into `audit_log`.** A `SECURITY DEFINER` Postgres function (`0007_audit_log.sql`), mirroring the pattern established by `private.gym_id()`/`custom_access_token_hook()` in Story 1.3. Derives `actor_id`/`actor_display_name` from `auth.uid()` + `public.users.display_name` internally rather than accepting them as parameters, so no caller can spoof the audit trail's own actor field. System/cron callers (no session) pass an explicit label instead. Unlike the Story 1.3 hook functions, it deliberately does **not** swallow exceptions — a malformed call (e.g. a missing `action_type`) is a caller bug that should surface immediately rather than silently producing no audit record. Every future epic that needs to write an audit record (Epic 1 Stories 1.5–1.7, Epic 2, Epic 4, Epic 5) should call this function rather than inserting directly, which would fail under deny-all RLS for anything but `service_role` anyway.

**Decision 4 — `audit_log.action_type` is free text, not a Postgres enum**, breaking the pattern every other closed-set column in this schema follows (`gym_status`, `member_role`, etc.). The full list of action types spans five future epics that don't exist yet, and enum values, once added, cannot be removed or reordered without recreating the type — free text avoids forcing every future epic's story to modify this migration's enum.

**Why these are recorded here, not just in code comments:** same category as the region/claims decisions above — the schema shape (nullability, PK type, write-path convention) is hard to change once real audit records and calling code from later epics depend on it.

---

## 2026-07-06 — Tenant isolation foundation: three deviations from architecture.md, recorded during Story 1.3

**Decision 1 — RLS helper function lives in a new `private` schema, not `auth`.** architecture.md specifies `auth.gym_id()`. Verified hands-on (local Postgres 17) that migrations run as the `postgres` role, which does not have `CREATE` privilege on the `auth` schema (owned by `supabase_admin`) — confirmed via `permission denied for schema auth`. Supabase's own RLS documentation shows custom RLS helper functions living in a dedicated non-exposed schema (their example: `private`), not inside `auth`. Implemented as `private.gym_id()` instead; every RLS policy in this project should call it under that name. `private` is not in `supabase/config.toml`'s exposed `[api] schemas`, so it is not reachable via PostgREST.

**AC #1 note:** Story 1.3's AC #1 as literally worded ("the `auth.gym_id()` helper function exists") is not strictly met — the function is `private.gym_id()`. AC #1 is treated as satisfied via this accepted, documented schema-naming deviation (above), not a literal name match. Flagged and accepted during code review of Story 1.3 (2026-07-06), same pattern as Story 1.2's AC #1 tiebreak note.

**Decision 2 — the gym-scoped role claim is named `app_role`, not `role`.** FR-003 describes injecting "`gym_id`/`role` claims" into the JWT. Supabase's Custom Access Token Hook documentation lists `role` among the hook's required/reserved claims — PostgREST/GoTrue use it to `SET ROLE` to `anon`/`authenticated`/`service_role` for the Postgres session. Overwriting it risked breaking that mechanism platform-wide. Confirmed via manual end-to-end login testing that the real GoTrue-issued JWT's `role` claim stays `authenticated` as expected when the gym-role is injected under `app_role` instead. Any future RLS policy or app code reading the gym-scoped role must read `app_role`, not `role`.

**Decision 3 — multi-gym-membership resolution rule (V1 limitation).** FR-001 allows a user to hold `members` rows at more than one gym, but a JWT can only carry one `gym_id`/`app_role` pair. No PRD/epics/architecture text specifies which membership wins. V1 rule: the claims hook selects the single most-recently-created, non-deactivated `members` row for that user. No gym-switcher exists in V1 — a user active at two gyms simultaneously only ever sees the most recent one in their session. Revisit if this becomes a real pilot scenario (unlikely at NFR-009's ~30-members/1–3-gyms pilot scale).

**Why these are recorded here, not just in code comments:** all three are hard to change once real user data and JWT-reading code (RLS policies, future Server Actions) depend on the current shape — same category as the region decision above.

**Also caught during this story, fixed in-migration (not a "decision" needing sign-off, noted for context):** the claims hook's own internal lookups (`SELECT` on `users`/`members`) are themselves subject to RLS, since the hook runs as `supabase_auth_admin`, which does not have the `BYPASSRLS` attribute. With `users`/`members` deny-all (this story's own design), the hook could not read the very membership data it needs to compute claims — a bootstrapping deadlock. Fixed by marking `custom_access_token_hook` `SECURITY DEFINER` (runs as its owner, `postgres`, which does bypass RLS). Caught only via manual end-to-end login testing against the real GoTrue flow — pgTAP alone would not have caught it, since pgTAP calls the function directly as `postgres`, which was never subject to the bug.

---

## 2026-07-05 — Supabase Cloud region: EU West Ireland (`eu-west-1`) selected

**Decision:** EU West Ireland (`eu-west-1`). The already-existing Supabase Cloud project (`vfxezibagiznrirdwkwh`, created during Story 1.1) already lives here — **no project swap required**.

**Context:** NFR-010 requires the Supabase Cloud project to be in the AWS region closest to Cameroon among the two candidates — EU West Ireland (`eu-west-1`) or Frankfurt (`eu-central-1`) — to keep the front-desk alert's <3s end-to-end budget (FR-052) achievable. Region cannot be changed after data is written, so this had to be confirmed before any schema/data lands (Story 1.3+).

**Starting state:** The existing project was created during Story 1.1's dev-workflow course correction (see `1-1-monorepo-starter-initialization.md` Change Log, 2026-07-05) to unblock local dev speed — **before** this region decision was made. Confirmed via Supabase Dashboard → Project Settings → General: region `eu-west-1`.

**Methodology:** RTT measured from a device tethered to MTN/Orange Cameroon mobile data, using AWS's own regional S3 endpoints (`s3.eu-west-1.amazonaws.com`, `s3.eu-central-1.amazonaws.com`) as a proxy for network path latency to each region — Supabase Cloud's EU projects run on AWS in these same regions, so this measures the real network path without needing a live Supabase project in both candidates. `curl -w`'s `time_connect` (TCP handshake) was used as the RTT signal; `time_total` was not used since it's dominated by response-size/TLS variance rather than network distance. Two independent rounds were run (round 1: single sample each; round 2: 5 samples each), from the same Cameroonian mobile connection.

**Measured data (`time_connect`, seconds):**

| Round | Ireland (`eu-west-1`) | Frankfurt (`eu-central-1`) |
|---|---|---|
| 1 | 0.101 | 0.099 |
| 2 (5 samples) | 1.018*, 0.041, 0.053, 0.070, 0.073 | 0.149, 0.070, 0.046, 0.039, 0.078 |

\* Round 2's first Ireland sample (1.018s) is a clear cold-start outlier (DNS/TLS session not yet warm) — excluded from the statistics below, consistent with standard latency-measurement practice.

**Result:** Median `time_connect` across all valid samples — Ireland ≈ 70.0ms (5 valid samples), Frankfurt ≈ 74.0ms (6 valid samples). Trimmed-mean gives Ireland ≈ 67–74ms, Frankfurt ≈ 74–80ms depending on exact exclusion. **Both regions are within measurement noise of each other — a statistical tie, not a clear winner.**

**AC #1 note:** AC #1 as literally worded ("the lower-latency region is selected") is not strictly met — no region measured as clearly faster. AC #1 is treated as satisfied via an explicitly accepted tiebreak-on-tie rule (churn avoidance, below), not a measured win. Flagged and accepted during code review of Story 1.2 (2026-07-05).

**Rationale for selecting Ireland given the tie:** with no measurable latency advantage either way, the tie-breaker is avoiding unnecessary infrastructure churn — the existing project is already in `eu-west-1`, is empty (no data written), and recreating it in Frankfurt would deliver no latency benefit while costing a project swap, `.env.local` updates in two apps, and a re-verification of the Story 1.1 dev workflow smoke test. Ireland also came out marginally ahead in every calculation method tried (median and most trimmed-mean variants), even though the margin is not statistically meaningful on its own.

**Outcome:** No Supabase project swap needed. `apps/dashboard/.env.local` and `apps/super-admin/.env.local` are unchanged and remain correct.

**Follow-up:** Monitor real front-desk check-in-alert latency in production once Epic 3's check-in flow ships; revisit this region decision if the <3s end-to-end budget (FR-052) is at risk, since the region choice going in was a statistical tie rather than a clear win.
