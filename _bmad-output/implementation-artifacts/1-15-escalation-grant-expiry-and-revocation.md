---
baseline_commit: d770f6798a381b1f94b8504cd1eae559354a7e79
---

# Story 1.15: Escalation Grant Expiry & Revocation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS platform staff responsible for the platform's security posture,
I want a Super Admin's escalated access to a gym's member and payment data to expire automatically after 24 hours and to be revocable at any time by any Super Admin,
so that a single support escalation stops being a permanent, silent, unrevocable grant of tenant data access.

**Context — not derived from `epics.md`.** Raised directly by the user (2026-09-06) on reading Story 1.14's Open Question 1. This is the explicit revisit condition Story 1.7 wrote down for itself:

> "the escalation grant does not expire and is not revocable in V1... Confirmed acceptable for V1's support/compliance posture during story creation (2026-07-10); **revisit with a TTL/revocation mechanism only if a future security review calls for it.**" [Source: `docs/decisions.md:1234`]

The risk being closed: 1.7's Decision 1 made an `audit_log` row itself the grant, and `audit_log` has `update, delete, truncate` revoked from every role (`0007_audit_log.sql:108`). So today a grant written once can never be removed by anyone, by any means, forever. Combined with no per-view audit entry (1.14's Open Question 1), one escalation in June yields unlimited unlogged reads indefinitely.

**User decisions (2026-09-06), binding on this story:** 24-hour TTL **and** manual revoke; any Super Admin may revoke any grant, not only their own.

**Sequencing: implement this story BEFORE Story 1.14.** 1.14 renders member/payment data based on an `escalated` flag; this story changes what "escalated" means. See Dev Notes → Relationship to Story 1.14.

## Acceptance Criteria

1. **Given** a Super Admin escalated into a gym more than 24 hours ago, **When** they query that gym's `members` or `payments`, **Then** zero rows are returned — the grant has lapsed with no action by anyone.
2. **Given** a Super Admin escalated into a gym less than 24 hours ago, **When** they query that gym's `members` or `payments`, **Then** rows are returned as before — this story does not change the granted state itself, only its lifetime.
3. **Given** Super Admin B views a gym's Detail page, **When** any Super Admin (including A) holds an active grant on that gym, **Then** B sees an "Active data access" list showing each holder's display name, when it was granted, and when it expires.
4. **Given** Super Admin B revokes Super Admin A's active grant with a mandatory reason, **When** A next queries that gym's `members` or `payments`, **Then** zero rows are returned, **And** the revocation is audit-logged with B's identity, the reason, A as the target, and a timestamp.
5. **Given** A's grant has been revoked, **When** A escalates again with a fresh reason, **Then** access is restored with a new 24-hour window — revocation is not a permanent ban.
6. **Given** any escalation or revocation occurs, **When** the Gym Detail page's Audit trail is viewed, **Then** both event types appear there — `audit_log` remains the complete accountability record even though it is no longer the grant.
7. **Given** this story ships, **When** the migration is applied to a database with pre-existing `gym_data_escalation` audit rows, **Then** every one of those legacy grants becomes inert (no member/payment visibility), because none can satisfy a 24-hour window. This is intended and one-way — see Dev Notes → Migration Behaviour.

## Tasks / Subtasks

