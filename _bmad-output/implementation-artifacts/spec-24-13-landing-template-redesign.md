---
title: '24-13 Classic template redesign (bold hero, light bands, dark visit band)'
type: 'feature'
created: '2026-11-10'
status: 'in-review'
route: 'dispatch'
baseline_commit: '52081e0'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

## Intent

**Problem:** In the owner's browser pass the first Classic template (white cards on beige, a thin banner strip, an empty Location card) was functional but judged "horrible". Pages are not public yet (`CNAME *` is held), so the design can change before launch.

**Approach:** Redesign the one registered template, `classic`, with native design judgment and two public fitness template kits as references (full-bleed photo hero, big uppercase headline, one strong accent, sharp corners, heading marks, a dark band, a strong repeat call to action). No new template, no migration, no change to the render contract, the ten sections or their order.

## Boundaries & Constraints

**Always:** one style block of at most 20 KB; no script, no `srcset`; Barlow 700 and 800 only; gym color is a fill only (never a text color on its own); text on the fill uses `--on-gym`; every fixture passes the DOM and Chromium conformance suites; `data-section` order, `data-action`, `data-role=repeat-action` directly above the footer.

**Never:** no change to `colors.ts`, `contract.ts`, the chrome dictionaries, the migrations, or the proxy; no second template in this story (it needs a dark-aware color pairing).

## Acceptance

1. A page with a banner shows a 560 px hero (640 on desktop) with the name, the contact actions and a readable gradient; a page without a banner shows a plain dark hero.
2. About beside a dark Services panel; Plans on a white band; Hours beside Location in one dark band; Gallery with a large first image; a repeat band; footer.
3. Looks right at 360, 768, 1280 and 1366 px, with a green, a yellow and a near-black gym color, and a 60-character name.
4. `@gymos/page-templates` DOM and layout suites, `apps/landing` tests and the full `scripts/ci-local.sh` pass.
5. DESIGN.md (Classic table) and EXPERIENCE.md (layout by breakpoint) describe what shipped.

## Verification log

- 2026-11-10: page-templates 119 DOM tests and 29 Chromium layout tests, landing 102 tests, typecheck, eslint: pass. Viewed at 390 and 1280 px with and without a banner, three gym colors, long name. Owner viewed the local page before the redesign only; the owner's re-check of the new design is still to come.
- Test edits: `contract.test.ts` class string `chips` -> `checks` (intent kept); four known-bad layout flaws in `conformance/bad.ts` retargeted, one renamed (see docs/decisions.md 2026-11-10).

- 2026-11-10 (owner follow-up): Services bullet markers stripped on save (`cleanServicesText`), dashboard form and service tests 115, types 21, typecheck: pass.

## Deferred

See deferred-work.md "Deferred from: build of spec-24-13".
