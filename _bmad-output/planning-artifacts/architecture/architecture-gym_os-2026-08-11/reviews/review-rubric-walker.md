# Rubric Walk — ARCHITECTURE-SPINE.md (gym_os, 2026-08-11)

Reviewer: good-spine rubric walker
Target: `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md`
Cross-checked against: `.memlog.md` (same dir), `prd.md` (v1.5, final), prior `architecture.md` (2026-07-04, superseded), and the live repo at `supabase/` (migrations, functions, package.json/pnpm-lock.yaml).

Overall verdict: **Solid spine, one real gap.** Twenty-four ADs correctly distill the memlog's decisions and mostly ratify brownfield reality accurately (3 Edge Functions, 50 migrations, `payment_providers`-driven switching, `private.gym_id()` naming all check out against the repo). But one Epic-11-gating NFR — tenant suspension enforced at the RLS/auth-hook layer (NFR-018) — has no AD, no mechanism, and nothing in the repo today implements it; this is exactly the class of problem AD-3 exists to solve for role staleness, left unsolved for gym-suspension staleness. Stack table version pins are also stale against the repo's own lockfile.

---

## 1. Does it fix the real divergence points for Epics 1–13, missing none?

Mostly yes. Cross-referencing against `sprint-status.yaml`'s epic list (1–13) and the PRD's FR/NFR sections:

- Epic 9 (Staff Management): AD-3, AD-4, AD-5, AD-6 cover the live-role-lookup, multi-gym resolution, Super Admin escalation, and the staff-creation/role-ceiling RPC pair. Good coverage of FR-087–092, NFR-013.
- Epic 10 (Progress Tracking): AD-24 covers the private photo bucket and per-photo revocation (NFR-011, FR-095). The coach-assignment-ends-immediately rule (FR-095, NFR-016) is not a new divergence point — it's already a live-table RLS join in the existing pattern, not a JWT-claim staleness problem, so no new AD is needed there. Correct scoping.
- Epic 11 (SaaS Billing): AD-13, AD-14, AD-15, AD-16 cover payment-provider runtime switching, the separate `saas_billing_payments` table, Vault credential storage, and integer money. **Missing: FR-131/FR-132/NFR-018's tenant-suspension enforcement mechanism — see Finding 1, this is the one real gap.**
- Epic 12 (Classes & Scheduling): AD-21 covers booking-capacity concurrency (FR-105). Good.
- Epic 13 (Workout Plans): AD-23 (extended) covers offline completion logging (FR-110). Good.
- Epic 4/6 extensions (OTP fallback chain, WhatsApp messaging): AD-11, AD-12 cover FR-117/118.

So 5 of 6 new-in-V1.5 epics/extensions are fully covered; Epic 11 has a hole. See Finding 1.

## 2. Is every AD's Rule enforceable, and does it actually prevent the stated divergence?

Most ADs are concrete and testable (AD-1, AD-2, AD-6, AD-11, AD-13, AD-16, AD-17, AD-21, AD-22 all name a specific mechanism — a helper function, an index, a lock, a table shape — that a reviewer or CI could check for). Two are weaker:

- **AD-3** ("every policy that currently reads `auth.jwt() ->> 'app_role'` is migrated to call [the new helper] instead") states the *goal* but not an enforcement mechanism. The repo currently has 27 migration files referencing `app_role` in policy definitions — a real, non-trivial migration surface — and the spine's Consistency Conventions table has a precedent for exactly this kind of guardrail (the i18n hardcoded-string CI lint gate) that AD-3 doesn't borrow. Without a CI grep-check (e.g., "no RLS policy body may contain `app_role`"), nothing stops a later migration from reintroducing the stale-claim pattern AD-3 exists to close. Medium severity — the *rule* is right, the *enforcement* is unstated.
- **AD-15** ("per-gym Tara Money credentials are stored in Supabase Vault") is comparatively thin next to AD-13's sibling decision in the same epic — AD-13 specifies the exact write-path lockdown (partial unique index, `SECURITY DEFINER`-only writes, no RLS INSERT/UPDATE/DELETE policy) that makes the rule enforceable and testable; AD-15 only names the storage mechanism, not an equivalent guarantee (e.g., that the plaintext credential column literally cannot exist, or that only the payment service role can call the Vault-read function). Low-medium — likely fine in practice since Vault access is itself gated by Postgres grants, but the AD doesn't say so, so it reads as a preference statement more than a Rule with teeth.

All other ADs pass: the Rule text names a specific artifact (function, index, table, RPC) whose absence would be a visible, checkable divergence.

## 3. Could anything under "Deferred" let two independently-built units diverge incompatibly?

Two soft risks, neither "hard" incompatibility but both plausible coordination failures:

