# Sprint Change Proposal — 2026-09-01

## 1. Issue Summary

Epic 13 (Workout Plans) closed on 2026-09-01 with all 5 stories done and no backlog planned behind it — `epics.md` has nothing defined past Story 13.5. A post-close release-readiness review (conducted in party-mode, cross-functional discussion among the installed BMAD agents) was run to ask what an "official release" still needs that no epic covers.

Three items were raised. One did not survive verification:

1. **Sentry error monitoring (NFR-007)** — `architecture.md` states Sentry is already "the sole V1 observability tool," but a repo-wide check confirms it was never implemented: zero `@sentry/*` packages, zero SDK calls, only a placeholder `SENTRY_DSN=` in `.env.example`. This was first discovered during Story 9.5's PostHog research (2026-08-20) and never followed up.
2. **Mobile redesign quality** — Stories 8.3–8.6 (mobile design-system foundation + screen restyles) shipped, but a 2026-08-05 real-device manual verification found the result "reads as a color/theme swap only — general interface quality/layout still doesn't match what was expected from the Figma reference." This is a still-`open` action item under epic 8 in `sprint-status.yaml`.
3. **Per-gym Tara Money credentials (FR-126)** — initially raised as "entirely unbuilt," sourced from the 2026-08-27 party-mode memlog. **This was wrong.** Verification during this workflow found Stories 4.13, 4.14, and 4.15 already shipped the full chain (per-gym Vault-encrypted credential storage, Flow A settlement routing into the gym's own account, member self-service renewal) on 2026-08-17/18 — before the memlog session that restated it as open. The memlog entry was stale. The only real residual gap is a narrow, already-logged hardening nit (see below).

## 2. Impact Analysis

**Epic impact:** None of the three items break, invalidate, or require rework of any existing epic — all touched epics (4, 8) are already `done` in their originally-shipped scope. This is pure addition, not correction of shipped work.

- **Epic 4** (`done`) gains one new story (4.16) for the hardening nit — same pattern this codebase already uses for Tara Money follow-ups.
- **Epic 8** (`done`) is not modified — the mobile-redesign finding stays exactly where it already lives (an open action item), pending a UX pass; nothing in Epic 8's shipped scope is being reopened.
- **Two new epics** (14, 15) are added, both `backlog`.

**Story impact:**
- New: Story 4.16 (Platform Business ID Collision Guard), Story 14.1 (Sentry Error Monitoring).
- Deferred (not yet story-shaped): Epic 15 is a placeholder only — no story exists, and none should be written until a `bmad-ux` pass diagnoses what's actually wrong with the mobile redesign.

**Artifact conflicts:**
- **PRD:** None. NFR-007 already exists in the PRD as written — this is fulfillment of an existing requirement, not a new one. FR-126 needs no PRD change (already correctly shipped). MVP scope is unaffected — all of this is post-MVP release hardening.
- **Architecture:** None. Sentry and the collision-guard fix both already match `architecture.md`'s existing design (the sole-observability-tool statement, AD-15's per-gym Vault storage). Each will get a `docs/decisions.md` entry once actually implemented, per this codebase's standing convention.
- **UX:** Real gap, but the fix *is* the UX pass — Epic 15 exists specifically to trigger `bmad-ux`, not to bypass it.
- **Other artifacts:** None — no CI, deploy, or testing-strategy changes implied by any of the three items.

## 3. Recommended Approach

**Direct Adjustment** (Option 1) for all three — add stories/epics within the existing structure. No rollback is warranted (nothing shipped is broken), and no PRD/MVP scope review is warranted (these are additions on top of an already-complete MVP, not signs the MVP itself needs to shrink or change).

| Item | Path | Effort | Risk |
|---|---|---|---|
| Story 4.16 (collision guard) | Direct Adjustment — small migration + RPC guard, single story | Low | Low |
| Story 14.1 (Sentry) | Direct Adjustment — new epic, one story spanning 3 apps | Medium | Low |
| Epic 15 (mobile redesign) | Direct Adjustment, but gated — placeholder epic now, real stories only after a `bmad-ux` pass | Low now / TBD after UX pass | Low now / TBD |

