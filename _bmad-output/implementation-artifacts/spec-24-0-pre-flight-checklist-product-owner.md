---
title: '24-0 Pre-flight checklist (product owner)'
type: 'chore'
created: '2026-11-01'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 24 puts a gym's phone, address and content on a public address, and depends on systems outside the repo (A2 Hosting DNS, Vercel, a staging Supabase project). Story 24.0 records the owner's decisions and access before any code ships.

**Approach:** Add one dated 24.0 entry to the top of `docs/decisions.md`, resolve PRD OQ-28, carry the consequence into the affected stories in `epics.md`, compile `epic-24-context.md`, and sync `sprint-status.yaml`. No application code, migration or config changes.

**Decisions (owner, 2026-11-01):**
1. OQ-28: a gym may enter content in both languages, each optional (about, services, public plan labels). The page shows the visitor's language when it exists, else the other; alternates are declared only where both exist.
2. Assumption values confirmed unchanged: 60 s at origin, 5 min CDN purge, 15 min sitemap regeneration (FR-207); reports answered within 5 business days (FR-204).
3. Access confirmed: A2 Hosting DNS zone, Vercel `apps/landing` project, a staging Supabase project, and a throwaway test label on the real zone.
4. The `bmad-ux` pass runs after 24.8 and before 24.9; 24.9 and 24.10 depend on it.

</frozen-after-approval>

## Implementation Notes

- OQ-29 (directory threshold) belongs to Epic 25 and stays open. NFR-025 (3 s LCP) stays an assumption until the 24.12 baseline.
- Consequences of decision 1: 24.5 stores EN and FR content fields; 24.8 and the FR-206 projection and snapshot test include both; 24.9 shows both fields; 24.10 picks the language and declares alternates only where both exist.
- Not verified by this story: that the access in decision 3 actually works. 24.1 and 24.2 prove it on the real systems.

## Spec Change Log

## Review Triage Log
