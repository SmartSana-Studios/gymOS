# Epic 21 Context: Gym Category

<!-- Compiled from planning artifacts (epics.md Epic 21, PRD v1.6 FR-171/FR-172, ARCHITECTURE-SPINE AD-32, UX-DR27/UX-DR31) and the Epic 19/20 as-built reconciliation. Edit freely. -->

## Goal

Every gym carries a category (Gym, Pilates Studio, Yoga Studio, Fitness Center, Other) that Super Admin sets at creation and Super Admin, Owner or Supervisor can change later, so gyms are classified for V1.7's directory and landing pages. Descriptive only: no screen, plan type, permission or flow changes (FR-172).

## Stories

- Story 21.1: Gym Category — column, setter & Super Admin (migration **0123**; head in production and tree is 0122)
- Story 21.2: Settings — Gym Category field, Owner/Supervisor (no migration)

21.1 -> 21.2. `epics.md` already shows 0123 (reconciled in the Epic 20 retro, S-1/S-2). Migrations after 0122 renumber nothing.

## Requirements & Constraints

- FR-171: `gyms.category text NOT NULL DEFAULT 'gym'`, CHECK on five stable codes `gym`, `pilates_studio`, `yoga_studio`, `fitness_center`, `other`; existing gyms read `gym` in the same statement. No free text for Other.
- FR-172: behavior identical for every category; wording stays "gym". A test asserts the setter touches only `category`.
- Labels are never stored: `GYM_CATEGORIES` and `gymCategorySchema` in `packages/types`, EN/FR labels Gym / Salle de sport, Pilates Studio / Studio Pilates, Yoga Studio / Studio Yoga, Fitness Center / Centre de fitness, Other / Autre.
- Out of scope: directory, landing pages, category filter or chip, free-text Other, any category-driven behavior.

## Technical Decisions

- AD-32: `set_gym_category(p_gym_id uuid, p_category text)`, SECURITY DEFINER, `search_path` pinned; allowed for Super Admin and the gym's Owner/Supervisor; role via `private.current_member_role()` plus the Super Admin check, never JWT `app_role` (19.1 lint).
- Own BEFORE UPDATE pin trigger `private.pin_gym_category()` (its own function, not a branch in `protect_super_admin_only_gym_columns()`, not the charging or loyalty pins), restoring the old value unless the setter's GUC is set; 0098 `registration_fee` is the shape. Insert is unaffected, so `createGym` can set it directly.
- One `audit_log` row per real change with old/new code, actor and gym; a no-op writes none. EN/FR label "gym category changed" (UX-DR31).
- Privileges (0104 convention): EXECUTE revoked from `public`/`anon`, granted to `authenticated`; trigger function not executable by clients.
- Precedent: 0105 `gyms.country` and `createGym` in `apps/super-admin/app/(admin)/gyms/actions.ts`.
- Migration needs pgTAP positive + `.negative`, regenerated `packages/types/src/database.ts`, suspension handling decision documented, rollback script under `scripts/` like 0110-0122, and a prod-apply stage 7 (head must be 0122) with a verification query.
- Add `category` to the gym select in the Super Admin gyms list and detail reads; keep it out of `gymSettingsSchema` (21.2) so [Save Settings] never sends it.

## UX & Interaction Patterns

- SA-04 Create Gym: required Category select, default Gym / Salle de sport, `gymCategorySchema` client-side and re-checked in `createGym` before the first write.
- SA-03 Gym detail: `Category: [label] [Change]` under Owner, inline select with [Save]/[Cancel], no confirmation, toast "Category updated." / "Catégorie mise à jour.", typed refusal inline. Never shows Charge guests or Loyalty.
- SA-02 Gyms list: plain-text Category column after Gym Name in the admin's language, no chip, no filter.
- 21.2 Settings: Category select in the Branding block under Primary Colour, helper text, own [Save category] enabled only when changed, calls `set_gym_category` not the generic update, toast "Category saved." / "Catégorie enregistrée."; absent from the DOM for roles that cannot open Settings (Owner/Supervisor only). Unsaved category edits survive [Save Settings] and vice versa (UX-DR27).
- EN/FR parity for every string.

## Cross-Story Dependencies

- 21.1 before 21.2 (21.2 calls the setter and reads the column).
- Independent of Epics 19-20; no hook or ledger interaction.

## Carry-over that touches this epic

- Production is live with real gyms: 0123 is an additive NOT NULL DEFAULT column on `gyms`, so run dry run, db-backup workflow, then prod-apply before merging the app code that reads the column.
- `gyms.status` UPDATE silently reverts via trigger; the same pin-trigger family applies here, so pgTAP must prove the setter's GUC path, not only the revert.
- Any new RPC touched through PostgREST: exercise it for real before review (`scripts/epic19-qa` pattern). Local QA kit for this epic is optional given two small stories.
- Ad hoc production changes get a `docs/decisions.md` entry; sprint-status entry per pass.