Rationale: all three are additive, none touch shipped code paths destructively, and none change what the MVP delivers — they only harden and complete it. The one item that needs different handling (mobile redesign) gets it: rather than writing speculative acceptance criteria against "doesn't match Figma," the proposal routes it to the same UX-pass mechanism `epics.md` already uses for every other undefined V1.5 screen.

## 4. Detailed Change Proposals

### 4.1 `epics.md`

- **New section** "Release Hardening (2026-09-01 sprint-change-proposal)" added after the V1.5 dependency-order paragraph, summarizing all three items and their epic homes.
- **New `### Story 4.16: Platform Business ID Collision Guard`** appended to the Epic 4 extension section, after Story 4.15. Full AC: reject a `business_id_plain` connect attempt matching the platform's own `TARAMONEY_BUSINESS_ID`; leave the existing cross-gym unique index (migration 0054) untouched since it already covers gym-vs-gym collisions; close the matching `deferred-work.md` entry (Story 11.6 review, 2026-08-30) on ship.
- **New `## Epic 14: Observability & Release Hardening`** with `### Story 14.1: Sentry Error Monitoring`, appended after Epic 13/Story 13.5. Scope: `apps/dashboard`, `apps/super-admin`, `apps/mobile`; reuses Story 9.5's existing `VERCEL_ENV`/`EXPO_PUBLIC_APP_ENV` three-value environment-tagging convention rather than inventing a new one; safe no-op with no DSN configured; captures genuine-bug throws only, not the `{ data, error }` expected-error pattern; Edge Functions explicitly out of scope for this story (separate Deno SDK, flagged as a follow-up).
- **New `## Epic 15: Mobile Experience Quality Pass`**, placeholder only, explicitly marked blocked on a `bmad-ux` pass, with a "do not create a story against this epic without a UX pass first" guard.
- **FR/NFR mapping table** gains two lines: `NFR-007: Epic 14, Story 14.1` and `NFR-017 (hardening): Epic 4, Story 4.16`.

### 4.2 `sprint-status.yaml`

- `4-16-platform-business-id-collision-guard: backlog` added under the existing `epic-4` block.
- `epic-14: backlog` / `14-1-sentry-error-monitoring: backlog` / `epic-14-retrospective: optional` added.
- `epic-15: backlog` (commented: blocked on a `bmad-ux` pass) / `epic-15-retrospective: optional` added.
- A new `last_updated` log entry recorded, including the explicit correction that per-gym Tara Money credentials were misidentified as a gap and are in fact already shipped.

### 4.3 No changes to: `prd.md`, `architecture.md`, UX design docs. (Epic 15's eventual stories will require a UX design doc update, but that's `bmad-ux`'s deliverable, not this proposal's.)

## 5. Implementation Handoff

**Minor scope** — Story 4.16 and Story 14.1: ready for direct `bmad-create-story` → `bmad-dev-story` → `bmad-code-review`, same as any other backlog story. No PO/architect involvement needed beyond what's already in this proposal.

**Blocked / routed to UX** — Epic 15: not implementation-ready. Next step is `bmad-ux` (Sally) against the current mobile app and its Figma reference, to produce an actual diagnosis and design spec. Only after that should `bmad-create-epics-and-stories` or `bmad-create-story` turn Epic 15 into buildable stories.

**Success criteria:**
- Story 4.16 and Story 14.1 ship through the normal dev-story/code-review cycle with the same regression discipline (typecheck, i18n parity, pgTAP/Vitest, lint) every other story in this codebase has carried.
- Epic 15 is not touched by `bmad-dev-story` or `bmad-create-story` until a UX pass exists — the placeholder's guard note exists specifically to prevent that.
