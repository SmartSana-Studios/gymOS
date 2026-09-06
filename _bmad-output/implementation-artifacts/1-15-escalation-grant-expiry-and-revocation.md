---
baseline_commit: d770f6798a381b1f94b8504cd1eae559354a7e79
---

# Story 1.15: Escalation Grant Expiry & Revocation

Status: ready-for-dev

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

- [ ] **Task 1: Migration `0085_escalation_grant_expiry_and_revocation.sql` — the grant table** (AC: #1, #2, #4, #5)
  - [ ] Confirm `0085` is unclaimed first (`ls supabase/migrations | tail`); highest at story-creation time is `0084_notification_history.sql`.
  - [ ] Create `gym_data_escalations`:
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
  - [ ] `on delete cascade` on both FKs here (deliberately unlike `audit_log`'s `on delete set null`): this table is live authorization state, not an evidentiary record. Deleting a gym or a user **should** destroy their grants. The evidentiary record of the escalation lives in `audit_log`, which keeps its `set null` semantics and survives independently. State this reasoning in a comment — it is the single most likely thing a reviewer flags as an inconsistency with `0007`.
  - [ ] Store `expires_at` as a real column rather than computing `granted_at + interval '24 hours'` in the policy: it makes the deadline directly renderable in the UI (AC #3), and lets a future story vary the window per grant without touching the RLS predicate.
  - [ ] `create index idx_gym_data_escalations_active on gym_data_escalations (gym_id, actor_id) where revoked_at is null;` — partial, matching the shape the helper in Task 2 queries.
  - [ ] `alter table gym_data_escalations enable row level security;` plus the baseline table-level GRANTs (see `0002` for why these are required alongside RLS).
  - [ ] One SELECT policy only: `create policy "super_admin_read_gym_data_escalations" on gym_data_escalations for select using (private.is_super_admin());` — platform-wide and unfiltered, so AC #3's list can show *other* admins' grants. **No INSERT/UPDATE/DELETE policy for any role** — writes go exclusively through Task 3's `security definer` RPCs, matching `payment_providers`' "single blessed write path" posture (`0029_payment_provider_registry.sql:27-36`).

- [ ] **Task 2: Migration — the predicate helper and the two rewritten policies** (AC: #1, #2, #4, #5)
  - [ ] `private.has_active_gym_data_escalation(p_gym_id uuid) returns boolean`, `language sql`, `stable`, `set search_path = public`, **not** `security definer`:
    ```sql
    select exists (
      select 1 from gym_data_escalations e
      where e.gym_id = p_gym_id
        and e.actor_id = auth.uid()
        and e.revoked_at is null
        and e.expires_at > now()
    );
    ```
  - [ ] It is deliberately **not** `security definer`: the caller is always a Super Admin, who can already read this table via Task 1's policy, exactly as `0012`'s current inline `exists (select ... from audit_log ...)` relies on `super_admin_read_audit_log`. Adding `security definer` here would be a strictly wider bypass than needed. There is no recursion risk — `gym_data_escalations`' own policy calls only `private.is_super_admin()`, which reads the JWT, not a table.
  - [ ] Rewrite both `0012` policies with `alter policy` (this project's established pattern — `0040:58,64`, `0061:156`, `0063:330`), **not** drop-and-recreate:
    ```sql
    alter policy "super_admin_escalated_read_members" on members
      using (private.is_super_admin()
             and private.has_active_gym_data_escalation(members.gym_id));

    alter policy "super_admin_escalated_read_payments" on payments
      using (private.is_super_admin()
             and private.has_active_gym_data_escalation(payments.gym_id));
    ```
  - [ ] Leave `super_admin_read_audit_log` (`0012`) completely untouched — the audit trail's readability is not part of this change, and SA-03's Audit trail tab depends on it.
  - [ ] `0012`'s `idx_audit_log_gym_actor_action` composite index existed solely to serve the old escalation-check subquery, which no longer exists. **Leave it in place anyway** and note why in a comment: `audit_log` is queried by `(gym_id, ...)` elsewhere and dropping an index is not this story's business. Do not "clean it up".

- [ ] **Task 3: Migration — the two write RPCs** (AC: #4, #5, #6)
  - [ ] `escalate_gym_data_access(p_gym_id uuid, p_reason text) returns uuid`, `security definer`, `set search_path = public`. Self-enforce `private.is_super_admin()` internally and `raise exception` otherwise — `security definer` bypasses RLS entirely, so that internal check is the only gate (the same reasoning `log_audit_event()` and `platform_metrics()` already document). Insert a grant with `expires_at = now() + interval '24 hours'`, then call `log_audit_event(p_action_type := 'gym_data_escalation', p_gym_id := p_gym_id, p_target_entity_id := <new grant id>::text, p_target_entity_type := 'gym_data_escalations', p_metadata := jsonb_build_object('reason', p_reason))` in the **same transaction**, so a grant can never exist without its audit record. Return the new grant id.
  - [ ] Insert a **new row on every escalation**, even when an active grant already exists. Story 1.7 Task 4 decided explicitly that repeat escalation is a legitimate distinct event ("a new reason, a new point-in-time record"), and that decision still holds — the `exists` helper is indifferent to how many active rows there are. Do **not** add a no-op guard and do **not** extend the existing row's `expires_at`.
  - [ ] `revoke_gym_data_access(p_gym_id uuid, p_actor_id uuid, p_reason text) returns integer`, `security definer`. Self-enforce `private.is_super_admin()`. Set `revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason` on **every** currently-active grant for that `(gym_id, actor_id)` pair — not one id — since Task 3's repeat-escalation rule means several may be open at once. Revoking zero rows is not an error; return the count. Audit-log with `p_action_type := 'gym_data_escalation_revoked'`, `p_target_entity_id := p_actor_id::text`, `p_target_entity_type := 'users'`, metadata carrying the reason and the revoked count.
  - [ ] `p_reason` is mandatory on both — `raise exception` on null/blank, mirroring the escalation dialog's existing mandatory-reason contract.
  - [ ] `grant execute` on both to `authenticated` only, and `revoke execute ... from public` — `0007_audit_log.sql:222-227` documents why the `public` default must be explicitly revoked.
  - [ ] `action_type` is free text on `audit_log` (`0007:40`), so `gym_data_escalation_revoked` needs **no** enum migration.

- [ ] **Task 4: Service layer + Server Actions** (AC: #3, #4, #5)
  - [ ] `services/gyms.ts`: `listActiveEscalations(gymId)` → active grants for the gym with the holder's display name, for AC #3's list. Joining `users.display_name` needs a `public.users` read — **verify whether a Super Admin SELECT policy on `public.users` exists before relying on it**; if it does not (likely), return `actor_id` and resolve the display name from the grant's own `audit_log` entry (`actor_display_name` is denormalized there at write time, `0007:38`), or add the display name to the RPC's return. Do not silently ship a list of null names.
  - [ ] `getActiveEscalationForCurrentActor(gymId)` → `{ expiresAt } | null`, backing the page's own escalated/not-escalated state and its expiry countdown.
  - [ ] Rewrite `logGymDataEscalation` (`services/gyms.ts:290-295`) to call the new `escalate_gym_data_access` RPC instead of `log_audit_event` directly. Keep its "never report success if the write failed" contract — it is now even more load-bearing, since the RPC writes both the grant and the audit row.
  - [ ] Add `revokeGymAccess(gymId, actorId, input)` to `app/(admin)/gyms/actions.ts`, validated with a new `revokeGymAccessSchema` in `packages/types/src/schemas/gym.ts` (reason, `.trim().min(5)`) — mirroring `escalateGymAccessSchema`'s existing shape and its one-schema-per-action-intent convention.

- [ ] **Task 5: SA-03 UI** (AC: #3, #4, #5)
  - [ ] `gyms/[id]/page.tsx`: derive `escalated` from `getActiveEscalationForCurrentActor`, **replacing** the current derivation from the audit-trail fetch (`page.tsx:53-62`). That derivation is now wrong — it cannot see expiry or revocation. Delete it; do not leave both.
  - [ ] Replace the bare "Access granted" indicator with one that states the deadline, e.g. "Access granted — expires {time}". This is what the string was always implying; make it true. Keep the existing i18n key (`gyms.detail.accessGranted`) only if its copy is rewritten in both locales, otherwise add a new key and remove the old.
  - [ ] New `ActiveAccessList.tsx` under `gyms/[id]/components/`: read-only rows (holder, granted, expires) each with a `[Revoke access]` button opening a mandatory-reason dialog. Reuse the native `<dialog>`/`showModal()` pattern from `EscalateAccessDialog.tsx` — there is still no Dialog primitive in `apps/super-admin/components/ui/` and none should be added.
  - [ ] The confirm button names its target ("Revoke Paul Nkusu's access to FitZone Yaoundé"), per UX-DR12's destructive-confirmation rule (`epics.md:291`) and this app's existing dialog convention.
  - [ ] Section renders nothing when no grants are active.
  - [ ] All new copy in `locales/{en,fr}.json` under `gyms.dataAccess.*`. Do not reuse `gyms.lifecycle.reason` — `deferred-work.md:493` already logs that key's cross-surface reuse as a live problem; adding a third consumer makes it worse.

- [ ] **Task 6: pgTAP `supabase/tests/gym_data_escalation_ttl_revocation.test.sql`** (AC: #1, #2, #4, #5)
  - [ ] New file, session-simulation conventions copied from `gym_data_escalation_rls.test.sql` (fixtures seeded as the connecting role before any `set local role authenticated`, wrapped `begin; select plan(N); ... finish(); rollback;`).
  - [ ] Assert: fresh grant → rows visible; grant with `expires_at` in the past → zero rows; revoked grant (`revoked_at` set, still inside its window) → zero rows; revoked-then-re-escalated → rows visible again (AC #5); actor Y's grant never grants actor X anything; a grant on gym A never reaches gym B.
  - [ ] Seed expired/revoked fixtures by direct `insert` with explicit `expires_at`/`revoked_at` values rather than round-tripping the RPCs — the same fixture-seeding precedent `gym_data_escalation_rls.test.sql` already sets.
  - [ ] **`gym_data_escalation_rls.test.sql` will now fail** — it seeds a bare `gym_data_escalation` audit row and asserts rows become visible, which is exactly the behaviour this story removes. Update it to seed a `gym_data_escalations` row instead, and adjust its `plan(9)` if the assertion count changes. Do not delete the file; its per-actor and per-gym isolation assertions are still the right ones.
  - [ ] Run the full suite and report the real observed number.

- [ ] **Task 7: Manual verification** (AC: #1–#6)
  - [ ] Escalate, confirm access works and the indicator shows an expiry.
  - [ ] Force-expire by updating `expires_at` directly in `psql`; confirm access is gone with no other action.
  - [ ] With a second Super Admin account, confirm B sees A's grant in the Active data access list, revokes it with a reason, and A's access is gone.
  - [ ] Confirm A can re-escalate afterwards and regains access (AC #5).
  - [ ] Confirm both event types appear in the Audit trail tab (AC #6).
  - [ ] Re-check in French.

- [ ] **Task 8: `docs/decisions.md` + `packages/types/src/database.ts`**
  - [ ] Dated entry, newest-first, explicitly recording that this **reverses Story 1.7's Decision 1** and why (see Dev Notes → Why This Reverses 1.7). Reference `docs/decisions.md:1232` and `:1234` directly so the two entries read as a pair rather than a contradiction.
  - [ ] Regenerate `packages/types/src/database.ts` (`supabase gen types typescript --local`). Unlike Stories 1.5/1.7, this story **does** change table shape — expect a real diff adding `gym_data_escalations`. `docs/decisions.md` records recurring drift in this file (tables missing entirely from past regenerations), so verify the new table is actually present rather than assuming.

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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