- **PostHog (NFR-014)** — "unhomed; fold into whichever of Epics 9–13 ships first as 1–2 stories, not its own epic." This assigns no owner. If two epics both start implementation before either checks whether PostHog landed, the realistic failure isn't a hard technical clash — it's either (a) two independent event-schema/init-point implementations wired up in parallel epics, or (b) nobody claims it and NFR-014 quietly slips. "Whichever ships first" is a race condition dressed as a decision. A one-line "owned by Epic 9" (or whichever is expected to land first) would remove the ambiguity at negligible cost.
- **E2E baseline (NFR-015)** — mechanism (Playwright vs. other) deliberately not chosen, but the four flows it must cover (staff provisioning, payment cutover, progress-data access, class booking) span four different epics (9, 4/11, 10, 12) that are free to proceed in parallel. If two of those epics each stand up ad hoc test scaffolding before the E2E mechanism is chosen, that's exactly the kind of divergence a spine exists to prevent — deferring the tool choice is fine, but the spine could note "no epic should hand-roll its own E2E harness before this is decided" and doesn't.

Neither rises to AD-worthy (both are process/ownership risks, not structural ones), but both are worth a line of explicit sequencing guidance. Low-medium severity.

Everything else in Deferred is correctly scoped — no structural shape is being deferred that a later epic could build against incompatibly (e.g., "Class/workout entity detail" deferral explicitly names the three invariants it does fix: gym-scoped, capacity-checked, one-member-per-plan — that's the right amount to pin at this altitude).

## 4. Is named tech plausible/current, or should it be flagged for a web-verification pass?

Flag the Stack table's exact patch pins — they don't even match this repo's own installed state, which undermines their value as an invariant regardless of whether they were ever correct against the public registry:

- **Next.js 16.2.10** — `apps/dashboard/package.json` and `apps/super-admin/package.json` both pin `"next": "latest"`, not a fixed version. `pnpm-lock.yaml` resolves to `next@16.3.0`. The `16.2.10` figure appears to be carried forward unchanged from the prior `architecture.md` (dated 2026-07-04, "Versions verified 2026-07-04") — one release behind the repo's own lockfile a month later, and not actually enforced anywhere since the app manifests float on `latest`.
- **Expo SDK 57.0.1** — `apps/mobile/package.json` pins `~57.0.7`; lockfile resolves `expo@57.0.7`. Same stale-carryover pattern.
- **Turborepo 2.x** — correctly left loose (not over-pinned like the other two) and matches the installed `turbo@2.10.3`. No issue.

Recommend the separate web-verification pass check whether Next.js 16.x and Expo SDK 57.x are themselves real, current releases (outside this reviewer's ability to confirm against a moving public registry) — but independent of that, the spine's specific patch numbers for Next.js and Expo should be corrected to match the repo's actual resolved versions (or the table should state "next: latest" / a range, matching what's actually pinned) so the Stack table is a true invariant rather than a stale snapshot. Medium severity — not a security or correctness risk, but a "consistency contract" that's already inconsistent with the thing it's supposed to govern.

## 5. Does it ratify brownfield reality rather than contradict it?

Yes, well. Spot-checked against the repo:

| Spine claim | Repo reality | Match |
|---|---|---|
| 3 Edge Functions: `payment-webhook`, `send-sms-hook`, `gym-qr-display` | `ls supabase/functions/` → exactly these three | ✓ |
| 50+ migrations | `ls supabase/migrations/` → 50 | ✓ |
| `payment_providers` table + `activate_payment_provider()` RPC drives runtime switching | Found in `0029_payment_provider_registry.sql`, `0030_...`, `0050_...` | ✓ |
| Helper is `private.gym_id()`, `STABLE` | `0009_auth_hook_gym_claims.sql` defines exactly this, and the migration's own comment records the deviation from the old architecture.md's `auth.gym_id()` naming — the spine correctly picked up the corrected name, not the stale one | ✓ |
| `member_role` enum gets a new `supervisor` value (AD-6) | Current enum (`0001_extensions_and_enums.sql`) has `member, coach, receptionist, manager, owner` — no `supervisor` yet, consistent with AD-6 describing a future addition, not an already-shipped one | ✓ |
| `private.current_member_role()` (AD-3) doesn't exist yet | Confirmed absent from the repo — consistent with AD-3 describing new work | ✓ |

One reality the spine does *not* ratify or address: `gym_status` (`active`/`suspended`/`deactivated`) already exists (`0001_extensions_and_enums.sql`), and Super Admin could already manually suspend a gym in V1.0 (FR-071) — but grepping the claims hook and RLS migrations turns up **no enforcement** of gym status anywhere at the RLS or auth-hook layer today. This is the same gap as Finding 1 below, seen from the brownfield-reality angle: the spine neither documents this as a known pre-existing hole nor decides how V1.5 closes it.

## 6. Is every structural dimension this altitude owns decided, deferred, or an open question?

Yes for the standard checklist — deployment topology (Vercel ×2 projects, Supabase Cloud EU-West with RTT rationale, EAS), CI (typecheck, pgTAP against Supabase Branching preview, i18n lint gate), and "no production traffic yet" ceiling are all stated explicitly in the "Deployment & environments" paragraph, not silently omitted. Observability (Sentry), analytics (PostHog, deferred with a location), naming/format conventions, and the ERD are all present.

The one dimension that's silently absent rather than decided/deferred is **authorization enforcement for tenant-lifecycle state** (gym suspension) — see Finding 1. It isn't in Deferred, isn't an Open Question, and isn't an AD; it simply isn't mentioned, despite NFR-018 explicitly demanding it as a release gate ("enforced at the authorization layer... suspended gym's staff and members are denied at the RLS/auth-hook layer... takes effect on the next request").

---

## Findings (ranked)

### Finding 1 — HIGH (borderline Critical): No AD covers NFR-018's RLS/auth-hook-layer tenant-suspension enforcement (FR-131, FR-132, NFR-018, Epic 11)

**Summary:** The PRD's Flow B release gate requires that a gym suspended for SaaS non-payment be denied access at the RLS/auth-hook layer — "not only the UI" — and that suspension "takes effect on the next request," explicitly not merely on next login/token refresh (NFR-018). This is structurally the same problem AD-3 was written to solve for *role* staleness (a demoted staff member's stale JWT must not grant access past the next query) — but for *gym* staleness. AD-3's new `private.current_member_role()` helper does a live lookup scoped by role only; nothing in the spine extends an equivalent live check to `gyms.status`.