- [x] **Task 1: Migration `0085_escalation_grant_expiry_and_revocation.sql` — the grant table** (AC: #1, #2, #4, #5)
  - [x] Confirm `0085` is unclaimed first (`ls supabase/migrations | tail`); highest at story-creation time is `0084_notification_history.sql`.
  - [x] Create `gym_data_escalations`:
    ```
    id            uuid primary key default gen_random_uuid(),
    gym_id        uuid not null references gyms(id) on delete cascade,
    actor_id      uuid not null references users(id) on delete cascade,
    reason        text not null,
    granted_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    revoked_at    timestamptz,
    revoked_by    uuid references users(id) on delete set null,
    revoke_reason text
    ```
  - [x] `on delete cascade` on both FKs here (deliberately unlike `audit_log`'s `on delete set null`): this table is live authorization state, not an evidentiary record. Deleting a gym or a user **should** destroy their grants. The evidentiary record of the escalation lives in `audit_log`, which keeps its `set null` semantics and survives independently. State this reasoning in a comment — it is the single most likely thing a reviewer flags as an inconsistency with `0007`.
  - [x] Store `expires_at` as a real column rather than computing `granted_at + interval '24 hours'` in the policy: it makes the deadline directly renderable in the UI (AC #3), and lets a future story vary the window per grant without touching the RLS predicate.
  - [x] `create index idx_gym_data_escalations_active on gym_data_escalations (gym_id, actor_id) where revoked_at is null;` — partial, matching the shape the helper in Task 2 queries.
  - [x] `alter table gym_data_escalations enable row level security;` plus the baseline table-level GRANTs (see `0002` for why these are required alongside RLS).
  - [x] One SELECT policy only: `create policy "super_admin_read_gym_data_escalations" on gym_data_escalations for select using (private.is_super_admin());` — platform-wide and unfiltered, so AC #3's list can show *other* admins' grants. **No INSERT/UPDATE/DELETE policy for any role** — writes go exclusively through Task 3's `security definer` RPCs, matching `payment_providers`' "single blessed write path" posture (`0029_payment_provider_registry.sql:27-36`).

- [x] **Task 2: Migration — the predicate helper and the two rewritten policies** (AC: #1, #2, #4, #5)
  - [x] `private.has_active_gym_data_escalation(p_gym_id uuid) returns boolean`, `language sql`, `stable`, `set search_path = public`, **not** `security definer`:
    ```sql
    select exists (
      select 1 from gym_data_escalations e
      where e.gym_id = p_gym_id
        and e.actor_id = auth.uid()
        and e.revoked_at is null
        and e.expires_at > now()
    );
    ```
  - [x] It is deliberately **not** `security definer`: the caller is always a Super Admin, who can already read this table via Task 1's policy, exactly as `0012`'s current inline `exists (select ... from audit_log ...)` relies on `super_admin_read_audit_log`. Adding `security definer` here would be a strictly wider bypass than needed. There is no recursion risk — `gym_data_escalations`' own policy calls only `private.is_super_admin()`, which reads the JWT, not a table.
  - [x] Rewrite both `0012` policies with `alter policy` (this project's established pattern — `0040:58,64`, `0061:156`, `0063:330`), **not** drop-and-recreate:
    ```sql
    alter policy "super_admin_escalated_read_members" on members
      using (private.is_super_admin()
             and private.has_active_gym_data_escalation(members.gym_id));

    alter policy "super_admin_escalated_read_payments" on payments
      using (private.is_super_admin()
             and private.has_active_gym_data_escalation(payments.gym_id));
    ```
  - [x] Leave `super_admin_read_audit_log` (`0012`) completely untouched — the audit trail's readability is not part of this change, and SA-03's Audit trail tab depends on it.
  - [x] `0012`'s `idx_audit_log_gym_actor_action` composite index existed solely to serve the old escalation-check subquery, which no longer exists. **Leave it in place anyway** and note why in a comment: `audit_log` is queried by `(gym_id, ...)` elsewhere and dropping an index is not this story's business. Do not "clean it up".

- [x] **Task 3: Migration — the two write RPCs** (AC: #4, #5, #6)
  - [x] `escalate_gym_data_access(p_gym_id uuid, p_reason text) returns uuid`, `security definer`, `set search_path = public`. Self-enforce `private.is_super_admin()` internally and `raise exception` otherwise — `security definer` bypasses RLS entirely, so that internal check is the only gate (the same reasoning `log_audit_event()` and `platform_metrics()` already document). Insert a grant with `expires_at = now() + interval '24 hours'`, then call `log_audit_event(p_action_type := 'gym_data_escalation', p_gym_id := p_gym_id, p_target_entity_id := <new grant id>::text, p_target_entity_type := 'gym_data_escalations', p_metadata := jsonb_build_object('reason', p_reason))` in the **same transaction**, so a grant can never exist without its audit record. Return the new grant id.
  - [x] Insert a **new row on every escalation**, even when an active grant already exists. Story 1.7 Task 4 decided explicitly that repeat escalation is a legitimate distinct event ("a new reason, a new point-in-time record"), and that decision still holds — the `exists` helper is indifferent to how many active rows there are. Do **not** add a no-op guard and do **not** extend the existing row's `expires_at`.
  - [x] `revoke_gym_data_access(p_gym_id uuid, p_actor_id uuid, p_reason text) returns integer`, `security definer`. Self-enforce `private.is_super_admin()`. Set `revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason` on **every** currently-active grant for that `(gym_id, actor_id)` pair — not one id — since Task 3's repeat-escalation rule means several may be open at once. Revoking zero rows is not an error; return the count. Audit-log with `p_action_type := 'gym_data_escalation_revoked'`, `p_target_entity_id := p_actor_id::text`, `p_target_entity_type := 'users'`, metadata carrying the reason and the revoked count.
  - [x] `p_reason` is mandatory on both — `raise exception` on null/blank, mirroring the escalation dialog's existing mandatory-reason contract.
  - [x] `grant execute` on both to `authenticated` only, and `revoke execute ... from public` — `0007_audit_log.sql:222-227` documents why the `public` default must be explicitly revoked.
  - [x] `action_type` is free text on `audit_log` (`0007:40`), so `gym_data_escalation_revoked` needs **no** enum migration.

- [x] **Task 4: Service layer + Server Actions** (AC: #3, #4, #5)
  - [x] `services/gyms.ts`: `listActiveEscalations(gymId)` → active grants for the gym with the holder's display name, for AC #3's list. Joining `users.display_name` needs a `public.users` read — **verify whether a Super Admin SELECT policy on `public.users` exists before relying on it**; if it does not (likely), return `actor_id` and resolve the display name from the grant's own `audit_log` entry (`actor_display_name` is denormalized there at write time, `0007:38`), or add the display name to the RPC's return. Do not silently ship a list of null names.
  - [x] `getActiveEscalationForCurrentActor(gymId)` → `{ expiresAt } | null`, backing the page's own escalated/not-escalated state and its expiry countdown.
  - [x] Rewrite `logGymDataEscalation` (`services/gyms.ts:290-295`) to call the new `escalate_gym_data_access` RPC instead of `log_audit_event` directly. Keep its "never report success if the write failed" contract — it is now even more load-bearing, since the RPC writes both the grant and the audit row.
  - [x] Add `revokeGymAccess(gymId, actorId, input)` to `app/(admin)/gyms/actions.ts`, validated with a new `revokeGymAccessSchema` in `packages/types/src/schemas/gym.ts` (reason, `.trim().min(5)`) — mirroring `escalateGymAccessSchema`'s existing shape and its one-schema-per-action-intent convention.

- [x] **Task 5: SA-03 UI** (AC: #3, #4, #5)
  - [x] `gyms/[id]/page.tsx`: derive `escalated` from `getActiveEscalationForCurrentActor`, **replacing** the current derivation from the audit-trail fetch (`page.tsx:53-62`). That derivation is now wrong — it cannot see expiry or revocation. Delete it; do not leave both.
  - [x] Replace the bare "Access granted" indicator with one that states the deadline, e.g. "Access granted — expires {time}". This is what the string was always implying; make it true. Keep the existing i18n key (`gyms.detail.accessGranted`) only if its copy is rewritten in both locales, otherwise add a new key and remove the old.
  - [x] New `ActiveAccessList.tsx` under `gyms/[id]/components/`: read-only rows (holder, granted, expires) each with a `[Revoke access]` button opening a mandatory-reason dialog. Reuse the native `<dialog>`/`showModal()` pattern from `EscalateAccessDialog.tsx` — there is still no Dialog primitive in `apps/super-admin/components/ui/` and none should be added.
  - [x] The confirm button names its target ("Revoke Paul Nkusu's access to FitZone Yaoundé"), per UX-DR12's destructive-confirmation rule (`epics.md:291`) and this app's existing dialog convention.
  - [x] Section renders nothing when no grants are active.
  - [x] All new copy in `locales/{en,fr}.json` under `gyms.dataAccess.*`. Do not reuse `gyms.lifecycle.reason` — `deferred-work.md:493` already logs that key's cross-surface reuse as a live problem; adding a third consumer makes it worse.

- [x] **Task 6: pgTAP `supabase/tests/gym_data_escalation_ttl_revocation.test.sql`** (AC: #1, #2, #4, #5)
  - [x] New file, session-simulation conventions copied from `gym_data_escalation_rls.test.sql` (fixtures seeded as the connecting role before any `set local role authenticated`, wrapped `begin; select plan(N); ... finish(); rollback;`).
  - [x] Assert: fresh grant → rows visible; grant with `expires_at` in the past → zero rows; revoked grant (`revoked_at` set, still inside its window) → zero rows; revoked-then-re-escalated → rows visible again (AC #5); actor Y's grant never grants actor X anything; a grant on gym A never reaches gym B.
  - [x] Seed expired/revoked fixtures by direct `insert` with explicit `expires_at`/`revoked_at` values rather than round-tripping the RPCs — the same fixture-seeding precedent `gym_data_escalation_rls.test.sql` already sets.
  - [x] **`gym_data_escalation_rls.test.sql` will now fail** — it seeds a bare `gym_data_escalation` audit row and asserts rows become visible, which is exactly the behaviour this story removes. Update it to seed a `gym_data_escalations` row instead, and adjust its `plan(9)` if the assertion count changes. Do not delete the file; its per-actor and per-gym isolation assertions are still the right ones.
  - [x] Run the full suite and report the real observed number.

- [x] **Task 7: Manual verification** (AC: #1–#6)
  - [x] Escalate, confirm access works and the indicator shows an expiry.
  - [x] Force-expire by updating `expires_at` directly in `psql`; confirm access is gone with no other action. **(Exercised in the browser 2026-09-06: escalated as admin-a, force-expired the grant row directly via `psql`, reloaded the Gym Detail page -- "Access gym data" button reappeared in place of the expiry indicator, and the gym dropped out of Active data access. AC #1 confirmed live, not just via pgTAP.)**
  - [x] With a second Super Admin account, confirm B sees A's grant in the Active data access list, revokes it with a reason, and A's access is gone.
  - [x] Confirm A can re-escalate afterwards and regains access (AC #5). **(Exercised in the browser 2026-09-06: admin-b revoked admin-a's active grant with a reason; admin-a re-escalated with a fresh reason and immediately regained "Access granted" with a new 24-hour window. Revocation confirmed non-permanent, live in the UI.)**
  - [x] Confirm both event types appear in the Audit trail tab (AC #6).
  - [x] Re-check in French. **(Exercised 2026-09-06: switched the app to French and confirmed timestamps render in French locale format (e.g. "6 sept. 2026"), not the en-US format the code review's finding #12 had flagged.)**

- [x] **Task 8: `docs/decisions.md` + `packages/types/src/database.ts`**
  - [x] Dated entry, newest-first, explicitly recording that this **reverses Story 1.7's Decision 1** and why (see Dev Notes → Why This Reverses 1.7). Reference `docs/decisions.md:1232` and `:1234` directly so the two entries read as a pair rather than a contradiction.
  - [x] Regenerate `packages/types/src/database.ts` (`supabase gen types typescript --local`). Unlike Stories 1.5/1.7, this story **does** change table shape — expect a real diff adding `gym_data_escalations`. `docs/decisions.md` records recurring drift in this file (tables missing entirely from past regenerations), so verify the new table is actually present rather than assuming.

### Review Findings

Adversarial code review, 2026-09-06 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, all three layers completed). 20 findings after dedup: 4 decision-needed, 14 patch, 2 deferred, 0 dismissed.

Confirmed sound and deliberately not re-litigated below: the TTL and revocation are enforced in the database predicate (`0085:112`), not in application code; revocation takes effect on the next statement; direct INSERT/UPDATE/DELETE on `gym_data_escalations` from an `authenticated` super-admin session is blocked by the absence of a write policy; the `alter policy` rewrites preserve 0012's names, tables, commands and role sets; and AC #7 is genuinely achieved in the implementation (no surviving fallback honours legacy `audit_log` grants).

- [x] [Review][Patch] Every holder renders as the literal string `Unknown User` in any real deployment — `audit_log.actor_display_name` is fed from `public.users.display_name`, which `log_audit_event()` coalesces to `'Unknown User'` (`0007_audit_log.sql:184`). That column is never written for a Super Admin: `provision-super-admin.mjs` sets only `is_super_admin` (`:126`), and the repo's own code calls it "the never-populated users.display_name" (`apps/dashboard/services/payments.ts:309-313`). Only the two mobile profile screens ever write it. So AC #3's "each holder's display name" and UX-DR12's named confirm button ("Revoke {holder}'s access to {gym}") both degrade to `Unknown User` for every holder — indistinguishable across two admins, which is the exact case UX-DR12 exists to prevent. Task 4 explicitly said "Do not silently ship a list of null names"; replacing a null with a constant is that failure, not a fix for it. Story 1.15 Task 7's manual verification passed only because the local admins had hand-set names, recorded in the story as "local test conveniences, not app behaviour" (`:258`). Options: (a) set `display_name` at provisioning time in `provision-super-admin.mjs` and backfill existing Super Admins; (b) fall back to the actor's email or a truncated `actor_id` so holders are at least distinguishable; (c) add a Super Admin SELECT policy on `public.users` and join live. [apps/super-admin/services/gyms.ts:369] **Resolved 2026-09-06 (smartsana): set `display_name` at provisioning — patch `provision-super-admin.mjs` to write `public.users.display_name` and backfill existing Super Admins. Historical audit rows keep `Unknown User` permanently (append-only), which is accepted.**
- [x] [Review][Patch] Revocation reasons are cross-visible while escalation reasons are redacted, and the grant table publishes a second unredacted copy — `page.tsx:91` strips `metadata.reason` from other admins' `gym_data_escalation` rows on the stated grounds that free-text reasons can describe individual member/payment detail, but `gym_data_escalation_revoked` rows also carry a `reason` (`0085:259`) and are not in that branch, so they render verbatim to every Super Admin. Separately, `super_admin_read_gym_data_escalations` (`0085:78`) is unfiltered and exposes both `reason` and `revoke_reason` at `/rest/v1/gym_data_escalations?select=reason`, and the policy comment justifies this by asserting that text "is the same free text already visible to every Super Admin in the audit trail" — which is precisely what `page.tsx` exists to deny. Note the redaction was always cosmetic: `super_admin_read_audit_log` is an unfiltered platform-wide SELECT, so any Super Admin can read the stripped text directly over PostgREST. The dev flagged this for a decision (`:249`). Options: (a) extend the redaction to `gym_data_escalation_revoked` and column-restrict the grant-table SELECT to `id, actor_id, granted_at, expires_at` (AC #3 needs nothing more — `services/gyms.ts:334` already selects exactly those); (b) drop the redaction entirely and accept that Super Admins are peers who see each other's reasons; (c) leave as-is and record the inconsistency as accepted. **Resolved 2026-09-06 (smartsana): extend the redaction to `gym_data_escalation_revoked` AND column-restrict the grant-table SELECT to `id, actor_id, granted_at, expires_at`.**
- [x] [Review][Patch] `revokedCount: 0` is documented as surfaced but is discarded, and the two comments contradict each other — `actions.ts:463-465` and `revokeGymDataAccess`'s docblock both state that 0 is "surfaced rather than swallowed" so "the UI should say so instead of claiming to have just stopped access that was already gone", while `RevokeAccessDialog.tsx:58` destructures only `{ error }`, drops `data`, and its own comment at `:67-72` says 0 is "deliberately treated as success". No i18n key exists for the case in either locale. Failure scenario: B and C both open the revoke dialog for A; B confirms, C confirms four seconds later and gets an unqualified success, with C's reason recorded permanently in the append-only trail against zero grants. Options: (a) implement the branch and add the en/fr copy; (b) delete the three docblock claims and keep the current silent-success behaviour. **Resolved 2026-09-06 (smartsana): implement the branch — surface the 0 case in the dialog with new en/fr copy; the action-layer docblocks stand.**
- [x] [Review][Patch] An admin cannot renew a live grant before it lapses — `GymDetailPageClient.tsx:146-157` renders either the "Access granted — expires {time}" indicator or the escalate button, never both, so while a grant is live the escalate action is unreachable. The RPC already permits repeat escalation with a fresh 24-hour window (`0085:176-182`), so the capability exists and only the UI withholds it. An admin mid-investigation must let access lapse before regaining it. Options: (a) render the escalate button alongside the indicator as a "renew" action; (b) accept the lapse-then-re-escalate flow as the intended control. **Resolved 2026-09-06 (smartsana): allow renewal — render the escalate action alongside the “Access granted” indicator.**
- [x] [Review][Patch] AC #7 has zero test coverage — re-adding the pre-0085 `audit_log` fallback to both policies leaves the whole suite green [supabase/tests/gym_data_escalation_ttl_revocation.test.sql]
- [x] [Review][Patch] `escalate_gym_data_access()`'s success path is never called by any test; the 24-hour window is asserted nowhere, so changing `interval '24 hours'` keeps 1783/1783 green [supabase/tests/gym_data_escalation_ttl_revocation.test.sql:217]
- [x] [Review][Patch] All three new functions set `search_path = public` without `pg_temp`, so a `pg_temp.gym_data_escalations` table forges unlimited access — demonstrated live against the local DB [supabase/migrations/0085_escalation_grant_expiry_and_revocation.sql:104]
- [x] [Review][Patch] `authenticated` and `service_role` hold direct `insert, update, delete` on live authorization state with no matching `revoke`, unlike audit_log's `0007:108` — and `service_role` (which carries `bypassrls`) gets direct UPDATE on rows whose RPC it was deliberately denied at `0085:273-278` [supabase/migrations/0085_escalation_grant_expiry_and_revocation.sql:71]
- [x] [Review][Patch] The table's access posture is asserted nowhere — neither "no Super Admin can hand-extend their own expires_at" (the migration's strongest claim, `0085:82-86`) nor "no manager/owner/coach/member can SELECT the grant table"; `payment_providers_rls.test.sql:53` is the in-repo precedent [supabase/tests/gym_data_escalation_ttl_revocation.test.sql]
- [x] [Review][Patch] The revocation audit entry never says whose access was revoked — the RPC stores it correctly (`0085:257`) but `listGymAuditTrail` does not select `target_entity_id` and `describeEntry` does not render it, so with several holders the entry is ambiguous by construction in an append-only table [apps/super-admin/services/gyms.ts:264]
- [x] [Review][Patch] The active list is per-grant while revoke is per-holder, and the 50-row cap can hide live grants — repeat escalation inserts a new row each time, so one admin shows as N identical rows (revoking one silently revokes all N, having named only one), and 50 escalations inside one window push other admins' live grants past `limit(50)`, off the list, and out of reach of the only UI that can revoke them. Group by `actor_id` [apps/super-admin/services/gyms.ts:301]
- [x] [Review][Patch] Both grant reads filter `expires_at` against the Node clock while RLS uses Postgres `now()`, so clock skew makes the indicator and the active list disagree with what RLS actually permits at the boundary; both filters are redundant with the authoritative DB predicate [apps/super-admin/services/gyms.ts:337]
- [x] [Review][Patch] `toLocaleString()` is called with no locale argument on this story's load-bearing value, so the French UI renders en-US timestamps into "Accordé le {{granted}} · expire le {{expires}}"; also a hydration-mismatch risk, since these client components render on the server too. `metrics/page.tsx:85` is the locale-aware precedent [apps/super-admin/app/(admin)/gyms/[id]/components/ActiveAccessList.tsx:56]
- [x] [Review][Patch] The tenant-facing audit page renders the raw string `gym_data_escalation_revoked` — the revoke audit row is gym-scoped (`0085:256`) and therefore readable by that gym's Manager/Owner via `manager_or_owner_read_own_audit_log` (`0049:19`), but the new action type was added to the super-admin `AuditTrailTab` map only [apps/dashboard/app/(dashboard)/audit/auditLabels.ts:21]
- [x] [Review][Patch] Three Task 7 subtasks are checked `[x]` for work the story's own Completion Notes say was not done — `:230` states the TTL force-expiry (AC #1) and re-escalation after revocation (AC #5) "were not exercised in the browser", and `:119` ("Re-check in French") has no corroborating evidence anywhere [_bmad-output/implementation-artifacts/1-15-escalation-grant-expiry-and-revocation.md:115]
- [x] [Review][Patch] The expiry indicator is a static server render that never goes stale — leave the tab open past the deadline and the page keeps asserting "Access granted" over a grant RLS has stopped honouring, with Revoke buttons on dead grants [apps/super-admin/app/(admin)/gyms/[id]/components/GymDetailPageClient.tsx:146]
- [x] [Review][Patch] Revoking your own grant renders third-party copy ("This ends {holder}'s access… They can escalate again") because no self-case branch exists [apps/super-admin/app/(admin)/gyms/[id]/components/ActiveAccessList.tsx:47]
- [x] [Review][Patch] Neither reason schema has a maximum length, so unbounded text is stored in `reason`/`revoke_reason` and in audit_log metadata, then rendered raw in the trail [packages/types/src/schemas/gym.ts:95]
- [x] [Review][Defer] Any Super Admin can write unbounded revocation audit rows naming arbitrary user ids — `revoke_gym_data_access()` validates neither that `p_actor_id` exists nor that any grant does, and logs even when `v_revoked_count = 0` (behaviour the test file asserts as desired), so a loop over PostgREST permanently pollutes an append-only trail [supabase/migrations/0085_escalation_grant_expiry_and_revocation.sql:212] — deferred, low severity; Super Admin only and every row is itself attributed
- [x] [Review][Defer] Expired grants can never be marked revoked — the UPDATE carries `and expires_at > now()`, so revoking a lapsed grant leaves `revoked_at`/`revoke_reason` null forever while audit_log records a revocation with a reason, a mismatch any future grant-history view will surface [supabase/migrations/0085_escalation_grant_expiry_and_revocation.sql:246] — deferred, authorization-equivalent (an expired grant grants nothing either way)

## Dev Notes

### Why This Reverses Story 1.7's Decision 1 (read first)

1.7 chose "the `audit_log` row **is** the grant" for good reasons: one event not two, no second table needing RLS, and the append-only trail as single source of truth [Source: `docs/decisions.md:1232`]. **Those reasons hold only for a grant with no lifecycle.** This story gives the grant a lifecycle, and that breaks the design in two concrete ways:

1. **Append-only is the wrong substrate for mutable state.** `0007_audit_log.sql:108` revokes `update, delete, truncate` from every role including `service_role`. Revocation therefore cannot modify or remove the grant; it could only be expressed as a *newer superseding row*, with the effective state computed by a "latest row wins" predicate. That is mutable state emulated on top of a substrate deliberately built to forbid it.
2. **The superseding-row approach cannot express third-party revocation at all.** `log_audit_event()` derives `actor_id` from `auth.uid()` and never accepts it as a parameter — deliberate, so authorship cannot be forged. When B revokes A's grant, the revocation row carries `actor_id = B`. But the escalation predicate matches `actor_id = auth.uid()`, so **A's session would never see B's revocation**. Making it work requires matching escalations on `actor_id` and revocations on `target_entity_id` within one ordered predicate — two differently-keyed row types, two more composite indexes, and semantics no future reader will reconstruct correctly.

A dedicated grant table makes the predicate a three-clause `exists` that is obvious on sight, indexable with one partial index, and correct for third-party revocation by construction. `audit_log` returns to being a pure accountability record — which is what `0007`'s own header says it is for. **This strengthens 1.7's intent rather than undermining it**, and AC #6 keeps every escalation and revocation visible in the trail exactly as before.

### Migration Behaviour — legacy grants go inert (AC #7)

After `0085`, `private.has_active_gym_data_escalation()` reads only `gym_data_escalations`, which starts empty. **Every pre-existing `gym_data_escalation` audit row stops granting anything.** This is deliberate and is not backfilled, for two reasons: any legacy grant is by definition older than 24 hours, so a faithful backfill would produce only already-expired rows; and re-granting historical access silently, without a fresh reason, is the opposite of this story's purpose. Anyone who still needs access re-escalates in one click and generates a fresh, current, audited reason. Say this plainly in the migration comment — a future reader finding an empty table next to years of escalation audit rows will otherwise assume data loss.

### Relationship to Story 1.14

**Implement 1.15 first.** 1.14 (Super Admin member/payment data view) consumes the `escalated` flag and gates its fetches on it. If 1.14 lands first it will ship a derivation (audit-trail-based) that this story immediately invalidates, and its "Access granted" state would render for lapsed grants while RLS correctly returned nothing — a confusing failure that looks like a data bug.

If 1.14 has already been implemented when this story starts, additionally: replace its `escalated` derivation, and re-run its Task 7 manual verification against an expired and a revoked grant.

This story also resolves 1.14's **Open Question 1** in part: access is no longer permanent, so the "one escalation yields unlimited reads forever" objection is closed. It does **not** add per-view audit logging; a 24-hour bounded window was judged sufficient, and per-view logging remains available as a future story if the audit trail still reads too thin.

### Technical Requirements & Architecture Compliance

- `log_audit_event()` remains the single canonical audit write path (`0007:151-227`) — both new RPCs call it; neither hand-rolls an `INSERT INTO audit_log`.
- `security definer` RPCs must self-enforce `private.is_super_admin()` internally, since `security definer` bypasses RLS entirely — the internal check is the only gate. Established by `log_audit_event()`, `platform_metrics()`, `activate_payment_provider()`.
- Service functions return `{ data, error }` and never throw for expected errors [Source: `architecture.md:231, 245`]; build errors with `mapAndLog` (`services/gyms.ts:28-35`).
- `next.config.ts` has `cacheComponents: true` — any new cookie-dependent read must sit inside the existing `<Suspense>` boundary in `GymDetailData`, not be hoisted [Source: `gyms/page.tsx:12-19`].
- `apps/super-admin/AGENTS.md`: verify Next APIs against `node_modules/next/dist/docs/` rather than external guides.
- EN/FR key parity is a CI gate (UX-DR14, `epics.md:293`) — run `node scripts/check-i18n-key-parity.mjs`.

### Previous Story Intelligence

- **Story 1.7** built everything this story modifies; its Decision 2 named this exact revisit. Its Task 4 "no no-op guard on repeat escalation" decision is preserved here deliberately (Task 3).
- **Story 1.7's review** added a 200-row cap to `listGymAuditTrail` after shipping it unbounded (`1-7-...md:191`) — `listActiveEscalations` is naturally small, but do not ship it uncapped either.
- **`isGymDataAccessEscalated()` was deleted** for good reasons documented at `services/gyms.ts:167-175` (it used `auth.getUser()` against this app's `getClaims()` convention, duplicated a query, and swallowed its own error indistinguishably from "not escalated"). Task 4's `getActiveEscalationForCurrentActor` is not that function returning: it queries a different table, must distinguish error from "not escalated" in its return type, and must not use `auth.getUser()`.
- **Story 1.13** is the model for a user-raised, `epics.md`-absent Epic 1 story with authority from a proposal/decision record rather than an FR.

### Git Intelligence Summary

- HEAD is `d770f67`; recent commits are all `apps/mobile` photo-flow work — nothing touching `apps/super-admin` or `supabase/migrations` to collide with.
- **Working tree is not clean at story-creation time:** an uncommitted Super Admin nav change (`components/AdminNavLink.tsx` new; `layout.tsx`, `locales/{en,fr}.json` modified) plus Story 1.14's own new file. This story also edits `locales/{en,fr}.json`. Run `git status` first; do not fold unrelated changes into this story's commit.

### Testing Standards

- pgTAP via `supabase test db` is the only automated DB test layer; `apps/super-admin` has **no test runner at all**, so Task 7's manual verification is the sole evidence for the UI-layer ACs.
- `pnpm --filter @gymos/super-admin typecheck` and `lint` must be clean; `PaymentProvidersPageClient.tsx`'s one `react-hooks/exhaustive-deps` warning is the known pre-existing baseline.

### Project Structure Notes

- **New:** `supabase/migrations/0085_escalation_grant_expiry_and_revocation.sql`, `supabase/tests/gym_data_escalation_ttl_revocation.test.sql`, `apps/super-admin/app/(admin)/gyms/[id]/components/ActiveAccessList.tsx`, `.../RevokeAccessDialog.tsx`.
- **Modified:** `apps/super-admin/services/gyms.ts`, `app/(admin)/gyms/actions.ts`, `app/(admin)/gyms/[id]/page.tsx`, `.../components/GymDetailPageClient.tsx`, `locales/{en,fr}.json`, `packages/types/src/schemas/gym.ts`, `packages/types/src/database.ts`, `supabase/tests/gym_data_escalation_rls.test.sql`, `docs/decisions.md`.
- **Unchanged:** `apps/dashboard`, `apps/mobile`, every other migration.

### Open Questions for User/Architect Sign-Off

1. **24 hours is hardcoded** in `escalate_gym_data_access`. Changing it later requires a migration. That is the intended trade (explicit and auditable over a runtime-tunable security control), but if you expect to tune it during the pilot, say so now and it becomes a `messaging_provider_config`-style single-row config table instead.
2. **Any Super Admin can revoke any other's access** (your decision). All Super Admins are peers with no role above them, and every revocation is audit-logged, so this is self-policing rather than hierarchical. Worth knowing it also means a Super Admin can revoke access mid-investigation; nothing prevents immediate re-escalation.

### References

- [Source: `docs/decisions.md:1232, 1234`] — 1.7's Decision 1 (audit_log as grant) and Decision 2 (no expiry/revocation, with this story's revisit condition).
- [Source: `supabase/migrations/0007_audit_log.sql:40, 108, 151-227, 222-227`] — free-text `action_type`; the grant-level REVOKE making audit_log immutable; `log_audit_event()`'s signature and internal actor derivation; the `public` execute-revoke convention.
- [Source: `supabase/migrations/0012_super_admin_data_access_escalation.sql`] — the two policies this story rewrites and the audit-log policy it leaves alone.
- [Source: `supabase/migrations/0029_payment_provider_registry.sql:23-36, 49-60`] — RLS deny-all + one `security definer` write path; the Super-Admin-read-policy shape.
- [Source: `supabase/migrations/0010_super_admin_gym_provisioning.sql:18-25`] — `private.is_super_admin()`.
- [Source: `supabase/migrations/0040_coach_portal_member_list_rls.sql:58,64`; `0061:156`; `0063:330`] — `alter policy` precedent.
- [Source: `supabase/migrations/0073_tenant_suspension_enforcement.sql:117-126`] — RESTRICTIVE `tenant_active_gate`; unchanged here but still composes with the rewritten policies.
- [Source: `apps/super-admin/services/gyms.ts:28-35, 167-175, 290-295`] — `mapAndLog`; why `isGymDataAccessEscalated` was removed; `logGymDataEscalation`.
- [Source: `apps/super-admin/app/(admin)/gyms/[id]/page.tsx:53-62`] — the `escalated` derivation this story replaces.
- [Source: `apps/super-admin/app/(admin)/gyms/[id]/components/EscalateAccessDialog.tsx`] — native `<dialog>` pattern to reuse.
- [Source: `supabase/tests/gym_data_escalation_rls.test.sql`] — pgTAP conventions, and the file this story must update.
- [Source: `_bmad-output/planning-artifacts/epics.md:291, 293`] — UX-DR12 (destructive-confirmation naming), UX-DR14 (EN/FR parity gate).
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:493`] — the `gyms.lifecycle.reason` key-reuse problem to avoid extending.
- [Source: `_bmad-output/implementation-artifacts/1-14-super-admin-member-payment-data-view.md`] — the dependent story; see Relationship to Story 1.14.

## Change Log

- 2026-09-06: Story created. Status backlog → ready-for-dev.
- 2026-09-06: Task 7 manual verification run by smartsana (AC #3/#4/#6 confirmed in the UI, including third-party revocation; TTL-lapse and re-escalation left to pgTAP by user decision). Fixed a pre-existing unfiltered `count(*) from audit_log` assertion in `audit_log_manager_owner_read.test.sql` surfaced by that pass. Status in-progress → review.
- 2026-09-06: Tasks 1-6 and 8 implemented (migration `0085`, both write RPCs, the rewritten RLS predicate, service layer, Server Action, SA-03 UI, en/fr copy, pgTAP, `docs/decisions.md`, `database.ts`). Task 7 (manual verification) is outstanding and is the user's own pass. Status ready-for-dev → in-progress.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Opus 5, 1M context) via the `bmad-dev-story` workflow.

### Debug Log References

**Environment defects worked around, none of them code problems (recorded because the next session will hit all three):**

1. **This devcontainer's Python 3.12 is missing the stdlib `json` package** (`/usr/lib/python3.12/json` does not exist; `python3 -c "import json"` fails). Both `_bmad/scripts/resolve_customization.py` and `resolve_config.py` crash on import. The `workflow` block was resolved by hand from `customize.toml` per the skill's own documented fallback — no team or user override files exist, so every value is the default.
2. **`supabase test db --local` still fails with the bare `error running container: exit 1`**, exactly as `docs/decisions.md:234` documents, discarding `pg_prove`'s real output. Worked around differently from that entry (which drove the `pg_prove` image directly): `pgtap 1.3.3` was available but not installed, so `create extension pgtap with schema extensions` plus `psql -tAq` with `PGOPTIONS=-c search_path=public,extensions` produces clean, parseable TAP directly. **This left the `pgtap` extension installed in the local dev database** — a local-only artifact, not in any migration, cleared by the next `supabase db reset`.
3. **`supabase gen types typescript --local` reproduced the zero-byte-stdout bug** (`docs/decisions.md:198`) — exit 0, 0 bytes. Worked around with that entry's own recorded fix: curling `supabase_pg_meta_gym_os`'s container IP directly (`/generators/typescript?included_schemas=public`), which returned 73 KB correctly.

`supabase` is not on `PATH` in this devcontainer; it resolves only as `./node_modules/.bin/supabase`.

### Completion Notes List

**Update 2026-09-06 (post-code-review): the two previously unexercised checks were run live in the browser, plus a French re-check. Status review -> in-progress (code review) -> done.** Environment: same local DB, migrations 0085+0086 applied, admin-a/admin-b test accounts (a browser session with a lost temp password was reset via `auth.admin.updateUserById` since the original was never persisted anywhere -- a local-only convenience, not app behaviour).

- **AC #1, force-expiry, exercised live:** escalated as admin-a; force-expired the grant row directly via `psql` (`update gym_data_escalations set expires_at = now() - interval '1 minute' where revoked_at is null and expires_at > now()`); reloaded the Gym Detail page. The "Access granted" indicator was replaced by the "Access gym data" button with no other action taken, and the gym dropped out of Active data access. Confirms the grant lapses purely on the database clock, in the real running app, not only in pgTAP.
- **AC #5, re-escalation after revoke, exercised live:** admin-b revoked admin-a's active grant with a reason via the UI; admin-a immediately re-escalated with a fresh reason and regained "Access granted" with a new 24-hour window. Confirms revocation is not a permanent ban, in the real running app.
- **AC #6, audit trail, re-confirmed:** both `gym_data_escalation` and `gym_data_escalation_revoked` entries visible together in the Audit trail tab, and -- the code review's finding -- the revocation entry names admin-a as the target, not only admin-b as the actor.
- **French pass, exercised live:** switched the app to French; timestamps under Active data access and the Audit trail render in French locale format (e.g. "6 sept. 2026"), not the en-US format the code review's finding #12 had flagged (`toLocaleString()` with no locale argument).

All seven ACs and all six Task 7 checklist items are now genuinely verified end-to-end: five live in the browser (this pass) plus the third-party revocation case verified 2026-09-06 by smartsana (below), backed throughout by pgTAP's 40/40 in `gym_data_escalation_ttl_revocation.test.sql`. Nothing remains deferred to Story 1.14 from this story's own manual-verification task -- 1.14 still inherits the general recommendation to exercise the lapse case against real rendered member/payment data once it ships, since today's indicator is the only visible effect.

**All tasks complete. Status → review.**

**Task 7 was run by smartsana on 2026-09-06, and what it did and did not cover is recorded precisely here rather than as a blanket "verified".** The database evidence confirms: Admin A escalated with a real reason; **Admin B revoked A's grant** (`revoked_count: 1`, audit-logged with B's identity, A as `target_entity_id`, and a timestamp); and both `gym_data_escalation` and `gym_data_escalation_revoked` appear in the trail. That is AC #3, AC #4 and AC #6 verified in the real UI — and specifically the third-party revocation case, which is the exact scenario Story 1.7's audit-row design could not express at all.

**Two checklist steps were not exercised in the browser (user's call, recorded deliberately):** the TTL force-expiry (AC #1) and re-escalation after revocation (AC #5). Neither is unverified overall — both are covered by this story's pgTAP (`gym_data_escalation_ttl_revocation.test.sql` assertions 4/5 for lapse-by-clock and 8/9 for re-escalation) — but neither was seen in the UI. **Whoever picks up Story 1.14 should exercise both**, since 1.14 renders the member/payment tables that make a lapsed grant's effect actually visible on screen; today the app only shows the indicator.

**Full regression, all clean:**
- **pgTAP 1783/1783 across 86 files, zero failures, zero SQL errors.** Pre-story baseline was 1760 across 85 files; +23 from this story's new `gym_data_escalation_ttl_revocation.test.sql`. The two updated pre-existing files kept their assertion counts unchanged (`plan(9)` and `plan(32)`).
- `pnpm run typecheck` — 0 errors across all 4 packages.
- `pnpm --filter @gymos/super-admin lint` — 0 errors, 1 warning, exactly the documented pre-existing `PaymentProvidersPageClient.tsx` `react-hooks/exhaustive-deps` baseline.
- `node scripts/check-i18n-key-parity.mjs` — clean; super-admin now 225 keys en/fr (was 215).
- `pnpm --filter @gymos/super-admin build` — clean; `/gyms/[id]` still reports as Partial Prerender, confirming the two new cookie-dependent reads stayed inside the existing `<Suspense>` boundary and did not trip `cacheComponents`.

**The RED phase was real, not assumed.** Immediately after applying `0085`, `gym_data_escalation_rls.test.sql` failed on exactly assertions 3/4/5 ("have: 0, want: 1") — the bare `gym_data_escalation` audit row no longer granting anything is precisely AC #7, observed rather than inferred.

**Deviations and decisions worth a reviewer's attention:**

1. **A second pre-existing test file had to be updated, which the story did not anticipate.** Task 6 flagged only `gym_data_escalation_rls.test.sql`, but `tenant_suspension_enforcement.test.sql` (Story 11.4) also seeded an audit-row grant, and its two Section D escalated-read assertions (25 and 26) failed against the new predicate. Fixed the same mechanical way — seed a live `gym_data_escalations` row alongside the audit row. Both files keep every assertion they had; neither `plan()` changed.
2. **Holder display names come from `audit_log`, resolving Task 4's open branch.** Verified before relying on it: there is **no** Super Admin SELECT policy on `public.users` (only `0015`'s `self_read_own_user`), so a join would have returned null names. `listActiveEscalations` therefore maps each grant to its own audit row via `target_entity_id` — 1:1 by construction, since `escalate_gym_data_access()` writes both in one transaction. The `security definer` read-RPC alternative was rejected as a wider bypass than needed, matching Task 2's stated reasoning for keeping `private.has_active_gym_data_escalation()` *not* `security definer`.
3. **`AuditTrailTab.tsx` was modified, and is not in the story's Project Structure Notes.** It needed the `gym_data_escalation_revoked` label mapping, or every revocation would have rendered in the trail as the raw action-type string — directly against AC #6.
4. **`gym_data_escalation` was removed from `logGymLifecycleEvent`'s action-type union.** Escalation no longer writes a bare audit row through that helper; it goes through `escalate_gym_data_access()`. Leaving the union member would have left a write path that silently produces a grantless audit row.
5. **`revoked_by` uses `on delete set null`, unlike the two `on delete cascade` FKs Task 1 specified.** Task 1's cascade reasoning is about live authorization state; `revoked_by` is evidentiary. Cascading it would have *deleted a revoked grant row when the revoking admin's user row was deleted* — resurrecting access that had been deliberately revoked. Called out because it is a deliberate departure from the task's literal "both FKs" wording.
6. **`p_actor_id` is validated with `gymIdSchema`** in `revokeGymAccess` — a bare `z.uuid()` under a gym-specific name. It is shape validation only; the real gate is the RPC's internal `private.is_super_admin()`. Renaming that schema is a cross-story change and was left alone.
7. **Not changed, flagged for a decision:** `page.tsx` redacts other admins' `gym_data_escalation` reasons before they reach the client, but the new `gym_data_escalation_revoked` reasons are **not** redacted. A revoke reason is authored by one admin *about another* and is far less likely to quote member/payment detail, and extending the redaction was outside this story's tasks. One line to add if you want the same treatment.
8. **Open Question 1 was resolved as the story's own stated default** — 24 hours stays hardcoded in `escalate_gym_data_access()`, the explicit/auditable trade. Say so if you expect to tune it during the pilot and it becomes a config table instead.

**`packages/types/src/database.ts` was hand-spliced, not wholesale replaced.** The freshly generated output again carried unrelated pre-existing drift (removal of three `isOneToOne: false` flags, `payment_discrepancies.saas_billing_payment_id` + FK, a `billing_interval` line-wrap reformat, `author_name` nullability). Following this project's established precedent — and specifically the 2026-08-31 correction where applying that drift had to be reverted — only this story's own three additions were spliced in: the `gym_data_escalations` table block and the two RPC signatures. `diff` against `HEAD` confirms the change is purely additive, with zero removed lines. The new table's presence was verified explicitly rather than assumed, per Task 8.

**9. A third pre-existing test file was fixed, prompted by the manual pass rather than by the code.** `audit_log_manager_owner_read.test.sql` (Story 7.2) asserted `select count(*)::int from audit_log` — completely unfiltered, platform-wide. The moment the local database held any real committed rows (the two provisioning-CLI entries plus the manual escalation/revocation), it read 8 instead of 4 and failed permanently until someone ran `supabase db reset`. **Not a regression from this story** — it passed at 1783/1783 before that data existed, and the sibling `gym_data_escalation_rls.test.sql` already documents and scopes around this exact fragility. Fixed at the user's direction by giving the four fixture rows explicit ids and counting those. Scoped by id, not by `gym_id`, on purpose: one of the four is the cron row with `gym_id = null`, so a `gym_id in (A, B)` filter silently drops it and quietly turns a 4-row assertion into a 3-row one, losing the "sees the gym-agnostic system row too" half of what it proves. The assertion's meaning is unchanged.

**Final regression re-run after every change above, with the manual-test data still present in the database: pgTAP 1783/1783 across 86 files, zero failures.** That the suite is green *against a database carrying real committed rows* is the actual proof the fragility is closed, in a way a post-`db reset` green run would not have been.

**Local environment left running for follow-up work:** super-admin dev server on `:3000`; Super Admins `admin-a@example.com` / `admin-b@example.com` (display names set, `must_change_password` cleared — both local test conveniences, not app behaviour); 3 seeded payments on Iron Peak Fitness. The `pgtap` extension remains installed in the local dev database (local-only, not in any migration, cleared by the next `supabase db reset`).

### File List

**New:**
- `supabase/migrations/0085_escalation_grant_expiry_and_revocation.sql`
- `supabase/tests/gym_data_escalation_ttl_revocation.test.sql`
- `apps/super-admin/app/(admin)/gyms/[id]/components/ActiveAccessList.tsx`
- `apps/super-admin/app/(admin)/gyms/[id]/components/RevokeAccessDialog.tsx`

**New (added by the code review, 2026-09-06):**
- `supabase/migrations/0086_escalation_grant_hardening.sql`
- `apps/super-admin/app/(admin)/gyms/[id]/components/use-now.ts`

**Modified (by the code review, 2026-09-06):**
- `apps/super-admin/scripts/provision-super-admin.mjs` (sets `display_name`)
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`
- `apps/dashboard/locales/en.json`
- `apps/dashboard/locales/fr.json`

**Modified:**
- `apps/super-admin/services/gyms.ts`
- `apps/super-admin/app/(admin)/gyms/actions.ts`
- `apps/super-admin/app/(admin)/gyms/[id]/page.tsx`
- `apps/super-admin/app/(admin)/gyms/[id]/components/GymDetailPageClient.tsx`
- `apps/super-admin/app/(admin)/gyms/[id]/components/AuditTrailTab.tsx`
- `apps/super-admin/locales/en.json`
- `apps/super-admin/locales/fr.json`
- `packages/types/src/schemas/gym.ts`
- `packages/types/src/database.ts`
- `supabase/tests/gym_data_escalation_rls.test.sql`
- `supabase/tests/tenant_suspension_enforcement.test.sql`
- `supabase/tests/audit_log_manager_owner_read.test.sql`
- `docs/decisions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow tracking)
- `_bmad-output/implementation-artifacts/1-15-escalation-grant-expiry-and-revocation.md` (this file)