**Verified against the repo:** `gym_status` (`active`/`suspended`/`deactivated`) already exists from V1.0 (`0001_extensions_and_enums.sql`), and manual suspend was already a V1.0 Super Admin capability (PRD FR-071). But `custom_access_token_hook()` (`0009_auth_hook_gym_claims.sql`) checks only `members.deactivated_at`, never `gyms.status` — and even if it did, checking status only at token-issuance time would reproduce the exact "stale JWT" problem AD-3 exists to close (a gym suspended mid-session would still pass RLS until the member's next login, contradicting NFR-018's "next request" requirement). No RLS policy in any migration filters on `gyms.status` either.

**Failure scenario:** Two Epic 11 stories are built independently — one implementing gym-suspension enforcement by extending `private.current_member_role()` to also check gym status, another implementing it as a separate `private.is_gym_active()` helper called ad hoc from a subset of policies, a third implementing it only inside the JWT claims hook (which would silently fail NFR-018's "immediate" requirement since it only fires on login). All three are plausible readings of an unstated architecture; only one is correct, and nothing in the spine says which.

**Recommendation:** Add an AD alongside AD-3, e.g. "gym-suspension is checked via the same live-lookup pattern as role (extend `private.current_member_role()`'s scope, or add a sibling `private.gym_is_active()` STABLE helper called by every tenant-scoped policy), never via the JWT claim alone" — mirroring AD-3's own structure and "Prevents" clause.

### Finding 2 — MEDIUM: Stack table version pins are already stale against the repo's own lockfile

Next.js is listed as `16.2.10` but `apps/dashboard`/`apps/super-admin` `package.json` pin `"next": "latest"`, resolving in `pnpm-lock.yaml` to `next@16.3.0`. Expo SDK is listed as `57.0.1` but `apps/mobile/package.json` pins `~57.0.7`, also matching the lockfile. Both figures trace back unchanged from the prior `architecture.md` (dated 2026-07-04) and were never refreshed when the spine was distilled a month later. Turborepo's `2.x` (loosely stated) correctly matches the installed `2.10.3` and is not an issue. Recommend the separate web-verification pass also flag this repo-internal mismatch, independent of whatever it finds against the public npm registry.

### Finding 3 — MEDIUM: AD-3's migration rule ("every policy... is migrated") has no CI enforcement mechanism

27 existing migration files reference `app_role` in policy bodies today. AD-3 states the end-state goal but, unlike the i18n hardcoded-string convention it sits next to in the same document (which has an explicit CI lint gate), names no automated guard against a future migration reintroducing `auth.jwt() ->> 'app_role'` in a new or edited policy. Recommend a one-line CI/lint rule alongside AD-3's Rule text.

### Finding 4 — LOW/MEDIUM: PostHog's Deferred entry assigns no epic owner, risking duplicate or dropped instrumentation

"Fold into whichever of Epics 9–13 ships first" is a race condition, not an assignment — recommend naming the epic expected to land first, or explicitly deferring the *decision* of which epic owns it to sprint planning rather than leaving it to whichever team gets there first.

### Finding 5 — LOW: Four ADs (AD-3, AD-6, AD-14, AD-21) lack the `[ADOPTED]` status tag the other twenty carry

Cosmetic inconsistency, but notably for AD-21 (booking-capacity concurrency) the memlog explicitly flags this decision as "an extrapolation from precedent, not a proposal-sourced decision — confirm during Epic 12 story-writing if a lighter mechanism suffices at pilot scale." The spine strips that hedge without replacing it with an explicit tag or caveat, so a reader of the spine alone (without the memlog) can't tell AD-21 apart from a fully validated decision like AD-13. Recommend either tagging these `[ADOPTED]` for consistency or using a distinct tag (e.g. `[EXTRAPOLATED, confirm at story-writing]`) to preserve the memlog's own caveat.
